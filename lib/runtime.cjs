"use strict";

// A medama-owned runner. Only Node's standard library is used here.
const Module = require("node:module");
const fs = require("node:fs");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { performance } = require("node:perf_hooks");

class SetupError extends Error {}
class TimeoutError extends Error {}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expressionMatcher(pattern) {
  let expression = "^", position = 0;
  const conversions = [];
  for (const match of pattern.matchAll(/\{([^{}]*)\}/g)) {
    expression += escapeRegex(pattern.slice(position, match.index));
    if (match[1] === "word") {
      expression += "(\\S+)";
      conversions.push((captures) => captures.shift());
    } else if (match[1] === "int") {
      expression += "([-+]?\\d+)";
      conversions.push((captures) => Number(captures.shift()));
    } else if (match[1] === "string") {
      expression += String.raw`(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')`;
      conversions.push((captures) => {
        const double = captures.shift(), single = captures.shift();
        return (double === undefined ? single : double).replace(/\\(["'])/g, "$1");
      });
    } else {
      throw new SetupError(`unsupported parameter {${match[1]}}`);
    }
    position = match.index + match[0].length;
  }
  expression += escapeRegex(pattern.slice(position)) + "$";
  const regex = new RegExp(expression, "u");
  return (text) => {
    const match = regex.exec(text);
    if (!match) return null;
    const captures = match.slice(1);
    return conversions.map((convert) => convert(captures));
  };
}

class DataTable {
  constructor(rows) { this.data = rows.map((row) => [...row]); }
  raw() { return this.data.map((row) => [...row]); }
  rows() { return this.raw().slice(1); }
  hashes() {
    const [keys, ...rows] = this.data;
    if (!keys || new Set(keys).size !== keys.length) throw new Error("invalid table header");
    return rows.map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i]])));
  }
  rowsHash() {
    if (this.data.some((row) => row.length !== 2)) throw new Error("rowsHash requires two columns");
    return Object.fromEntries(this.data);
  }
}

class Registry {
  constructor() {
    this.steps = [];
    this.before = [];
    this.after = [];
    this.timeout = 5000;
    this.running = false;
  }

  options(options, permitted) {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new SetupError("options must be an object");
    for (const key of Object.keys(options)) {
      if (!permitted.includes(key)) throw new SetupError(`unsupported option ${key}`);
    }
    if (options.timeout !== undefined) this.validateTimeout(options.timeout);
    if (options.tags !== undefined && (typeof options.tags !== "string" || !/^@[^\s`]+$/.test(options.tags))) {
      throw new SetupError("hook tags require one @tag; expressions are not supported");
    }
    return { ...options };
  }

  validateTimeout(value) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new SetupError("timeout must be a positive integer in milliseconds");
  }

  register(kind, pattern, options, fn) {
    if (this.running) throw new SetupError("definitions must be registered before execution");
    if (typeof options === "function" && fn === undefined) { fn = options; options = {}; }
    if (typeof fn !== "function") throw new SetupError(`${kind} requires a function`);
    const hook = kind === "Before" || kind === "After";
    if (hook) {
      if (fn.length !== 0) throw new SetupError("hook arguments and callback async are not supported");
      this[kind === "Before" ? "before" : "after"].push({ fn, options: this.options(options, ["tags", "timeout"]) });
    } else {
      let match;
      if (typeof pattern === "string") match = expressionMatcher(pattern);
      else if (pattern instanceof RegExp) {
        match = (text) => new RegExp(pattern.source, pattern.flags).exec(text)?.slice(1) ?? null;
      } else throw new SetupError("step pattern must be a String or RegExp");
      this.steps.push({ fn, match, options: this.options(options, ["timeout"]) });
    }
  }

  api() {
    const exports = {};
    for (const kind of ["Given", "When", "Then"]) exports[kind] = (...args) => this.register(kind, ...args);
    for (const kind of ["Before", "After"]) exports[kind] = (options, fn) => this.register(kind, null, options, fn);
    exports.setDefaultTimeout = (value) => {
      if (this.running) throw new SetupError("timeout must be configured before execution");
      this.validateTimeout(value);
      this.timeout = value;
    };
    return new Proxy(Object.freeze(exports), {
      get(target, name) {
        if (typeof name === "symbol") return target[name];
        if (!Object.hasOwn(target, name)) throw new SetupError(`unsupported registration API ${name}`);
        return target[name];
      },
    });
  }
}

let activeApi;

function definitionApi() {
  if (!activeApi) throw new SetupError("step definitions must be loaded by the medama CLI");
  return activeApi;
}

function installImports(registry, files) {
  if (typeof Module.registerHooks !== "function") throw new SetupError("JavaScript runner requires Node.js 22.19 or later");
  const api = registry.api(), previous = Module._load, previousApi = activeApi;
  const typescriptFiles = new Set(files.filter((file) => /\.(?:ts|cts)$/.test(file)).map((file) => pathToFileURL(fs.realpathSync(file)).href));
  if (typescriptFiles.size && process.features.typescript !== "strip") {
    throw new SetupError("TypeScript steps require native type stripping; remove --no-experimental-strip-types, --no-strip-types or --experimental-transform-types");
  }
  activeApi = api;
  Module._load = function (request, ...args) {
    if (request === "@yasuhito/medama" || request === "@cucumber/cucumber") return api;
    return previous.call(this, request, ...args);
  };
  // Block deep/CommonJS/ESM imports of an external Cucumber implementation.
  const guard = Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@cucumber/")) throw new SetupError(`external Cucumber import is unsupported: ${specifier}`);
      const resolved = nextResolve(specifier, context);
      if (/\/node_modules\/@cucumber\//.test(resolved.url)) throw new SetupError("external Cucumber module loading is forbidden");
      return resolved;
    },
    load(url, context, nextLoad) {
      const typescript = typescriptFiles.has(url) ||
        (url.startsWith("file:") && /\.(?:ts|cts|mts)$/.test(new URL(url).pathname));
      if (typescript && process.features.typescript !== "strip") {
        throw new SetupError("TypeScript steps require native type stripping; remove --no-experimental-strip-types, --no-strip-types or --experimental-transform-types");
      }
      const loaded = nextLoad(url, context);
      if (!typescript) return loaded;
      if (!["typescript", "commonjs-typescript"].includes(loaded.format)) {
        throw new SetupError(`TypeScript step files must be CommonJS; ESM is unsupported: ${url}`);
      }
      // Node performs the stripping and preserves source locations. Explicitly
      // choose CommonJS for step files and their TypeScript dependencies to
      // prevent automatic ESM detection in an untyped package. JavaScript
      // dependency formats keep Node's normal loading behavior.
      return { ...loaded, format: "commonjs-typescript" };
    },
  });
  return () => { Module._load = previous; activeApi = previousApi; guard.deregister(); };
}

async function invoke(registry, definition, world, args) {
  const timeout = definition.options.timeout ?? registry.timeout;
  if (definition.fn.length !== args.length) {
    return { status: "failed", error: `unsupported function arity: expected ${args.length}, got ${definition.fn.length}; callback async is not supported` };
  }
  let timer;
  const start = performance.now();
  try {
    const work = definition.fn.apply(world, args);
    const value = await Promise.race([
      Promise.resolve(work),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new TimeoutError(`timed out after ${timeout}ms`)), timeout); }),
    ]);
    if (performance.now() - start > timeout) throw new TimeoutError(`timed out after ${timeout}ms`);
    return { status: value === "pending" ? "pending" : value === "skipped" ? "skipped" : "passed" };
  } catch (error) {
    return { status: "failed", error: error?.stack ?? String(error), ...(error instanceof TimeoutError ? { timed_out: true } : {}) };
  } finally { clearTimeout(timer); }
}

function overall(outcomes) {
  return ["failed", "ambiguous", "undefined", "pending", "skipped"].find((status) => outcomes.some((o) => o.status === status)) ?? "passed";
}

async function runCases(registry, cases) {
  registry.running = true;
  const results = [];
  let aborted = false;
  for (const scenario of cases) {
    const result = { ...scenario, steps: [], hooks: [], status: "passed" }, world = {};
    let blocked = aborted;
    for (const hook of registry.before) {
      if (hook.options.tags && !scenario.tags.includes(hook.options.tags)) continue;
      const outcome = blocked ? { status: "skipped" } : await invoke(registry, hook, world, []);
      result.hooks.push(outcome);
      blocked ||= outcome.status !== "passed";
    }
    for (const step of scenario.steps) {
      let outcome = { status: "skipped" };
      if (!blocked) {
        const matches = registry.steps.map((definition) => ({ definition, args: definition.match(step.text) })).filter((m) => m.args !== null);
        if (matches.length === 0) outcome = { status: "undefined", error: `undefined step: ${step.text}` };
        else if (matches.length > 1) outcome = { status: "ambiguous", error: `ambiguous step: ${step.text} (${matches.length} definitions)` };
        else {
          const { definition, args } = matches[0];
          if (step.argument) args.push(step.argument.type === "table" ? new DataTable(step.argument.rows) : step.argument.content);
          outcome = await invoke(registry, definition, world, args);
        }
      }
      result.steps.push({ ...step, ...outcome });
      blocked ||= outcome.status !== "passed";
    }
    // After hooks still run after failures and skips, in reverse registration order.
    if (!aborted) {
      for (const hook of [...registry.after].reverse()) {
        if (!hook.options.tags || scenario.tags.includes(hook.options.tags)) result.hooks.push(await invoke(registry, hook, world, []));
      }
    }
    const outcomes = [...result.steps, ...result.hooks];
    result.status = overall(outcomes);
    aborted ||= outcomes.some((o) => o.timed_out);
    results.push(result);
  }
  return results;
}

async function execute(cases, files) {
  const registry = new Registry(), restore = installImports(registry, files);
  try {
    for (const file of files) {
      // Validate CommonJS before Node's automatic ESM detection can execute it.
      if (!/\.(?:ts|cts)$/.test(file)) {
        const source = fs.readFileSync(file, "utf8").replace(/^#![^\n]*/, "");
        vm.compileFunction(source, ["exports", "require", "module", "__filename", "__dirname"], { filename: file });
      }
      require(file);
    }
    return await runCases(registry, cases);
  } finally { restore(); }
}

module.exports = { execute, definitionApi };

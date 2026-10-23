#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("../lib/parser.cjs");
const { execute } = require("../lib/runtime.cjs");
const { version } = require("../package.json");
let completed = false;
process.on("exit", (status) => {
  if (!completed && status === 0) {
    process.exitCode = 2;
    console.error("medama: execution exited before the final report");
  }
});

const help = `Usage: medama [options] [features/**/*.feature.md ...]
  -r, --require GLOB     CommonJS .js/.cjs/.ts/.cts files, repeatable
      --tag TAG         require one @tag, repeatable (AND)
      --exclude-tag TAG exclude one @tag, repeatable
      --list            parse and list without loading steps
      --format NAME     progress (default) or json
  -v, --version
  -h, --help
`;

function options(argv) {
  const result = { require: [], include: [], exclude: [], paths: [], format: "progress" };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === "--help" || argument === "-h") return { done: help };
    if (argument === "--version" || argument === "-v") return { done: version + "\n" };
    if (argument === "--list") { result.list = true; continue; }
    if (argument === "--") { result.paths.push(...argv.slice(i + 1)); break; }
    const key = { "--require": "require", "-r": "require", "--tag": "include", "--exclude-tag": "exclude", "--format": "format", "--adapter": "adapter" }[argument];
    if (key) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${argument}`);
      if (key === "include" || key === "exclude") {
        if (!/^@[^\s`]+$/u.test(value)) throw new Error(`expected one @tag, got ${value}`);
      }
      if (Array.isArray(result[key])) result[key].push(value);
      else result[key] = value;
    } else if (argument.startsWith("-")) throw new Error(`unknown option ${argument}`);
    else result.paths.push(argument);
  }
  if (!["progress", "json"].includes(result.format)) throw new Error("format must be progress or json");
  if (result.adapter && result.adapter !== "javascript") throw new Error("only the medama JavaScript runner is supported");
  return result;
}

function expand(patterns, suffix, directories = false, strict = true) {
  const files = [];
  for (const pattern of patterns) {
    const directory = directories && fs.existsSync(pattern) && fs.statSync(pattern).isDirectory();
    const matched = fs.globSync(directory ? path.join(pattern, `**/*${suffix}`) : pattern).sort();
    if (strict && !matched.length) throw new Error(`no files matched ${JSON.stringify(pattern)}`);
    for (const file of matched) {
      if (!fs.statSync(file).isFile() || (suffix && !file.endsWith(suffix))) throw new Error(`expected a ${suffix} file: ${file}`);
      files.push(file);
    }
  }
  return [...new Set(files)].sort();
}

function writeOutput(text) {
  return new Promise((resolve, reject) => process.stdout.write(text, (error) => error ? reject(error) : resolve()));
}

async function report(results, format, documents) {
  const counts = {};
  for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1;
  if (format === "json") await writeOutput(JSON.stringify({ version, runtime: "medama-javascript", counts, scenarios: results, ...(documents ? { documents } : {}) }, null, 2) + "\n");
  else {
    const lines = [];
    for (const result of results) {
      lines.push(`${result.status.toUpperCase()} ${result.path}:${result.line} ${result.name}`);
      for (const step of [...result.steps, ...(result.hooks ?? [])]) if (step.error) lines.push(`  ${step.error}`);
    }
    lines.push(`${results.length} scenarios (${Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(", ")})`);
    await writeOutput(lines.join("\n") + "\n");
  }
}

async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (!(major === 22 && minor >= 19 || major === 23 && minor >= 6 || major >= 24)) {
    throw new Error("medama requires Node.js ^22.19.0 or >=23.6.0 (native TypeScript and synchronous module hooks)");
  }
  const opt = options(process.argv.slice(2));
  if (opt.done) { await writeOutput(opt.done); return 0; }
  const files = expand(opt.paths.length ? opt.paths : ["features"], ".feature.md", true);
  const parsed = files.map((file) => parse(fs.readFileSync(file, "utf8"), file));
  const cases = parsed.flatMap((document) => document.cases).filter((scenario) =>
    opt.include.every((tag) => scenario.tags.includes(tag)) && !opt.exclude.some((tag) => scenario.tags.includes(tag)));
  if (!cases.length) throw new Error("no scenarios selected");
  if (opt.list) { await report(cases.map((scenario) => ({ ...scenario, status: "listed" })), opt.format,
    parsed.map(({ source, gherkinDocument }) => ({ source, gherkinDocument }))); return 0; }
  const defaults = ["features/support/**/*.{js,cjs,ts,cts,mjs,mts,tsx}", "features/step_definitions/**/*.{js,cjs,ts,cts,mjs,mts,tsx}"];
  let required = expand(opt.require.length ? opt.require : defaults, "", false, opt.require.length > 0);
  if (!opt.require.length) required = required.filter((file) => !/\.d\.[cm]?ts$/.test(file));
  if (!required.length) throw new Error("no CommonJS step files (.js, .cjs, .ts or .cts)");
  for (const file of required) {
    if (!/\.(?:js|cjs|ts|cts)$/.test(file) || /\.d\.[cm]?ts$/.test(file)) {
      throw new Error(`step files must be executable CommonJS .js, .cjs, .ts or .cts; unsupported file: ${file}`);
    }
  }
  if (!opt.require.length) {
    const sources = new Map();
    for (const file of required) {
      const stem = file.replace(/\.(?:js|cjs|ts|cts)$/, "");
      if (sources.has(stem)) throw new Error(`multiple step sources: ${sources.get(stem)} and ${file}; select one with --require`);
      sources.set(stem, file);
    }
  }
  const previous = process.stdout.write;
  let results;
  try {
    process.stdout.write = process.stderr.write.bind(process.stderr);
    results = await execute(cases, required.map((file) => path.resolve(file)));
  } finally { process.stdout.write = previous; }
  await report(results, opt.format);
  return results.some((result) => !["passed", "skipped"].includes(result.status)) ? 1 : 0;
}

main().then((status) => { completed = true; process.exit(status); }).catch((error) => { completed = true; console.error(`medama: ${error?.stack ?? String(error)}`); process.exit(2); });

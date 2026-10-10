"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const cli = path.resolve(__dirname, "../bin/medama.cjs");
const markdown = "# Feature: TypeScript\n## Scenario: typed value\n- Then value 7\n";
const registration = 'const { Given, When, Then, Before, After }: typeof import("@yasuhito/medama") = require("@yasuhito/medama");\n';

function trial(files, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "medama-typescript-"));
  try {
    fs.writeFileSync(path.join(directory, "sample.feature.md"), options.markdown ?? markdown);
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(options.unspecifiedType ? {} : { type: options.type ?? "commonjs" }));
    for (const [name, source] of Object.entries(files)) {
      const file = path.join(directory, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, source);
    }
    for (const [name, target] of Object.entries(options.links ?? {})) {
      fs.symlinkSync(target, path.join(directory, name));
    }
    const requires = options.defaults ? [] : (options.require ?? [Object.keys(files)[0]]).flatMap((file) => ["--require", file]);
    const result = spawnSync(process.execPath, [...(options.nodeOptions ?? []), cli, "--format", "json", ...requires, "sample.feature.md"], { cwd: directory, encoding: "utf8", timeout: 10000 });
    if (result.error) throw result.error;
    return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test("direct CommonJS TypeScript step executes without a build", () => {
  const result = trial({ "steps.ts": registration + 'Then("value {int}", function (value: number): void { require("node:assert/strict").equal(value, 7); });' });
  assert.deepEqual(result.report?.counts ?? { exit: result.status, error: result.stderr }, { passed: 1 });
});

test("CommonJS .cts step executes inside an ESM package", () => {
  const result = trial({ "steps.cts": registration + 'Then("value {int}", function (value: number): void { require("node:assert/strict").equal(value, 7); });' }, { type: "module" });
  assert.deepEqual(result.report?.counts, { passed: 1 });
});

test("a type-only import is erased without resolving its module", () => {
  const result = trial({ "steps.ts": 'import type { Missing } from "./absent.ts";\n' + registration + 'Then("value {int}", function (value: number): void { require("node:assert/strict").equal(value, 7); });' });
  assert.deepEqual(result.report?.counts, { passed: 1 });
});

test("a relative TypeScript helper runs directly", () => {
  const result = trial({
    "steps.ts": registration + 'const twice: (value: number) => number = require("./helper.ts");\nThen("value {int}", function (value: number): void { require("node:assert/strict").equal(twice(value), 14); });',
    "helper.ts": "module.exports = (value: number): number => value * 2;",
  });
  assert.deepEqual(result.report?.counts, { passed: 1 });
});

test("typed this and Promise hooks share scenario state", () => {
  const result = trial({ "steps.ts": registration + 'interface State { value: number }\nBefore(async function (this: State): Promise<void> { this.value = await Promise.resolve(7); });\nThen("value {int}", function (this: State, value: number): void { require("node:assert/strict").equal(this.value, value); });\nAfter(async function (this: State): Promise<void> { console.log(await Promise.resolve(this.value)); });' });
  assert.deepEqual(result.report?.counts, { passed: 1 });
});

test("typed After hooks still run in reverse registration order", () => {
  const result = trial({ "steps.ts": registration + 'After(function (): void { console.log("first"); });\nAfter(function (): void { console.log("second"); });\nThen("value {int}", function (value: number): void {});' });
  assert.equal(result.stderr, "second\nfirst\n");
});

test("typed After cleanup still runs after a failing step", () => {
  const result = trial({ "steps.ts": registration + 'After(function (): void { console.log("cleanup"); });\nThen("value {int}", function (value: number): never { throw new Error("failed"); });' });
  assert.equal(result.stderr, "cleanup\n");
});

test("typed step failure reports the original TypeScript line", () => {
  const result = trial({ "steps.ts": registration + 'interface State { value: number }\nThen("value {int}", function (value: number): never {\n  throw new Error("original line");\n});' });
  assert.match(result.report.scenarios[0].steps[0].error, /steps\.ts:4:/);
});

test("legacy Cucumber import remains medama-owned in a TypeScript step", () => {
  const result = trial({
    "steps.ts": 'const { Then }: typeof import("@cucumber/cucumber") = require("@cucumber/cucumber");\nThen("value {int}", function (value: number): void { require("node:assert/strict").equal(value, 7); });',
    "node_modules/@cucumber/cucumber/index.js": 'throw new Error("external Cucumber was loaded");',
  });
  assert.deepEqual(result.report?.counts, { passed: 1 });
});

test("default discovery executes TypeScript support and steps", () => {
  const result = trial({
    "features/support/hooks.ts": registration + 'Before(function (): void { console.log("support loaded"); });',
    "features/step_definitions/steps.ts": registration + 'Then("value {int}", function (value: number): void {});',
    "features/step_definitions/state.d.ts": "export interface State { value: number }",
  }, { defaults: true });
  assert.deepEqual(result.report?.counts, { passed: 1 });
});

test("default discovery refuses generated JavaScript beside TypeScript", () => {
  const result = trial({
    "features/step_definitions/steps.ts": registration + 'Then("value {int}", function (value: number): void {});',
    "features/step_definitions/steps.js": 'throw new Error("must not execute");',
  }, { defaults: true });
  assert.match(result.stderr, /multiple step sources:.*select one with --require/);
});

test("explicit declaration files are rejected as non-executable", () => {
  assert.match(trial({ "steps.d.ts": "export interface State { value: number }" }).stderr, /unsupported file: steps\.d\.ts/);
});

for (const extension of ["mts", "tsx", "mjs"]) {
  test(`unsupported .${extension} step is an explicit setup error`, () => {
    assert.match(trial({ [`steps.${extension}`]: 'throw new Error("must not execute");' }).stderr, /unsupported file:/);
  });
  test(`default discovery does not silently ignore .${extension} steps`, () => {
    assert.match(trial({ [`features/step_definitions/steps.${extension}`]: 'throw new Error("must not execute");' }, { defaults: true }).stderr, /unsupported file:/);
  });
}

test("a TypeScript enum is an explicit setup error", () => {
  assert.match(trial({ "steps.ts": registration + 'enum Value { Seven = 7 }\nThen("value {int}", function (value: number): void {});' }).stderr, /ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/);
});

test("an ESM .ts step is rejected before its side effects", () => {
  const result = trial({ "steps.ts": 'console.log("MUST_NOT_EXECUTE");\nexport const value: number = 7;' }, { type: "module" });
  assert.match(result.stderr, /^medama: Error: TypeScript step files must be CommonJS; ESM is unsupported:/);
});

test("ESM syntax in an unspecified package is rejected before side effects", () => {
  const result = trial({ "steps.ts": 'console.log("MUST_NOT_EXECUTE");\nexport const value: number = 7;' }, { unspecifiedType: true });
  assert.equal(result.stderr.includes("\nMUST_NOT_EXECUTE\n"), false);
});

test("disabled native type stripping is explained", () => {
  const result = trial({ "steps.ts": registration + 'Then("value {int}", function (value: number): void {});' }, { nodeOptions: ["--no-experimental-strip-types"] });
  assert.match(result.stderr, /TypeScript steps require native type stripping/);
});

test("native TypeScript execution does not emit stripTypeScriptTypes API warnings", () => {
  const result = trial({ "steps.ts": registration + 'Then("value {int}", function (value: number): void {});' });
  assert.equal(result.stderr, "");
});

test("TypeScript callback async is rejected before the callback body", () => {
  const result = trial({ "steps.ts": registration + 'Then("value {int}", function (value: number, done: () => void): void { console.log("MUST_NOT_EXECUTE"); done(); });' });
  assert.match(result.report.scenarios[0].steps[0].error, /unsupported function arity/);
});

test("an ESM TypeScript step reached through a symlink is rejected before execution", () => {
  const result = trial({
    "target/package.json": '{"type":"module"}',
    "target/steps.ts": 'import { createRequire } from "node:module";\nconsole.log("MUST_NOT_EXECUTE");\ncreateRequire(import.meta.url)("@yasuhito/medama").Then("value {int}", function (value: number): void {});',
  }, { require: ["linked.ts"], links: { "linked.ts": "target/steps.ts" } });
  assert.match(result.stderr, /^medama: Error: TypeScript step files must be CommonJS; ESM is unsupported:/);
});

const esmRegistration = 'import { createRequire } from "node:module";\nconsole.error("MUST_NOT_EXECUTE");\nconst { Then } = createRequire(import.meta.url)("@yasuhito/medama");\nThen("value {int}", function (value: number): void {});';

for (const entry of ["steps.ts", "steps.cjs"]) {
  test(`a relative .mts from ${entry} is rejected before side effects or registration`, () => {
    const result = trial({ [entry]: 'require("./registrations.mts");', "registrations.mts": esmRegistration });
    assert.deepEqual({ exit: result.status, executed: result.stderr.includes("MUST_NOT_EXECUTE") }, { exit: 2, executed: false });
  });
}

test("a relative .ts in an ESM package is rejected before side effects or registration", () => {
  const result = trial({
    "steps.ts": 'require("./esm/registrations.ts");',
    "esm/package.json": '{"type":"module"}',
    "esm/registrations.ts": esmRegistration,
  });
  assert.deepEqual({ exit: result.status, executed: result.stderr.includes("MUST_NOT_EXECUTE") }, { exit: 2, executed: false });
});

test("a relative ESM .ts in an unspecified package is rejected before side effects", () => {
  const result = trial({ "steps.ts": 'require("./registrations.ts");', "registrations.ts": esmRegistration }, { unspecifiedType: true });
  assert.deepEqual({ exit: result.status, executed: result.stderr.includes("MUST_NOT_EXECUTE") }, { exit: 2, executed: false });
});

test("an ESM TypeScript dependency through a JavaScript helper is rejected", () => {
  const result = trial({
    "steps.ts": 'require("./helper.cjs");',
    "helper.cjs": 'require("./registrations.mts");',
    "registrations.mts": esmRegistration,
  });
  assert.deepEqual({ exit: result.status, executed: result.stderr.includes("MUST_NOT_EXECUTE") }, { exit: 2, executed: false });
});

test("a relative ESM TypeScript dependency through a symlink is rejected", () => {
  const result = trial({
    "steps.ts": 'require("./linked.ts");',
    "esm/package.json": '{"type":"module"}',
    "esm/registrations.ts": esmRegistration,
  }, { links: { "linked.ts": "esm/registrations.ts" } });
  assert.deepEqual({ exit: result.status, executed: result.stderr.includes("MUST_NOT_EXECUTE") }, { exit: 2, executed: false });
});

test("a TypeScript step still loads a legitimate ESM JavaScript dependency", () => {
  const result = trial({
    "steps.ts": registration + 'const helper = require("./helper.mjs");\nThen("value {int}", function (value: number): void { require("node:assert/strict").equal(helper.value, value); });',
    "helper.mjs": 'export const value = 7;',
  });
  assert.deepEqual(result.report?.counts ?? { exit: result.status, error: result.stderr }, { passed: 1 });
});

test("a JavaScript step still loads an ESM JavaScript package dependency", () => {
  const result = trial({
    "steps.cjs": 'const { Then } = require("@yasuhito/medama");\nconst helper = require("./esm/helper.js");\nThen("value {int}", function (value) { require("node:assert/strict").equal(helper.value, value); });',
    "esm/package.json": '{"type":"module"}',
    "esm/helper.js": 'export const value = 7;',
  });
  assert.deepEqual(result.report?.counts ?? { exit: result.status, error: result.stderr }, { passed: 1 });
});

test("a relative .cts helper still loads inside an ESM package", () => {
  const result = trial({
    "steps.cts": registration + 'const twice = require("./helper.cts");\nThen("value {int}", function (value: number): void { require("node:assert/strict").equal(twice(value), 14); });',
    "helper.cts": 'module.exports = (value: number): number => value * 2;',
  }, { type: "module" });
  assert.deepEqual(result.report?.counts ?? { exit: result.status, error: result.stderr }, { passed: 1 });
});

test("a legacy JavaScript step still loads a CommonJS TypeScript helper", () => {
  const result = trial({
    "steps.cjs": 'const { Then } = require("@yasuhito/medama");\nconst helper = require("./helper.ts");\nThen("value {int}", function (value) { require("node:assert/strict").equal(helper.value, value); });',
    "helper.ts": 'const value: number = 7;\nmodule.exports = { value };',
  });
  assert.deepEqual(result.report?.counts ?? { exit: result.status, error: result.stderr }, { passed: 1 });
});

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function typecheck(fixture) {
  const result = spawnSync(process.execPath, [
    path.join(path.dirname(require.resolve("typescript/package.json")), "bin/tsc"), "--ignoreConfig", "--noEmit",
    "--strict", "--module", "NodeNext", "--target", "ES2022", "--types", "node",
    "--erasableSyntaxOnly", "--verbatimModuleSyntax",
    path.join(__dirname, "typecheck", fixture),
  ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", timeout: 30000 });
  if (result.error) throw result.error;
  return result;
}

test("Node can load the named exports advertised by the declarations", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e",
    'import { Given, When, Then, Before, After, setDefaultTimeout } from "@yasuhito/medama"; console.log([Given, When, Then, Before, After, setDefaultTimeout].every((value) => typeof value === "function"));',
  ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", timeout: 10000 });
  if (result.error) throw result.error;
  assert.deepEqual({ status: result.status, stdout: result.stdout }, { status: 0, stdout: "true\n" });
});

test("declarations accept typed steps, hooks and DataTable", () => {
  const result = typecheck("valid.ts");
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("declarations reject unsupported options, callback hooks and invalid state", () => {
  const result = typecheck("invalid.ts");
  assert.deepEqual({ status: result.status, diagnostics: [...result.stdout.matchAll(/error (TS\d+):/g)].map((match) => match[1]) },
    { status: 1, diagnostics: ["TS2353", "TS2345", "TS2322"] });
});

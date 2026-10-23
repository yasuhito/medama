"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const cli = process.env.MEDAMA_TEST_CLI ?? path.resolve(__dirname, "../bin/medama.cjs");
const first = "@f\n# Feature: f\n@s\n## Scenario Outline: <a>\n- Then okay\n@x\n### Examples: first\n| a |\n| --- |\n| one |\n";
const second = "### Examples: second\n| a |\n| --- |\n| two |\n";
function run(source, options = [], registration) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "medama-table-boundary-"));
  try {
    fs.writeFileSync(path.join(directory, "sample.feature.md"), source);
    if (registration !== undefined) fs.writeFileSync(path.join(directory, "steps.cjs"), registration);
    const mode = registration === undefined ? ["--list"] : ["--require", "steps.cjs"];
    const result = spawnSync(process.execPath, [cli, ...mode, "--format", "json", ...options, "sample.feature.md"], { cwd: directory, encoding: "utf8", timeout: 10000 });
    if (result.error) throw result.error;
    return { status: result.status, stderr: result.stderr, report: result.stdout ? JSON.parse(result.stdout) : null };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
const examples = (result) => result.report.documents[0].gherkinDocument.feature.children[0].scenario.examples;

test("tag immediately after an Examples table belongs to the next Examples", () => {
  const result = run(first + "@y\n" + second);
  assert.deepEqual({ cases: result.report.scenarios.map((c) => [c.name, c.line, c.tags]), descriptions: examples(result).map((e) => e.description) },
    { cases: [["one", 10, ["@f", "@s", "@x"]], ["two", 15, ["@f", "@s", "@y"]]], descriptions: ["", ""] });
});
test("backticked tags after consecutive Examples tables retain locations and inheritance", () => {
  const result = run(first + "`@y`\n" + second + "`@z`\n### Examples: third\n| a |\n| --- |\n| three |\n");
  assert.deepEqual({ cases: result.report.scenarios.map((c) => [c.name, c.tags]), locations: examples(result).slice(1).map((e) => e.tags[0].location) },
    { cases: [["one", ["@f", "@s", "@x"]], ["two", ["@f", "@s", "@y"]], ["three", ["@f", "@s", "@z"]]], locations: [{ line: 11, column: 2 }, { line: 16, column: 2 }] });
});
test("tag selection includes the case tagged immediately after a table", () => {
  const result = run(first + "@y\n" + second, ["--tag", "@y"]);
  assert.deepEqual({ status: result.status, names: result.report?.scenarios.map((c) => c.name) }, { status: 0, names: ["two"] });
});
test("tag immediately after a DataTable belongs to the next Scenario", () => {
  const result = run("@f\n# Feature: data\n## Scenario: first\n- Then table\n| key |\n| --- |\n| value |\n@next\n## Scenario: second\n- Then okay\n");
  assert.deepEqual(result.report.scenarios.map((c) => [c.name, c.tags, c.steps[0].argument ?? null]),
    [["first", ["@f"], { type: "table", rows: [["key"], ["value"]] }], ["second", ["@f", "@next"], null]]);
});
test("Examples table tail retains prose while passing its following tag onward", () => {
  const result = run(first + "Explanation after the table.\n@y\n" + second);
  assert.deepEqual({ descriptions: examples(result).map((e) => e.description), tags: result.report.scenarios.map((c) => c.tags) },
    { descriptions: ["Explanation after the table.", ""], tags: [["@f", "@s", "@x"], ["@f", "@s", "@y"]] });
});
test("a descriptive table ends before a tag for the next Scenario", () => {
  const result = run("@f\n# Feature: prose\n## Scenario: first\n- Then okay\n\nNotes.\n\n| note |\n| --- |\n| @literal |\n@next\n## Scenario: second\n- Then okay\n");
  const scenarios = result.report?.documents[0].gherkinDocument.feature.children.map((c) => c.scenario);
  assert.deepEqual({ status: result.status, descriptions: scenarios?.map((s) => s.description), tags: scenarios?.map((s) => s.tags.map((t) => t.name)) },
    { status: 0, descriptions: ["Notes.\n\n| note |\n| --- |\n| @literal |", ""], tags: [[], ["@next"]] });
});
test("an additional explanatory table stays prose and ends before the next Examples tag", () => {
  const result = run(first + "\n| explanation |\n| --- |\n| @literal | extra |\n@y\n" + second);
  assert.deepEqual({ descriptions: examples(result).map((e) => e.description), cases: result.report.scenarios.map((c) => [c.name, c.tags]) },
    { descriptions: ["| explanation |\n| --- |\n| @literal | extra |", ""], cases: [["one", ["@f", "@s", "@x"]], ["two", ["@f", "@s", "@y"]]] });
});
test("a trailing tag after a table without a following heading is an error", () => {
  const result = run(first + "@orphan\n");
  assert.deepEqual({ status: result.status, tagError: result.stderr.includes("tags must precede") }, { status: 2, tagError: true });
});
test("a tag inside a descriptive fenced table stays opaque", () => {
  const result = run("# Feature: code\n## Scenario: value\n```markdown\n| a |\n| --- |\n| one |\n@literal\n```\n- Then okay\n");
  assert.deepEqual(result.report.scenarios.map((c) => [c.tags, c.description]), [[[], "```markdown\n| a |\n| --- |\n| one |\n@literal\n```"]]);
});
test("the removed Examples compatibility option is an unknown option", () => {
  const result = run(first, ["--legacy-examples"]);
  assert.deepEqual({ status: result.status, unknownOption: result.stderr.includes("unknown option --legacy-examples") }, { status: 2, unknownOption: true });
});
for (const tag of ["@y", "`@y`"]) {
  for (const failure of ["Before", "After"]) {
    test(`tagged hook ${failure} failure after a table runs Before/After for ${tag}`, () => {
      const marker = `TAGGED_${failure.toUpperCase()}_MUST_RUN`;
      const registration = `const {Then,Before,After}=require('@yasuhito/medama');
        Then('okay',function(){});
        Before({tags:'@y'},function(){this.beforeRan=true;${failure === "Before" ? `throw new Error('${marker}');` : ""}});
        After({tags:'@y'},function(){if(!this.beforeRan)throw new Error('BEFORE_WAS_NOT_RUN');${failure === "After" ? `throw new Error('${marker}');` : ""}});`;
      const summarize = (result) => ({ exit: result.status, counts: result.report.counts,
        hooks: result.report.scenarios.map((c) => c.hooks.map((h) => ({ status: h.status, expectedFailure: Boolean(h.error?.includes(marker)) }))) });
      const expected = { exit: 1, counts: { passed: 1, failed: 1 }, hooks: [[], [
        { status: failure === "Before" ? "failed" : "passed", expectedFailure: failure === "Before" },
        { status: failure === "After" ? "failed" : "passed", expectedFailure: failure === "After" }
      ]] };
      assert.deepEqual([summarize(run(first + tag + "\n" + second, [], registration)), summarize(run(first + "\n" + tag + "\n" + second, [], registration))], [expected, expected]);
    });
  }
}

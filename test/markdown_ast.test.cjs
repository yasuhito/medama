"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");
const http = require("node:http");
const cli = process.env.MEDAMA_TEST_CLI ?? path.resolve(__dirname, "../bin/medama.cjs");
const base = "# Feature: AST\n## Scenario: value\n";

function fixture(source, steps) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "medama-ast-"));
  fs.writeFileSync(path.join(directory, "probe.feature.md"), source);
  fs.writeFileSync(path.join(directory, "steps.cjs"), `const assert=require('node:assert/strict');const {Given,When,Then}=require('@yasuhito/medama');\n${steps}`);
  return directory;
}
function run(source, options = ["--list"], steps = "Then('okay',function(){});") {
  const directory = fixture(source, steps);
  try {
    const result = spawnSync(process.execPath, [cli, "--format", "json", "--require", "steps.cjs", ...options, "probe.feature.md"], { cwd: directory, encoding: "utf8", timeout: 10000 });
    if (result.error) throw result.error;
    return { status: result.status, stderr: result.stderr, report: result.stdout ? JSON.parse(result.stdout) : null };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
const doc = (result) => result.report.documents[0].gherkinDocument;
const scenario = (result) => doc(result).feature.children.find((child) => child.scenario).scenario;

for (const entry of require("../spec/markdown_ast_cases.json")) {
  test(`AST corpus: ${entry.name}`, () => {
    const result = run(entry.source, ["--list", ...(entry.options ?? [])]);
    if (entry.error) assert.deepEqual({ status: result.status, message: result.stderr.includes(entry.error) }, { status: 2, message: true });
    else {
      const cases = result.report?.scenarios ?? [];
      const selections = { names: cases.map((c) => c.name), texts: cases.map((c) => c.steps.map((s) => s.text)),
        descriptions: cases.map((c) => c.description), arguments: cases.map((c) => c.steps.map((s) => s.argument ?? null)) };
      const key = Object.keys(entry.expected)[0];
      assert.deepEqual(selections[key], entry.expected[key]);
    }
  });
}

test("Source retains the exact CRLF Markdown", () => {
  const source = "# Feature: source\r\n\r\n## Scenario: value\r\n\r\n![picture](missing.png)\r\n\r\n- Then okay\r\n";
  assert.equal(run(source).report.documents[0].source.data, source);
});
test("Source identifies Markdown without a Cucumber runtime", () => assert.equal(run(base + "- Then okay\n").report.documents[0].source.mediaType, "text/x.cucumber.gherkin+markdown"));
test("Feature, Background and Scenario descriptions have separate owners", () => {
  const result = run("# Feature: owners\n\nFeature prose.\n\n## Background: start\n\nBackground prose.\n\n- Given okay\n\n## Scenario: value\n\nScenario prose.\n\n- Then okay\n");
  const feature = doc(result).feature;
  assert.deepEqual([feature.description, feature.children[0].background.description, feature.children[1].scenario.description], ["Feature prose.", "Background prose.", "Scenario prose."]);
});
test("ATX and Setext locations point at original keyword columns", () => {
  const result = run("  # Feature: positions\n\nScenario: value\n---\n\n + Then okay\n");
  const feature = doc(result).feature, value = feature.children[0].scenario;
  assert.deepEqual([feature.location, value.location, value.steps[0].location], [{ line: 1, column: 5 }, { line: 3, column: 1 }, { line: 6, column: 4 }]);
});
test("tag locations and inherited selection retain source spelling", () => {
  const result = run("`@feature`\n# Feature: tags\n`@scenario`\n## Scenario Outline: value <n>\n- Then <n>\n`@example`\n### Examples:\n| n |\n| --- |\n| one |\n");
  const feature = doc(result).feature, value = feature.children[0].scenario;
  assert.deepEqual([feature.tags[0].location, value.tags[0].location, value.examples[0].tags[0].location, result.report.scenarios[0].tags], [{line:1,column:2},{line:3,column:2},{line:6,column:2},["@feature","@scenario","@example"]]);
});
test("AST node IDs are unique across tags, rows and steps", () => {
  const value = doc(run("`@f`\n# Feature: ids\n## Background: prepare\n- Given okay\n## Scenario Outline: value <n>\n- Then table\n| a |\n| --- |\n| b |\n### Examples:\n| n |\n| --- |\n| one |\n"));
  const ids = [];
  function collect(node) { if (!node || typeof node !== "object") return; if (node.id) ids.push(node.id); for (const child of Object.values(node)) collect(child); }
  collect(value);
  assert.equal(new Set(ids).size, ids.length);
});
test("keyword types belong to executable steps only", () => {
  const result = run(base + "- Given first\n- When second\n- Then third\n- And fourth\n- But fifth\n");
  assert.deepEqual(scenario(result).steps.map((step) => [step.keyword, step.keywordType]), [["Given ","Context"],["When ","Action"],["Then ","Outcome"],["And ","Conjunction"],["But ","Conjunction"]]);
});

for (let indent = 0; indent <= 8; indent++) {
  const pad = " ".repeat(indent);
  test(`DataTable ownership is independent of ${indent}-space indentation`, () => assert.deepEqual(run(base + `- Then table\n${pad}| key |\n${pad}| --- |\n${pad}| value |\n`, [], "Then('table',function(table){assert.deepEqual(table.raw(),[['key'],['value']]);});").report.counts, {passed:1}));
  test(`Examples ownership is independent of ${indent}-space indentation`, () => assert.deepEqual(run(`# Feature: table\n## Scenario Outline: <n>\n- Then okay\n### Examples:\n\n${pad}| n |\n${pad}| --- |\n${pad}| one |\n`).report.scenarios.map((c) => c.name), ["one"]));
}
test("blank lines keep a DataTable attached", () => assert.deepEqual(run(base + "- Then table\n\n| key |\n| --- |\n| value |\n", [], "Then('table',function(table){assert.equal(table.rows()[0][0],'value');});").report.counts, {passed:1}));
test("only the first immediate table becomes the step argument", () => assert.deepEqual(run(base + "- Then table\n\n| key |\n| --- |\n| first |\n\n| key |\n| --- |\n| second |\n", [], "Then('table',function(table){assert.equal(table.rows()[0][0],'first');});").report.counts, {passed:1}));
test("table cell locations exclude indentation and padding", () => assert.deepEqual(scenario(run(base + "- Then table\n  | key | value |\n  | --- | --- |\n  | a | b |\n")).steps[0].dataTable.rows[2-1].cells.map((cell) => cell.location), [{line:6,column:5},{line:6,column:9}]));
test("Markdown tables without outer pipes work in executable positions", () => assert.deepEqual(run(base + "- Then table\n\na | b\n--- | ---\none | two\n", [], "Then('table',function(table){assert.deepEqual(table.rows(),[['one','two']]);});").report.counts, {passed:1}));
test("a dash in a body row is data rather than another delimiter", () => assert.deepEqual(run(base + "- Then table\n| key |\n| --- |\n| - |\n", [], "Then('table',function(table){assert.equal(table.rows()[0][0],'-');});").report?.counts, {passed:1}));
test("missing DataTable delimiter is an error", () => assert.deepEqual(run(base + "- Then table\n| key |\n| value |\n").status, 2));
test("Examples reject inconsistent row widths", () => {
  const result = run("# Feature: bad\n## Scenario Outline: <n>\n- Then okay\n### Examples:\n| n |\n| --- |\n| one | two |\n");
  assert.deepEqual({ status: result.status, widthError: result.stderr.includes("inconsistent table width") }, { status: 2, widthError: true });
});
test("Examples do not treat an empty table as a successful case", () => {
  const result = run("# Feature: bad\n## Scenario Outline: <n>\n- Then okay\n### Examples:\n| n |\n| --- |\n");
  assert.deepEqual({ status: result.status, emptyError: result.stderr.includes("Examples requires a header and at least one row") }, { status: 2, emptyError: true });
});
test("a delimiter cannot masquerade as document comments", () => assert.deepEqual(doc(run(base + "\n| description |\n| --- |\n| text |\n\n- Then okay\n")).comments, []));

for (const delimiter of ["```", "````", "~~~~~"]) {
  test(`CommonMark ${delimiter} doc strings are opaque arguments`, () => assert.deepEqual(run(base + `- Then code\n\n${delimiter}text\n- Then fake\n![media](missing.png)\n${delimiter}\n`, [], "Then('code',function(body){assert.equal(body,'- Then fake\\n![media](missing.png)');});").report.counts, {passed:1}));
}
test("a prose heading separates a Mermaid diagram from a step", () => assert.deepEqual(run(base + "- Then okay\n\n### Flow\n```mermaid\nflowchart LR\n A --> B\n```\n", [], "Then('okay',function(){assert.equal(arguments.length,0);});").report.counts, {passed:1}));
test("step doc string location, delimiter and relative indentation are retained", () => assert.deepEqual(scenario(run(base + "- Then code\n  ````javascript extra\n  const value = 2;\n    nested\n  ````\n")).steps[0].docString, {location:{line:4,column:3},delimiter:"````",content:"const value = 2;\n  nested",mediaType:"javascript extra"}));
test("an unclosed executable doc string is a parse error", () => assert.equal(run(base + "- Then code\n```text\nbody\n").status, 2));
test("a bare opening fence at EOF is not its own closing fence", () => assert.equal(run(base + "- Then code\n```").status, 2));
test("a second fence is descriptive rather than a second argument", () => assert.deepEqual(run(base + "- Then code\n```text\nfirst\n```\n\n```text\nsecond\n```\n", [], "Then('code',function(body){assert.equal(body,'first');});").report.counts, {passed:1}));
test("blank-separated indented code does not become an argument or step", () => assert.deepEqual(run(base + "- Then okay\n\n        - Then fake\n\n- Then okay\n", [], "Then('okay',function(){assert.equal(arguments.length,0);});").report.counts, {passed:1}));
test("loose-list explanatory paragraphs stay in description", () => assert.equal(scenario(run(base + "- Then okay\n\n  Explanation within the item.\n\n- Then okay\n")).description, "  Explanation within the item."));
test("reference-style media descriptions retain their definitions", () => assert.equal(scenario(run(base + "\n![image][shot]\n\n[video][clip]\n\n[shot]: assets/result.png\n[clip]: assets/demo.mp4\n\n- Then okay\n")).description, "![image][shot]\n\n[video][clip]\n\n[shot]: assets/result.png\n[clip]: assets/demo.mp4"));
test("HTML media contents cannot introduce executable steps", () => assert.deepEqual(run(base + "\n<video controls>\n- Then fake\n## Scenario: fake\n</video>\n\n- Then okay\n", [], "Then('okay',function(){assert.equal(arguments.length,0);});").report.counts, {passed:1}));

test("media references and HTML never fetch or execute and preserve step results", async () => {
  let requests = 0;
  const server = http.createServer((request, response) => { requests++; response.end("unexpected"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/media`;
  const media = `![image](${url}.png)\n\n![GIF](${url}.gif)\n\n[video](${url}.mp4)\n\n${url}\n\n<video controls poster="${url}.png"><source src="${url}.mp4"></video>\n\n<script>fetch('${url}'); throw new Error('MUST_NOT_EXECUTE');</script>`;
  const directory = fixture(base + `\n${media}\n\n- Then okay\n`, "Then('okay',function(){assert.equal(arguments.length,0);});");
  try {
    const result = await new Promise((resolve, reject) => {
      const process = spawn(global.process.execPath, [cli,"--require","steps.cjs","--format","json","probe.feature.md"], {cwd:directory});
      let stdout="",stderr="";
      const timer=setTimeout(()=>{process.kill();reject(new Error("CLI timeout"));},10000);
      process.stdout.on("data",(chunk)=>stdout+=chunk);process.stderr.on("data",(chunk)=>stderr+=chunk);
      process.on("error",reject);process.on("close",(status)=>{clearTimeout(timer);resolve({status,stdout,stderr});});
    });
    const report=JSON.parse(result.stdout);
    assert.deepEqual({status:result.status,counts:report.counts,requests,description:report.scenarios[0].description}, {status:0,counts:{passed:1},requests:0,description:media});
  } finally { server.close(); fs.rmSync(directory,{recursive:true,force:true}); }
});

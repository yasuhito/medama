"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const cli = path.resolve(__dirname, "../bin/medama.cjs");
const base = "# Feature: probe\n## Scenario: okay\n- Then okay\n";

function trial(markdown, steps = "Then('okay', function() {});", options = [], config = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "medama-npm-test-"));
  try {
    fs.writeFileSync(path.join(directory, "sample.feature.md"), markdown);
    fs.writeFileSync(path.join(directory, "package.json"), '{"type":"commonjs"}');
    fs.writeFileSync(path.join(directory, "steps.cjs"), `const assert=require('node:assert/strict'); const {Given,When,Then,Before,After,setDefaultTimeout}=require(${JSON.stringify(config.import ?? "@yasuhito/medama")});\n${steps}`);
    if (config.trap) {
      const packageDirectory = path.join(directory, "node_modules/@cucumber/cucumber");
      fs.mkdirSync(packageDirectory, { recursive: true });
      fs.writeFileSync(path.join(packageDirectory, "index.js"), "throw new Error('EXTERNAL_CUCUMBER_LOADED');");
    }
    const result = spawnSync(process.execPath, [cli, "--format", "json", "--require", "steps.cjs", ...options, "sample.feature.md"], { cwd: directory, encoding: "utf8", timeout: 10000 });
    if (result.error) throw result.error;
    return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test("native API works without any node_modules", () => assert.deepEqual(trial(base).report.counts, { passed: 1 }));
test("legacy import bypasses an external package trap", () => assert.deepEqual(trial(base, undefined, [], { import: "@cucumber/cucumber", trap: true }).report.counts, { passed: 1 }));
test("promise steps await their result", () => assert.deepEqual(trial(base, "Then('okay', async function(){ await Promise.resolve(); });").report.counts, { passed: 1 }));
test("promise rejection fails", () => assert.equal(trial(base, "Then('okay', async function(){ throw Error('rejected'); });").status, 1));
test("failed assertion fails", () => assert.deepEqual(trial(base, "Then('okay', function(){ assert.equal(1,2); });").report.counts, { failed: 1 }));
test("undefined step does not pass", () => assert.deepEqual(trial(base, "").report.counts, { undefined: 1 }));
test("ambiguous step does not pass", () => assert.deepEqual(trial(base, "Then('okay', function(){}); Then(/^okay$/, function(){});").report.counts, { ambiguous: 1 }));
test("failure skips remaining steps", () => assert.equal(trial(base + "- Then bad\n", "Then('okay', function(){throw Error('failed');}); Then('bad', function(){throw Error('must not run');});").report.scenarios[0].steps[1].status, "skipped"));
test("Before failure still runs After in reverse order", () => assert.equal(trial(base, "Before(function(){throw Error('before');}); After(function(){console.log('first');}); After(function(){console.log('second');}); Then('okay',function(){});").stderr, "second\nfirst\n"));
test("After failure changes scenario status", () => assert.deepEqual(trial(base, "Then('okay',function(){}); After(function(){throw Error('cleanup');});").report.counts, { failed: 1 }));
test("later After cleanup runs after another After fails", () => assert.equal(trial(base, "Then('okay',function(){}); After(function(){console.log('cleanup');}); After(function(){throw Error('failed');});").stderr, "cleanup\n"));
test("Before pending skips step", () => assert.equal(trial(base, "Before(function(){return 'pending';}); Then('okay',function(){throw Error('must not run');});").report.scenarios[0].steps[0].status, "skipped"));
test("pending is nonzero", () => assert.equal(trial(base, "Then('okay',function(){return 'pending';});").status, 1));
test("explicit skip is successful", () => assert.equal(trial(base, "Before(function(){return 'skipped';}); Then('okay',function(){});").status, 0));
test("world is fresh per scenario", () => assert.deepEqual(trial(base + "## Scenario: second\n- Then okay\n", "Then('okay',function(){assert.equal(this.n,undefined);this.n=1;});").report.counts, { passed: 2 }));
test("async hooks share world with steps", () => assert.deepEqual(trial(base, "Before(async function(){this.n=await Promise.resolve(2);}); Then('okay',async function(){assert.equal(this.n,2);}); After(async function(){assert.equal(this.n,2);});").report.counts, { passed: 1 }));
test("callback body is not silently executed", () => assert.equal(trial(base, "Then('okay',function(done){console.log('BODY');done();});").stderr, ""));
test("callback async is nonzero", () => assert.equal(trial(base, "Then('okay',function(done){done();});").status, 1));
test("timeout fails and skips later cases", () => assert.deepEqual(trial(base + "## Scenario: later\n- Then okay\n", "setDefaultTimeout(30); Then('okay',function(){return new Promise(()=>{});});").report.counts, { failed: 1, skipped: 1 }));
test("timeout still runs cleanup", () => assert.equal(trial(base, "setDefaultTimeout(30); Then('okay',function(){return new Promise(()=>{});}); After(function(){console.log('cleanup');});").stderr, "cleanup\n"));
test("per-step timeout overrides default", () => assert.deepEqual(trial(base, "setDefaultTimeout(10); Then('okay',{timeout:500},async function(){await new Promise(r=>setTimeout(r,30));});").report.counts, { passed: 1 }));
test("blocked synchronous work is checked after it returns", () => assert.equal(trial(base, "setDefaultTimeout(10); Then('okay',function(){const until=Date.now()+30;while(Date.now()<until){};});").status, 1));
test("step logs do not corrupt JSON", () => assert.deepEqual(trial(base, "console.log('loading'); Then('okay',function(){console.log('step');});").report.counts, { passed: 1 }));
test("regexp flags do not leak lastIndex between cases", () => assert.deepEqual(trial("# Feature: regex\n## Scenario: one\n- Then value 2\n## Scenario: two\n- Then value 3\n", "Then(/^value (\\d+)$/gu,function(n){assert.ok(Number(n)>1);});").report.counts, { passed: 2 }));
test("word and string retain LaTeX backslashes", () => assert.deepEqual(trial("# Feature: params\n## Scenario: value\n- Then token says \"\\vartheta\"\n", "Then('{word} says {string}',function(word,value){assert.deepEqual([word,value],['token',String.raw`\\vartheta`]);});").report.counts, { passed: 1 }));
test("quoted string unescapes quote", () => assert.deepEqual(trial("# Feature: params\n## Scenario: value\n- Then say \"a\\\"b\"\n", "Then('say {string}',function(value){assert.equal(value,'a\"b');});").report.counts, { passed: 1 }));
test("single-quoted string is supported", () => assert.deepEqual(trial("# Feature: params\n## Scenario: value\n- Then say 'text'\n", "Then('say {string}',function(value){assert.equal(value,'text');});").report.counts, { passed: 1 }));
test("signed int is converted to a number", () => assert.deepEqual(trial("# Feature: params\n## Scenario: value\n- Then value -2\n", "Then('value {int}',function(n){assert.equal(n,-2);});").report.counts, { passed: 1 }));

for (const [name, registration] of Object.entries({
  customWorld: "require('@yasuhito/medama').setWorldConstructor(function(){});",
  customParameter: "Then('value {float}',function(n){});",
  tagExpression: "Before({tags:'@a or @b'},function(){});",
  unknownOption: "Then('okay',{retry:1},function(){});",
  hookCallback: "Before(function(done){done();});",
  timeoutZero: "setDefaultTimeout(0);",
  deepCucumber: "require('@cucumber/cucumber/api');",
  expressionPackage: "require('@cucumber/cucumber-expressions');",
  esmStep: "const {createRequire}=await import('node:module'); createRequire(import.meta.url)('@yasuhito/medama').Then('okay',function(){}); export {};",
})) test(`unsupported ${name} is a setup error`, () => assert.equal(trial(base, registration).status, 2));
test("dynamic ESM Cucumber import is blocked", () => assert.match(trial(base, "Then('okay',async function(){await import('@cucumber/cucumber');});", [], { trap: true }).report.scenarios[0].steps[0].error, /external Cucumber import is unsupported/));

test("background and every outline row execute", () => assert.deepEqual(trial("`@suite`\n# Feature: sum\n## Background: start\n- Given ten\n## Scenario Outline: add <n>\n- When add <n>\n- Then equals <result>\n### Examples:\n | n | result |\n | --- | --- |\n | 2 | 12 |\n | 3 | 13 |\n", "Before({tags:'@suite'},function(){this.ready=true;}); Given('ten',function(){this.n=this.ready?10:-1;}); When('add {int}',function(n){this.n+=n;}); Then('equals {int}',function(n){assert.equal(this.n,n);});").report.counts, { passed: 2 }));
test("tag exclusion matches plan", () => assert.deepEqual(trial("# Feature: tags\n`@keep`\n## Scenario: yes\n- Then okay\n`@drop`\n## Scenario: no\n- Then undefined\n", undefined, ["--exclude-tag", "@drop"]).report.counts, { passed: 1 }));
test("tagged hooks do not run on unrelated scenario", () => assert.deepEqual(trial(base, "Before({tags:'@other'},function(){throw Error('must not run');}); Then('okay',function(){});").report.counts, { passed: 1 }));
test("list does not load steps", () => assert.deepEqual(trial(base, "throw Error('must not load');", ["--list"]).report.counts, { listed: 1 }));
test("outline line is the original example row", () => assert.equal(trial("# Feature: list\n\n## Scenario Outline: value <x>\n- Then <x>\n### Examples:\n | x |\n | --- |\n | a |\n", "", ["--list"]).report.scenarios[0].line, 8));
test("table argument decodes escaped pipe", () => assert.deepEqual(trial("# Feature: table\n## Scenario: rows\n- Then table\n | key | value |\n | --- | --- |\n | a | one\\|two |\n", "Then('table',function(table){assert.deepEqual(table.rows(),[['a','one|two']]);});").report.counts, { passed: 1 }));
test("table escape respects backslash parity", () => assert.deepEqual(trial("# Feature: table\n## Scenario: rows\n- Then table\n | left\\\\| right |\n | --- | --- |\n", "Then('table',function(table){assert.deepEqual(table.raw(),[['left\\\\','right']]);});").report.counts, { passed: 1 }));
test("outline substitutes table and doc-string values", () => assert.deepEqual(trial("# Feature: args\n## Scenario Outline: table <x>\n- Then table\n | key | value |\n | --- | --- |\n | x | <x> |\n### Examples:\n | x |\n | --- |\n | yes |\n", "Then('table',function(table){assert.deepEqual(table.hashes(),[{key:'x',value:'yes'}]);});").report.counts, { passed: 1 }));

for (const [index, indent] of ["", "  ", "    ", "        ", "\t"].entries()) {
  test(index === 3 ? "deeply indented text is a CommonMark lazy continuation" : `doc string indentation ${index} preserves relative whitespace`, () => assert.deepEqual(trial(`# Feature: doc\n## Scenario: body\n- Then doc\n${indent}\`\`\`text\n${indent}foo\n${indent}  nested\n${indent}\`\`\`\n`, "Then('doc',function(body){assert.equal(body,'foo\\n  nested');});").report.counts, index === 3 ? { undefined: 1 } : { passed: 1 }));
}
test("doc-string structural text stays literal", () => assert.deepEqual(trial("# Feature: doc\n## Scenario: body\n- Then doc\n  ```text\n  ## Scenario: literal\n  - And: literal\n  ```\n", "Then('doc',function(body){assert.equal(body,'## Scenario: literal\\n- And: literal');});").report.counts, { passed: 1 }));

const describedScenario = "# Feature: sum\n## Scenario: sum\n\n二つの値を足し、結果を呼び出し側へ返す。\nこの例では初期値を明示する。\n\n失敗時には結果を使わないため、計算後の値も確認する。\n\n### 背景と目的\n通常の見出しはシナリオを増やさない。\n\n### 処理の流れ\n```mermaid\nflowchart LR\n  A[初期値] --> B[加算] --> C[結果を確認]\n  %% ## Scenario: illustration\n  %% - Then forbidden\n```\n\n- Given value 2\n- When add 3\n- Then equals 5\n";
test("Scenario paragraphs, headings and Mermaid preserve steps and execution results", () => {
  const steps = "Given('value {int}',function(n){this.n=n;}); When('add {int}',function(n){this.n+=n;}); Then('equals {int}',function(n){assert.equal(this.n,n);});";
  const plain = "# Feature: sum\n## Scenario: sum\n- Given value 2\n- When add 3\n- Then equals 5\n";
  const execution = (report) => ({ counts: report.counts, scenarios: report.scenarios.map((scenario) => ({
    name: scenario.name, status: scenario.status,
    steps: scenario.steps.map((step) => ({ text: step.text, status: step.status, argument: step.argument ?? null })),
    hooks: scenario.hooks,
  })) });
  assert.deepEqual(execution(trial(describedScenario, steps).report), execution(trial(plain, steps).report));
});
test("a prose paragraph separates a diagram after a step from its argument", () => assert.deepEqual(trial(base + "\n処理の流れを示す。\n\n```mermaid\nflowchart LR\n A --> B\n```\n- Then okay\n", "Then('okay',function(){assert.equal(arguments.length,0);});").report.counts, { passed: 1 }));
test("a code fence immediately after a step remains a doc string", () => assert.deepEqual(trial("# Feature: doc\n## Scenario: code\n- Then code\n```javascript\nconst value = 2;\n```\n", "Then('code',function(body){assert.equal(body,'const value = 2;');});").report.counts, { passed: 1 }));
test("a blank line alone does not separate a Mermaid fence from a step argument", () => assert.deepEqual(trial("# Feature: doc\n## Scenario: diagram\n- Then diagram\n\n```mermaid\nflowchart LR\n A --> B\n```\n", "Then('diagram',function(body){assert.equal(body,'flowchart LR\\n A --> B');});").report.counts, { passed: 1 }));

for (const [name, prose] of Object.entries({
  notes: "## Notes: prerequisites\nA description.\n", bullet: "- A note about the scenario.\n",
  given: "Given the context, this is prose.\n", quote: "> - And: quoted\n",
  fence: "```markdown\n## シナリオ: illustration\n- And: literal\n```\n",
  foreignWord: "- ならば prose in default English\n",
})) test(`ordinary ${name} prose remains accepted`, () => assert.deepEqual(trial(`# Feature: prose\n## Scenario: okay\n${prose}- Then okay\n`).report.counts, { passed: 1 }));

for (const keyword of ["Given", "When", "Then", "And", "But"]) {
  for (const prefix of ["", "# Feature: bad\n"]) {
    test(`malformed ${keyword} bullet is rejected at ${prefix ? "feature" : "preamble"}`, () => assert.equal(trial(`${prefix}- ${keyword}: forbidden\n${prefix ? "" : "# Feature: bad\n"}## Scenario: okay\n- Then okay\n`).status, 2));
  }
  test(`malformed ${keyword} bullet is rejected in scenario`, () => assert.equal(trial(base + `- ${keyword}: forbidden\n`).status, 2));
}
for (const [name, source] of Object.entries({
  mixedLanguage: base + "## シナリオ: unsupported\n- ならば forbidden\n",
  languageDirective: "# language: ja\n" + base,
  rule: base + "## Rule: unsupported\n",
  emptyStep: "# Feature: empty\n## Scenario: empty\n- Then\n",
  emptyScenario: "# Feature: empty\n## Scenario: empty\n",
  missingFeature: "## Scenario: okay\n- Then okay\n",
  secondFeature: base + "# Feature: duplicate\n",
  missingExamples: "# Feature: examples\n## Scenario Outline: value <x>\n- Then <x>\n",
  noExampleRows: "# Feature: examples\n## Scenario Outline: value <x>\n- Then <x>\n### Examples:\n | x |\n | --- |\n",
  duplicateHeader: "# Feature: examples\n## Scenario Outline: value <x>\n- Then <x>\n### Examples:\n | x | x |\n | --- | --- |\n | a | b |\n",
  wrongWidth: "# Feature: examples\n## Scenario Outline: value <x>\n- Then <x>\n### Examples:\n | x |\n | --- |\n | a | b |\n",
  undefinedPlaceholder: "# Feature: examples\n## Scenario Outline: value <missing>\n- Then <missing>\n### Examples:\n | x |\n | --- |\n | a |\n",
  orphanTags: base + "`@orphan`\n",
  unclosedFence: base + " ```\n body\n",
  stepOutsideScenario: "# Feature: bad\n- Then okay\n## Scenario: okay\n- Then okay\n",
})) test(`invalid ${name} does not pass`, () => assert.equal(trial(source).status, 2));
test("empty tag selection does not pass", () => assert.equal(trial(base, undefined, ["--tag", "@missing"]).status, 2));
test("missing require file does not pass", () => assert.equal(trial(base, undefined, ["--require", "missing.cjs"]).status, 2));
test("old Cucumber adapter is not a fallback", () => assert.equal(trial(base, undefined, ["--adapter", "cucumber-js"]).status, 2));
for (const [phase, code] of Object.entries({
  loading: "process.exit(0);",
  step: "Then('okay',function(){process.exit(0);});",
  hook: "Then('okay',function(){}); After(function(){process.exit(0);});",
})) test(`early successful exit during ${phase} does not pass`, () => assert.equal(trial(base, code).status, 2));
test("large JSON output is complete through a pipe", () => {
  const source = "# Feature: large\n" + Array.from({length: 400}, (_, i) => `## Scenario: case ${i}\n- Then okay\n`).join("");
  assert.equal(trial(source, "", ["--list"]).report.scenarios.length, 400);
});

for (const entry of require("../spec/markdown_cases.json")) {
  test(`shared grammar: ${entry.name}`, () => {
    const result = trial(entry.source, "", ["--list"]);
    if (entry.error) assert.equal(result.status, 2);
    else {
      const cases = result.report.scenarios;
      const selections = {
        names: cases.map((c) => c.name), lines: cases.map((c) => c.line),
        texts: cases.map((c) => c.steps.map((s) => s.text)), tags: cases.map((c) => c.tags),
        arguments: cases.map((c) => c.steps.map((s) => s.argument)),
      };
      const key = Object.keys(entry.expected)[0];
      assert.deepEqual(selections[key], entry.expected[key]);
    }
  });
}

test("unattached explanatory table remains prose", () => assert.deepEqual(trial(base + "\nprose\n\n | x |\n").report.counts, { passed: 1 }));

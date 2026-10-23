"use strict";
function compile(document, fail) {
  const feature = document.feature;
  const background = feature.children.find((child) => child.background)?.background;
  const scenarios = feature.children.filter((child) => child.scenario).map((child) => child.scenario);
  if (!scenarios.length) fail(1, "no scenarios");
  const makeCase = (scenario, example, row) => {
    const keys = example?.tableHeader?.cells.map((cell) => cell.value);
    const values = row ? new Map(keys.map((key, index) => [key, row.cells[index].value])) : null;
    const replace = (text) => !values ? text : text.replace(/<([^>]+)>/gu, (placeholder, key) => {
      if (!values.has(key)) fail(scenario.location.line, `unknown example placeholder ${placeholder}`);
      return values.get(key);
    });
    const steps = [...(background?.steps ?? []), ...scenario.steps].map((step) => {
      const output = { keyword: step.keyword.trim(), text: replace(step.text), line: step.location.line };
      if (step.dataTable) output.argument = { type: "table", rows: step.dataTable.rows.map((r) => r.cells.map((cell) => replace(cell.value))) };
      if (step.docString) output.argument = { type: "doc_string", content: replace(step.docString.content), media_type: step.docString.mediaType ?? "" };
      return output;
    });
    return { path: document.uri, feature: feature.name, name: replace(scenario.name), description: scenario.description,
      line: row?.location.line ?? scenario.location.line, scenario_line: scenario.location.line,
      tags: [...new Set([...feature.tags, ...scenario.tags, ...(example?.tags ?? [])].map((tag) => tag.name))], steps };
  };
  return scenarios.flatMap((scenario) => {
    if (!scenario.steps.length) fail(scenario.location.line, "scenario has no steps");
    if (scenario.keyword !== "Scenario Outline") return [makeCase(scenario)];
    if (!scenario.examples.length) fail(scenario.location.line, "Scenario Outline has no Examples");
    return scenario.examples.flatMap((example) => {
      const keys = example.tableHeader?.cells.map((cell) => cell.value);
      if (!keys || !example.tableBody.length) fail(example.location.line, "Examples requires a header and at least one row");
      if (keys.some((key) => !key) || new Set(keys).size !== keys.length) fail(example.tableHeader.location.line, "empty or duplicate example header");
      return example.tableBody.map((row) => makeCase(scenario, example, row));
    });
  });
}
module.exports = { compile };

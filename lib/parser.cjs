"use strict";
const { parseMarkdown } = require("./markdown.cjs");
const { isPipeRow, tableEnd, tableAt } = require("./tables.cjs");
const { compile } = require("./compiler.cjs");
const dialects = require("./vendor/gherkin/gherkin-languages.json");
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const headingKeywords = [...new Set(Object.values(dialects).flatMap((dialect) =>
  ["feature", "background", "rule", "scenario", "scenarioOutline", "examples"].flatMap((kind) => dialect[kind])))].sort((a, b) => b.length - a.length);
const reservedHeading = new RegExp(`^(?:${headingKeywords.map(escape).join("|")})\\s*[:：]`, "u");
const kinds = { Given: "Context", When: "Action", Then: "Outcome", And: "Conjunction", But: "Conjunction" };
const tagLine = (raw) => /^\s*(?:@|`@)/u.test(raw);
const inlineText = (node) => node.children.find((child) => child.type === "inline")?.content ?? "";

// Markdown decides what blocks exist. This converter gives direct blocks their
// grammatical roles, without promoting quoted or nested prose into execution.
class Converter {
  constructor(source, uri) {
    this.source = { uri, data: source, mediaType: "text/x.cucumber.gherkin+markdown" };
    this.lines = source.replace(/\r\n?/g, "\n").split("\n");
    this.tree = parseMarkdown(source);
    this.document = { uri, comments: [] };
    this.tags = [];
    this.prose = new Map();
    this.nextId = 1;
  }
  fail(line, message) { throw new Error(`${this.document.uri}:${line}: ${message}`); }
  id() { return String(this.nextId++); }
  location(node, keyword) {
    const line = node.map[0];
    const column = keyword ? this.lines[line].indexOf(keyword) : this.lines[line].search(/\S/);
    return { line: line + 1, column: Math.max(0, column) + 1 };
  }
  owner() { return this.examples ?? this.scenario ?? this.background ?? this.document.feature; }
  describe(start, end) {
    const owner = this.owner();
    const text = this.lines.slice(start, end).join("\n").trimEnd();
    if (owner && text.trim()) {
      if (!this.prose.has(owner)) this.prose.set(owner, []);
      this.prose.get(owner).push(text);
    }
    this.step = null;
  }
  describeNode(node) { if (node.map) this.describe(...node.map); }
  describeGap(start, end) {
    // Markdown reference definitions have source spans but no emitted block
    // token. Preserve these gaps as prose, without re-parsing them as steps.
    while (start < end && !this.lines[start].trim()) start++;
    while (end > start && !this.lines[end - 1].trim()) end--;
    if (start < end) this.describe(start, end);
  }
  takeTags() { const tags = this.tags; this.tags = []; return tags; }

  readTags(raw, line) {
    const trimmed = raw.trim();
    const names = trimmed.startsWith("@") ? trimmed.split(/\s+/u) : [...trimmed.matchAll(/`(@[^`\s]+)`/gu)].map((match) => match[1]);
    const remainder = trimmed.replace(/`(@[^`\s]+)`/gu, "").trim();
    if (!names.length || (!trimmed.startsWith("@") && remainder) || names.some((name) => !/^@[^\s`]+$/u.test(name))) this.fail(line + 1, "invalid tag line");
    let column = 0;
    for (const name of names) {
      column = raw.indexOf(name, column);
      this.tags.push({ id: this.id(), name, location: { line: line + 1, column: column + 1 } });
      column += name.length;
    }
    this.step = null;
  }

  heading(node) {
    const text = inlineText(node).trim(), line = node.map[0] + 1;
    if (/^language:\s*(?!en\s*$)\S+/u.test(text)) this.fail(line, "unsupported language directive; structural keywords must be English");
    const match = text.match(/^(Feature|Background|Scenario Outline|Scenario|Examples):\s*(.*)$/u);
    if (!match) {
      if (/^(Rule|Scenario Template|Example):/u.test(text)) this.fail(line, "unsupported heading");
      if (/^(Feature|Background|Scenario|Examples)\b/u.test(text)) this.fail(line, "malformed scenario heading; expected Keyword: name");
      if (reservedHeading.test(text)) this.fail(line, "unsupported executable heading; structural keywords must be English");
      this.describeNode(node);
      return;
    }
    const [, keyword, name] = match;
    this.step = null;
    if (keyword !== "Feature" && !this.document.feature) this.fail(line, "heading before Feature");
    const location = this.location(node, keyword);
    if (keyword === "Feature") {
      if (this.document.feature) this.fail(line, "multiple features in one file");
      this.document.feature = { location, language: "en", keyword, name, description: "", tags: this.takeTags(), children: [] };
    } else if (keyword === "Background") {
      if (this.background || this.scenario || this.tags.length) this.fail(line, "Background must precede scenarios and occur once");
      this.background = { id: this.id(), location, keyword, name, description: "", steps: [] };
      this.document.feature.children.push({ background: this.background });
    } else if (keyword === "Scenario" || keyword === "Scenario Outline") {
      this.background = null;
      this.examples = null;
      this.scenario = { id: this.id(), location, keyword, name, description: "", tags: this.takeTags(), steps: [], examples: [] };
      this.document.feature.children.push({ scenario: this.scenario });
    } else {
      if (this.scenario?.keyword !== "Scenario Outline") this.fail(line, "Examples requires Scenario Outline");
      this.examples = { id: this.id(), location, keyword, name, description: "", tags: this.takeTags(), tableBody: [] };
      this.scenario.examples.push(this.examples);
    }
  }

  table(start, end) {
    const owner = this.examples && !this.examples.tableHeader ? this.examples : this.step && !this.step.value.docString && !this.step.value.dataTable ? this.step.value : null;
    if (!owner) {
      const rowEnd = tableEnd(this.lines, start, end);
      this.describe(start, rowEnd);
      return rowEnd;
    }
    const parsed = tableAt(this.lines, start, end, this.fail.bind(this), this.id.bind(this));
    if (owner === this.examples) [owner.tableHeader, ...owner.tableBody] = parsed.rows;
    else owner.dataTable = { location: parsed.rows[0].location, rows: parsed.rows };
    this.step = null;
    return parsed.end;
  }

  fence(node) {
    if (!this.step) { this.describeNode(node); return; }
    if (this.lines.slice(this.step.end, node.map[0]).some((line) => line.trim())) { this.describeNode(node); return; }
    const closing = this.lines[node.map[1] - 1].trim();
    const character = node.markup[0];
    if (node.map[1] <= node.map[0] + 1 || !new RegExp(`^${character}{${node.markup.length},}\\s*$`).test(closing)) this.fail(node.map[0] + 1, "unclosed step doc string fence");
    this.step.value.docString = { location: this.location(node), delimiter: node.markup,
      content: node.content.replace(/\n$/, ""), ...(node.info.trim() ? { mediaType: node.info.trim() } : {}) };
    this.step = null;
  }

  paragraph(node, offset = 0) {
    let start = node.map[0] + offset, end = node.map[1];
    while (start < end) {
      if (tagLine(this.lines[start])) { this.readTags(this.lines[start], start++); continue; }
      if (isPipeRow(this.lines[start])) { start = this.table(start, end); continue; }
      let next = start + 1;
      while (next < end && !tagLine(this.lines[next]) && !(this.examples && !this.examples.tableHeader && isPipeRow(this.lines[next]))) next++;
      this.describe(start, next);
      start = next;
    }
  }

  bulletList(node) {
    for (const item of node.children) {
      const first = item.children[0];
      if (first?.type !== "paragraph") { this.describeNode(item); continue; }
      const lines = inlineText(first).split("\n");
      const special = lines.findIndex((line, index) => index > 0 && (isPipeRow(line) || tagLine(line)));
      const stepText = lines.slice(0, special < 0 ? lines.length : special).join("\n").trim();
      const match = stepText.match(/^(Given|When|Then|And|But)\s+([\s\S]+)$/u);
      if (!match) {
        if (/^(Given|When|Then|And|But)\s*$/u.test(stepText)) this.fail(first.map[0] + 1, "empty step");
        if (/^(Given|When|Then|And|But)\s*[:：]/u.test(stepText)) this.fail(first.map[0] + 1, "unsupported step syntax; expected an English keyword followed by a space");
        this.describeNode(item);
        continue;
      }
      if ((!this.scenario && !this.background) || this.examples) this.fail(first.map[0] + 1, "step outside a scenario or background");
      const [, keyword, text] = match;
      const step = { id: this.id(), location: this.location(first, keyword), keyword: keyword + " ", keywordType: kinds[keyword], text: text.trim() };
      (this.scenario ?? this.background).steps.push(step);
      this.step = { value: step, end: special < 0 ? first.map[1] : first.map[0] + special };
      if (special >= 0) this.paragraph(first, special);
      let end = first.map[1];
      for (const extra of item.children.slice(1)) {
        this.describeGap(end, extra.map[0]);
        this.block(extra, false);
        end = extra.map[1];
      }
      this.describeGap(end, item.map[1]);
    }
  }

  block(node, direct = true) {
    if (node.type === "heading" && direct) this.heading(node);
    else if (node.type === "bullet_list" && direct) this.bulletList(node);
    else if (node.type === "fence") this.fence(node);
    else if (node.type === "table" || (node.type === "code_block" && (this.examples || this.step) && isPipeRow(this.lines[node.map[0]]))) {
      const end = this.table(...node.map);
      if (end < node.map[1]) this.paragraph({ map: [end, node.map[1]] });
    } else if (node.type === "paragraph") this.paragraph(node);
    else this.describeNode(node);
  }

  convert() {
    let end = 0;
    for (const block of this.tree.children) {
      this.describeGap(end, block.map[0]);
      this.block(block);
      end = block.map[1];
    }
    this.describeGap(end, this.lines.length);
    if (this.tags.length) this.fail(this.lines.length, "tags must precede a Feature, Scenario or Examples heading");
    if (!this.document.feature) this.fail(1, "expected Feature: heading");
    for (const [owner, prose] of this.prose) owner.description = prose.join("\n\n");
    const cases = compile(this.document, this.fail.bind(this));
    return { path: this.document.uri, feature: this.document.feature.name, cases,
      source: this.source, gherkinDocument: this.document };
  }
}
module.exports = { parse: (source, uri = "<markdown>") => new Converter(source, uri).convert() };

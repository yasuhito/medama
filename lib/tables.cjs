"use strict";

// Lexical cell/delimiter operations never choose an owner. The AST converter
// supplies the grammatical context, then validates executable tables strictly.
function cells(raw, line) {
  let text = raw.trim();
  const leading = text.startsWith("|");
  if (leading) text = text.slice(1);
  if (text.endsWith("|") && !/\\(?:\\\\)*\|$/.test(text)) text = text.slice(0, -1);
  const values = [];
  let start = 0, slashes = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || (text[i] === "|" && slashes % 2 === 0)) {
      const value = text.slice(start, i);
      values.push({ location: { line, column: raw.search(/\S/) + (leading ? 1 : 0) + start + value.search(/\S|$/) + 1 },
        value: value.trim().replace(/\\([n|\\])/g, (_, character) => character === "n" ? "\n" : character) });
      start = i + 1;
    }
    slashes = text[i] === "\\" ? slashes + 1 : 0;
  }
  return values;
}
const isPipeRow = (raw) => /^\s*\|/.test(raw);
const isDelimiter = (row) => row.length > 0 && row.every((cell) => /^:?-+:?$/.test(cell.value));
function tableEnd(lines, start, limit) {
  let end = start;
  while (end < limit && lines[end].trim() && (isPipeRow(lines[end]) || lines[end].includes("|"))) end++;
  return end;
}

function tableAt(lines, start, limit, fail, id) {
  const first = cells(lines[start], start + 1);
  const delimiter = start + 1 < limit ? cells(lines[start + 1], start + 2) : [];
  const hasDelimiter = isDelimiter(delimiter);
  if (!hasDelimiter) fail(start + 1, "executable table requires a delimiter row after its header");
  if (hasDelimiter && delimiter.length !== first.length) fail(start + 2, "inconsistent table delimiter width");
  const rows = [];
  const end = tableEnd(lines, start, limit);
  for (let line = start; line < end; line++) {
    const row = cells(lines[line], line + 1);
    if (row.length !== first.length) fail(line + 1, "inconsistent table width");
    if (!hasDelimiter || line !== start + 1) {
      rows.push({ id: id(), location: { line: line + 1, column: Math.max(0, lines[line].indexOf("|")) + 1 }, cells: row });
    }
  }
  return { rows, end };
}
module.exports = { isPipeRow, tableEnd, tableAt };

"use strict";
const MarkdownIt = require("markdown-it");
const markdown = new MarkdownIt("commonmark", { html: true }).enable("table");

// Markdown owns nesting and block boundaries. This only turns its tokens into
// a tree, without recognizing any executable syntax or rendering HTML/media.
function parseMarkdown(source) {
  const root = { type: "document", children: [] };
  const stack = [root];
  for (const token of markdown.parse(source, {})) {
    if (token.nesting === -1) { stack.pop(); continue; }
    const node = { type: token.type.replace(/_open$/, ""), map: token.map,
      markup: token.markup, content: token.content, info: token.info, children: [] };
    if (token.type === "inline") node.inline = token.children;
    stack.at(-1).children.push(node);
    if (token.nesting === 1) stack.push(node);
  }
  return root;
}
module.exports = { parseMarkdown };

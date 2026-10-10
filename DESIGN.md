# Markdown AST to executable scenarios

The parser follows the latest adopted design in [issue 719](https://github.com/cucumber/gherkin/issues/719#issuecomment-6005115753): parse ordinary Markdown first, then convert its AST to a GherkinDocument. The [prototype report](https://github.com/cucumber/gherkin/issues/719#issuecomment-6007772360) retains prose as description. The user's later request for scenario explanations, diagrams, screenshots and video references follows this same direction, so description retention supersedes the earlier issue-body proposal to keep descriptions empty.

`markdown-it` 15.0.2 parses CommonMark with its table extension. `lib/markdown.cjs` turns its nested tokens into a block tree. The library owns headings, Setext syntax, lists, block quotes, code blocks, HTML and paragraph boundaries. There is no whole-document line-regex scanner for executable structure.

`lib/parser.cjs` converts direct heading blocks and direct items of top-level unordered lists to the supported GherkinDocument elements. Ordered/nested lists, quoted examples and descriptive code/HTML blocks remain Markdown description. Inline spelling in executable steps remains raw, including the backticks required by existing pi-formula definitions. Prose is collected as raw Markdown excerpts, preserving media references. The unchanged input string is also retained as Source, including original line endings. Descriptions do not encode the original interleaving of every prose and executable element; Source retains that complete document. Edited-AST round-trip formatting is outside this milestone.

## Table ownership

The [original table proposal](https://github.com/cucumber/gherkin/issues/719) makes position determine ownership: immediately following a step means DataTable; the first table in Examples means example data; other tables mean prose. Blank lines do not detach an argument; prose and ordinary headings do. A step gets one argument and an Examples section gets one table.

`lib/tables.cjs` recognizes and decodes rows and delimiters without choosing their owner. The converter assigns the grammatical role, then validates executable tables for a delimiter and consistent widths. Raw source spans are checked because Markdown table parsers may pad/truncate uneven rows. CommonMark can put unindented table lines in a list-item paragraph, or deeply indented rows in a code block. Those bounded AST spans still follow the table ownership grammar, independent of indentation. Fenced code content is always opaque.

All executable tables require a delimiter. Following the user's decision, pi-formula's two delimiterless Examples tables receive only a standard Markdown delimiter row; values, scenarios and steps stay unchanged. There is no compatibility mode. A second table remains prose rather than more example data.

## Compilation and execution

`lib/compiler.cjs` expands the document into the existing case interface, preserving source lines, raw step text, argument values, inherited tags, Background order and Examples row identities. It is medama's own compiler. The JavaScript runner owns registration, matching, hooks, World, Promise handling, timeout and reporting. Neither parser nor runner invokes Cucumber. GherkinDocument/Source are plain data objects; no Cucumber Messages or Pickle implementation is loaded.

The CommonJS `require('@cucumber/cucumber')` compatibility name maps only to medama's registration API. Native definitions use `require('@yasuhito/medama')`. Unknown APIs, options, deep imports and unsupported ESM definitions are errors. The consuming project's application dependencies and assertions remain its own.

## Corpus and distributions

`spec/markdown_cases.json` retains the basic cross-language corpus. `spec/markdown_ast_cases.json` records the new AST grammar and its positive/negative examples for a future Ruby migration. The retained Ruby prototype is still the earlier native implementation; its AST migration is a separate gem milestone. It is excluded from the npm tarball, and no Ruby installation is needed for npm execution.

The npm package is `@yasuhito/medama`, its CLI is `medama`, and the GitHub repository is `yasuhito/medama`. Registry publication remains a separate, unapproved action. Shared grammar data does not create a runtime dependency between the distributions.

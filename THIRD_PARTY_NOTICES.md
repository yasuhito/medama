# Provenance and reuse boundary

Markdown parsing is provided by `markdown-it` 15.0.3, copyright 2014 Vitaly Puzrin and Alex Kocharin, licensed MIT. Its complete notice is at `lib/vendor/markdown-it/LICENSE`. It is an npm runtime dependency, not vendored implementation code. The generated package lock records official registry URLs and integrity hashes for its six transitive dependencies: argparse (PSF-2.0), entities (BSD-2-Clause), linkify-it, mdurl, punycode.js and uc.micro (MIT). Their notices are distributed in their own dependency packages.

medama's Markdown-AST conversion, grammatical ownership, table validation, case compiler, CLI, JavaScript runner, expression subset, and CommonJS import shim are written for this project. No upstream Gherkin parser, generated grammar, Cucumber runtime, or expression implementation is copied or imported.

The unchanged keyword data `lib/vendor/gherkin/gherkin-languages.json` comes from `@cucumber/gherkin` 42.0.0 `src/gherkin-languages.json`. It identifies reserved structural headings. It does not parse or execute scenarios. Its complete upstream MIT license and copyright notice are bundled at `lib/vendor/gherkin/LICENSE`.

The architecture was checked against Yasuhito Takamiya's [issue 719 proposal and later prototype report](https://github.com/cucumber/gherkin/issues/719#issuecomment-6007772360). The local Java CommonMark prototype was read for design reference; its implementation and official fixtures were not copied into this package. The scope and chosen latest prose policy are documented in DESIGN.md.

The required execution interface was checked against pi-formula at commit `5aefebf5c03e54cfb3eb63e6f705e1efb7d7d525` (MIT, copyright 2020-2026 Yasuhito Takamiya). Its feature/step files remain in pi-formula and are not bundled. The arithmetic example and test fixtures were authored for medama.

Cucumber.js 13.2.1 is a comparison oracle outside this package, not a runtime/development/install dependency. Upstream references: [Cucumber.js](https://github.com/cucumber/cucumber-js), [Gherkin](https://github.com/cucumber/gherkin). This work only reads issue 719 and does not contact upstream.

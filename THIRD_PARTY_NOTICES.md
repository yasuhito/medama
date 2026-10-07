# Provenance and reuse boundary

medama's Ruby parser, runner, CLI, and JavaScript bridge are newly written for this project. No Cucumber parser, generated grammar, or runner source has been copied or ported into the gem.

The unchanged keyword data `lib/medama/vendor/gherkin/gherkin-languages.json` is copied from the installed `@cucumber/gherkin` 42.0.0 `src/gherkin-languages.json`. It is used only to identify known executable keywords and reject unsupported syntax while preserving ordinary Markdown prose. The complete upstream MIT license and copyright notice are bundled at `lib/medama/vendor/gherkin/LICENSE`. No multilingual parser or runner is imported. The JavaScript Gherkin parser remains outside this gem.

The initial Markdown dialect was checked against the user's pi-formula feature files at commit `5aefebf5c03e54cfb3eb63e6f705e1efb7d7d525` (MIT, copyright 2020-2026 Yasuhito Takamiya). Those feature and step files remain in pi-formula and are not bundled in this gem.

The optional `cucumber-js` adapter resolves and calls the consuming project's installed `@cucumber/cucumber/api`. In the first trial this is Cucumber.js 13.2.1 (MIT, copyright Julien Biezemans and contributors), with `@cucumber/gherkin` 42.0.0 (MIT, copyright 2017 Cucumber Ltd, Gaspar Nagy, Björn Rasmusson, Peter Sergeant, and contributors). The adapter uses Cucumber's public configuration and execution interface; Cucumber owns JavaScript step matching, hooks, World, timeouts, and assertions. These npm packages are not vendored or installed by medama.

Reference sources inspected locally:

- `pi-formula/node_modules/@cucumber/gherkin/src/GherkinInMarkdownTokenMatcher.ts`
- `pi-formula/node_modules/@cucumber/gherkin/src/GherkinLine.ts`
- `pi-formula/node_modules/@cucumber/cucumber/lib/api/*.d.ts`
- `pi-formula/node_modules/@cucumber/cucumber/lib/formatter/json_formatter.js`
- Their installed `package.json` and `LICENSE` files.

Upstream: [Cucumber.js](https://github.com/cucumber/cucumber-js), [Gherkin](https://github.com/cucumber/gherkin). This work does not contact upstream or change Gherkin issue 719.

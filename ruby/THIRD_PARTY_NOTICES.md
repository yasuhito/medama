# Ruby provenance

The Ruby parser, runner and CLI were authored for medama. The previous Cucumber.js bridge is removed from this prototype; the Ruby execution path uses its own runner.

The unchanged keyword JSON under `lib/medama/vendor/gherkin/` comes from Gherkin 42.0.0. Its complete MIT license and copyright notice are included beside the data. No upstream parser or runner code is copied. The common project-authored corpus lives at `../spec/markdown_cases.json`.

pi-formula feature and step files were used outside this package for initial verification and are not bundled. See the root `THIRD_PARTY_NOTICES.md` for the shared project provenance and reuse scope.

// Uses the project's installed Cucumber through its public API. No runtime is vendored.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

async function main() {
  const projectRequire = createRequire(path.join(process.cwd(), "package.json"));
  const { loadConfiguration, runCucumber } = projectRequire("@cucumber/cucumber/api");
  const request = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const { runConfiguration } = await loadConfiguration({
    file: false,
    provided: {
      paths: request.paths,
      require: request.require,
      tags: request.tags,
      format: ["summary", `json:${request.report}`],
      publish: false,
      parallel: 0,
      retry: 0,
      strict: true,
    },
  });
  const result = await runCucumber(runConfiguration);
  process.exitCode = result.success ? 0 : 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 2;
});

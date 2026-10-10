"use strict";

// This is the native step-definition interface. Registration is scoped to
// the current CLI run, including the compatibility CommonJS import alias.
const { definitionApi } = require("./runtime.cjs");
module.exports = new Proxy({}, { get: (_, name) => definitionApi()[name] });

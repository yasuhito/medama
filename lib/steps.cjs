"use strict";

// This is the native step-definition interface. Registration is scoped to
// the current CLI run, including the compatibility CommonJS import alias.
const { definitionApi } = require("./runtime.cjs");
exports.Given = (...args) => definitionApi().Given(...args);
exports.When = (...args) => definitionApi().When(...args);
exports.Then = (...args) => definitionApi().Then(...args);
exports.Before = (...args) => definitionApi().Before(...args);
exports.After = (...args) => definitionApi().After(...args);
exports.setDefaultTimeout = (...args) => definitionApi().setDefaultTimeout(...args);

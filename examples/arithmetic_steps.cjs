const assert = require("node:assert/strict");
const { Given, When, Then } = require("@yasuhito/medama");

Given("値は {int}", function (n) { this.value = n; });
When("{int} を足す", function (n) { this.value += n; });
Then("値は {int} になる", function (n) { assert.equal(this.value, n); });

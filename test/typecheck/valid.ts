import type { DataTable } from "@yasuhito/medama";

const { Given, When, Then, Before, After, setDefaultTimeout }:
  typeof import("@yasuhito/medama") = require("@yasuhito/medama");

interface State { value: number }

setDefaultTimeout(500);
Before(async function (this: State): Promise<void> { this.value = await Promise.resolve(0); });
Given("value {int}", function (this: State, value: number): void { this.value = value; });
When("add {int}", { timeout: 100 }, function (this: State, value: number): void { this.value += value; });
Then("table", function (this: State, table: DataTable): void { this.value = table.rows().length; });
After({ tags: "@cleanup", timeout: 100 }, function (this: State): void { this.value = 0; });

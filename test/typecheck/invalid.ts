const { Given, Before }: typeof import("@yasuhito/medama") = require("@yasuhito/medama");

interface State { value: number }

Given("value {int}", { retry: 2 }, function (this: State, value: number): void { this.value = value; });
Before(function (done: () => void): void { done(); });
Given("value {int}", function (this: State, value: number): void { this.value = "wrong"; });

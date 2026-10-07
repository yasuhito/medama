`@example`
# Feature: Markdown で足し算を試す

シナリオと説明を同じ Markdown に書く。

## Background: 値を用意する

- Given 値は 10

## Scenario Outline: <value> を足す

- When <value> を足す
- Then 値は <expected> になる

### Examples:

  | value | expected |
  | --- | --- |
  | 2 | 12 |
  | 3 | 13 |

`@smoke`
# Feature: 足し算
## Scenario Outline: <n> を足す
- Given 値は 2
- When <n> を足す
- Then 値は <result> になる
### Examples:
| n | result |
| --- | --- |
| 3 | 5 |
| 4 | 6 |

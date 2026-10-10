# medama

Markdown に書いたシナリオを実行する、小さな JavaScript / TypeScript CLI。Node.js `^22.19.0 || >=23.6.0` と npm で使えます。Ruby や Cucumber.js のインストールは不要です。Markdown の構造解析には `markdown-it 15.0.2` を使い、シナリオ変換と実行は medama 自身が行います。

将来は npm の JavaScript 版と gem の Ruby 版を提供する計画です。この候補の最初の受入対象は npm 版です。既存の Ruby parser / runner はソースの `ruby/` に保持し、共通の基本文法を `spec/markdown_cases.json`、新しい AST 文法を `spec/markdown_ast_cases.json` に記録します。Ruby prototype の AST 移行は後続 milestone です。npm tarball には Ruby を含めず、Ruby 完全互換や gem 公開は別の milestone です。

npm package 名は `@yasuhito/medama`、CLI 名は `medama` です。GitHub は `yasuhito/medama` を使います。この候補は npm registry へまだ公開していません。ローカル tarball で試せます。

```sh
cd medama
npm ci --ignore-scripts
npm test
npm pack --ignore-scripts
cd /path/to/project
npm install --save-dev /path/to/medama/yasuhito-medama-0.1.0.tgz
```

プロジェクトの `package.json` に実行用 script を置きます。

```json
{
  "scripts": {
    "test:medama": "medama --require 'features/step_definitions/**/*.js' 'features/**/*.feature.md'"
  }
}
```

```sh
npm run test:medama
npm run test:medama -- --format json
```

Markdown の構造 keyword は英語、step の本文は日本語も使えます。

```markdown
# Feature: 足し算
## Scenario: 二つの数を足す
- Given 値は 2
- When 3 を足す
- Then 値は 5 になる
```

CommonJS の step ファイルで `@yasuhito/medama` の登録関数を使います。

```javascript
const assert = require('node:assert/strict');
const { Given, When, Then } = require('@yasuhito/medama');
Given('値は {int}', function (n) { this.value = n; });
When('{int} を足す', function (n) { this.value += n; });
Then('値は {int} になる', function (n) { assert.equal(this.value, n); });
```

実行例は `examples/arithmetic.feature.md` と `examples/arithmetic_steps.cjs` にあります。

```sh
node bin/medama.cjs --require examples/arithmetic_steps.cjs examples/arithmetic.feature.md
```

CommonJS の `.ts` / `.cts` step も、ビルドせずに直接実行できます。型検査は実行とは別に `tsc --noEmit` で行います。medama は Node 標準の型除去を使い、TypeScript compiler や追加 loader に依存しません。登録関数と DataTable 引数の型定義を同梱しています。

```typescript
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { Given, When, Then }: typeof import('@yasuhito/medama') = require('@yasuhito/medama');
interface State { value: number }
Given('値は {int}', function (this: State, value: number): void { this.value = value; });
When('{int} を足す', function (this: State, value: number): void { this.value += value; });
Then('値は {int} になる', function (this: State, value: number): void { assert.equal(this.value, value); });
```

```sh
medama --require 'features/step_definitions/**/*.ts' 'features/**/*.feature.md'
tsc --noEmit
```

`.ts` は CommonJS の `require` / `module.exports` を使います。`type: module` のプロジェクトでは `.cts` を使ってください。型だけの参照は `import type` / `typeof import(...)` にします。相対的な TypeScript ファイルの実行参照には `.ts` / `.cts` 拡張子が必要です。 相対参照や JavaScript helper を経由して読む TypeScript の依存先も CommonJS に限ります。`.mts`、`type: module` 配下の `.ts`、ESM 構文を持つ `.ts` は、副作用や step 登録を実行する前に拒否します。既存 JavaScript の依存先は Node の通常の module 形式を保ち、`.mjs` / ESM `.js` の依存を一律に制限しません。型の除去は元の行番号を保つため、step の失敗には元の TypeScript の位置が出ます。

型検査には `module: NodeNext`、`strict: true`、`noEmit: true`、`erasableSyntaxOnly: true`、`verbatimModuleSyntax: true` を使えます。相対参照に `.ts` 拡張子を含む場合は `allowImportingTsExtensions: true` も指定します。Node は `tsconfig.json` を読まず、型検査や module の変換をしません。ESM step (`.mts` / ESM `.ts`)、`.tsx`、enum、parameter properties、実行コードを持つ namespace、import alias、decorator、tsconfig の `paths` 変換、`node_modules` 内の TypeScript はこの実行範囲に含みません。選択した未対応ファイル・構文は設定エラーになります。Node の型除去を無効にする option や transform mode も設定エラーになります。

対応する Markdown:

- `Feature`、`Scenario`、`Scenario Outline`、`Examples` の ATX 見出し（深さ1-6）と Setext 見出し。
- Feature に一つの `Background`。シナリオ・Examples 行ごとに先に実行します。
- `-`、`+`、`*` の bullet にした `Given / When / Then / And / But`。
- Examples の `<名前>` 置換、複数の Examples、alignment 行と表の `\\`・`\|`・`\n` escape。
- Feature / Scenario / Examples に付ける `` `@tag` `` または独立した `@tag` 行。
- step のすぐ後に付く CommonMark の fenced code block（backtick または tilde 3個以上）を doc string にします。相対的な字下げ・本文・delimiter・media type を保持します。

説明文・引用・ordered list・入れ子の list・step に付かない code block・HTML は実行しません。description に Markdown の表記を保持します。`## Notes: prerequisites`、`- A note ...`、箇条書きでない `Given ...` は説明文です。step keyword の直後に colon を置く `- And: ...` は Feature 前でもエラーになります。既知の多言語構造見出し、非英語の `# language:` 指定、Rule は未対応としてエラーにします。既定英語の step keyword で始まらない単独 bullet は説明文です。

Scenario の直下には、実行前提や目的を複数段落で書けます。通常の見出しと Mermaid fence も、最初の step より前に置けば説明として扱います。medama 自体は図を描画しません。Markdown viewer の Mermaid 対応を使って表示できます。

````markdown
## Scenario: 二つの数を足す

初期値と加算値から、呼び出し側へ返す値を計算する。
このシナリオでは初期値を明示する。

計算後の値を確認し、利用側が期待する結果になることを確かめる。

### 背景と目的
値を受け取り、加算した結果を返す。

### 処理の流れ
```mermaid
flowchart LR
  A[初期値] --> B[加算] --> C[結果を確認]
```

- Given 値は 2
- When 3 を足す
- Then 値は 5 になる
````

step のすぐ後の fenced code block は、`javascript` や `mermaid` の言語名でもその step の doc string 引数になります。空行だけではこの関連を解除しません。実行中の step の後に説明図を置く場合は、先に説明段落または通常の見出しを入れてください。背景説明と図を Scenario 直下から最初の step までにまとめると、引数との混同を避けられます。説明用の見出しでは `Scenario:` や `Examples:` などの実行 keyword を使わず、説明 bullet も `Given / When / Then / And / But` で始めないでください。

表の所有は字下げで決めません。step の直後の最初の表は DataTable、Examples 内の最初の表は Examples のデータになります。空行は接続を切りませんが、説明段落や通常の見出しが入ると step の引数ではなくなります。追加の表は説明として保持します。実行に使う表では header の次に delimiter 行（`| --- |` など）が必要で、列数不一致もエラーです。説明用の表はその内容を実行データとして検査しません。

pi-formula の Examples 表2か所にも delimiter 行を追加し、上記の通常の script で実行します。表の値・シナリオ・step は変更しません。

通常の Markdown 画像、GIF、動画リンク、HTML メディアも説明に使えます。次は参照の書式例です。medama は参照先を取得したり HTML / script を実行したりしません。表示は Markdown viewer 側で行います。

```markdown
## Scenario: 画面の結果を確認する

処理の結果と、その確認方法を説明する。

![結果](assets/result.png)

![流れ](assets/flow.gif)

[操作動画](assets/demo.mp4)

<video controls src="assets/demo.mp4"></video>

- Given 準備ができている
- Then 結果が正しい
```

CommonMark が paragraph の境界を決めます。step の本文の後に説明・メディアを置く場合は空行を入れて paragraph を分けてください。空行のない継続行は同じ step paragraph の本文になります。step の backtick、quote、LaTeX の escape は既存の登録との一致のため元の表記を保持します。

`--list --format json` は、展開したシナリオに加え、元の Markdown を保つ `source` と description・location を持つ `gherkinDocument` を `documents` に返します。構造変換の設計と根拠は [DESIGN.md](DESIGN.md) に記載しています。

最小 JavaScript runtime:

- `Given / When / Then` の String または RegExp 登録。String は literal の完全一致と `{word}`・`{string}`・`{int}` の基本引数を扱います。RegExp の capture は文字列で渡します。
- シナリオごとの新しい `this`。同期関数と Promise / async 関数。
- `Before` は登録順、`After` は逆登録順。失敗・pending・skip の場合も After を実行します。
- `Before({tags: '@native-vt'}, fn)` など単一タグの hook 選択。
- `setDefaultTimeout(ms)` と step / hook の `{timeout: ms}`。timeout は正の整数です。
- `return 'pending'` は非成功、`return 'skipped'` は明示的な skip。
- 表の `raw()`・`rows()`・`hashes()`・`rowsHash()`。doc string は文字列で渡します。

timeout は Promise の待機と同期関数が戻った時点で確認します。同期処理の途中を中断する機能はありません。timeout 後は After を試み、残りのケースを skip してプロセスを終了します。任意の Promise を cancel できないため、遅れて完了する処理が次のケースへ影響することを防ぎます。

既存の CommonJS step ファイルが使う `require('@cucumber/cucumber')` は、この実行プロセス内で medama の登録関数へ対応づけます。外部 Cucumber パッケージは解決・ロードしません。deep import、Cucumber の ESM import、未知の登録関数・option はエラーになります。この shim は最小の import 互換であり、Cucumber の全面互換ではありません。

未対応: custom World、custom parameter types、callback async、hook の引数、BeforeAll / AfterAll / BeforeStep / AfterStep、attachment、Cucumber Expressions の optional / alternative 構文、tag boolean expression、多言語実行構文、Rule、Scenario Template / Example の別名、`*` step keyword、profile / plugin / messages / parallel / retry、直接選択する ESM step ファイル。対応外の parameter や登録 option はエラーです。String の括弧や slash は literal として扱います。

```sh
medama --tag @smoke --exclude-tag @slow features
medama --list --format json features
```

`--tag` の繰り返しは AND、`--exclude-tag` はどれかに一致するケースを除きます。既定の step 読み込み先は `features/support/` と `features/step_definitions/` 配下の `.js` / `.cjs` / `.ts` / `.cts` です。型宣言ファイルは既定の探索から除き、明示して選択するとエラーにします。既定の探索で `.mjs` / `.mts` / `.tsx` が見つかった場合も設定エラーです。同名の `.ts` と生成済み `.js` などが同居する場合は `--require` で片方を選択します。`--require` を指定するとその指定だけを読みます。`--list` は step を読み込まず構文検査と展開だけを行います。

終了コードは成功・明示的 skip が `0`、失敗・undefined・ambiguous・pending が `1`、構文・設定エラーや空の選択が `2` です。0件のファイル・シナリオ、空シナリオ、Examples 欠落、未定義 placeholder を成功として扱いません。JSON は件数、各 step と hook の状態、元 Markdown のパスと行番号を返します。

`npm test` は Node 標準の Test Runner で実 CLI を操作します。テスト fixture に Cucumber パッケージがない場合と、外部パッケージのロードで必ず失敗する trap がある場合の両方を検証します。出典と再利用範囲は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) に記載しています。

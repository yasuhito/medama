# medama

Markdown に書いたシナリオを実行する Ruby gem / CLI。初期版 `0.1.0` のソースを GitHub で公開しています。RubyGems へは公開していません。

Ruby 3.1 以上で実行できます。Ruby runner の実行時依存は標準ライブラリだけです。

```sh
git clone https://github.com/yasuhito/medama.git
cd medama
ruby bin/medama --require 'examples/features/step_definitions/*.rb' examples/features
ruby bin/medama --list --format json examples/features
```

Markdown の見出しに `Feature`、`Scenario` を書き、箇条書きに `Given`、`When`、`Then` を書きます。step の本文は日本語を使えます。

```markdown
# Feature: 足し算
## Scenario: 二つの数を足す
- Given 値は 2
- When 3 を足す
- Then 値は 5 になる
```

step は String の完全一致または Ruby の Regexp で定義します。Regexp の capture が引数になります。Cucumber Expressions の `{int}` などは Ruby runner では扱いません。

```ruby
Given(/\A値は (\d+)\z/) { |n| @value = n.to_i }
When(/\A(\d+) を足す\z/) { |n| @value += n.to_i }
Then(/\A値は (\d+) になる\z/) do |expected|
  raise "wrong result" unless @value == expected.to_i
end
```

各シナリオは新しい World で実行します。`World(MyHelpers)` で module を追加できます。`Before { ... }` と `After { ... }` を使え、`Before(tag: "@slow") { ... }` のように一つのタグへ限定できます。After は失敗時にも逆登録順で実行します。step 内の `pending "理由"` は非成功、`skip "理由"` は明示的な skip として記録します。

対応する構文:

- `# Feature:`、`## Scenario:`、`## Scenario Outline:`、`### Examples:`。見出しの深さは1-6。
- Feature に一つの `Background:`。すべてのシナリオ・Examples 行の前に実行。
- `-`、`+`、`*` の箇条書きに `Given / When / Then / And / But`。
- Examples の `<名前>` 置換。複数の Examples、Markdown 表の alignment 行、`\\`・`\|`・`\n` のセル escape。セルの backtick は保持。
- Feature / Scenario / Examples の前の `` `@tag` ``。タグは引き継ぎます。
- step 直後の三つの backtick による doc string、または表。Ruby には文字列または二次元配列として渡します。
- 説明文は実行しません。step に付属しない code fence の内部も実行しません。

実行構文と説明文は、Markdown の記法と既知の keyword を合わせて区別します。

- 実行 step は箇条書きにした `Given / When / Then / And / But` です。これらの keyword に直接 `:` を付けた `- And: ...` などは不正です。Feature より前・Feature の説明・Scenario 内のどこでもエラーになります。
- 箇条書きでない `Given ...` は説明文です。`- A note ...` のように step keyword で始まらない箇条書きや、`## Notes: prerequisites` のように構造 keyword でない見出しも説明文として許可します。
- step の keyword は基準 Cucumber と同じ既定の英語だけで判定します。英語の step keyword で始まらない bullet は説明文です。`- A note ...` は、他言語で `A` が keyword であっても説明文のままです。単独の `- ならば ...` も英語では step になりません。
- 公式 Gherkin 42.0.0 の keyword 表で既知の構造見出しを識別します。未対応の `## シナリオ:`、`Rule:`、`# language: ja` などは実行せずエラーになります。多言語 keyword を実行する機能はありません。日本語の step 本文・表の値は引き続き使用できます。
- code fence 内部と引用内は説明として扱います。step に付けた doc string 内部は文字列のまま渡し、keyword を解釈しません。doc string の本文は元の fence の字下げから正規化し、本文内の相対的な字下げを保ちます。

未対応構文の識別のために keyword 表だけを同梱しています。多言語シナリオを実行する機能や Cucumber parser の移植は含みません。

```sh
ruby bin/medama --tag @smoke --exclude-tag @slow features
ruby bin/medama --format json features
```

`--tag` は繰り返すと AND、`--exclude-tag` はいずれかに一致したケースを除外します。既定の Ruby step の読み込み先は `features/support/**/*.rb` と `features/step_definitions/**/*.rb` です。`--require` を指定するとその指定だけを読み込みます。`--list` は構文検査とケース展開だけを行い、step を読み込みません。

終了コードは成功・明示的 skip が `0`、step/hook の失敗・undefined・ambiguous・pending が `1`、不正な構文・設定・空の選択が `2` です。JSON は件数、シナリオ、step/hook の状態、元 Markdown のパスと行番号を返します。

pi-formula の既存 JavaScript step を試すには、プロジェクト側にインストール済みの Cucumber.js を使います。

```sh
cd /path/to/pi-formula
npm run build
ruby /path/to/medama/bin/medama --adapter cucumber-js \
  --require 'features/step_definitions/**/*.js' 'features/**/*.feature.md'
```

アダプターは medama で Markdown を検査し、一時 Gherkin ファイルへ行番号を保って変換します。既存 JavaScript step と hook は Cucumber の公開 interface で実行します。結果のケース数・名前・元行番号を medama の実行計画と照合します。Cucumber の設定ファイル、report publish、parallel、retry は使いません。medama は npm install や build を自動実行しません。pi-formula の既存シナリオ自体は build・pack・一時インストールを行うため、作業中 checkout を保持したい場合は隔離コピー上で実行してください。

未対応: Rule、Gherkin の多言語キーワード、Scenario Template / Example の別名、`*` の step キーワード、tag boolean expression、Cucumber の profile / plugin / message protocol / parallel / retry、Ruby の Cucumber Expressions・custom parameter types・callback async・Cucumber World interface。JavaScript step のこれらの挙動は既存 Cucumber が担当しますが、medama の CLI から全設定を公開するものではありません。

構文の省略や不正な Examples を黙って成功にしません。0件のファイル・ケース選択、空シナリオ、Examples 欠落、未定義 placeholder はエラーです。

ローカル検証と gem 作成:

```sh
bundle install
bundle exec ruby test/medama_test.rb
MEDAMA_CUCUMBER_NODE_MODULES=/path/to/project/node_modules bundle exec ruby test/adapter/cucumber_test.rb
gem build medama.gemspec --output /tmp/medama-0.1.0.gem
```

テストは CLI の出力・終了コードを観測します。開発依存は Gemfile に定義しています。adapter テストには Cucumber.js 13.2.1 が必要です。GitHub Actions は Ruby 3.4 と Node.js 24 で両テストを実行し、adapter 用依存は runner の一時ディレクトリにインストールします。`THIRD_PARTY_NOTICES.md` に初期実証の出典と再利用範囲を記録しています。

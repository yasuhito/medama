# Ruby prototype

将来の gem 提供に向けて、既存の自前 Ruby parser / runner を保持しています。現 milestone は npm の CLI で pi-formula を実行することです。Ruby の全面的な Cucumber 互換や gem 公開は、この milestone の受入範囲に含めません。

Ruby の実行経路は自前 runner だけです。以前の Cucumber.js bridge は使いません。共通の Markdown corpus は `../spec/markdown_cases.json` にあり、Node と Ruby の両方で同じ入力を検証します。

```sh
cd ruby
ruby test/medama_test.rb
ruby test/shared_corpus_test.rb
```

Ruby ソースは npm tarball に含めません。公開済みの旧 Ruby 版と、その履歴・固定 archive は保持しています。gem registry への公開はしていません。

# frozen_string_literal: true

require "minitest/autorun"
require "open3"
require "tmpdir"
require "json"
require "rbconfig"
require "fileutils"

class CucumberAdapterTest < Minitest::Test
  CLI = File.expand_path("../../bin/medama", __dir__)
  NODE_MODULES = ENV.fetch("MEDAMA_CUCUMBER_NODE_MODULES")

  def trial(markdown, steps, *options)
    Dir.mktmpdir("medama-adapter-test-") do |directory|
      FileUtils.ln_s(NODE_MODULES, File.join(directory, "node_modules"))
      File.write(File.join(directory, "package.json"), '{"name":"medama-adapter-fixture"}')
      File.write(File.join(directory, "sample.feature.md"), markdown)
      File.write(File.join(directory, "steps.cjs"), <<~JS + steps)
        const assert = require('node:assert/strict');
        const { Given, When, Then, Before, After } = require('@cucumber/cucumber');
      JS
      yield Open3.capture3(RbConfig.ruby, CLI, "--adapter", "cucumber-js", "--format", "json",
                          "--require", "steps.cjs", *options, "sample.feature.md", chdir: directory)
    end
  end

  def test_existing_cucumber_steps_hooks_and_outline_run
    source = "`@suite`\n# Feature: sum\n## Background: start\n- Given start at ten\n## Scenario Outline: add <n>\n- When add <n>\n- Then equals <result>\n### Examples:\n  | n | result |\n  | --- | --- |\n  | 2 | 12 |\n  | 3 | 13 |\n"
    steps = <<~JS
      Before({tags: '@suite'}, function() { this.prepared = true; });
      Given('start at ten', function() { this.n = this.prepared ? 10 : -1; });
      When('add {int}', function(n) { this.n += n; });
      Then('equals {int}', function(n) { assert.equal(this.n, n); });
    JS
    trial(source, steps) { |out, _, _| assert_equal({"passed" => 2}, JSON.parse(out)["counts"]) }
  end

  def test_cucumber_receives_table_and_doc_string_arguments
    source = "# Feature: args\n## Scenario: table\n- Then table\n  | key | value |\n  | --- | --- |\n  | a | one\\|two |\n## Scenario: doc\n- Then doc\n  ```text\n  ## Scenario: literal\n  ```\n"
    steps = <<~JS
      Then('table', function(table) { assert.deepEqual(table.rows(), [['a', 'one|two']]); });
      Then('doc', function(body) { assert.equal(body, '## Scenario: literal'); });
    JS
    trial(source, steps) { |out, _, _| assert_equal({"passed" => 2}, JSON.parse(out)["counts"]) }
  end

  def test_cucumber_tag_selection_matches_medama_plan
    source = "# Feature: tags\n`@keep`\n## Scenario: yes\n- Then okay\n`@drop`\n## Scenario: no\n- Then undefined\n"
    trial(source, "Then('okay', function() {});", "--exclude-tag", "@drop") do |out, _, _|
      assert_equal({"passed" => 1}, JSON.parse(out)["counts"])
    end
  end

  def test_cucumber_failure_is_nonzero
    trial("# Feature: failure\n## Scenario: fail\n- Then bad\n", "Then('bad', function() { assert.equal(1, 2); });") do |_, _, status|
      assert_equal(1, status.exitstatus)
    end
  end

  def test_cucumber_failure_points_to_markdown_line
    trial("# Feature: failure\n\n## Scenario: fail\n\n- Then bad\n", "Then('bad', function() { throw new Error('observed'); });") do |out, _, _|
      assert_equal(5, JSON.parse(out)["scenarios"][0]["steps"][0]["line"])
    end
  end

  def test_cucumber_undefined_step_does_not_pass
    trial("# Feature: undefined\n## Scenario: missing\n- Then missing\n", "Then('other', function() {});") do |out, _, _|
      assert_equal({"undefined" => 1}, JSON.parse(out)["counts"])
    end
  end

  def test_cucumber_after_failure_does_not_pass
    trial("# Feature: hooks\n## Scenario: cleanup\n- Then okay\n", "Then('okay', function() {}); After(function() { throw new Error('cleanup failed'); });") do |out, _, _|
      assert_equal({"failed" => 1}, JSON.parse(out)["counts"])
    end
  end

  def test_cucumber_before_skip_is_reported
    trial("# Feature: skip\n## Scenario: optional\n- Then okay\n", "Before(function() { return 'skipped'; }); Then('okay', function() {});") do |out, _, _|
      assert_equal({"skipped" => 1}, JSON.parse(out)["counts"])
    end
  end

  %w[Given When Then And But].each do |keyword|
    define_method("test_rejects_colon_after_#{keyword.downcase}") do
      source = "# Feature: invalid step\n## Scenario: probe\n- Then okay\n- #{keyword}: forbidden\n"
      trial(source, "Then('okay', function() {});") { |_, _, status| assert_equal(2, status.exitstatus) }
    end
  end

  {
    "mixed_language" => "## シナリオ: unsupported\n- ならば forbidden\n",
    "unknown_executable_heading" => "## Example: unsupported\n- Then okay\n"
  }.each do |name, extra|
    define_method("test_rejects_#{name}") do
      source = "# Feature: invalid execution\n## Scenario: probe\n- Then okay\n#{extra}"
      trial(source, "Then('okay', function() {});") { |_, _, status| assert_equal(2, status.exitstatus) }
    end
  end

  def test_unbulleted_keyword_line_is_prose
    trial("# Feature: invalid execution\n## Scenario: probe\n- Then okay\nAnd forbidden\n", "Then('okay', function() {});") do |out, _, _|
      assert_equal({"passed" => 1}, JSON.parse(out)["counts"])
    end
  end

  %w[Given When Then And But].each do |keyword|
    {
      "before_feature" => "- #{keyword}: forbidden\n# Feature: malformed\n",
      "before_scenario" => "# Feature: malformed\n- #{keyword}: forbidden\n"
    }.each do |position, preamble|
      define_method("test_rejects_#{keyword.downcase}_colon_#{position}") do
        trial(preamble + "## Scenario: okay\n- Then okay\n", "Then('okay', function() {});") do |_, _, status|
          assert_equal(2, status.exitstatus)
        end
      end
    end
  end

  {
    "notes_heading" => "## Notes: prerequisites\nThe cache is populated in preparation.\n",
    "bullet_description" => "- A note about this scenario.\n",
    "given_paragraph" => "Given the context, this paragraph describes the intended outcome.\n",
    "blockquote" => "> - And: quoted description\n",
    "fenced_example" => "```markdown\n## シナリオ: illustrative only\n- And: forbidden\n```\n"
  }.each do |name, description|
    define_method("test_accepts_#{name}_as_prose") do
      trial("# Feature: prose\n## Scenario: okay\n#{description}- Then okay\n", "Then('okay', function() {});") do |out, _, _|
        assert_equal({"passed" => 1}, JSON.parse(out)["counts"])
      end
    end
  end

  {
    "french_heading" => "## Scénario: unsupported\n",
    "german_heading" => "## Szenario: unsupported\n",
    "spanish_heading" => "## Escenario: unsupported\n",
    "language_directive" => "# language: ja\n"
  }.each do |name, syntax|
    define_method("test_rejects_known_#{name}") do
      trial("# Feature: mixed language\n## Scenario: okay\n- Then okay\n#{syntax}", "Then('okay', function() {});") do |_, _, status|
        assert_equal(2, status.exitstatus)
      end
    end
  end

  %w[ならば Dann Entonces A].each_with_index do |keyword, index|
    define_method("test_non_english_bullet_#{index}_is_prose_in_default_dialect") do
      source = "# Feature: invalid execution\n## Scenario: probe\n- Then okay\n- #{keyword} forbidden\n"
      trial(source, "Then('okay', function() {});") { |out, _, _| assert_equal({"passed" => 1}, JSON.parse(out)["counts"]) }
    end
  end

  ["", "  ", "    ", "        ", "\t"].each_with_index do |indent, index|
    define_method("test_doc_string_indent_#{index}") do
      source = "# Feature: doc indent\n## Scenario: body\n- Then doc\n#{indent}```text\n#{indent}foo\n#{indent}  nested\n#{indent}```\n"
      trial(source, "Then('doc', function(body) { assert.equal(body, 'foo\\n  nested'); });") do |out, _, _|
        assert_equal({"passed" => 1}, JSON.parse(out)["counts"])
      end
    end
  end
end

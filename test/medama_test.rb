# frozen_string_literal: true

require "minitest/autorun"
require "open3"
require "tmpdir"
require "json"
require "rbconfig"

class MedamaTest < Minitest::Test
  CLI = File.expand_path("../bin/medama", __dir__)

  def trial(markdown, steps = "", *options)
    Dir.mktmpdir("medama-test-") do |directory|
      File.write(File.join(directory, "sample.feature.md"), markdown)
      File.write(File.join(directory, "steps.rb"), steps)
      yield Open3.capture3(RbConfig.ruby, CLI, "--format", "json", "--require", "steps.rb", *options,
                          "sample.feature.md", chdir: directory)
    end
  end

  def test_markdown_scenario_runs_real_ruby_steps
    trial("# Feature: arithmetic\n## Scenario: sum\n- Given two\n- When add three\n- Then five\n",
          'Given("two") { @number = 2 }; When("add three") { @number += 3 }; Then("five") { raise "wrong" unless @number == 5 }') do |out, _, _|
      assert_equal({"passed" => 1}, JSON.parse(out).fetch("counts"))
    end
  end

  def test_outline_runs_every_examples_row_with_background
    source = <<~MD
      `@math`
      # Feature: arithmetic
      ## Background: start
      - Given start at ten
      ## Scenario Outline: add <n>
      - When add <n>
      - Then equals <result>
      ### Examples:
        | n | result |
        | :--- | ---: |
        | 2 | 12 |
        | 3 | 13 |
    MD
    steps = 'Given("start at ten") { @n = 10 }; When(/add (\d+)/) { |v| @n += v.to_i }; Then(/equals (\d+)/) { |v| raise "wrong" unless @n == v.to_i }'
    trial(source, steps) { |out, _, _| assert_equal({"passed" => 2}, JSON.parse(out)["counts"]) }
  end

  def test_list_retains_markdown_source_lines
    source = "# Feature: list\n\n## Scenario Outline: value <x>\n- Then <x>\n### Examples:\n  | x |\n  | --- |\n  | a |\n  | b |\n"
    trial(source, "raise 'steps must not be loaded'", "--list") do |out, _, _|
      assert_equal([8, 9], JSON.parse(out)["scenarios"].map { |s| s["line"] })
    end
  end

  def test_list_keeps_backticks_and_decodes_table_escapes
    source = '# Feature: escapes' + "\n## Scenario Outline: <x>\n- Then <x>\n### Examples:\n  | x |\n  | --- |\n  | `\\\\macro` \\| tail |\n"
    trial(source, "", "--list") do |out, _, _|
      assert_equal('`\\macro` | tail', JSON.parse(out)["scenarios"][0]["steps"][0]["text"])
    end
  end

  def test_trailing_escaped_backslash_is_preserved_in_a_table
    source = "# Feature: escapes\n## Scenario: table\n- Then inspect\n  | left\\\\| right |\n"
    trial(source, 'Then("inspect") { |rows| raise "wrong" unless rows == [["left\\\\", "right"]] }') do |out, _, _|
      assert_equal({"passed" => 1}, JSON.parse(out)["counts"])
    end
  end

  def test_doc_string_preserves_literal_structural_lines
    source = "# Feature: doc\n## Scenario: body\n- Then inspect\n  ```text\n  ## Scenario: literal\n  - Then literal\n  ```\n"
    trial(source, 'Then("inspect") { |body| raise body.inspect unless body == "## Scenario: literal\n- Then literal" }') do |out, _, _|
      assert_equal({"passed" => 1}, JSON.parse(out)["counts"])
    end
  end

  def test_prose_and_example_code_outside_steps_are_not_executed
    source = "# Feature: prose\nA description.\n```markdown\n## Scenario: example only\n- Then undefined\n```\n## Scenario: real\nSome explanation.\n- Then okay\n"
    trial(source, 'Then("okay") {}') { |out, _, _| assert_equal({"passed" => 1}, JSON.parse(out)["counts"]) }
  end

  def test_world_is_fresh_for_each_scenario
    source = "# Feature: worlds\n## Scenario: first\n- Given remember\n- Then remembered\n## Scenario: second\n- Then empty\n"
    trial(source, 'Given("remember") { @value = true }; Then("remembered") { raise unless @value }; Then("empty") { raise if @value }') do |out, _, _|
      assert_equal({"passed" => 2}, JSON.parse(out)["counts"])
    end
  end

  def test_failed_step_returns_one
    trial("# Feature: failure\n## Scenario: fail\n- Then broken\n", 'Then("broken") { raise "observed failure" }') do |_, _, status|
      assert_equal(1, status.exitstatus)
    end
  end

  def test_remaining_steps_do_not_run_after_failure
    trial("# Feature: failure\n## Scenario: fail\n- When broken\n- Then forbidden\n", 'When("broken") { raise "broken" }; Then("forbidden") { raise "must not run" }') do |out, _, _|
      assert_equal("skipped", JSON.parse(out)["scenarios"][0]["steps"][1]["status"])
    end
  end

  def test_after_hook_runs_on_a_failed_scenario
    trial("# Feature: cleanup\n## Scenario: fail\n- Then broken\n", 'Then("broken") { raise "broken" }; After { raise "cleanup observed" }') do |out, _, _|
      assert_match(/cleanup observed/, JSON.parse(out)["scenarios"][0]["hooks"][0]["error"])
    end
  end

  def test_after_hook_failure_fails_scenario
    trial("# Feature: cleanup\n## Scenario: okay\n- Then okay\n", 'Then("okay") {}; After { raise "cleanup failed" }') do |out, _, _|
      assert_equal({"failed" => 1}, JSON.parse(out)["counts"])
    end
  end

  def test_after_hooks_run_in_reverse_order
    trial("# Feature: cleanup\n## Scenario: okay\n- Then okay\n", 'Then("okay") {}; After { raise "wrong order" unless @cleanup }; After { @cleanup = true }') do |out, _, _|
      assert_equal({"passed" => 1}, JSON.parse(out)["counts"])
    end
  end

  def test_pending_does_not_pass
    trial("# Feature: pending\n## Scenario: work\n- Then todo\n", 'Then("todo") { pending "later" }') do |_, _, status|
      assert_equal(1, status.exitstatus)
    end
  end

  def test_undefined_step_reports_failure
    trial("# Feature: undefined\n## Scenario: missing\n- Then missing\n", 'Then("other") {}') do |out, _, _|
      assert_match(/undefined step: missing/, JSON.parse(out)["scenarios"][0]["steps"][0]["error"])
    end
  end

  def test_ambiguous_step_reports_failure
    trial("# Feature: ambiguous\n## Scenario: duplicate\n- Then duplicate\n", 'Then("duplicate") {}; Then(/duplicate/) {}') do |out, _, _|
      assert_match(/ambiguous step/, JSON.parse(out)["scenarios"][0]["steps"][0]["error"])
    end
  end

  def test_tag_filter_and_tagged_hook_use_inherited_tags
    source = "`@suite`\n# Feature: tags\n`@keep`\n## Scenario: kept\n- Then okay\n`@drop`\n## Scenario: excluded\n- Then undefined\n"
    trial(source, 'Before(tag: "@suite") { @ready = true }; Then("okay") { raise unless @ready }', "--tag", "@suite", "--exclude-tag", "@drop") do |out, _, _|
      assert_equal({"passed" => 1}, JSON.parse(out)["counts"])
    end
  end

  def test_empty_selection_is_an_error
    trial("# Feature: tags\n## Scenario: a\n- Then okay\n", 'Then("okay") {}', "--tag", "@missing") do |_, _, status|
      assert_equal(2, status.exitstatus)
    end
  end

  def test_step_output_does_not_corrupt_json
    trial("# Feature: output\n## Scenario: output\n- Then okay\n", 'puts "loading steps"; Then("okay") { puts "step output" }') do |out, _, _|
      assert_equal({"passed" => 1}, JSON.parse(out)["counts"])
    end
  end

  def test_first_failed_before_hook_stops_later_before_hooks
    trial("# Feature: hooks\n## Scenario: before\n- Then okay\n", 'Before { raise "first" }; Before { raise "second must not run" }; Then("okay") {}') do |out, _, _|
      assert_equal(1, JSON.parse(out)["scenarios"][0]["hooks"].size)
    end
  end

  def test_world_module_can_supply_step_helpers
    trial("# Feature: helper\n## Scenario: helper\n- Then helper works\n", 'module Helpers; def expected; 42; end; end; World(Helpers); Then("helper works") { raise unless expected == 42 }') do |out, _, _|
      assert_equal({"passed" => 1}, JSON.parse(out)["counts"])
    end
  end

  def test_explicit_skip_is_reported
    trial("# Feature: skip\n## Scenario: skip\n- Then optional\n", 'Then("optional") { skip "no device" }') do |out, _, _|
      assert_equal({"skipped" => 1}, JSON.parse(out)["counts"])
    end
  end

  def test_assertion_errors_are_reported_and_later_scenarios_run
    source = "# Feature: assertions\n## Scenario: fail\n- Then bad assertion\n## Scenario: continue\n- Then okay\n"
    trial(source, 'require "minitest"; Then("bad assertion") { raise Minitest::Assertion, "wrong" }; Then("okay") {}') do |out, _, _|
      assert_equal({"failed" => 1, "passed" => 1}, JSON.parse(out)["counts"])
    end
  end

  def test_loading_a_broken_step_file_returns_setup_error
    trial("# Feature: setup\n## Scenario: okay\n- Then okay\n", 'raise "step file setup failed"') do |_, _, status|
      assert_equal(2, status.exitstatus)
    end
  end

  %w[Given When Then And But].each do |keyword|
    define_method("test_rejects_colon_after_#{keyword.downcase}") do
      source = "# Feature: invalid step\n## Scenario: probe\n- Then okay\n- #{keyword}: forbidden\n"
      trial(source, 'Then("okay") {}') { |_, _, status| assert_equal(2, status.exitstatus) }
    end
  end

  {
    "mixed_language" => "## シナリオ: unsupported\n- ならば forbidden\n",
    "unknown_executable_heading" => "## Example: unsupported\n- Then okay\n"
  }.each do |name, extra|
    define_method("test_rejects_#{name}") do
      source = "# Feature: invalid execution\n## Scenario: probe\n- Then okay\n#{extra}"
      trial(source, 'Then("okay") {}') { |_, _, status| assert_equal(2, status.exitstatus) }
    end
  end

  # Markdown without a step bullet is prose, including English keyword starts.
  # This source is unchanged from candidate2; the expectation follows the
  # independent QA fixtures and the baseline Markdown parser's grammar.
  def test_unbulleted_keyword_line_is_prose
    trial("# Feature: invalid execution\n## Scenario: probe\n- Then okay\nAnd forbidden\n", 'Then("okay") {}') do |out, _, _|
      assert_equal({"passed" => 1}, JSON.parse(out)["counts"])
    end
  end

  %w[Given When Then And But].each do |keyword|
    {
      "before_feature" => "- #{keyword}: forbidden\n# Feature: malformed\n",
      "before_scenario" => "# Feature: malformed\n- #{keyword}: forbidden\n"
    }.each do |position, preamble|
      define_method("test_rejects_#{keyword.downcase}_colon_#{position}") do
        trial(preamble + "## Scenario: okay\n- Then okay\n", 'Then("okay") {}') do |_, _, status|
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
      trial("# Feature: prose\n## Scenario: okay\n#{description}- Then okay\n", 'Then("okay") {}') do |out, _, _|
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
      trial("# Feature: mixed language\n## Scenario: okay\n- Then okay\n#{syntax}", 'Then("okay") {}') do |_, _, status|
        assert_equal(2, status.exitstatus)
      end
    end
  end

  # With no foreign structural heading or language directive, a bullet with
  # no English step keyword is prose in the baseline's default English dialect.
  %w[ならば Dann Entonces A].each_with_index do |keyword, index|
    define_method("test_non_english_bullet_#{index}_is_prose_in_default_dialect") do
      source = "# Feature: invalid execution\n## Scenario: probe\n- Then okay\n- #{keyword} forbidden\n"
      trial(source, 'Then("okay") {}') { |out, _, _| assert_equal({"passed" => 1}, JSON.parse(out)["counts"]) }
    end
  end

  ["", "  ", "    ", "        ", "\t"].each_with_index do |indent, index|
    define_method("test_doc_string_indent_#{index}") do
      source = "# Feature: doc indent\n## Scenario: body\n- Then doc\n#{indent}```text\n#{indent}foo\n#{indent}  nested\n#{indent}```\n"
      trial(source, 'Then("doc") { |body| raise body.inspect unless body == "foo\n  nested" }') do |out, _, _|
        assert_equal({"passed" => 1}, JSON.parse(out)["counts"])
      end
    end
  end

  {
    "outline_without_examples" => "# Feature: invalid\n## Scenario Outline: missing\n- Then <x>\n",
    "empty_scenario" => "# Feature: invalid\n## Scenario: empty\n",
    "empty_examples" => "# Feature: invalid\n## Scenario Outline: empty\n- Then <x>\n### Examples:\n  | x |\n  | --- |\n",
    "inconsistent_examples" => "# Feature: invalid\n## Scenario Outline: wrong width\n- Then <x>\n### Examples:\n  | x |\n  | a | b |\n",
    "unknown_placeholder" => "# Feature: invalid\n## Scenario Outline: <missing>\n- Then <x>\n### Examples:\n  | x |\n  | a |\n",
    "rule" => "# Feature: invalid\n## Rule: unsupported\n## Scenario: a\n- Then okay\n",
    "unclosed_fence" => "# Feature: invalid\n## Scenario: a\n- Then okay\n  ```\n  never closed\n",
    "dangling_tags" => "# Feature: invalid\n## Scenario: a\n- Then okay\n`@forgotten`\n",
    "malformed_scenario_heading" => "# Feature: invalid\n## Scenario: a\n- Then okay\n## Scenario missing colon\n- Then accidentally appended\n"
  }.each do |name, source|
    define_method("test_rejects_#{name}") do
      trial(source, "", "--list") { |_, _, status| assert_equal(2, status.exitstatus) }
    end
  end
end

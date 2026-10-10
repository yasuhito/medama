# frozen_string_literal: true

require "minitest/autorun"
require "json"
require "open3"
require "tmpdir"
require "rbconfig"

class SharedCorpusTest < Minitest::Test
  CLI = File.expand_path("../bin/medama", __dir__)
  JSON.parse(File.read(File.expand_path("../../spec/markdown_cases.json", __dir__))).each do |entry|
    define_method("test_#{entry.fetch('name').gsub(/\W+/, '_')}") do
      Dir.mktmpdir("medama-shared-ruby-") do |directory|
        File.write(File.join(directory, "sample.feature.md"), entry.fetch("source"))
        out, _, status = Open3.capture3(RbConfig.ruby, CLI, "--list", "--format", "json", "sample.feature.md", chdir: directory)
        if entry["error"]
          assert_equal(2, status.exitstatus)
        else
          cases = JSON.parse(out).fetch("scenarios")
          selections = {
            "names" => cases.map { |c| c.fetch("name") }, "lines" => cases.map { |c| c.fetch("line") },
            "texts" => cases.map { |c| c.fetch("steps").map { |s| s.fetch("text") } },
            "tags" => cases.map { |c| c.fetch("tags") },
            "arguments" => cases.map { |c| c.fetch("steps").map { |s| s["argument"] } }
          }
          key = entry.fetch("expected").keys.first
          assert_equal(entry.fetch("expected").fetch(key), selections.fetch(key))
        end
      end
    end
  end
end

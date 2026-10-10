# frozen_string_literal: true

require "json"

module Medama
  class Error < StandardError; end

  # English structural keywords; step text and example headers may be Unicode.
  # The generated Gherkin retains every original line for adapter diagnostics.
  class Parser
    # Data only, from Gherkin 42.0.0. See vendor/gherkin/LICENSE and
    # THIRD_PARTY_NOTICES.md. Recognize reserved syntax without mistaking
    # ordinary Markdown headings and list items for executable steps.
    DIALECTS = JSON.parse(File.read(File.join(__dir__, "vendor/gherkin/gherkin-languages.json"))).freeze
    HEADING_KEYWORDS = DIALECTS.values.flat_map do |dialect|
      %w[feature background rule scenario scenarioOutline examples].flat_map { |kind| dialect.fetch(kind) }
    end.uniq.sort_by { |keyword| -keyword.length }.freeze
    # A prose bullet in English must not become a Czech/Welsh conjunction:
    # "A " is a step keyword in those dialects. Only the default dialect
    # defines step syntax; foreign structural headings are detected above.
    STEP_KEYWORDS = %w[given when then and but].flat_map do |kind|
      DIALECTS.fetch("en").fetch(kind)
    end.uniq.freeze
    KNOWN_HEADING = /\A\s*\#{1,6}\s+(?:#{Regexp.union(HEADING_KEYWORDS)})\s*[:：]/
    BULLET = /\A\s*[-+*]\s+(.*)\z/

    def initialize(source, path)
      @lines = source.lines.map { |line| line.delete_suffix("\n").delete_suffix("\r") }
      @path = path
      @gherkin = Array.new(@lines.length, "")
      @scenarios = []
      @tags = []
      @background = []
    end

    def parse
      @lines.each_with_index { |raw, index| consume(raw, index + 1) }
      fail_at(@fence[:line], "unclosed code fence") if @fence
      fail_at(@lines.size, "tags must precede a Feature, Scenario or Examples heading") unless @tags.empty?
      fail_at(1, "expected # Feature: heading") unless @feature
      fail_at(1, "no scenarios") if @scenarios.empty?
      cases = @scenarios.flat_map { |scenario| expand(scenario) }
      { path: @path, feature: @feature, cases: cases, gherkin: @gherkin.join("\n") + "\n" }
    end

    private

    def consume(raw, line)
      if @fence
        if raw.strip == @fence[:delimiter]
          @gherkin[line - 1] = raw if @fence[:step]
          @fence = nil
        elsif @fence[:step]
          content = raw.sub(/\A\s{0,#{@fence[:indent]}}/, "")
          @fence[:step][:argument][:content] << content
          @gherkin[line - 1] = raw
        end
        return
      end
      if (match = raw.match(/\A\s*(`{3,}|~{3,})(.*)\z/))
        if @step && match[1] != "```"
          fail_at(line, "step doc strings require a three-backtick fence")
        end
        @fence = { delimiter: match[1], line: line, indent: raw[/\A\s*/].size, step: @step }
        if @step
          fail_at(line, "step already has an argument") if @step[:argument]
          @step[:argument] = { type: "doc_string", content: [], media_type: match[2].strip }
          # Cucumber deindents against this opening fence. Keep its source
          # indentation with the body, just as the native runner does above.
          @gherkin[line - 1] = raw
        end
        return
      end
      return if raw.strip.empty?
      if raw.match?(/\A\s*\#\s*language:\s*(?!en\s*\z)\S+/)
        fail_at(line, "unsupported language directive; medama executes English structural keywords")
      end
      if (match = raw.match(/\A\s*\#{1,6}\s+(Feature|Background|Scenario Outline|Scenario|Examples):\s*(.*)\z/))
        heading(match[1], match[2], line)
        @gherkin[line - 1] = "#{match[1]}: #{match[2]}"
      elsif raw.match?(/\A\s*\#{1,6}\s+(Rule|Scenario Template|Example):/)
        fail_at(line, "unsupported heading (Rule, Scenario Template and Example are not supported)")
      elsif raw.match?(/\A\s*\#{1,6}\s+(Feature|Background|Scenario|Examples)\b/)
        fail_at(line, "malformed scenario heading; expected Keyword: name")
      elsif raw.match?(KNOWN_HEADING)
        fail_at(line, "unsupported executable heading; structural keywords must be English")
      elsif (match = raw.match(/\A\s*[-+*]\s+(Given|When|Then|And|But)\s+(.+)\z/))
        fail_at(line, "step outside a scenario or background") unless @steps && !@examples
        @step = { keyword: match[1], text: match[2].strip, line: line }
        @steps << @step
        @gherkin[line - 1] = "  #{match[1]} #{match[2].strip}"
      elsif raw.match?(/\A\s*[-+*]\s+(Given|When|Then|And|But)\s*\z/)
        fail_at(line, "empty step")
      elsif (bullet = raw.match(BULLET)) && executable_bullet?(bullet[1])
        fail_at(line, "unsupported step syntax; expected Given, When, Then, And or But followed by a space")
      elsif raw.match?(/\A\s*\|/)
        table(raw, line)
      elsif raw.strip.start_with?("`@", "@")
        tokens = raw.scan(/`(@[^`\s]+)`/).flatten
        tokens = raw.strip.split if raw.strip.start_with?("@")
        remaining = raw.gsub(/`(@[^`\s]+)`/, "").strip
        if tokens.empty? || (!raw.strip.start_with?("@") && !remaining.empty?) || tokens.any? { |t| !t.match?(/\A@[^\s`]+\z/) }
          fail_at(line, "invalid tag line")
        end
        @tags.concat(tokens)
        @step = nil
        @gherkin[line - 1] = tokens.join(" ")
      else
        @step = nil
      end
    end

    def executable_bullet?(body)
      STEP_KEYWORDS.any? do |keyword|
        stem = keyword.rstrip
        body.start_with?(keyword, "#{stem}:", "#{stem}：") || body == stem
      end
    end

    def heading(kind, name, line)
      @step = nil
      @examples = nil
      fail_at(line, "heading before Feature") if kind != "Feature" && !@feature
      case kind
      when "Feature"
        fail_at(line, "multiple features in one file") if @feature
        @feature = name
        @feature_tags = take_tags
        @steps = nil
      when "Background"
        fail_at(line, "Background must precede scenarios and occur once") if @background_seen || !@scenarios.empty? || !@tags.empty?
        @background_seen = true
        @steps = @background
      when "Scenario", "Scenario Outline"
        @scenario = { name: name, line: line, outline: kind == "Scenario Outline", tags: take_tags,
                      steps: [], examples: [] }
        @scenarios << @scenario
        @steps = @scenario[:steps]
      when "Examples"
        fail_at(line, "Examples requires Scenario Outline") unless @scenario && @scenario[:outline]
        @examples = { rows: [], tags: take_tags, line: line }
        @scenario[:examples] << @examples
      end
    end

    def take_tags
      tags = @tags
      @tags = []
      tags
    end

    def table(raw, line)
      fail_at(line, "table row must end with |") unless raw.rstrip.end_with?("|")
      cells = raw.strip[1...-1].split(/(?<!\\)(?:\\\\)*\K\|/, -1).map do |cell|
        cell.strip.gsub(/\\([n|\\])/) { Regexp.last_match(1) == "n" ? "\n" : Regexp.last_match(1) }
      end
      # Markdown alignment rows are presentation, not example values.
      return if cells.all? { |cell| cell.match?(/\A:?-+:?\z/) }
      if @examples
        @examples[:rows] << { cells: cells, line: line }
      elsif @step
        @step[:argument] ||= { type: "table", rows: [] }
        fail_at(line, "step already has a doc string") unless @step[:argument][:type] == "table"
        rows = @step[:argument][:rows]
        fail_at(line, "inconsistent table width") if !rows.empty? && rows.first.size != cells.size
        rows << cells
      else
        fail_at(line, "table outside Examples or a step")
      end
      @gherkin[line - 1] = raw
    end

    def expand(scenario)
      fail_at(scenario[:line], "scenario has no steps") if scenario[:steps].empty?
      return [make_case(scenario, nil, nil, [])] unless scenario[:outline]
      fail_at(scenario[:line], "Scenario Outline has no Examples") if scenario[:examples].empty?
      scenario[:examples].flat_map do |examples|
        header, *rows = examples[:rows]
        fail_at(examples[:line], "Examples requires a header and at least one row") if !header || rows.empty?
        keys = header[:cells]
        fail_at(header[:line], "empty or duplicate example header") if keys.any?(&:empty?) || keys.uniq.size != keys.size
        rows.map do |row|
          fail_at(row[:line], "inconsistent Examples width") unless row[:cells].size == keys.size
          make_case(scenario, keys.zip(row[:cells]).to_h, row[:line], examples[:tags])
        end
      end
    end

    def make_case(scenario, values, example_line, example_tags)
      replace = lambda do |text|
        next text unless values
        text.gsub(/<([^>]+)>/) do |placeholder|
          values.fetch(Regexp.last_match(1)) { fail_at(scenario[:line], "unknown example placeholder #{placeholder}") }
        end
      end
      steps = (@background + scenario[:steps]).map do |step|
        copy = step.merge(text: replace.call(step[:text]))
        argument = step[:argument]
        if argument
          copy[:argument] = if argument[:type] == "table"
                             { type: "table", rows: argument[:rows].map { |row| row.map { |v| replace.call(v) } } }
                           else
                             argument.merge(content: replace.call(argument[:content].join("\n")))
                           end
        end
        copy
      end
      { path: @path, feature: @feature, name: replace.call(scenario[:name]), line: example_line || scenario[:line],
        scenario_line: scenario[:line], tags: (@feature_tags + scenario[:tags] + example_tags).uniq, steps: steps }
    end

    def fail_at(line, message)
      raise Error, "#{@path}:#{line}: #{message}"
    end
  end
end

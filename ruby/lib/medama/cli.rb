# frozen_string_literal: true

require "optparse"

module Medama
  class CLI
    def self.run(argv, out: $stdout, err: $stderr)
      new(out, err).run(argv)
    end

    def initialize(out, err)
      @out, @err = out, err
      @options = { adapter: "ruby", format: "progress", require: [], include: [], exclude: [] }
    end

    def run(argv)
      argv = argv.dup
      parser = option_parser
      parser.parse!(argv)
      return 0 if @done
      raise Error, "the Ruby prototype supports only --adapter ruby; use the npm CLI for JavaScript" unless @options[:adapter] == "ruby"
      raise Error, "format must be progress or json" unless %w[progress json].include?(@options[:format])
      files = expand_paths(argv.empty? ? ["features"] : argv, ".feature.md")
      documents = files.map { |path| Medama.parse(File.read(path, encoding: "UTF-8"), path: path) }
      cases = documents.flat_map { |document| document[:cases] }.select do |scenario|
        @options[:include].all? { |tag| scenario[:tags].include?(tag) } &&
          @options[:exclude].none? { |tag| scenario[:tags].include?(tag) }
      end
      raise Error, "no scenarios selected" if cases.empty?
      if @options[:list]
        report(cases.map { |scenario| scenario.merge(status: "listed") })
        return 0
      end
      results = begin
                  defaults = ["features/support/**/*.rb", "features/step_definitions/**/*.rb"]
                  patterns = @options[:require].empty? ? defaults : @options[:require]
                  required = patterns.flat_map { |pattern| Dir.glob(pattern) }.uniq.sort
                  if !@options[:require].empty? && patterns.any? { |pattern| Dir.glob(pattern).empty? }
                    raise Error, "--require did not match a Ruby file"
                  end
                  raise Error, "no Ruby step files; use --require" if required.empty?
                  registry = Registry.new
                  with_step_output do
                    registry.load_files(required)
                    Runner.new(registry).run(cases)
                  end
                end
      report(results)
      results.any? { |result| !%w[passed skipped].include?(result[:status]) } ? 1 : 0
    rescue Error, OptionParser::ParseError, SystemCallError, EncodingError, LoadError, SyntaxError => error
      @err.puts("medama: #{error.message}")
      2
    end

    private

    def with_step_output
      previous_stdout = $stdout
      $stdout = @err if @options[:format] == "json"
      yield
    ensure
      $stdout = previous_stdout
    end

    def option_parser
      OptionParser.new do |parser|
        parser.banner = "Usage: medama [options] [features/**/*.feature.md ...]"
        parser.on("--adapter NAME", "ruby (default)") { |v| @options[:adapter] = v }
        parser.on("-r", "--require GLOB", "step/support files, repeatable") { |v| @options[:require] << v }
        parser.on("--tag TAG", "require tag, repeatable (AND)") { |v| tag(:include, v) }
        parser.on("--exclude-tag TAG", "exclude tag, repeatable") { |v| tag(:exclude, v) }
        parser.on("--list", "parse and list without loading or executing steps") { @options[:list] = true }
        parser.on("--format NAME", "progress (default) or json") { |v| @options[:format] = v }
        parser.on("-v", "--version") { @out.puts(VERSION); @done = true }
        parser.on("-h", "--help") { @out.puts(parser); @done = true }
      end
    end

    def tag(kind, value)
      raise Error, "expected one @tag, got #{value.inspect}" unless value.match?(/\A@[^\s`]+\z/)
      @options[kind] << value
    end

    def expand_paths(patterns, suffix)
      patterns.flat_map do |pattern|
        matches = if File.directory?(pattern)
                    Dir.glob(File.join(pattern, "**/*#{suffix}"))
                  else
                    Dir.glob(pattern)
                  end
        raise Error, "no feature files matched #{pattern.inspect}" if matches.empty?
        matches.each { |p| raise Error, "expected a #{suffix} file: #{p}" unless File.file?(p) && p.end_with?(suffix) }
        matches
      end.uniq.sort
    end

    def report(results)
      counts = results.each_with_object(Hash.new(0)) { |result, hash| hash[result[:status]] += 1 }
      if @options[:format] == "json"
        @out.puts(JSON.pretty_generate(version: VERSION, adapter: @options[:adapter], counts: counts, scenarios: results))
      else
        results.each do |result|
          @out.puts("#{result[:status].upcase} #{result[:path]}:#{result[:line]} #{result[:name]}")
          (result[:steps] + Array(result[:hooks])).each do |step|
            @out.puts("  #{step[:error]}") if step[:error]
          end
        end
        @out.puts("#{results.size} scenarios (#{counts.map { |status, count| "#{count} #{status}" }.join(', ')})")
      end
    end
  end
end

# frozen_string_literal: true

require "open3"
require "tmpdir"

module Medama
  class CucumberAdapter
    def initialize(options, err)
      @options, @err = options, err
    end

    def run(documents, cases)
      Dir.mktmpdir("medama-cucumber-") do |directory|
        paths = documents.each_with_index.map do |document, index|
          path = File.join(directory, "#{index}.feature")
          File.write(path, document[:gherkin])
          path
        end
        report = File.join(directory, "report.json")
        config = { paths: paths, require: @options[:require].empty? ? ["features/step_definitions/**/*.js"] : @options[:require],
                   tags: (@options[:include] + @options[:exclude].map { |tag| "not #{tag}" }).join(" and "), report: report }
        request = File.join(directory, "request.json")
        File.write(request, JSON.generate(config))
        script = File.expand_path("cucumber_bridge.cjs", __dir__)
        stdout, stderr, status = Open3.capture3("node", script, request)
        @err.print(stdout)
        @err.print(stderr)
        raise Error, "cucumber-js adapter failed (exit #{status.exitstatus}): no report" unless File.file?(report) && [0, 1].include?(status.exitstatus)
        raw = JSON.parse(File.read(report))
        mapped = raw.flat_map do |feature|
          index = paths.index(File.expand_path(feature.fetch("uri")))
          raise Error, "unrecognized cucumber report source #{feature['uri']}" unless index
          feature.fetch("elements").map do |element|
            original = cases.find { |c| c[:path] == documents[index][:path] && c[:line] == element["line"] }
            raise Error, "cucumber scenario does not match medama plan" unless original && original[:name] == element["name"]
            outcomes = element.fetch("steps").map do |step|
              { text: step["name"], line: step["line"], status: step.fetch("result").fetch("status"),
                error: step["result"]["error_message"] }.compact
            end
            statuses = outcomes.map { |step| step[:status] }
            result_status = %w[failed ambiguous undefined pending skipped].find { |s| statuses.include?(s) } || "passed"
            original.merge(status: result_status, steps: outcomes.reject { |step| step[:text].nil? },
                           hooks: outcomes.select { |step| step[:text].nil? })
          end
        end
        expected = cases.map { |c| [c[:path], c[:line]] }.sort
        actual = mapped.map { |c| [c[:path], c[:line]] }.sort
        raise Error, "cucumber report differs from medama plan (#{actual.size}/#{expected.size} scenarios)" unless actual == expected
        if status.exitstatus == 1 && mapped.all? { |r| %w[passed skipped].include?(r[:status]) }
          raise Error, "cucumber-js failed outside a scenario"
        end
        mapped
      end
    rescue JSON::ParserError, KeyError => error
      raise Error, "invalid cucumber-js report: #{error.message}"
    end
  end
end

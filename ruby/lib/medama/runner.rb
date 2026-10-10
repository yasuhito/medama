# frozen_string_literal: true

module Medama
  class Pending < StandardError; end
  class Skip < StandardError; end

  class World
    attr_reader :scenario

    def initialize(scenario)
      @scenario = scenario
    end

    def pending(message = "pending step")
      raise Pending, message
    end

    def skip(message = "skipped scenario")
      raise Skip, message
    end
  end

  class Registry
    attr_reader :definitions, :before, :after, :world_modules

    def initialize
      @definitions, @before, @after, @world_modules = [], [], [], []
    end

    def load_files(paths)
      paths.each do |path|
        instance_eval(File.read(path), path, 1)
      rescue StandardError, ScriptError => error
        raise Error, "#{path}: #{error.class}: #{error.message}"
      end
    end

    def Given(pattern, &block)
      raise Error, "step definition requires a String or Regexp and a block" unless (pattern.is_a?(String) || pattern.is_a?(Regexp)) && block
      @definitions << [pattern, block]
    end
    alias When Given
    alias Then Given
    alias And Given
    alias But Given

    def Before(tag: nil, &block)
      raise Error, "Before requires a block" unless block
      @before << [tag, block]
    end

    def After(tag: nil, &block)
      raise Error, "After requires a block" unless block
      @after << [tag, block]
    end

    def World(*modules)
      @world_modules.concat(modules)
    end
  end

  class Runner
    def initialize(registry)
      @registry = registry
    end

    def run(cases)
      cases.map { |scenario| run_case(scenario) }
    end

    private

    def run_case(scenario)
      world = World.new(scenario)
      @registry.world_modules.each { |mod| world.extend(mod) }
      result = scenario.merge(status: "passed", steps: [], hooks: [])
      @registry.before.each do |tag, block|
        break unless result[:status] == "passed"
        hook(world, result, tag, block)
      end
      scenario[:steps].each do |step|
        outcome = step.merge(status: "skipped")
        if result[:status] == "passed"
          begin
            matches = @registry.definitions.filter_map do |pattern, block|
              args = pattern.is_a?(String) ? ([] if pattern == step[:text]) : pattern.match(step[:text])&.captures
              [block, args] if args
            end
            raise Error, "undefined step: #{step[:text]}" if matches.empty?
            raise Error, "ambiguous step: #{step[:text]} (#{matches.size} definitions)" if matches.size > 1
            block, args = matches.first
            if step[:argument]
              args << (step[:argument][:type] == "table" ? step[:argument][:rows] : step[:argument][:content])
            end
            world.instance_exec(*args, &block)
            outcome[:status] = "passed"
          rescue Exception => error # assertion libraries can inherit directly from Exception
            raise if process_exception?(error)
            outcome.merge!(status: status_for(error), error: "#{error.class}: #{error.message}")
            result[:status] = outcome[:status]
          end
        end
        result[:steps] << outcome
      end
      result
    ensure
      @registry.after.reverse_each { |tag, block| hook(world, result, tag, block) } if world && result
    end

    def hook(world, result, tag, block)
      return if tag && !result[:tags].include?(tag)
      world.instance_exec(&block)
      result[:hooks] << { status: "passed" }
    rescue Exception => error # retain assertion failures in hook results too
      raise if process_exception?(error)
      status = status_for(error)
      result[:hooks] << { status: status, error: "#{error.class}: #{error.message}" }
      result[:status] = status if result[:status] == "passed" || status == "failed"
    end

    def status_for(error)
      case error
      when Skip then "skipped"
      when Pending then "pending"
      else "failed"
      end
    end

    def process_exception?(error)
      error.is_a?(SystemExit) || error.is_a?(SignalException) || error.is_a?(NoMemoryError)
    end
  end
end

# frozen_string_literal: true

require "json"
require_relative "medama/parser"
require_relative "medama/runner"
require_relative "medama/cli"

module Medama
  VERSION = "0.1.0"

  def self.parse(source, path: "<markdown>")
    Parser.new(source, path).parse
  end
end

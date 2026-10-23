# frozen_string_literal: true

require_relative "lib/medama"

Gem::Specification.new do |spec|
  spec.name = "medama"
  spec.version = Medama::VERSION
  spec.authors = ["Yasuhito Takamiya"]
  spec.homepage = "https://github.com/yasuhito/medama"
  spec.summary = "Run scenarios written in Markdown with Ruby steps."
  spec.description = "A Ruby runner for Markdown scenarios. The separate npm distribution provides JavaScript execution."
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.1"
  spec.files = Dir["lib/**/*", "bin/*", "examples/**/*", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"].select { |p| File.file?(p) }
  spec.bindir = "bin"
  spec.executables = ["medama"]
  spec.require_paths = ["lib"]
end

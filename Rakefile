# frozen_string_literal: true

require "rake/testtask"

Rake::TestTask.new do |task|
  task.libs << "lib"
  task.pattern = "test/*_test.rb"
end

namespace :test do
  Rake::TestTask.new(:cucumber) do |task|
    task.libs << "lib"
    task.pattern = "test/adapter/*_test.rb"
  end
end

task default: :test

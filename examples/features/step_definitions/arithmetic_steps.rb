# frozen_string_literal: true

Given(/\A値は (\d+)\z/) { |value| @value = value.to_i }
When(/\A(\d+) を足す\z/) { |value| @value += value.to_i }
Then(/\A値は (\d+) になる\z/) do |expected|
  raise "expected #{expected}, got #{@value}" unless @value == expected.to_i
end

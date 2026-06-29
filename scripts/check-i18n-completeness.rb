#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"

ROOT = File.expand_path("..", __dir__)
CONFIG_PATH = File.join(ROOT, "_config.yml")
I18N_DIR = File.join(ROOT, "_data", "i18n")

def flatten_keys(value, prefix = nil, keys = [])
  case value
  when Hash
    value.each do |key, child|
      child_prefix = [prefix, key].compact.join(".")
      flatten_keys(child, child_prefix, keys)
    end
  when Array
    keys << prefix if prefix
  else
    keys << prefix if prefix
  end
  keys
end

config = YAML.safe_load(File.read(CONFIG_PATH), aliases: true) || {}
i18n_config = config.fetch("i18n", {})
default_lang = String(i18n_config["default_lang"] || "en")
supported_langs = Array(i18n_config["supported_langs"]).map { |lang| String(lang).strip }.reject(&:empty?)
supported_langs = Dir[File.join(I18N_DIR, "*.yml")].map { |path| File.basename(path, ".yml") } if supported_langs.empty?

default_path = File.join(I18N_DIR, "#{default_lang}.yml")
unless File.exist?(default_path)
  warn "Missing default locale file: #{default_path}"
  exit 1
end

default_data = YAML.safe_load(File.read(default_path), aliases: true) || {}
default_keys = flatten_keys(default_data).sort
failures = []

supported_langs.each do |lang|
  path = File.join(I18N_DIR, "#{lang}.yml")
  unless File.exist?(path)
    failures << "#{lang}: missing locale file"
    next
  end

  data = YAML.safe_load(File.read(path), aliases: true) || {}
  keys = flatten_keys(data).sort
  missing = default_keys - keys
  extra = keys - default_keys
  failures << "#{lang}: missing #{missing.length} keys: #{missing.join(", ")}" if missing.any?
  failures << "#{lang}: extra #{extra.length} keys: #{extra.join(", ")}" if extra.any?
end

if failures.any?
  warn failures.join("\n")
  exit 1
end

puts "i18n completeness ok for #{supported_langs.join(", ")}"

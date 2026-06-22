# Automatically loads _config.local.yml in development
# This allows `bundle exec jekyll serve` to work without specifying configs

module StoreLocalConfig
  def self.deep_merge(base, override)
    base.merge(override) do |_key, base_value, override_value|
      if base_value.is_a?(Hash) && override_value.is_a?(Hash)
        deep_merge(base_value, override_value)
      else
        override_value
      end
    end
  end
end

Jekyll::Hooks.register :site, :after_reset do |site|
  next if ENV['JEKYLL_ENV'] == 'production'
  
  base_config = File.join(site.source, '_config.yml')
  local_config = File.join(site.source, '_config.local.yml')
  next unless File.exist?(local_config)
  
  base = File.exist?(base_config) ? YAML.safe_load_file(base_config, permitted_classes: [Date, Time]) || {} : {}
  local = YAML.safe_load_file(local_config, permitted_classes: [Date, Time]) || {}
  site.config.merge!(StoreLocalConfig.deep_merge(base, local))
  
  puts ">>> Loaded _config.local.yml"
end

#!/usr/bin/env ruby
# Sync Worker-mirrored settings from _config.yml / _config.local.yml into worker/wrangler.toml.

require 'yaml'
require 'json'

ROOT = File.expand_path('..', __dir__)
BASE_CONFIG_PATH = File.join(ROOT, '_config.yml')
LOCAL_CONFIG_PATH = File.join(ROOT, '_config.local.yml')
WRANGLER_PATH = File.join(ROOT, 'worker', 'wrangler.toml')

TOP_LEVEL_ORDER = [
  'SITE_BASE',
  'WORKER_BASE',
  'CANONICAL_SITE_BASE',
  'CANONICAL_WORKER_BASE',
  'CORS_ALLOWED_ORIGIN',
  'APP_MODE',
  'ADMIN_USERS_JSON',
  'SITE_TITLE',
  'SITE_DESCRIPTION',
  'PLATFORM_NAME',
  'PLATFORM_COMPANY_NAME',
  'PLATFORM_AUTHOR',
  'PLATFORM_DEFAULT_CREATOR_NAME',
  'PLATFORM_TIMEZONE',
  'SUPPORT_EMAIL',
  'ORDERS_EMAIL_FROM',
  'UPDATES_EMAIL_FROM',
  'PLATFORM_FOOTER_LOGO_PATH',
  'PLATFORM_FAVICON_PATH',
  'PLATFORM_DEFAULT_SOCIAL_IMAGE_PATH',
  'SEO_DEFAULT_SOCIAL_IMAGE_ALT',
  'SEO_X_HANDLE',
  'SEO_SAME_AS',
  'STRIPE_PUBLISHABLE_KEY',
  'EMAIL_LOGO_PATH',
  'DESIGN_LAYOUT_MAX_WIDTH',
  'EMAIL_FONT_FAMILY',
  'EMAIL_HEADING_FONT_FAMILY',
  'EMAIL_COLOR_TEXT',
  'EMAIL_COLOR_MUTED',
  'EMAIL_COLOR_SURFACE',
  'EMAIL_COLOR_BORDER',
  'EMAIL_COLOR_PRIMARY',
  'EMAIL_BUTTON_RADIUS',
  'SALES_TAX_RATE',
  'TAX_PROVIDER',
  'TAX_ORIGIN_COUNTRY',
  'TAX_USE_REGIONAL_ORIGIN',
  'NM_GRT_API_BASE',
  'ZIP_TAX_API_BASE',
  'FLAT_SHIPPING_RATE',
  'SHIPPING_ORIGIN_ZIP',
  'SHIPPING_ORIGIN_COUNTRY',
  'SHIPPING_FALLBACK_FLAT_RATE',
  'FREE_SHIPPING_DEFAULT',
  'SHIPPING_DEFAULT_OPTION',
  'USPS_ENABLED',
  'USPS_CLIENT_ID',
  'USPS_API_BASE',
  'USPS_TIMEOUT_MS',
  'USPS_QUOTE_CACHE_TTL_SECONDS',
  'USPS_FAILURE_COOLDOWN_SECONDS',
  'USPS_RATE_LIMIT_COOLDOWN_SECONDS',
  'ANALYTICS_PROVIDER',
  'ANALYTICS_MEASUREMENT_ID',
  'ANALYTICS_DASHBOARD_URL',
  'ANALYTICS_REPORT_TIMEZONE',
  'ANALYTICS_INCLUDE_TEST_ORDERS',
  'ANALYTICS_EXPORT_PRODUCT_ROWS',
  'MARKETING_DEFAULT_UTM_SOURCE',
  'MARKETING_DEFAULT_UTM_MEDIUM',
  'MARKETING_DEFAULT_UTM_CAMPAIGN',
  'MARKETING_DEFAULT_UTM_CONTENT',
  'MARKETING_DEFAULT_REF',
  'MARKETING_LANDING_PAGE_PATH',
  'MARKETING_SHARE_TITLE',
  'MARKETING_SHARE_TEXT',
  'ADD_ONS_ENABLED',
  'ADD_ON_PRODUCT_COUNT',
  'DEBUG_CONSOLE_LOGGING_ENABLED',
  'DEBUG_VERBOSE_CONSOLE_LOGGING',
  'INTENT_PREFETCH_ENABLED',
  'INTENT_PREFETCH_DELAY_MS',
  'INTENT_PREFETCH_LIMIT',
  'LIVE_INVENTORY_CACHE_TTL_SECONDS',
  'DEFAULT_PLATFORM_TIP_PERCENT',
  'MAX_PLATFORM_TIP_PERCENT'
].freeze

DEV_ENV_ORDER = [
  'SITE_BASE',
  'WORKER_BASE',
  'CANONICAL_SITE_BASE',
  'CANONICAL_WORKER_BASE',
  'CORS_ALLOWED_ORIGIN',
  'APP_MODE',
  'ADMIN_USERS_JSON',
  'SITE_TITLE',
  'SITE_DESCRIPTION',
  'PLATFORM_NAME',
  'PLATFORM_COMPANY_NAME',
  'PLATFORM_AUTHOR',
  'PLATFORM_DEFAULT_CREATOR_NAME',
  'PLATFORM_TIMEZONE',
  'SUPPORT_EMAIL',
  'ORDERS_EMAIL_FROM',
  'UPDATES_EMAIL_FROM',
  'PLATFORM_FOOTER_LOGO_PATH',
  'PLATFORM_FAVICON_PATH',
  'PLATFORM_DEFAULT_SOCIAL_IMAGE_PATH',
  'SEO_DEFAULT_SOCIAL_IMAGE_ALT',
  'SEO_X_HANDLE',
  'SEO_SAME_AS',
  'STRIPE_PUBLISHABLE_KEY',
  'EMAIL_LOGO_PATH',
  'DESIGN_LAYOUT_MAX_WIDTH',
  'EMAIL_FONT_FAMILY',
  'EMAIL_HEADING_FONT_FAMILY',
  'EMAIL_COLOR_TEXT',
  'EMAIL_COLOR_MUTED',
  'EMAIL_COLOR_SURFACE',
  'EMAIL_COLOR_BORDER',
  'EMAIL_COLOR_PRIMARY',
  'EMAIL_BUTTON_RADIUS',
  'SALES_TAX_RATE',
  'TAX_PROVIDER',
  'TAX_ORIGIN_COUNTRY',
  'TAX_USE_REGIONAL_ORIGIN',
  'NM_GRT_API_BASE',
  'ZIP_TAX_API_BASE',
  'FLAT_SHIPPING_RATE',
  'SHIPPING_ORIGIN_ZIP',
  'SHIPPING_ORIGIN_COUNTRY',
  'SHIPPING_FALLBACK_FLAT_RATE',
  'FREE_SHIPPING_DEFAULT',
  'SHIPPING_DEFAULT_OPTION',
  'USPS_ENABLED',
  'USPS_CLIENT_ID',
  'USPS_API_BASE',
  'USPS_TIMEOUT_MS',
  'USPS_QUOTE_CACHE_TTL_SECONDS',
  'USPS_FAILURE_COOLDOWN_SECONDS',
  'USPS_RATE_LIMIT_COOLDOWN_SECONDS',
  'ANALYTICS_PROVIDER',
  'ANALYTICS_MEASUREMENT_ID',
  'ANALYTICS_DASHBOARD_URL',
  'ANALYTICS_REPORT_TIMEZONE',
  'ANALYTICS_INCLUDE_TEST_ORDERS',
  'ANALYTICS_EXPORT_PRODUCT_ROWS',
  'MARKETING_DEFAULT_UTM_SOURCE',
  'MARKETING_DEFAULT_UTM_MEDIUM',
  'MARKETING_DEFAULT_UTM_CAMPAIGN',
  'MARKETING_DEFAULT_UTM_CONTENT',
  'MARKETING_DEFAULT_REF',
  'MARKETING_LANDING_PAGE_PATH',
  'MARKETING_SHARE_TITLE',
  'MARKETING_SHARE_TEXT',
  'ADD_ONS_ENABLED',
  'ADD_ON_PRODUCT_COUNT',
  'DEBUG_CONSOLE_LOGGING_ENABLED',
  'DEBUG_VERBOSE_CONSOLE_LOGGING',
  'INTENT_PREFETCH_ENABLED',
  'INTENT_PREFETCH_DELAY_MS',
  'INTENT_PREFETCH_LIMIT',
  'LIVE_INVENTORY_CACHE_TTL_SECONDS',
  'DEFAULT_PLATFORM_TIP_PERCENT',
  'MAX_PLATFORM_TIP_PERCENT',
  'ADMIN_LOCAL_REPO_WRITES_ENABLED',
  'ADMIN_LOCAL_REPO_SERVICE'
].freeze

def deep_merge(base, override)
  return base unless override.is_a?(Hash)
  return override unless base.is_a?(Hash)

  merged = base.dup
  override.each do |key, value|
    merged[key] = if merged[key].is_a?(Hash) && value.is_a?(Hash)
      deep_merge(merged[key], value)
    else
      value
    end
  end
  merged
end

def load_yaml(path)
  return {} unless File.exist?(path)
  YAML.load_file(path) || {}
end

def parse_simple_assignments(content)
  values = {}
  content.scan(/^([A-Z_]+)\s*=\s*"([^"]*)"$/) do |key, value|
    values[key] = value
  end
  values
end

def toml_unescape(value)
  value.gsub(/\\(["\\])/, '\1')
end

def parse_table_assignments(content, section_header)
  lines = content.lines
  start_index = lines.index { |line| line.strip == section_header }
  return {} unless start_index

  values = {}
  index = start_index + 1
  while index < lines.length && !lines[index].start_with?('[')
    if lines[index] =~ /^([A-Z_]+)\s*=\s*"((?:\\.|[^"\\])*)"\s*$/
      values[Regexp.last_match(1)] = toml_unescape(Regexp.last_match(2))
    end
    index += 1
  end
  values
end

def parse_inline_env_vars(content)
  lines = content.lines
  env_index = lines.index { |line| line.strip == '[env.dev]' }
  return {} unless env_index

  vars_line = nil
  index = env_index + 1
  while index < lines.length && !lines[index].start_with?('[')
    if lines[index].start_with?('vars = {')
      vars_line = lines[index]
      break
    end
    index += 1
  end
  return {} unless vars_line

  vars_body = vars_line.sub(/\Avars\s*=\s*\{\s*/, '').sub(/\s*\}\s*\z/, '')

  values = {}
  vars_body.scan(/([A-Z_]+)\s*=\s*"((?:\\.|[^"\\])*)"/) do |key, value|
    values[key] = toml_unescape(value)
  end
  values
end

def parse_env_dev_vars(content)
  table_values = parse_table_assignments(content, '[env.dev.vars]')
  return table_values unless table_values.empty?

  parse_inline_env_vars(content)
end

def format_decimal(value, places)
  return nil if value.nil?
  format("%.#{places}f", value.to_f)
end

def format_int(value)
  return nil if value.nil?
  value.to_i.to_s
end

def toml_escape(value)
  String(value).gsub('\\', '\\\\').gsub('"', '\"')
end

def csv_value(value, fallback = nil)
  source = value.nil? || value == '' ? fallback : value
  Array(source)
    .flat_map { |entry| String(entry).split(',') }
    .map(&:strip)
    .reject(&:empty?)
    .uniq
    .join(',')
end

def admin_users_json(value, fallback = nil)
  users = Array(value).map do |entry|
    next unless entry.is_a?(Hash)

    email = entry['email'].to_s.strip.downcase
    next if email.empty?

    role = entry['role'].to_s.strip == 'super_admin' ? 'super_admin' : 'limited_admin'
    scope_source = entry['accessScopes'] || entry['access_scopes'] || entry['scopes'] || []
    scopes = Array(scope_source)
      .flat_map { |item| String(item).split(',') }
      .map(&:strip)
      .reject(&:empty?)
      .uniq

    {
      name: entry['name'].to_s.strip,
      email: email,
      role: role,
      accessScopes: role == 'super_admin' ? [] : scopes
    }
  end.compact
  users.empty? ? fallback : JSON.generate(users)
end

def replace_toml_section(content, section_header, body_lines)
  lines = content.lines
  start_index = lines.index { |line| line.strip == section_header }
  return content unless start_index

  end_index = start_index + 1
  while end_index < lines.length && !lines[end_index].start_with?('[')
    end_index += 1
  end

  replacement = ["#{section_header}\n", *body_lines.map { |line| "#{line}\n" }, "\n"]
  lines[start_index...end_index] = replacement
  lines.join
end

def remove_env_dev_inline_vars(content)
  lines = content.lines
  env_index = lines.index { |line| line.strip == '[env.dev]' }
  return content unless env_index

  index = env_index + 1
  while index < lines.length && !lines[index].start_with?('[')
    if lines[index].start_with?('vars = {')
      lines.delete_at(index)
      next
    end
    index += 1
  end
  lines.join
end

def upsert_toml_section(content, section_header, body_lines, before_section_prefix)
  lines = content.lines
  filtered_lines = []
  index = 0
  while index < lines.length
    if lines[index].strip == section_header
      index += 1
      index += 1 while index < lines.length && !lines[index].start_with?('[')
      next
    end

    filtered_lines << lines[index]
    index += 1
  end

  env_index = filtered_lines.index { |line| line.strip == '[env.dev]' }
  return content unless env_index

  insert_index = filtered_lines.index.with_index do |line, index|
    index > env_index && line.start_with?(before_section_prefix)
  end || env_index + 1

  insertion = ["#{section_header}\n", *body_lines.map { |line| "#{line}\n" }, "\n"]
  filtered_lines.insert(insert_index, *insertion)
  filtered_lines.join
end

def build_mirror_values(config, existing)
  platform = config['platform'] || {}
  admin = config['admin'] || {}
  pricing = config['pricing'] || {}
  tax = config['tax'] || {}
  shipping = config['shipping'] || {}
  usps = shipping['usps'] || {}
  debug = config['debug'] || {}
  design = config['design'] || {}
  seo = config['seo'] || {}
  checkout = config['checkout'] || {}
  cache = config['cache'] || {}
  performance = config['performance'] || {}
  analytics = config['analytics'] || {}
  marketing = config['marketing'] || {}
  add_ons = config['add_ons'] || {}

  {
    'SITE_BASE' => platform['site_url'] || config['url'] || existing['SITE_BASE'],
    'WORKER_BASE' => platform['worker_url'] || existing['WORKER_BASE'],
    'CORS_ALLOWED_ORIGIN' => platform['site_url'] || config['url'] || existing['CORS_ALLOWED_ORIGIN'],
    'APP_MODE' => existing['APP_MODE'] || 'live',
    'ADMIN_USERS_JSON' => admin_users_json(admin['users'], existing['ADMIN_USERS_JSON']),
    'SITE_TITLE' => config['title'] || platform['name'] || existing['SITE_TITLE'],
    'SITE_DESCRIPTION' => config['description'] || existing['SITE_DESCRIPTION'],
    'PLATFORM_NAME' => platform['name'] || config['title'] || existing['PLATFORM_NAME'],
    'PLATFORM_COMPANY_NAME' => platform['company_name'] || config['author'] || existing['PLATFORM_COMPANY_NAME'],
    'PLATFORM_AUTHOR' => config['author'] || platform['company_name'] || existing['PLATFORM_AUTHOR'],
    'PLATFORM_DEFAULT_CREATOR_NAME' => platform['default_creator_name'] || platform['company_name'] || existing['PLATFORM_DEFAULT_CREATOR_NAME'],
    'PLATFORM_TIMEZONE' => platform['timezone'] || existing['PLATFORM_TIMEZONE'] || 'America/Denver',
    'SUPPORT_EMAIL' => platform['support_email'] || existing['SUPPORT_EMAIL'],
    'ORDERS_EMAIL_FROM' => platform['orders_email_from'] || existing['ORDERS_EMAIL_FROM'],
    'UPDATES_EMAIL_FROM' => platform['updates_email_from'] || existing['UPDATES_EMAIL_FROM'],
    'PLATFORM_FOOTER_LOGO_PATH' => platform.key?('footer_logo_path') ? platform['footer_logo_path'].to_s : existing['PLATFORM_FOOTER_LOGO_PATH'],
    'PLATFORM_FAVICON_PATH' => platform.key?('favicon_path') ? platform['favicon_path'].to_s : existing['PLATFORM_FAVICON_PATH'],
    'PLATFORM_DEFAULT_SOCIAL_IMAGE_PATH' => platform.key?('default_social_image_path') ? platform['default_social_image_path'].to_s : existing['PLATFORM_DEFAULT_SOCIAL_IMAGE_PATH'],
    'SEO_DEFAULT_SOCIAL_IMAGE_ALT' => seo.key?('default_social_image_alt') ? seo['default_social_image_alt'].to_s : existing['SEO_DEFAULT_SOCIAL_IMAGE_ALT'],
    'SEO_X_HANDLE' => seo.key?('x_handle') ? seo['x_handle'].to_s : existing['SEO_X_HANDLE'],
    'SEO_SAME_AS' => csv_value(seo['same_as'], existing['SEO_SAME_AS']),
    'STRIPE_PUBLISHABLE_KEY' => checkout.key?('stripe_publishable_key') ? checkout['stripe_publishable_key'].to_s : existing['STRIPE_PUBLISHABLE_KEY'],
    'EMAIL_LOGO_PATH' => platform.key?('logo_path') ? platform['logo_path'].to_s : existing['EMAIL_LOGO_PATH'],
    'DESIGN_LAYOUT_MAX_WIDTH' => design.key?('layout_max_width') ? design['layout_max_width'].to_s : existing['DESIGN_LAYOUT_MAX_WIDTH'],
    'EMAIL_FONT_FAMILY' => design.key?('font_body') ? design['font_body'].to_s : existing['EMAIL_FONT_FAMILY'],
    'EMAIL_HEADING_FONT_FAMILY' => design.key?('font_display') ? design['font_display'].to_s : existing['EMAIL_HEADING_FONT_FAMILY'],
    'EMAIL_COLOR_TEXT' => design.key?('color_text') ? design['color_text'].to_s : existing['EMAIL_COLOR_TEXT'],
    'EMAIL_COLOR_MUTED' => design.key?('color_text_muted') ? design['color_text_muted'].to_s : existing['EMAIL_COLOR_MUTED'],
    'EMAIL_COLOR_SURFACE' => design.key?('color_surface_subtle') ? design['color_surface_subtle'].to_s : existing['EMAIL_COLOR_SURFACE'],
    'EMAIL_COLOR_BORDER' => design.key?('color_border') ? design['color_border'].to_s : existing['EMAIL_COLOR_BORDER'],
    'EMAIL_COLOR_PRIMARY' => design.key?('color_primary') ? design['color_primary'].to_s : existing['EMAIL_COLOR_PRIMARY'],
    'EMAIL_BUTTON_RADIUS' => design.key?('radius_lg') ? design['radius_lg'].to_s : existing['EMAIL_BUTTON_RADIUS'],
    'SALES_TAX_RATE' => pricing.key?('sales_tax_rate') ? pricing['sales_tax_rate'].to_s : existing['SALES_TAX_RATE'],
    'TAX_PROVIDER' => tax.key?('provider') ? tax['provider'].to_s : existing['TAX_PROVIDER'],
    'TAX_ORIGIN_COUNTRY' => tax.key?('origin_country') ? tax['origin_country'].to_s : existing['TAX_ORIGIN_COUNTRY'],
    'TAX_USE_REGIONAL_ORIGIN' => tax.key?('use_regional_origin') ? (tax['use_regional_origin'] ? 'true' : 'false') : existing['TAX_USE_REGIONAL_ORIGIN'],
    'NM_GRT_API_BASE' => tax.key?('nm_grt_api_base') ? tax['nm_grt_api_base'].to_s : existing['NM_GRT_API_BASE'],
    'ZIP_TAX_API_BASE' => tax.key?('zip_tax_api_base') ? tax['zip_tax_api_base'].to_s : existing['ZIP_TAX_API_BASE'],
    'FLAT_SHIPPING_RATE' => pricing.key?('flat_shipping_rate') ? format_decimal(pricing['flat_shipping_rate'], 2) : existing['FLAT_SHIPPING_RATE'],
    'SHIPPING_ORIGIN_ZIP' => shipping['origin_zip'] || existing['SHIPPING_ORIGIN_ZIP'],
    'SHIPPING_ORIGIN_COUNTRY' => shipping['origin_country'] || existing['SHIPPING_ORIGIN_COUNTRY'],
    'SHIPPING_FALLBACK_FLAT_RATE' => shipping.key?('fallback_flat_rate') ? format_decimal(shipping['fallback_flat_rate'], 2) : existing['SHIPPING_FALLBACK_FLAT_RATE'],
    'FREE_SHIPPING_DEFAULT' => shipping.key?('free_shipping_default') ? (shipping['free_shipping_default'] ? 'true' : 'false') : existing['FREE_SHIPPING_DEFAULT'],
    'SHIPPING_DEFAULT_OPTION' => shipping.key?('default_option') ? shipping['default_option'].to_s : existing['SHIPPING_DEFAULT_OPTION'],
    'USPS_ENABLED' => usps.key?('enabled') ? (usps['enabled'] ? 'true' : 'false') : existing['USPS_ENABLED'],
    'USPS_CLIENT_ID' => usps.key?('client_id') ? usps['client_id'].to_s : existing['USPS_CLIENT_ID'],
    'USPS_API_BASE' => usps.key?('api_base') ? usps['api_base'].to_s : existing['USPS_API_BASE'],
    'USPS_TIMEOUT_MS' => usps.key?('timeout_ms') ? format_int(usps['timeout_ms']) : existing['USPS_TIMEOUT_MS'],
    'USPS_QUOTE_CACHE_TTL_SECONDS' => usps.key?('quote_cache_ttl_seconds') ? format_int(usps['quote_cache_ttl_seconds']) : existing['USPS_QUOTE_CACHE_TTL_SECONDS'],
    'USPS_FAILURE_COOLDOWN_SECONDS' => usps.key?('failure_cooldown_seconds') ? format_int(usps['failure_cooldown_seconds']) : existing['USPS_FAILURE_COOLDOWN_SECONDS'],
    'USPS_RATE_LIMIT_COOLDOWN_SECONDS' => usps.key?('rate_limit_cooldown_seconds') ? format_int(usps['rate_limit_cooldown_seconds']) : existing['USPS_RATE_LIMIT_COOLDOWN_SECONDS'],
    'ANALYTICS_PROVIDER' => analytics.key?('provider') ? analytics['provider'].to_s : existing['ANALYTICS_PROVIDER'],
    'ANALYTICS_MEASUREMENT_ID' => analytics.key?('measurement_id') ? analytics['measurement_id'].to_s : existing['ANALYTICS_MEASUREMENT_ID'],
    'ANALYTICS_DASHBOARD_URL' => analytics.key?('dashboard_url') ? analytics['dashboard_url'].to_s : existing['ANALYTICS_DASHBOARD_URL'],
    'ANALYTICS_REPORT_TIMEZONE' => analytics.key?('report_timezone') ? analytics['report_timezone'].to_s : existing['ANALYTICS_REPORT_TIMEZONE'],
    'ANALYTICS_INCLUDE_TEST_ORDERS' => analytics.key?('include_test_orders') ? (analytics['include_test_orders'] ? 'true' : 'false') : existing['ANALYTICS_INCLUDE_TEST_ORDERS'],
    'ANALYTICS_EXPORT_PRODUCT_ROWS' => analytics.key?('export_product_rows') ? (analytics['export_product_rows'] ? 'true' : 'false') : existing['ANALYTICS_EXPORT_PRODUCT_ROWS'],
    'MARKETING_DEFAULT_UTM_SOURCE' => marketing.key?('default_utm_source') ? marketing['default_utm_source'].to_s : existing['MARKETING_DEFAULT_UTM_SOURCE'],
    'MARKETING_DEFAULT_UTM_MEDIUM' => marketing.key?('default_utm_medium') ? marketing['default_utm_medium'].to_s : existing['MARKETING_DEFAULT_UTM_MEDIUM'],
    'MARKETING_DEFAULT_UTM_CAMPAIGN' => marketing.key?('default_utm_campaign') ? marketing['default_utm_campaign'].to_s : existing['MARKETING_DEFAULT_UTM_CAMPAIGN'],
    'MARKETING_DEFAULT_UTM_CONTENT' => marketing.key?('default_utm_content') ? marketing['default_utm_content'].to_s : existing['MARKETING_DEFAULT_UTM_CONTENT'],
    'MARKETING_DEFAULT_REF' => marketing.key?('default_ref') ? marketing['default_ref'].to_s : existing['MARKETING_DEFAULT_REF'],
    'MARKETING_LANDING_PAGE_PATH' => marketing.key?('landing_page_path') ? marketing['landing_page_path'].to_s : existing['MARKETING_LANDING_PAGE_PATH'],
    'MARKETING_SHARE_TITLE' => marketing.key?('share_title') ? marketing['share_title'].to_s : existing['MARKETING_SHARE_TITLE'],
    'MARKETING_SHARE_TEXT' => marketing.key?('share_text') ? marketing['share_text'].to_s : existing['MARKETING_SHARE_TEXT'],
    'ADD_ONS_ENABLED' => add_ons.key?('enabled') ? (add_ons['enabled'] ? 'true' : 'false') : existing['ADD_ONS_ENABLED'],
    'ADD_ON_PRODUCT_COUNT' => add_ons.key?('product_count') ? format_int(add_ons['product_count']) : existing['ADD_ON_PRODUCT_COUNT'],
    'DEBUG_CONSOLE_LOGGING_ENABLED' => debug.key?('console_logging_enabled') ? (debug['console_logging_enabled'] ? 'true' : 'false') : existing['DEBUG_CONSOLE_LOGGING_ENABLED'],
    'DEBUG_VERBOSE_CONSOLE_LOGGING' => debug.key?('verbose_console_logging') ? (debug['verbose_console_logging'] ? 'true' : 'false') : existing['DEBUG_VERBOSE_CONSOLE_LOGGING'],
    'INTENT_PREFETCH_ENABLED' => performance.key?('intent_prefetch_enabled') ? (performance['intent_prefetch_enabled'] ? 'true' : 'false') : existing['INTENT_PREFETCH_ENABLED'],
    'INTENT_PREFETCH_DELAY_MS' => performance.key?('intent_prefetch_delay_ms') ? format_int(performance['intent_prefetch_delay_ms']) : existing['INTENT_PREFETCH_DELAY_MS'],
    'INTENT_PREFETCH_LIMIT' => performance.key?('intent_prefetch_limit') ? format_int(performance['intent_prefetch_limit']) : existing['INTENT_PREFETCH_LIMIT'],
    'LIVE_INVENTORY_CACHE_TTL_SECONDS' => cache.key?('live_inventory_ttl_seconds') ? format_int(cache['live_inventory_ttl_seconds']) : existing['LIVE_INVENTORY_CACHE_TTL_SECONDS'],
    'DEFAULT_PLATFORM_TIP_PERCENT' => pricing.key?('default_tip_percent') ? format_int(pricing['default_tip_percent']) : existing['DEFAULT_PLATFORM_TIP_PERCENT'],
    'MAX_PLATFORM_TIP_PERCENT' => pricing.key?('max_tip_percent') ? format_int(pricing['max_tip_percent']) : existing['MAX_PLATFORM_TIP_PERCENT'],
    'ADMIN_LOCAL_REPO_WRITES_ENABLED' => existing['ADMIN_LOCAL_REPO_WRITES_ENABLED'],
    'ADMIN_LOCAL_REPO_SERVICE' => existing['ADMIN_LOCAL_REPO_SERVICE']
  }.compact
end

base_config = load_yaml(BASE_CONFIG_PATH)
local_config = load_yaml(LOCAL_CONFIG_PATH)
dev_config = deep_merge(base_config, local_config)

content = File.read(WRANGLER_PATH)
existing_top = parse_simple_assignments(content)
existing_dev = parse_env_dev_vars(content)

top_values = build_mirror_values(base_config, existing_top)
dev_values = build_mirror_values(dev_config, existing_dev).merge('APP_MODE' => 'test')
top_values['APP_MODE'] = 'live'
top_values['CANONICAL_SITE_BASE'] = top_values['SITE_BASE']
top_values['CANONICAL_WORKER_BASE'] = top_values['WORKER_BASE']
dev_values['CANONICAL_SITE_BASE'] = top_values['SITE_BASE']
dev_values['CANONICAL_WORKER_BASE'] = top_values['WORKER_BASE']
dev_values['ADMIN_LOCAL_REPO_WRITES_ENABLED'] ||= 'true'
dev_values['ADMIN_LOCAL_REPO_SERVICE'] ||= 'http://127.0.0.1:8799'

updated = content.dup

vars_block = TOP_LEVEL_ORDER.map do |key|
  value = top_values[key]
  next nil unless value
  %(#{key} = "#{toml_escape(value)}")
end.compact.join("\n")

updated = replace_toml_section(updated, '[vars]', vars_block.split("\n"))

dev_vars_block = DEV_ENV_ORDER.map do |key|
  value = dev_values[key]
  next nil unless value
  %(#{key} = "#{toml_escape(value)}")
end.compact.join("\n")

updated = remove_env_dev_inline_vars(updated)
updated = upsert_toml_section(updated, '[env.dev.vars]', dev_vars_block.split("\n"), '[[env.dev.')

if updated == content
  puts '✅ worker/wrangler.toml already in sync with _config.yml and _config.local.yml'
  exit 0
end

File.write(WRANGLER_PATH, updated)
puts '✅ Synced worker/wrangler.toml from _config.yml and _config.local.yml'

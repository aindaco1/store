#!/usr/bin/env ruby
# Check the local Store repo for production launch inputs that can be audited
# without reading external Cloudflare, Stripe, Resend, or USPS accounts.

require 'json'
require 'optparse'
require 'time'
require 'yaml'

EXPECTED_SITE_URL = 'https://shop.dustwave.xyz'
EXPECTED_WORKER_URL = 'https://checkout.dustwave.xyz'
EXPECTED_LOCAL_SITE_URL = 'http://127.0.0.1:4002'
EXPECTED_LOCAL_WORKER_URL = 'http://127.0.0.1:8989'

ACTIVE_STATUSES = ['active', 'available', 'live'].freeze
INVENTORY_LAUNCH_TYPES = ['physical'].freeze
PLACEHOLDER_DOWNLOAD_KEY_PATTERN = /\b(sample|placeholder|test|example|demo)\b/i
REQUIRED_BINDINGS = {
  durable_object: 'STORE_INVENTORY_COORDINATOR',
  r2_bucket: 'STORE_DOWNLOADS',
  kv_namespaces: ['STORE_STATE', 'RATELIMIT']
}.freeze
REQUIRED_SECRETS = [
  'ADMIN_SECRET',
  'ADMIN_SESSION_SECRET',
  'MAGIC_LINK_SECRET',
  'CHECKOUT_INTENT_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'USPS_CLIENT_SECRET'
].freeze
MANUAL_SMOKE_TESTS = [
  'Paid physical checkout with USPS shipping and NM GRT tax.',
  'Paid digital checkout with signed download fulfillment.',
  'Paid ticket checkout with admin QR check-in.',
  'Free RSVP checkout with admin QR check-in.',
  'Stripe webhook replay or equivalent signed test event.',
  'Signed Resend delivery webhook event with minimized delivery evidence.',
  'Bounded read-only payment reconciliation cycle with no unexplained critical break.'
].freeze

Check = Struct.new(:id, :status, :message, :details, keyword_init: true) do
  def to_h
    {
      id: id,
      status: status,
      message: message,
      details: details || {}
    }
  end
end

def safe_load_yaml_file(path)
  return {} unless File.exist?(path)

  YAML.safe_load(
    File.read(path),
    permitted_classes: [Date, Time],
    aliases: false
  ) || {}
rescue Psych::Exception => err
  raise "Unable to parse #{path}: #{err.message}"
end

def split_front_matter(content)
  match = content.match(/\A---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)\z/)
  return [{}, content] unless match

  front_matter = YAML.safe_load(
    match[1],
    permitted_classes: [Date, Time],
    aliases: false
  ) || {}
  [front_matter, match[2]]
rescue Psych::Exception => err
  raise "Unable to parse product front matter: #{err.message}"
end

def load_products(root)
  products_dir = File.join(root, '_products')
  return [] unless Dir.exist?(products_dir)

  Dir.children(products_dir)
    .grep(/\.md\z/)
    .sort
    .map do |file_name|
      path = File.join(products_dir, file_name)
      front_matter, body = split_front_matter(File.read(path))
      front_matter.merge(
        '_file' => File.join('_products', file_name),
        '_body' => body
      )
    end
end

def normalize_string(value)
  value.to_s.strip
end

def active_product?(product)
  ACTIVE_STATUSES.include?(normalize_string(product['status']))
end

def launch_product?(product)
  active_product?(product) &&
    product['public'] != false &&
    product['launch_test'] != true
end

def fulfillment_type(product)
  normalize_string(product['fulfillment_type']).empty? ? normalize_string(product['type']) : normalize_string(product['fulfillment_type'])
end

def tracking_inventory?(product)
  product['inventory_tracking'] == true
end

def inventory_baseline_verified?(product)
  !normalize_string(product['inventory_baseline_source']).empty? ||
    !normalize_string(product['inventory_verified_at']).empty?
end

def inventory_value(value)
  return nil if value.nil? || value == ''

  parsed = value.to_i
  parsed >= 0 ? parsed : nil
end

def inventory_rows(product)
  verified = inventory_baseline_verified?(product)
  variants = product['variants'].is_a?(Array) ? product['variants'] : []
  if variants.any?
    variants.map do |variant|
      {
        product_id: product['identifier'] || product['sku'],
        product_name: product['name'],
        variant_id: variant['id'],
        variant_label: variant['label'],
        sku: variant['sku'] || product['sku'],
        inventory: inventory_value(variant.key?('inventory') ? variant['inventory'] : product['inventory']),
        verified: verified
      }
    end
  else
    [{
      product_id: product['identifier'] || product['sku'],
      product_name: product['name'],
      variant_id: '',
      variant_label: '',
      sku: product['sku'] || product['identifier'],
      inventory: inventory_value(product['inventory']),
      verified: verified
    }]
  end
end

def compact_sample(rows, limit = 12)
  rows.first(limit)
end

def deep_fetch(hash, *keys)
  keys.reduce(hash) do |cursor, key|
    return nil unless cursor.is_a?(Hash)

    cursor[key]
  end
end

def parse_toml_assignments(content, section_header)
  lines = content.lines
  start_index = lines.index { |line| line.strip == section_header }
  return {} unless start_index

  values = {}
  index = start_index + 1
  while index < lines.length && !lines[index].start_with?('[')
    if lines[index] =~ /\A([A-Z_]+)\s*=\s*"((?:\\.|[^"\\])*)"\s*\z/
      values[Regexp.last_match(1)] = Regexp.last_match(2).gsub(/\\(["\\])/, '\1')
    end
    index += 1
  end
  values
end

def wrangler_binding_names(content, binding, key = 'name')
  names = []
  in_block = false
  content.each_line do |line|
    stripped = line.strip
    if stripped == binding
      in_block = true
      next
    end
    if in_block && stripped.start_with?('[')
      in_block = false
    end
    if in_block && stripped =~ /\A#{Regexp.escape(key)}\s*=\s*"([^"]+)"/
      names << Regexp.last_match(1)
    end
  end
  names
end

def parse_admin_users(value)
  case value
  when Array
    value
  when String
    JSON.parse(value)
  else
    []
  end
rescue JSON::ParserError
  []
end

def check_urls(config, local_config)
  expected = {
    'url' => EXPECTED_SITE_URL,
    'platform.site_url' => EXPECTED_SITE_URL,
    'platform.worker_url' => EXPECTED_WORKER_URL,
    'admin.production_site_url' => EXPECTED_SITE_URL,
    'admin.production_worker_url' => EXPECTED_WORKER_URL,
    'admin_production_site_url' => EXPECTED_SITE_URL,
    'admin_production_worker_url' => EXPECTED_WORKER_URL
  }

  failures = expected.filter_map do |path, expected_value|
    actual = if path.include?('.')
      deep_fetch(config, *path.split('.'))
    else
      config[path]
    end
    next if normalize_string(actual) == expected_value

    { path: path, expected: expected_value, actual: normalize_string(actual) }
  end

  local_failures = {
    'url' => EXPECTED_LOCAL_SITE_URL,
    'platform.site_url' => EXPECTED_LOCAL_SITE_URL,
    'platform.worker_url' => EXPECTED_LOCAL_WORKER_URL
  }.filter_map do |path, expected_value|
    actual = if path.include?('.')
      deep_fetch(local_config, *path.split('.'))
    else
      local_config[path]
    end
    next if normalize_string(actual) == expected_value

    { path: path, expected: expected_value, actual: normalize_string(actual) }
  end

  checks = []
  checks << Check.new(
    id: 'production-static-urls',
    status: failures.empty? ? 'ok' : 'action',
    message: failures.empty? ? 'Production storefront and Worker URLs match launch domains.' : 'Production URL config does not match launch domains.',
    details: { mismatches: failures }
  )
  checks << Check.new(
    id: 'local-development-urls',
    status: local_failures.empty? ? 'ok' : 'action',
    message: local_failures.empty? ? 'Local storefront and Worker URLs match the assigned dev ports.' : 'Local URL overrides do not match the assigned dev ports.',
    details: { mismatches: local_failures }
  )
  checks
end

def check_wrangler(root, config)
  wrangler_path = File.join(root, 'worker', 'wrangler.toml')
  return [Check.new(id: 'worker-wrangler-config', status: 'action', message: 'worker/wrangler.toml is missing.', details: {})] unless File.exist?(wrangler_path)

  content = File.read(wrangler_path)
  vars = parse_toml_assignments(content, '[vars]')
  expected_vars = {
    'SITE_BASE' => EXPECTED_SITE_URL,
    'WORKER_BASE' => EXPECTED_WORKER_URL,
    'CANONICAL_SITE_BASE' => EXPECTED_SITE_URL,
    'CANONICAL_WORKER_BASE' => EXPECTED_WORKER_URL,
    'CORS_ALLOWED_ORIGIN' => EXPECTED_SITE_URL,
    'APP_MODE' => 'live',
    'TAX_PROVIDER' => 'nm_grt',
    'SHIPPING_ORIGIN_ZIP' => '87120',
    'SHIPPING_ORIGIN_COUNTRY' => 'US',
    'USPS_ENABLED' => 'true',
    'EMAIL_OUTBOX_ENABLED' => 'true',
    'PAYMENT_RECONCILIATION_ENABLED' => 'true'
  }
  var_mismatches = expected_vars.filter_map do |key, expected|
    next if normalize_string(vars[key]) == expected

    { key: key, expected: expected, actual: normalize_string(vars[key]) }
  end

  publishable_key = normalize_string(vars['STRIPE_PUBLISHABLE_KEY'] || deep_fetch(config, 'checkout', 'stripe_publishable_key'))
  if !publishable_key.start_with?('pk_live_')
    var_mismatches << { key: 'STRIPE_PUBLISHABLE_KEY', expected: 'pk_live_*', actual: publishable_key.empty? ? '[empty]' : '[non-live key]' }
  end

  do_names = wrangler_binding_names(content, '[[durable_objects.bindings]]')
  r2_names = wrangler_binding_names(content, '[[r2_buckets]]', 'binding')
  kv_names = wrangler_binding_names(content, '[[kv_namespaces]]', 'binding')
  binding_mismatches = []
  binding_mismatches << { binding: 'durable_objects.bindings', expected: REQUIRED_BINDINGS[:durable_object] } unless do_names.include?(REQUIRED_BINDINGS[:durable_object])
  binding_mismatches << { binding: 'r2_buckets', expected: REQUIRED_BINDINGS[:r2_bucket] } unless r2_names.include?(REQUIRED_BINDINGS[:r2_bucket])
  REQUIRED_BINDINGS[:kv_namespaces].each do |name|
    binding_mismatches << { binding: 'kv_namespaces', expected: name } unless kv_names.include?(name)
  end

  [
    Check.new(
      id: 'worker-production-vars',
      status: var_mismatches.empty? ? 'ok' : 'action',
      message: var_mismatches.empty? ? 'Production Worker vars match the launch defaults.' : 'Production Worker vars need launch values.',
      details: { mismatches: var_mismatches }
    ),
    Check.new(
      id: 'worker-bindings',
      status: binding_mismatches.empty? ? 'ok' : 'action',
      message: binding_mismatches.empty? ? 'Required Worker KV, R2, and Durable Object bindings are present.' : 'Required Worker bindings are missing.',
      details: { missing: binding_mismatches }
    )
  ]
end

def check_admin_users(config, root)
  wrangler_path = File.join(root, 'worker', 'wrangler.toml')
  wrangler_vars = File.exist?(wrangler_path) ? parse_toml_assignments(File.read(wrangler_path), '[vars]') : {}
  config_users = parse_admin_users(deep_fetch(config, 'admin', 'users'))
  worker_users = parse_admin_users(wrangler_vars['ADMIN_USERS_JSON'])
  users = worker_users.any? ? worker_users : config_users
  super_admins = users.select { |user| normalize_string(user['role']) == 'super_admin' && normalize_string(user['email']).include?('@') }

  Check.new(
    id: 'admin-bootstrap-users',
    status: super_admins.length >= 2 ? 'ok' : 'warning',
    message: super_admins.length >= 2 ? 'At least two production super admins are configured.' : 'Only one trusted production super admin is configured; add a backup when practical.',
    details: {
      configured_users: users.map { |user| { name: user['name'], email: user['email'], role: user['role'], accessScopes: user['accessScopes'] || user['access_scopes'] || [] } },
      super_admin_count: super_admins.length
    }
  )
end

def check_shipping_tax(config, root)
  wrangler_path = File.join(root, 'worker', 'wrangler.toml')
  wrangler_vars = File.exist?(wrangler_path) ? parse_toml_assignments(File.read(wrangler_path), '[vars]') : {}
  failures = []

  failures << { path: 'tax.provider', expected: 'nm_grt', actual: normalize_string(deep_fetch(config, 'tax', 'provider')) } unless normalize_string(deep_fetch(config, 'tax', 'provider')) == 'nm_grt'
  failures << { path: 'shipping.origin_zip', expected: '87120', actual: normalize_string(deep_fetch(config, 'shipping', 'origin_zip')) } unless normalize_string(deep_fetch(config, 'shipping', 'origin_zip')) == '87120'
  failures << { path: 'shipping.origin_country', expected: 'US', actual: normalize_string(deep_fetch(config, 'shipping', 'origin_country')) } unless normalize_string(deep_fetch(config, 'shipping', 'origin_country')) == 'US'
  failures << { path: 'shipping.usps.enabled', expected: true, actual: deep_fetch(config, 'shipping', 'usps', 'enabled') } unless deep_fetch(config, 'shipping', 'usps', 'enabled') == true
  failures << { path: 'shipping.usps.client_id / USPS_CLIENT_ID', expected: 'production USPS client ID', actual: '[empty]' } if normalize_string(deep_fetch(config, 'shipping', 'usps', 'client_id')).empty? && normalize_string(wrangler_vars['USPS_CLIENT_ID']).empty?

  Check.new(
    id: 'usps-nm-grt-config',
    status: failures.empty? ? 'ok' : 'action',
    message: failures.empty? ? 'USPS and New Mexico GRT launch defaults are configured.' : 'USPS/New Mexico GRT production config needs attention.',
    details: { mismatches: failures }
  )
end

def check_inventory(products)
  problem_rows = products
    .select { |product| launch_product?(product) && tracking_inventory?(product) && INVENTORY_LAUNCH_TYPES.include?(fulfillment_type(product)) }
    .flat_map { |product| inventory_rows(product).map { |row| row.merge(fulfillment_type: fulfillment_type(product), file: product['_file']) } }
    .select { |row| row[:inventory].nil? || (row[:inventory] <= 0 && !row[:verified]) }

  Check.new(
    id: 'active-inventory-baselines',
    status: problem_rows.empty? ? 'ok' : 'action',
    message: problem_rows.empty? ? 'Active physical inventory-tracked SKUs have verified launch baselines.' : "#{problem_rows.length} active physical inventory-tracked SKU#{problem_rows.length == 1 ? '' : 's'} have empty or unverified zero launch baselines.",
    details: {
      count: problem_rows.length,
      sample: compact_sample(problem_rows),
      truncated: problem_rows.length > 12
    }
  )
end

def check_downloads(products)
  digital_products = products.select { |product| launch_product?(product) && fulfillment_type(product) == 'digital' }
  missing_keys = []
  placeholder_keys = []
  configured = []

  digital_products.each do |product|
    download = product['download'].is_a?(Hash) ? product['download'] : {}
    file_key = normalize_string(download['file_key'])
    if file_key.empty?
      missing_keys << { product_id: product['identifier'] || product['sku'], product_name: product['name'], file: product['_file'] }
    elsif file_key.match?(PLACEHOLDER_DOWNLOAD_KEY_PATTERN)
      placeholder_keys << { product_id: product['identifier'] || product['sku'], product_name: product['name'], file_key: file_key, file: product['_file'] }
    else
      configured << { product_id: product['identifier'] || product['sku'], product_name: product['name'], file_key: file_key, file: product['_file'] }
    end
  end

  if missing_keys.any? || placeholder_keys.any?
    return Check.new(
      id: 'digital-download-keys',
      status: 'action',
      message: 'Active digital products must define production download.file_key values.',
      details: { missing: missing_keys, placeholders: placeholder_keys }
    )
  end

  Check.new(
    id: 'digital-download-fulfillment',
    status: configured.empty? ? 'info' : 'manual',
    message: configured.empty? ? 'No active digital products are configured.' : 'Upload each production digital object to STORE_DOWNLOADS or configure a Worker-only fallback URL.',
    details: {
      objects: configured,
      url_env_keys: configured.map do |object|
        key = normalize_string(object[:file_key]).upcase.gsub(/[^A-Z0-9]+/, '_')
        { file_key: object[:file_key], env: "STORE_DOWNLOAD_URL_#{key}" }
      end
    }
  )
end

def manual_check(id, message, details = {})
  Check.new(id: id, status: 'manual', message: message, details: details)
end

def build_checks(root)
  config = safe_load_yaml_file(File.join(root, '_config.yml'))
  local_config = safe_load_yaml_file(File.join(root, '_config.local.yml'))
  products = load_products(root)

  checks = []
  checks.concat(check_urls(config, local_config))
  checks.concat(check_wrangler(root, config))
  checks << check_admin_users(config, root)
  checks << check_shipping_tax(config, root)
  checks << check_inventory(products)
  checks << check_downloads(products)
  checks << manual_check(
    'production-worker-secrets',
    'Set production Worker secrets outside Git before deploy.',
    { required: REQUIRED_SECRETS }
  )
  checks << manual_check(
    'stripe-production-webhook',
    'Create the Stripe production webhook endpoint and set its signing secret.',
    {
      endpoint: "#{EXPECTED_WORKER_URL}/webhooks/stripe",
      events: ['payment_intent.succeeded', 'payment_intent.payment_failed']
    }
  )
  checks << manual_check(
    'resend-production-webhook',
    'Create the Resend delivery webhook endpoint and set its signing secret.',
    {
      endpoint: "#{EXPECTED_WORKER_URL}/webhooks/resend",
      events: ['email.delivered', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed']
    }
  )
  checks << manual_check(
    'launch-smoke-tests',
    'Complete the launch checkout and fulfillment smoke tests before public announcement.',
    { tests: MANUAL_SMOKE_TESTS }
  )
  checks
end

def print_text_report(checks)
  puts 'Store Launch Readiness'
  puts "Generated: #{Time.now.utc.iso8601}"
  puts

  checks.each do |check|
    label = check.status.upcase.ljust(6)
    puts "#{label} #{check.id} - #{check.message}"
    case check.id
    when 'active-inventory-baselines'
      (check.details[:sample] || []).each do |row|
        variant = normalize_string(row[:variant_label]).empty? ? '' : " / #{row[:variant_label]}"
        puts "       - #{row[:sku]}: #{row[:product_name]}#{variant} (#{row[:file]})"
      end
      puts "       - ... #{check.details[:count] - 12} more" if check.details[:truncated]
    when 'digital-download-fulfillment'
      (check.details[:objects] || []).each do |object|
        env_key = (check.details[:url_env_keys] || []).find { |entry| entry[:file_key] == object[:file_key] }&.dig(:env)
        puts "       - #{object[:file_key]} for #{object[:product_name]} (#{object[:file]})"
        puts "         fallback env: #{env_key}" if env_key
      end
    when 'digital-download-keys'
      (check.details[:missing] || []).each do |object|
        puts "       - missing file_key for #{object[:product_name]} (#{object[:file]})"
      end
      (check.details[:placeholders] || []).each do |object|
        puts "       - placeholder file_key #{object[:file_key]} for #{object[:product_name]} (#{object[:file]})"
      end
    when 'production-worker-secrets'
      puts "       - #{check.details[:required].join(', ')}"
    when 'launch-smoke-tests'
      (check.details[:tests] || []).each { |test| puts "       - #{test}" }
    end
  end

  puts
  action_count = checks.count { |check| check.status == 'action' }
  manual_count = checks.count { |check| check.status == 'manual' }
  if action_count.positive?
    puts "#{action_count} action check#{action_count == 1 ? '' : 's'} must be resolved before launch."
  else
    puts 'No local action blockers found.'
  end
  puts "#{manual_count} manual launch check#{manual_count == 1 ? '' : 's'} remain." if manual_count.positive?
end

def main
  options = {
    root: File.expand_path('..', __dir__),
    json: false,
    allow_action: false
  }

  OptionParser.new do |parser|
    parser.banner = 'Usage: scripts/check-launch-readiness.rb [--json] [--allow-action] [--root PATH]'
    parser.on('--json', 'Print machine-readable JSON.') { options[:json] = true }
    parser.on('--allow-action', 'Exit 0 even when action checks are present.') { options[:allow_action] = true }
    parser.on('--root PATH', 'Repository root to inspect.') { |value| options[:root] = File.expand_path(value) }
  end.parse!

  checks = build_checks(options[:root])
  action_count = checks.count { |check| check.status == 'action' }
  manual_count = checks.count { |check| check.status == 'manual' }
  payload = {
    ok: action_count.zero?,
    action_count: action_count,
    manual_count: manual_count,
    checks: checks.map(&:to_h)
  }

  if options[:json]
    puts JSON.pretty_generate(payload)
  else
    print_text_report(checks)
  end

  exit(1) if action_count.positive? && !options[:allow_action]
end

main if $PROGRAM_NAME == __FILE__

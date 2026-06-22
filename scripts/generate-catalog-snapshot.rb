#!/usr/bin/env ruby
# Generate the Worker-side Store catalog snapshot from repo-backed products.

require 'json'
require 'digest'
require 'fileutils'
require 'time'
require 'yaml'

ROOT = File.expand_path('..', __dir__)
PRODUCTS_DIR = File.join(ROOT, '_products')
CONFIG_PATH = File.join(ROOT, '_config.yml')
OUTPUT_DIR = File.join(ROOT, 'worker', 'src', 'generated')
OUTPUT_PATH = File.join(OUTPUT_DIR, 'catalog-snapshot.js')

def load_yaml(path)
  return {} unless File.exist?(path)

  YAML.load_file(path) || {}
end

def load_front_matter(path)
  content = File.read(path)
  return [{}, content] unless content.start_with?("---\n")

  parts = content.split(/^---\s*$/, 3)
  data = YAML.safe_load(
    parts[1] || '',
    permitted_classes: [Date, Time],
    aliases: false
  ) || {}
  body = parts[2] || ''
  [data, body.strip]
end

def slugify(value)
  String(value || '')
    .downcase
    .gsub(/[^a-z0-9]+/, '-')
    .gsub(/^-+|-+$/, '')
end

def numeric(value, fallback = 0)
  parsed = Float(value)
  parsed.finite? ? parsed : fallback
rescue ArgumentError, TypeError
  fallback
end

def integer(value, fallback = 0)
  parsed = numeric(value, fallback).round
  parsed.negative? ? fallback : parsed
end

def cents(value)
  (numeric(value, 0) * 100).round
end

def present_string(value)
  normalized = String(value || '').strip
  normalized.empty? ? nil : normalized
end

def default_shipping_preset(product)
  explicit = present_string(product['shipping_preset'])
  return explicit if explicit

  case String(product['type'] || '').strip
  when 'shirt'
    'tshirt'
  when 'sticker', 'bumper', 'postcard'
    'sticker'
  when 'poster', 'print'
    'poster'
  else
    'parcel'
  end
end

def default_collection(product)
  slugify(present_string(product['store_collection']) || present_string(product['event']) || 'dustwave')
end

def default_storefront_category(product)
  explicit = present_string(product['category'])
  return slugify(explicit) if explicit

  raw_type = String(present_string(product['type']) || '').strip.downcase
  fulfillment_type = String(present_string(product['fulfillment_type']) || present_string(product['type']) || 'physical').strip.downcase
  product_name = String(present_string(product['name']) || '').strip.downcase
  shipping_preset = default_shipping_preset(product)

  return 'downloads' if fulfillment_type == 'digital'
  return 'event-access' if %w[ticket rsvp].include?(fulfillment_type)
  return 'apparel' if %w[shirt thong].include?(raw_type)
  return 'prints' if %w[poster print].include?(raw_type) ||
    shipping_preset == 'poster' ||
    product_name.include?('poster') ||
    product_name.include?('print')
  return 'stickers' if %w[sticker bumper postcard].include?(raw_type)
  return 'media' if raw_type == 'vhs' || product_name.include?('vhs')

  'objects'
end

def i18n_config(config)
  config['i18n'].is_a?(Hash) ? config['i18n'] : {}
end

def default_lang(config)
  present_string(i18n_config(config)['default_lang']) || 'en'
end

def supported_langs(config)
  langs = i18n_config(config)['supported_langs']
  normalized = langs.is_a?(Array) ? langs.filter_map { |lang| present_string(lang) } : []
  normalized.empty? ? [default_lang(config)] : normalized
end

def product_path_prefix(config, lang)
  prefixes = i18n_config(config)['product_path_prefixes']
  prefix = prefixes.is_a?(Hash) ? present_string(prefixes[lang]) : nil
  prefix ||= lang == default_lang(config) ? '/products/' : "/#{lang}/products/"
  prefix = "/#{prefix}" unless prefix.start_with?('/')
  prefix = "#{prefix}/" unless prefix.end_with?('/')
  prefix
end

def localized_product_data(product, lang)
  source = product['localized'] || product['translations']
  return {} unless source.is_a?(Hash)

  localized = source[lang] || source[lang.to_s]
  localized.is_a?(Hash) ? localized : {}
end

def localized_product_slug(product, lang, fallback_slug)
  present_string(localized_product_data(product, lang)['slug']) || fallback_slug
end

def product_localized_paths(config, product, fallback_slug)
  supported_langs(config).each_with_object({}) do |lang, paths|
    paths[lang] = "#{product_path_prefix(config, lang)}#{slugify(localized_product_slug(product, lang, fallback_slug))}/"
  end
end

def compact_hash(hash)
  hash.each_with_object({}) do |(key, value), result|
    next if value.nil?
    next if value.respond_to?(:empty?) && value.empty?

    result[key] = value
  end
end

config = load_yaml(CONFIG_PATH)
site_url = String(config['url'] || '').sub(%r{/+\z}, '')
shipping_config = config['shipping'].is_a?(Hash) ? config['shipping'] : {}
shipping_presets = shipping_config['presets'].is_a?(Hash) ? shipping_config['presets'] : {}

products = Dir.glob(File.join(PRODUCTS_DIR, '*.md')).sort.filter_map do |path|
  product, body = load_front_matter(path)
  filename_slug = File.basename(path, '.md')
  id = present_string(product['identifier']) || present_string(product['id']) || filename_slug
  slug = present_string(product['slug']) || filename_slug
  status = present_string(product['status']) || 'active'
  next if %w[archived archive].include?(status)

  type = present_string(product['fulfillment_type']) || present_string(product['type']) || 'physical'
  price = numeric(product['price'], 0)
  shipping_preset = default_shipping_preset(product)
  configured_shipping = product['shipping'].is_a?(Hash) ? product['shipping'] : shipping_presets[shipping_preset]
  variants = Array(product['variants']).filter_map do |variant|
    next unless variant.is_a?(Hash)

    variant_id = present_string(variant['id']) ||
      present_string(variant['sku']) ||
      slugify(variant['label'] || variant['name'])
    next unless variant_id

    variant_price = numeric(variant.fetch('price', price), price)
    compact_hash(
      'id' => variant_id,
      'label' => present_string(variant['label'] || variant['name']) || variant_id,
      'sku' => present_string(variant['sku']) || "#{id}-#{variant_id}",
      'price' => variant_price,
      'price_cents' => cents(variant_price),
      'inventory' => integer(variant.fetch('inventory', product['inventory']), 0),
      'status' => present_string(variant['status']) || status
    )
  end

  compact_hash(
    'id' => id,
    'slug' => slug,
    'sku' => present_string(product['sku']) || id,
    'name' => present_string(product['name']) || id,
    'description' => present_string(product['description']) || body,
    'long_content' => product['long_content'].is_a?(Array) ? product['long_content'] : nil,
    'price' => price,
    'price_cents' => cents(price),
    'currency' => present_string(product['currency']) || 'USD',
    'image' => present_string(product['image']),
    'url' => site_url.empty? ? "/products/#{slug}/" : "#{site_url}/products/#{slug}/",
    'type' => type,
    'fulfillment_type' => type,
    'status' => status,
    'public' => product.fetch('public', true) != false,
    'launch_test' => product.fetch('launch_test', false) == true,
    'event' => present_string(product['event']),
    'collection' => default_collection(product),
    'category' => default_storefront_category(product),
    'localized_paths' => product_localized_paths(config, product, slug),
    'variant_option_name' => present_string(product['variant_option_name']),
    'variants' => variants,
    'inventory_tracking' => product.fetch('inventory_tracking', false) == true,
    'inventory' => integer(product['inventory'], 0),
    'shipping_preset' => shipping_preset,
    'shipping' => configured_shipping,
    'tax_category' => present_string(product['tax_category']) || 'standard',
    'event_details' => product['event_details'].is_a?(Hash) ? product['event_details'] : nil,
    'download' => product['download'].is_a?(Hash) ? product['download'] : nil,
    'turnstile_required' => product.fetch('turnstile_required', false) == true
  )
end

snapshot_body = {
  'version' => 1,
  'source' => '_products',
  'defaults' => {
    'currency' => 'USD',
    'tax_category' => 'standard'
  },
  'shipping' => {
    'origin_zip' => shipping_config['origin_zip'],
    'origin_country' => shipping_config['origin_country'],
    'fallback_flat_rate' => shipping_config['fallback_flat_rate'],
    'free_shipping_default' => shipping_config['free_shipping_default'],
    'default_option' => shipping_config['default_option'],
    'presets' => shipping_presets
  },
  'products' => products
}

snapshot = snapshot_body.merge(
  'source_hash' => Digest::SHA256.hexdigest(JSON.generate(snapshot_body))
)

FileUtils.mkdir_p(OUTPUT_DIR)
json = JSON.pretty_generate(snapshot)
File.write(
  OUTPUT_PATH,
  <<~JS
    // Generated by scripts/generate-catalog-snapshot.rb. Do not edit manually.
    export const STORE_CATALOG_SNAPSHOT = Object.freeze(#{json});

    export default STORE_CATALOG_SNAPSHOT;
  JS
)

puts "Generated #{OUTPUT_PATH} with #{products.length} products"

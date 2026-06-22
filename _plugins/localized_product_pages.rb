# Generate language-prefixed product presentation pages from canonical _products.

module StoreLocalizedProductPages
  module_function

  def present_string(value)
    normalized = String(value || '').strip
    normalized.empty? ? nil : normalized
  end

  def slugify(value)
    String(value || '')
      .downcase
      .gsub(/[^a-z0-9]+/, '-')
      .gsub(/^-+|-+$/, '')
  end

  def i18n_config(site)
    site.config['i18n'].is_a?(Hash) ? site.config['i18n'] : {}
  end

  def default_lang(site)
    present_string(i18n_config(site)['default_lang']) || present_string(site.config['lang']) || 'en'
  end

  def supported_langs(site)
    configured = i18n_config(site)['supported_langs']
    langs = configured.is_a?(Array) ? configured.map { |lang| present_string(lang) }.compact : []
    langs.empty? ? [default_lang(site)] : langs
  end

  def product_prefixes(site)
    prefixes = i18n_config(site)['product_path_prefixes']
    prefixes.is_a?(Hash) ? prefixes : {}
  end

  def localized_data(product, lang)
    source = product.data['localized'] || product.data['translations']
    return {} unless source.is_a?(Hash)

    value = source[lang] || source[lang.to_s]
    value.is_a?(Hash) ? value : {}
  end

  def localized_slug(product, lang)
    localized_slug = present_string(localized_data(product, lang)['slug'])
    localized_slug || present_string(product.data['slug']) || product.basename_without_ext
  end

  def product_path(site, product, lang)
    default = default_lang(site)
    prefixes = product_prefixes(site)
    prefix = present_string(prefixes[lang])
    prefix ||= lang == default ? '/products/' : "/#{lang}/products/"
    prefix = "/#{prefix}" unless prefix.start_with?('/')
    prefix = "#{prefix}/" unless prefix.end_with?('/')
    "#{prefix}#{slugify(localized_slug(product, lang))}/"
  end

  def localized_paths(site, product)
    supported_langs(site).each_with_object({}) do |lang, paths|
      paths[lang] = product_path(site, product, lang)
    end
  end

  def translation_key(product)
    present_string(product.data['translation_key']) ||
      "product:#{present_string(product.data['identifier']) || product.basename_without_ext}"
  end

  def page_dir(path)
    path.sub(%r{\A/+}, '').sub(%r{/+\z}, '')
  end

  def localized_page_data(product, lang, paths)
    overrides = localized_data(product, lang)
    product_name = overrides.key?('name') ? overrides['name'] : product.data['name']
    data = product.data.dup
    data.delete('permalink')
    data['layout'] = data['layout'] || 'product-preview'
    data['lang'] = lang
    data['store_product'] = true
    data['canonical_product_id'] = present_string(product.data['identifier']) || product.basename_without_ext
    data['translation_key'] = translation_key(product)
    data['localized_paths'] = paths
    data['localized_fallback'] = overrides.empty?
    data['product_name'] = product_name

    %w[name title description image_alt variant_option_name].each do |key|
      next unless overrides.key?(key)

      data[key] = overrides[key]
    end

    data['slug'] = slugify(localized_slug(product, lang))
    data
  end

  def localized_content(product, lang)
    overrides = localized_data(product, lang)
    present_string(overrides['body']) || present_string(overrides['content']) || product.content
  end
end

class StoreLocalizedProductPageGenerator < Jekyll::Generator
  safe true
  priority :low

  def generate(site)
    products = site.collections['products']&.docs || []
    default_lang = StoreLocalizedProductPages.default_lang(site)
    langs = StoreLocalizedProductPages.supported_langs(site)

    products.each do |product|
      paths = StoreLocalizedProductPages.localized_paths(site, product)
      product.data['lang'] ||= default_lang
      product.data['store_product'] = true
      product.data['translation_key'] ||= StoreLocalizedProductPages.translation_key(product)
      product.data['localized_paths'] = paths

      langs.each do |lang|
        next if lang == default_lang

        path = paths[lang]
        next unless path

        page = Jekyll::PageWithoutAFile.new(
          site,
          site.source,
          StoreLocalizedProductPages.page_dir(path),
          'index.html'
        )
        page.data.merge!(StoreLocalizedProductPages.localized_page_data(product, lang, paths))
        page.content = StoreLocalizedProductPages.localized_content(product, lang)
        site.pages << page
      end
    end
  end
end

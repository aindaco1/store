import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');

function readRepoFile(...segments: string[]) {
  return fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

function readOptionalRepoFile(...segments: string[]) {
  const target = path.join(repoRoot, ...segments);
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
}

describe('Store SEO templates', () => {
  it('routes Store public pages through shared SEO, cart, and prefetch includes', () => {
    const defaultLayout = readRepoFile('_layouts', 'default.html');
    const productLayout = readRepoFile('_layouts', 'product-preview.html');
    const header = readRepoFile('_includes', 'header.html');
    const footer = readRepoFile('_includes', 'site-footer.html');
    const productCard = readRepoFile('_includes', 'product-card.html');
    const cartRuntimeHead = readRepoFile('_includes', 'cart-runtime-head.html');
    const cartRuntimeFoot = readRepoFile('_includes', 'cart-runtime-foot.html');
    const pagePrefetch = readRepoFile('_includes', 'page-prefetch.html');
    const responsiveImage = readRepoFile('_includes', 'responsive-image.html');
    const homePage = readRepoFile('index.html');
    const localizedProductPages = readRepoFile('_plugins', 'localized_product_pages.rb');

    expect(defaultLayout).toContain('{% include seo-meta.html');
    expect(defaultLayout).toContain('{% include seo-json-ld.html');
    expect(defaultLayout).toContain('page.store_product == true');
    expect(defaultLayout).toContain('{% include header.html %}');
    expect(defaultLayout).toContain('{% include site-footer.html');
    expect(defaultLayout).toContain('{% include page-prefetch.html %}');
    expect(productLayout).toContain('layout: default');
    expect(productLayout).toContain('{% include product-card.html product=page %}');
    expect(productLayout).toContain('{{ content | sanitize_markdown_links: site.url }}');
    expect(productLayout).toContain('store-product-options.js');
    expect(homePage).toContain('site.products | sort: "order"');
    expect(homePage).toContain('{% include product-card.html product=product %}');
    expect(homePage).toContain('store-product-options.js');
    expect(localizedProductPages).toContain("Jekyll::PageWithoutAFile");
    expect(localizedProductPages).toContain("data['localized_paths'] = paths");
    expect(localizedProductPages).toContain("data['store_product'] = true");
    expect(productCard).toContain('responsive-image.html src=product.image');
    expect(productCard).toContain('{{ desc_text | truncate: 170 | escape }}');
    expect(productCard).toContain('data-item-description="{{ desc_text | escape }}"');
    expect(header).toContain("translation_key='orders'");
    expect(header).toContain("translation_key='terms'");
    expect(header).not.toContain("translation_key='about'");
    expect(header).not.toContain("translation_key='campaigns_index'");
    expect(footer).toContain('responsive-image.html src=footer_logo_path');
    expect(responsiveImage).toContain('local_image_dimensions');
    expect(responsiveImage).toContain('<source type="image/webp" srcset="{{ responsive_srcset | escape }}"');
    expect(cartRuntimeHead).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
    expect(cartRuntimeHead).toContain('<link rel="preconnect" href="https://use.typekit.net" crossorigin>');
    expect(cartRuntimeFoot).toContain('/assets/js/store-config.js?v={{ asset_version }}');
    expect(cartRuntimeFoot).toContain('/assets/js/form-control-identity.js?v={{ asset_version }}');
    expect(cartRuntimeFoot).toContain('/assets/js/cart-runtime-loader.js?v={{ asset_version }}');
    expect(cartRuntimeFoot).toContain('data-store-cart-root="true"');
    expect(cartRuntimeFoot).toContain('data-store-cart-runtime-loader="true"');
    expect(cartRuntimeFoot).not.toContain('/assets/js/pool-config.js');
    expect(cartRuntimeFoot).not.toContain('/assets/js/cart-provider.js');
    expect(pagePrefetch).toContain('site.performance.intent_prefetch_enabled == true');
    expect(pagePrefetch).toContain('/assets/js/page-prefetch.js?v={{ asset_version }}');
    expect(pagePrefetch).toContain('data-store-page-prefetch="true"');
    const prefetchRuntime = readRepoFile('assets', 'js', 'page-prefetch.js');
    expect(prefetchRuntime).toContain('orders|order-success');
  });

  it('emits Store product metadata and Product JSON-LD by default', () => {
    const seoMeta = readRepoFile('_includes', 'seo-meta.html');
    const seoJsonLd = readRepoFile('_includes', 'seo-json-ld.html');

    expect(seoMeta).toContain('page.store_product == true');
    expect(seoMeta).toContain('assign product_display_name = page.product_name');
    expect(seoMeta).toContain('assign raw_title = product_display_name');
    expect(seoMeta).toContain('page.content | default: site.description');
    expect(seoMeta).toContain('page.image | default: site.platform.default_social_image_path');
    expect(seoMeta).toContain('is_store_product and product_display_name');
    expect(seoMeta).toContain('assign image_alt_source = product_display_name');
    expect(seoMeta).toContain('og:image:alt');
    expect(seoMeta).toContain('twitter:image:alt');
    expect(seoJsonLd).toContain('page.store_product == true');
    expect(seoJsonLd).toContain('page.product_name | default: page.name');
    expect(seoJsonLd).toContain('assign jsonld_kind = "product"');
    expect(seoJsonLd).toContain('"@type": "Product"');
    expect(seoJsonLd).toContain('"@type": "Offer"');
    expect(seoJsonLd).toContain('"priceCurrency": "USD"');
    expect(seoJsonLd).toContain('"sku": {{ product_sku | jsonify }}');
    expect(seoJsonLd).toContain('"availability": {{ product_availability | jsonify }}');
    expect(seoJsonLd).toContain('"itemCondition": "https://schema.org/NewCondition"');
  });

  it('marks private Store routes as noindex and keeps them out of crawl files', () => {
    const adminLayout = readRepoFile('_layouts', 'admin.html');
    const adminPage = readRepoFile('admin.md');
    const spanishAdminPage = readOptionalRepoFile('es', 'admin.md');
    const orderLookup = readRepoFile('orders.md');
    const orderSuccess = readRepoFile('order-success.md');
    const robots = readRepoFile('robots.txt');
    const sitemap = readRepoFile('sitemap.xml');

    expect(adminLayout).toContain('indexable=false');
    expect(adminLayout).toContain('social=false');
    expect(adminPage).toContain('indexable: false');
    expect(adminPage).toContain('sitemap: false');
    expect(orderLookup).toContain('indexable: false');
    expect(orderLookup).toContain('sitemap: false');
    expect(orderSuccess).toContain('indexable: false');
    if (spanishAdminPage) {
      expect(spanishAdminPage).toContain('indexable: false');
      expect(spanishAdminPage).toContain('sitemap: false');
    }
    expect(robots).toContain('Disallow: /admin/');
    expect(robots).toContain('Disallow: /es/admin/');
    expect(robots).toContain('Disallow: /orders/');
    expect(robots).toContain('Disallow: /order-success/');
    expect(robots).toContain('Disallow: /api/');
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(sitemap).toContain('assign sitemap_products = site.products');
    expect(sitemap).toContain('assign sitemap_localized_products = site.pages');
    expect(sitemap).toContain("item.sitemap != false");
    expect(sitemap).toContain("item.indexable != false");
    expect(sitemap).toContain("item.test_only != true");
    expect(sitemap).toContain('{%- for item in sitemap_products -%}');
    expect(sitemap).toContain('{%- for item in sitemap_localized_products -%}');
    expect(sitemap).not.toContain('site.campaigns');
  });

  it('keeps locale and navigation plumbing on canonical Store pages', () => {
    const footer = readRepoFile('_includes', 'site-footer.html');
    const switcher = readRepoFile('_includes', 'language-switcher.html');
    const localizedUrl = readRepoFile('_includes', 'localized-url.html');
    const seoJsonLd = readRepoFile('_includes', 'seo-json-ld.html');
    const config = readRepoFile('_config.yml');

    expect(footer).toContain('translation_key=current_translation_key');
    expect(footer).toContain('localized_paths=current_localized_paths');
    expect(switcher).toContain('switcher_target_count');
    expect(switcher).toContain('include.lang | default: page.lang');
    expect(switcher).toContain('include.localized_paths | default: page.localized_paths');
    expect(localizedUrl).toContain('localized_page[default_lang]');
    expect(localizedUrl).toContain('include.translation_key and include.translation_key != page.translation_key');
    expect(seoJsonLd).toContain('is_store_product');
    expect(seoJsonLd).toContain("localized-url.html lang=current_lang translation_key='home'");
    expect(seoJsonLd).toContain('availableLanguage');
    expect(seoJsonLd).toContain('"inLanguage": {{ current_lang | jsonify }}');
    expect(config).toContain('product_path_prefixes:');
    expect(config).toMatch(/es:\s*["']?\/es\/products\/["']?/);
    expect(config).toContain('pages:');
    expect(config).toContain('home:');
    expect(config).not.toContain('about:');
    expect(config).toContain('orders:');
    expect(config).toContain('admin:');
  });
});

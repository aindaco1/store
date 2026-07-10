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
    const storefrontHome = readRepoFile('_includes', 'storefront-home.html');
    const localizedProductPages = readRepoFile('_plugins', 'localized_product_pages.rb');

    expect(defaultLayout).toContain('{% include seo-meta.html');
    expect(defaultLayout).toContain('{% include seo-json-ld.html');
    expect(defaultLayout).toContain('page.store_product == true');
    expect(defaultLayout).toContain('{% include header.html %}');
    expect(defaultLayout).toContain('{% include site-footer.html');
    expect(defaultLayout).toContain('{% include page-prefetch.html %}');
    expect(productLayout).toContain('layout: default');
    expect(productLayout).toContain('show_summary=false');
    expect(productLayout).toContain('image_loading="eager"');
    expect(productLayout).toContain('{{ content | sanitize_markdown_links: site.url }}');
    expect(productLayout).toContain('store-product-options.js');
    expect(homePage).toContain('{% include storefront-home.html');
    expect(storefrontHome).toContain('site.products | sort: "order"');
    expect(storefrontHome).toContain('visible_product_index < 3');
    expect(storefrontHome).toContain('image_loading=product_image_loading');
    expect(storefrontHome).toContain('store-product-options.js');
    expect(localizedProductPages).toContain("Jekyll::PageWithoutAFile");
    expect(localizedProductPages).toContain("data['localized_paths'] = paths");
    expect(localizedProductPages).toContain("data['store_product'] = true");
    expect(productCard).toContain('responsive-image.html src=product.image');
    expect(productCard).toContain('loading=product_image_loading');
    expect(productCard).toContain('{{ desc_text | truncate: 170 | escape }}');
    expect(productCard).toContain('data-item-description="{{ desc_text | escape }}"');
    expect(header).toContain("translation_key='orders'");
    expect(header).toContain("translation_key='terms'");
    expect(header).not.toContain("translation_key='about'");
    expect(header).not.toContain("translation_key='campaigns_index'");
    expect(header).toContain('<script data-cfasync="false" src="/assets/js/header-nav.js" defer></script>');
    expect(header).toContain('<script data-cfasync="false" src="/assets/js/a11y-live.js" defer></script>');
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
    expect(seoMeta).toContain('assign og_type = "product"');
    expect(seoMeta).toContain('product:price:amount');
    expect(seoMeta).toContain('product:retailer_item_id');
    expect(seoJsonLd).toContain('page.store_product == true');
    expect(seoJsonLd).toContain('page.product_name | default: page.name');
    expect(seoJsonLd).toContain('assign jsonld_kind = "product"');
    expect(seoJsonLd).toContain('"@type": "Product"');
    expect(seoJsonLd).toContain('"@type": "Offer"');
    expect(seoJsonLd).toContain('"priceCurrency": "USD"');
    expect(seoJsonLd).toContain('"sku": {{ product_sku | jsonify }}');
    expect(seoJsonLd).toContain('"productID": {{ product_id | jsonify }}');
    expect(seoJsonLd).toContain('"inLanguage": {{ current_lang | jsonify }}');
    expect(seoJsonLd).toContain('"availability": {{ product_availability | jsonify }}');
    expect(seoJsonLd).toContain('"itemCondition": "https://schema.org/NewCondition"');
    expect(seoJsonLd).toContain('"@type": "MerchantReturnPolicy"');
    expect(seoJsonLd).toContain('"/terms/#returns-refunds"');
    expect(seoJsonLd).toContain('site.seo.merchant_return_policy');
    expect(seoJsonLd).toContain('"applicableCountry": {{ return_policy_country | jsonify }}');
    expect(seoJsonLd).toContain('"returnPolicyCategory": {{ return_policy_category | jsonify }}');
    expect(seoJsonLd).toContain('"returnFees": {{ return_fees | jsonify }}');
  });

  it('marks private Store routes as noindex and keeps them out of crawl files', () => {
    const adminLayout = readRepoFile('_layouts', 'admin.html');
    const adminCsp = readRepoFile('_includes', 'first-party-admin-csp.html');
    const adminPage = readRepoFile('admin.md');
    const spanishAdminPage = readOptionalRepoFile('es', 'admin.md');
    const orderLookup = readRepoFile('orders.md');
    const orderSuccess = readRepoFile('order-success.md');
    const robots = readRepoFile('robots.txt');
    const sitemap = readRepoFile('sitemap.xml');

    expect(adminLayout).toContain('indexable=false');
    expect(adminLayout).toContain('social=false');
    expect(adminLayout).toContain('data-cfasync="false"');
    expect(adminLayout).toContain('/assets/js/vendor/qrcode-generator.js?v={{ asset_version }}');
    expect(adminCsp).toContain('https://challenges.cloudflare.com');
    expect(adminCsp).not.toContain('cloudflareinsights.com');
    expect(adminCsp).not.toContain("'sha256-");
    expect(adminCsp).not.toContain("'unsafe-inline'");
    expect(adminCsp).not.toContain("'unsafe-eval'");
    const qrVendor = readRepoFile('assets', 'js', 'vendor', 'qrcode-generator.js');
    expect(qrVendor).toContain('QR Code Generator for JavaScript');
    expect(qrVendor).toContain('window.qrcode = qrcode');
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
    expect(robots).not.toContain('Disallow: /orders/');
    expect(robots).not.toContain('Disallow: /order-success/');
    expect(robots).toContain('Disallow: /api/');
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">');
    expect(sitemap).toContain('assign sitemap_products = site.products');
    expect(sitemap).toContain('assign sitemap_localized_products = site.pages');
    expect(sitemap).toContain("item.sitemap != false");
    expect(sitemap).toContain("item.indexable != false");
    expect(sitemap).toContain("item.test_only != true");
    expect(sitemap).toContain('assign product_public = true');
    expect(sitemap).toContain('assign product_sitemap_status = false');
    expect(sitemap).toContain('product_status == "active" or product_status == "sold_out"');
    expect(sitemap).toContain('seo-sitemap-url.xml');
    expect(sitemap).toContain('{%- for item in sitemap_products -%}');
    expect(sitemap).toContain('{%- for item in sitemap_localized_products -%}');
    expect(sitemap).not.toContain('site.campaigns');
    const sitemapUrlInclude = readRepoFile('_includes', 'seo-sitemap-url.xml');
    expect(sitemapUrlInclude).toContain('xhtml:link rel="alternate"');
    expect(sitemapUrlInclude).toContain('hreflang="x-default"');
    expect(sitemapUrlInclude).toContain('localized-url.html lang=lang');
  });

  it('keeps first-party admin scripts free of dynamic string evaluation', () => {
    const adminRuntime = [
      ['assets', 'js', 'header-nav.js'],
      ['assets', 'js', 'a11y-live.js'],
      ['assets', 'js', 'store-config.js'],
      ['assets', 'js', 'logger.js'],
      ['assets', 'js', 'video-first-frame-poster.js'],
      ['assets', 'js', 'form-control-identity.js'],
      ['assets', 'js', 'vendor', 'qrcode-generator.js'],
      ['assets', 'js', 'admin-dashboard.js']
    ].map((segments) => readRepoFile(...segments)).join('\n');

    expect(adminRuntime).not.toMatch(/\beval\s*\(/);
    expect(adminRuntime).not.toMatch(/\bnew\s+Function\s*\(/);
    expect(adminRuntime).not.toMatch(/\bFunction\s*\(\s*['"`]/);
    expect(adminRuntime).not.toMatch(/\bset(?:Timeout|Interval)\s*\(\s*['"`]/);
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
    expect(config).toContain('merchant_return_policy:');
    expect(config).toContain('return_policy_category: https://schema.org/MerchantReturnFiniteReturnWindow');
    expect(config).toContain('return_fees: https://schema.org/ReturnFeesCustomerResponsibility');
    expect(config).toMatch(/es:\s*["']?\/es\/products\/["']?/);
    expect(config).toContain('pages:');
    expect(config).toContain('home:');
    expect(config).not.toContain('about:');
    expect(config).toContain('orders:');
    expect(config).toContain('admin:');
  });

  it('audits rendered localized product language and breadcrumb metadata', () => {
    const seoAudit = readRepoFile('scripts', 'audit-seo.mjs');

    expect(seoAudit).toContain('Product JSON-LD inLanguage');
    expect(seoAudit).toContain('does not match html lang');
    expect(seoAudit).toContain("hasType(node, 'BreadcrumbList')");
    expect(seoAudit).toContain('BreadcrumbList should include home and product entries');
    expect(seoAudit).toContain('BreadcrumbList position');
    expect(seoAudit).toContain('BreadcrumbList item ${index + 1}');
  });

  it('exposes current SEO customization fields in the admin settings pipeline', () => {
    const worker = readRepoFile('worker', 'src', 'index.js');
    const syncWorkerConfig = readRepoFile('scripts', 'sync-worker-config.rb');
    const dashboardSpec = readRepoFile('tests', 'e2e', 'admin-dashboard.spec.ts');
    const dashboardDocs = readRepoFile('docs', 'DASHBOARD.md');

    expect(worker).toContain('ADMIN_RETURN_POLICY_CATEGORY_OPTIONS');
    expect(worker).toContain('ADMIN_SETTING_LOCALIZATIONS');
    expect(worker).toContain('seo.merchant_return_policy.applicable_country');
    expect(worker).toContain('seo.merchant_return_policy.return_policy_category');
    expect(worker).toContain('seo.merchant_return_policy.merchant_return_days');
    expect(worker).toContain('seo.merchant_return_policy.return_fees');
    expect(worker).toContain('seo.merchant_return_policy.return_method');
    expect(syncWorkerConfig).toContain('SEO_RETURN_POLICY_APPLICABLE_COUNTRY');
    expect(syncWorkerConfig).toContain('SEO_RETURN_POLICY_CATEGORY');
    expect(syncWorkerConfig).toContain('SEO_MERCHANT_RETURN_DAYS');
    expect(syncWorkerConfig).toContain('SEO_RETURN_FEES');
    expect(syncWorkerConfig).toContain('SEO_RETURN_METHOD');
    expect(dashboardSpec).toContain('Return policy country');
    expect(dashboardSpec).toContain('Pais de politica de devoluciones');
    const adminDashboardRuntime = readRepoFile('assets', 'js', 'admin-dashboard.js');
    expect(adminDashboardRuntime).toContain("params: { preferredLang: preferredLang() }");
    expect(adminDashboardRuntime).toContain("about: 'Acerca de'");
    expect(dashboardSpec).toContain('seo.merchant_return_policy.return_fees');
    expect(dashboardDocs).toContain('merchant return policy controls');
  });
});

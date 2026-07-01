# SEO

Store SEO focuses on public product, terms, and home pages. Admin pages are excluded from crawl-oriented metadata and audit coverage. Private order and fulfillment shells remain `noindex`.

## Release v1.0.4 Audit

- Store-owned order emails and Order Success changes do not add indexable fulfillment URLs.
- Ticket/download/check-in links remain token-scoped Worker routes outside the sitemap.
- Admin remains disallowed in `robots.txt`; order lookup and Order Success are crawlable `noindex` pages so search engines can see the directive.
- `sitemap.xml` emits only canonical, indexable public pages and active/sold-out public products; archived and `public: false` products are excluded.
- Sitemap and page metadata include reciprocal `hreflang` alternates for generated localized product routes and localized public shells such as home and Terms.
- Product SEO still depends on `_products/*` fields, generated localized product routes, and Store's Product/Offer JSON-LD.

## Public Metadata

Shared includes generate:

- canonical URLs
- alternate locale links
- Open Graph tags
- Twitter card tags
- JSON-LD
- sitemap entries

Product pages emit Product JSON-LD from `_products/` metadata, including Product, Offer, BreadcrumbList, Organization, and merchant return policy data. Product pages with variants emit multiple Offer entries so each variant price/availability state can be represented. Super admins can customize social defaults, same-as links, and merchant return policy values from **Settings -> Brand & SEO**.

## Private Routes

These routes should stay out of search indexes:

- `/admin/`
- `/orders/`
- `/es/orders/`
- `/order-success/`
- `/es/order-success/`
- token-scoped Worker fulfillment, lookup, reminder, and check-in routes

`/orders/`, `/es/orders/`, `/order-success/`, and `/es/order-success/` must stay out of the sitemap and keep `noindex,nofollow` metadata, but they should not be `robots.txt`-blocked because crawlers need to access the HTML to observe `noindex`.

## Required Product Fields

Public product SEO depends on:

- `title`
- `description`
- `image`
- `image_alt`
- `price`
- `sku`
- `status`

Run:

```bash
bundle exec jekyll build --quiet
npm run test:seo
npm run test:content-security
```

# SEO

Store SEO focuses on public product, terms, and home pages. Private order/admin/lookup routes are noindex.

## Release v1.0.4 Audit

- Store-owned order emails and Order Success changes do not add indexable fulfillment URLs.
- Ticket/download/check-in links remain token-scoped Worker routes outside the sitemap.
- Admin, order lookup, and Order Success routes remain private/noindex surfaces.
- Product SEO still depends on `_products/*` fields and generated localized product routes.

## Public Metadata

Shared includes generate:

- canonical URLs
- alternate locale links
- Open Graph tags
- Twitter card tags
- JSON-LD
- sitemap entries

Product pages emit Product JSON-LD from `_products/` metadata.

## Private Routes

These routes should stay out of search indexes:

- `/admin/`
- `/orders/`
- `/order-success/`
- token-scoped Worker fulfillment, lookup, reminder, and check-in routes

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
npm run test:content-security
bundle exec jekyll build --quiet
```

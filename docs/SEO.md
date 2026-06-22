# SEO

Store SEO focuses on public product, terms, and home pages. Private order/admin routes are noindex.

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
- `/order-success/`
- token-scoped Worker fulfillment routes

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

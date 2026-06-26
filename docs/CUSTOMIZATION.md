# Customization

Store customization is centered on `_config.yml`, `_products/`, and the admin dashboard.

## Identity And URLs

Edit `_config.yml`:

```yaml
platform:
  name: Store
  company_name: Dust Wave
  site_url: "https://shop.dustwave.xyz"
  worker_url: "https://checkout.dustwave.xyz"
```

Local overrides belong in `_config.local.yml`.

Settings published from the admin dashboard write back to `_config.yml` in production through GitHub, or through the local repo sidecar during dev.

## Products

Each sellable item lives in `_products/*.md`. Product records should define:

- `title`
- `price`
- `sku`
- `fulfillment_type`
- `status`
- `image`
- `image_alt`
- shipping metadata for physical products
- tax category
- variants when needed
- download metadata for digital products
- event metadata for ticket/RSVP products
- optional `store_collection` and `storefront_category` storefront taxonomy fields

Regenerate Worker config and the catalog snapshot after product edits:

```bash
npm run sync:worker-config
```

Storefront taxonomy labels and filter order live in `_config.yml` under `storefront.collections` and `storefront.categories`.

Current taxonomy rules:

- Prefer `store_collection` for the storefront collection filter.
- Prefer `storefront_category` or `product_category` for the storefront category filter.
- The migrated Dust Wave catalog still uses `category: dustwave` or `category: fronteras`; because those values match configured collection IDs, `_includes/product-taxonomy.html` treats them as collections.
- When no explicit category exists, Store derives category from `fulfillment_type`, `type`, shipping preset, and product name.
- Do not use `collection` as product front matter; Jekyll reserves that field for collection documents.

Product localization uses one canonical product file. Generated language-prefixed pages use `localized.{lang}` overrides when present and fall back to canonical content when omitted:

```yaml
localized:
  es:
    slug: fronteras-camiseta
    name: Camiseta Fronteras
    description: Camiseta oficial del festival.
    body: |
      Camiseta oficial del Fronteras Micro-film Festival.
```

## Checkout

Store uses the first-party cart and Worker order API. Do not add Snipcart markup or external cart runtimes.

Relevant config:

```yaml
pricing:
  sales_tax_rate: 0.07625
  default_tip_percent: 0
  max_tip_percent: 15

tax:
  provider: "nm_grt"

shipping:
  origin_zip: "87120"
  usps:
    enabled: true
```

Coupons are managed in **Admin -> Coupons** and stored in Worker KV, not `_config.yml`. They are applied server-side before tax, shipping, and optional tip totals.

## Admin Users

Admins are managed through the dashboard or `_config.yml` during bootstrap:

```yaml
admin:
  users:
    - name: Alonso
      email: alonso@dustwave.xyz
      role: super_admin
```

Limited admins use `accessScopes: ["store"]`.

## Media

Product images should live under `assets/images/products/` when uploaded through admin. Source media stays in the repo; generated derivatives belong to the optimization pipeline.

Settings image uploads use `assets/images/defaults/` by default. Product media uploads use `assets/images/products/` and can trigger the media optimization workflow in production.

Run checks:

```bash
npm run media:optimize:check
npm run assets:minify:check
```

## Digital Downloads

Digital products should define a stable `download.file_key`. Upload or replace the matching object from the admin Downloads tab. Production downloads are served from the `STORE_DOWNLOADS` R2 binding through signed Worker routes.

The Downloads tab is now a reusable file library. Create library files there, then attach the selected file key to a digital product or digital variant from the product editor.

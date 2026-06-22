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
- optional `store_collection` and `category` storefront taxonomy fields

Regenerate the Worker catalog after product edits:

```bash
npm run catalog:generate
```

Storefront taxonomy labels and filter order live in `_config.yml` under `storefront.collections` and `storefront.categories`. Products can override `store_collection` and `category` in front matter, but existing products derive those values from `event`, `type`, `fulfillment_type`, and shipping metadata. Do not use `collection` as product front matter; Jekyll reserves that field for collection documents.

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

Run checks:

```bash
npm run media:optimize:check
npm run assets:minify:check
```

## Digital Downloads

Digital products should define a stable `download.file_key`. Upload or replace the matching object from the admin Downloads tab. Production downloads are served from the `STORE_DOWNLOADS` R2 binding through signed Worker routes.

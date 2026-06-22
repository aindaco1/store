# Store Products And Optional Add-Ons

Store's primary catalog lives in `_products/`. Optional add-ons remain available as secondary cart upsells, but the default Store launch path should use first-class products for merch, tickets, RSVPs, and downloads.

## Primary Products

Use `_products/*.md` for products that should appear on the storefront and have product detail pages.

Required fields:

```yaml
identifier: fronteras-t-shirt
sku: fronteras-t-shirt
name: Fronteras T-Shirt
price: 30
image: "/assets/images/fronteras-tshirt.png"
type: shirt
fulfillment_type: physical
status: active
event: fronteras
store_collection: fronteras
category: apparel
order: 20
shipping_preset: tshirt
tax_category: standard
inventory_tracking: true
inventory: 0
```

Supported fulfillment types:

- `physical`
- `digital`
- `ticket`
- `rsvp`

Optional storefront taxonomy fields:

- `store_collection` groups products by campaign or event. When omitted, Store falls back to `event`, then `dustwave`.
- `category` powers storefront category filters. When omitted, Store derives a category from `fulfillment_type`, `type`, shipping preset, and product name.

Current derived categories:

- `apparel`
- `prints`
- `stickers`
- `event-access`
- `downloads`
- `media`
- `objects`

Supported statuses:

- `active`
- `draft`
- `archived`

Variants live on the product:

```yaml
variant_option_name: Size
variants:
  - id: xs
    label: XS
    sku: fronteras-t-shirt-xs
    price: 30
    inventory: 0
  - id: m
    label: M
    sku: fronteras-t-shirt-m
    price: 30
    inventory: 0
```

Optional localized presentation fields live under `localized.{lang}`. They do not create separate sellable products:

```yaml
localized:
  es:
    slug: fronteras-camiseta
    name: Camiseta Fronteras
    description: Camiseta oficial del festival.
    body: |
      Camiseta oficial del Fronteras Micro-film Festival.
```

When localized content is omitted, Store still generates language-prefixed product pages and falls back to the canonical product content.

Digital products must declare a private download key:

```yaml
download:
  file_key: dust-wave-digital-download
  delivery: signed_link
  expires_hours: 72
```

That key maps to a private `STORE_DOWNLOADS` R2 object or Worker-only fallback URL and is fulfilled through token-scoped signed links after the order is confirmed.

## Shipping And Tax

Physical products should use a shared shipping preset unless they need explicit package dimensions.

Current presets:

- `tshirt`
- `sticker`
- `poster`
- `parcel`
- `mug`
- `ticket`

Tax categories:

- `standard`
- `digital`
- `admission`
- `exempt`

The Worker remains authoritative for USPS/NM GRT calculations. Browser product data is display and cart-intent input only.

## Inventory

Inventory can live on the product or per variant. The Admin dashboard can write live baselines without hand-editing product files.

Rules:

- `inventory_tracking: true` means checkout should enforce available quantity.
- Positive-count checkout reserves inventory before payment.
- Stripe success commits reservations.
- Stripe failure releases reservations.
- Admin baselines are audited Store admin mutations.

The imported Dust Wave catalog uses `0` as a placeholder where the legacy Snipcart storefront did not provide real counts.

## Optional Add-Ons

Optional add-ons live under `add_ons` in `_config.yml` and are exposed through `/api/add-ons.json`.

Use add-ons only for secondary cart suggestions that should not have their own storefront product page.

```yaml
add_ons:
  enabled: true
  low_stock_threshold: 5
  products:
    - id: sticker-pack
      name: "Sticker Pack"
      description: "A small pack of Store stickers."
      image_url: "/assets/images/sticker-pack.png"
      price: 8
      category: physical
      shipping_preset: sticker
      inventory: 20
```

Add-ons support:

- fixed-price products
- simple variants
- physical or digital categories
- shared shipping presets
- inventory display and validation

For the current Dust Wave Store launch, keep the main sellable catalog in `_products/` and use add-ons sparingly.

## Content Safety

Run:

```bash
npm run test:content-security
```

The product audit checks required metadata, prices, inventory, image paths, fulfillment/status values, digital download keys, unsafe Markdown links, and raw HTML/script surfaces.

Do not author raw HTML in product markdown. Use Markdown text and local product images under `assets/images/`.

## Regeneration

When product, shipping, tax, pricing, or URL settings change:

```bash
npm run sync:worker-config
```

That regenerates the Worker catalog/config snapshots used for server-authoritative validation.

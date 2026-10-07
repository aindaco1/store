# Store Products And Optional Add-Ons

Store's primary catalog lives in `_products/`. Optional add-ons remain available as secondary cart upsells, but the default Store launch path should use first-class products for merch, tickets, RSVPs, downloads, and services.

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
- `service`

Use `service` for paid, non-shipping work or support that should produce an order receipt without a download, ticket, RSVP, calendar file, or check-in artifact. Service products remain subject to canonical Worker price, coupon, tax, order, email, and status validation.

Optional storefront taxonomy fields:

- `store_collection` groups products by collection, product line, or event. When omitted, Store falls back to `event`, then `dustwave`.
- `storefront_category` or `product_category` powers storefront category filters. When omitted, Store derives a category from `fulfillment_type`, `type`, shipping preset, and product name.
- `category` is still accepted for migrated catalog records. If it matches a configured `storefront.collections` id such as `dustwave` or `fronteras`, Store treats it as the collection. If it does not match a collection id, Store treats it as an explicit category.

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

Variants live on the product. Catalog and product-page option dropdowns use a visible theme-colored caret, including during keyboard focus:

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
```

That key maps to a private `STORE_DOWNLOADS` R2 object or Worker-only fallback URL and is fulfilled through token-scoped signed links after the order is confirmed. Confirmed digital entitlements do not expire unless an admin explicitly revokes access.

## Pay what you want

Use the Products editor's **Pricing → Pay what you want** option for one-time
contributions. This mode uses `service` fulfillment without variants or inventory
tracking. **Price (USD)** is the starting amount; **Suggested amounts (USD)** accepts
up to six distinct comma-separated amounts. Customers can always enter their own.

```yaml
price: 10
pricing_mode: pay_what_you_want
suggested_amounts: [10, 25, 50, 100]
currency: USD
fulfillment_type: service
inventory_tracking: false
tax_category: standard
```

Omitted `pricing_mode` means fixed pricing. The browser submits
`customAmountCents` as an integer; the Worker permits it only for a currently
available contribution product, from 50 cents through the existing Store amount
ceiling. The $0.50 floor supports standalone USD payments. Quantity is one:
adding the same contribution again replaces its chosen amount. Selected amounts
survive cart reload and payment return; final validation and the payment hash bind
the canonical amount. Existing receipts, Orders, Analytics and CSVs use the stored
unit price, including after later changes to suggestions or the starting price.

Contributions are excluded from every coupon, including product-scoped codes.
Mixed-cart coupons still discount eligible ordinary items. Any cart containing a
contribution defaults the optional tip to 0% unless the customer already chose a
tip; removing the contribution restores the normal default for an untouched tip.
Tax still follows the product's existing tax category. Contribution-only carts
hide the coupon field and use the normal contact, tax and explicit payment flow.
They issue no ticket, calendar, RSVP, download or shipping entitlement.

`support-paradiso` is the initial product, with $10 / $25 / $50 / $100 suggestions
and standard tax. Its ticket and sponsorship products are separate. There is no
public fundraising meter, recurring billing or new payment/storage provider.

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

### Variant prices

An add-on variant may set its own `price`. Store uses one canonical rule in catalog generation, admin serialization, Worker validation, and the browser cart:

- A blank or omitted variant price inherits the add-on's base price.
- An explicit `0` is a valid free override; truthiness must never be used to resolve prices.
- A nonblank override must be a finite, nonnegative amount and must not exceed the Store-wide `$1,000,000` amount ceiling.
- New selections and changed variants use current catalog pricing. Browser-submitted price values are never authoritative.
- Confirmed orders keep their stored `unitPrice`; later catalog edits do not rewrite email, analytics, export, or historical order totals.

Use `resolveUnitPrice` from `assets/js/add-on-utils.js` for browser behavior. Worker/admin/catalog code should preserve the same contract instead of adding local fallback math.

For the current Dust Wave Store launch, keep the main sellable catalog in `_products/` and use add-ons sparingly.

## Coupons

Coupons are not add-ons. Admin-managed coupon definitions live in `STORE_STATE` at `store-coupons:v1` and are applied by the Worker during cart validation/checkout.

Coupon support includes:

- active or draft status
- percent or fixed-amount discounts
- whole-cart or product-scoped eligibility
- optional start/end dates
- order/email snapshots of the applied discount

Use **Admin -> Coupons** for coupon operations instead of editing product or add-on metadata.

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

That regenerates the Worker catalog/config snapshots used for server-authoritative validation. Use `npm run catalog:generate` only when you need to refresh `worker/src/generated/catalog-snapshot.js` without also mirroring `_config.yml` into `worker/wrangler.toml`.

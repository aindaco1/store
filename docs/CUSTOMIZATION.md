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

## Public Routes And Localization

English is the canonical locale. Spanish public shells currently exist for:

- `/es/`
- `/es/terms/`
- `/es/orders/`
- `/es/order-success/`
- `/es/admin/`
- generated `/es/products/:slug/` pages

Route mappings live under `i18n.pages` and `i18n.product_path_prefixes` in `_config.yml`. UI strings live in `_data/i18n/{lang}.yml`. Do not machine-translate product titles, product descriptions, customer names, order contents, or other creator/user-authored content unless that content has an explicit `localized.{lang}` override.

Storefront collection/category filter labels can be localized in `_config.yml` under `storefront.collections[].localized.{lang}.label` and `storefront.categories[].localized.{lang}.label`.

## Products

Each sellable item lives in `_products/*.md`. Product records should define:

- `title`
- `description`
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

The admin product editor separates visible product copy from metadata:

- **Product page content** writes the visible product-detail body/blocks.
- **SEO description** writes front matter `description` and feeds meta descriptions, social share copy, and Product JSON-LD.

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

Event products should store the venue name in `event_details.venue` and the street/city/state/ZIP in `event_details.address`. The public product page and admin preview display the venue separately, compact U.S. addresses to the shopper-facing form, and link the address to Google Maps. For example:

```yaml
event_details:
  venue: "Guild Cinema"
  address: |-
    3405 Central Ave NE
    Albuquerque, NM 87106
```

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

## SEO And Policy Metadata

The admin **Settings -> Brand & SEO** section can publish:

- social image defaults and alt text
- same-as/social profile URLs
- merchant return policy values used in Product JSON-LD

Store defaults to `https://schema.org/MerchantReturnNotPermitted`. With that category, Worker synchronization clears return-window, method, and fee variables so JSON-LD cannot publish a fictitious return program. Forks that intentionally support returns may choose a finite or unlimited return category; finite returns use the matching days, method, and fee values from the same Settings/config surface.

The Terms page is the source for customer-facing policy copy and follows the configured category: Store's default is final sale for change-of-mind, preference, fit, and sizing, while fulfillment errors, damaged/defective/incorrect/missing items, delayed or canceled fulfillment, duplicate charges, fraud, and legally required remedies remain separate. It also documents Store-specific order confirmation, server-verified totals, physical shipping, tickets/RSVPs, durable downloads, transactional messages, private links, data handling, and open-source boundaries. Checkout exposes the final-sale rule before payment, and stable `#shipping-policy` and `#returns-refunds` anchors power direct footer/mobile links. The Spanish Terms route is currently machine translated and should receive legal/native review before production/legal-sensitive use.

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

Product media should live under `assets/images/products/`, `assets/videos/products/`, or `assets/audio/products/` when uploaded through admin. Add-on and default media use the matching `add-ons/` and `defaults/` directories. Source media stays authoritative in Git; generated derivatives and `_data/media-optimization-manifest.json` belong to the deterministic optimization pipeline and are not a second media database.

The manifest records source hashes, byte sizes, image dimensions, audio/video duration, derivative state, source references, intentionally skipped larger derivatives, and broken references. Placement budgets are warnings for product cards, detail pages, social previews, checkout/order presentation, and admin previews; unsafe types and paths remain hard failures.

Meaningful product images require useful alt text. Use the explicit decorative state only when the image adds no information, in which case empty alt text is correct. Existing empty-alt content remains readable but should be migrated when touched.

Run checks:

```bash
npm run media:manifest
npm run media:optimize:check
npm run assets:minify:check
```

Use `npm run media:optimize` for a reviewed full local repair. Dashboard uploads can dispatch the repository workflow with `scope=changed`; super-admins may request `scope=all`. Optimization runs outside the Worker, preserves source files, and keeps deliberately skipped larger derivatives recorded rather than generating wasteful output.

## Digital Downloads

Digital products should define a stable `download.file_key`. Upload or replace the matching object from the admin Downloads tab. Production downloads are served from the `STORE_DOWNLOADS` R2 binding through signed Worker routes.

The Downloads tab is now a reusable file library. Create library files there, then attach the selected file key to a digital product or digital variant from the product editor.

Confirmed digital entitlements stay available from the token-scoped order page unless an admin revokes access from Orders. Individual signed download URLs remain short-lived and can be refreshed while entitlement is active.

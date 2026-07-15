# Admin Dashboard

This document describes the current Store admin dashboard at `/admin/` and `/es/admin/`.

Audience: Store maintainers and developers who need to operate, test, or extend the admin dashboard.

## Current Scope

The dashboard is now the Store back office. It manages platform settings, product catalog content, coupons, digital download files, order fulfillment, analytics, and marketing links.

Top-level tabs appear in this order:

1. Settings
2. Products
3. Coupons
4. Downloads
5. Orders
6. Analytics
7. Marketing

There are no standalone Add-ons, Inventory, or Health tabs. Add-on settings live in Settings -> Platform, inventory is managed in Products, and launch/usage checks live in Settings -> Store readiness and Settings -> Plan usage.

The dashboard remembers the last selected top-level tab and Settings section in `localStorage` under `store-admin-dashboard-state:v1`. The stored state contains only sanitized navigation identifiers, is ignored when a tab is not visible for the authenticated role, and never overrides explicit `tab=` links such as order-notification deep links.

## Authentication And Roles

Admins sign in by email magic link. The browser receives:

- `store_admin_session` cookie
- CSRF token used on mutating admin requests as `x-store-admin-csrf`

Roles:

- `super_admin`: full dashboard access, including Settings.
- Store-scoped limited admin with `accessScopes: ["store"]`: Store operational tabs only. Settings is hidden and the session lands on Orders.

Mutations are protected by admin session, CSRF, and Worker rate limiting.

## Settings

Settings is available to `super_admin` users only. It reads from `/admin/settings` and publishes changes through `/admin/settings/publish`.

Current Settings sections:

- Platform: site title, platform name, company, author, timezone, support/order/update email addresses, add-ons enabled, add-on product count, and read-only app mode.
- Brand & SEO: logo, footer logo, favicon, default social image, X handle, social image alt text, same-as links, and merchant return policy controls for Product/Organization JSON-LD.
- Canonical URLs: production site URL and production Worker URL.
- Checkout: Stripe publishable key.
- Pricing: sales tax rate, default tip percent, and max tip percent.
- Tax: tax provider, origin country, regional origin behavior, New Mexico GRT API base, and ZIP.TAX API base.
- Shipping: origin, fallback fee, default shipping option, USPS settings, cache TTLs, and cooldowns.
- Marketing: default UTM/referral/share values used by the marketing link builder.
- Design: layout width, fonts, color tokens, and button radius.
- Users: admin users, roles, and access scopes. Newly added users can receive notification email.
- Store readiness: launch/runtime checks, audit CSV export, and reconciliation CSV export.
- Plan usage: Cloudflare and Resend quota/usage posture.
- Advanced performance: intent prefetch, live inventory cache controls, the global Workers Cache switch, and per-route Orders, Analytics, inventory, and download-readiness switches.
- Debug: console logging flags.
- Secrets & credentials: read-only status checks for required and optional runtime secrets.
- Runtime diagnostics: current site base, Worker base, CORS allowed origin, the uncached Workers Cache gateway state, each cached admin read policy state, sampled Worker p50/p95/p99 slow-route timing, and a super-admin Workers Cache clear action.
- Admin sessions: active-session review/revocation plus 30-day minimized login history with parsed client labels and keyed network IDs.
- Audit log: date/action/admin/text filters, redacted result rows, and filtered CSV export.

Settings media fields use upload controls and image previews rather than manual path-only editing where supported.

Admin sessions and Audit log load their shared localized UI module only when either section is opened. `assets/js/admin-settings-review.js` receives a narrow set of dashboard request, formatting, status, CSV, and translation helpers; authentication, role/scope state, and API ownership remain in the core dashboard. English and Spanish use the same module and runtime message catalog.

Settings write/upload endpoints:

- `POST /admin/settings/preview`
- `POST /admin/settings/publish`
- `POST /admin/settings/logo-upload`
- `POST /admin/settings/image-upload`
- `POST /admin/settings/audio-upload`
- `POST /admin/settings/video-upload`
- `POST /admin/users`

## Products

Products is the combined catalog and inventory view. It reads from `/admin/store/products`.

List behavior:

- One row per main product, not one row per variant.
- Rows include thumbnail preview, fulfillment type, price, inventory summary, status, and edit action.
- Rows are draggable to change storefront display order.
- Reordering changes the browser view immediately but is not persisted until Save order is clicked.
- Bulk status changes support active, draft, archived, and sold out.
- Product creation uses the same editor as product editing.

Editor behavior:

- Product-level fields include name, price, status, fulfillment, SKU, tax category, variant mode, media, Product page content, SEO description, and preview.
- SKU is read-only. Existing product SKUs are preserved; new product SKUs derive from product name.
- Product page content uses the Store block content editor for visible product-detail copy.
- SEO description writes the front matter `description` value used by product metadata, social cards, and Product JSON-LD. Keep it concise and separate from the longer visible product page content.
- Preview renders a sandboxed static product page preview. It mirrors the public product page layout, including full-image display, product-detail spacing, responsive product copy order, compact event address formatting, and Google Maps address links. Scripts, inline event handlers, and `javascript:` URLs are stripped before the preview is injected.
- Publish/Create is disabled until actual changes are present and disabled again when changes are undone.
- The editor expands inline under the product row being edited.

Fulfillment-aware fields:

- Physical products show Shipping preset and inventory controls.
- Non-physical products hide Shipping preset.
- Digital products hide inventory controls.
- Digital products show a File select when Variant Based is No.
- Digital variant-based products hide the product-level File field and show a File column per variant.

Variants:

- Variant Based controls whether the Variants section is visible.
- Variant label is editable.
- Variant ID and SKU are read-only and live-derived from label.
- Variant fields include File when the product is digital and variant-based.
- Variant inventory fields are hidden when inventory tracking is off.

Product write endpoints:

- `GET /admin/store/products/address-lookup`
- `POST /admin/store/products/preview`
- `POST /admin/store/products/publish`
- `POST /admin/store/products/bulk-publish`
- `POST /admin/store/products/order`
- `GET /admin/store/products/media`
- `POST /admin/store/products/media/optimize`

### Product media browser

The product editor uses the repository-backed media browser for images, video, and audio. It supports accessible type tabs, product/default/add-on scope, filename/reference search, recent/name sorting, local previews, dimensions or duration, byte size, derivative state, placement-budget warnings, and expandable source-reference locations.

Source and derived assets are distinct. Generated derivatives do not appear as standalone selectable media. Broken references and missing/stale derivative warnings come from `_data/media-optimization-manifest.json`; the repository remains authoritative and the dashboard does not create a KV media catalog.

Upload and replace operations are constrained to the matching Store media directory and type. Replacements use the current GitHub content SHA so concurrent changes fail with a conflict instead of overwriting newer work. Repair dispatch reuses the existing optimizer workflow with `changed` or reviewed super-admin `all` scope. Meaningful images require alt text; explicitly decorative images may use empty alt text.

## Coupons

Coupons manages shopper-entered discount codes. It reads from `/admin/store/coupons`.

Current behavior:

- Create, edit, and delete coupon codes.
- Codes are saved uppercase and may use letters, numbers, hyphens, and underscores.
- Discounts can be a percentage off or a fixed USD amount off.
- Coupons can apply to the whole cart or to selected products.
- Draft coupons are saved but unavailable at checkout.
- Save is disabled until the editor has real changes and disabled again when changes are undone.
- Duplicate coupon codes are rejected so creating or renaming a coupon cannot overwrite another coupon.

Checkout behavior:

- Shoppers apply coupon codes in the cart.
- Discounts are applied before tax, shipping, and optional platform tip.
- Product-scoped discounts only reduce matching product line items.
- Fixed-amount discounts are capped at the eligible subtotal.
- Tips are calculated from the post-discount subtotal.
- Order records and confirmation emails include coupon code and discount amount.

Coupon endpoints:

- `GET /admin/store/coupons`
- `POST /admin/store/coupons`
- `POST /admin/store/coupons/delete`

## Downloads

Downloads is a reusable file library for digital products. It reads from `/admin/store/downloads`.

Current behavior:

- Upload a new reusable file.
- Replace an existing library file.
- See whether each file is ready and which products/variants are attached to it.
- Downloads are tied to Products through the product editor, not by creating standalone download products in the Downloads tab.

Digital delivery metadata is stored on product or variant front matter:

- Product-level `download` for non-variant digital products.
- Variant-level `download` for variant-based digital products.

Download files are stored in the configured `STORE_DOWNLOADS` R2 bucket.

Download write endpoints:

- `POST /admin/store/downloads/create`: upload a reusable library file.
- `POST /admin/store/downloads/upload`: replace a configured product/variant download object. This remains for attached catalog targets.
- `POST /admin/store/downloads/delete`: remove an R2 library file that should no longer be reused.

## Orders

Orders is the fulfillment and customer support view. It reads from `/admin/store/orders`.

Current behavior:

- Filter by order status, fulfillment type, ticket check-in state, or search query.
- Export fulfillment CSV.
- Export attendee CSV for ticket/RSVP products.
- Import historical Snipcart CSV exports into production Store order storage.
- View order totals and fulfillment rows.
- Mark ticket/RSVP rows checked in or unchecked. Single-action check-in controls use the same responsive button sizing as other order actions so they fit inside desktop tables and mobile rows.
- Revoke or refresh digital download access from a compact row control.
- Load additional pages when pagination is available.
- Explicitly refresh Orders. When the first-page filter has not changed, the dashboard reuses its in-memory payload and announces that no new orders were found.

Performance/cache behavior:

- Non-search list/filter/page reads use the Worker `CachedAdminStoreReads` inner entrypoint after the gateway authenticates and authorizes the admin. The legacy JavaScript alias is compatibility-only and is not a configured Wrangler entrypoint.
- The browser still receives a private/no-store response with the authenticated `user`; the cacheable inner response omits user identity.
- The v2 order snapshot provides a deterministic non-PII watermark. A matching first-page request returns `unchanged: true` without order/customer rows; payloads and watermarks remain in memory and are not written to browser storage.
- Free-text search requests bypass Workers Cache because query text can contain customer data or order tokens.
- The response payload includes `page.cache.workers` metadata, and the response headers include `X-Store-Workers-Cache` and `X-Store-Workers-Cache-Entry` when the cached entrypoint is used.
- Route misses share `CachedAdminStoreOrderIndex`, so immediate Orders/Analytics/inventory variants do not repeat a cold bounded index rebuild while KV propagation catches up.

Digital order controls show the last ten access revoke/refresh events and can load aggregate failed-attempt/soft-lock diagnostics. Diagnostics never include a signed URL or raw IP address.
- Order mutations purge Orders, Analytics, and order-derived inventory tags through the centralized dependency map. Purge failure does not fail the mutation; short TTLs and the manual refresh control bound stale exposure.
- Analytics, inventory, and download-readiness cache policies are visible in Settings but default off until each passes a real Cloudflare edge benchmark.
- Settings also exposes the global cache and sanitized telemetry switches. Publishing either switch requires the normal reviewed configuration/deployment path; the dashboard never receives Analytics Engine credentials or raw telemetry rows.

Snipcart import:

- Runs only against the production Worker.
- Groups Snipcart CSV line items by invoice/token into Store order records.
- Writes deterministic `store-order-snipcart-*` order tokens so repeat imports skip existing records.
- Does not send customer emails during import.

Order support endpoints:

- `GET /admin/store/orders`
- `GET /admin/store/orders.csv`
- `GET /admin/store/attendees.csv`
- `POST /admin/store/orders/import-snipcart`
- `POST /admin/store/orders/check-in`
- `POST /admin/store/orders/download-access`

## Analytics

Analytics reads order data from `/admin/store/analytics` and refreshes on tab load.

Current dashboard cards and tables cover:

- Orders
- Fulfillment rows
- Revenue
- Average order value
- Physical, digital, ticket, and RSVP quantities
- Check-in totals and check-in rate
- Fulfillment breakdown
- Product breakdown
- Status/payment breakdowns
- Referral and UTM breakdowns

Analytics CSV export is generated client-side from the currently loaded table data.

There is no separate Settings -> Analytics section. Provider usage and runtime telemetry live under Settings -> Plan usage and Settings -> Runtime diagnostics.

Analytics changes should stay operational and explainable. Do not add behavioral tracking, customer profiling, ranking, or inferred traits without an ethical risk review, a data-minimization reason, access controls, retention notes, and tests or release evidence for private/no-store handling where applicable.

## Marketing

Marketing contains the referral/UTM link builder and abandoned checkout controls.

Link builder:

- Destination path/URL
- Referrer name
- Generated referral code
- UTM source, medium, campaign, and content
- Generated URL
- QR preview
- PNG/SVG QR downloads
- Copy URL
- Save referral
- Edit/delete saved referrals

Abandoned checkout:

- Reads reminder queue health.
- Shows pending/sent/failed/suppressed state.
- Allows suppressing and unsuppressing reminder emails.

Marketing and reminder changes must preserve consent, suppression, clear purpose, and bounded frequency. Avoid urgency copy or engagement loops that pressure customers beyond the transactional or opted-in reason for contact.

Marketing endpoints:

- `GET /admin/store/marketing/referrals`
- `POST /admin/store/marketing/referrals`
- `DELETE /admin/store/marketing/referrals`
- `GET /admin/store/marketing/draft`
- `POST /admin/store/marketing/draft`
- `DELETE /admin/store/marketing/draft`
- `GET /admin/store/marketing/abandoned-checkout/health`
- `POST /admin/store/marketing/abandoned-checkout/suppression`
- `DELETE /admin/store/marketing/abandoned-checkout/suppression`

The shared draft endpoints remain available for the link-builder draft state, but they are not a separate top-level workflow.

## Write Paths

Production admin publishes write through GitHub and trigger a site rebuild where needed.

Local development admin publishes can write directly to the local checkout through the local repo sidecar started by `./scripts/dev.sh`.

Local repo write mode:

- Enabled when `APP_MODE=test` and `ADMIN_LOCAL_REPO_WRITES_ENABLED` is truthy.
- Worker calls `ADMIN_LOCAL_REPO_SERVICE`, defaulting to `http://127.0.0.1:8799`.
- The sidecar only listens on `127.0.0.1`.
- The sidecar requires bearer auth using `ADMIN_LOCAL_REPO_TOKEN` or `ADMIN_SECRET`.
- Supported sidecar operations are `/read`, `/write`, `/write-base64`, and `/health`.

Primary write targets:

- `_config.yml`: Settings publish.
- `_products/*.md`: product create/edit/order and digital download associations.
- `assets/images/products/`: product image uploads.
- `assets/images/defaults/`, `assets/audio/defaults/`, and `assets/videos/defaults/`: settings/default media uploads.
- `STORE_DOWNLOADS` R2 bucket: digital download files.
- `STORE_STATE` KV: admin audit events, coupons, inventory overrides, marketing referrals, abandoned checkout state, order/download/check-in state.

## Accessibility And Responsiveness

The dashboard uses native tab roles, keyboard tab navigation, mobile tab selects, status regions, and labeled responsive table rows.

Responsive behavior currently covered by E2E tests:

- Admin tab layout on tablet.
- Products table/editor on mobile.
- Product preview event address formatting, Google Maps links, and product-detail spacing.
- Coupons table/editor on mobile.
- Orders rows on mobile and single-action check-in buttons in desktop tables.
- Downloads rows on mobile.
- Spanish admin route tab compactness.

## Main Files

- Admin page: `_layouts/admin.html`
- Admin behavior: `assets/js/admin-dashboard.js`
- Lazy session/audit behavior: `assets/js/admin-settings-review.js`
- Admin styles: `assets/partials/_admin.scss`
- Worker admin API: `worker/src/index.js`
- Admin auth helpers: `worker/src/admin-auth.js`
- Local repo sidecar: `worker/src/local-repo-service.mjs`
- E2E coverage: `tests/e2e/admin-dashboard.spec.ts`
- Auth/security coverage: `tests/security/auth-protection.test.ts`

## Verification

Run the focused admin dashboard suite:

```bash
npx playwright test tests/e2e/admin-dashboard.spec.ts --project=chromium --workers=1
```

Run the security checks that cover admin protection:

```bash
npm run test:security
```

Run a local build after dashboard markup or style changes:

```bash
bundle exec jekyll build --config _config.yml,_config.local.yml
```

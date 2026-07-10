# Workflows

Store uses a static storefront with Worker-owned checkout, inventory, fulfillment, and admin mutations. Visitors do not need accounts. Admins use magic-link authentication.

## Core Principles

- Static product browsing stays cheap and cacheable.
- The Worker owns every price, tax, shipping, inventory, and fulfillment decision that affects money or access.
- Stripe handles payment collection through PaymentIntents.
- Free RSVP-style orders do not require Stripe.
- Coupons are stored in KV and applied server-side before tax, shipping, and optional tip calculations.
- Product catalog changes are GitHub-backed and reviewable in `_products/*.md`.
- Digital files live in `STORE_DOWNLOADS` R2 and are served through signed Worker routes.
- Confirmed digital download entitlements do not expire unless an admin explicitly revokes access; signed fulfillment links remain short-lived.
- Store admin mutations use `store_admin_session` plus `x-store-admin-csrf`.
- Public Spanish shells share the same Store workflows as English routes; creator/customer-authored content is not auto-translated.
- Customer/admin data collection, marketing/reminder sends, analytics, automation, public token/link changes, and external provider additions require an [ethical risk review](ETHICAL_RISK.md) before merge.

## Ethical Risk Review Workflow

Use [ETHICAL_RISK.md](ETHICAL_RISK.md) when a workflow change could surprise users, expose sensitive data, alter access, automate a decision, increase interruption, or create a new abuse path.

Record the outcome in the PR or release evidence:

- touched surfaces
- applicable risk lenses
- mitigations and tests
- residual risk owner/date, or `N/A` with a reason

## Catalog Workflow

1. Add or edit a product in `_products/*.md`, or use **Admin -> Products**.
2. Each product has explicit Store fields:
   - `identifier`
   - `sku`
   - `name`
   - `price`
   - `fulfillment_type`
   - `status`
   - `shipping_preset`
   - `tax_category`
   - `inventory_tracking`
   - `inventory`
   - optional `variants`
   - optional `download.file_key`
   - optional event metadata for ticket/RSVP products
3. `scripts/generate-catalog-snapshot.rb` generates the Worker catalog snapshot.
4. The storefront renders product cards and detail pages from the Jekyll collection.
5. The Worker validates cart payloads against the generated catalog snapshot.

## Cart Workflow

1. Visitor picks a variant and quantity.
2. `assets/js/store-product-options.js` updates displayed price, button total, and cart payload fields.
3. The Store cart runtime stores browser cart state under Store-owned keys.
4. The cart drawer shows canonical line items and checkout controls.
5. Shopper-entered coupon codes are carried with the cart intent but validated only by the Worker.
6. Opted-in checkout reminder consent is stored with the draft when checkout starts.
7. Heavy cart runtime files lazy-load only after cart state or user intent.

## Coupon Workflow

1. Admin creates or edits a coupon in **Coupons**.
2. Worker stores normalized coupon records at `store-coupons:v1` in `STORE_STATE`.
3. The browser submits a coupon code with cart validation and checkout intent payloads.
4. Worker rejects invalid, inactive, expired, duplicate, or ineligible coupons.
5. Valid discounts reduce eligible line-item subtotal before tax, shipping, and platform tip.
6. Confirmed order records and emails include the applied coupon snapshot and discount amount.

## Checkout Workflow

1. Browser posts cart data to:

   ```text
   POST /api/cart/validate
   ```

2. The Worker returns canonical line items, totals, tax, shipping, fulfillment metadata, and inventory status.
3. Browser starts checkout through:

   ```text
   POST /api/checkout/intent
   ```

4. The Worker creates an order draft at `orders:<orderToken>`.
5. Positive-count SKUs are reserved by the SKU inventory Durable Object.
6. If the shopper opted into checkout reminders, the Worker queues a delayed reminder record.
7. Paid orders receive a Stripe PaymentIntent and mount on-site payment UI.
8. Free RSVP orders confirm immediately.
9. Browser redirects to:

   ```text
   /order-success/?orderToken=<token>
   ```

10. `/order-success/` polls the token-scoped order summary until fulfillment is ready or payment fails.

## Payment Settlement

Stripe webhooks are the source of truth for paid order confirmation.

See [PAYMENT_PROCESSOR.md](PAYMENT_PROCESSOR.md) for setup, Stripe webhook, PaymentIntent, and reconciliation details.

Webhook settlement validates:

- order token
- PaymentIntent id
- amount
- currency
- stored order hash
- payment status

On success, the Worker:

- marks the order confirmed
- commits inventory reservations
- stores Stripe financial snapshots when available
- sends the Store order confirmation email
- sends super-admin order notifications
- indexes confirmed order email hashes for customer lookup
- queues event reminder records when applicable
- clears pending abandoned-checkout reminders for the completed order
- exposes fulfillment actions through the token-scoped order summary

On failure, the Worker:

- marks the order `payment_failed`
- releases inventory reservations
- keeps the order summary private and no-store

## Fulfillment Workflows

### Physical Products

- Store checkout captures shipping details.
- Worker calculates shipping/tax from configured providers and fallbacks.
- Admin Orders shows physical fulfillment rows.
- CSV export supports fulfillment handoff.

### Digital Downloads

- Product front matter sets `download.file_key`.
- Admin Downloads verifies whether the object exists in `STORE_DOWNLOADS`.
- Admin Downloads can upload or replace the R2 object.
- Confirmed order summaries show signed download actions.
- Signed links expire, but the buyer's confirmed entitlement remains active unless an admin revokes it from Orders.
- Download responses are token-scoped and no-store.

### Tickets And RSVPs

- Product front matter carries event metadata.
- Confirmed order summaries expose QR/check-in actions.
- Admin Orders shows attendance totals, grouped event rows, attendee search, and attendee CSV export.
- Ticket/RSVP check-in writes through:

  ```text
  POST /admin/store/orders/check-in
  ```

### Order Lookup

- `/orders/` lets customers request a secure order lookup email.
- `POST /api/orders/lookup` always returns generic copy.
- Matching confirmed orders are indexed by email hash under `store-order-email:*`.
- Lookup emails contain short-lived `store-order-lookup:*` tokens.
- `GET /api/orders/lookup?token=...` consumes the token before returning order links.
- `/es/orders/` uses the same API and tokens with localized page/runtime copy.

### Abandoned Checkout Reminders

- Checkout reminder emails are opt-in only.
- Pending records use `abandoned-cart:*` keys.
- Sent markers, suppression records, queue state, and health summaries use `abandoned-cart-sent:*`, `abandoned-cart-suppressed:*`, `abandoned-cart-queue:v1`, and `abandoned-cart-health:v1`.
- Public signed links support resume and unsubscribe through `/abandoned-cart/resume` and `/abandoned-cart/unsubscribe`.
- Admin Marketing shows queue health and can suppress or unsuppress reminder emails.

### Event Reminders

- Confirmed ticket/RSVP order items with valid event start times queue reminders.
- Current offsets are 1 week, 1 day, 6 hours, and 1 hour before the event.
- Queue and sent records use `store-event-reminder:*`, `store-event-reminder-sent:*`, and `store-event-reminder-queue:v1`.
- The Worker cron processes due reminders and retries failures with bounded backoff.

## Inventory Workflow

Inventory starts with the configured product value from `_products/*.md`.

Imported product counts should be treated as placeholders until live baselines are entered.

Admin Inventory actions:

- **Set**: replace the effective baseline
- **Add**: restock by quantity
- **Reset**: remove override and return to catalog default

Effective availability combines:

- configured catalog inventory
- admin baseline override
- confirmed sold-count projection
- active checkout reservations

The checkout path consults the reservation-aware coordinator before committing scarce SKU quantities.

## Admin Publishing Workflow

### Product Publish

1. Admin edits a product in **Products**.
2. Browser submits:

   ```text
   POST /admin/store/products/publish
   ```

3. Worker validates fields and variants.
4. Worker patches the matching `_products/*.md` file through GitHub.
5. Worker records an audit event and triggers the normal deploy path.

### Product Image Upload

1. Admin uploads or pastes an image path.
2. Worker commits image files under:

   ```text
   assets/images/products/
   ```

3. Worker dispatches repository media optimization.
4. Admin publishes the product to persist the selected image path.

### Download Library

1. Admin uploads reusable files in **Downloads**.
2. Worker writes files to `STORE_DOWNLOADS` through `POST /admin/store/downloads/create`.
3. Admin attaches a file key to a digital product or digital variant from the product editor.
4. Attached objects can be replaced through `POST /admin/store/downloads/upload`.
5. Unattached or retired library objects can be deleted through `POST /admin/store/downloads/delete`.

### Settings Publish

Settings publish writes GitHub-backed config changes and triggers deploy. Runtime-only user edits save directly to KV and do not deploy the site.

## Admin Auth Workflow

1. Admin enters email at `/admin/` or `/es/admin/`.
2. Worker rate-limits and optionally verifies Turnstile.
3. Worker sends a Resend magic link.
4. Browser exchanges token for `store_admin_session` and CSRF token.
5. Mutating admin requests send `x-store-admin-csrf`.
6. Limited admins are authorized by `accessScopes`, with `store` as the Store dashboard scope.

Super-admin order notification emails use this same exchange but are source-tagged as order notifications. Those links open `tab=store-orders`, expire after 5 minutes, are consumed on first successful exchange, and create a 30-minute admin session. They remain bearer links until consumed or expired, so forwarded unused emails can still delegate access.

## Worker Storage Map

| Key / Binding | Purpose |
|---------------|---------|
| `orders:<orderToken>` | Store order draft and final order state |
| `store-inventory-overrides:v1` | Admin SKU baseline overrides |
| `store-inventory:v1:*` | Derived inventory projections synced by the Durable Object |
| `store-coupons:v1` | Admin-managed coupon definitions |
| `store-order-email:*` | Confirmed order lookup index by customer email hash |
| `store-order-lookup:*` | Short-lived customer order lookup tokens |
| `abandoned-cart:*` | Opt-in checkout reminder queue records |
| `store-event-reminder:*` | Event reminder queue records |
| `observability:*` | Bounded webhook/performance summaries and recent events |
| Store SKU Durable Object | Reservation-aware SKU inventory coordination |
| `STORE_DOWNLOADS` | Digital download R2 objects |
| `admin-users:v1` | Runtime admin users |
| `admin-store-marketing-referrals:v1` | Saved referral/UTM links |
| `store_admin_session` | Admin session cookie |
| GitHub contents API | `_products`, `_config.yml`, and product media publishing |

Store KV state should stay inside the documented order, inventory, coupon, admin, audit, lookup, reminder, marketing, observability, rate-limit, and email keys.

Super admins can export recent admin mutation audit events from **Settings -> Store readiness**. The CSV is backed by bounded `admin-audit:` KV listing and is intended for production operational review, not permanent retention.

Store admins can export an order reconciliation CSV from **Settings -> Store readiness**. It is one row per order and flags amount, currency, and payment/order status mismatches for production review.

## Public Route Workflow

Default Store routes:

- `/`
- `/es/`
- `/products/:slug/`
- `/es/products/:slug/`
- `/terms/`
- `/es/terms/`
- `/orders/`
- `/es/orders/`
- `/order-success/`
- `/es/order-success/`
- `/api/products.json`
- `/api/add-ons.json`

Public document prefetch is intentionally narrow:

- allowed: home, Terms, and product detail pages, including localized public equivalents
- blocked: admin, checkout, cart, order-success, API, Worker, tokenized, external, and sensitive-query links

## Local Development Workflow

Start local services:

```bash
npm run podman:doctor
./scripts/dev.sh --podman
```

Current local URLs:

- Storefront: `http://127.0.0.1:4002`
- Worker: `http://127.0.0.1:8989`

Useful checks:

```bash
npm run sync:worker-config
npm run build
npm run test:i18n
npm run test:seo
npx vitest run tests/unit/page-prefetch.test.ts tests/unit/cart-runtime-loader.test.ts tests/unit/seo-layouts.test.ts
PLAYWRIGHT_EXTERNAL_SERVER=1 CI=1 npx playwright test --project=chromium --workers=1
```

## Deployment Workflow

Before a release or high-risk data/configuration change, start with metadata-only planning:

```bash
npm run backup:inventory:audit
npm run backup:plan
npm run backup:readiness
npm run restore:rehearse
```

Use `npm run backup:snapshot` for an operator-owned snapshot outside the repository. Remote metadata is opt-in; KV values, R2 objects, and admin exports additionally require exact acknowledgement plus age/GPG encryption and decryptability verification. Protected snapshots require complete R2 enumeration/downloads. `npm run backup:retention -- --root <path>` plans retention without deleting by default. `npm run restore:plan -- --snapshot <path>` verifies checksums and emits a no-write plan by default; preview R2 execution additionally requires `--preview-r2-bucket` with a bucket distinct from the captured source. Preview drills must run readback verification and exact-snapshot cleanup. Follow [BACKUP_RESTORE.md](BACKUP_RESTORE.md) for the additional production gates.

1. Merge catalog/settings/media changes.
2. Run release smoke and backup planning before tagging.
3. Dispatch the **Deploy Production** workflow manually when the operator is ready to deploy.
4. The workflow generates the catalog snapshot, builds Jekyll, minifies generated `_site` assets, deploys the Worker to Cloudflare, purges known Workers Cache entries when `WORKERS_CACHE_PURGE_SECRET` is configured, deploys the static site to GitHub Pages, optionally purges the Cloudflare zone cache, and verifies the path-scoped admin `no-transform`/`no-store` response policy without privileged credentials.
5. Verify Stripe webhooks, Resend senders, USPS/tax config, `STORE_DOWNLOADS`, admin magic links, cron heartbeat, and readiness checks.

Before production deploys that touch Worker bindings or runtime config:

- confirm `worker/wrangler.toml` production bindings point at production `STORE_STATE`, `RATELIMIT`, `STORE_DOWNLOADS`, and `STORE_INVENTORY_COORDINATOR` resources
- set production Worker secrets with `wrangler secret put`
- set `WORKERS_CACHE_PURGE_SECRET` to the same generated value in Cloudflare Worker secrets and GitHub repository secrets when deploy-time Workers Cache purge is enabled
- set `WORKERS_CACHE_EVIDENCE_SECRET` to the same dedicated value in Cloudflare Worker secrets and GitHub `production-observability` secrets; do not reuse the purge or admin secret
- set a read-only `CLOUDFLARE_ANALYTICS_API_TOKEN` for cache evidence and Worker-wide recovery traffic preflight
- keep Cloudflare deploy tokens in GitHub or local operator environments only, not Worker runtime config
- confirm DNS records for `shop.dustwave.xyz` and `checkout.dustwave.xyz`
- confirm the cron trigger remains enabled for background maintenance
- use `npm run deploy:worker` only for an explicit Worker-only manual deploy outside the production workflow

Deploy, nightly cache evidence, and protected recovery use the shared `production-operations` concurrency group. **Workers Cache Evidence** runs at `03:17 America/Denver`, reads Analytics Engine, and performs only a bounded metrics probe below its cache-read threshold. **Recovery Readiness** runs at `03:43 America/Denver` each Sunday with synthetic data and read-only provider metadata. **Quarterly Recovery Operations** runs a Worker-wide Cloudflare invocation/error preflight at `04:17 America/Denver` on the first day of each quarter.

The quarterly captured-data job is disabled unless `RECOVERY_DRILL_ENABLED=true` and requires approval through `production-recovery`. Before enabling it, configure a dedicated age recipient/private identity, a fresh one-time `STORE_BACKUP_ADMIN_LOGIN_TOKEN`, a restricted `STRIPE_RECOVERY_READ_KEY` for live read-only comparison, an explicit preview R2 bucket, and `STORE_RECOVERY_ARCHIVE_S3_URI` plus archive-account credentials. The job verifies the off-account upload, can write only preview KV/R2 through `scripts/protected-recovery-drill.sh`, reads every restored value/object back, and removes snapshot-owned preview data after success or partial failure. Detailed restore output remains temporary, the script has no production restore target or acknowledgement, and the encrypted GitHub artifact remains secondary evidence rather than long-term retention.

Production non-secret config should match the intended public domains and providers unless an operator intentionally changes them:

- `SITE_BASE=https://shop.dustwave.xyz`
- `WORKER_BASE=https://checkout.dustwave.xyz`
- `CORS_ALLOWED_ORIGIN=https://shop.dustwave.xyz`
- `TAX_PROVIDER=nm_grt`
- `SHIPPING_ORIGIN_ZIP=87120`
- `SHIPPING_ORIGIN_COUNTRY=US`
- `USPS_ENABLED=true`

## Production Operations

Keep these checks current in production and rerun them after checkout, fulfillment, catalog, admin, or settings changes:

- upload real digital objects to `STORE_DOWNLOADS`
- enter true inventory baselines
- test paid physical checkout
- test paid ticket checkout and check-in
- test free RSVP checkout and check-in
- test digital download fulfillment
- test admin product publish
- test admin download replacement
- test admin Store CSV export
- review the machine-translated Spanish Terms copy with legal/native-speaker review before treating it as final

External provider checks:

- Stripe production publishable/secret keys are configured and the production webhook endpoint is `https://checkout.dustwave.xyz/webhooks/stripe`.
- Stripe webhook events include at least `payment_intent.succeeded` and `payment_intent.payment_failed`.
- Resend sender domains and sender identities are verified for `ORDERS_EMAIL_FROM` and `UPDATES_EMAIL_FROM`.
- USPS live credentials are configured and the flat-rate fallback remains available if USPS is unavailable.
- New Mexico GRT behavior is verified for the production origin and destination cases.
- Active digital products have `download.file_key` values that resolve to real R2 objects or Worker-only fallback URLs.

When a product has a verified physical inventory count, add `inventory_baseline_source` or `inventory_verified_at` to its product front matter. This lets readiness checks distinguish a true zero-stock baseline from an untouched imported `0`. Use `inventory_tracking: false` for unlimited or made-to-order products.

## Rollback Workflow

If production smoke fails:

1. Stop new public traffic when possible by removing promotional links or DNS/cache exposure.
2. Revert the storefront deploy to the last known good GitHub Pages build.
3. Revert the Worker to the previous deployed version.
4. If checkout created bad order state, record the issue in KV notes or audit logs before deleting anything.
5. If inventory reservations are stuck, inspect the order token first, then release through the Worker-controlled path.
6. Do not rotate customer-facing order/download tokens unless a token leak is confirmed.

## Production Review

After material production changes and during the first day after release work:

- review Stripe payments against Store orders with the admin reconciliation CSV
- review Resend delivery and bounce events
- review **Settings -> Store readiness** for webhook activity, R2 readiness, inventory baselines, cron heartbeat, and catalog snapshot posture
- review abandoned-checkout and event reminder health after scheduled cron windows
- export Store orders CSV for fulfillment reconciliation
- export audit CSV for admin mutation review
- back up configured resource IDs, coupon/referral changes, manual inventory adjustments, and release notes using [BACKUP_RESTORE.md](BACKUP_RESTORE.md)

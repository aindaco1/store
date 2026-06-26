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
- Store admin mutations use `store_admin_session` plus `x-store-admin-csrf`.

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

Super admins can export recent admin mutation audit events from **Settings -> Store readiness**. The CSV is backed by bounded `admin-audit:` KV listing and is intended for launch/post-launch operational review, not permanent retention.

Store admins can export an order reconciliation CSV from **Settings -> Store readiness**. It is one row per order and flags amount, currency, and payment/order status mismatches for launch and post-launch review.

## Public Route Workflow

Default Store routes:

- `/`
- `/products/:slug/`
- `/terms/`
- `/order-success/`
- `/api/products.json`
- `/api/add-ons.json`

Public document prefetch is intentionally narrow:

- allowed: home, Terms, product detail pages
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
bundle exec jekyll build --quiet
npm run sync:worker-config
npx vitest run tests/unit/page-prefetch.test.ts tests/unit/cart-runtime-loader.test.ts tests/unit/seo-layouts.test.ts
PLAYWRIGHT_EXTERNAL_SERVER=1 CI=1 npx playwright test --project=chromium --workers=1
```

## Deployment Workflow

Use [PRODUCTION_LAUNCH.md](PRODUCTION_LAUNCH.md) for the full operator checklist.

1. Merge catalog/settings/media changes.
2. Generate catalog snapshot.
3. Build Jekyll.
4. Build Jekyll and minify generated `_site` assets.
5. Deploy Worker to Cloudflare on pushes to `main`.
6. Deploy static site to GitHub Pages.
7. Optionally purge Cloudflare cache when enabled.
8. Verify Stripe webhooks, Resend senders, USPS/tax config, `STORE_DOWNLOADS`, admin magic links, cron heartbeat, and readiness checks.

## Launch Readiness

Before launch:

- upload real digital objects to `STORE_DOWNLOADS`
- enter true inventory baselines
- test paid physical checkout
- test paid ticket checkout and check-in
- test free RSVP checkout and check-in
- test digital download fulfillment
- test admin product publish
- test admin download replacement
- test admin Store CSV export
- replace draft Terms copy with production legal/policy copy

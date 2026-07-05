# Payment Processor

Store uses Stripe as its payment processor, with the Cloudflare Worker as the canonical checkout, order, webhook, inventory, and fulfillment boundary. The public storefront can collect cart intent, contact details, shipping/tax preview inputs, coupon codes, and reminder consent, but the Worker rebuilds the money shape, creates Store order records, creates Stripe PaymentIntents for paid orders, and settles paid orders only from signed Stripe webhooks.

This document describes the current Store implementation from setup through operations. It folds payment-engineering operating guidance into Store's order-based commerce model.

## Current Model

Store is not a wallet, deferred payment system, marketplace ledger, or bank-like balance system. It is an immediate commerce checkout for physical products, digital downloads, tickets, and free RSVPs:

- The browser submits cart intent to the Worker.
- The Worker validates products, variants, SKUs, prices, coupons, inventory, shipping metadata, tax categories, and fulfillment metadata against the generated Store catalog.
- Free RSVP/free orders confirm immediately without Stripe.
- Paid orders create a Stripe PaymentIntent and mount Stripe's Payment Element through the Store checkout sidecar.
- Stripe owns card data and PCI-sensitive payment fields.
- Paid Store orders become confirmed only after a signed `payment_intent.succeeded` webhook validates against the stored order draft.
- Failed/canceled paid orders release inventory reservations and remain private/no-store.
- Store owns order records, order emails, admin notifications, fulfillment actions, inventory state, reconciliation exports, and operational diagnostics.

Stripe receipt emails are intentionally suppressed for Store PaymentIntents. Store sends customer order confirmations and super-admin order notifications through the Resend email path so totals, localization, and fulfillment links stay in one controlled system.

## Engineering Principles

Payment code should optimize for boring correctness over cleverness.

### No Invented Money

Runtime money values that enter order storage, emails, admin views, CSV exports, and Stripe requests are represented as integer cents. Product files and config may use dollars or rates for operator usability, but Worker records and processor calls should use cents at the boundary.

Rules for new payment code:

- Do not store order amounts as floats.
- Pair every amount with its meaning: `subtotalCents`, `discountCents`, `taxCents`, `shippingCents`, `tipAmountCents`, `totalCents`, `amountCents`.
- Keep currency assumptions explicit. The current deployment is USD-oriented; do not silently introduce multi-currency behavior.
- Round only at controlled boundaries, then store the rounded cent value.
- Use the stored order totals for emails, analytics, exports, fulfillment, and reconciliation. Do not recalculate settled orders from today's catalog or tax settings.

### No Lost State

The Worker must be able to explain what happened to an order even when Stripe webhooks are delayed, duplicated, or retried.

Current state surfaces:

- `orders:<orderToken>` stores the order draft, payment state, settlement state, fulfillment state, and selected Stripe IDs.
- `admin-store-orders:index:v1` indexes Store orders for admin reads where available; order records remain the source of truth.
- `store-order-email:*` indexes confirmed orders by customer email hash for order lookup.
- `store-order-email-sent:*` and `store-order-admin-email-sent:*` track transactional email delivery attempts.
- `store-inventory-overrides:v1` and `store-inventory:v1:*` store inventory baselines and derived projections.
- `store-coupons:v1` stores coupon definitions used during checkout validation.
- `stripe-event:<event.id>` prevents duplicate webhook processing for a bounded retention window.
- `abandoned-cart:*`, `abandoned-cart-sent:*`, `abandoned-cart-suppressed:*`, and queue/health records track opted-in checkout reminders.
- `store-event-reminder:*`, `store-event-reminder-sent:*`, and `store-event-reminder-queue:v1` track event reminder jobs.
- `observability:*` stores bounded webhook/performance summaries for operator review.

Store does not maintain a double-entry ledger. If Store later adds refunds, payouts, stored balances, multi-currency money movement, or marketplace-style splits, add a true append-only ledger with derived balances instead of stretching order or analytics projections into accounting truth.

### No Blind Trust

The browser, Stripe webhook delivery order, and external API success are all treated as untrusted inputs.

Current controls:

- `/api/cart/validate` and `/api/checkout/intent` rebuild totals from Store catalog data, coupons, configured tip bounds, shipping rules, tax provider output, and inventory metadata.
- Checkout intent continuation uses an order hash stored with the order draft and mirrored into Stripe PaymentIntent metadata.
- Positive-count SKUs reserve through `STORE_INVENTORY_COORDINATOR` before paid checkout begins.
- Stripe webhook signatures are verified over the raw request body.
- Paid settlement validates order token, order hash, Store order version, PaymentIntent ID, amount, currency, and payment status before confirming an order.
- Stripe PaymentIntent creation uses a deterministic idempotency key: `store-order:<orderToken>`.
- Sensitive checkout, order, download, lookup, reminder, and admin responses are private/no-store.
- Checkout, shipping, tax, and admin POST routes keep origin, rate-limit, session, role/scope, CSRF, and body-size boundaries appropriate to each route.

## Setup

Use the repo-root setup helper whenever possible:

```bash
npm run setup:deploy -- --mode=local
npm run setup:deploy -- --mode=production --dry-run
```

The helper syncs public config into the Worker, creates or reuses Cloudflare resources, checks provider CLIs where possible, and writes secrets only after confirmation.

### Required Worker Bindings

Production and dev Worker environments need:

- `STORE_STATE` KV namespace for orders, admin/session state, coupons, lookup indexes, reminders, observability, and queue state.
- `RATELIMIT` KV namespace for request throttling. Protected paths fail closed when this binding is absent.
- `STORE_INVENTORY_COORDINATOR` Durable Object binding for SKU reservations, commits, releases, and projections.
- `STORE_DOWNLOADS` R2 bucket for signed digital download files and reusable download library objects.

### Public Config

These values are non-secret and live in `_config.yml`, then mirror into `worker/wrangler.toml` through `npm run sync:worker-config`:

- `platform.site_url` -> `SITE_BASE`
- `platform.worker_url` -> `WORKER_BASE`
- `platform.timezone` -> `PLATFORM_TIMEZONE`
- `checkout.stripe_publishable_key` -> `STRIPE_PUBLISHABLE_KEY`
- `pricing.sales_tax_rate` -> `SALES_TAX_RATE`
- `pricing.default_tip_percent` -> `DEFAULT_PLATFORM_TIP_PERCENT`
- `pricing.max_tip_percent` -> `MAX_PLATFORM_TIP_PERCENT`
- `tax.*` -> `TAX_*`
- `shipping.*` -> `SHIPPING_*` and `USPS_*`

Stripe publishable keys are browser-visible and may be stored in config or Worker vars. Stripe secret keys and webhook signing secrets must not be stored in `_config.yml`, product markdown, or admin-published settings.

### Required Secrets

Local development secrets live in ignored `worker/.dev.vars`. Production secrets belong in Cloudflare Worker secrets:

```bash
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put CHECKOUT_INTENT_SECRET
wrangler secret put MAGIC_LINK_SECRET
wrangler secret put ADMIN_SECRET
wrangler secret put ADMIN_SESSION_SECRET
wrangler secret put RESEND_API_KEY
```

Mode-specific Stripe secrets are supported when `APP_MODE` selects test or live behavior:

```bash
wrangler secret put STRIPE_SECRET_KEY_LIVE
wrangler secret put STRIPE_SECRET_KEY_TEST
wrangler secret put STRIPE_WEBHOOK_SECRET_LIVE
wrangler secret put STRIPE_WEBHOOK_SECRET_TEST
```

Recommended scoped secrets:

```bash
wrangler secret put STORE_DOWNLOAD_SECRET
wrangler secret put STORE_ORDER_LOOKUP_SECRET
wrangler secret put ABANDONED_CART_TOKEN_SECRET
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put ADMIN_TURNSTILE_SECRET_KEY
wrangler secret put STORE_ORDER_TURNSTILE_SECRET_KEY
```

Optional provider secrets:

```bash
wrangler secret put USPS_CLIENT_SECRET
wrangler secret put ZIP_TAX_API_KEY
```

GitHub repository secrets are for deploy/operator workflows only. They do not automatically become Worker runtime secrets.

### Stripe Webhooks

Create Stripe webhook endpoints for test and live mode.

Production endpoint:

```text
https://checkout.dustwave.xyz/webhooks/stripe
```

Required events:

- `payment_intent.succeeded`
- `payment_intent.payment_failed`

Copy each endpoint signing secret into the matching Worker secret:

- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_WEBHOOK_SECRET_LIVE`
- `STRIPE_WEBHOOK_SECRET_TEST`

For local work, prefer:

```bash
./scripts/dev.sh
```

or:

```bash
./scripts/dev.sh --podman
```

When the Stripe CLI is available and authenticated, the dev launcher forwards events to `127.0.0.1:8989/webhooks/stripe` and writes the listener's `whsec_...` value into `worker/.dev.vars`.

## Checkout Integration

### 1. Browser Cart

The static site owns the cart UI and stores cart structure. It may collect customer contact, shipping address, billing tax address, coupon code, tip selection, checkout reminder consent, and cart selections, but it does not decide final totals.

The browser validates with:

```text
POST /api/cart/validate
```

Then starts checkout with:

```text
POST /api/checkout/intent
```

Important checkout fields include:

- `items`
- `customer` or `email`
- `couponCode`
- `tipPercent`
- `shippingAddress`
- `billingAddress`
- `shippingOption`
- `preferredLang`
- `abandonedCartConsent`
- `turnstileToken` when required

### 2. Worker Canonicalization

The Worker rebuilds the order from trusted inputs:

- product identifiers, variants, SKUs, statuses, and unit prices
- fulfillment types: physical, digital, ticket, and RSVP
- coupon eligibility, status, date windows, and discount amount
- configured tip bounds
- shipping presets, USPS quotes, and fallback shipping policy
- tax provider result
- inventory metadata and reservation availability
- Turnstile requirements for higher-risk order shapes

The resulting order draft stores cent values and an `orderHash`. The draft is persisted under `orders:<orderToken>`. For scarce inventory, the Worker reserves positive-count SKUs through `STORE_INVENTORY_COORDINATOR` before confirming a free order or creating a paid PaymentIntent.

### 3. Free Order Confirmation

When `orderDraft.totals.requiresPayment` is false, the Worker:

1. Reserves applicable inventory.
2. Commits the reservation immediately.
3. Stores the confirmed order with `payment.status = "not_required"`.
4. Queues customer order email, super-admin order notifications, lookup indexing, and event reminders when applicable.
5. Returns `nextAction: "order_confirmed"` to the browser.

Free RSVP/free orders do not call Stripe.

### 4. Paid PaymentIntent Creation

When payment is required, the Worker:

1. Stores a pending order draft at `orders:<orderToken>`.
2. Reserves applicable SKU inventory.
3. Creates a Stripe PaymentIntent with automatic payment methods enabled.
4. Uses `store-order:<orderToken>` as the Stripe idempotency key.
5. Stores the PaymentIntent ID, amount, currency, and status on the order record.
6. Returns `checkoutUiMode: "payment_intent"`, `clientSecret`, `publishableKey`, `orderToken`, and `orderHash`.

PaymentIntent metadata includes Store integrity context such as:

- `orderToken`
- `orderHash`
- `checkoutProvider=first_party`
- `storeOrderVersion`
- `email`
- `itemCount`
- `couponCode`
- `discountCents`
- `tipPercent`
- `tipAmountCents`
- `requiresShipping`
- `requiresTurnstile`

The browser mounts Stripe's Payment Element through `assets/js/stripe-checkout-sidecar.js`. Stripe confirms card details in its controlled UI; Store never sees card numbers or CVV.

### 5. Webhook Settlement

Stripe webhooks are the source of truth for paid order settlement.

For `payment_intent.succeeded`, the Worker:

1. Reads the raw request body.
2. Verifies the Stripe signature with the mode-appropriate webhook secret.
3. Checks `stripe-event:<event.id>` for duplicate processing.
4. Confirms the PaymentIntent metadata identifies a first-party Store order.
5. Loads `orders:<orderToken>`.
6. Validates Store order version, checkout provider, order token, order hash, PaymentIntent ID, amount, currency, and status.
7. Commits inventory reservations unless the order was already confirmed.
8. Enriches Stripe financial/card-check data when possible.
9. Marks the order confirmed.
10. Deletes pending abandoned-checkout reminder state for the completed order.
11. Queues customer order email, super-admin order notifications, lookup indexing, and event reminders.
12. Marks the Stripe event processed only after settlement succeeds.

For `payment_intent.payment_failed`, the Worker:

1. Runs the same signature, idempotency, Store-order, and amount/currency validation.
2. Releases the inventory reservation unless the order was already confirmed.
3. Stores `payment.status = "payment_failed"` and the Stripe failure message when available.
4. Keeps the failed order private/no-store.

This makes duplicate webhooks safe and transient failures retryable.

## Data Model

### Order Record

Store order money fields are integer cents:

```json
{
  "version": 1,
  "orderToken": "store-order-abc123",
  "orderHash": "sha256...",
  "checkoutProvider": "first_party",
  "status": "confirmed",
  "createdAt": "2026-07-04T12:00:00.000Z",
  "confirmedAt": "2026-07-04T12:00:21.000Z",
  "orderDraft": {
    "version": 1,
    "orderToken": "store-order-abc123",
    "status": "confirmed",
    "checkoutProvider": "first_party",
    "source": "web",
    "preferredLang": "en",
    "currency": "USD",
    "customer": {
      "email": "buyer@example.com",
      "name": "Buyer Example"
    },
    "items": [
      {
        "productId": "dust-wave-digital-download",
        "sku": "dust-wave-digital-download",
        "name": "DUST WAVE Digital Download",
        "quantity": 1,
        "unitPriceCents": 500,
        "subtotalCents": 500,
        "fulfillmentType": "digital"
      }
    ],
    "totals": {
      "itemCount": 1,
      "subtotalCents": 500,
      "discountCents": 0,
      "discountedSubtotalCents": 500,
      "tipPercent": 0,
      "tipAmountCents": 0,
      "shippingCents": 0,
      "taxCents": 0,
      "totalCents": 500,
      "requiresPayment": true,
      "requiresShipping": false,
      "requiresTurnstile": false
    }
  },
  "payment": {
    "required": true,
    "provider": "stripe",
    "status": "succeeded",
    "paymentIntentId": "pi_...",
    "amountCents": 500,
    "currency": "USD",
    "confirmedAt": "2026-07-04T12:00:21.000Z",
    "chargeId": "ch_...",
    "balanceTransactionId": "txn_...",
    "cardChecks": {
      "addressLine1Check": "pass",
      "addressPostalCodeCheck": "pass",
      "cvcCheck": "pass",
      "networkStatus": "approved_by_network",
      "riskLevel": "normal",
      "outcomeType": "authorized"
    }
  }
}
```

Confirmed paid orders may also store actual Stripe financial data:

- `payment.stripeFinancials.paymentIntentId`
- `payment.stripeFinancials.chargeId`
- `payment.stripeFinancials.balanceTransactionId`
- `payment.stripeFinancials.grossAmount`
- `payment.stripeFinancials.feeAmount`
- `payment.stripeFinancials.netAmount`
- `payment.stripeFinancials.currency`
- `payment.stripeFinancials.status`
- `payment.stripeFinancials.availableOn`
- `payment.stripeFinancials.reportingCategory`

Admin analytics and reconciliation prefer actual Stripe balance transaction data where present. Older records or imported Snipcart records may have less payment detail.

### Projection And Index Records

These are useful state, but they are not accounting truth:

- `admin-store-orders:index:v1`
- `store-order-email:*`
- `store-inventory:v1:*`
- `store-order-email-sent:*`
- `store-order-admin-email-sent:*`
- reminder queue, sent, and health records
- bounded `observability:*` summaries

Use order records and persisted payment snapshots for reconciliation. Rebuild or repair projections from order truth when possible rather than treating projections as independent money state.

### What Is Not Stored

Store does not store:

- card numbers
- CVV
- raw Stripe payment form contents
- full payment processor ledgers
- permanent balances
- public raw download URLs for private digital products

The current implementation does not persist raw Stripe webhook payloads by default. It verifies over the raw body, stores idempotency and observability summaries, and can retrieve Stripe PaymentIntents again when enrichment is needed. If operational requirements change, add bounded raw-event retention with a PII policy and retention window.

## Fulfillment After Payment

Payment settlement unlocks fulfillment but does not move fulfillment out of the Worker-controlled path.

On confirmed orders:

- Physical rows appear in admin Orders and CSV exports for fulfillment handoff.
- Digital rows expose token-scoped signed download actions only while the order's entitlement remains active.
- Ticket and RSVP rows expose QR/check-in and calendar actions.
- Customer order lookup indexes are updated by email hash.
- Store-owned order confirmation emails link customers back to `/order-success/?orderToken=...`.
- Event reminders are queued for ticket/RSVP items with valid event start times.

Revoking digital access, refreshing digital access, and ticket/RSVP check-in are admin mutations with session, CSRF, role/scope, and audit boundaries. They should never be performed through Stripe metadata or browser-only state.

## Operations

### Webhook Observability

Use:

```text
GET /admin/observability/webhooks?days=2
```

Or:

```bash
ADMIN_SECRET=... ./scripts/check-observability.sh --local
```

Review duplicate deliveries, signature failures, skipped events, rejected Store PaymentIntent events, and recent outcomes.

### Missed Local Webhook

If local Stripe payment completed but the Store order does not confirm:

1. Check Stripe CLI forwarding in the `./scripts/dev.sh` output.
2. Confirm the local `STRIPE_WEBHOOK_SECRET` or mode-specific webhook secret matches the running listener.
3. Check Worker logs for signature, amount, currency, order hash, or inventory rejection.
4. Retry a signed Stripe webhook event from the Stripe CLI or dashboard where safe.
5. If inventory was reserved but payment never settled, inspect the order token before deleting or mutating KV state.

There is no Store recovery route that bypasses Stripe webhook settlement. Store paid order confirmation should come from a signed Stripe PaymentIntent webhook.

### Reconciliation Checklist

After checkout, fulfillment, or payment changes:

- Run `npm run release:providers` for read-only provider checks. It can use authenticated `gh`, `wrangler`, and `stripe` CLIs to prove GitHub deploy secret names, Cloudflare KV/R2 resources, and live Stripe webhook endpoints without printing secrets.
- Run `npm run release:payment-smoke` for payment contract checks. Local/test variables are read from `worker/.dev.vars` by default; pass `--no-dev-vars` only for clean-shell CI probes. For non-production direct signed-webhook settlement, run `PAYMENT_SMOKE_ALLOW_MUTATION=1 npm run release:payment-smoke -- --direct-webhook` against a Worker that has `STORE_EMAIL_DRY_RUN=true` or `RESEND_EMAIL_DRY_RUN=true`; the direct matrix covers paid digital, paid physical, paid ticket, free RSVP, and failed-payment paths and verifies customer/admin order emails render without calling Resend. For local/non-production test-mode PaymentIntent creation against explicit URLs, set `PAYMENT_SMOKE_ALLOW_MUTATION=1`, `PAYMENT_SMOKE_WORKER_URL`, `PAYMENT_SMOKE_SITE_URL`, and `STRIPE_SECRET_KEY_TEST`; add `PAYMENT_SMOKE_CONFIRM=1` only when the non-production webhook endpoint is expected to settle the order.
- Confirm `STORE_STATE`, `RATELIMIT`, `STORE_DOWNLOADS`, and `STORE_INVENTORY_COORDINATOR` point at the intended environment.
- Confirm Stripe publishable/secret keys match the selected app mode.
- Confirm the Stripe webhook endpoint targets `https://checkout.dustwave.xyz/webhooks/stripe` in production.
- Confirm the webhook subscribes to `payment_intent.succeeded` and `payment_intent.payment_failed`.
- Review webhook observability.
- Export Store reconciliation CSV from **Settings -> Store readiness**.
- Compare Stripe payments against Store confirmed orders, total amounts, currencies, charge IDs, balance transaction IDs, and card verification outcomes.
- Confirm failed/canceled payments release reservations.
- Confirm Store order emails, admin notifications, lookup links, downloads, check-in actions, and CSV exports match the settled order state.

## Testing

Fast local checks:

```bash
npm run test:unit
npm run test:security
```

Payment-focused checks:

```bash
npx vitest run \
  tests/unit/store-checkout-email-delivery.test.ts \
  tests/unit/store-reconciliation-csv.test.ts \
  tests/unit/stripe-checkout-sidecar.test.ts \
  tests/security/webhook-security.test.ts \
  tests/security/input-validation.test.ts \
  tests/security/rate-limiting.test.ts
```

Local full-flow helpers:

```bash
./scripts/dev.sh --podman
./scripts/test-worker.sh --podman
./scripts/test-checkout.sh --podman
```

Manual Stripe test cards:

- success: `4242 4242 4242 4242`
- 3D Secure: `4000 0000 0000 3220`
- declined/failed cards: use the current Stripe test-card catalog

For processor behavior, prefer Stripe test mode and the Stripe CLI over hand-built webhook payloads. Sandboxes are useful, but they are not a replacement for signature verification, idempotency tests, and recovery/reconciliation checks.

## Related Docs

- [WORKFLOWS.md](./WORKFLOWS.md)
- [SECURITY.md](./SECURITY.md)
- [TESTING.md](./TESTING.md)
- [DASHBOARD.md](./DASHBOARD.md)
- [EMAIL.md](./EMAIL.md)
- [BACKUP_RESTORE.md](./BACKUP_RESTORE.md)
- [worker/README.md](../worker/README.md)

# Store Worker

Cloudflare Worker API for Store checkout, fulfillment, admin operations, shipping, tax, Stripe webhooks, email delivery, inventory reservations, and signed downloads.

## Local Development

```bash
cd worker
npx wrangler dev --env dev --ip 127.0.0.1 --port 8989
```

The local storefront expects the Worker at `http://127.0.0.1:8989`.

## Core Bindings

- `STORE_STATE`: KV for order drafts, confirmed orders, admin users, audit events, inventory overrides, retry queues, and rate summaries.
- `RATELIMIT`: KV-backed rate limiting. The Worker fails closed when this binding is absent.
- `STORE_INVENTORY_COORDINATOR`: Durable Object coordinator for SKU reservations.
- `STORE_DOWNLOADS`: R2 bucket for signed digital download delivery.

## Public API

- `POST /api/cart/validate`: validate a Store cart against the generated catalog.
- `POST /api/checkout/intent`: create a Store order draft and Stripe PaymentIntent, or confirm a no-payment order.
- `GET /api/orders/:token`: return token-scoped order summary and fulfillment actions.
- `GET /api/orders/:token/download/:itemId`: return a signed download action.
- `GET /api/orders/:token/ticket/:itemId.svg`: return ticket/RSVP QR SVG.
- `GET /api/orders/:token/calendar/:itemId.ics`: return event calendar data.
- `POST /shipping/quote`: quote shipping for checkout preview.
- `POST /tax/quote`: quote sales tax for checkout preview.
- `POST /webhooks/stripe`: verify Stripe signatures and settle paid orders.
- `GET /add-ons/inventory`: read public add-on inventory state.

## Admin API

All browser admin mutations use the `store_admin_session` cookie and `x-store-admin-csrf` header.

- `GET /admin/session`
- `POST /admin/auth/start`
- `POST /admin/auth/exchange`
- `POST /admin/logout`
- `GET /admin/dashboard/summary`
- `GET /admin/settings`
- `POST /admin/settings/preview`
- `POST /admin/settings/publish`
- `POST /admin/users`
- `GET /admin/store/orders`
- `GET /admin/store/orders.csv`
- `POST /admin/store/orders/check-in`
- `GET /admin/store/products`
- `POST /admin/store/products/publish`
- `GET /admin/store/downloads`
- `POST /admin/store/downloads/upload`
- `GET /admin/store/inventory`
- `POST /admin/store/inventory`
- `GET /admin/add-ons/inventory`
- `POST /admin/add-ons/inventory`
- `POST /admin/rebuild`
- `GET /admin/cron/status`
- `GET /admin/observability/webhooks`
- `GET /admin/observability/performance`

## Required Secrets

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `ADMIN_SESSION_SECRET`
- `MAGIC_LINK_SECRET`
- `RESEND_API_KEY`

Optional live integrations:

- `USPS_CLIENT_SECRET`
- `ZIP_TAX_API_KEY`
- `TURNSTILE_SECRET_KEY`
- `GITHUB_TOKEN`

## Store Checkout Flow

1. Browser sends cart items to `/api/checkout/intent`.
2. Worker validates IDs, SKUs, variants, prices, inventory metadata, shipping metadata, and tax categories against the generated catalog.
3. Worker reserves positive-count SKUs through `STORE_INVENTORY_COORDINATOR`.
4. Paid orders receive a Stripe PaymentIntent client secret.
5. Stripe webhook confirms or fails the order after signature, amount, currency, PaymentIntent, and stored-hash validation.
6. Successful payment commits inventory, stores the confirmed order, queues the order email, and enables fulfillment actions.
7. Failed payment releases inventory reservations and records the failure state.

## Config Sync

Run this after `_config.yml`, `_products/`, shipping, tax, pricing, or domain settings change:

```bash
npm run sync:worker-config
```

That regenerates `worker/wrangler.toml` vars and `worker/src/generated/catalog-snapshot.js`.

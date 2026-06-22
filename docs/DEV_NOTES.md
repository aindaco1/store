# Developer Notes

Store is a static-first storefront backed by a Cloudflare Worker. The public site is Jekyll, the catalog source is `_products/`, and the Worker owns checkout, order persistence, shipping/tax quotes, Stripe webhooks, inventory reservations, emails, digital downloads, and admin operations.

## Local Services

```bash
bundle exec jekyll serve --config _config.yml,_config.local.yml --host 127.0.0.1 --port 4002
cd worker && npx wrangler dev --env dev --ip 127.0.0.1 --port 8989
```

- Storefront: `http://127.0.0.1:4002`
- Worker: `http://127.0.0.1:8989`

## Source Layout

- `_products/`: product Markdown files.
- `api/products.json`: generated public catalog endpoint.
- `api/add-ons.json`: optional platform add-on catalog.
- `assets/js/cart-provider.js`: Store cart and checkout UI runtime.
- `assets/js/admin-dashboard.js`: browser admin dashboard.
- `worker/src/catalog.js`: catalog validation.
- `worker/src/orders.js`: order draft and fulfillment shaping.
- `worker/src/index.js`: Worker routes.
- `worker/src/tier-inventory-do.js`: Store SKU inventory Durable Object.
- `worker/src/generated/catalog-snapshot.js`: generated Worker catalog snapshot.

## Config Flow

`_config.yml` is the source for public and mirrored Worker settings. After config or product edits:

```bash
npm run sync:worker-config
```

This runs:

- `scripts/sync-worker-config.rb`
- `scripts/generate-catalog-snapshot.rb`

Restart the Worker after syncing.

## Runtime Ports

Local defaults are intentionally pinned:

- Storefront: `127.0.0.1:4002`
- Worker: `127.0.0.1:8989`

## Checkout Model

Store checkout is order-based:

1. Browser cart posts to `/api/checkout/intent`.
2. Worker validates submitted cart data against the catalog snapshot.
3. Worker creates a `store-order:{token}` draft.
4. Paid orders use Stripe PaymentIntents.
5. Free RSVP-style orders confirm immediately.
6. Stripe webhooks settle paid orders and send order emails.

## Inventory

Products may define `inventory_tracking` and positive inventory counts. Store inventory overrides live in KV and are edited from admin. Positive-count items reserve through `StoreInventoryCoordinator` during checkout and commit/release from order confirmation paths.

## Admin

The admin dashboard supports:

- settings and users
- Store orders and CSV export
- ticket/RSVP check-in
- product review and publish
- product image upload
- digital download readiness and R2 upload
- inventory overrides
- add-on inventory
- cron/observability

Browser admin sessions use `store_admin_session`; mutations require `x-store-admin-csrf`.

## Test Path

```bash
npm run test:unit
npm run test:content-security
npm run test:security
PLAYWRIGHT_EXTERNAL_SERVER=1 CI=1 npx playwright test --project=chromium --workers=1
```

For the full local gate:

```bash
npm run test:premerge
```

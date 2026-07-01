# Testing

Release `v1.0.4` adds regression coverage for Store-owned customer/super-admin order email, durable digital download entitlements with admin revoke/refresh, ticket SVG long-name fitting, localized public order routes, authenticated order-notification link consumption, admin tab persistence, i18n completeness, SEO metadata, admin order action responsiveness, and live order attendance refresh.

The default test path is Store-only. It covers product pages, cart behavior, first-party checkout, Store admin operations, coupons, order lookup, reminders, content safety, and Worker security.

## Quick Commands

```bash
bundle exec jekyll build --quiet
npm run test:unit
npm run test:seo
npm run test:content-security
npm run test:security
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh
PLAYWRIGHT_EXTERNAL_SERVER=1 CI=1 npx playwright test --project=chromium --workers=1
```

Local services:

- Storefront: `http://127.0.0.1:4002`
- Worker: `http://127.0.0.1:8989`

## Browser Coverage

Default Playwright specs:

- `tests/e2e/accessibility-public-pages.spec.ts`
- `tests/e2e/public-page-controls.spec.ts`
- `tests/e2e/admin-dashboard.spec.ts`

These cover public layout/accessibility, product-card and product-detail controls, storefront filters, localized product routes, cart quantity updates, keyboard add-to-cart flow, customer order lookup, Store admin login, Store readiness/audit/reconciliation export, Store order CSV/attendee CSV/check-in/download access flow, product publish, download replacement upload, coupon management, inventory baseline writes, scoped Store admin access, and Spanish admin tabs.

## Unit Coverage

```bash
npm run test:unit
```

Focused Store runs:

```bash
npx vitest run \
  tests/unit/store-catalog.test.ts \
  tests/unit/store-coupons.test.ts \
  tests/unit/shipping.test.ts \
  tests/unit/tax.test.ts \
  tests/unit/tier-inventory-do.test.ts \
  tests/unit/order-lookup-email.test.ts \
  tests/unit/event-reminders.test.ts \
  tests/unit/cart-runtime-loader.test.ts \
  tests/unit/page-prefetch.test.ts
```

## Security

```bash
npm run test:secrets
npm run test:content-security
npm run test:security
npm run test:security:podman
```

The security suite checks Store admin auth boundaries, cart/checkout input validation, oversized payload rejection, Stripe webhook signature enforcement, CORS preflight resilience, and rate-limit behavior.

## SEO

```bash
bundle exec jekyll build --quiet
npm run test:seo
```

The rendered SEO audit checks non-admin HTML, canonical URLs, descriptions, social metadata, JSON-LD, sitemap URLs, localized alternates, and crawl-control rules for `noindex` routes.

## Pre-Merge

```bash
npm run test:premerge
```

The pre-merge script runs secret/content audits, syntax checks, focused Store unit tests, full unit tests, build artifact checks, Worker security tests, Worker smoke tests, asset minification checks, and the headless Playwright suite. When host Jekyll gems are unavailable it can fall back to a Podman-backed build path.

## Production Preflight

Before deploys that affect checkout, fulfillment, admin publishing, product inventory, or production settings, run from the repository root:

```bash
npm run sync:worker-config
npm run catalog:generate
npm run launch:readiness
bundle exec jekyll build --config _config.yml,_config.local.yml
npm run assets:minify:check
npm run test:unit
```

For checkout, admin, or Worker changes, also run:

```bash
npm run test:security
CI=1 npx playwright test tests/e2e/admin-dashboard.spec.ts --workers=1
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh
```

`npm run launch:readiness` checks repo-visible production inputs. It does not prove Cloudflare secrets, Stripe webhooks, USPS credentials, Resend sender verification, R2 objects, or production DNS exist in external accounts; verify those manually in the provider consoles and admin readiness views.

## Manual Store Smoke

After checkout, fulfillment, email, admin, inventory, or catalog changes:

1. Add a physical product to cart.
2. Change quantity in the cart.
3. Complete a paid Stripe test checkout.
4. Confirm `/order-success/` shows fulfillment state.
5. Confirm the order email sends through Resend.
6. Export Store audit CSV from **Settings -> Store readiness**.
7. Export Store reconciliation CSV from **Settings -> Store readiness**.
8. Export Store orders CSV from admin.
9. Search for a ticket attendee and export attendee CSV from admin.
10. Check in a ticket/RSVP order from admin.
11. Upload or replace a digital download in admin.
12. Create and delete a reusable download library file.
13. Revoke and refresh a confirmed digital fulfillment item from admin.
14. Download a confirmed digital fulfillment item.
15. Create, apply, and delete a coupon.
16. Request an order lookup link and consume it.
17. Verify abandoned-checkout reminder suppression/resume behavior in a controlled test.
18. Set an inventory baseline and verify checkout respects it.
19. Replay or send an equivalent Stripe webhook test event for paid settlement.
20. Confirm failed/canceled payments release reservations.

## Production Checklist

Provider and runtime checks:

- Cloudflare routes or custom domains serve `https://shop.dustwave.xyz` and `https://checkout.dustwave.xyz`.
- `STORE_STATE`, `RATELIMIT`, `STORE_DOWNLOADS`, and `STORE_INVENTORY_COORDINATOR` point at production Cloudflare resources.
- Worker secrets are set in Cloudflare, not in Git, including Stripe, Resend, admin session/login, checkout intent, magic link, download/order lookup, Turnstile, and USPS secrets as applicable.
- Production runtime config uses `SITE_BASE=https://shop.dustwave.xyz`, `WORKER_BASE=https://checkout.dustwave.xyz`, `CORS_ALLOWED_ORIGIN=https://shop.dustwave.xyz`, `TAX_PROVIDER=nm_grt`, `SHIPPING_ORIGIN_ZIP=87120`, `SHIPPING_ORIGIN_COUNTRY=US`, and `USPS_ENABLED=true` unless intentionally changed.
- Stripe production webhook endpoint targets `https://checkout.dustwave.xyz/webhooks/stripe` and subscribes at least to `payment_intent.succeeded` and `payment_intent.payment_failed`.
- Resend sender domains and `ORDERS_EMAIL_FROM` / `UPDATES_EMAIL_FROM` are verified.
- USPS live credentials and New Mexico GRT behavior are verified from the production origin address.
- Real `STORE_DOWNLOADS` objects or approved Worker-only fallback URLs exist for active digital products.
- Finite-stock products have true inventory baselines or `inventory_baseline_source` / `inventory_verified_at`; unlimited or made-to-order products use `inventory_tracking: false`.

Production smoke:

- Paid physical checkout works with tax and shipping.
- Paid digital checkout produces a signed download action.
- Paid ticket checkout produces ticket/check-in actions.
- Free RSVP checkout confirms without Stripe.
- Stripe webhooks confirm paid orders.
- Failed payments release reservations.
- Admin product publish triggers deploy.
- Admin download replacement works on a non-public test product.
- Admin coupon create/apply/delete works on a harmless test cart.
- Admin user scopes are correct.
- Customer order lookup links are generic on request and token-scoped on consume.
- Reminder cron heartbeat and queue health are visible.
- Store orders, audit, attendee, and reconciliation CSV exports download and match the expected production order state.

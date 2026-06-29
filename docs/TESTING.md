# Testing

Release `v1.0.4` adds regression coverage for Store-owned customer/super-admin order email, durable digital download entitlements with admin revoke/refresh, ticket SVG long-name fitting, i18n completeness, admin order action responsiveness, and live order attendance refresh.

The default test path is Store-only. It covers product pages, cart behavior, first-party checkout, Store admin operations, coupons, order lookup, reminders, content safety, and Worker security.

## Quick Commands

```bash
bundle exec jekyll build --quiet
npm run test:unit
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

## Pre-Merge

```bash
npm run test:premerge
```

The pre-merge script runs secret/content audits, syntax checks, focused Store unit tests, full unit tests, build artifact checks, Worker security tests, Worker smoke tests, asset minification checks, and the headless Playwright suite. When host Jekyll gems are unavailable it can fall back to a Podman-backed build path.

## Manual Store Smoke

Before launch or after checkout/fulfillment changes:

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

## Launch Checklist

Use [PRODUCTION_LAUNCH.md](PRODUCTION_LAUNCH.md) for the full production runbook.

- Physical paid checkout works with tax and shipping.
- Digital paid checkout produces a signed download action.
- Ticket paid checkout produces ticket/check-in actions.
- Free RSVP checkout confirms without Stripe.
- Stripe webhooks confirm paid orders.
- Failed payments release reservations.
- Production `STORE_DOWNLOADS` objects exist.
- Real inventory baselines are entered for finite-stock products, and unlimited/made-to-order products use `inventory_tracking: false`.
- Admin product publish triggers deploy.
- Admin user scopes are correct.
- Coupons discount only eligible carts.
- Customer order lookup links are generic on request and token-scoped on consume.
- Reminder cron heartbeat and queue health are visible.

# AGENTS.md

## Project

Store is an OSS static commerce layer and the successor to `aindaco1/dust-wave-shop`.

Use `/Users/aindaco1/Desktop/agents.md` as the product brief. The active product model is Store product/order/fulfillment backed by Cloudflare, Stripe, USPS/NM GRT, Resend, and the private Store admin dashboard.

## Build/Serve

```bash
npm run podman:doctor
./scripts/dev.sh --podman
bundle exec jekyll build --quiet
npm run sync:worker-config
npm run test:unit
```

## Current Architecture

- Static storefront: Jekyll, products in `_products/`
- Public product API: `/api/products.json`
- Cart runtime: Store-owned browser globals/events/classes (`assets/js/store-config.js`, `STORE_CONFIG`, `StoreLogger`, `StoreCartProvider`, `StoreCartRuntime`, `window.Store`, `store-add-item`, `store-first-party-cart__*`, `storecart.*`)
- Worker: Store order/cart API configured for `checkout.dustwave.xyz`
- Admin: Store products/repo publishing, product image uploads, coupons, download library/upload/delete, orders, inventory, attendance/check-in, analytics, marketing, settings, plan usage, readiness, and user management
- Shipping/tax defaults: USPS and NM GRT
- Emails: Resend-backed Store transactional email
- Local admin publishes: `worker/src/local-repo-service.mjs` when `APP_MODE=test` and `ADMIN_LOCAL_REPO_WRITES_ENABLED=true`

## Conventions

- Do not add Snipcart back.
- Public add buttons should include `store-add-item`; do not add Snipcart or legacy cart button classes.
- Product IDs come from `identifier`; SKUs are explicit in front matter.
- Prefer `store_collection` for collection and `storefront_category` or `product_category` for product-type categories. Existing migrated `category: dustwave` / `category: fronteras` values are collection-compatible legacy data.
- Inventory tracking is immediate. If real counts are unknown, keep counts at `0` rather than inventing stock.
- Product variants must carry their own `sku`, `price`, and `inventory`.
- Keep static browsing cheap; Worker calls belong to validation, checkout, admin, inventory, order, ticket, download, and email flows.
- Coupons are KV-backed admin data, not product metadata.

## Near-Term Cleanup Tasks

1. Keep Store runtime names canonical; do not reintroduce legacy browser aliases.
2. Upload real production digital download objects into `STORE_DOWNLOADS` or configure approved Worker-only fallback URLs, then verify SKU inventory baselines from the admin dashboard.
3. Keep removed-route regression assertions for deleted non-Store paths, but do not add compatibility behavior back.
4. Keep `limited_admin` / `accessScopes` as the canonical admin auth schema.
5. Keep USPS, NM GRT, Stripe, Resend, Turnstile, CSRF/origin, rate-limit, and no-store hardening.

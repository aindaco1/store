# Store Security Guide

Release `v1.0.4` security posture: Store-owned order email replaces Stripe receipts, confirmed digital download entitlements are durable unless revoked, signed links remain short-lived/private/no-store, super-admin order notifications reuse the transactional email pipeline without ticket/QR attachments, and admin dashboard navigation persistence stores only sanitized non-sensitive tab state in browser storage.

This document covers the active Store security model: static product pages, first-party cart runtime, Cloudflare Worker checkout APIs, Stripe, USPS/NM GRT integrations, Resend email, signed downloads, inventory, and the private admin dashboard.

This guide describes the current Store security model and the launch target. Historical imported compatibility paths should be removed or kept returning `404`; do not preserve old campaign/Snipcart behavior as a security workaround.

## Trust Boundaries

- The static Jekyll site is public and untrusted by the Worker.
- The Worker is authoritative for cart validation, checkout totals, tax, shipping, inventory reservations, order state, fulfillment actions, admin mutations, and email dispatch.
- Stripe is authoritative for paid settlement only after webhook signature verification.
- Cloudflare KV stores operational records and session state; Durable Objects coordinate race-sensitive checkout/inventory work; R2 stores private digital download objects.
- GitHub-backed catalog/admin publishing paths are admin-only and normalized server-side before commit.

## Authentication And Secrets

| Mechanism | Surface | Notes |
| --- | --- | --- |
| Stripe webhook signature | `/webhooks/stripe` | Fails closed when the webhook secret is absent or invalid. |
| Checkout intent nonce | `/api/checkout/intent` | Signed server-side intent for first-party checkout continuation. |
| Admin magic link | `/admin/auth/*` | One-time login nonce, signed admin session cookie, and CSRF on mutations. |
| Super-admin order CTA | Order notification email | Reuses the admin one-time login nonce with `tab=store-orders`; only generated for effective super admins. |
| Admin CSRF | `x-store-admin-csrf` | Required for dashboard writes. |
| Admin roles/scopes | Admin APIs | `super_admin` plus Store access scopes for limited admins. |
| Optional Turnstile | Admin sign-in | Local/test bypasses are accepted only in local/test mode. |
| API/admin recovery secrets | Operator routes | Bearer/header secrets stay in Worker secrets or ignored local files. |

Secret storage rules:

- Local development secrets belong in ignored `worker/.dev.vars`.
- Production Worker secrets belong in Cloudflare Worker secrets via `wrangler secret put`.
- GitHub repository secrets are for CI/deploy/operator workflows only; they are not runtime Worker secrets.
- `_config.yml`, product markdown, and admin-published settings must never contain Stripe, Resend, USPS, ZIP.TAX, Cloudflare, GitHub, or admin session secrets.
- The admin dashboard may show configured/missing status for credentials, but must not expose, edit, serialize, or publish secret values.

## Data Storage

| Key Pattern | Binding | Data | Sensitivity |
| --- | --- | --- | --- |
| `orders:{token}` | KV | Order draft/settlement/fulfillment state | High |
| `store-order-email:{emailHash}` | KV | Order lookup index by customer email hash | Medium |
| `store-order-lookup:{jti}` | KV | Short-lived one-time order lookup nonce | Medium |
| `store-inventory-overrides:v1` | KV | Admin-entered SKU baseline overrides | Medium |
| `store-inventory:v1:*` | KV / Durable Object | Derived SKU projections, reservations, commits | Medium |
| `store-coupons:v1` | KV | Coupon definitions and status | Medium |
| `orders:{token}.downloadAccess` / R2 object metadata | KV / R2 | Per-order download access state and private file objects | High |
| `abandoned-cart:*` | KV | Opt-in checkout reminder queue snapshots | Medium |
| `abandoned-cart-suppressed:*` | KV | Reminder suppression records | Medium |
| `store-event-reminder:*` | KV | Event reminder queue records | Medium |
| `stripe-event:{id}` | KV | Webhook idempotency marker | Low |
| `admin-login:{hash}` | KV | One-time admin login nonce | Medium |
| `admin-session:{hash}` | KV | Admin identity, role, scopes, CSRF, expiry | High |
| `admin-users:v1` | KV | Runtime admin users and scopes | High |
| `admin-audit:{date}:{action}:{id}` | KV | Recent admin mutation audit metadata | Medium |
| `admin-store-marketing-referrals:v1` | KV | Saved referral/UTM links | Medium |
| `observability:*` | KV | Bounded webhook/performance telemetry summaries | Low |
| `rl:{endpoint}:{ip}` | KV | Rate-limit counters | Low |

Sensitive responses should use `Cache-Control: private, no-store`. Tokenized order/download/admin routes must not be indexed or placed in the sitemap.

Browser storage:

- `store-admin-dashboard-state:v1` may persist the last selected admin tab and Settings section index in `localStorage`.
- The stored values are sanitized client-side, contain no customer/order/session/CSRF data, and are ignored when a requested tab is not visible for the authenticated admin role.
- Explicit `tab=` deep links, including authenticated super-admin order notification links, take precedence over the stored tab.

## Checkout And Cart Integrity

The browser cart is convenience state only. The Worker recalculates and validates:

- product identifiers, SKUs, variants, quantities, and unit prices from the generated Store catalog
- coupon code validity, eligibility, status, date windows, and discount amount
- tax category and NM GRT destination handling
- shipping presets, USPS quote/fallback behavior, and non-shippable product handling
- tip/platform fee policy
- inventory availability and reservation ownership
- free-order versus paid PaymentIntent behavior

Tampered carts must fail closed with `422` before Stripe work begins. Paid Store orders become confirmed only through a valid Stripe `payment_intent.succeeded` webhook whose metadata and order hash match the stored draft. Failed/canceled payments release reservations.

## Inventory

Inventory truth for scarce Store SKUs is coordinated by `STORE_INVENTORY_COORDINATOR`.

- Checkout reserves positive-count inventory before payment confirmation.
- Webhook success commits reservations.
- Payment failure releases reservations.
- Admin baseline writes are scoped admin mutations and audited.
- Super-admin audit CSV export is read-only, authenticated, and limited to recent KV-backed admin mutation events.
- Public/catalog inventory displays are projections and should not be treated as authoritative checkout inputs.

## Digital Downloads

Digital products use private R2 objects and signed fulfillment actions.

- Product markdown declares `download.file_key`; raw public download URLs are not used.
- Admin download uploads/replacements require an authenticated Store admin session.
- Admin library download create/delete operations require the same fulfillment permission and R2 object validation.
- Order Success exposes download actions only for confirmed orders and token-scoped fulfillment items.
- Per-order download access state enforces explicit admin revocation server-side, so revoked access blocks previously issued links.
- Admin download revoke/refresh mutations require an authenticated Store admin session plus CSRF and write an audit event.
- Order lookup requests return a generic response, email short-lived one-time tokens only when matching orders exist, and consume each token before returning order links.
- Signed links should be short-lived and private/no-store, while confirmed digital entitlements remain permanent unless revoked.
- Production launch requires real `STORE_DOWNLOADS` objects for all active digital products.

## Admin Dashboard

Admin writes use a single server-side normalization boundary before touching GitHub-backed files or KV.

Required protections:

- valid admin session cookie
- `x-store-admin-csrf` for mutations
- role/scope checks for Store orders, products, coupons, downloads, inventory, marketing, settings, and user management
- server-side allowlists for publishable fields
- strict media upload validation for type, size, destination, filename, and path traversal
- no inline scripts in the static admin shell
- restrictive admin CSP and no public social/structured metadata
- runtime admin users stored in KV, not `_config.yml`
- local dashboard navigation persistence limited to non-sensitive tab identifiers

Limited admins should see only the Store surfaces allowed by their access scopes. Super admins retain settings and user-management access.

## Product Content Safety

Store product files in `_products/` are audited by:

```bash
npm run test:content-security
```

The audit requires product metadata, validates prices/inventory/status/fulfillment fields, checks local product images, requires digital download file keys, rejects unsafe markdown links, and rejects raw HTML/script/event/style surfaces in product content.

Rendering defenses also remain in place:

- product card descriptions are escaped
- product detail markdown links run through `sanitize_markdown_links`
- product JSON payloads use JSON encoding

Use Markdown for product descriptions; do not author raw HTML in product markdown.

## Public Runtime Boundaries

- Intent prefetching is limited to public Store document routes.
- Admin, checkout, API, Worker, tokenized, order lookup, Order Success, and sensitive query routes are blocked from prefetch.
- Cart recovery is limited to cart, checkout, and Order Success flows.
- Abandoned-checkout resume/unsubscribe links are signed, scoped, expiring URLs and should not be crawled or logged with tokens intact.
- `robots.txt` disallows admin, order lookup, and Order Success routes.
- `sitemap.xml` includes public product URLs and excludes admin/tokenized/private pages.

## Verification

Core local checks:

```bash
npm run test:secrets
npm run test:content-security
npm run test:security
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh
PLAYWRIGHT_EXTERNAL_SERVER=1 CI=1 npx playwright test --project=chromium --workers=1
```

Before launch, also complete a real Stripe test checkout for each fulfillment class:

- physical paid product with tax and shipping
- digital paid product with signed download
- ticket paid product with admin check-in
- free RSVP/free-order path

## Known Launch Preconditions

- Real inventory baselines must be entered for finite-stock active products; unlimited or made-to-order products must use `inventory_tracking: false`.
- Active digital products must have either real `STORE_DOWNLOADS` objects or Worker-only fallback URLs.
- Production Worker secrets must be configured in Cloudflare, not copied from local dev.
- Stripe webhook endpoint and signing secret must be configured for the production Worker domain.
- USPS and NM GRT credentials/settings must be verified against the production origin address.
- Admin bootstrap users and limited scopes must be reviewed before deployment.

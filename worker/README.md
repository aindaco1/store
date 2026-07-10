# Store Worker

Cloudflare Worker API for Store checkout, fulfillment, admin operations, shipping, tax, Stripe webhooks, email delivery, inventory reservations, coupons, reminders, observability, and signed downloads.

## Local Development

Preferred full-stack launch from the repo root:

```bash
./scripts/dev.sh
```

Worker-only launch:

```bash
cd worker
npm run dev
```

Both paths sync Worker config and generate the catalog snapshot first. `npm run dev` also starts `src/local-repo-service.mjs` before Wrangler so local admin publishes can write to the checkout when `APP_MODE=test` and `ADMIN_LOCAL_REPO_WRITES_ENABLED=true`.

Local defaults:

- Storefront: `http://127.0.0.1:4002`
- Worker: `http://127.0.0.1:8989`
- Local repo sidecar: `http://127.0.0.1:8799`

## Core Bindings

- `STORE_STATE`: KV for orders, admin sessions/users/audit, inventory overrides, coupon definitions, order lookup indexes, reminders, observability summaries, and retry/queue state.
- `RATELIMIT`: KV-backed request throttling. The Worker fails closed for protected paths when this binding is absent and serializes same-isolate updates per key so concurrent requests do not overwrite one another's increments.
- `STORE_INVENTORY_COORDINATOR`: Durable Object coordinator for SKU reservations, commits, releases, and availability snapshots.
- `STORE_DOWNLOADS`: R2 bucket for signed digital download files and reusable download library objects.

## Public API

- `POST /api/cart/validate`: validate a Store cart against the generated catalog and optional coupon code.
- `POST /api/checkout/intent`: create an order draft and Stripe PaymentIntent, or confirm a no-payment order.
- `GET /api/orders/:token`: return token-scoped order summary and fulfillment actions.
- `GET /api/orders/:token/downloads/:itemId`: serve a confirmed digital download.
- `GET /api/orders/:token/tickets/:itemId.svg`: return ticket/RSVP QR SVG.
- `GET /api/orders/:token/calendar/:itemId.ics`: return event calendar data.
- `GET /api/orders/:token/check-in/:itemId`: process a signed ticket/RSVP check-in link.
- `POST /api/orders/lookup`: send a customer order lookup link when matching orders exist.
- `GET /api/orders/lookup`: consume a one-time lookup token and return order links.
- `POST /shipping/quote`: quote shipping for checkout preview.
- `POST /tax/quote`: quote sales tax for checkout preview.
- `GET /add-ons/inventory`: read public add-on inventory state.
- `GET /abandoned-cart/unsubscribe`: suppress checkout reminder emails from a signed link.
- `GET /abandoned-cart/resume`: restore a signed checkout reminder snapshot.
- `POST /webhooks/stripe`: verify Stripe signatures and settle paid orders.

Legacy aliases `/cart/validate` and `/checkout/intent` still route to the Store validation/checkout handlers for browser runtime compatibility, but new callers should use `/api/cart/validate` and `/api/checkout/intent`.

## Server-to-Server API

- `POST /film/stripe-summary`: Film-facing summary-only Stripe aggregate adapter. Requires `Authorization: Bearer <FILM_STRIPE_SUMMARY_ADAPTER_SECRET>`, `dataBoundary: "summary_only"`, `source: "store"`, and mapped refs in `mappedRefs`. Accepted refs are Store order tokens, marketing ref codes, product IDs, variant IDs, SKUs, or item IDs. The response is limited to aggregate money/count fields, mapped-ref/order counts, status, generated timestamp, and currency; it does not return customer emails, payment intent IDs, charge IDs, balance transaction IDs, or card/payment-method data.

The Film summary adapter uses the shared admin order read model and `admin-store-orders:index:v2` when fresh. A cold request may still build that index with a bounded `orders:` scan, but warm reads avoid repeated KV namespace listings while preserving the summary-only response boundary and non-PII watermark contract.

## Admin API

Browser admin mutations use the `store_admin_session` cookie plus `x-store-admin-csrf`.

- Auth/session: `POST /admin/auth/start`, `POST /admin/auth/exchange`, `GET /admin/session`, `POST /admin/logout`.
- Settings/media/users: `GET /admin/settings`, `POST /admin/settings/preview`, `POST /admin/settings/publish`, `POST /admin/settings/logo-upload`, `POST /admin/settings/image-upload`, `POST /admin/settings/audio-upload`, `POST /admin/settings/video-upload`, `POST /admin/users`.
- Readiness/diagnostics: `GET /admin/dashboard/summary`, `GET /admin/store/health`, `GET /admin/plan-usage`, `GET /admin/audit.csv`, `GET /admin/cron/status`, `GET /admin/observability/webhooks`, `GET /admin/observability/performance`.
- Orders: `GET /admin/store/orders`, `GET /admin/store/orders.csv`, `GET /admin/store/attendees.csv`, `GET /admin/store/reconciliation.csv`, `POST /admin/store/orders/import-snipcart`, `POST /admin/store/orders/download-access`, `POST /admin/store/orders/check-in`.
- Products/media: `GET /admin/store/products`, `GET /admin/store/products/media`, `GET /admin/store/products/address-lookup`, `POST /admin/store/products/preview`, `POST /admin/store/products/publish`, `POST /admin/store/products/bulk-publish`, `POST /admin/store/products/order`.
- Coupons: `GET /admin/store/coupons`, `POST /admin/store/coupons`, `POST /admin/store/coupons/delete`.
- Downloads: `GET /admin/store/downloads`, `POST /admin/store/downloads/create`, `POST /admin/store/downloads/upload`, `POST /admin/store/downloads/delete`.
- Inventory/add-ons: `GET /admin/store/inventory`, `POST /admin/store/inventory`, `GET /admin/add-ons/inventory`, `POST /admin/add-ons/inventory`.
- Marketing: `GET|POST|DELETE /admin/store/marketing/referrals`, `GET|POST|DELETE /admin/store/marketing/draft`, `GET /admin/store/marketing/abandoned-checkout/health`, `POST|DELETE /admin/store/marketing/abandoned-checkout/suppression`.
- Maintenance: `POST /admin/rebuild`.

Some maintenance/observability routes also accept the configured admin recovery secret. Browser dashboard routes should prefer the session/CSRF path.

## Workers Cache

Wrangler config keeps the default Worker gateway uncached and enables cache only for `CachedAdminStoreReads`. This requires Wrangler `4.107+` and `compatibility_date = "2026-07-09"`.

Authenticated cache flow:

1. The browser calls `GET /admin/store/orders` with the normal admin session cookie.
2. The gateway authenticates the session and role/scope first.
3. Eligible reads call `ctx.exports.CachedAdminStoreReads` with a canonical internal request and minimal route/role/scope props.
4. The inner response uses the route policy: Orders `max-age=15` without stale serving; Analytics `max-age=60, stale-while-revalidate=120`; inventory `max-age=15`; downloads `max-age=30`.
5. The gateway returns a browser-facing `private, no-store` response with the authenticated user restored.

Orders accepts validated `since` and `watermark` values. A matching first-page non-search refresh returns `unchanged: true` without order/customer rows, and the browser retains its existing in-memory payload. Order payloads are never persisted to browser storage. Free-text `q` searches bypass Workers Cache.

`WORKERS_CACHE_ENABLED` / `cache.workers_enabled` is the global kill switch. Route switches are `WORKERS_CACHE_ADMIN_ORDERS_ENABLED`, `WORKERS_CACHE_ADMIN_ANALYTICS_ENABLED`, `WORKERS_CACHE_ADMIN_INVENTORY_ENABLED`, and `WORKERS_CACHE_ADMIN_DOWNLOADS_ENABLED`. Orders is enabled by default; the other routes are implemented but default off until real-edge benchmark evidence passes. `WORKERS_CACHE_TELEMETRY_ENABLED` independently controls the sanitized `STORE_CACHE_METRICS` Analytics Engine data point written after eligible gateway reads. Re-enable a route only after a purge or deploy/version change.

Mutation invalidation maps low-cardinality `orders`, `order-index`, `analytics`, `inventory`, `products`, `downloads`, and `marketing` domains to cache tags. Purge failure never fails the underlying mutation; it writes only a bounded seven-day `workers-cache-purge-failure:recent` diagnostic. Super-admin and deploy-secret purges clear all known route tags. The default versioned cache key remains in place; `cross_version_cache` stays off.

Every cached inner fetch is an additional billed Workers request, including hits. `writeBudget` and the benchmark harness distinguish that request from avoided order KV list/get and R2 list/head work. Analytics Engine adds one asynchronous data-point write per eligible read but avoids per-hit KV counters. Use labeled disabled/enabled `npm run cache:benchmark` runs plus `npm run cache:compare` for metadata-only latency/status evidence; never persist response bodies, cookies, or tokens.

`POST /admin/workers-cache/evidence` is the scheduled read-only probe. It accepts only `WORKERS_CACHE_EVIDENCE_SECRET`, is rate-limited, performs three fixed Orders reads (full, no-change warmup, and identical no-change repeat), and returns cache status, timing, response-size, unchanged state, and operation budgets without Store rows. It cannot purge, change settings, or call checkout/fulfillment/provider mutations. `.github/workflows/workers-cache-evidence.yml` queries `store_workers_cache_metrics` nightly and calls this probe only under its configured cache-read traffic ceiling.

## Secrets

Production-required Worker secrets:

- `STRIPE_SECRET_KEY` or mode-specific `STRIPE_SECRET_KEY_LIVE`.
- `STRIPE_WEBHOOK_SECRET` or mode-specific `STRIPE_WEBHOOK_SECRET_LIVE`.
- `ADMIN_SECRET`.
- `ADMIN_SESSION_SECRET`.
- `CHECKOUT_INTENT_SECRET`.
- `MAGIC_LINK_SECRET`.
- `RESEND_API_KEY`.
- `TURNSTILE_SECRET_KEY` when admin Turnstile is required.

Operationally important optional secrets:

- `FILM_STRIPE_SUMMARY_ADAPTER_SECRET`: shared bearer secret for Film summary-only aggregate reads through `/film/stripe-summary`.
- `STORE_DOWNLOAD_SECRET`: dedicated signed download/fulfillment secret.
- `WORKERS_CACHE_PURGE_SECRET`: dedicated bearer secret for deploy-time Workers Cache purges. Store the same value as a Cloudflare Worker secret and a GitHub repository secret.
- `WORKERS_CACHE_EVIDENCE_SECRET`: dedicated bearer secret for the read-only scheduled cache probe. Store the same value as a Cloudflare Worker secret and GitHub `production-observability` secret; do not reuse the purge or admin secret.
- `STORE_ORDER_LOOKUP_SECRET`: dedicated customer lookup-token secret.
- `ABANDONED_CART_TOKEN_SECRET`: dedicated reminder resume/unsubscribe secret.
- `ADMIN_TURNSTILE_SECRET_KEY`: admin-specific Turnstile secret.
- `STORE_ORDER_TURNSTILE_SECRET_KEY`: order-lookup-specific Turnstile secret.
- `USPS_CLIENT_SECRET`: required for live USPS quotes when `USPS_ENABLED=true`.
- `ZIP_TAX_API_KEY`: required only when `TAX_PROVIDER=zip_tax`.
- `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_REF`, `GITHUB_WORKFLOW`, and `GITHUB_MEDIA_OPTIMIZATION_WORKFLOW`: production admin publish/rebuild/media workflow integration. Set owner/repo/ref explicitly; do not rely on legacy helper fallbacks.
- `CLOUDFLARE_USAGE_API_TOKEN` or `CLOUDFLARE_ANALYTICS_API_TOKEN`: read-only Cloudflare GraphQL/Analytics Engine access for plan usage, cache evidence, and recovery traffic preflight. Keep it separate from the deploy token where possible.
- `STORE_BACKUP_ENCRYPTION_RECIPIENT`, `STORE_BACKUP_AGE_IDENTITY`, and a fresh `STORE_BACKUP_ADMIN_LOGIN_TOKEN`: approval-gated quarterly captured-data drill inputs. Use a dedicated recovery identity and never treat the one-time admin token as a reusable scheduled credential.
- `ADMIN_LOCAL_REPO_TOKEN`: optional local sidecar bearer token; falls back to `ADMIN_SECRET` in local dev.

Local secrets belong in ignored `worker/.dev.vars`; production secrets belong in Cloudflare Worker secrets or GitHub repository secrets for deploy-only credentials.

## Store Checkout Flow

1. Browser validates cart state with `/api/cart/validate`.
2. Browser starts checkout with `/api/checkout/intent`.
3. Worker validates IDs, SKUs, variants, prices, coupon, tip, inventory metadata, shipping metadata, tax categories, and fulfillment metadata against the generated catalog.
4. Worker creates `orders:<orderToken>` in `STORE_STATE`.
5. Positive-count SKUs reserve through `STORE_INVENTORY_COORDINATOR`.
6. Paid orders receive a Stripe PaymentIntent client secret; free RSVP/free orders confirm immediately.
7. Stripe webhook confirms or fails paid orders after signature, amount, currency, PaymentIntent, and stored-hash validation.
8. Success commits inventory, stores the confirmed order, indexes order lookup, queues email/reminder work, and enables fulfillment actions.
9. Failure releases inventory reservations and records the private failure state.

Payment setup, settlement, reconciliation, and Stripe operations are documented in [Payment Processor](../docs/PAYMENT_PROCESSOR.md).

## Ethical Risk Guardrails

Worker changes that collect or expose customer/admin data, send email, create reminders, alter access, add analytics, automate decisions, or mint new signed links should follow the repository [ethical risk review](../docs/ETHICAL_RISK.md).

Keep the Worker posture conservative:

- validate and canonicalize money, access, fulfillment, and inventory server-side
- minimize stored data and keep sensitive responses private/no-store
- preserve consent and suppression for reminder/marketing contact
- scope, expire, and audit tokenized order, lookup, download, ticket, check-in, and admin links
- add tests or release evidence for abuse cases such as tampered carts, leaked tokens, duplicate sends, export misuse, and unauthorized admin scope expansion

## Scheduled Work

`worker/wrangler.toml` runs a minute cron. The handler records a bounded heartbeat, processes opted-in abandoned-checkout reminders, sends due event reminders, and records recent error state in `STORE_STATE`. Queue-state markers keep idle cron ticks cheap.

## Release Evidence And Dry Runs

Worker-backed release evidence is split by risk:

- `npm run release:fulfillment-evidence` runs the Worker in process with mock KV/R2 data to verify signed downloads, revoke/refresh behavior, ticket/RSVP check-in, and admin CSV exports without external providers.
- `npm run release:providers` is read-only and can use shell credentials, authenticated `gh`/`wrangler`/`stripe` CLIs, or `worker/.dev.vars` defaults unless `--no-dev-vars` is passed.
- `npm run release:payment-smoke` runs payment contract checks. With `PAYMENT_SMOKE_ALLOW_MUTATION=1 -- --direct-webhook`, it targets only a local/non-production Worker, signs local Stripe webhook events, and verifies Store settlement.
- `npm run backup:plan` dry-runs the backup/restore snapshot plan without writing artifacts or calling provider CLIs.
- `npm run backup:snapshot` writes a checksum-verified v2 manifest, canonical classification, isolated build evidence, and restore plan. Sensitive `--kv-values`, `--r2-objects`, or `--admin-exports` capture requires explicit acknowledgement and an age/GPG recipient outside the repository.
- `npm run restore:plan -- --snapshot <dir>` verifies and plans only; provider writes require `--execute --conflict=overwrite` and target-specific gates.
- `npm run restore:rehearse` runs the synthetic checksum/quarantine/derived-repair drill against the Podman-backed stack.

Set `STORE_EMAIL_DRY_RUN=true` or `RESEND_EMAIL_DRY_RUN=true` on the target Worker when running the direct payment matrix. The Worker records email delivery markers so release smoke can prove customer/admin order emails would render without calling Resend.

Production Worker deploys normally run through the manual **Deploy Production** GitHub Actions workflow after release approval. Merging to `main` or pushing a release tag does not deploy by itself.

## Config Sync

Run this after `_config.yml`, `_config.local.yml`, `_products/`, shipping, tax, pricing, URL, add-on, marketing, or design settings change:

```bash
npm run sync:worker-config
```

That regenerates `worker/wrangler.toml` vars and `worker/src/generated/catalog-snapshot.js`.

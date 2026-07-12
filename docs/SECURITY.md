# Store Security Guide

Since `v1.0.4`, Store-owned order email replaces Stripe receipts, confirmed digital download entitlements are durable unless revoked, signed links remain short-lived/private/no-store, super-admin order notifications reuse the transactional email pipeline without ticket/QR attachments, and admin dashboard navigation persistence stores only sanitized non-sensitive tab state in browser storage.

This document covers the active Store security model: static product pages, first-party cart runtime, Cloudflare Worker checkout APIs, Stripe, USPS/NM GRT integrations, Resend email, signed downloads, inventory, and the private admin dashboard.

This guide describes the current Store security model for production. Historical imported compatibility paths should be removed or kept returning `404`; do not preserve old non-Store behavior as a security workaround.

## Trust Boundaries

- The static Jekyll site is public and untrusted by the Worker.
- The Worker is authoritative for cart validation, checkout totals, tax, shipping, inventory reservations, order state, fulfillment actions, admin mutations, and email dispatch.
- Stripe is authoritative for paid settlement only after webhook signature verification.
- Cloudflare KV stores operational records and session state; Durable Objects coordinate race-sensitive checkout/inventory work; R2 stores private digital download objects.
- GitHub-backed catalog/admin publishing paths are admin-only and normalized server-side before commit.

## Ethical Risk And User Trust

Security controls are also harm controls. New features that collect data, change access, send messages, publish content, expose analytics, automate decisions, or create new tokenized routes must run the [ethical risk review](ETHICAL_RISK.md) alongside the normal security review.

Default posture:

- collect and retain only the data needed for checkout, fulfillment, tax, support, fraud prevention, and operations
- keep customer-facing behavior explicit in copy, consent, status text, and errors
- keep reminders, referrals, lookup, download, ticket, and admin links scoped, expiring where appropriate, private/no-store, and suppressible where they contact users
- threat-model misuse by outsiders, compromised admins, forwarded emails, leaked exports, automated scraping, and malicious product/media uploads
- record mitigations through tests, audit events, release evidence, or operator sign-off when automation cannot prove the risk is controlled

## Authentication And Secrets

| Mechanism | Surface | Notes |
| --- | --- | --- |
| Stripe webhook signature | `/webhooks/stripe` | Fails closed when the webhook secret is absent or invalid. |
| Checkout intent nonce | `/api/checkout/intent` | Signed server-side intent for first-party checkout continuation. |
| Admin magic link | `/admin/auth/*` | One-time login nonce, signed admin session cookie, and CSRF on mutations. |
| Super-admin order CTA | Order notification email | Reuses the admin one-time login nonce with `tab=store-orders`; only generated for effective super admins, expires after 5 minutes, and creates a 30-minute admin session. |
| Admin CSRF | `x-store-admin-csrf` | Required for dashboard writes. |
| Admin roles/scopes | Admin APIs | `super_admin` plus Store access scopes for limited admins. |
| Admin session review | `/admin/sessions*` | Super-admin-only review/revoke; 30-day metadata excludes full IP, full user agent, and precise location. |
| Optional Turnstile | Admin sign-in | Local/test bypasses are accepted only in local/test mode. The browser loads the challenge only after an existing admin session is rejected, while magic-link requests still require a valid challenge token. |
| API/admin recovery secrets | Operator routes | Bearer/header secrets stay in Worker secrets or ignored local files. |
| Cache evidence secret | `POST /admin/workers-cache/evidence` | Dedicated read-only bearer; returns bounded metrics only and cannot purge or expose Store rows. |
| Download abuse lock | Signed download routes | Ten failures per order plus keyed network fingerprint in 15 minutes cause a 30-minute soft lock. |

Secret storage rules:

- Local development secrets belong in ignored `worker/.dev.vars`.
- Production Worker secrets belong in Cloudflare Worker secrets via `wrangler secret put`.
- GitHub repository secrets are for CI/deploy/operator workflows only; they are not runtime Worker secrets.
- `WORKERS_CACHE_PURGE_SECRET` and `WORKERS_CACHE_EVIDENCE_SECRET` are narrow exceptions that must be present in both Worker and GitHub secrets with matching values. The purge secret authorizes reviewed tag targets after deploy; the evidence secret authorizes only the fixed read-only metrics probe.
- A path-scoped Cloudflare Cache Response Rule for `/admin/` and `/es/admin/` sets `private, no-store, no-transform, max-age=0, must-revalidate`, preventing Cloudflare JavaScript Detection and automatic Web Analytics injection without allowing inline scripts. Deploy and provider evidence verify the effective public headers and absence of injected script markers without privileged credentials; the optional API reconciliation command requires a separate Cache Rules Edit token and never replaces unrelated zone rules.
- `_config.yml`, product markdown, and admin-published settings must never contain Stripe, Resend, USPS, ZIP.TAX, Cloudflare, GitHub, or admin session secrets.
- The admin dashboard may show configured/missing status for credentials, but must not expose, edit, serialize, or publish secret values.
- One-time admin login tokens used by recovery automation must be created immediately before an approved run and removed from GitHub after use or expiry. A configured secret name is not proof that the short-lived token is still valid.

GitHub Actions supply-chain rules:

- Declare `GITHUB_TOKEN` permissions explicitly in every workflow. Read-only workflows use `contents: read`; write, Pages, issue, pull-request, and OIDC permissions belong only to the job that requires them.
- Pin every external action to a full 40-character commit SHA. Keep the human-readable release in a trailing comment and let Dependabot propose reviewed SHA updates.
- Do not use `pull_request_target` for build/test execution, and do not expose production secrets to pull-request jobs. Merge Smoke uses synthetic credentials and read-only repository access.
- Keep production mutation workflows manual or protected by reviewed environments, narrow concurrency, explicit secrets, and fail-closed preflight checks.

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
| `workers-cache-purge-failure:recent` | KV | Failure-only cache domains/status/error with seven-day TTL | Low |
| `store_workers_cache_metrics` | Analytics Engine | Route/status/bypass, latency, response size, and expected operation counts | Low |
| `rl:{endpoint}:{ip}` | KV | Rate-limit counters | Low |

The complete backup/restore classification, including quarantine and idempotency handling, lives in `config/store-data-inventory.json` and is checked by `npm run backup:inventory:audit`.

Rate-limit counters are shared through `RATELIMIT` KV and protected by a short-lived per-key queue within each Worker isolate, preventing concurrent requests handled by that isolate from overwriting one another's increments. Protected routes fail closed when the binding or counter operation is unavailable. KV is still not a globally atomic abuse ledger; use Cloudflare edge/WAF controls as an additional production layer for distributed attacks.

Operator backup/cache clients accept one-time admin tokens only through environment variables, require HTTPS except for loopback development, require an origin-only Worker base, and reject normalized paths outside `/admin/`. Sensitive snapshot destinations are checked through existing filesystem ancestors to reject repository symlink targets, while checksum verification rejects unlisted files and symbolic links before restore planning.

Durable Object inventory recovery is restricted to browser-authenticated super admins with CSRF. Its short-lived plan fingerprints confirmed-order inventory, current coordinator state/reservations, and a fresh bounded read-only Stripe comparison; a different super admin must approve, the requester must execute, and incomplete/mismatched provider evidence blocks replacement. Audit/response evidence is aggregate-only, and the operation has no Stripe write path.

Recovery workflows separate trust levels. Weekly CI handles synthetic data and sanitized provider metadata only. The quarterly captured-data path is disabled by default, requires a Worker-wide low-traffic/error preflight, shares deployment concurrency, waits on the protected `production-recovery` environment, uses a dedicated recovery age identity plus a fresh one-time super-admin token, requires a restricted live Stripe read key and verified off-account S3 copy, and hard-codes preview restore. It reads every restored KV value/R2 checksum back, then deletes only snapshot-owned preview data and verifies zero residuals; a failure trap retries cleanup after partial restore. Plaintext snapshot/decryption files and detailed restore/verification output stay in private temporary storage and are removed on exit; only aggregate reconciliation/drill evidence, the sanitized receipt, and the encrypted archive may become GitHub artifacts. No workflow can invoke the production restore acknowledgement.

Provider probes are noninteractive. Stripe CLI fallback reads require a successful captured `stripe whoami` preflight; signed-out CLIs are skipped without invoking an endpoint command. Readiness, setup, and backup code expose only fixed failure categories and must never copy CLI identity, pairing codes, authentication URLs, or raw authentication output into console logs, manifests, receipts, or artifacts.

Sensitive responses should use `Cache-Control: private, no-store`. Tokenized order/download/admin routes must not be indexed or placed in the sitemap.

Workers Cache rule:

- The default Worker gateway entrypoint remains uncached so auth, CSRF, role/scope checks, rate limits, route dispatch, and mutations always run.
- Only routes in the reviewed `CachedAdminStoreReads` policy registry may emit cacheable inner responses: Orders, Analytics, inventory, and download readiness. Every route defaults off; production evidence must justify the additional billed inner Worker request before a route is enabled.
- The gateway authenticates the admin before calling the cached entrypoint and sends only props version, route, role, normalized scope key, and Store access scope. Do not key cached data on cookies, authorization/CSRF values, identity, search text, order tokens, or signed capabilities.
- Browser-facing admin responses stay `private, no-store` even when the inner Workers Cache response is public-cacheable.
- Free-text admin Orders searches bypass Workers Cache because `q` may contain customer PII or order tokens.
- Cache tags stay low-cardinality and non-PII. The dependency map is limited to reviewed route/version plus `orders`, `order-index`, `analytics`, `inventory`, `products`, `downloads`, and `marketing` domains.
- Purge requests require trusted internal props and originate from centralized mutation boundaries. A purge failure does not roll back a successful write; only a bounded, seven-day, non-PII failure row is stored.
- External purge requests are limited to `POST /admin/workers-cache/purge` and require either a super-admin session with CSRF or the dedicated `WORKERS_CACHE_PURGE_SECRET`; callers cannot submit arbitrary cache tags.
- Scheduled evidence is limited to `POST /admin/workers-cache/evidence`, requires `WORKERS_CACHE_EVIDENCE_SECRET`, and is rate-limited before it performs three fixed Orders reads: full, no-change warmup, and an identical no-change repeat. The response excludes Store rows, identities, order tokens, URLs, query strings, cookies, credentials, and response bodies; the credential cannot purge or change cache switches.
- `STORE_CACHE_METRICS` receives one bounded Analytics Engine point after an eligible authenticated gateway read when telemetry is enabled. Its schema is fixed to route, cache status/bypass, enabled state, latency, response bytes, and expected Workers/KV/R2/provider operations. Analytics Engine replaces per-hit KV counters and can be disabled independently with `WORKERS_CACHE_TELEMETRY_ENABLED=false`.
- Aggregate cache evidence is scoped to the current deployment and stores only deployment age/timestamps, sample counts, weighted latency/status totals, and operation budgets. Deployment IDs, authors, request identities, cache keys, query strings, and response bodies are excluded.
- `WORKERS_CACHE_ENABLED` is the global runtime kill switch, route switches can bypass immediately, and `cross_version_cache` remains off so deploy versions do not share entries.
- Browser refresh watermarks are deterministic hashes only. Order payloads and customer PII remain in memory and are never added to `localStorage` or `sessionStorage`.

Browser storage:

- `store-admin-dashboard-state:v1` may persist the last selected admin tab and Settings section index in `localStorage`.
- The stored values are sanitized client-side, contain no customer/order/session/CSRF data, and are ignored when a requested tab is not visible for the authenticated admin role.
- Explicit `tab=` deep links, including authenticated super-admin order notification links, take precedence over the stored tab.

Admin order notification links are bearer links. They are consumed on first successful exchange, so a second browser cannot reuse the same link after it has been opened, and the notification-specific link/session TTLs reduce the forwarded-email window. A recipient who receives an unused forwarded email can still authenticate until the link is consumed or expires; the stricter alternative is to remove authenticated CTAs from notification emails and require an existing admin session or a fresh admin magic-link request.

## Checkout And Cart Integrity

The browser cart is convenience state only. The Worker recalculates and validates:

- product identifiers, SKUs, variants, quantities, and unit prices from the generated Store catalog
- coupon code validity, eligibility, status, date windows, and discount amount
- tax category and NM GRT destination handling, with shared two-letter country and bounded postal-code validation before provider access
- shipping presets, USPS quote/fallback behavior, non-shippable product handling, and the same provider-bound country/postal allowlist
- tip/platform fee policy
- inventory availability and reservation ownership
- free-order versus paid PaymentIntent behavior

Tampered carts must fail closed with `422` before Stripe work begins. Paid Store orders become confirmed only through a valid Stripe `payment_intent.succeeded` webhook whose metadata and order hash match the stored draft. Failed/canceled payments release reservations.

For the payment processor setup and settlement model, see [PAYMENT_PROCESSOR.md](PAYMENT_PROCESSOR.md).

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
- Download failure records use a keyed network fingerprint in `RATELIMIT`, not a raw address. Aggregate per-order diagnostics contain counts and timestamps only; signed URLs and token values are never recorded.
- Order lookup requests return a generic response, email short-lived one-time tokens only when matching orders exist, and consume each token before returning order links.
- Signed links should be short-lived and private/no-store, while confirmed digital entitlements remain permanent unless revoked.
- Production operation requires real `STORE_DOWNLOADS` objects for all active digital products, or an approved Worker-only fallback URL for externally hosted media.

## Admin Dashboard

Admin writes use a single server-side normalization boundary before touching GitHub-backed files or KV.

Super-admin session revocation requires an authenticated session, trusted origin, CSRF token, exact non-secret session hash, and audit event. Searchable audit JSON and filtered CSV expose an explicit redacted field set rather than arbitrary event payloads. The scheduled Production Posture workflow reads secret names/config/provider evidence only and may create a sanitized GitHub issue; it never writes Worker settings, secrets, customer data, or provider state.

Required protections:

- valid admin session cookie
- `x-store-admin-csrf` for mutations
- role/scope checks for Store orders, products, coupons, downloads, inventory, marketing, settings, and user management
- server-side allowlists for publishable fields
- strict media upload validation for type, size, destination, filename, and path traversal
- no inline scripts in the static admin shell
- restrictive admin CSP and no public social/structured metadata
- no `unsafe-eval`, `eval`, string-built `Function`, or string-based timer execution in first-party admin scripts
- runtime admin users stored in KV, not `_config.yml`
- local dashboard navigation persistence limited to non-sensitive tab identifiers
- Workers Cache use limited to authenticated, normalized, non-search read paths with private/no-store browser responses

Limited admins should see only the Store surfaces allowed by their access scopes. Super admins retain settings and user-management access.

Do not weaken the admin CSP to silence browser-extension diagnostics. Reproduce CSP findings in an extension-free browser, inspect the main document response for an actual `Content-Security-Policy-Report-Only` header, and identify the violating script origin first. Privacy and consent extensions may inject AutoConsent code that probes or attempts to bypass page CSPs; those extension-origin attempts should remain blocked.

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

Human review should also reject misleading availability, pricing, policy, event-access, or fulfillment claims; deceptive impersonation; and product/media content that enables harassment, fraud, hate, or other criminal misuse. The automated content audit catches unsafe markup, but it cannot judge every truthfulness or abuse risk.

## Public Runtime Boundaries

- Intent prefetching is limited to public Store document routes.
- Admin, checkout, API, Worker, tokenized, order lookup, Order Success, and sensitive query routes are blocked from prefetch.
- Cart recovery is limited to cart, checkout, and Order Success flows.
- Abandoned-checkout resume/unsubscribe links are signed, scoped, expiring URLs and should not be crawled or logged with tokens intact.
- `robots.txt` disallows admin and API routes.
- Order lookup and Order Success routes are not listed in `robots.txt`; their HTML stays crawlable only so crawlers can observe `noindex,nofollow`, and they remain out of the sitemap.
- `sitemap.xml` includes public active/sold-out product URLs and excludes admin, archived/private products, tokenized routes, and private pages.

## Verification

Core local checks:

```bash
npm run test:secrets
npm run test:content-security
npm audit
npm audit --prefix worker
npm run test:unit:coverage
npm run test:security
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh
PLAYWRIGHT_EXTERNAL_SERVER=1 CI=1 npx playwright test --project=chromium --workers=1
```

For production smoke, also complete a real Stripe test checkout for each fulfillment class:

- physical paid product with tax and shipping
- digital paid product with signed download
- ticket paid product with admin check-in
- free RSVP/free-order path

## Production Preconditions

- Real inventory baselines must be entered for finite-stock active products; unlimited or made-to-order products must use `inventory_tracking: false`.
- Active digital products must have either real `STORE_DOWNLOADS` objects or Worker-only fallback URLs.
- Production Worker secrets must be configured in Cloudflare, not copied from local dev.
- Stripe webhook endpoint and signing secret must be configured for the production Worker domain.
- USPS and NM GRT credentials/settings must be verified against the production origin address.
- Admin bootstrap users and limited scopes must be reviewed before deployment.

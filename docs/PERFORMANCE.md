# Performance

Store performance depends on static public pages, lazy cart loading, generated media derivatives, compact Worker payloads, and bounded admin reads.

## Current Baseline

- Public pages remain statically rendered and cart runtime loading remains lazy.
- Store order-derived reads share `admin-store-orders:index:v2`, including a deterministic non-PII watermark. Orders, Analytics, inventory sold counts, Film summaries, dashboard totals, and exports no longer require parallel order namespace scans.
- Admin Orders can use Cloudflare Workers Cache through `CachedAdminStoreReads`; Analytics, inventory, and download readiness use the same policy entrypoint but remain off by default pending real-edge evidence.
- Admin login no longer requests and discards `/admin/dashboard/summary`.
- Order Success adds totals and fulfillment details without adding new public bundle dependencies.
- Spanish public shells share the English page includes and runtime message payloads; they do not duplicate product rendering or add locale-specific bundles.
- Admin dashboard tab restoration reads and writes one small sanitized `localStorage` object only when an admin tab or Settings section changes; it does not add network calls or polling.
- Active-session and audit-review rendering lives in `admin-settings-review.js`, loaded only when a super admin opens either Settings section. It reuses the dashboard's request/format/i18n helpers and does not duplicate authentication or state ownership.
- Generated assets are verified with `npm run assets:minify:check` after build.
- `config/performance-budgets.json` now owns generated JS/CSS, Lighthouse category/Web Vital/resource, dashboard timing, Worker-route, and cache-policy budgets.
- The minified core admin dashboard must remain at or below 320,000 bytes; the lazy session/audit review module has its own 30,000-byte ceiling and still counts toward the aggregate generated-JavaScript budget.
- The local mobile Lighthouse hard gate requires at least 0.80 performance, 0.95 accessibility/SEO, 0.90 best practices, no more than 4,000 ms LCP, 0.10 CLS, 300 ms TBT, 1 MB total transfer, 300 KB images, 100 KB stylesheets, and 75 KB third-party transfer. This is a regression ceiling, not a claim that 4-second LCP is the desired production percentile; the external Adobe project should use [`font-display: optional` or `fallback`](https://helpx.adobe.com/fonts/using/font-display-settings.html) when the operator can update that licensed kit.
- Public `main.css` excludes the roughly 5,000-line admin stylesheet; `/admin/` loads `admin.css` separately. Inter is a licensed local WOFF2 subset, while Adobe display CSS loads without blocking first render.
- Home pages preload the responsive candidate set for the first visible catalog product. The preload and rendered grid share the same public active/sold-out visibility predicate and `local_responsive_image_srcset`, so environment changes, product reordering, and media customization cannot silently expose private/archive records or leave a hard-coded LCP resource behind.

## Public Site

- Product pages are statically rendered by Jekyll.
- Public cart runtime loads lazily.
- Product images should use optimized source files and responsive derivatives.
- Generated CSS/JS should stay minified.

Checks:

```bash
npm run build
npm run test:seo
npm run media:optimize:check
npm run assets:minify:check
npm run test:performance:budgets
npm run test:performance:lighthouse
npm run test:cache-policy
```

## Worker

- Cart validation uses the generated catalog snapshot.
- Checkout writes compact order drafts.
- Inventory reads use SKU-level projections and overrides.
- Admin order/product/download/inventory views are explicit reads, not background polling.
- Scheduled work is limited to bounded heartbeat writes, opted-in abandoned-checkout reminders, due event reminders, and recent error/observability summaries.
- Queue-state markers avoid scanning reminder prefixes when cron has no known pending work.

### Workers Cache

The default Worker entrypoint stays uncached. Authentication, role/scope checks, CSRF checks, rate limits, route dispatch, mutations, checkout, webhooks, tokenized order routes, signed downloads, shipping, and tax all continue to execute through the gateway and return private/no-store responses where appropriate.

The `CachedAdminStoreReads` policy registry owns canonical paths/query fields, non-PII props, route flags, TTLs, tags, and purge dependencies:

| Route | TTL | Default | Backend work avoided on hit |
| --- | --- | --- | --- |
| `/admin/store/orders` | `max-age=15`, no stale serving | disabled after failed benefit gate | order-index KV read or cold order list/get scan |
| `/admin/store/analytics` | `max-age=60, stale-while-revalidate=120` | disabled | order snapshot and referral-label KV reads |
| `/admin/store/inventory` | `max-age=15`, no stale serving | disabled | order snapshot/list/get work |
| `/admin/store/downloads` | `max-age=30`, no stale serving | disabled | R2 list/readiness work |

The gateway authenticates every request, strips credentials/CSRF, and passes only props version, route, normalized role, scope key, and Store access scope. Inner responses are public-cacheable; outer browser responses remain `private, no-store`.

Loopback dispatch specializes the binding before fetching: `ctx.exports.CachedAdminStoreReads({ props }).fetch(request)`. Calling the generic `.fetch()` surface without that factory step does not deliver trusted dynamic `ctx.props`, so the cached entrypoint rejects the request. Tests include the callable-plus-`fetch` binding shape exposed by production Cloudflare.

Orders keys accept only safe filter/page/locale fields plus validated ISO `since` and `orders-v2-<hash>` watermark values. Free-text `q` bypasses Workers Cache because search terms can contain names, email addresses, or order tokens. A matching first-page watermark returns a minimal `unchanged: true` response and leaves the existing PII-bearing payload in memory only.

Performance expectations:

- every `ctx.exports.fetch()` is an additional billed Workers request, including a cache hit; the benefit is avoided inner CPU and backend reads, not a lower request count
- order mutations invalidate Orders, Analytics, and order-derived inventory; inventory, download-library, and referral mutations invalidate their dependent policies
- the materialized v2 order index uses a seven-day safety TTL because every order-changing path explicitly invalidates it; this avoids a measured periodic full-order rescan while retaining bounded recovery from a missed invalidation
- a required index rebuild lists order keys once and reads values through memory-bounded [Workers KV bulk reads](https://developers.cloudflare.com/kv/api/read-key-value-pairs/) of at most 100 keys; the production 417-order shape therefore uses five external KV read operations instead of 417 sequential operations, while `kvReadsExpected` remains per-key because Cloudflare bills a bulk read per key
- a controlled production invalidation reduced the cold Orders rebuild from `53,109 ms` to `1,658 ms` (96.9 percent); the steady-state no-change repeat was a `5 ms` `HIT` with zero order-data KV reads/lists
- the fixed-key `CachedAdminStoreOrderIndex` entrypoint gives all route/filter/watermark variants the same 20-second rebuild key, so an immediate no-change request reuses the first bounded rebuild while the seven-day KV index propagates; a 417-order regression fixture proves the second variant performs zero order-data KV list/get work
- purge failure does not fail a write and records only a bounded failure diagnostic; short TTLs cap stale exposure
- download readiness lists R2 once and derives attached-file readiness from that listing, avoiding duplicate per-file `head` calls when the list is complete
- response metadata and `writeBudget` expose cache status plus expected Workers/KV/R2 operations without adding per-hit KV counters
- the authenticated gateway writes one asynchronous `STORE_CACHE_METRICS` Analytics Engine point per eligible admin read when `WORKERS_CACHE_TELEMETRY_ENABLED=true`; fields are limited to route, cache status/bypass, duration, response bytes, and expected operation counts
- Analytics Engine telemetry adds one data-point write per eligible read and the nightly collector adds one SQL query plus, only below its recent cache-read threshold, a three-read full/no-change-warmup/no-change-repeat evidence probe with one rate-limit KV read/write; it never adds order-store KV counters
- when every optional route is deliberately disabled, a sanitized three-read probe that consistently reports `DISABLED` closes as the conclusive `not_applicable`/`no_enabled_candidates` state; malformed, leaky, over-budget, mismatched-route, or mixed enabled/disabled evidence still fails closed
- `WORKERS_CACHE_EVIDENCE_ROUTE` selects the single route exercised by the scheduled probe and must name the enabled candidate during a sequential experiment
- super-admin and deploy-secret purges clear all known cache domains; deploy/version isolation remains enabled because `cross_version_cache` is off

Sampled Worker observations retain bounded latency histograms and expose approximate p50/p95/p99, max, status counts, and slow routes in Admin -> Runtime diagnostics. The data remains aggregate-only and reuses the existing observability store.

Capture the disabled baseline and enabled candidate separately with a fresh one-time super-admin token supplied only through the environment. Disabled runs do not purge; enabled runs use two bounded purges rather than purging once per sample because every purge writes an audit KV row:

```bash
export STORE_CACHE_SMOKE_ADMIN_LOGIN_TOKEN='<one-time-token>'
npm run cache:benchmark -- \
  --mode=disabled \
  --route=orders \
  --worker-base=https://checkout.example.com \
  --site-base=https://shop.example.com \
  --samples=30 \
  --output=/secure/evidence/workers-cache-disabled.json

# Use a new one-time token after enabling Orders and deploying.
export STORE_CACHE_SMOKE_ADMIN_LOGIN_TOKEN='<fresh-one-time-token>'
npm run cache:benchmark -- \
  --mode=enabled \
  --route=orders \
  --worker-base=https://checkout.example.com \
  --site-base=https://shop.example.com \
  --samples=30 \
  --output=/secure/evidence/workers-cache-enabled.json

npm run cache:compare -- \
  --baseline=/secure/evidence/workers-cache-disabled.json \
  --candidate=/secure/evidence/workers-cache-enabled.json \
  --output=/secure/evidence/workers-cache-comparison.json
```

The evidence files contain timings, byte counts, cache statuses, bypass reasons, and operation budgets, not response bodies or credentials. The comparator requires correctly labeled schema-v2 artifacts, at least 30 repeated samples, zero order-data KV list/get operations on warm/no-change hits, at least 40% p95 improvement, expected search bypasses, and a bounded post-purge refill. Mutation freshness and normal-traffic aggregate hit ratios remain separate production gates. Podman validates the application contract but cannot prove Cloudflare edge behavior.

`.github/workflows/workers-cache-evidence.yml` runs at `03:17 America/Denver` on `main`. It resolves the current Worker deployment, queries only rows since that deployment, and reports weighted p50/p95/p99/min/max plus cache/operation details for the slowest row. Evidence remains `inconclusive` during the configured stability window or when sample count is low, preventing deployments from contaminating a hit-ratio conclusion. It calls `POST /admin/workers-cache/evidence` only when recent cache-read traffic is below the configured threshold. That endpoint requires `WORKERS_CACHE_EVIDENCE_SECRET`, is rate-limited, performs three fixed read-only Orders probes (full, no-change warmup, and identical no-change repeat), and returns metrics only. The scheduled workflow cannot purge or change configuration.

Verify Worker Cache config before deploys that touch cached entrypoints:

```bash
cd worker
npx wrangler --version
npx wrangler deploy --dry-run --env=""
```

Configuration:

- `cache.workers_enabled` / `WORKERS_CACHE_ENABLED`: global kill switch.
- `cache.workers_telemetry_enabled` / `WORKERS_CACHE_TELEMETRY_ENABLED`: sanitized Analytics Engine telemetry switch.
- `cache.workers_admin_*_enabled` / `WORKERS_CACHE_ADMIN_*_ENABLED`: route switches.
- Re-enable after a purge or new Worker version so an old still-fresh response cannot reappear.

### Cache Incident Procedure

1. Preserve the current sanitized benchmark/observability evidence and note the affected route, cache status, deployment version, and last covered mutation. Never capture response bodies, cookies, tokens, cache keys, or customer rows.
2. For a single candidate problem, set its `cache.workers_admin_*_enabled` value to `false`; for uncertain scope, set `cache.workers_enabled: false`. A super-admin may publish the setting, but the runtime change takes effect only after the resulting Worker deployment.
3. Dispatch **Deploy Production**. Deploy, cache evidence, and protected recovery share the `production-operations` concurrency group and cannot overlap.
4. Purge all known entries from the super-admin cache control or the deploy-secret endpoint. Do not send arbitrary tags:

   ```bash
   curl --fail-with-body \
     -X POST https://checkout.example.com/admin/workers-cache/purge \
     -H "Authorization: Bearer ${WORKERS_CACHE_PURGE_SECRET}" \
     -H 'Content-Type: application/json' \
     --data '{"target":"all_known","source":"incident"}'
   ```

5. Verify the affected admin read is fresh, browser-facing headers remain `private, no-store`, cache metadata reports `disabled`, search still bypasses, and the underlying mutation remains present. If the deployment itself is suspect, redeploy the last reviewed commit with caching disabled rather than enabling cross-version sharing.
6. Keep `cross_version_cache=false`. Re-enable one route only after its disabled/enabled comparison, mutation/purge freshness check, and normal-traffic hit/read/CPU evidence pass again; purge immediately after the enabling deployment.

## Prefetch

Public prefetch excludes private or stateful routes, including:

- `/admin`
- `/cart`
- `/checkout`
- `/order-success`
- `/orders`
- `/es/order-success`
- `/es/orders`
- `/api`
- `/worker`

## Media

Run:

```bash
npm run media:optimize
```

Product images should live under `assets/images/products/` when uploaded from admin. Keep source assets in the repo; generated files should be deterministic and smaller than originals.

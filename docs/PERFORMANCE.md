# Performance

Store performance depends on static public pages, lazy cart loading, generated media derivatives, compact Worker payloads, and bounded admin reads.

## Current Baseline

- Public pages remain statically rendered and cart runtime loading remains lazy.
- Store order lookup/admin reads use cached/indexed paths from the current Store mainline.
- Admin Orders list reads can use Cloudflare Workers Cache through the `CachedAdminStoreOrders` inner entrypoint after the gateway authenticates the admin session.
- Order Success adds totals and fulfillment details without adding new public bundle dependencies.
- Spanish public shells share the English page includes and runtime message payloads; they do not duplicate product rendering or add locale-specific bundles.
- Admin dashboard tab restoration reads and writes one small sanitized `localStorage` object only when an admin tab or Settings section changes; it does not add network calls or polling.
- Generated assets are verified with `npm run assets:minify:check` after build.
- Formal route-level budgets and Lighthouse automation remain future work in [ROADMAP.md](ROADMAP.md).

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

`GET /admin/store/orders` can use the named `CachedAdminStoreOrders` entrypoint when `cache.workers_admin_orders_enabled` / `WORKERS_CACHE_ADMIN_ORDERS_ENABLED` is not set to `false`. The gateway authenticates the admin, builds a normalized internal request, strips credentials and CSRF headers, and passes minimal role/scope props with `ctx.exports`. The inner response is cacheable for `public, max-age=20, stale-while-revalidate=40, stale-if-error=0`; the browser-facing response remains `private, no-store`.

Cacheable admin Orders requests include only safe filter/page parameters: `status`, `fulfillment`, `limit`, `cursor`, `lang`, and `locale`. Free-text `q` searches bypass Workers Cache because search terms can contain customer names, email addresses, or order tokens.

Performance expectations:

- repeated no-change Orders reads should avoid repeated Worker CPU/KV index work while the cache entry is fresh
- cache hits still count as Cloudflare Workers requests, but should reduce billed CPU and backend reads
- order mutations call the existing order-index invalidation path, which also purges `admin-orders`, `orders`, `order-index`, and `admin-orders-v1` cache tags when `ctx.cache` is available
- super-admins can clear known Workers Cache entries from Settings -> Runtime diagnostics, and production deploys can call the Worker purge endpoint with `WORKERS_CACHE_PURGE_SECRET`
- short TTLs bound staleness if a purge cannot run, such as from an older helper path without `ctx`
- dashboard responses include `page.cache.workers` metadata and `X-Store-Workers-Cache` / `X-Store-Workers-Cache-Entry` headers for operator diagnostics

Verify Worker Cache config before deploys that touch cached entrypoints:

```bash
cd worker
npx wrangler --version
npx wrangler deploy --dry-run --env=""
```

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

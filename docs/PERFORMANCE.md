# Performance

Store performance depends on static public pages, lazy cart loading, generated media derivatives, compact Worker payloads, and bounded admin reads.

## Release v1.0.4 Audit

- Public pages remain statically rendered and cart runtime loading remains lazy.
- Store order lookup/admin reads use cached/indexed paths from the current Store mainline.
- Order Success adds totals and fulfillment details without adding new public bundle dependencies.
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
npm run assets:minify:check
npm run media:optimize:check
bundle exec jekyll build --quiet
```

## Worker

- Cart validation uses the generated catalog snapshot.
- Checkout writes compact order drafts.
- Inventory reads use SKU-level projections and overrides.
- Admin order/product/download/inventory views are explicit reads, not background polling.
- Scheduled work is limited to bounded heartbeat writes, opted-in abandoned-checkout reminders, due event reminders, and recent error/observability summaries.
- Queue-state markers avoid scanning reminder prefixes when cron has no known pending work.

## Prefetch

Public prefetch excludes private or stateful routes, including:

- `/admin`
- `/cart`
- `/checkout`
- `/order-success`
- `/orders`
- `/api`
- `/worker`

## Media

Run:

```bash
npm run media:optimize
```

Product images should live under `assets/images/products/` when uploaded from admin. Keep source assets in the repo; generated files should be deterministic and smaller than originals.

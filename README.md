# Store

Store is Dust Wave's open-source, static-first commerce layer for products, tickets, RSVPs, and digital downloads. It succeeds [`aindaco1/dust-wave-shop`](https://github.com/aindaco1/dust-wave-shop) and replaces the old Snipcart flow with a first-party cart, Cloudflare Worker checkout API, Stripe PaymentIntents, fulfillment routes, and an admin dashboard.

## Current State

- Release target: `v1.0.6`.
- Static Jekyll storefront: `https://shop.dustwave.xyz`.
- Cloudflare Worker: `https://checkout.dustwave.xyz`.
- Local development defaults: Jekyll on `http://127.0.0.1:4002`, Worker on `http://127.0.0.1:8989`, local repo sidecar on `http://127.0.0.1:8799`.
- Source catalog: 50 `_products/*.md` records at this sweep, with 26 active and 24 archived products across physical merch, event tickets, one digital product, and one free RSVP fixture.
- Current public catalog grouping uses `category: dustwave` and `category: fronteras` as collection-compatible legacy values; the taxonomy include derives product-type categories such as apparel, prints, stickers, downloads, event access, media, and objects.
- Browser cart runtime is Store-owned: `store-add-item`, `STORE_CONFIG`, `StoreCartProvider`, `StoreCartRuntime`, `window.Store`, and `storecart.*` events.
- Worker checkout validates carts through `/api/cart/validate`, creates paid/free order drafts through `/api/checkout/intent`, reserves positive-count SKU inventory through a Durable Object, and settles paid orders only from signed Stripe webhooks.
- Fulfillment includes `/order-success/`, customer order lookup links, signed R2-backed downloads, ticket/RSVP QR SVGs, calendar files, check-in links, Resend receipts, abandoned-checkout reminders, and event reminders.
- Public Spanish shells exist for home, Terms, Orders, and Order Success; product titles/descriptions stay creator-authored unless a product defines localized overrides.
- Admin at `/admin/` and `/es/admin/` manages settings, users/scopes, readiness, plan usage, products, product media, coupons, reusable download files, orders, historical Snipcart imports, download access revoke/refresh, ticket check-in, analytics, referrals, and reminder suppression.
- Authenticated admin Orders uses a shared versioned order read model, no-change watermarks, and an explicitly invalidated seven-day materialized index. Orders, Analytics, inventory, and download readiness support the reviewed `CachedAdminStoreReads` Workers Cache entrypoint but default off after the production Orders comparison failed its latency-benefit gate. Deployment-scoped weighted telemetry, disabled/enabled comparison gates, a scoped nightly probe, kill switches, and the incident runbook support measured rollout.
- Backup and disaster recovery use a canonical Store data inventory, checksum-verified snapshot v2 manifests, complete/chunked encrypted KV/R2 capture, guarded restore planning, read-only Store/Stripe reconciliation, maker/checker Durable Object inventory recovery, preview readback/cleanup, retention/readiness planning, weekly representative Podman drills, and a disabled-by-default protected quarterly workflow with off-account archive gates.
- Production hardening includes centralized asset/Lighthouse/cache budgets, sampled Worker p50/p95/p99 diagnostics, full readiness posture, super-admin session review/revocation, searchable redacted audit records, signed-download soft locks, scheduled configuration drift issues, and source-hashed localization review packets.
- Default operations posture is USPS shipping, New Mexico GRT tax, Stripe payments, Resend email, Cloudflare KV/R2/Durable Objects, GitHub-backed publishing in production, and local sidecar writes in dev.

## Local Development

Host flow:

```bash
npm install
bundle install
./scripts/dev.sh
```

Podman flow:

```bash
npm run podman:doctor
./scripts/dev.sh --podman
```

Useful checks:

```bash
npm run sync:worker-config
bundle exec jekyll build --quiet
npm run test:seo
npm run test:content-security
npm run test:unit
npm run test:security
npm run test:e2e:headless
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh --podman
npm run test:premerge
npm run backup:inventory:audit
npm run backup:readiness
npm run backup:retention -- --root "$HOME/store-backups"
npm run restore:rehearse
npm run recovery:reconcile -- --snapshot /secure/decrypted/store-snapshot --stripe-mode=off
npm run recovery:traffic-preflight -- --maximum-requests=100
```

For release environment setup:

```bash
npm run setup:deploy -- --mode=local
npm run backup:plan
npm run restore:plan -- --snapshot "$HOME/store-backups/<snapshot>"
npm run setup:deploy -- --mode=production --dry-run
npm run release:smoke -- --evidence-file /tmp/store-release-smoke.md
```

## Key Paths

- `_products/` - repo-backed product catalog.
- `api/products.json` and `api/add-ons.json` - static public catalog endpoints.
- `_includes/product-card.html` and `_includes/product-taxonomy.html` - public product markup and derived filters.
- `assets/js/cart-provider.js` - first-party cart, checkout, shipping/tax preview, coupon, add-on, and reminder-consent runtime.
- `assets/js/admin-dashboard.js` - admin dashboard client.
- `worker/src/index.js` - Worker routes, checkout, admin, fulfillment, cron, and observability.
- `worker/src/admin-store-read-model.js`, `worker/src/workers-cache-policy.js`, and `worker/src/workers-cache-telemetry.js` - shared order snapshot, cache policy, and privacy-safe telemetry contracts.
- `worker/src/generated/catalog-snapshot.js` - generated Worker catalog snapshot.
- `worker/src/tier-inventory-do.js` - reservation-aware SKU inventory coordinator.
- `worker/src/coupons.js` - coupon normalization, storage, and discount application.
- `worker/src/local-repo-service.mjs` - local admin publish sidecar for dev.
- `config/store-data-inventory.json` - canonical KV/R2/Durable Object backup and restore classification.
- `scripts/store-backup.mjs`, `scripts/store-restore.mjs`, `scripts/recovery-reconciliation.mjs`, `scripts/backup-readiness.mjs`, and `scripts/backup-retention.mjs` - guarded snapshot, restore/readback/cleanup, reconciliation, readiness, and retention tooling.

## Docs

- [Project overview](docs/PROJECT_OVERVIEW.md)
- [Workflows](docs/WORKFLOWS.md)
- [Admin dashboard](docs/DASHBOARD.md)
- [Worker README](worker/README.md)
- [Payment processor](docs/PAYMENT_PROCESSOR.md)
- [Testing](docs/TESTING.md)
- [Merge smoke checklist](docs/MERGE_SMOKE_CHECKLIST.md)
- [Release evidence](docs/release-evidence/)
- [Ethical risk review](docs/ETHICAL_RISK.md)
- [Security](docs/SECURITY.md)
- [Backup and restore](docs/BACKUP_RESTORE.md)
- [Downloads](docs/DOWNLOADS.md)

## Production Operations

Store is live on the production storefront and Worker domains. Production deploys are manual through **Deploy Production**; merging a release branch or pushing a release tag does not deploy by itself. Deploy, cache evidence, and protected recovery share production concurrency. **Workers Cache Evidence** runs nightly, **Recovery Readiness** and **Production Posture** run weekly, **Localization Review** runs monthly, and **Quarterly Recovery Operations** runs a Worker-wide traffic preflight while keeping captured-data restore disabled until a fresh admin token, restricted live Stripe read key, durable off-account destination, and operator approval are available. A separately located, operator-controlled recovery device or encrypted removable destination is the local-friendly off-device option; S3-compatible storage is optional and AWS is not required. Ongoing production work remains operational: keep provider credentials/accounts current and rerun production smoke/reconciliation after checkout, fulfillment, admin, or catalog changes.

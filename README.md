# Store

Store is Dust Wave's open-source, static-first commerce layer for products, tickets, RSVPs, and digital downloads. It succeeds [`aindaco1/dust-wave-shop`](https://github.com/aindaco1/dust-wave-shop) and replaces the old Snipcart flow with a first-party cart, Cloudflare Worker checkout API, Stripe PaymentIntents, fulfillment routes, and an admin dashboard.

## Current State

- Release target: `v1.0.6`.
- Static Jekyll storefront: `https://shop.dustwave.xyz`.
- Cloudflare Worker: `https://checkout.dustwave.xyz`.
- Local development defaults: Jekyll on `http://127.0.0.1:4002`, Worker on `http://127.0.0.1:8989`, local repo sidecar on `http://127.0.0.1:8799`.
- Source catalog: 49 `_products/*.md` records at this sweep, with 27 active and 22 archived products across physical merch, event tickets, one digital product, and one free RSVP fixture.
- Current public catalog grouping uses `category: dustwave` and `category: fronteras` as collection-compatible legacy values; the taxonomy include derives product-type categories such as apparel, prints, stickers, downloads, event access, media, and objects.
- Browser cart runtime is Store-owned: `store-add-item`, `STORE_CONFIG`, `StoreCartProvider`, `StoreCartRuntime`, `window.Store`, and `storecart.*` events.
- Worker checkout validates carts through `/api/cart/validate`, creates paid/free order drafts through `/api/checkout/intent`, reserves positive-count SKU inventory through a Durable Object, and settles paid orders only from signed Stripe webhooks.
- Fulfillment includes `/order-success/`, customer order lookup links, signed R2-backed downloads, ticket/RSVP QR SVGs, calendar files, check-in links, Resend receipts, abandoned-checkout reminders, and event reminders.
- Public Spanish shells exist for home, Terms, Orders, and Order Success; product titles/descriptions stay creator-authored unless a product defines localized overrides.
- Admin at `/admin/` and `/es/admin/` manages settings, users/scopes, readiness, plan usage, products, product media, coupons, reusable download files, orders, historical Snipcart imports, download access revoke/refresh, ticket check-in, analytics, referrals, and reminder suppression.
- Authenticated admin Orders uses a shared versioned order read model, no-change watermarks, and the `CachedAdminStoreReads` Workers Cache entrypoint. Analytics, inventory, and download readiness use the same reviewed entrypoint but remain disabled by default pending real-edge benchmark evidence.
- Backup and disaster recovery use a canonical Store data inventory, checksum-verified snapshot v2 manifests, encrypted sensitive exports, guarded restore planning, and a Podman-backed synthetic restore drill.
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
npm run restore:rehearse
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
- `worker/src/admin-store-read-model.js` and `worker/src/workers-cache-policy.js` - shared order snapshot and cache policy contracts.
- `worker/src/generated/catalog-snapshot.js` - generated Worker catalog snapshot.
- `worker/src/tier-inventory-do.js` - reservation-aware SKU inventory coordinator.
- `worker/src/coupons.js` - coupon normalization, storage, and discount application.
- `worker/src/local-repo-service.mjs` - local admin publish sidecar for dev.
- `config/store-data-inventory.json` - canonical KV/R2/Durable Object backup and restore classification.
- `scripts/store-backup.mjs` and `scripts/store-restore.mjs` - guarded snapshot and restore tooling.

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

Store is live on the production storefront and Worker domains. Production deploys are manual through the **Deploy Production** GitHub Actions workflow; merging a release branch or pushing a release tag does not deploy by itself. Ongoing production work is operational: keep Cloudflare Worker secrets and external accounts current, verify Stripe webhooks, Resend senders, USPS/NM GRT settings, `STORE_DOWNLOADS` objects, and real inventory baselines, and rerun the production smoke/reconciliation path after checkout, fulfillment, admin, or catalog changes.

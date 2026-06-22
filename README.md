# Store

Store is Dust Wave's open-source, static-first commerce layer for creators and small organizations. This repository is both the successor to [`aindaco1/dust-wave-shop`](https://github.com/aindaco1/dust-wave-shop) and the reusable Store project.

The initial codebase is intentionally extracted from The Pool so Store starts with the hard parts already present: first-party cart runtime, on-site Stripe checkout sidecar, Cloudflare Worker patterns, USPS shipping, NM GRT tax support, Resend emails, magic-link admin auth, dashboard publishing, media optimization, and the existing test harness.

## Current State

- Jekyll storefront at `https://shop.dustwave.xyz`
- Worker deployment target at `https://checkout.dustwave.xyz`
- DUST WAVE products migrated from the old Snipcart shop into `_products/`
- Store authoring markup uses `store-add-item`, Store-first cart roots/events, and Store cart hooks
- Worker validates Store carts through `/api/cart/validate`; Store browser carts create and confirm PaymentIntent/free-order drafts through `/api/checkout/intent`, reserve positive-count SKU inventory, then Stripe webhooks settle paid order records, commit or release inventory, send order emails, expose token-scoped fulfillment actions on `/order-success/`, serve signed R2-backed digital downloads, and power Store admin fulfillment rows, product catalog review/publishing, product image uploads, attendance totals, event breakdowns, attendee export, audit export, order reconciliation export, download readiness checks/uploads, download expiry/reissue, and check-in
- Pages CMS has been removed from the intended editing path; Store admin dashboard extraction replaces it
- USPS and NM GRT remain the default shipping/tax posture
- Product inventory fields are present immediately, including shirt size variants; imported counts are seeded as `0` because the Snipcart shop did not store true inventory counts, and Store admins can now override live baselines from the admin dashboard

## Local Development

```bash
npm run podman:doctor
./scripts/dev.sh --podman
```

For a quick static-only build:

```bash
bundle exec jekyll build --quiet
```

For release environment setup, use the Store-adapted helper ported from The Pool:

```bash
npm run setup:deploy -- --mode=local
npm run setup:deploy -- --mode=production --dry-run
```

## Key Paths

- `_products/` - repo-backed Store catalog and the migrated DUST WAVE products
- `_includes/product-card.html` - Store product markup for the first-party cart runtime
- `assets/js/store-product-options.js` - quantity/variant sync for Store product buttons
- `worker/src/orders.js` - Store order draft normalization, hashing, and storage key helpers
- `worker/` - imported Cloudflare Worker baseline from The Pool
- `docs/BACKUP_RESTORE.md` - backup and restore runbook for KV, R2, and product catalog Git history
- `docs/PRODUCTION_LAUNCH.md` - production launch runbook for Cloudflare, Stripe, Resend, USPS, NM GRT, R2, DNS, smoke tests, and rollback
- `docs/STORE_DOWNLOADS.md` - signed digital download and R2 target notes
- `docs/history/STORE_EXTRACTION.md` - historical extraction log from The Pool baseline
- `docs/history/MIGRATE_FROM_DUST_WAVE_SHOP.md` - historical migration notes from the Snipcart storefront

## Important Gaps

The Store checkout path now reaches the Worker checkout intent endpoint, Stripe PaymentIntent UI, webhook-backed paid order settlement, Store-admin SKU inventory baselines with reserve/commit, Store order emails, customer order lookup links, signed fulfillment routes, R2-backed digital downloads, admin product catalog review/publishing, product image uploads, admin download readiness checks/uploads, admin digital download expiry/reissue, admin fulfillment CSV export, attendance totals/event breakdowns, attendee CSV export, super-admin audit CSV export, order reconciliation CSV export, and ticket/RSVP check-in mutation. Remaining extraction work is uploading the real production download objects and entering the true stock counts in the admin dashboard.

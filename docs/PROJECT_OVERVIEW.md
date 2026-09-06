# Project Overview

Store is Dust Wave's static-first commerce layer for products, tickets, RSVPs, digital downloads, and services. It succeeds `aindaco1/dust-wave-shop` and replaces Snipcart with a first-party cart, Cloudflare Worker API, Stripe checkout, fulfillment, and admin workflow.

Current release: `v1.3.7`. See the [changelog](../CHANGELOG.md) for release changes and [release evidence](release-evidence/) for validation and rollback records. The [roadmap](ROADMAP.md) owns the current capability inventory and future work.

## Architecture

- Jekyll renders the public storefront.
- `_products/` is the catalog source.
- `api/products.json` exposes public product data.
- `api/add-ons.json` exposes optional add-on suggestions.
- `worker/src/generated/catalog-snapshot.js` is the Worker-side catalog snapshot.
- Cloudflare Worker validates carts, creates order drafts, applies coupons, handles Stripe webhooks, serves fulfillment actions, sends email, runs reminder cron tasks, and powers admin.
- KV stores order, admin, inventory override, coupon, lookup, reminder, audit, rate-limit, and observability state.
- R2 stores production digital downloads and reusable download-library files.
- Durable Objects serialize SKU inventory reservations and commit/release transitions.
- `GET /api/store/inventory` exposes a sanitized, briefly cached confirmed-availability projection to inventory-tracked public pages. Static counts remain the failure fallback, and reservation-aware checkout remains authoritative.
- GitHub-backed writes publish `_config.yml`, `_products/*.md`, and product/media assets in production; local dev can use the local repo sidecar instead.

## Shared Foundations and Ownership

Store pins Dust Wave Platform `v0.34.1` at exact commit
`ae380c43a16af352ae946f47dd1b7aa4e5b093f0` and Dust Wave Jekyll Template
`v0.1.0` at exact commit `351281a5aec60fa85653a3d23391e66fb860aae6`.
Platform supplies characterized Worker, admin, browser, design, build, release,
shipping, tax, inventory, media, and test primitives. The Jekyll Template owns
17 manifest-bound source-upgrade files whose runtime copies remain checked in.

Store still owns its catalog and order models, routes, storage, content,
localization, templates, credentials, provider policy, builds, deployment, and
rollback. Neither shared repository follows a moving branch at build time.

Verify the pins and generated/source copies with the [shared-dependency checks](TESTING.md#shared-dependency-checks).

## Source Layout

- `_products/` - repo-backed product catalog.
- `api/products.json` and `api/add-ons.json` - static public catalog endpoints.
- `_includes/product-card.html` and `_includes/product-taxonomy.html` - public product markup and derived filters.
- `assets/js/cart-provider.js` - first-party cart, checkout, shipping/tax preview, coupon, add-on, and reminder-consent runtime.
- `worker/src/event-registration.js` - shared RSVP registration schema normalization, submission validation, and stored snapshot bounds.
- `assets/js/admin-dashboard.js` - admin dashboard client.
- `worker/src/index.js` - Worker routes, checkout, admin, fulfillment, cron, and observability.
- `worker/src/email-outbox.js`, `worker/src/payment-integrity.js`, and `worker/src/store-payment-reconciliation.js` - durable notification delivery and minimized payment/reconciliation evidence.
- `_data/media-optimization-manifest.json` and `worker/src/media-catalog.js` - rebuildable repository media metadata and shared classification/budget rules.
- `worker/src/admin-store-read-model.js`, `worker/src/workers-cache-policy.js`, and `worker/src/workers-cache-telemetry.js` - shared order snapshot, cache policy, and privacy-safe telemetry contracts.
- `worker/src/generated/catalog-snapshot.js` - generated Worker catalog snapshot.
- `assets/js/store-product-options.js` and `worker/src/store-inventory-projection.js` - public product-control synchronization and the sanitized confirmed-availability projection.
- `worker/src/tier-inventory-do.js` - reservation-aware SKU inventory coordinator.
- `worker/src/coupons.js` - coupon normalization, storage, and discount application.
- `worker/src/local-repo-service.mjs` - local admin publish sidecar for dev.
- `config/store-data-inventory.json` - canonical KV/R2/Durable Object backup and restore classification.
- `scripts/store-backup.mjs`, `scripts/store-restore.mjs`, `scripts/recovery-reconciliation.mjs`, `scripts/backup-readiness.mjs`, and `scripts/backup-retention.mjs` - guarded snapshot, restore/readback/cleanup, reconciliation, readiness, and retention tooling.
- `_config.yml`, `_config.local.yml`, and `_data/i18n/` - canonical settings, machine-local overrides, and shared translated copy.
- `es/` and `_includes/storefront-home.html` - Spanish page shells and shared English/Spanish home rendering.
- `assets/js/order-lookup.js` and `assets/js/order-success.js` - localized customer order runtimes.
- `worker/src/catalog.js` and `worker/src/orders.js` - catalog validation, order drafts, and fulfillment shaping.

## Current Catalog

At this sweep the source catalog contains:

- 51 product records in `_products/`
- 26 active products and 25 archived products
- 25 physical products, 24 ticket products, 1 digital product, and 1 free RSVP product
- launch-test fixtures for controlled direct-link checkout/download/check-in smoke tests

Current product front matter still uses `category: dustwave` and `category: fronteras` as collection-compatible legacy values. `_includes/product-taxonomy.html` maps those values to Store collections and derives merchandising categories from fulfillment/type/shipping metadata.

## Migration Context

Store succeeds the old DUST WAVE Snipcart shop while keeping the repo-backed catalog source.

- `_products/*.md` remain the editable product catalog.
- `identifier` is the Store product ID; explicit `sku`, `fulfillment_type`, `status`, `shipping_preset`, `tax_category`, `inventory_tracking`, and `inventory` fields now drive checkout validation. RSVP products may opt into named attendees, deadlines, party limits, and custom questions through the existing repository-backed `event_details.registration` block documented in [RSVP.md](RSVP.md).
- Shirt sizes and other options use explicit variants with their own SKU, price, and inventory values.
- Public buttons use `store-add-item`; Snipcart `data-item-*` markup is not part of the Store runtime.
- Pages CMS and archive/unarchive workflows are replaced by the Store admin dashboard and product status publishing.
- Imported catalog inventory values should be treated as placeholders until live baselines are entered in admin.

## Local URLs

See [contributor setup](CONTRIBUTING.md#local-setup) for startup, service URLs, and configuration synchronization.

## Production URLs

- Storefront: `https://shop.dustwave.xyz`
- Worker: `https://checkout.dustwave.xyz`

## Production Operations

- Workflows and deployment: [WORKFLOWS.md](WORKFLOWS.md)
- Testing and smoke checks: [TESTING.md](TESTING.md)
- Backup and restore runbook: [BACKUP_RESTORE.md](BACKUP_RESTORE.md)
- Downloads: [DOWNLOADS.md](DOWNLOADS.md)
- Admin operations: [DASHBOARD.md](DASHBOARD.md)
- RSVP registration and event operations: [RSVP.md](RSVP.md)
- Current capabilities and future work: [ROADMAP.md](ROADMAP.md)

## Guardrails

- Do not reintroduce Snipcart.
- Keep Store checkout server-authoritative.
- Keep admin mutations CSRF-protected.
- Keep inventory and digital downloads in the Worker-controlled path.
- Prefer deleting old compatibility paths over preserving unused shims.
- Run the [ethical risk review](ETHICAL_RISK.md) before shipping changes that alter customer data collection, admin access, checkout/payment behavior, marketing/reminders, analytics, public tokens, automation, or other surfaces where misuse or second-order harm is plausible.

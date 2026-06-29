# Project Overview

Store is Dust Wave's static-first commerce layer for products, tickets, RSVPs, and digital downloads. It succeeds `aindaco1/dust-wave-shop` and replaces Snipcart with a first-party cart, Cloudflare Worker API, Stripe checkout, fulfillment, and admin workflow.

Current release target: `v1.0.4`.

The current repository is launch-ready from a code-path perspective: public browsing, cart validation, PaymentIntent checkout, free RSVP confirmation, webhook settlement, inventory reservation, signed fulfillment, email, admin publishing, coupons, marketing links, reminders, exports, readiness checks, and Podman/host test paths are implemented. Remaining first-launch work is operational account setup and production smoke testing.

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
- GitHub-backed writes publish `_config.yml`, `_products/*.md`, and product/media assets in production; local dev can use the local repo sidecar instead.

## Current Catalog

At this sweep the source catalog contains:

- 49 product records in `_products/`
- 27 active products and 22 archived products
- 25 physical products, 22 ticket products, 1 digital product, and 1 free RSVP product
- launch-test fixtures for controlled direct-link checkout/download/check-in smoke tests

Current product front matter still uses `category: dustwave` and `category: fronteras` as collection-compatible legacy values. `_includes/product-taxonomy.html` maps those values to Store collections and derives merchandising categories from fulfillment/type/shipping metadata.

## Local URLs

- Storefront: `http://127.0.0.1:4002`
- Worker: `http://127.0.0.1:8989`

## Production URLs

- Storefront: `https://shop.dustwave.xyz`
- Worker: `https://checkout.dustwave.xyz`

## Launch Operations

- Production runbook: [PRODUCTION_LAUNCH.md](PRODUCTION_LAUNCH.md)
- Backup and restore runbook: [BACKUP_RESTORE.md](BACKUP_RESTORE.md)
- Digital downloads: [STORE_DOWNLOADS.md](STORE_DOWNLOADS.md)
- Admin operations: [DASHBOARD.md](DASHBOARD.md)

## Guardrails

- Do not reintroduce Snipcart.
- Keep Store checkout server-authoritative.
- Keep admin mutations CSRF-protected.
- Keep inventory and digital downloads in the Worker-controlled path.
- Prefer deleting old compatibility paths over preserving unused shims.

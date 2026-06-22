# Project Overview

Store is Dust Wave's static-first commerce layer for products, tickets, RSVPs, and digital downloads. It succeeds `aindaco1/dust-wave-shop` and replaces Snipcart with a first-party cart, Cloudflare Worker API, Stripe checkout, fulfillment, and admin workflow.

## Architecture

- Jekyll renders the public storefront.
- `_products/` is the catalog source.
- `api/products.json` exposes public product data.
- `worker/src/generated/catalog-snapshot.js` is the Worker-side catalog snapshot.
- Cloudflare Worker validates carts, creates order drafts, handles Stripe webhooks, serves fulfillment actions, and powers admin.
- KV stores order/admin/inventory state.
- R2 stores production digital downloads.
- Durable Objects serialize SKU inventory reservations.

## Local URLs

- Storefront: `http://127.0.0.1:4002`
- Worker: `http://127.0.0.1:8989`

## Production URLs

- Storefront: `https://shop.dustwave.xyz`
- Worker: `https://checkout.dustwave.xyz`

## Launch Operations

- Production runbook: [PRODUCTION_LAUNCH.md](PRODUCTION_LAUNCH.md)
- Backup and restore runbook: [BACKUP_RESTORE.md](BACKUP_RESTORE.md)

## Guardrails

- Do not reintroduce Snipcart.
- Keep Store checkout server-authoritative.
- Keep admin mutations CSRF-protected.
- Keep inventory and digital downloads in the Worker-controlled path.
- Prefer deleting old compatibility paths over preserving unused shims.

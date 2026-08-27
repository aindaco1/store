# Project Overview

Store is Dust Wave's static-first commerce layer for products, tickets, RSVPs, and digital downloads. It succeeds `aindaco1/dust-wave-shop` and replaces Snipcart with a first-party cart, Cloudflare Worker API, Stripe checkout, fulfillment, and admin workflow.

Current release: `v1.3.4`. The preceding `v1.3.3` release remains independently reversible. Analytics reports settled tip revenue from canonical persisted order totals and proportionally attributes a mixed-order tip when scoped to one product. Orders keeps its CSV and attendee export actions together on one responsive row. Ticket and RSVP products can opt into one deduplicated confirmed-purchaser thank-you email after the configured post-event delay. Super admins author distinct English and Spanish mission copy with constrained inline formatting and see a live, delivery-faithful preview without exposing recipients. Expired authenticated dashboard sessions return to the existing sign-in panel with clear localized guidance. Orders, fulfillment and attendee exports, and Analytics can be scoped to one canonical product. Durable delivery, promotional suppression, provider evidence, and canonical order and fulfillment truth remain separate. Store pins Platform v0.34.1 and the separate Jekyll Template v0.1.0; Store retains local build copies, configuration, content, production origins, credentials, deployment, and rollback authority.

The current repository is production-ready from a code-path perspective: public browsing, cart validation, PaymentIntent and no-payment checkout, opt-in RSVP forms, free RSVP confirmation, webhook settlement, inventory reservation, signed fulfillment, named attendee check-in, private response review, email, admin publishing, coupons, marketing links, reminders, exports, readiness checks, and Podman/host test paths are implemented. Ongoing production work is operational account hygiene, smoke testing, reconciliation, and backup discipline.

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

## Current Catalog

At this sweep the source catalog contains:

- 50 product records in `_products/`
- 25 active products and 25 archived products
- 25 physical products, 23 ticket products, 1 digital product, and 1 free RSVP product
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

- Storefront: `http://127.0.0.1:4002`
- Worker: `http://127.0.0.1:8989`

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

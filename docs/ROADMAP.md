# Store Roadmap

Store is not deployed yet. The roadmap is focused on reaching a clean first production launch for `shop.dustwave.xyz` and the Worker API domain.

## Done

- Static Jekyll storefront with `_products/` catalog.
- DUST WAVE products migrated into product markdown.
- Product cards with standardized category/title, description, price, option, quantity, and add-to-cart controls.
- Store cart runtime classes/events/storage.
- Cart quantity controls.
- Variant price syncing for price display and buttons.
- `/api/products.json` and `/api/add-ons.json`.
- Worker catalog snapshot generation.
- Store cart validation with server-authoritative prices, variants, SKUs, shipping metadata, tax categories, and statuses.
- Store checkout intent endpoint for paid and free orders.
- Stripe PaymentIntent confirmation flow.
- Stripe webhook settlement for Store orders.
- Store SKU inventory reservation/commit/release through Durable Objects.
- Store order emails through Resend.
- Order Success page with token-scoped fulfillment actions.
- Signed digital download flow backed by `STORE_DOWNLOADS` R2.
- Ticket/RSVP QR/check-in/.ics fulfillment actions.
- Admin dashboard Store tabs for orders, products, downloads, and inventory.
- Admin product edit/publish and product image uploads.
- Admin inventory baselines.
- Admin download readiness and upload/replace flow.
- Admin digital download expiry/reissue controls.
- Admin Store order CSV export and ticket/RSVP check-in.
- Admin attendee search and ticket/RSVP attendee CSV export.
- Store-focused default Playwright scope.
- Store Worker smoke script.
- Product content security audit.
- Store product SEO metadata and Product JSON-LD.
- Store-native security, testing, workflow, shipping, Podman, and contributing docs.
- Store-only admin/browser runtime cleanup with campaign, pledge, content-editor, and embed translation payloads removed.
- Admin Store readiness/status panel for secrets, webhooks, R2 readiness, inventory baselines, cron heartbeat, and catalog snapshot posture.
- Production launch runbook for Cloudflare, Stripe, Resend, USPS, NM GRT, R2, DNS, smoke tests, and rollback.
- Storefront product-card inventory warnings for pending imported counts and low-stock variant states.
- Product admin bulk status publishing for active, draft, archived, and sold-out states.
- Product draft/archive visibility controls for storefront listings, public product JSON, and SEO indexing.
- Customer-facing order lookup by email with emailed one-time tokens.
- Historical extraction and Snipcart migration notes separated from launch-facing docs.
- Admin audit CSV export from recent KV-backed mutation events.
- Backup/restore runbook for KV, R2, and product catalog Git history.
- Post-launch order reconciliation CSV export.
- Store admin fixture names reviewed and normalized around ticket/download scenarios.
- Storefront collection/category taxonomy with filter controls and catalog metadata.
- Multilingual product page URL/content model with generated language-prefixed product pages.
- Production launch readiness CLI for repo-visible URLs, Worker config, admin bootstrap users, inventory baselines, downloads, and manual smoke checks.

## Launch Blockers

- Upload real production digital download files to `STORE_DOWNLOADS` or configure Worker-only fallback URLs for externally hosted media.
- Configure production Cloudflare Worker secrets.
- Configure Stripe production webhook endpoint and signing secret.
- Verify USPS and New Mexico GRT behavior against the production origin address.
- Run a full paid physical checkout in Stripe test mode.
- Run a full paid digital checkout and download fulfillment.
- Run a paid ticket checkout and admin check-in.
- Run a free RSVP checkout and admin check-in.

## Near-Term Cleanup

- None before first production launch.

## Product Roadmap

- None before first production launch.

## Cross-Cutting Roadmap

These features are not separate product surfaces. They should land as part of normal Store hardening and be kept DRY with the existing docs:

- [Performance](PERFORMANCE.md)
- [Security](SECURITY.md)
- [Accessibility](ACCESSIBILITY.md)
- [I18N](I18N.md)

### Performance

- Add a lightweight performance budget for storefront, cart, checkout, and admin routes, with tracked limits for JavaScript size, CSS size, image weight, and Worker response time.
- Add a repeatable Lighthouse/PageSpeed check for core public routes before production deploys.
- Surface basic Worker timing percentiles in admin Plan Usage or a dedicated diagnostics view, using existing performance observation data.
- Expand media optimization reporting so product image uploads clearly show original size, generated derivative size, and expected storefront dimensions.
- Add cache-status checks for static assets, catalog JSON, and private/no-store routes to catch accidental caching regressions.

### Security

- Add a pre-launch security checklist view in admin that mirrors the security guide: secrets, webhook signatures, R2, CSP, admin users, Turnstile, and production mode.
- Add an admin session/device review screen with recent login metadata and explicit session revocation.
- Expand audit events into a searchable admin audit view, not just CSV export.
- Add signed-download abuse controls: per-order attempt counts, soft lockouts, and clearer admin reissue history.
- Add scheduled secret/config posture checks that warn when production-required secrets, webhook endpoints, or allowed origins drift.

### Accessibility

- Add an admin accessibility smoke-test checklist for keyboard, screen reader, reduced motion, focus order, and mobile overflow.
- Add visible status summaries for async admin actions that are consistently announced to assistive technology.
- Expand automated axe coverage to checkout, cart, order lookup, Order Success, product editing, and download creation.
- Add regression fixtures for large text, long product names, long filenames, and high-zoom/tablet admin layouts.
- Add a documented manual QA pass for VoiceOver and NVDA before launch.

### I18N

- Move remaining hardcoded public/admin runtime strings into `_data/i18n/*` and runtime message JSON.
- Add localization coverage for download creation, product editing, order lookup, checkout errors, and fulfillment status copy.
- Add a translation completeness check that compares every supported locale against English keys.
- Add localized email template coverage for receipts, order lookup, digital downloads, tickets, RSVPs, and admin auth.
- Add localized product metadata QA for canonical URLs, alternate links, JSON-LD `availableLanguage`, and language switcher behavior.

## Operational Roadmap

- None before first production launch.

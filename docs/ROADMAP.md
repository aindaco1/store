# Store Roadmap

Store's main product code paths are implemented and the production Store is live. This roadmap now tracks the `v1.0.4` release state, ongoing production operations, and future hardening that should stay DRY with the existing Store docs.

## Release v1.0.4 Status

`v1.0.4` is the current post-launch release target for Store.

Completed in this release:

- Store-owned customer order confirmations through Resend for physical, digital, ticket, RSVP, coupon, shipping, and total-breakdown scenarios.
- Super-admin order notification emails after paid webhook settlement or free-order confirmation.
- Authenticated super-admin order notification CTAs that reuse the one-time admin login flow and open the Orders tab directly.
- Stripe receipt email suppression for Store PaymentIntents so customer receipt copy stays in one localized email path.
- Stripe reconciliation diagnostics for charge IDs, balance transactions, and card verification outcomes.
- Deliverability-safe event email attachments: calendar invites may be attached; ticket/QR SVGs stay on the token-scoped order page.
- Durable digital download entitlements for confirmed orders, with short-lived signed links and explicit admin revoke/refresh controls.
- Admin Orders item-level controls for mixed fulfillment orders instead of inactive "item actions" summary text.
- Admin Orders attendance refresh after ticket/RSVP check-in mutations.
- Responsive Order action buttons across desktop, tablet, and mobile.
- Admin dashboard navigation persistence for the last selected top-level tab and Settings subtab after authenticated reloads.
- Spanish public home, Terms, Orders, and Order Success routes, including localized runtime order status copy and machine-translated Terms copy pending legal/native review.
- Shorter-lived authenticated super-admin order notification links and sessions, plus a regression test that consumed links cannot be reused by a second browser.
- Admin Brand & SEO customization controls aligned with the public SEO metadata and merchant return policy configuration.
- Comprehensive non-admin SEO pass for public routes, canonical/alternate metadata, sitemap exclusions, crawl controls, and product structured data.
- iOS Safari styling guard for auto-detected text and mobile navigation controls so public/admin mobile UI does not inherit unexpected blue link/button styling.
- Ticket/RSVP SVG layout fitting for long product and variant names.
- Order Success totals, shipping, event address, and durable-download copy improvements.
- Admin status live-region normalization for async actions.
- i18n completeness checks for supported locale files.
- ESM Vitest config entrypoints for unit/security runs, with static-build excludes for test configs and media optimizer temp candidates.
- Local demo order seed covering physical, digital, ticket, RSVP, coupon, shipping, and fulfillment variations.
- One-time production runbook content folded into the active production operations, testing, security, backup, and download docs, with the obsolete launch file removed.

## Audit Snapshot

The release audit is anchored in these docs:

- [Accessibility](ACCESSIBILITY.md)
- [I18N](I18N.md)
- [Security](SECURITY.md)
- [Podman](PODMAN.md)
- [SEO](SEO.md)
- [Testing](TESTING.md)
- [Performance](PERFORMANCE.md)

Audit status for `v1.0.4`:

- Accessibility: admin status regions, responsive order rows, long-content fixtures, mobile/tablet order buttons, iOS Safari color guards, and authenticated order-notification entry into the existing admin tab flow are covered by automated regression paths. Manual VoiceOver/NVDA passes remain required before major public releases and checkout/admin workflow changes.
- I18N: email/admin copy additions are mirrored in English and Spanish, public home/Terms/order shells are localized without translating creator-authored product content, the authenticated order CTA reuses existing localized admin notification copy, and `npm run test:i18n` is the locale completeness gate.
- Security: server-authoritative checkout, signed/no-store fulfillment, CSRF-protected admin mutations, one-time super-admin order CTAs with notification-specific TTLs, non-sensitive sanitized admin navigation persistence, explicit digital revocation, and Store-owned receipt delivery align with [SECURITY.md](SECURITY.md).
- Podman: the documented Podman path remains the fallback and parity path for local Store/Worker smoke and headless E2E; the current macOS rootless Podman doctor pass is clean.
- SEO: public SEO remains product/home/terms-focused with localized alternates, configurable merchant return policy metadata, sitemap exclusions, noindex order shells, and rendered non-admin audits through `npm run test:seo`; admin/API routes stay robots-blocked.
- Testing: merge gate remains `npm run test:premerge`, with added focused unit/E2E coverage for authenticated order links, reconciliation CSV payment checks, admin tab/subtab restoration, SEO metadata, and ESM Vitest config entrypoints.
- Performance: static rendering, lazy cart loading, minified assets, bounded admin reads, generated catalog snapshots, media optimizer checks, and a tiny local-only dashboard state read/write remain the baseline; explicit performance budgets are future work.

## Production Operations

These are ongoing production checks, not known code blockers:

- Keep production digital download files in `STORE_DOWNLOADS`, or maintain approved Worker-only fallback URLs for externally hosted media.
- Keep production Cloudflare Worker secrets, including dedicated signing secrets where appropriate, current in Cloudflare.
- Keep the Stripe production webhook endpoint and signing secret aligned with the production Worker domain.
- Re-verify USPS and New Mexico GRT behavior after shipping origin, product, or provider changes.
- Re-verify admin coupons, marketing referrals, reminder suppression, order lookup, and download library flows after related releases.
- Run paid physical, paid digital, paid ticket, and free RSVP smoke checks after checkout/fulfillment changes.
- Run manual VoiceOver and NVDA passes for major public releases and checkout/admin workflow changes.

## Done Before v1.0.4

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
- Order Success page with token-scoped fulfillment actions.
- Signed digital download flow backed by `STORE_DOWNLOADS` R2.
- Ticket/RSVP QR/check-in/.ics fulfillment actions.
- Admin dashboard Store tabs for orders, products, downloads, coupons, analytics, marketing, and inventory through product controls.
- Admin product edit/publish and product image uploads.
- Admin inventory baselines.
- Admin download readiness and upload/replace flow.
- Admin Store order CSV export and ticket/RSVP check-in.
- Admin attendee search and ticket/RSVP attendee CSV export.
- Store-focused default Playwright scope.
- Store Worker smoke script.
- Product content security audit.
- Store product SEO metadata and Product JSON-LD.
- Store-native security, testing, workflow, shipping, Podman, and contributing docs.
- Store-only admin/browser runtime cleanup with obsolete non-Store runtime and translation payloads removed.
- Admin Store readiness/status panel for secrets, webhooks, R2 readiness, inventory baselines, cron heartbeat, and catalog snapshot posture.
- Production operations guidance for Cloudflare, Stripe, Resend, USPS, NM GRT, R2, DNS, smoke tests, and rollback folded into active docs.
- Storefront product-card inventory warnings for pending imported counts and low-stock variant states.
- Product admin bulk status publishing for active, draft, archived, and sold-out states.
- Product draft/archive visibility controls for storefront listings, public product JSON, and SEO indexing.
- Customer-facing order lookup by email with emailed one-time tokens.
- Admin coupon management and Worker-side coupon application.
- Admin Marketing referral/UTM link builder with QR exports and saved referrals.
- Opt-in abandoned-checkout reminders with resume/unsubscribe links and admin suppression controls.
- Event reminder queueing/delivery for ticket and RSVP orders.
- Reusable digital download library create/replace/delete flow in R2.
- Snipcart migration context folded into the active project overview, with Store-native catalog/admin/runtime rules as the source of truth.
- Admin audit CSV export from recent KV-backed mutation events.
- Backup/restore runbook for KV, R2, and product catalog Git history.
- Post-launch order reconciliation CSV export.
- Store admin fixture names reviewed and normalized around ticket/download scenarios.
- Storefront collection/category taxonomy with filter controls and catalog metadata.
- Multilingual product page URL/content model with generated language-prefixed product pages.
- Production readiness CLI for repo-visible URLs, Worker config, admin bootstrap users, inventory baselines, downloads, and manual smoke checks.

## Future Work

Keep these scoped to operational hardening. Do not create duplicate systems when existing Store docs, email rendering, admin controls, and Worker observability can be extended.

### Performance

- Add lightweight performance budgets for storefront, cart, checkout, and admin routes, including JavaScript size, CSS size, image weight, and Worker response time.
- Add repeatable Lighthouse/PageSpeed checks for core public routes before production deploys.
- Surface Worker timing percentiles in admin Plan Usage or diagnostics using existing performance observation data.
- Expand media optimization reporting so uploads show original size, derivative size, and expected storefront dimensions.
- Add cache-status checks for static assets, catalog JSON, and private/no-store routes.

### Security

- Expand Store readiness so it mirrors the full security guide: secrets, webhook signatures, R2, CSP, admin users, Turnstile, production mode, coupons, reminders, and lookup token posture.
- Add an admin session/device review screen with recent login metadata and explicit session revocation.
- Expand audit events into a searchable admin audit view, not just CSV export.
- Add signed-download abuse controls: per-order attempt counts, soft lockouts, and clearer admin refresh/revocation history.
- Add scheduled secret/config posture checks that warn when production-required secrets, webhook endpoints, or allowed origins drift.

### Accessibility

- Add the documented manual VoiceOver and NVDA pass to release procedure artifacts.
- Expand automated axe coverage to the mounted checkout/payment surface when Stripe test fixtures are available locally.
- Add high-zoom screenshots for cart, checkout, Order Success, product editing, and admin order controls.
- Keep long product names, long filenames, and tablet/mobile admin rows in regression fixtures.

### I18N

- Move any remaining hardcoded public/admin runtime strings into `_data/i18n/*` and runtime message JSON as they are touched.
- Add localized QA snapshots for download creation, product editing, order lookup, checkout errors, and fulfillment status copy.
- Add localized product metadata QA for canonical URLs, alternate links, JSON-LD `availableLanguage`, and language switcher behavior.
- Define a translator/native-speaker review loop before adding locales beyond English and Spanish.

### Podman

- Keep Podman smoke coverage aligned with the host merge gate.
- Add a short troubleshooting checklist for stale `gvproxy`, port conflicts, and first-run image rebuilds if those recur.
- Consider making the Podman E2E path a scheduled CI job.

### SEO

- Sample rendered canonical, alternate, Open Graph, and Product JSON-LD tags for active products during production QA.
- Review localized product metadata after real translated product copy is added.

### Testing

- Keep `npm run test:premerge` as the local merge gate.
- Add a dedicated release smoke script for paid physical, paid digital, paid ticket, and free RSVP flows once production test credentials are available.
- Track manual production smoke evidence for emails, downloads, check-in, lookup links, reminders, and CSV exports.

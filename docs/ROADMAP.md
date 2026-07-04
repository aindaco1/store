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

Keep these scoped to Store's goals and data model. Share implementation patterns with Pool where the underlying problem is the same, but do not import Pool-only concepts such as campaigns, pledges, Manage Pledge, embeds, creator diaries, votes, or supporter blasts. Prefer extending existing Store docs, email rendering, admin controls, setup tooling, Worker observability, and release scripts before adding parallel systems.

### Cross-Repo Parity Rules

- Treat Store and Pool feature parity as a set of transferable slices, not a mandate to copy product surfaces. Good shared slices include setup/readiness, media authoring, performance gates, security posture, admin audit/session controls, accessibility evidence, i18n QA, SEO sampling, release smoke scripts, payment reconciliation, backup discipline, and tax-provider hardening.
- Keep Store-specific nouns and storage boundaries intact: `_products/`, Store orders, physical/digital/ticket/RSVP fulfillment, `STORE_STATE`, `STORE_DOWNLOADS`, `STORE_INVENTORY_COORDINATOR`, Resend transactional email, USPS/NM GRT, customer order lookup, coupons, referrals, abandoned-checkout reminders, event reminders, and the Store admin dashboard.
- When a Pool feature lands first, port only the reusable primitive and document the Store mapping in the relevant Store docs. Example: a Pool campaign media picker maps to Store product/default media selection, not to a campaign media library.
- When Store already has the stronger implementation, keep Store as the source pattern and add regression notes so Pool can adopt it without weakening Store behavior.
- Keep docs-as-code current as each slice lands by updating the owning document, not just this roadmap.

### Guided Setup And Operator Readiness

- Consider a thin terminal UI wrapper around the existing `scripts/setup-deploy.mjs` setup core, keeping the script-first CLI usable for CI and non-interactive operators.
- Support Store's current setup paths: local secret generation, production dry run, provider readiness checks, Cloudflare KV/R2/Durable Object resource checks, Worker secret writes, GitHub secret writes, optional deploy, and Podman readiness guidance.
- Show a step-by-step readiness board for Cloudflare, GitHub, Stripe, Resend, USPS, NM GRT or ZIP.TAX, Turnstile, `STORE_DOWNLOADS`, Worker domains, required credentials, planned mutations, skipped checks, generated local-only secrets, and next actions before live mutations.
- Keep secrets private in the UI with masked input, no terminal echo, redacted logs, and explicit reminders that production secrets are not copied into `worker/.dev.vars`.
- Provide copyable fallback commands for failed setup steps so operators can drop back to Wrangler, GitHub CLI, Stripe CLI, or the existing setup script without losing context.
- Add redacted transcript export covering setup decisions, provider status, command versions, resource IDs, and failure reasons without adding a new telemetry backend.
- Add smoke-test shortcuts after setup for `podman:doctor`, `./scripts/dev.sh --podman`, `./scripts/test-worker.sh --podman`, `npm run test:secrets`, `npm run test:i18n`, and production readiness checks while leaving orchestration in existing scripts.

### Catalog, Media, And Add-On Authoring

- Improve Store product/default media selection without adding a second media index, KV-backed media database, or alternate storage backend.
- Make manual Source URL or path editing an advanced/edit-existing affordance so normal Store admins can pick from existing product/default media, upload a new file, or replace a referenced file without pasting `/assets/...` paths by hand.
- Add admin media browsing for Store-owned assets: product/default filters, image/audio/video type tabs, thumbnails, filename/search filtering, recently uploaded assets, dimensions, duration, file size, and clear source-versus-derived labels.
- Improve publishing quality at the point of use: required alt text for meaningful product/default images, decorative-image handling where supported, captions where useful, and focal/crop guidance for product cards, product detail images, social previews, logos, favicons, and email-safe media if added.
- Add safe replace/reuse flows that show where an asset is referenced across products, variants, settings defaults, social metadata, product cards, Product JSON-LD, downloads metadata, and admin previews before changing or removing it.
- Surface optimization status in the dashboard by reusing repository media optimizer outputs: source file, generated WebP widths, pending optimization, stale derivative, missing derivative, oversized source warnings, and expected storefront dimensions.
- Add repair actions that dispatch or suggest the existing media optimization workflow with changed/all scope rather than introducing Worker-side image or video processing.
- Add broken-reference checks for active product images, localized product overrides, default social images, logos, favicons, and admin-selected media so Store admins see missing files or failed derivatives before publish.
- Add lightweight media placement budgets for product cards, product detail images, social previews, checkout/order media, and admin upload previews, warning rather than hard-blocking unless a file is unsafe or unsupported.
- Keep cleanup conservative and explainable: publish-time cleanup should delete only dashboard-owned media that disappeared from normalized Store content and is not referenced elsewhere.
- Keep optional add-on variant price behavior DRY. If Store add-on variants need price overrides, use one shared browser/Worker/admin price-resolution rule where variant price overrides product price and blank variant price inherits the base product price.
- Preserve Store accounting boundaries for add-on price changes: future checkouts use current catalog pricing, while confirmed orders, emails, analytics, and exports keep the saved unit price.
- Extend tests around media picker usability, optimization-state rendering, broken-reference warnings, cleanup safety, responsive image selection, Store product preview safety, and any add-on variant price resolution.
- Update [ADD_ON_PRODUCTS.md](ADD_ON_PRODUCTS.md), [DASHBOARD.md](DASHBOARD.md), [CUSTOMIZATION.md](CUSTOMIZATION.md), and admin help text as media or add-on authoring features land.

### Production Quality Gates And Admin Operations

#### Performance

- Add lightweight performance budgets for storefront, cart, checkout, Order Success, order lookup, and admin routes, including JavaScript size, CSS size, image/media weight, Worker response time, and dashboard table/render latency.
- Add repeatable Lighthouse/PageSpeed checks for core public routes before production deploys, keeping checks scriptable and optional where external provider credentials or stable production URLs are unavailable.
- Surface Worker timing percentiles and slow-route summaries in admin Plan Usage or Runtime diagnostics using existing performance observation data instead of adding a second telemetry backend.
- Expand media optimization reporting so uploads show original size, derivative size, optimization status, and expected storefront dimensions.
- Add cache-status checks for static assets, catalog JSON, add-on JSON, product pages, social image assets, and private/no-store routes so public performance improvements do not weaken checkout, admin, lookup, order, download, reminder, or check-in cache rules.

#### Security And Admin Operations

- Expand Store readiness so it mirrors the full security guide: Worker secrets, Stripe webhook signatures, Resend senders, R2, CSP, allowed origins, admin users/scopes, Turnstile, production mode, coupons, reminders, order lookup tokens, signed downloads, and `RATELIMIT` posture.
- Add an admin session/device review screen with recent login metadata and explicit session revocation using the existing admin auth/session/audit model.
- Expand audit events into a searchable admin audit view with filters and CSV export, reusing existing KV-backed audit records and keeping sensitive payloads redacted.
- Add signed-download abuse controls: per-order attempt counts, soft lockouts, clearer admin refresh/revocation history, and diagnostics that do not expose raw signed URLs.
- Add scheduled secret/config posture checks that warn when production-required secrets, webhook endpoints, allowed origins, provider readiness, R2 bindings, or admin user posture drift from expected config; surface results through admin diagnostics and/or GitHub issues instead of silently mutating runtime state.

#### Accessibility

- Add the documented manual VoiceOver and NVDA pass to release procedure artifacts, including evidence for public product pages, cart/checkout, Order Success, order lookup, admin auth, product editing, orders, downloads, coupons, analytics, and marketing controls.
- Expand automated axe coverage to the mounted checkout/payment surface when Stripe test fixtures are available locally.
- Add high-zoom screenshots for cart, checkout, Order Success, order lookup, product editing, download creation, coupon editing, admin order controls, and marketing/referral controls.
- Keep long product names, long variant names, long filenames, long coupon/referral labels, and tablet/mobile admin rows in regression fixtures.

#### I18N

- Move any remaining hardcoded public/admin runtime strings into `_data/i18n/*` and runtime message JSON as they are touched.
- Add localized QA snapshots for download creation, product editing, order lookup, checkout errors, coupon errors, reminder flows, admin status copy, email copy, and fulfillment status copy.
- Add localized product metadata QA for canonical URLs, alternate links, Product JSON-LD `availableLanguage`, language switcher behavior, sitemap entries, and social metadata.
- Define a translator/native-speaker review loop before adding locales beyond English and Spanish, including public shells, product metadata, emails, Terms copy, admin help text, and checkout/order flows.

#### Podman

- Keep Podman smoke coverage aligned with the host merge gate.
- Add a short troubleshooting checklist for stale `gvproxy`, port conflicts, first-run image rebuilds, Wrangler local-state confusion, and Stripe CLI forwarding issues if those recur.
- Consider making the Podman E2E path a scheduled CI job if runner support remains reliable.

#### SEO

- Sample rendered canonical, alternate, Open Graph, Twitter card, Product JSON-LD, BreadcrumbList, Organization, and merchant return policy tags for active products during production QA.
- Add rendered SEO QA samples for localized product pages and public Spanish shells, including sitemap inclusion/exclusion and `noindex,nofollow` behavior for admin, Orders, Order Success, tokenized fulfillment, lookup, reminder, and check-in routes.
- Review localized product metadata after real translated product copy is added.

#### Testing And Release Evidence

- Keep `npm run test:premerge` as the local merge gate.
- Add a dedicated release smoke script for paid physical, paid digital, paid ticket, and free RSVP flows once production test credentials are available.
- Track manual production smoke evidence for emails, downloads, ticket/RSVP check-in, order lookup links, abandoned-checkout reminders, event reminders, coupon application, referrals, CSV exports, reconciliation exports, audit exports, and admin product/download publishing.
- Update [PERFORMANCE.md](PERFORMANCE.md), [SECURITY.md](SECURITY.md), [ACCESSIBILITY.md](ACCESSIBILITY.md), [I18N.md](I18N.md), [PODMAN.md](PODMAN.md), [SEO.md](SEO.md), [TESTING.md](TESTING.md), [DASHBOARD.md](DASHBOARD.md), and [WORKFLOWS.md](WORKFLOWS.md) as each hardening slice lands.

### Payment Integrity And Reconciliation

- Keep the current architecture: Stripe remains the processor, Stripe owns card data, the Cloudflare Worker remains the canonical payment boundary, KV remains order/admin state, Durable Objects serialize scarce inventory, and the Worker scheduler handles bounded background work.
- Avoid adding a full double-entry ledger unless Store later adds refunds, payouts, stored balances, multi-currency money movement, or marketplace-style splits. For the current order model, prefer a lightweight append-only payment event journal that references existing order tokens, Stripe objects, and fulfillment rows.
- Add explicit `currency` metadata to newly persisted order, checkout intent, settlement, reconciliation, analytics, and export rows, defaulting older rows to the deployment's current USD assumption during reads instead of introducing multi-currency behavior.
- Add clearer payment timing fields without duplicating existing history: customer/Stripe event time, Worker booking time, webhook settlement time, and processor availability time when Stripe balance transaction data is available.
- Add a bounded, redacted processor-event journal for high-value Stripe interactions and webhooks, storing event IDs, object IDs, request intent, response status, idempotency key, mode, timestamps, reconciliation status, and only the minimal raw provider payload needed for recovery or audit, with explicit retention and PII minimization.
- Reuse existing observability summaries and Stripe reconciliation diagnostics to build periodic checks that compare Store order truth, PaymentIntents, webhook idempotency markers, stored charge/balance data, and reconciliation CSV output without KV namespace scans.
- Represent reconciliation differences as explicit records with status, severity, source object IDs, first/last seen timestamps, and operator notes so dashboard views and scripts do not invent a second reporting model.
- Move payment-adjacent side effects toward a small KV-backed outbox shared by order confirmations, admin notifications, payment failure notices if added, lookup emails, abandoned-checkout reminders, and event reminders so order persistence and notification delivery can be retried independently.
- Harden webhook and background-job resumability by making each step re-run-safe, adding stale-job detection where needed, and recording enough state to resume or safely roll forward without duplicate emails, duplicate inventory commits, or accidental access grants.
- Add invariant and crash/resume tests using the existing Vitest and smoke harnesses: no confirmed paid order without a matching PaymentIntent, no duplicate confirmation for one order token, failed/canceled payments release reservations, repeated webhooks remain idempotent, and failed emails stay retryable without mutating order truth.
- Keep any production payment test transactions clearly tagged, normally booked, and reconciled through the same order/payment paths rather than hidden behind special-case accounting or reporting behavior.
- Add a narrowly scoped maker/checker path only for manual money-affecting recovery operations that are not already automated or retry-safe, using existing admin sessions, role scopes, CSRF, and audit records rather than introducing a separate approval service.
- Document any new journal, reconciliation records, and outbox behavior in [PAYMENT_PROCESSOR.md](PAYMENT_PROCESSOR.md), [WORKFLOWS.md](WORKFLOWS.md), [SECURITY.md](SECURITY.md), [TESTING.md](TESTING.md), [EMAIL.md](EMAIL.md), and [../worker/README.md](../worker/README.md), including retention, PII, and operator runbooks.

### Backup, Restore, And Disaster Recovery

- Build on the existing [BACKUP_RESTORE.md](BACKUP_RESTORE.md) runbook rather than creating a parallel backup model.
- Add a small operator helper for repeatable Store snapshots that captures Git commit state, `git bundle` history, dirty diffs, generated Worker/public build outputs, Cloudflare resource IDs, Worker deployment metadata, provider endpoint IDs, sanitized readiness output, and operator exports without committing backup artifacts to the repository.
- Keep backup implementation DRY by wrapping existing tooling where practical: setup/deploy resource discovery, Worker config sync, catalog snapshot generation, order/attendee/reconciliation/audit CSV exports, and dashboard readiness checks.
- Back up authoritative KV state by prefix, especially orders, admin users, audit events, inventory overrides/projections, coupons, order lookup indexes, marketing referrals, abandoned-checkout reminders, event reminders, email sent markers, Stripe idempotency/payment markers, observability records needed for incident review, and any future reconciliation/outbox records.
- Back up `STORE_DOWNLOADS` R2 objects referenced by active product and variant `download.file_key` values, plus approved Worker-only fallback URL mappings as secret/config inventory rather than public catalog data.
- Explicitly exclude or quarantine ephemeral/sensitive records from normal restore: `admin-session:*`, `admin-login:*`, `RATELIMIT` entries, one-time order lookup tokens, signed resume snapshots, short-lived signed download/check-in URLs, cron health markers, sampled observability rows, and Stripe webhook markers unless the incident specifically requires replay control.
- Treat secrets as inventory, not backup payload: record required secret names, configured/missing status, provider ownership, rotation notes, and setup commands, but never export production secret values or copy them into `worker/.dev.vars`.
- Define a restore order that minimizes duplicate-send, duplicate-charge, and inventory drift risk: restore Git product/config/media history first when possible, restore admin access, restore order truth before email/index/projection records, rebuild or verify derived inventory projections, restore download objects, then restore reminder/suppression/send queues only after privacy and duplicate-send review.
- Document that Durable Object state is not restored directly; scarce SKU reservations should be rebuilt or revalidated from order truth, product config, Stripe state, and inventory projection checks rather than written into Durable Object storage by hand.
- Add payment-specific restore gates before touching Stripe idempotency, future reconciliation/outbox records, or settled order state, including required staging restore, Stripe dashboard/API comparison, duplicate-charge review, and operator signoff before production replay or mutation.
- Add restore verification using the current Store checks: Jekyll build, `npm run sync:worker-config`, SEO/content-security/secrets/i18n checks, Podman Worker smoke, checkout smoke where safe, order/attendee/reconciliation/audit export previews, R2 download checks, observability checks, and admin dashboard review for Products, Coupons, Downloads, Orders, Analytics, Marketing, Settings, and Users.
- Add tests around backup classification and command generation with fake Wrangler/GitHub/provider CLIs, plus a staging restore rehearsal fixture that proves index/projection repair can recover from missing order indexes or stale inventory projections without KV namespace scans.

### Tax Calculator And Compliance Hardening

- Start from Store's implemented baseline: Worker-owned `tax/quote`, checkout-total calculation, persisted order tax details, email/admin/export totals, `_config.yml` non-secret tax settings, Worker secrets for provider keys, New Mexico GRT defaults, and optional ZIP.TAX provider support.
- Keep the Worker as the only tax authority. Cart, checkout, Order Success, admin, emails, analytics, and exports should read Worker-calculated or persisted tax totals instead of duplicating tax math in browser code.
- Prioritize the U.S. experience first, with New Mexico correctness as the launch baseline, then broaden state, county, municipal, special-district, D.C., and U.S. territory coverage before adding international VAT/GST behavior.
- Clarify the Store tax model before expanding scope: which product types are taxable (`physical`, `digital`, `ticket`, `rsvp`), how shipping taxability is handled, how coupons affect taxable subtotal, and whether tip/platform-fee amounts remain untaxed.
- Add item-level tax classification without splitting the checkout model: create a shared tax-line builder for physical products, digital downloads, ticket/admission items, RSVP/free items, optional add-ons, discounts, and shipping, with stable IDs, category codes, amounts, quantity, and exemption flags.
- Preserve shopper UX while improving correctness: keep provisional tax display when destination is incomplete, but make quote states explicit (`needs_input`, `quoted`, `provider_unavailable`, `fallback_used`) so cart, checkout, and admin diagnostics distinguish missing address from provider failure or deliberate fallback.
- Resolve and document `/tax/quote` behavior for missing destination and provider failure, then update Worker route tests and docs to match.
- Broaden the New Mexico GRT dataset and diagnostics with generation date, source, effective period, city/postal/street matching notes, and a repeatable refresh workflow with reviewable diffs rather than silent live-rate drift.
- Add a scheduled tax-rate watch workflow with manual trigger support that checks for rate changes, refreshes New Mexico starter data, samples ZIP.TAX quotes for configured fixtures, compares against checked-in snapshots, and opens a pull request or issue instead of changing production behavior silently.
- Add provider health controls for live lookups: timeouts, bounded retries where safe, short-lived quote caching keyed by normalized destination/provider/rate version, rate-limit/circuit-breaker behavior, redacted error logging, and admin/runtime diagnostics that show provider readiness without exposing API keys.
- Decide fallback policy explicitly per provider and checkout stage: when previews may use fallback, when production checkout should block, when an operator-approved fallback rate may be used, and whether zero-tax quotes are allowed when providers are unavailable.
- Strengthen international behavior later: treat offline rules as conservative preview/fallback, then decide whether international VAT/GST should remain disabled by default, use a provider-backed path, or require explicit registration/nexus configuration before collection.
- Add business/customer tax features only after scope is approved: VAT ID capture, exemption certificates, reverse-charge handling, tax-inclusive pricing, destination evidence requirements, and localized invoice/receipt copy should be behind explicit config, admin docs, and tests.
- Improve privacy and retention of tax destinations: review whether persisted tax destination data should keep full street address forever, whether stored tax evidence can be minimized or hashed after settlement/report windows, and how this interacts with fulfillment addresses that already require PII retention.
- Add tax liability exports grouped by provider, source, jurisdiction, location code, effective rate, taxable subtotal, taxable shipping, tax collected, product category, and refund/cancel deltas if those workflows are added.
- Extend tests at the right layers: tax-line construction, provider adapters, New Mexico starter/API fallback, ZIP.TAX shipping taxability, Worker checkout totals, browser provisional/error/fallback states, report/export preservation of historical tax details, and setup/readiness credential checks.
- Update [CUSTOMIZATION.md](CUSTOMIZATION.md), [WORKFLOWS.md](WORKFLOWS.md), [TESTING.md](TESTING.md), [SECURITY.md](SECURITY.md), [SHIPPING.md](SHIPPING.md), and [../worker/README.md](../worker/README.md) after implementation, including a note that operators should verify tax obligations with a qualified tax professional.

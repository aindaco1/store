# Store Roadmap

Store is Dust Wave's static-first commerce layer for products, tickets, RSVPs, and digital downloads. This roadmap tracks the current product surface and future Store-specific hardening. Version history lives in [../CHANGELOG.md](../CHANGELOG.md), and release evidence lives in [release-evidence/](release-evidence/).

## Current State

**Production baseline**

- Store is live at `https://shop.dustwave.xyz` with the Cloudflare Worker at `https://checkout.dustwave.xyz`.
- The primary implementation scope for checkout, fulfillment, admin operations, i18n, accessibility, SEO, Podman, and release evidence is complete.
- The only known external evidence item is production Cloudflare DNS API evidence through the `Release Provider Evidence` GitHub Actions workflow after that workflow exists on `main`; this is an operations gate, not a Store code gap.

## Completed

**Storefront, catalog, and product merchandising**

- [x] Static storefront and catalog source
  - Jekyll renders the public storefront from `_products/`, localized public pages, shared includes, and generated static assets.
  - `_products/*.md` remains the canonical catalog source for Store product IDs, SKUs, variants, fulfillment metadata, shipping presets, tax categories, inventory flags, status, and SEO fields.
  - `api/products.json` exposes the public catalog, `api/add-ons.json` exposes optional add-on suggestions, and `worker/src/generated/catalog-snapshot.js` mirrors catalog truth into the Worker.
- [x] Product browsing and merchandising
  - Product cards and product detail pages include standardized category/title, description, price, option, quantity, inventory warning, and add-to-cart controls.
  - Storefront collection/category taxonomy maps legacy `category: dustwave` and `category: fronteras` values into Store collections while deriving product-type categories for filters.
  - Product draft, archive, sold-out, and public visibility controls drive storefront listings, public JSON, and SEO indexing.
- [x] Store cart runtime
  - Browser cart behavior is Store-owned through `STORE_CONFIG`, `StoreCartProvider`, `StoreCartRuntime`, `window.Store`, `store-add-item`, and `storecart.*` events.
  - Cart quantity controls, variant price syncing, add-on handling, coupon entry, shipping/tax preview states, and reminder-consent capture are handled in the Store runtime before Worker validation.

**Checkout, payment, tax, shipping, and inventory**

- [x] Server-authoritative checkout
  - `/api/cart/validate` and `/api/checkout/intent` validate products, SKUs, variants, prices, quantities, coupons, tip/platform fee policy, tax categories, shipping metadata, fulfillment metadata, and product status against the generated catalog.
  - Paid orders create Stripe PaymentIntents, and free RSVP/free orders confirm without Stripe.
  - Tampered carts fail closed before Stripe work starts.
- [x] Stripe payment boundary
  - Stripe owns card data; Store uses PaymentIntents and confirms paid orders only from signed Stripe webhooks.
  - Stripe receipt emails are suppressed for Store PaymentIntents so Store-owned localized order email stays the single customer receipt path.
  - Payment diagnostics and reconciliation exports include payment intent, charge, balance transaction, card verification, and settlement metadata where available.
- [x] Inventory and scarcity protection
  - `STORE_INVENTORY_COORDINATOR` Durable Objects serialize positive-count SKU reservations, commits, releases, and availability snapshots.
  - Admin inventory baselines and overrides live in KV, while derived projections keep public/admin reads cheap.
  - Failed or canceled payments release reservations.
- [x] Shipping and tax
  - Checkout supports USPS-backed shipping quotes, deployment fallback behavior, delivery options, configured shipping origin, and product shipping presets.
  - Tax quoting is Worker-owned through `/tax/quote`, New Mexico GRT defaults, optional ZIP.TAX support, and persisted order tax details for emails/admin/exports.
  - Cart, checkout, Order Success, admin, email, analytics, and exports read Worker-calculated or persisted totals rather than duplicating tax math in browser code.
- [x] Coupons and pricing controls
  - Admin coupon management stores coupon definitions in KV, and Worker-side coupon application validates status, eligibility, date windows, and discount amounts.
  - Confirmed orders, emails, analytics, and exports preserve saved order pricing.

**Fulfillment, customer communication, and lifecycle jobs**

- [x] Order state and customer lookup
  - Store persists order drafts and confirmed order records in `STORE_STATE`.
  - `/order-success/` and `/es/order-success/` render token-scoped fulfillment state.
  - Customer order lookup requests return generic responses and send short-lived one-time links only when matching orders exist.
- [x] Digital downloads
  - Confirmed digital purchases are durable customer entitlements backed by private `STORE_DOWNLOADS` R2 objects or approved Worker-only fallback URLs.
  - Download actions use short-lived signed URLs with private/no-store headers, and admins can revoke or refresh access per fulfillment item.
  - Reusable digital download library create/replace/delete flows are available from admin.
- [x] Tickets, RSVPs, and physical fulfillment
  - Ticket and RSVP orders produce token-scoped ticket/QR SVGs, calendar files, public ticket lookup behavior where appropriate, and signed check-in links.
  - Admin can check in ticket/RSVP items, refresh attendance totals, search attendees, and export attendee CSVs.
  - Physical orders preserve shipping details and fulfillment state for admin review/export.
- [x] Store-owned transactional email
  - Resend-powered customer confirmations cover physical, digital, ticket, RSVP, coupon, shipping, and total-breakdown scenarios.
  - Super-admin order notification emails send after paid webhook settlement or free-order confirmation and use short-lived one-time admin links into the Orders tab.
  - Calendar invites may be attached where useful, while tickets and check-in QR codes stay on token-scoped order pages for deliverability and safety.
  - `STORE_EMAIL_DRY_RUN` and `RESEND_EMAIL_DRY_RUN` let release smoke verify customer/admin email rendering without calling Resend.
- [x] Reminders and marketing lifecycle
  - Opt-in abandoned-checkout reminders use signed resume/unsubscribe links, bounded queue state, suppression controls, and shared Resend delivery.
  - Event reminder queueing/delivery handles ticket and RSVP reminders on the Worker cron path.
  - Admin Marketing includes referral/UTM link building, QR exports, saved referrals, and suppression controls.

**Admin dashboard and operations**

- [x] Authentication, roles, and safe mutations
  - `/admin/` and `/es/admin/` use magic-link authentication, signed admin sessions, CSRF headers, role/scope checks, and optional Turnstile protection.
  - Runtime admin users and scopes live in KV, while production publish paths use GitHub-backed writes and local dev can use the local repo sidecar.
  - Admin dashboard navigation persistence stores only sanitized local tab/subtab state, and explicit `tab=` links still take precedence.
- [x] Store operations dashboard
  - Settings covers identity, design, SEO defaults, users/scopes, readiness, plan usage, runtime diagnostics, cron status, and observability.
  - Products covers product review, preview, status changes, ordering, publish, bulk publish, inventory controls, media uploads, and product/default media references.
  - Orders covers order review, item-level fulfillment actions, download revoke/refresh, ticket/RSVP check-in, Snipcart import context, and CSV exports.
  - Downloads, Coupons, Analytics, Marketing, and Inventory/Add-ons expose Store-specific admin workflows without reintroducing Snipcart or Pool campaign concepts.
- [x] Exports, audit, and diagnostics
  - Store exports include orders CSV, attendee CSV, reconciliation CSV, audit CSV, and provider/runtime readiness outputs.
  - Admin audit records capture recent KV-backed mutation metadata for operational review.
  - Plan usage and runtime diagnostics expose sanitized Cloudflare/Resend/runtime status without leaking provider secrets.

**Localization, accessibility, SEO, and performance**

- [x] Localization
  - English is the default locale; Spanish UI strings and route shells exist for home, Terms, Orders, Order Success, product presentation pages, and admin.
  - `_config.yml` owns supported languages, route mappings, and language labels; `_data/i18n/*` owns UI/runtime/email copy.
  - Product names, descriptions, and body copy stay creator-authored unless a product defines explicit localized overrides.
  - `npm run test:i18n` and release i18n/SEO evidence protect catalog completeness, placeholders, route copy, language alternates, and localized metadata behavior.
- [x] Accessibility and responsive behavior
  - Public browsing, product controls, cart, checkout, order lookup, Order Success, admin tabs, admin tables, file controls, and async status updates have automated coverage.
  - Release evidence covers axe checks, keyboard add-to-cart, visible focus order, live status updates, reduced motion, 200% text scaling, and mobile overflow.
  - Optional VoiceOver/Whisper transcript evidence can be attached when a release explicitly requires assistive-technology speech evidence.
- [x] SEO and crawl control
  - Public product/home/terms pages emit canonical URLs, localized alternates, Open Graph/Twitter tags, Product/Offer/Breadcrumb/Organization JSON-LD, sitemap entries, and merchant return policy metadata.
  - Admin, token-scoped, order lookup, fulfillment, reminder, and check-in surfaces stay private/noindex or outside public crawl paths as appropriate.
  - `npm run test:seo` validates rendered metadata, JSON-LD, sitemap, robots, private-route noindex behavior, localized `inLanguage`, and product breadcrumbs.
- [x] Performance baseline
  - Public pages are statically rendered, the cart runtime loads lazily, generated assets are minified, and media optimizer checks keep responsive derivatives aligned.
  - Worker reads use generated catalog snapshots, indexed order state, bounded queue-state markers, and explicit admin reads instead of background polling.
  - Formal route-level budgets and Lighthouse automation remain future hardening.

**Security, privacy, backup, and production resilience**

- [x] Security boundaries
  - The Worker is authoritative for cart validation, checkout totals, tax, shipping, inventory reservations, order state, fulfillment actions, admin mutations, and email dispatch.
  - Stripe webhook signatures, signed order/download/check-in/lookup links, CSRF-protected admin mutations, role/scope checks, rate limits, and request-size caps protect the runtime boundary.
  - Secrets stay in Cloudflare Worker secrets, GitHub repository secrets, or ignored `worker/.dev.vars`; repo config and product markdown never hold provider secret values.
- [x] Private data and fulfillment safety
  - Tokenized order/download/admin routes use private/no-store response handling and stay out of public sitemap and social metadata.
  - Customer order lookup avoids existence leaks by returning generic request responses.
  - Digital download object keys stay out of public catalog data unless exposed through signed, order-scoped fulfillment.
- [x] Backup, restore, and rollback guidance
  - [BACKUP_RESTORE.md](BACKUP_RESTORE.md) covers Git product/config history, `STORE_STATE` KV records, `STORE_DOWNLOADS` R2 objects, operator exports, ephemeral-record exclusions, restore order, and verification.
  - Restore guidance uses isolated local/Podman rehearsal instead of staging assumptions.
  - Rollback guidance covers storefront deploys, Worker deploys, bad order state, stuck inventory reservations, and token rotation boundaries.
- [x] Production operations posture
  - Operators are expected to keep Cloudflare Worker secrets, Stripe webhooks, Resend sender domains, USPS/NM GRT settings, `STORE_DOWNLOADS` objects, real inventory baselines, coupons, reminders, lookup, and download-library flows current.
  - Production smoke paths cover paid physical, paid digital, paid ticket, free RSVP, webhook settlement, failed-payment release, admin publish, download replacement, coupon behavior, reminder health, and CSV exports.

**Local development, Podman, setup, deployment, and media**

- [x] Host and Podman development
  - Host development uses Jekyll, Wrangler, and the local repo sidecar on fixed local ports.
  - Podman development provides rootless Storefront and Worker containers, local `worker/.dev.vars` support, Podman Worker smoke, security, media, and headless Playwright paths.
  - `npm run podman:doctor`, `./scripts/dev.sh --podman`, `./scripts/test-worker.sh --podman`, and `npm run test:e2e:headless:podman` support production-like local rehearsal.
- [x] Setup and deployment helpers
  - `npm run setup:deploy` handles local secret generation, production dry runs, Cloudflare KV/R2/Durable Object resource checks, Worker secret writes, GitHub secret writes, optional deploy, and provider readiness.
  - `npm run sync:worker-config` keeps `_config.yml`, product data, Worker vars, and the generated catalog snapshot aligned.
  - Production deploys use the GitHub Pages/static-site path and Cloudflare Worker deploy workflow, with manual Worker deploy support when needed.
- [x] Media and asset workflows
  - Store keeps uploaded product/default media in the repository and uses deterministic optimization/minification tooling instead of Worker-side image processing.
  - Media optimization and minification checks are available for host and Podman paths.
  - Admin upload/publish paths preserve source files and dispatch or suggest existing optimization workflows where appropriate.

**Testing, release evidence, and cross-repo parity**

- [x] Merge gate and focused tests
  - `npm run test:premerge` covers secret/content audits, i18n completeness, syntax checks, focused Store unit tests, full unit tests, generated-site artifact checks, SEO audit, Worker security tests, host Worker smoke, Podman Worker smoke, asset minification checks, and headless Playwright.
  - Unit, Playwright, security, SEO, content-safety, worker-smoke, USPS, and seeded-order paths cover Store-specific checkout, admin, fulfillment, reminders, downloads, tax, shipping, and i18n behavior.
- [x] Release evidence automation
  - `npm run release:smoke` wraps the merge gate, launch readiness, Podman E2E, accessibility evidence, optional VoiceOver/Whisper transcript evidence, rendered i18n/SEO evidence, Worker fulfillment evidence, provider readiness, and payment readiness.
  - Focused release commands exist for accessibility, screen-reader transcript capture, rendered i18n/SEO, Worker fulfillment, provider readiness, and payment smoke.
  - Direct local signed-webhook payment evidence covers paid digital, paid physical, paid ticket, free RSVP, failed-payment suppression, and no-send customer/admin email rendering.
  - `.github/workflows/podman-e2e.yml` provides scheduled non-deploying Podman E2E drift detection, and `.github/workflows/release-provider-evidence.yml` provides production Cloudflare DNS API evidence through GitHub Actions secrets.
- [x] Cross-repo parity and docs-as-code
  - [MERGE_SMOKE_CHECKLIST.md](MERGE_SMOKE_CHECKLIST.md), [PAYMENT_PROCESSOR.md](PAYMENT_PROCESSOR.md), [TESTING.md](TESTING.md), and [release-evidence/v1.0.5.md](release-evidence/v1.0.5.md) document the Store release discipline.
  - Store/Pool parity rules treat shared work as transferable primitives while preserving Store-specific nouns, storage boundaries, checkout, fulfillment, admin, inventory, and SEO behavior.
  - Store release notes are tracked in [../CHANGELOG.md](../CHANGELOG.md), while this roadmap keeps the current capability inventory and future feature plan.

## Future Features

Keep these scoped to Store's goals and data model. Share implementation patterns with Pool where the underlying problem is the same, but do not import Pool-only concepts such as campaigns, pledges, Manage Pledge, embeds, creator diaries, votes, or supporter blasts. Prefer extending existing Store docs, email rendering, admin controls, setup tooling, Worker observability, and release scripts before adding parallel systems.

- [ ] Cross-repo parity and docs-as-code discipline
  - Treat Store and Pool feature parity as transferable slices, not a mandate to copy product surfaces. Shared slices include setup/readiness, media authoring, performance gates, security posture, admin audit/session controls, accessibility evidence, i18n QA, SEO sampling, release smoke scripts, payment reconciliation, backup discipline, and tax-provider hardening.
  - Keep Store-specific nouns and storage boundaries intact: `_products/`, Store orders, physical/digital/ticket/RSVP fulfillment, `STORE_STATE`, `STORE_DOWNLOADS`, `STORE_INVENTORY_COORDINATOR`, Resend transactional email, USPS/NM GRT, customer order lookup, coupons, referrals, abandoned-checkout reminders, event reminders, and the Store admin dashboard.
  - When a Pool feature lands first, port only the reusable primitive and document the Store mapping in the relevant Store docs. Example: a Pool campaign media picker maps to Store product/default media selection, not to a campaign media library.
  - When Store already has the stronger implementation, keep Store as the source pattern and add regression notes so Pool can adopt it without weakening Store behavior.
  - Keep docs-as-code current as each slice lands by updating the owning document, not just this roadmap.
- [ ] Guided setup TUI wrapper
  - Build a thin terminal UI around the existing `scripts/setup-deploy.mjs` setup core instead of creating a separate desktop app or duplicating provider logic.
  - Keep the script-first contract intact: every TUI action should map to an existing setup mode or a small extension of that mode, and CI/non-interactive users should still be able to call the underlying CLI directly.
  - Support Store's current setup paths: local secret generation, production dry run, provider readiness checks, Cloudflare KV/R2/Durable Object resource checks, Worker secret writes, GitHub secret writes, optional deploy, and Podman readiness guidance.
  - Show a step-by-step readiness board for Cloudflare, GitHub, Stripe, Resend, USPS, NM GRT or ZIP.TAX, Turnstile, `STORE_DOWNLOADS`, Worker domains, required credentials, planned mutations, skipped checks, generated local-only secrets, and next actions before live mutations.
  - Keep secrets private in the UI with masked input, no terminal echo, redacted logs, and explicit reminders that production secrets are not copied into `worker/.dev.vars`.
  - Provide copyable fallback commands for failed setup steps so operators can drop back to Wrangler, GitHub CLI, Stripe CLI, or the existing setup script without losing context.
  - Add redacted transcript export covering setup decisions, provider status, command versions, resource IDs, and failure reasons without adding a new telemetry backend.
  - Add smoke-test shortcuts after setup for `podman:doctor`, `./scripts/dev.sh --podman`, `./scripts/test-worker.sh --podman`, `npm run test:secrets`, `npm run test:i18n`, and production readiness checks while leaving orchestration in existing scripts.
- [ ] Product, media, and add-on authoring
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
- [ ] Production quality gates and admin operations hardening
  - Keep the ethical risk review current as a lightweight Store release discipline. New data collection, automation, marketing/reminder behavior, analytics, tokenized links, external providers, and public content workflows should record risk lenses, mitigations, tests, and residual owner/date in the owning docs or release evidence.
  - Add lightweight performance budgets for storefront, cart, checkout, Order Success, order lookup, and admin routes, including JavaScript size, CSS size, image/media weight, Worker response time, and dashboard table/render latency.
  - Add repeatable Lighthouse/PageSpeed checks for core public routes before production deploys, keeping checks scriptable and optional where external provider credentials or stable production URLs are unavailable.
  - Surface Worker timing percentiles and slow-route summaries in admin Plan Usage or Runtime diagnostics using existing performance observation data instead of adding a second telemetry backend.
  - Expand media optimization reporting so uploads show original size, derivative size, optimization status, and expected storefront dimensions.
  - Add cache-status checks for static assets, catalog JSON, add-on JSON, product pages, social image assets, and private/no-store routes so public performance improvements do not weaken checkout, admin, lookup, order, download, reminder, or check-in cache rules.
  - Expand Store readiness so it mirrors the full security guide: Worker secrets, Stripe webhook signatures, Resend senders, R2, CSP, allowed origins, admin users/scopes, Turnstile, production mode, coupons, reminders, order lookup tokens, signed downloads, and `RATELIMIT` posture.
  - Add an admin session/device review screen with recent login metadata and explicit session revocation using the existing admin auth/session/audit model.
  - Expand audit events into a searchable admin audit view with filters and CSV export, reusing existing KV-backed audit records and keeping sensitive payloads redacted.
  - Add signed-download abuse controls: per-order attempt counts, soft lockouts, clearer admin refresh/revocation history, and diagnostics that do not expose raw signed URLs.
  - Add scheduled secret/config posture checks that warn when production-required secrets, webhook endpoints, allowed origins, provider readiness, R2 bindings, or admin user posture drift from expected config; surface results through admin diagnostics and/or GitHub issues instead of silently mutating runtime state.
  - Expand automated axe coverage to the mounted checkout/payment surface when Stripe test fixtures are available locally.
  - Add high-zoom screenshots for cart, checkout, Order Success, order lookup, product editing, download creation, coupon editing, admin order controls, and marketing/referral controls.
  - Keep long product names, long variant names, long filenames, long coupon/referral labels, and tablet/mobile admin rows in regression fixtures.
  - Move any remaining hardcoded public/admin runtime strings into `_data/i18n/*` and runtime message JSON as they are touched.
  - Add localized QA snapshots for download creation, product editing, order lookup, checkout errors, coupon errors, reminder flows, admin status copy, email copy, and fulfillment status copy.
  - Add localized product metadata QA after real translated product copy exists, including canonical URLs, alternate links, Product JSON-LD `availableLanguage`, language switcher behavior, sitemap entries, and social metadata.
  - Define a translator/native-speaker review loop before adding locales beyond English and Spanish, including public shells, product metadata, emails, Terms copy, admin help text, and checkout/order flows.
  - Keep Podman smoke coverage aligned with the host merge gate and monitor scheduled Podman E2E runner reliability.
  - Keep Podman troubleshooting current for stale `gvproxy`, port conflicts, first-run image rebuilds, Wrangler local-state confusion, and Stripe CLI forwarding issues.
  - Sample rendered canonical, alternate, Open Graph, Twitter card, Product JSON-LD, BreadcrumbList, Organization, and merchant return policy tags for active products during production QA.
  - Add rendered SEO QA samples for localized product pages after real translated product copy exists.
  - Update [PERFORMANCE.md](PERFORMANCE.md), [SECURITY.md](SECURITY.md), [ACCESSIBILITY.md](ACCESSIBILITY.md), [I18N.md](I18N.md), [PODMAN.md](PODMAN.md), [SEO.md](SEO.md), [TESTING.md](TESTING.md), [DASHBOARD.md](DASHBOARD.md), and [WORKFLOWS.md](WORKFLOWS.md) as each hardening slice lands.
- [ ] Payment integrity and reconciliation hardening
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
- [ ] Cloudflare Workers Cache performance and read-efficiency hardening
  - Initial `v1.0.6` slice: the default gateway remains uncached, `CachedAdminStoreOrders` is enabled as a named cached entrypoint, non-search admin Orders list reads are normalized through `ctx.exports`, role/scope props partition cached data, browser responses stay private/no-store, mutation invalidation purges order cache tags when `ctx.cache` is available, super-admins can clear known Workers Cache entries, deploys can purge through a dedicated bearer secret, `_config.yml` exposes a route-level kill switch, and focused coverage protects request/header/tag/purge policy.
  - Remaining rollout work: add `since`/`latestKnownUpdatedAt` delta responses, dashboard summary/analytics targets, production `Cf-Cache-Status` smoke evidence, hit/miss/bypass counters, and broader cached-entrypoint inventory as more read paths adopt Workers Cache.
  - Treat Workers Cache as a read-through HTTP cache in front of idempotent Worker `GET`/`HEAD` entrypoints only. KV, R2, Durable Objects, Stripe, Resend, USPS, tax providers, and checked-in catalog data remain the sources of truth.
  - Keep the Worker default/gateway entrypoint uncached so authentication, CSRF checks, role/scope checks, rate limits, request normalization, private-route routing, and write decisions always run before any cacheable inner entrypoint is called.
  - Add named cached entrypoints for reusable expensive reads rather than scattering cache decisions through route handlers. Start with admin Orders deltas/lists, admin dashboard summaries, analytics snapshots, runtime diagnostics that do not expose secrets, inventory availability snapshots, and any Durable Object read wrappers that are safe to serve briefly stale.
  - Make the admin Orders dashboard no-change path the first target: after admin auth succeeds, forward a normalized internal `GET` to a cached Orders read entrypoint keyed by sort/filter/search/page/locale and a stable `since` or `latestKnownUpdatedAt` watermark, so repeated lookups with no new matching orders can return an empty delta or unchanged summary without re-reading KV indexes.
  - Partition authenticated cached reads through `ctx.props` with a minimal admin context such as role/scope hash and, only where needed, admin user ID. Never depend on `Cookie`, `Authorization`, or raw session tokens as cache key material.
  - Strip `Authorization` and other bypass-triggering headers only after the gateway has authenticated the caller and decided the inner response is safe to cache. Keep tokenized order success, order lookup, download, check-in, reminder, admin mutation, webhook, checkout, shipping, tax, and payment routes explicitly private or `no-store`.
  - Create one shared cache policy helper for response headers, TTLs, stale-while-revalidate windows, `Cache-Tag` values, and normalized internal requests so public/admin cache behavior stays DRY and reviewable.
  - Use short, route-specific TTLs for admin reads, with longer stale-while-revalidate only where stale data is harmless and clearly labeled by the existing dashboard refresh/status UI. Do not let a cached admin response hide a just-completed mutation from the operator who performed it.
  - Attach low-cardinality, non-PII cache tags such as `orders`, `admin-orders`, `order-index`, `analytics`, `inventory`, `coupons`, `downloads`, `products`, and version tags where useful. Do not include order tokens, email addresses, customer names, raw session IDs, or signed-link values in tags, URLs, logs, or cache diagnostics.
  - Purge or expire cached reads from the existing mutation boundaries: Stripe webhook settlement/failure, free-order confirmation, admin fulfillment/check-in/download actions, inventory baseline and reservation-affecting changes, coupon changes, product publish/bulk publish/order changes, settings changes, reminder/suppression changes, and download library updates.
  - Keep write paths authoritative if purge fails by using bounded TTLs, visible refresh affordances, audit/runtime diagnostics for purge failures, and targeted revalidation actions. Writes should never depend on cached state for correctness.
  - Evaluate `cross_version_cache` only after initial rollout evidence exists. Leave it off first so deployments naturally cold-start cache entries; if enabled later, tag responses by app/catalog version and add deploy/rollback purge steps so stale cached responses do not mask release changes.
  - Measure Cloudflare usage honestly: cache hits still count as standard Workers requests, while CPU is billed only when the Worker runs. Enabling cache can also make normally free static asset and worker-to-worker invocation paths billable, so avoid enabling cache on broad entrypoints that mostly return `no-store` or cheap static responses.
  - Add before/after usage evidence for Worker CPU time, request counts, KV/R2/provider read counts where observable, admin Orders lookup latency, dashboard summary latency, and cache hit/miss/bypass status. Prefer reducing repeated KV reads, Durable Object reads, provider reads, and CPU over merely moving latency into cache lookup overhead.
  - Add cache-specific security tests for private/no-store routes, authenticated admin partitioning, header stripping, absence of `Set-Cookie` on cacheable inner responses, no PII in cache tags or normalized URLs, and no cache coverage for `POST`/mutation/webhook/payment routes.
  - Add Worker smoke or integration coverage that proves expected `Cf-Cache-Status` behavior for a cacheable admin read: first request misses, repeated no-change request hits or updates, mutation purges the relevant tags, and the next read reflects fresh state.
  - Surface cache status in admin diagnostics without leaking private cache keys: Wrangler version support, cache enabled/disabled state, configured entrypoints, recent purge failures, route-level hit/miss/bypass counters where available, and a safe manual refresh path for operators.
  - Update [PERFORMANCE.md](PERFORMANCE.md), [SECURITY.md](SECURITY.md), [DASHBOARD.md](DASHBOARD.md), [WORKFLOWS.md](WORKFLOWS.md), [TESTING.md](TESTING.md), [BACKUP_RESTORE.md](BACKUP_RESTORE.md), and [../worker/README.md](../worker/README.md) as the cache layer lands, including rollback, purge, and incident-response notes.
- [ ] Backup, restore, and disaster recovery automation
  - Initial `v1.0.6` slice: `scripts/store-backup.mjs` adds dry-run planning, local snapshot manifests, Git/config/provider inventory, secret presence inventory without values, KV/R2 backup plans, R2 download key discovery, restore-plan generation, root npm scripts, and unit tests for classification and command generation.
  - Remaining rollout work: wire in authenticated admin CSV/readiness exports, add isolated local/Podman restore rehearsal fixtures, capture production provider evidence during release smoke, and add operator sign-off prompts for KV value/R2 object exports.
  - Build on the existing [BACKUP_RESTORE.md](BACKUP_RESTORE.md) runbook rather than creating a parallel backup model.
  - Add a small operator helper for repeatable Store snapshots that captures Git commit state, `git bundle` history, dirty diffs, generated Worker/public build outputs, Cloudflare resource IDs, Worker deployment metadata, provider endpoint IDs, sanitized readiness output, and operator exports without committing backup artifacts to the repository.
  - Keep backup implementation DRY by wrapping existing tooling where practical: setup/deploy resource discovery, Worker config sync, catalog snapshot generation, order/attendee/reconciliation/audit CSV exports, and dashboard readiness checks.
  - Back up authoritative KV state by prefix, especially orders, admin users, audit events, inventory overrides/projections, coupons, order lookup indexes, marketing referrals, abandoned-checkout reminders, event reminders, email sent markers, Stripe idempotency/payment markers, observability records needed for incident review, and any future reconciliation/outbox records.
  - Back up `STORE_DOWNLOADS` R2 objects referenced by active product and variant `download.file_key` values, plus approved Worker-only fallback URL mappings as secret/config inventory rather than public catalog data.
  - Explicitly exclude or quarantine ephemeral/sensitive records from normal restore: `admin-session:*`, `admin-login:*`, `RATELIMIT` entries, one-time order lookup tokens, signed resume snapshots, short-lived signed download/check-in URLs, cron health markers, sampled observability rows, and Stripe webhook markers unless the incident specifically requires replay control.
  - Treat secrets as inventory, not backup payload: record required secret names, configured/missing status, provider ownership, rotation notes, and setup commands, but never export production secret values or copy them into `worker/.dev.vars`.
  - Define a restore order that minimizes duplicate-send, duplicate-charge, and inventory drift risk: restore Git product/config/media history first when possible, restore admin access, restore order truth before email/index/projection records, rebuild or verify derived inventory projections, restore download objects, then restore reminder/suppression/send queues only after privacy and duplicate-send review.
  - Document that Durable Object state is not restored directly; scarce SKU reservations should be rebuilt or revalidated from order truth, product config, Stripe state, and inventory projection checks rather than written into Durable Object storage by hand.
  - Add payment-specific restore gates before touching Stripe idempotency, future reconciliation/outbox records, or settled order state, including required isolated local/Podman restore rehearsal, Stripe dashboard/API comparison, duplicate-charge review, and operator signoff before production replay or mutation.
  - Add restore verification using the current Store checks: Jekyll build, `npm run sync:worker-config`, SEO/content-security/secrets/i18n checks, Podman Worker smoke, order/attendee/reconciliation/audit export previews, R2 download checks, observability checks, and admin dashboard review for Products, Coupons, Downloads, Orders, Analytics, Marketing, Settings, and Users.
  - Add tests around backup classification and command generation with fake Wrangler/GitHub/provider CLIs, plus an isolated local/Podman restore rehearsal fixture that proves index/projection repair can recover from missing order indexes or stale inventory projections without KV namespace scans.
- [ ] Tax calculator and compliance hardening
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

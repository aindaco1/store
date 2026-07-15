# Store Roadmap

Store is Dust Wave's static-first commerce layer for products, tickets, RSVPs, and digital downloads. This roadmap tracks the current product surface and future Store-specific hardening. Version history lives in [../CHANGELOG.md](../CHANGELOG.md), and release evidence lives in [release-evidence/](release-evidence/).

## Current State

**Production baseline**

- Store is live at `https://shop.dustwave.xyz` with the Cloudflare Worker at `https://checkout.dustwave.xyz`.
- The primary implementation scope for checkout, fulfillment, admin operations, i18n, accessibility, SEO, Podman, and release evidence is complete.
- `v1.0.6` added Workers Cache and recovery automation. `v1.0.7` added production quality budgets and admin/operations hardening. `v1.0.8` added product/media/add-on authoring, payment-integrity/reconciliation hardening, and durable Store email delivery. The `v1.0.9` candidate adapts Pool `v1.1.2` crawl integrity, policy disclosure, lazy localized admin review, and protected-recovery workflow hardening.
- Published tags are immutable. `v1.0.8` points to exact reviewed and deployed commit `0eb660c`; the GitHub release, Storefront, Worker, canonical configuration, release notes, and evidence were published after production and protected-operations proof.
- `v1.0.8` code-path, deployment, provider, reconciliation, and protected recovery evidence is complete. The owner-approved Pool posture keeps every optional Workers Cache route disabled/evidence-gated and treats the immutable separate-account archive as the required durable recovery copy.
- `v1.0.9` remains a release candidate until its reviewed commit is deployed and the post-deploy crawl/provider checks are recorded; no current evidence is inferred from the prior release.
- Production Cloudflare DNS API evidence is covered by the non-deploying `Release Provider Evidence` GitHub Actions workflow on `main`; ongoing external evidence remains an operations gate, not a Store code gap.

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
- [x] Product, media, and add-on authoring (`v1.0.8`)
  - Store product/default/add-on media stays repository-authoritative. A deterministic rebuildable manifest records image, video, and audio source hashes, dimensions or duration, byte sizes, derivatives, references, optimization state, placement budgets, intentionally skipped larger derivatives, and broken references without creating a second media database.
  - The dashboard provides accessible type/scope/search/sort controls, previews, metadata, source/derived labels, reference visibility, broken-reference and placement warnings, SHA-protected same-scope replacement, explicit decorative-image semantics, and changed/all repair dispatch through the existing optimizer workflow.
  - Media uploads expose original/derivative sizes, optimization status, and expected placement dimensions. Meaningful product images require alt text; empty alt is reserved for explicit decorative state.
  - One shared add-on price contract is mirrored across browser, generated catalog, Worker, and admin normalization: blank variant prices inherit, explicit zero is valid, invalid/negative/over-ceiling values fail, current catalog prices govern new selections, and confirmed orders preserve saved unit prices.
  - Focused media, admin, catalog, and pricing tests plus `npm run media:optimize:check` protect the implementation; [ADD_ON_PRODUCTS.md](ADD_ON_PRODUCTS.md), [DASHBOARD.md](DASHBOARD.md), and [CUSTOMIZATION.md](CUSTOMIZATION.md) own operator guidance.

**Checkout, payment, tax, shipping, and inventory**

- [x] Server-authoritative checkout
  - `/api/cart/validate` and `/api/checkout/intent` validate products, SKUs, variants, prices, quantities, coupons, tip/platform fee policy, tax categories, shipping metadata, fulfillment metadata, and product status against the generated catalog.
  - Paid orders create Stripe PaymentIntents, and free RSVP/free orders confirm without Stripe.
  - Tampered carts fail closed before Stripe work starts.
- [x] Stripe payment boundary
  - Stripe owns card data; Store uses PaymentIntents and confirms paid orders only from signed Stripe webhooks.
  - Stripe receipt emails are suppressed for Store PaymentIntents so Store-owned localized order email stays the single customer receipt path.
  - Payment diagnostics and reconciliation exports include payment intent, charge, balance transaction, card verification, and settlement metadata where available.
- [x] Payment integrity and reconciliation hardening (`v1.0.8`)
  - Stripe API behavior is pinned, retry-safe writes use deterministic idempotency, and redacted observations/errors plus explicit currency and value/booking/webhook/availability times improve auditability without storing raw provider payloads.
  - Signed Stripe webhooks use 10-minute processing leases and 35-day completion markers so replay, failure release, and stale-job resume remain idempotent. Minimized processor events and open/resolved reconciliation breaks retain 400 days.
  - Scheduled and super-admin-triggered reconciliation reads bounded batches from the canonical order index and retrieves Stripe PaymentIntents read-only; it never scans the order namespace or creates, confirms, retries, refunds, or cancels a charge.
  - Crash/resume, signature, mode, replay, journal, reconciliation, and no-second-charge invariants have focused coverage. Ambiguous money states stop for review instead of exposing a manual recovery action.
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
  - A 30-day KV outbox freezes order-confirmation, event-reminder, and consented abandoned-cart payloads after canonical state commits, with deterministic Resend idempotency, 10-minute leases, bounded backoff, and ambiguity stops.
  - Signed Resend/Svix delivery events use 35-day dedupe markers. Minimized delivery evidence and hashed permanent-bounce/complaint suppression retain 400 days, while order and fulfillment truth remain independent of provider success.
  - Short-lived login, super-admin notification, and order-lookup links plus explicit test sends intentionally remain immediate so queue delay cannot consume their validity windows.
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
  - The `v1.0.9` English/Spanish Terms use Pool's numbered plain-language structure adapted to Store orders, shipping, returns, events, downloads, communications, privacy, and open-source boundaries; the Spanish legal copy still requires native/legal review.
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
  - XML and text sitemaps share one selector, emit only real content modification dates, and stay in exact URL parity. `npm run test:seo` validates rendered metadata/feeds while the deploy workflow compares ordinary and Google Inspection responses and fetches every submitted URL with bounded retries.
- [x] Performance baseline
  - Public pages are statically rendered, the cart runtime loads lazily, generated assets are minified, and media optimizer checks keep responsive derivatives aligned.
  - Worker reads use generated catalog snapshots, indexed order state, bounded queue-state markers, and explicit admin reads instead of background polling.
  - Session/audit review is a localized lazy Settings module with a narrow injected API; the core and lazy bundles have separate executable size ceilings and remain inside the aggregate JavaScript budget.
- [x] Production quality gates and admin operations hardening
  - `config/performance-budgets.json` centralizes generated JavaScript/CSS budgets, Lighthouse category/Web Vital/resource budgets, dashboard timing targets, Worker route targets, and public/private cache-policy expectations. Public CSS is split from the admin-only bundle, Inter is served as a licensed local subset, Adobe display fonts no longer block CSS, and priority loading plus responsive head preloading are limited to the catalog-derived LCP candidate.
  - Podman-backed Lighthouse covers home, product, and Terms routes. Cache-policy audits cover static assets, catalog/add-on JSON, products, social images, public order shells, private admin HTML/session APIs, and invalid tokenized order APIs.
  - Existing sampled Worker performance observations now retain bounded histograms and expose p50/p95/p99 plus slow-route summaries in Runtime diagnostics without adding raw requests, customer data, or a second telemetry backend.
  - Store readiness mirrors production security posture across secrets, webhook/email providers, R2, CSP release verification, explicit origins, admin users, Turnstile, production mode, coupons, reminders, lookup signing, signed downloads, and required `RATELIMIT`/state bindings.
  - Super-admins can review/revoke active sessions and inspect 30-day redacted login metadata containing parsed browser/OS/device plus a keyed network fingerprint, never full IP, full user agent, or precise location. Searchable audit filters use redacted KV list metadata for new rows to avoid per-event value reads; filtered CSV still reads complete audit values and legacy rows remain compatible.
  - Signed-download failures are counted per order plus keyed network fingerprint; 10 failures in 15 minutes trigger a 30-minute soft lock. Admin diagnostics expose aggregate counts and access refresh/revocation history without signed URLs or raw IPs.
  - The scheduled Production Posture workflow checks secret names, expected webhook URL, explicit origins, provider evidence, R2/KV/Durable Object bindings, and super-admin posture, then creates or updates a sanitized GitHub issue on actionable drift without mutating runtime state.
  - Existing mounted-checkout axe, 200% scaling, long-content, tablet/mobile admin, SEO, and Podman evidence remain release gates. The scheduled Localization Review workflow validates catalogs/rendered evidence and generates source-hashed review packets for public shells, products, checkout/orders, email, Terms, and admin copy without claiming professional review.
  - English/Spanish completeness and rendered QA cover download creation, product editing, order lookup, checkout/coupon failures, reminders, admin status, email, fulfillment, and the new `v1.0.8` media controls. Store-owned media labels/errors use the shared runtime-message catalog, while user-authored product/media data remains unchanged. Live English/Spanish home, product, and admin samples passed canonical/alternate, social metadata, JSON-LD, noindex, and private/no-store checks after the `v1.0.8` deployment.
  - The `v1.0.8` local candidate passed the full pre-merge and release-smoke wrappers, rendered i18n/SEO evidence, and a fresh source-hashed localization packet. The packet covers public shells, product metadata, checkout/orders, email, Terms, and admin copy, contains no credentials/customer data, and makes no claim of professional review.
  - The recommended dedicated `STORE_FULFILLMENT_SECRET` is configured in the production Worker. Its generated value was piped directly to Cloudflare and only secret-name presence is retained as evidence.
  - The Store-only Resend delivery webhook is enabled for delivered, bounced, complained, failed, and suppressed events. Its secret was piped directly into Cloudflare; an unsigned request failed closed and a no-customer-data provider message produced a signed minimized delivery marker. Production posture, strict DNS/admin response evidence, localization review, and the reviewed deploy all passed from the `v1.0.8` candidate.
  - Stripe Dashboard read-only evidence confirms the live `store-checkout` destination is active at `https://checkout.dustwave.xyz/webhooks/stripe`, listens only for `payment_intent.succeeded` and `payment_intent.payment_failed`, and has four deliveries with zero failures. Cloudflare retains both canonical Stripe webhook secret names; the working secret was preserved rather than rolled for evidence.
  - The first production payment-reconciliation cycle matched all six Stripe-backed orders but exposed 414 false breaks from historical Snipcart imports. The provider-aware algorithm-v2 recheck completed all 420 indexed orders, resolved all 414 stale records, and finished with zero open or unavailable results; no Stripe mutation was performed.
  - [ETHICAL_RISK.md](ETHICAL_RISK.md) records release-specific money, messaging, media, data-retention, admin-power, accessibility, and recovery risks alongside mitigations and residual production owners.
- [x] Cloudflare Workers Cache performance and read-efficiency hardening
  - Authenticated Store admin reads can use the single `CachedAdminStoreReads` policy entrypoint after the uncached gateway authenticates and authorizes every request. All route switches default off. The completed 30-sample production Orders comparison proved correct `HIT`, search-bypass, purge-refill, and zero-warm-KV behavior, but warm p95 improved only 14.41 percent against the required 40 percent and no-change p95 regressed 28.36 percent, so Orders was disabled rather than retaining an unjustified billed inner Worker request.
  - The shared v2 order snapshot supplies Orders, analytics, and sold-count consumers without parallel namespace scans. Deterministic non-PII watermarks let repeated first-page Orders refreshes return `unchanged: true` without retransmitting customer/order rows; browser payloads remain memory-only.
  - Cache policies centralize canonical keys, short route-specific TTLs, low-cardinality tags, mutation dependencies, global/per-route kill switches, deploy/super-admin purge, search bypasses, private/no-store outer responses, non-PII props, failure-only diagnostics, and Workers/KV/R2/provider operation budgets.
  - Download readiness performs one R2 listing and derives attached-object readiness from it when the listing is complete. The discarded post-login dashboard summary request was removed.
  - `npm run cache:benchmark` captures labeled disabled/enabled cold, warm, no-change, search-bypass, and bounded post-purge evidence without persisting credentials, response bodies, or customer data. `npm run cache:compare` fails closed on mislabeled artifacts, inadequate sample counts, non-zero warm/no-change order KV work, unexpected statuses, failed purge refill, or less than 40 percent p95 improvement.
  - The uncached authenticated gateway emits one bounded `store-workers-cache-v1` Analytics Engine data point per eligible admin read with route, cache status, bypass, latency, response size, and expected operation counts only. The telemetry switch is independently configurable; no user, order, URL, query-string, cookie, token, or response-body fields are written, and no KV counter is added.
  - `.github/workflows/workers-cache-evidence.yml` runs at `03:17 America/Denver`, queries aggregate hit ratios, checks a recent cache-read ceiling before its scoped three-read full/warmup/repeat probe, and stores sanitized evidence only. The dedicated evidence credential can read only the fixed cache probe surface; it cannot return Store rows, purge, mutate settings, or invoke payment/fulfillment operations.
  - The `v1.0.8` evidence gate treats an intentionally disabled deployment as `not_applicable`/`no_enabled_candidates` only after the authenticated probe proves sanitization, route matching, consistent disabled state, unchanged repetition, the three-read ceiling, and zero repeat order-data reads. Leaks, mixed enabled/disabled evidence, malformed payloads, and budget violations still fail closed; one configured route is evaluated at a time.
  - Cache evidence is deployment-aware: it scopes Analytics Engine rows to the current deployment, uses weighted p50/p95/p99/min/max queries, reports the slowest sample's cache status and operation budget, and returns `inconclusive` during a configured post-deploy warmup instead of mixing versions or creating a false failure.
  - The first deployed `v1.0.8` cache run passed all seven disabled-route sanitization/budget/consistency checks and truthfully returned `inconclusive/deployment_warmup` at 0.12 hours. The owner approved Pool parity for this release on 2026-07-13: every optional route remains disabled and evidence-gated, with no speculative Analytics rollout or additional timed experiment required for `v1.0.8`.
  - The materialized v2 order index uses a seven-day safety TTL because every order-changing path explicitly invalidates it. Required rebuilds read at most 100 keys per memory-bounded Workers KV bulk operation, reducing the measured 417-order shape from 417 sequential external operations to five while retaining per-key billing evidence and bounded recovery from a missed invalidation. A controlled production invalidation reduced the cold rebuild from `53,109 ms` to `1,658 ms` (96.9 percent), and the steady-state no-change repeat was a `5 ms` `HIT` with zero order-data KV reads/lists.
  - The cache incident procedure covers per-route/global disable through config plus deployment, purge, freshness verification, evidence preservation, rollback, and sequential re-enable. Deploy, cache evidence, and protected recovery share production-operations concurrency.
  - Unit/integration, security, workflow, benchmark, telemetry, and Podman tests protect policy, authorization, data minimization, failure fallback, mutation invalidation, evidence gates, and dashboard refresh behavior.
  - The default gateway and unsafe/tokenized/search routes remain uncached, `cross_version_cache` remains off, and deploy-time purge is retained as defense in depth rather than as a version-isolation dependency.
  - A second fixed-key `CachedAdminStoreOrderIndex` entrypoint deduplicates immediate post-invalidation rebuilds across route/watermark variants, and complementary Lighthouse/resource/cache-policy budgets are enforced separately from edge-route evidence. The cache implementation and kill switches remain available for future data shapes without enabling a route that failed its measured benefit gate.

**Security, privacy, backup, and production resilience**

- [x] Security boundaries
  - The Worker is authoritative for cart validation, checkout totals, tax, shipping, inventory reservations, order state, fulfillment actions, admin mutations, and email dispatch.
  - Stripe webhook signatures, signed order/download/check-in/lookup links, CSRF-protected admin mutations, role/scope checks, rate limits, and request-size caps protect the runtime boundary.
  - Secrets stay in Cloudflare Worker secrets, GitHub repository secrets, or ignored `worker/.dev.vars`; repo config and product markdown never hold provider secret values.
  - GitHub workflows declare explicit least-privilege token permissions and pin every external Action to an immutable commit SHA. Dependabot maintains reviewed Action and root/Worker npm updates; pull-request tests use synthetic credentials and read-only repository access.
  - Release, setup, and backup provider tooling preflights Stripe CLI authentication with captured `stripe whoami`, skips endpoint commands when signed out, and exposes fixed redacted failure categories instead of identity, pairing, URL, or raw authentication output.
- [x] Private data and fulfillment safety
  - Tokenized order/download/admin routes use private/no-store response handling and stay out of public sitemap and social metadata.
  - Customer order lookup avoids existence leaks by returning generic request responses.
  - Digital download object keys stay out of public catalog data unless exposed through signed, order-scoped fulfillment.
- [x] Backup, restore, and disaster recovery automation
  - [BACKUP_RESTORE.md](BACKUP_RESTORE.md) and `config/store-data-inventory.json` define recovery objectives, retention guidance, source-of-truth/sensitivity/restore classifications, quarantine rules, restore order, and verification for all known Store KV, R2, and Durable Object families. `npm run backup:inventory:audit` prevents unclassified storage families from shipping.
  - The Store owner/operator approved the documented RPO/RTO, four-hour active-sales snapshot interval, and 7-daily/5-weekly/12-monthly plus release retention policy on 2026-07-10. Inventory audit fails if approval metadata or interval alignment drifts.
  - Shared command, Wrangler/TOML, file-integrity, data-inventory, admin-export, and structured provider helpers keep setup, provider evidence, backup, restore, and release tooling DRY.
  - Snapshot v2 captures private-permission Git/config/build/Wrangler/deployment/version/secret-name/provider evidence with SHA-256 coverage for every payload plus the finalized manifest. Remote reads remain opt-in; secret values are never exported.
  - Sensitive KV values, R2 objects, and one-time authenticated admin exports require an outside-repository destination, exact acknowledgement, HTTPS except for loopback development, contained admin/R2 paths, operator-selected age/GPG encryption, and decryptability verification. Temporary plaintext archives and sensitive staging are removed on success or failure.
  - Download discovery includes attached and unattached R2 library objects, records requested/completed object counts, and refuses missing bucket identity or path-escaping keys.
  - `npm run restore:plan` verifies complete manifests/checksums and defaults to no writes. It rejects duplicate, unlisted, symbolic-link, unsupported, path-escaping, malformed, or missing-value artifacts and stops execution after the first failed provider command.
  - Local/preview execution requires an explicit conflict policy; production additionally requires maintenance, paused Stripe webhooks, inventory review, a checksum-valid and distinct pre-restore snapshot, and exact typed acknowledgement. Production restore remains operator-gated and is never scheduled automatically.
  - Restore excludes sessions, nonces, rate limits, one-time capabilities, and other quarantined state; it schedules the v2 order index and other derived data for repair rather than treating projections or Durable Object reservations as authoritative.
  - `npm run restore:rehearse` runs a representative synthetic Podman-backed integrity/restore drill covering physical, digital, ticket, RSVP, failed-payment, payment/email/reminder idempotency, audit, inventory-control, R2, quarantine, and derived-repair classes with no production data or provider writes.
  - Preview R2 execution requires an explicit bucket distinct from the captured source bucket and uses the supported remote R2 CLI path rather than the KV-only `--preview` flag. Production execution retains all maintenance, Stripe, inventory, pre-snapshot, and typed acknowledgement interlocks.
  - `npm run backup:readiness` combines the canonical inventory audit, metadata-only backup plan, credential-name presence, tool/encryption availability, sanitized provider evidence, snapshot age, and rehearsal age. `npm run backup:retention` is plan-only by default and protects newest, release, daily, weekly, monthly, invalid, unencrypted, symlinked, or checksum-mismatched snapshots before any exact-acknowledgement prune; execution resolves the real external root and recomputes eligibility immediately before deletion.
  - Release smoke now records provider evidence, the representative Podman rehearsal, and backup/recovery readiness. `.github/workflows/recovery-readiness.yml` runs the same synthetic/read-only contracts weekly at `03:43 America/Denver`.
  - `.github/workflows/recovery-operations.yml` schedules a Worker-wide Cloudflare traffic preflight quarterly at `04:17 America/Denver`. Its captured-data path is disabled by default, shares production concurrency, requires the protected `production-recovery` environment, a dedicated age identity and fresh one-time admin token, and can restore only to explicit preview KV/R2 resources. Detailed restore output remains in private temporary storage and is removed before artifact upload; no unattended production restore path exists.
  - Complete sensitive snapshots chunk KV reads at Cloudflare's 100-key limit, normalize both current raw-string and legacy structured Wrangler bulk output, require complete R2 API enumeration when requested, fail on missing object downloads, and expose only sanitized coverage fields in the encrypted receipt.
  - Snapshot receipts include aggregate duration plus KV list/bulk/per-key, R2 inventory/object/byte, and admin-export read counts so the approved interval can be reviewed against measured Cloudflare usage without exposing values.
  - `npm run backup:offsite` plans and verifies append-only encrypted archive copies to a destination outside the repository, requires a distinct filesystem device for execution by default, verifies checksum readback, and can prove age decryption to `/dev/null`. Provider-neutral S3-compatible protected archives remain available without requiring AWS.
  - A live operator-controlled age snapshot captured 444 production KV records across 14 authoritative/control families plus the one object in a completely enumerated R2 bucket. The checksum-valid archive was decrypted in an isolated local directory, planned with 70 integrity artifacts and no invalid/missing families, restored to empty preview KV/R2 resources with seven commands, read back across all 444 records and the R2 checksum, and removed from preview with zero residual snapshot-owned data.
  - `npm run recovery:reconcile` produces aggregate-only Store inventory and read-only Stripe comparison evidence, rejects live/test credential-mode mismatch before provider access, and never emits customer, order, provider, or credential identifiers. A super-admin inventory recovery endpoint reuses the same bounded provider comparator and fingerprints its result with Store/Durable Object state; distinct maker/checker approval, short-lived quarantined approval state, maintenance/Stripe/reservation interlocks, exact acknowledgement, audit records, and cache invalidation gate execution instead of importing Durable Object storage.
  - The protected quarterly path now requires complete R2 discovery, a restricted live Stripe read credential, verified S3 off-account upload, preview readback, and exact-snapshot preview cleanup. Cleanup runs explicitly after success and best-effort after partial failure; raw restore/verification output remains temporary.
  - The `v1.0.8` protected path fails closed before customer-data capture unless the archive account differs from production, the Cloudflare R2 endpoint matches that account, the destination is a Store-only prefix, the lock is exactly 400 days, and a non-sensitive canary proves byte-identical readback, deletion rejection, and post-rejection readback.
  - Store now has a private Standard `store-recovery-archive` bucket in the same separate Cloudflare recovery account used by Pool, but with its own bucket-scoped Object Read & Write credential and `store/` namespace. Public access is disabled, no custom domain exists, and the enabled 400-day prefix lock rejected the bootstrap canary deletion with HTTP 409 while preserving byte-identical readback.
  - The protected `v1.0.8` run captured 793 authoritative/control KV values across 19 families, one completely enumerated R2 object, and six authenticated admin exports in an age-encrypted archive. The separate-account upload/readback, 400-day lock, 793-value/one-object preview restore and readback, and zero-residual cleanup passed; capture took 87.123 seconds and the full drill took 158 seconds.
  - The dedicated restricted live-mode Stripe key compared all six Stripe-backed captured orders with six matches, zero mismatches/unavailable/not-found objects, and zero provider writes. Current-receipt recovery readiness then passed seven checks with no warning or failure. The one-time admin token was deleted and the protected drill switch was disabled again after success.
  - The owner approved Pool-aligned recovery posture for `v1.0.8` on 2026-07-13: the encrypted, byte-verified, 400-day-locked separate-account archive is the required durable copy. A physical second-device copy remains an available `backup:offsite` enhancement, not a release gate.
  - Unit tests cover inventory completeness, snapshot safety, transport/path containment, manifest tampering/completeness, restore gates, missing-value blocks, quarantine, representative classes, retention safeguards, readiness ages, preview bucket isolation, repair planning, and fail-fast command generation.
  - Rollback guidance covers storefront deploys, Worker deploys, bad order state, stuck inventory reservations, and token rotation boundaries.
- [x] Production operations posture
  - Operators are expected to keep Cloudflare Worker secrets, Stripe webhooks, Resend sender domains, USPS/NM GRT settings, `STORE_DOWNLOADS` objects, real inventory baselines, coupons, reminders, lookup, and download-library flows current.
  - Production smoke paths cover paid physical, paid digital, paid ticket, free RSVP, webhook settlement, failed-payment release, admin publish, download replacement, coupon behavior, reminder health, and CSV exports.

**Local development, Podman, setup, deployment, and media**

- [x] Host and Podman development
  - Host development uses Jekyll, Wrangler, and the local repo sidecar on fixed local ports.
  - Podman development provides rootless Storefront and Worker containers, local `worker/.dev.vars` support, Podman Worker smoke, security, media, and headless Playwright paths.
  - Runtime-dependent defaults now use Podman-backed wrappers: `npm run test:security`, `npm run test:e2e`, and `npm run test:e2e:headless` run against the production-like local Storefront/Worker stack unless an explicit host alias is used.
  - Podman-backed security, Worker smoke, and Playwright wrappers reset isolated Wrangler/Miniflare state before test stack startup, validate real `/api/cart/validate` readiness instead of accepting open ports alone, and use a stop-file shutdown path so skipped Stripe forwarding cannot terminate the parent test process group.
  - `npm run podman:doctor`, `./scripts/dev.sh --podman`, `./scripts/test-worker.sh --podman`, `./scripts/podman-stack-run.sh <command...>`, and `npm run test:e2e:headless:podman` support production-like local rehearsal.
  - [PODMAN.md](PODMAN.md) and the merge checklist cover stale `gvproxy`, port conflicts, first-run image rebuilds, Wrangler local-state corruption/confusion, Stripe CLI forwarding, and the resource gate that keeps host and Podman smoke behavior aligned.
- [x] Setup and deployment helpers
  - `npm run setup:deploy` handles local secret generation, production dry runs, Cloudflare KV/R2/Durable Object resource checks, Worker secret writes, GitHub secret writes, optional deploy, and provider readiness.
  - `npm run sync:worker-config` keeps `_config.yml`, product data, Worker vars, and the generated catalog snapshot aligned.
  - Production deploys use the manual **Deploy Production** workflow for the GitHub Pages/static-site path, Cloudflare Worker deploy, Workers Cache purge, and optional Cloudflare zone purge; release merges/tags do not deploy automatically.
- [x] Media and asset workflows
  - Store keeps uploaded product/default media in the repository and uses deterministic optimization/minification tooling instead of Worker-side image processing.
  - Media optimization and minification checks are available for host and Podman paths.
  - Admin upload/publish paths preserve source files and dispatch or suggest existing optimization workflows where appropriate.

**Testing, release evidence, and cross-repo parity**

- [x] Merge gate and focused tests
  - `npm run test:premerge` covers secret/content audits, i18n completeness, syntax checks, focused Store unit tests, full unit tests, generated-site artifact checks, SEO audit, Worker security tests, host Worker smoke, Podman Worker smoke, asset minification checks, and headless Playwright.
  - Unit, Playwright, security, SEO, content-safety, worker-smoke, USPS, and seeded-order paths cover Store-specific checkout, admin, fulfillment, reminders, downloads, tax, shipping, and i18n behavior.
  - `npm run test:unit:coverage` is reproducible from the declared Vitest v8 provider and reports text/HTML diagnostics; release confidence remains risk-based across focused unit, Podman security, Worker smoke, and browser gates rather than a misleading aggregate percentage alone.
- [x] Release evidence automation
  - `npm run release:smoke` wraps the merge gate, launch readiness, Podman E2E, accessibility evidence, optional VoiceOver/Whisper transcript evidence, rendered i18n/SEO evidence, Worker fulfillment evidence, provider readiness, and payment readiness.
  - Focused release commands exist for accessibility, screen-reader transcript capture, rendered i18n/SEO, Worker fulfillment, provider readiness, and payment smoke.
  - Direct local signed-webhook payment evidence covers paid digital, paid physical, paid ticket, free RSVP, failed-payment suppression, and no-send customer/admin email rendering.
  - `.github/workflows/podman-e2e.yml` provides scheduled non-deploying Podman E2E drift detection, and `.github/workflows/release-provider-evidence.yml` provides production Cloudflare DNS API evidence through GitHub Actions secrets.
  - Stripe CLI readiness regression coverage proves signed-out environments do not invoke endpoint commands or surface interactive authentication output.
  - The `v1.0.8` adaptation and release record separates local code-path passes from deployment, provider, edge-cache, and protected recovery evidence, including explicit owner-approved Pool-aligned dispositions rather than inferred passes.
  - The `v1.0.9` release record maps every Pool `v1.1.2` item to adopted, already-present, Store-adapted, or Pool-only status and keeps live crawl/deployment evidence open until the candidate is published.
- [x] Cross-repo parity and docs-as-code
  - [MERGE_SMOKE_CHECKLIST.md](MERGE_SMOKE_CHECKLIST.md), [PAYMENT_PROCESSOR.md](PAYMENT_PROCESSOR.md), [TESTING.md](TESTING.md), and [release-evidence/](release-evidence/) document the Store release discipline.
  - Store/Pool parity rules treat shared work as transferable primitives while preserving Store-specific nouns, storage boundaries, checkout, fulfillment, admin, inventory, and SEO behavior.
  - Store release notes are tracked in [../CHANGELOG.md](../CHANGELOG.md), while this roadmap keeps the current capability inventory and future feature plan.

## Future Features

Keep these scoped to Store's goals and data model. Share implementation patterns with Pool where the underlying problem is the same, but do not import Pool-only concepts such as campaigns, pledges, Manage Pledge, embeds, creator diaries, votes, or supporter blasts. Prefer extending existing Store docs, email rendering, admin controls, setup tooling, Worker observability, and release scripts before adding parallel systems.

- [ ] Guided setup TUI wrapper
  - Build a thin terminal UI around the existing `scripts/setup-deploy.mjs` setup core instead of creating a separate desktop app or duplicating provider logic.
  - Keep the script-first contract intact: every TUI action should map to an existing setup mode or a small extension of that mode, and CI/non-interactive users should still be able to call the underlying CLI directly.
  - Support Store's current setup paths: local secret generation, production dry run, provider readiness checks, Cloudflare KV/R2/Durable Object resource checks, Worker secret writes, GitHub secret writes, optional deploy, and Podman readiness guidance.
  - Show a step-by-step readiness board for Cloudflare, GitHub, Stripe, Resend, USPS, NM GRT or ZIP.TAX, Turnstile, `STORE_DOWNLOADS`, Worker domains, required credentials, planned mutations, skipped checks, generated local-only secrets, and next actions before live mutations.
  - Keep secrets private in the UI with masked input, no terminal echo, redacted logs, and explicit reminders that production secrets are not copied into `worker/.dev.vars`.
  - Provide copyable fallback commands for failed setup steps so operators can drop back to Wrangler, GitHub CLI, Stripe CLI, or the existing setup script without losing context.
  - Add redacted transcript export covering setup decisions, provider status, command versions, resource IDs, and failure reasons without adding a new telemetry backend.
  - Add smoke-test shortcuts after setup for `podman:doctor`, `./scripts/dev.sh --podman`, `./scripts/test-worker.sh --podman`, `npm run test:secrets`, `npm run test:i18n`, and production readiness checks while leaving orchestration in existing scripts.
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

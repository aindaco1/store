# Changelog

## v1.1.0 - Unreleased

### Shared platform foundation

- Added the pinned `aindaco1/dust-wave-platform` submodule as the versioned boundary for primitives shared with Pool, Dust Wave, and Podcast.
- Moved the byte-identical Turnstile implementation into `@dustwave/worker-core` while retaining Store's local import seam and adding a consumer contract test.
- Advanced the shared boundary to `@dustwave/worker-core` 0.2.0, which adds
  typed product-neutral crypto and Stripe mechanics for Podcast without moving
  Store business rules or changing Store's existing Turnstile adapter.
- Kept Store's catalog, order, inventory, fulfillment, configuration, session, storage, and deployment authority independent; the submodule contains no Store data or secrets and can be rolled back by pointer.

## v1.0.9 - 2026-07-15

### Crawl integrity, policy clarity, and release hardening

- Added `/sitemap.txt` beside the canonical XML sitemap, with both formats generated from one shared public-page/product selector so archived, private, test-only, and non-indexable content cannot drift between crawl feeds.
- Stopped inventing sitemap freshness from build time. XML `lastmod` now appears only when content supplies a real `last_modified_at`, and generated audits reject malformed XML, XML/text parity drift, duplicates, private URLs, and invalid or future timestamps.
- Added a dependency-free post-deploy crawl audit that compares ordinary and Google Inspection sitemap responses, validates sitemap/robots status and MIME types, and fetches every submitted public URL with bounded propagation retries.
- Rewrote the English and Spanish Terms with Pool's numbered plain-language structure, adapted to Store's immediate orders, canonical totals, physical fulfillment, tickets/RSVPs, durable downloads, transactional communications, private access links, data handling, and open-source boundary. Store's default remains final sale for change of mind while preserving remedies for damage, defects, incorrect or missing goods, shipment delays, canceled or unfulfilled items, duplicate charges, fraud, and legally required cases.
- Added direct localized Shipping and Return Policy links beside the footer mark on desktop/tablet and below Terms in the mobile menu, with checkout disclosing final-sale status before payment. Responsive browser coverage now enforces the same placement and small-screen behavior as Pool.
- Kept merchant return metadata fork-configurable while making `MerchantReturnNotPermitted` the Store default, omitting fictitious return windows/methods/fees from JSON-LD and mirrored Worker settings when returns are disabled.
- Moved active-session review/revocation and searchable audit review/CSV UI into a localized, lazy Settings module with a narrow injected API, reducing the core minified admin bundle below its executable budget without adding a second admin state model.
- Added a protected-recovery workflow regression guard for Ubuntu 24.04: install `age`, use the AWS CLI v2 already supplied by GitHub-hosted runners, and never request the unavailable apt `awscli` package.
- Preserved the existing fail-closed host/Podman Jekyll build behavior and added regression coverage so minification and artifact checks cannot validate stale `_site` output after a failed build.
- Aligned local and production storefront visibility through one shared public active/sold-out predicate used by both the home grid and its LCP preload. This removes archived/private catalog markup from local public pages, cut the audited home document from about 330 KB to 197 KB, and reduced mobile Lighthouse LCP from about 4.3 seconds to 2.8 seconds.

## v1.0.8 - 2026-07-13

### Store reliability, media, and operations

- Moved and refreshed `AGENTS.md` at the repository root so Store checkout, payment recovery, email durability, media authority, retention, and release invariants are discovered automatically.
- Added one shared add-on price resolver across browser cart, generated catalog, Worker validation, and admin serialization. Blank variant prices inherit the product price, explicit zero remains valid, current catalog prices govern new selections, confirmed order prices remain historical, and every path enforces the existing $1,000,000 ceiling.
- Added a deterministic repository media manifest for image, video, and audio sources with hashes, dimensions/duration, sizes, derivatives, references, optimization state, placement budgets, intentionally skipped derivatives, and broken-reference evidence.
- Expanded Store product media administration with accessible type tabs, search/sort/scope filters, previews, metadata and warnings, reference visibility, SHA-protected same-scope source replacement, explicit decorative-image semantics, and changed/all repair dispatch through the existing optimizer workflow.
- Hardened Stripe requests with an explicit API version, deterministic idempotency on retry-safe writes, redacted errors and observations, explicit currency/value/booking/availability times, 35-day webhook dedupe markers with processing leases, and a 400-day minimized processor-event journal.
- Added bounded scheduled and super-admin-triggered read-only reconciliation from the canonical order index to Stripe PaymentIntents. The Stripe-specific comparator skips historical orders owned by other processors and versioned rechecks resolve stale provider-mismatch breaks. Open/resolved reconciliation breaks retain 400 days and no reconciliation path scans the order namespace or creates/retries charges.
- Added a 30-day KV email outbox for order confirmations, event reminders, and opted-in abandoned-cart reminders, with frozen provider payloads, deterministic Resend idempotency, bounded retry/backoff, crash leases, signed delivery webhooks, 400-day minimized delivery/suppression evidence, and permanent-bounce/complaint suppression.
- Updated canonical config synchronization, setup, secret inventory, admin readiness, data inventory, backup ordering, pre-merge coverage, operator docs, and roadmap status for these changes.

## v1.0.7 - 2026-07-11

### Post-release hardening

- Pinned every GitHub Actions dependency to an immutable commit SHA, added monthly Dependabot updates for Actions plus both npm lockfiles, and made Merge Smoke's read-only token permission explicit.
- Reduced the Deploy Production build job to `contents: read`; Pages write and OIDC permissions now exist only on the deploy job that requires them.
- Added the missing Vitest v8 coverage provider so `npm run test:unit:coverage` runs non-interactively from a clean install, with regression coverage for the declared dependency.
- Prevented release, setup, and backup probes from starting Stripe CLI interactive login: they now require a successful captured `stripe whoami` check before endpoint reads and use fixed redacted failure reasons so pairing details and authentication URLs cannot enter logs or manifests.
- Fixed the post-release Localization Review workflow by pinning Ruby 3.2 and added workflow regression coverage for clean GitHub-hosted runners.
- Recorded the post-release 30-sample production Orders decision: correctness and zero-warm-KV gates passed, but the latency-benefit gate failed, so all optional admin read-cache route switches remain off.

### Initial release scope

- Approved and versioned the Store recovery objectives, four-hour active-sales snapshot interval, and 7-daily/5-weekly/12-monthly plus release-snapshot retention policy in the canonical data inventory.
- Added aggregate snapshot duration/Cloudflare read-usage evidence, a checksum-verified append-only off-device filesystem copy and second-device decryption path, and provider-neutral S3-compatible protected archive configuration without requiring AWS.
- Added `CachedAdminStoreOrderIndex`, a fixed-key cache entrypoint that deduplicates immediate post-invalidation order-index rebuilds across Orders watermark and route variants while preserving authenticated private/no-store gateway responses and explicit operation budgets.
- Added centralized generated-asset, Lighthouse/Web Vital/resource, Worker-route, dashboard-timing, and public/private cache-policy budgets; split admin-only CSS from the public bundle, self-hosted a licensed Inter subset, deferred Adobe CSS, optimized a missing product image derivative set, and limited eager/synchronous image work plus responsive head preloading to the actual catalog-derived LCP candidate.
- Added super-admin active-session review/revocation with 30-day minimized login metadata, keyed network fingerprints, parsed client summaries, and no full IP, full user agent, or precise location retention.
- Added searchable redacted admin audit filters plus filtered CSV export, using KV list metadata to avoid per-event value reads for new interactive searches while preserving complete CSV and legacy-row fallback; added aggregate signed-download abuse diagnostics, access history, and a 10-failures/15-minute per-order+network soft lock lasting 30 minutes without storing signed URLs or raw IPs.
- Expanded Store readiness to cover production mode, explicit origins, state/rate-limit bindings, admin posture, Turnstile, lookup/download signing, coupons, reminders, providers, R2, and CSP release verification; added bounded Worker timing histograms with p50/p95/p99 slow-route diagnostics.
- Added scheduled Production Posture and Localization Review workflows. Posture drift creates or updates a sanitized GitHub issue without runtime mutation; localization generates source-hashed human-review packets without claiming professional translation.
- Expanded Workers Cache, recovery/off-device, session privacy, download abuse, performance/cache-policy, localization, posture, workflow-security, and production-like Podman browser test coverage.

## v1.0.6 - 2026-07-09

- Added a Cloudflare Workers Cache integration for authenticated admin Orders list reads using a cached named Worker entrypoint while keeping the default gateway and browser-facing admin responses private/no-store.
- Consolidated authenticated admin caching under `CachedAdminStoreReads`, added the v2 order snapshot/watermark and minimal no-change Orders refresh contract, removed the unused login summary request, and made inventory reuse the shared order snapshot instead of repeating KV namespace reads.
- Added disabled-by-default cache policies for Analytics, order-derived inventory, and R2 download readiness with route-specific TTLs, canonical keys, global/per-route switches, dependency tags, mutation-driven purge, failure-only diagnostics, and explicit Workers/KV/R2/provider operation budgets.
- Added a super-admin Workers Cache clear action, a deploy-time Workers Cache purge hook with `WORKERS_CACHE_PURGE_SECRET`, and a `_config.yml`/Settings kill switch for admin Orders caching.
- Added a localized manual Orders refresh control, in-memory watermark reuse, cache benchmark/smoke tooling, and expanded policy, endpoint, mutation, no-change, benchmark, and Podman dashboard coverage.
- Expanded cache evidence tooling with labeled disabled/enabled route benchmarks, bounded audited purges, a fail-closed 30-sample/40%-p95 comparator, sanitized Analytics Engine hit/read/latency telemetry, and a configurable telemetry kill switch.
- Added a dedicated rate-limited `WORKERS_CACHE_EVIDENCE_SECRET` probe that returns bounded full-read, no-change warmup, and no-change repeat metrics without Store rows, plus a nightly low-traffic GitHub Actions collector for aggregate cache ratios and sanitized evidence.
- Added Workers Cache policy tests for admin Orders request normalization, search bypasses, kill-switch behavior, role/scope partitioning, cache headers, shared purge helpers, and internal purge authorization.
- Made Workers Cache observability deployment-aware with weighted p50/p95/p99/min/max evidence, slowest-sample cache/operation diagnostics, stable-deployment warmup classification, and no cross-version aggregation; extended the materialized order-index TTL to seven days because all order-changing paths explicitly invalidate it, removing the measured periodic full-order rescan cliff.
- Replaced sequential order-index rebuild reads with memory-bounded Workers KV bulk reads of at most 100 keys per operation after a post-deploy probe measured a 53.1-second 417-order bootstrap. The rebuild now uses five external KV operations for that data shape while retaining 417 per-key reads in billing and operation-budget evidence.
- Fixed production loopback dispatch to specialize `ctx.exports` bindings with trusted `ctx.props` before `fetch`, made scoped evidence fail closed on inner non-2xx responses, and added bounded deploy-time purge retries for transient Worker propagation failures.
- Deferred admin Turnstile loading until an existing session check fails, removing the hidden Cloudflare challenge runtime from authenticated dashboard tabs without weakening signed-out magic-link protection.
- Added a path-scoped Cloudflare Cache Response Rule plus credential-free deployment/provider verification for admin HTML, setting `no-transform` and private/no-store directives so Cloudflare JavaScript Detection and automatic Web Analytics injection cannot conflict with the strict admin CSP or browser privacy blockers.
- Hardened admin CSP diagnostics by rejecting unexpected production report-only policies, prohibiting dynamic string evaluation in first-party admin scripts, and documenting extension-free reproduction before changing security policy.
- Added shared provider-bound country/postal validation so malformed shipping and tax destinations fail before USPS or tax-provider access, and made the security suite deterministic instead of depending on live provider latency.
- Added repeatable backup/restore snapshot automation with dry-run planning, Git/config/provider inventory, KV/R2 backup plans, secret presence inventory without values, and restore-plan generation.
- Expanded backup/restore automation with a canonical machine-readable data inventory, maintained TOML parsing, shared CLI/provider helpers, snapshot v2 checksums and private permissions, isolated build evidence, deployment/version/secret-name evidence, one-time admin exports, complete R2 library discovery, and encryption/acknowledgement gates for sensitive data.
- Added guarded restore planning and execution for local, preview, and production targets, including checksum validation, authoritative-record validation, quarantine exclusions, derived-index repair, production traffic/Stripe/inventory/pre-snapshot interlocks, and a passing Podman synthetic restore drill.
- Expanded the Podman restore drill with representative physical, digital, ticket, RSVP, failed-payment, idempotency, reminder, audit, inventory, quarantine, derived-repair, and R2 fixtures while proving no production data or side-effect provider command is used.
- Added sanitized backup/recovery readiness and exact-acknowledgement retention planning, including snapshot/rehearsal age checks, real-root/symlink defenses, immediate pre-delete eligibility revalidation, and protection for newest, release, daily, weekly, monthly, invalid, unencrypted, or checksum-mismatched snapshots.
- Integrated provider, representative restore, and recovery-readiness evidence into release smoke; added weekly synthetic recovery Actions and a disabled-by-default quarterly protected captured-data workflow with Worker-wide low-traffic/error preflight, preview-only restore, and temporary detailed restore output excluded from uploaded evidence.
- Fixed the quarterly recovery workflow to keep runner-temporary paths in step scope, allowing its low-traffic preflight to run while the protected captured-data job remains disabled by default.
- Fixed preview R2 restore planning to require an explicit bucket distinct from the captured source and to avoid passing Wrangler's KV-only `--preview` flag to R2 object commands.
- Hardened operator backup/restore paths against non-TLS token exchange, admin URL and R2 path traversal, symlink/unlisted snapshot artifacts, repository or repository-linked sensitive output paths, missing value artifacts, unverified/reused pre-restore snapshots, plaintext archive residue, and continued writes after a failed restore command.
- Hardened captured backups for live Wrangler behavior by chunking KV bulk reads at 100 keys, accepting raw-string and legacy structured values through one shared normalizer, requiring complete R2 API enumeration/downloads, sanitizing encrypted receipts, and covering encrypted CLI completion output.
- Added aggregate-only captured-order/inventory/Stripe reconciliation with explicit live/test credential-mode gates, plus a reviewed super-admin Durable Object inventory rebuild operation with plan fingerprinting, distinct maker/checker approval, exact execution interlocks, audit evidence, and cache invalidation.
- Extended the quarterly protected recovery path with a required restricted live Stripe read key, verified S3 off-account archive upload, full preview KV/R2 readback, exact-snapshot cleanup after success or partial failure, and sanitized restoration/cleanup evidence.
- Completed an operator-controlled live encrypted snapshot and preview rehearsal: 444 KV records and one completely enumerated R2 object passed checksum planning, preview restore, value/object readback, and zero-residual cleanup; admin-export, second-device, live Stripe, and durable off-account proofs remain operational gates.
- Made runtime-dependent security and E2E test defaults Podman-backed, reset isolated Wrangler/Miniflare state for Podman test wrappers, tightened Podman readiness around real Worker cart validation, changed the Playwright container refresh to lockfile-preserving `npm ci`, and fixed Podman teardown so skipped Stripe forwarding cannot terminate the parent test process group.
- Added a 6 GiB Podman machine resource gate for pre-merge and release smoke on macOS/Windows after a 4 GiB VM stopped during repeated full browser runs; standardized E2E navigation on DOM readiness plus explicit application assertions; and bounded font readiness so malformed or slow fonts cannot consume a full test timeout.
- Upgraded Vitest and esbuild, refreshed vulnerable development transitive dependencies to reach a clean npm audit, migrated security tests to Vitest 4's serial file configuration, and serialized same-isolate rate-limit KV updates so concurrent bursts cannot lose increments.
- Bounded the 69-file unit suite at four workers and increased its timeout budget to 30 seconds for subprocess-heavy backup/setup tests, keeping release-load contention deterministic without weakening application or security request timeouts.
- Changed production deploys to run only from the manual **Deploy Production** workflow so release merges and tags can be prepared without deploying.
- Updated Worker, performance, security, dashboard, testing, workflows, and backup/restore docs for the cached admin Orders path, manual production deploys, and backup automation.

## v1.0.5 - 2026-07-05

- Added a Store release smoke wrapper that records evidence across the pre-merge gate, launch readiness, Podman E2E, accessibility coverage, optional VoiceOver/Whisper transcript evidence, rendered i18n/SEO checks, Worker fulfillment checks, provider readiness, and payment readiness.
- Added focused release evidence commands for accessibility, screen-reader transcripts, rendered i18n/SEO, Worker fulfillment, provider readiness, and payment smoke so release-critical checks can be rerun independently.
- Added a Store merge smoke checklist with local/Podman production-like rehearsal replacing nonexistent staging targets.
- Added cross-repo parity rules to the roadmap so Store and Pool can share reusable implementation patterns without copying project-specific surfaces.
- Added a Store payment processor guide covering the Stripe PaymentIntent boundary, signed webhook settlement, fulfillment, reconciliation, provider checks, and no-send email evidence.
- Added direct local signed-webhook payment evidence for paid digital, paid physical, paid ticket, free RSVP, and failed-payment paths, including customer/admin order email dry-run verification without calling Resend.
- Added Worker email dry-run support through `STORE_EMAIL_DRY_RUN` / `RESEND_EMAIL_DRY_RUN`, including delivery markers in order summaries for release verification.
- Added release fulfillment evidence for signed downloads, private download headers, revoke/refresh behavior, ticket/RSVP check-in, and admin order/attendee/reconciliation/audit CSV exports with in-process Worker mocks.
- Added rendered i18n/SEO release evidence for English/Spanish public, order, admin, sitemap, robots, canonical, hreflang, noindex, route-copy, and product metadata behavior.
- Added release accessibility coverage for axe checks, keyboard add-to-cart, visible focus order, order lookup live status updates, reduced motion, 200% text scaling, and mobile overflow.
- Added optional macOS VoiceOver plus Whisper transcript evidence for releases that require assistive-technology speech evidence.
- Added scheduled, non-deploying Podman E2E drift detection in GitHub Actions.
- Added a GitHub Actions workflow for strict production Cloudflare DNS API evidence using repository secrets after the workflow is available on `main`.
- Hardened the Cloudflare DNS evidence workflow to prefer a dedicated `CLOUDFLARE_DNS_API_TOKEN`, support explicit `CLOUDFLARE_ZONE_ID`, and report actionable token-scope errors when DNS record reads return `403`.
- Tightened strict Cloudflare DNS evidence so CI requires the dedicated DNS-read token instead of falling back to the Worker deploy token.
- Hardened SEO auditing with localized Product JSON-LD `inLanguage` checks and BreadcrumbList validation for product pages.
- Improved Store admin responsiveness under high text scaling by relaxing the product editor action-row grid constraints.
- Removed the old staging-oriented security test script and updated release docs to use local/Podman rehearsal, read-only provider probes, and GitHub Actions DNS evidence instead.
- Kept the headed checkout helper as standalone exploratory desktop evidence instead of a required release-smoke phase, because automated payment, signed-webhook, and fulfillment evidence now cover release-critical checkout/payment behavior.

## v1.0.4 - 2026-06-29

- Added Store-owned customer order confirmation emails for physical, digital, ticket, RSVP, coupon, shipping, and total-breakdown scenarios, and stopped requesting Stripe receipt emails for Store PaymentIntents.
- Added super-admin order notification emails after paid webhook settlement or free-order confirmation, using the shared transactional email renderer without ticket/QR attachments.
- Added authenticated super-admin order notification CTAs that mint a short-lived one-time admin login link directly into the Orders tab, avoiding a second sign-in email when reviewing a new order.
- Expanded Store order reconciliation diagnostics with Stripe charge, balance transaction, and card verification outcome fields so issuer/CVC mismatches can be reviewed from exported order data.
- Updated event email deliverability behavior so calendar invites may be attached while ticket and check-in QR SVGs stay on the token-scoped order page.
- Changed digital download access from expiring entitlement windows to durable customer entitlements with short-lived signed links and explicit admin revoke/refresh controls.
- Updated the admin Orders UI to show item-level actions for mixed fulfillment orders, refresh attendance totals after check-in changes, and keep action buttons responsive across desktop, tablet, and mobile.
- Added admin dashboard navigation persistence so authenticated reloads restore the last selected top-level tab and Settings section while explicit `tab=` deep links still take precedence.
- Improved Order Success with line-item totals, shipping details, event addresses, and durable-download copy.
- Improved ticket/RSVP SVG generation so long product and variant names fit within the ticket layout.
- Added an all-variation local demo order seed covering physical, digital, ticket, RSVP, coupon, shipping, and fulfillment states for manual testing.
- Added i18n completeness checks and localized email/admin copy coverage for the new transactional paths.
- Added Spanish public routes for home, Terms, Orders, and Order Success, including localized runtime order lookup/confirmation copy while leaving product titles, descriptions, and creator-authored product content canonical.
- Hardened authenticated super-admin order notification CTAs so notification links expire after 5 minutes, create a 30-minute admin session, and have regression coverage proving consumed links cannot be reused.
- Added admin Brand & SEO customization controls that line up with public metadata, social image, and merchant return policy configuration.
- Added a comprehensive non-admin SEO pass for public routes, canonical/alternate metadata, sitemap exclusions, crawl controls, and product structured data.
- Fixed iOS Safari mobile styling where auto-detected text and the hamburger menu could inherit unexpected blue link/button styling.
- Hardened the merge gate with Store-native CI ports, i18n completeness, generated-site SEO audit, real admin-page readiness checks, Podman Worker smoke on the host-success path, and Store-specific Podman fallback names.
- Moved Vitest config entrypoints to ESM `.mts`, updated security test scripts to avoid Vite's CommonJS API deprecation path, and excluded test configs plus optimizer temp artifacts from static Jekyll output.
- Folded the one-time production runbook into active production operations, testing, security, backup, and download docs, then removed the obsolete launch file.

## v1.0.3 - 2026-06-26

- Added configurable platform timezone handling across Jekyll campaign state, browser countdowns, Worker lifecycle automation, campaign-runner reports, dashboard settings, and Worker config mirroring. The default remains `America/Denver` for compatibility, and super admins can choose from supported IANA timezones.
- Added upcoming-campaign launch reminders with a slim public signup form, Cloudflare Turnstile verification, campaign/email dedupe, signed unsubscribe links, bounded KV dispatch jobs, and Resend delivery through the existing shared email module.
- Added Durable Object-backed campaign settlement serialization, deterministic Stripe idempotency keys, and mixed-campaign batch rejection so scheduled/manual settlement cannot overlap charges for the same campaign while multi-campaign carts remain campaign-scoped.
- Added scoped admin automation secrets for settlement and broadcast routes. When configured, `ADMIN_SETTLEMENT_SECRET` and `ADMIN_BROADCAST_SECRET` reject fallback use of the broader `ADMIN_SECRET`.
- Hardened production deployment credentials by requiring token-based Cloudflare auth, documenting the required Cloudflare user API token shape for Wrangler deploys, splitting cache purge onto `CLOUDFLARE_CACHE_PURGE_TOKEN`, and removing legacy or unused repo secrets.
- Hardened the deploy workflow so dashboard media optimization opens a pull request instead of pushing generated media changes directly to `main`.
- Tightened private CORS defaults, Stripe error redaction, checkout/settlement auth tests, and local secret generation for scoped admin secrets.
- Hardened public content and embed boundaries: campaign Markdown link sanitization now handles nested/encoded unsafe schemes, hosted embeds use specific postMessage target origins, and tokenized Manage pages opt into no-referrer behavior.
- Reduced baseline Workers KV write usage by changing the minute-level scheduler heartbeat to persist hourly instead of every minute, preserving cron health visibility while keeping the free-tier write budget available for real mutations.
- Reduced baseline Workers KV list usage by adding queue-state markers for launch reminder dispatch and supporter confirmation email retries, so idle scheduled ticks skip namespace scans and retry scans wait until the next queued attempt is due.
- Added a durable add-on inventory sold-count projection maintained by pledge create, modify, and cancel paths, avoiding repeated pledge namespace scans for normal add-on inventory reads after the first projection bootstrap.
- Updated local development so `_config.local.yml` can hide launch reminder Turnstile widgets the same way local admin sign-in can hide its Turnstile widget.
- Extended the Podman media optimizer image and wrappers with `optipng` and `gifsicle` so local PNG/GIF source compression uses the same repository media workflow as responsive image and video derivative generation.
- Added a mobile PageSpeed performance pass for campaign pages: YouTube hero videos now render as local poster/play facades and load the remote iframe only after play intent, avoiding the initial YouTube JavaScript/CSS cost.
- Added responsive hero-image preloads and a `640w` WebP derivative rung so mobile campaign pages can choose smaller browser assets between the existing `480w` and `960w` variants.
- Updated the media optimizer to skip generated responsive WebP derivatives during source optimization, keeping generated browser assets up to date without recursively re-encoding them.
- Fixed dashboard-authored diary rich text so inline bold/italic/underline markers normalize leading and trailing boundary spaces instead of rendering stray Markdown delimiters on public campaign pages.
- Fixed public diary hash links, including links into non-default diary tabs such as `#diary-production`, so the matching tab opens before the page scrolls to the anchor.
- Updated dashboard image/video uploads to dispatch the **Optimize dashboard media** workflow with `scope=changed` after the source-preserving GitHub commit succeeds; audio uploads remain source-preserved.
- Added publish-time cleanup for dashboard-owned campaign content and diary media that is removed from published content and no longer referenced elsewhere in the same campaign.

## v1.0.2 - 2026-06-24

- Added public-page performance fixes from the PageSpeed review: remote-video campaign pages no longer preload hidden fallback hero images, tier images opt into lazy/async decoding, default brand logos reserve their intrinsic dimensions, and public pages avoid eager Stripe preconnects before cart intent.
- Extended the dashboard media optimization pipeline to generate responsive WebP image variants for PNG, JPEG, and GIF source images, so public campaign templates can serve smaller browser assets while keeping original uploads as source-of-truth fallbacks.
- Added a manual `scope=all` option to the **Optimize dashboard media** workflow so existing campaigns can be reprocessed through the same media pipeline used for new dashboard uploads.
- Updated campaign, tier, card, gallery, and content-image templates to use generated responsive variants when they exist without changing visible page structure or campaign Markdown references.

## v1.0.1 - 2026-06-23

- Added actual Stripe balance transaction fee/net capture for newly charged pledges and a super-admin backfill path for older charged pledge records.
- Updated dashboard Analytics to prefer stored actual Stripe fees when available, keep estimated fees only where needed, and label mixed/estimated values clearly.
- Added admin content-editor media uploads for campaign and diary content blocks, with immediate local previews and publish-time upload into the correct campaign asset directories.
- Added the dashboard media optimization pipeline: `npm run media:optimize`, `npm run media:optimize:check`, and a GitHub Actions workflow that losslessly compresses uploaded images, generates high-quality WebM video derivatives, and rewrites literal campaign/config video references after derivatives exist.
- Kept dashboard uploads source-preserving in the Worker while documenting the external optimization step for operators and forks.
- Made Supporters and Analytics return empty read-only views for campaigns without pledge indexes instead of blocking new or empty campaign dashboards.

## v1.0.0 - 2026-06-22

- Added the private admin dashboard as the supported browser editing and operations surface at `/admin/` and `/es/admin/`.
- Added role-scoped magic-link admin authentication for super admins and campaign users, with cookie-backed sessions, CSRF/origin checks, and browser-safe admin APIs that do not expose `ADMIN_SECRET`.
- Added admin sign-in challenge protection support for Cloudflare Turnstile-compatible deployments while keeping local/test bypasses explicit.
- Added dashboard tabs for Settings, Add-ons, Campaigns, Analytics, Reports, Supporters, Marketing, Users, Secrets & credentials, and Runtime diagnostics.
- Replaced the Pages CMS editing model with the dashboard-driven workflow while keeping `_config.yml` and campaign Markdown as the reviewable fork-facing source of truth.
- Added WYSIWYG block editing for campaign content and diary entries, including media settings, link editing, Markdown-style inline formatting, mobile previews, local drafts, and publish-state tracking.
- Added dashboard editing for campaign settings, tiers, support items, campaign add-ons, stretch goals, ongoing items, diary entries, decisions, platform add-ons, and platform settings.
- Added dashboard upload handling for campaign media, brand assets, add-on images, and hero videos using convention-based asset directories and slug-style filenames.
- Added dashboard Users management backed by Worker KV at `admin-users:v1`, separate from GitHub-backed publish flows.
- Added notification emails for newly created dashboard users when Resend is configured; user edits do not resend invitations.
- Added dashboard Marketing tools for referral/UTM URL building, saved referral codes, reusable embed-builder UI, and copyable launch snippets.
- Fixed Marketing embed previews for campaigns with YouTube or Vimeo hero media so progress bars, milestones, and stretch-goal labels stay contained.
- Added role-scoped dashboard Analytics, Reports, and Supporters views with sortable/filterable tables, exact-cent dollar display, and CSV downloads; report previews/downloads do not send email or write sent markers.
- Preserved the Cloudflare Workers KV free-tier target by keeping normal dashboard reads, previews, filters, analytics, and local drafts at zero KV writes.
- Aligned pledge email sender configuration with the authorized Resend sender domain and documented sender-domain setup for forks.
- Made GitHub Pages deploy permissions explicit for the production deploy workflow.
- Added admin dashboard accessibility, i18n, SEO/noindex, security, mobile/tablet responsiveness, and DRY UI passes, plus focused unit, Playwright, Podman smoke, and KV-write-budget coverage.
- Updated release metadata to `1.0.0`.

## v0.9.5 - 2026-05-03

- Aligned local Worker development with GitHub Actions by moving the Podman Worker image to Node 24.
- Updated Worker `compatibility_date` to `2026-05-03` so Wrangler 4 / Miniflare starts cleanly under Node 24.
- Updated host and Podman test wrappers to prefer Node 24, with Node 22 as the minimum Wrangler 4 fallback.
- Switched the Podman Worker dependency bootstrap to `npm ci` so local container starts do not rewrite `worker/package-lock.json`.
- Expanded creator launch documentation with add-ons, hosted embeds, tax/shipping fallback expectations, free-shipping decisions, report recipients, and fulfillment handoff.
- Added a Spanish creator checklist route for fork and creator onboarding.
- Verified the full merge gate, including security suite, host smoke, Podman mutable-pledge smoke, and headless E2E.

## v0.9.4 - 2026-05-02

- Previous milestone for campaign-runner reports, deployment hardening, creator checklist work, and Worker deployment compatibility updates.

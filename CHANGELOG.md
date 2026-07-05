# Changelog

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

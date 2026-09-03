# Changelog

## v1.3.7 - 2026-09-03

- Regenerate the canonical Worker catalog at local startup, after dashboard
  saves, and when repository products/configuration change, including renames.
- Wait for the running Worker's saved catalog hash before refreshing the local
  product editor. Preserve edits and report saved-but-not-refreshed failures.
- Write generated snapshots atomically and avoid unnecessary Worker reloads.
  Include Ruby in the Podman Worker image for the local generator.
- Expose service fulfillment consistently in the dashboard, storefront,
  content validation, and operator documentation.
- Publish the operator-approved A Night in Paradiso $20 event ticket and poster
  with responsive media, preserving the operator-entered inventory of 100.
- Select public SEO release probes from the public catalog so private drafts
  do not cause false missing-structured-data failures.
- Scope recovery-readiness DNS evidence to production domains while retaining
  isolated localhost targets for synthetic restore probes.

## v1.3.6 - 2026-08-28

- Made required production secret names, bindings, origins, and runtime
  configuration the explicit Production Posture pass/fail gate.
- Kept credential-dependent Stripe, Resend, and USPS probes visible as
  manual/not-run when the workflow cannot execute them, without treating those
  skips as either provider failures or verified provider passes.
- Preserved actionable workflow failure for explicit provider probe failures
  and provider-command errors, with regression coverage for both paths.

## v1.3.5 - 2026-08-27

- Changed newly added admin notifications into direct, 15-minute, one-time
  dashboard invitations while preserving role checks at redemption and the
  normal sign-in fallback after expiry.
- Replaced the post-event mission editor's text Link control with the existing
  chain-link icon and gave the English and Spanish editors equal fixed heights
  with internal scrolling for longer copy.
- Moved the sandboxed email-preview shell under the protected admin path so it
  inherits Cloudflare's private, no-store, no-transform policy and avoids
  injected Rocket Loader and Web Analytics cross-origin errors.
- Honored explicit Podman connections throughout the doctor, development, and
  pre-merge wrappers without starting or restarting a different VM, while
  retaining the release-memory gate for the selected engine.

## v1.3.4 - 2026-08-27

- Added a settled-order **Tip Revenue** card to Analytics using the canonical
  persisted tip amount. Product-scoped Analytics allocates mixed-order tips in
  proportion to the selected product's persisted line-item subtotal instead of
  crediting the full tip to every product.
- Kept the Orders CSV and attendee export actions on one responsive row across
  desktop and mobile layouts without introducing horizontal overflow.

## v1.3.3 - 2026-08-27

- Expanded both post-event mission editors with constrained bold, italic,
  underline, and safe-link controls; balanced the settings layout and kept the
  live delivery-faithful preview on a white email background.
- Redirected expired authenticated admin sessions to the existing sign-in panel
  with clear localized guidance instead of exposing the Worker's Unauthorized
  response.
- Added server-enforced product filters to Orders, fulfillment and attendee CSV
  exports, and Analytics. Product-scoped analytics now attributes only matching
  persisted line-item revenue in mixed-product orders.
- Added roadmap plans for customizing more Store email content and filtering
  Analytics by delivery type.

## v1.3.2 - 2026-08-26

- Made the Post-event email preview automatic and visually faithful to the
  delivered email, including its inline styling and responsive support cards.
- Added separate English and Spanish mission editors with visual bold controls,
  limited the sample-event selector to enabled non-test events, and replaced the
  internal copy-version label with an email-style sender and subject header.
- Gave support URLs three quarters of their desktop row and compacted the
  adjacent suggested-amount controls to one quarter.

## v1.3.1 - 2026-08-26

### Automatic post-event follow-up operations

- Replaced the Orders-based audience, recipient, preview, acknowledgement, and
  manual backfill workflow with automatic reconciliation of unique confirmed
  purchasers when an enabled ticket or RSVP event reaches its scheduled send
  time. Purchasers confirmed before activation are included, while activation
  at or after the cutoff never creates a historical send.
- Recorded the activation timestamp in repository-backed event metadata and
  locked the post-event toggle in both the product editor and Worker mutation
  boundary after the scheduled send time. Legacy enabled records without an
  activation timestamp fail closed instead of producing an unreviewed send.
- Moved the English/Spanish email preview into **Settings -> Post-event email**,
  where it uses unsaved configuration values and a selectable sample event
  without scanning or exposing customer data.
- Compacted related post-event settings and placed **Starts at**, **Ends at**,
  and **Post-event email** in one three-column desktop row that stacks on narrow
  screens.
- Added automatic audience, timing-lock, unsaved-preview, localization,
  deduplication, desktop, mobile, and navigation-state regression coverage.
- Kept untyped provider-stage outbox failures retryable inside Resend's
  deterministic idempotency window instead of terminally dropping the job.

## v1.3.0 - 2026-08-26

### Post-event thank-you and support email

- Added an event-level post-event follow-up that defaults on for newly created
  ticket and RSVP products, remains opt-in for existing products, and becomes
  eligible 24 hours after the configured event end.
- Added a fresh super-admin preview and queue flow that shows the exact branded
  email and deduplicated confirmed-purchaser audience before any backfill is
  queued. Imported, launch-test, invalid, suppressed, and already-processed
  recipients remain excluded.
- Added a multipart Dust Wave thank-you email with linked brand identity,
  merchandise and active-project paths, two-column one-time/monthly support
  options, a separate newsletter opt-in, postal address, visible promotional
  opt-out, and one-click unsubscribe headers.
- Kept delivery independent of order truth through the durable outbox, stable
  provider idempotency, bounded retries, and bounce/complaint suppression.
  Receipts, tickets, security mail, and essential fulfillment updates remain
  outside promotional suppression.
- Added English/Spanish copy, fork-facing configuration, data-inventory and
  recovery documentation, ethical-risk review, audience/delivery unit coverage,
  and desktop/mobile admin regressions.

## v1.2.3 - 2026-08-25

### Product availability and deployment progress

- Kept archived, draft, sold-out, and unavailable products disabled when the
  browser synchronizes product controls or confirmed inventory, closing the
  client-side path that could re-enable Film Fatale's archived direct-page
  purchase button. Public catalog projections still omit archived products and
  Worker cart validation remains the server-authoritative rejection boundary.
- Added authenticated, bounded GitHub workflow-run tracking for the exact
  product-publish commit. Active, draft, archived, and sold-out transitions,
  ordinary product edits, bulk status changes, and product reordering now share
  one requested, queued, running, failed, and completed progress controller with
  measured elapsed time and refresh only after the matching deployment succeeds.
- Kept existing status action labels, drag-and-drop, keyboard reordering, list
  layout, and status semantics. Product order saves retain the arranged rows
  while deployment is pending instead of immediately replacing them with the
  prior catalog order.
- Added English/Spanish status copy plus unit, security, desktop, narrow-screen,
  public-catalog, direct-page, canonical checkout, status-transition, bulk, and
  reorder regressions.

## v1.2.2 - 2026-08-25

### Admin repository transport compatibility

- Fixed the production Archive and Publish actions failing with an immediate
  `502` before contacting GitHub. The pinned shared client had requested the
  unsupported Cloudflare Workers redirect mode `error`; Worker Core `0.12.1`
  now uses supported manual handling and rejects every 3xx response explicitly.
- Kept redirects fail-closed without forwarding the GitHub token or exposing a
  provider location. Existing bounded read retries, ambiguous-write
  reconciliation, repository authority, and rebuild behavior remain unchanged.
- Added the bounded shared transport failure code to Worker logs so future
  provider incidents distinguish timeouts, request failures, invalid responses,
  redirects, and GitHub API errors without exposing response bodies or secrets.
- Advanced the immutable Platform pin to `v0.34.1` at
  `ae380c43a16af352ae946f47dd1b7aa4e5b093f0`, added Store pin/runtime
  regression coverage, and documented the corrected incident diagnosis.

## v1.2.1 - 2026-08-24

### Admin publishing reliability and production posture

- Made repository-backed product publishing resilient to transient GitHub
  transport failures. Product reads retry within a bounded window, and an
  ambiguous write is reconciled against current repository content before a
  safe retry, preventing both false 502 failures and duplicate archive commits.
- Changed event addresses to a multiline editor that preserves repository line
  breaks. **Find address** stays beside the address on desktop and stacks below
  it on narrow screens without horizontal overflow.
- Kept product previews script-free while moving them to an opaque sandbox that
  does not emit blocked-script warnings. Removed the disallowed Google Fonts
  request; the existing Typekit/local Store styling remains available within
  the production Content Security Policy.
- Corrected the scheduled Production Posture workflow behind issue #50. It now
  synchronizes production Worker configuration before auditing, and provider
  probes prefer canonical production origins over localhost-safe development
  defaults.
- Added focused Worker, workflow, preview, desktop, and mobile regressions for
  retry/reconciliation behavior, canonical provider targets, clean preview
  execution, and responsive multiline addresses.

## v1.2.0 - 2026-08-24

### Product publishing and release hardening

- Kept Product editor actions visible in a sticky header and made status
  transitions explicit: selecting Archived, Draft, Sold out, or Active now
  shows that the change is pending and changes the primary action to the
  matching publish operation. Successful archives distinguish the committed
  repository change from the following catalog deployment and propagation.
- Widened the desktop Price field and increased the basics-row gap so field
  help buttons stay inside their own labels instead of colliding with adjacent
  fields. The same editor remains single-column without horizontal overflow on
  narrow screens.
- Added browser regression coverage for help-control separation, visible
  archive actions, submitted archived status, and archive confirmation, plus a
  Worker-boundary regression proving that the canonical product markdown patch
  persists `status: "archived"`.
- Kept the checked-in Wrangler origins localhost-safe while making the
  production-posture unit fixture explicitly production-shaped. The complete
  unit suite can now run directly without requiring the pre-merge config-sync
  wrapper.
- Required `preview_urls = false` in production posture so an omitted or
  enabled Cloudflare Worker preview URL blocks release. Production custom
  domains remain the only intended public Worker routes.
- Advanced the transitive development-only `nanoid` lock from `3.3.17` to
  `3.3.18`, clearing the release dependency audit without changing Store or
  Worker runtime dependencies.

### RSVP registration essentials

- Added an opt-in, versioned `event_details.registration` contract for RSVP
  deadlines, party-size limits, contact and attendee names, and bounded party-
  or attendee-scoped custom questions. One shared Worker normalizer now governs
  checkout validation and dashboard publishing.
- Replaced the RSVP question JSON textarea in Products with a guided, localized
  question builder for labels, stable IDs, answer types, party/attendee scope,
  required state, maximum length, and answer choices. The builder serializes to
  the existing JSON field, so repository front matter and the canonical Worker
  schema remain unchanged. New question IDs and choice values derive
  automatically from their visible labels, remain read-only in the dashboard,
  and stay unchanged when a published label is edited. Every builder field now
  includes localized, keyboard-accessible guidance.
- Extended the cart with accessible registration controls while keeping guest
  names and responses out of persistent browser storage. The Worker re-resolves
  current repository product data, rejects unknown choices and closed windows,
  and stores canonical historical question and response snapshots with orders.
  Checkout places Contact before RSVP details and uses the same base panel
  surface for both. Zero-total carts omit tip and payment-method controls,
  submit a zero tip percentage, use **Complete order**, and skip Stripe
  prewarming; paid and mixed carts retain the existing tip and payment behavior.
- Added private roster and response views, attendee search, per-attendee
  check-in with legacy item-level compatibility, partial attendance totals, and
  one-row-per-attendee CSV export. Customer confirmations show their submitted
  roster; transactional email includes names but omits custom responses. The
  desktop Orders table now reserves a bounded response/action column and wraps
  long roster content without letting response text or check-in buttons escape
  the table.
- Added English and Spanish runtime copy, repository/admin configuration docs,
  order-data inventory and backup guidance, ethical-risk review, and focused
  contracts for schema bounds, tamper rejection, product publication, browser
  storage privacy, confirmation rendering, email, check-in, and export.
- Preserved every physical, digital, ticket, service, and unconfigured RSVP
  path by activating the feature only for RSVP products with an explicit
  registration block. The release build remains within existing JavaScript and
  CSS performance budgets without raising thresholds.
- Kept a running local checkout Worker healthy across configuration sync and
  pre-merge cleanup by atomically replacing generated and restored Wrangler
  configuration files.
- Kept local customer confirmations out of the production-only durable email
  queue so free RSVP and paid checkout QA sends immediately when Resend is
  configured, while dry-run flags still prevent provider calls and production
  retains scheduled retries.
- Preserved the non-sensitive RSVP form schema across cart recovery while
  keeping guest names and answers memory-only. Existing direct-link carts can
  repair that schema from the current product page, and checkout now surfaces
  the Worker's specific validation message instead of a generic draft error.
- Reconciled the README files, RSVP/configuration/payment/dashboard/workflow/
  testing guides, public English and Spanish order/Terms copy, merge checklists,
  and release evidence with the shipped behavior. The roadmap now separates
  completed registration essentials from explicitly unshipped RSVP self-service,
  invitation, communication, door, series, and analytics work.

## v1.1.22 - 2026-08-06

### Separately versioned Jekyll golden-project contract

- Pinned `dust-wave-jekyll-template` `v0.1.0`
  (`351281a5aec60fa85653a3d23391e66fb860aae6`) as an independent source-upgrade
  submodule alongside Platform v0.31.0.
- Bound 15 exact Liquid includes and two exact Ruby plugins to one manifest,
  digest, and explicit check/write CLI while preserving Store's byte-identical
  checked-in runtime copies.
- Added pin, version, digest, drift-command, and generated-output exclusion
  regressions. The complete release gate now fails before build on template
  drift and fails after build if the source-upgrade submodule is published.
- The template adds no browser request, deployed byte, route, Worker code,
  cart, checkout, inventory, fulfillment, or credential. Store retains routes,
  data, localization, content, configuration, deployment authority, and
  independent one-commit rollback.

### Post-release maintenance and documentation

- Made pre-merge Worker-config synchronization transactional: the release gate
  now restores the tracked localhost-safe `worker/wrangler.toml` byte-for-byte
  on success or failure, with a focused automated regression in the early
  Store suite.
- Reconciled the root, Worker, testing, project, roadmap, and release
  documentation with Store `v1.1.22`, Platform `v0.31.0`, Jekyll Template
  `v0.1.0`, exact pins, consumer-owned deployment boundaries, and independent
  rollback.

## v1.1.21 - 2026-08-06

### Allowlisted shared-browser asset minification

- Advanced the immutable Platform pin to `v0.31.0`
  (`5ca8ee6d0ff8912ccfdc27c8459a5ef72f8c0579`) and adopted Build Core `0.2.0`.
- Extended the generated-asset build step to minify only `_site/assets` and the
  generated copies of the pinned Site Shell sources through explicit,
  traversal-safe roots.
- Added consumer characterization for root selection, untouched Worker source,
  multi-root output, and the exact write/check commands used by local and Pages
  builds.
- The six generated Site Shell scripts fall from 15,573 to 9,531 bytes, saving
  6,042 raw bytes (38.8%); post-write check mode reports zero further savings
  across all 24 selected generated assets.
- This changes no route, request count, global identity, cart, checkout,
  inventory, or fulfillment behavior. Store retains budgets, orchestration,
  deployment authority, and independent one-commit rollback.

## v1.1.20 - 2026-08-06

### Policy-injected shared design foundations

- Advanced the immutable Platform pin to `v0.30.0`
  (`499e6c1994d79be6049ef204fefd728f22b8093e`) and adopted Design Core `0.2.0`.
- Removed Store's local form, layout, and mixin partials. Store now injects its
  width-based centered gutter plus brand-title spacing, animation identity,
  mobile type scale, and line width before importing neutral shared Sass.
- Characterized generated output before and after migration: `main.css`
  remained `686ccbf364f8d883e23c3e6d523e56ea9184fe0847b783d2b17cb8ba869f0ab6`
  and `admin.css` remained
  `de6ca932f679d01c3c1f6305e08055ed21eb1bbe3a665d6ac571cb2410ae6a58`
  byte-for-byte.
- Added pin and compile-time policy regressions. The extraction adds no browser
  request or runtime code; Store retains tokens, import order, templates,
  content, CSS budgets, deployment, safe localhost defaults, and independent
  rollback.

## v1.1.19 - 2026-08-06

### Shared Site Shell browser primitives

- Advanced the immutable Platform pin to `v0.29.0`
  (`7ed3d9b0220b88126235a3b7edfd507f8846f56d`) and adopted Site Shell `0.2.0`.
- Removed Store's duplicate cart-icon, deferred-stylesheet, form-control identity,
  and shipping-option browser implementations. Thin Liquid policy includes keep
  Store's cache key, provider and event names, accessible labels, control-ID
  prefix and dataset priority local.
- Preserved lazy cart loading and versioned shared URLs, so the extraction adds
  no eager cart-runtime requests and keeps independent submodule rollback.
- Added consumer characterization for shipping choices, cart totals and labels,
  dynamically inserted controls, stylesheet deferral, runtime loading, exact
  package versions, every consumed shared source path, and explicit size budgets
  for each deployed Site Shell browser primitive. Checked-in Wrangler origins
  remain the safe localhost defaults.

## v1.1.18 - 2026-08-06

### Shared release-evidence runtime

- Advanced the immutable Platform pin to `v0.28.0`
  (`5836ced5129ce3eddb09a035601de23ec58a5737`) and adopted Release Core `0.2.0`.
- Replaced Store's duplicate cache-policy audit, Cloudflare admin response-rule
  client, and assisted screen-reader evidence implementation with thin,
  import-safe policy adapters.
- Release Core now bounds origins, paths, rule metadata, command inputs, and
  diagnostic output; rejects redirects; avoids shell command interpolation;
  and excludes credentials, customer data, and response bodies from evidence.
  Store retains its production targets, route policy, expected phrases,
  provider credentials, release decisions, deployment, and independent
  one-commit rollback.
- Added consumer adapter regressions for Store-owned origins and policy plus
  the existing Cloudflare, cache, performance, pin, and release-version
  coverage. The checked-in local Wrangler origins remain unchanged.

## v1.1.17 - 2026-08-06

### Production-target provider evidence

- Made shell/CI site and Worker origins take precedence over the checked-in
  localhost Wrangler defaults during read-only release-provider verification.
- Pinned both production origins in the provider-evidence workflow while
  preserving the isolated staging target for Stripe test-mode webhooks.
- Added regression coverage for target precedence, trimming, production
  fallbacks, test/live separation, and the workflow contract. Store runtime,
  credentials, checkout behavior, and deployment authority are unchanged.

## v1.1.16 - 2026-08-06

### Shared compile-time design components

- Advanced the immutable Platform pin to `v0.27.0`
  (`06a9453ed2f310f5acca1a1f864fdce4a45d5f56`) and adopted Design Core `0.1.0`.
- Removed five byte-identical local Sass partials and resolved their base,
  button, content-block, modal, and utility components from the pinned Platform
  load path with byte-equivalent generated CSS.
- The package adds no browser JavaScript or request-time cost. Store retains
  tokens, mixins, import order, templates, focus and responsive policy,
  content, CSS budgets, Jekyll integration, deployment, and rollback. Liquid
  includes and Ruby plugins remain local by explicit architecture decision.

## v1.1.15 - 2026-08-06

### Shared test setup and mobile viewport helper

- Advanced the immutable Platform pin to `v0.26.0`
  (`3063aae3cb1cf80e2f8bc5f9b1e40c814dff47b2`) and adopted Test Core `0.1.0`.
- Replaced the exact duplicate browser Storage setup and horizontal-overflow
  helper with tiny Vitest and Playwright adapters; Platform gains no runner or
  browser-automation dependency.
- Store retains fixtures, URLs, viewports, responsive/product expectations,
  CI, deployment, and rollback. Independent accessibility and media contract
  tests remain local, and Playwright test discovery covers 34 cases.

## v1.1.14 - 2026-08-06

### Shared durable-outbox mechanics

- Advanced the immutable Platform pin to `v0.25.0`
  (`4f1c7c042456da1a86116c24c7d346dfaddb21b4`) and Worker Core `0.12.0`.
- Replaced duplicate canonical job IDs, bounded record/queue creation,
  due/lease/expiry classification, retry delay, redacted error evidence,
  email/tag normalization, and Resend event mechanics with shared primitives.
- Store retains KV operations, template rendering, suppression, provider sends
  and scheduling, order mutations, credentials, deployment, and independent
  rollback. Existing render-retry, frozen-payload, and idempotency tests pass.

## v1.1.13 - 2026-08-06

### Shared bounded tax-provider transport

- Advanced the immutable Platform pin to `v0.24.0`
  (`16ccc75209f1b07044299a60c0ff26520fe70607`) and Tax Core `0.3.0`.
- Replaced Store's duplicate Zip-Tax and New Mexico GRT fetch, address-build,
  street-parse, and source-normalization code with shared bounded transport.
- Provider URLs require HTTPS, redirects are rejected, timeouts abort, and
  request/response data is bounded without returning credentials or raw
  network errors. Store retains provider/fallback selection, product
  taxability, quote calculation, checkout effects, deployment, and rollback.

## v1.1.12 - 2026-08-06

### Shared bounded GitHub transport

- Advanced the immutable Platform pin to `v0.23.0`
  (`a0006c3e0c3f8ab814387491753989956adbbe94`) and Worker Core `0.11.0`.
- Replaced Store's duplicate workflow, Contents API, and atomic multi-file
  commit client with a thin adapter while preserving optimistic product-file
  conflict guidance and all existing publishing behavior.
- Requests now reject redirects, time out, bound paths, refs, workflow inputs,
  content, and provider responses; batch publication rejects duplicate paths
  and stale SHA evidence and never force-updates a branch. Store retains
  repository defaults, product schemas, messages, logging, authorization,
  effects, deployment, and independent rollback.

## v1.1.11 - 2026-08-06

### Shared USPS transport and country registry

- Advanced the immutable Platform pin to `v0.22.0`
  (`514c00932d5fb2fa05ee6f7cebb7ea44d9426d78`) and Shipping Core `0.2.0`.
- Replaced Store's duplicate USPS OAuth, rate-search, timeout, token/quote
  cache, and provider-cooldown implementation with a thin configuration
  adapter.
- Made Platform's 95-country YAML the canonical source and added explicit
  check/write sync commands plus a byte-equality pin regression for Store's
  Jekyll snapshot.
- Provider credentials remain request-only; mail-class/token/cache state is
  bounded; timeout, 401 refresh, 429/5xx cooldown, fallback, and full shipping
  behavior remain covered. Store retains address eligibility, product rates,
  checkout/fulfillment effects, storage, routes, deployment, and rollback.

## v1.1.10 - 2026-08-06

### Shared inventory state mechanics

- Advanced the immutable Platform pin to `v0.21.0`
  (`98533957456eed4bb2eae6f474b9072a419b64bc`), adopted
  `@dustwave/inventory-core` `0.1.0`, and Worker Core `0.10.0`.
- Replaced Store's duplicate count-map, snapshot-cloning, reservation expiry,
  reserved-count, and catalog-bootstrap merge helpers with shared pure
  mechanics while preserving claimed counts when current product metadata is
  refreshed.
- Added an independent pre-move regression for Store's merge policy. The full
  coordinator contract continues to cover atomic selection changes, competing
  claims, reservation confirmation/release, expiry cleanup, and rebuilds.
- Store retains all Durable Object transactions, KV writes, catalog/SKU
  labels, checkout and order transitions, TTL selection, routes, deployment,
  and independent rollback.

## v1.1.9 - 2026-08-06

### Shared logging and media-catalog mechanics

- Advanced the immutable Platform pin to `v0.19.0`
  (`1bfbdd403fc9efafb8d261dd846cedb9d52ed444`), Worker Core `0.9.0`, and
  Media Core `0.4.0`.
- Replaced Store's duplicate scoped-console implementation and site-media
  catalog mechanics with thin product-policy adapters while preserving the
  existing product/runtime prefixes, severity policy, manifest and broken-
  reference shape, placement budgets, derivative paths, and public behavior.
- Added independent media characterization before migration and fail-closed
  traversal coverage. Shared labels, scopes, error fields, media paths, and
  known-path sets are now bounded.
- Store retains environment/config parsing, logging policy and destinations,
  product/add-on/default scope and slug policy, content, filesystem access,
  transforms, admin routes, storage, deployment, and rollback.

## v1.1.8 - 2026-08-06

### Shared deterministic shipping mechanics

- Advanced the immutable Platform pin to `v0.18.0`
  (`3b8bdacc224bda625103718ba0fa8489517ff993`) and adopted
  `@dustwave/shipping-core` `0.1.0`.
- Replaced 524 lines of duplicate item-profile, mixed-shipment aggregation,
  missing-metadata, fallback/free/manual quote, and shipping-option mechanics
  with thin Store policy adapters.
- Added an independent pre-move consumer contract for mixed tier,
  support-item, and add-on shipments plus option fallback behavior.
- Bounded selection, catalog, mail-class, and option arrays before shared
  loops while preserving the current USPS First-Class flat table and normal
  quote results.
- Store retains product and free-shipping policy, destination validation, USPS
  credentials and transport, OAuth/cache/backoff/retry, checkout, fulfillment,
  storage, deployment, and rollback.

## v1.1.7 - 2026-08-06

### Shared session security mechanics

- Advanced the immutable Platform pin to `v0.17.0`
  (`3a526defd21d692292c73652966a044167f881d7`) and Worker Core `0.8.0`.
- Replaced Store's characterized login-token encoding/verification,
  session-cookie serialization/clearing, and same-origin request checks with
  bounded shared primitives through thin Store policy adapters.
- Preserved the exact secure admin cookie, current missing-origin-header and
  local unconfigured-origin behavior, normal TTLs, the five-minute order-email
  login and 30-minute notification session, one-time nonce consumption, and
  independent rollback.
- Added rejection coverage for extra token segments and retained existing
  login replay, CSRF/origin, session-review, redacted-history, role/scope, and
  notification-link coverage.
- Store continues to own secret selection, login/session records, roles and
  scopes, CSRF tokens and header names, routes, storage, email, credentials,
  deployment, and rollback.

## v1.1.6 - 2026-08-06

### Shared Resend security and retry mechanics

- Advanced the immutable Platform pin to `v0.16.0`
  (`d075c3e1a29134d3ba6e4631b76dc63212347d14`) and Worker Core `0.7.0`.
- Replaced Store's characterized Resend/Svix HMAC verification copy with the
  bounded shared raw-body verifier, retaining Store's response adapter and all
  event parsing, journal, delivery, and suppression effects locally.
- Replaced Store's duplicate Resend error class and retryable/ambiguous status
  rules with shared pure mechanics. Store still decides attempt budgets,
  idempotency windows, backoff scheduling, terminal evidence, and whether any
  retry occurs.
- Added pre-migration coverage for multiple signature candidates, stale events,
  malformed secrets, body mismatches, 429 retry timing, and permanent-bounce
  suppression. Oversized event IDs and fractional timestamps now fail closed.

## v1.1.5 - 2026-08-06

### Shared cryptographic primitives

- Replaced Store's characterized SHA-256, HMAC-SHA-256, high-entropy token,
  cookie parsing, email normalization, and constant-work string-comparison
  copies with the immutable `@dustwave/worker-core` `0.6.0` implementation
  already pinned through Platform `v0.15.0`.
- Kept login-token shape, Store's short-lived order-notification login policy,
  session and CSRF records, admin scopes, routes, KV storage, credentials,
  release, and rollback in Store; a one-line HMAC adapter preserves the
  existing argument order.
- Added consumer contracts for the exact digest, URL-safe signature and token
  shapes, encoded cookies, normalized email, constant-work equality, and
  rejection of undersized tokens, alongside the existing login replay,
  expiry, CSRF/origin, session-review, and redacted-history coverage.

## v1.1.4 - 2026-08-06

### Provider-originated Stripe test coverage

- Added a persistent `store-worker-staging` Cloudflare environment with an
  isolated Durable Object namespace, KV namespaces, R2 bucket, and Analytics
  dataset; it has no custom route or cron and cannot mutate production Store
  state.
- Scoped staging to Stripe test mode, disabled USPS, reconciliation, runtime
  analytics, Worker cache, repository writes, and Resend delivery, and retained
  rendered-email evidence through explicit dry-run flags.
- Added posture tests that reject production routes/storage/provider side
  effects or committed Stripe credentials, plus a clean Wrangler dry-run gate.
- Updated provider evidence to verify test-mode webhooks against the dedicated
  staging URL instead of the production Worker, while retaining separate live
  endpoint verification.
- Limited synthetic `CF-Connecting-IP` headers to localhost smoke targets so
  deployed Cloudflare checks use the edge-provided client address and are not
  rejected as spoofed requests.
- Documented staging-only secret handling, provider-originated settlement
  rehearsal, production isolation, and independent rollback.

## v1.1.3 - 2026-08-06

### Shared Platform consolidation

- Advanced the exact `dust-wave-platform` gitlink to immutable `v0.15.0`
  (`2e79a8d70cb6d30805ea141e53d32f9387441756`), including
  `@dustwave/worker-core` `0.6.0` and `@dustwave/release-core` `0.1.0`.
- Replaced Store's characterized Worker CORS/security response, timezone/date,
  and Stripe transport copies with thin Store policy adapters. Store keeps its
  private origin, Stripe API version and provider identity, catalog, checkout,
  order/inventory truth, fulfillment, credentials, and deployment authority.
- Replaced exact Wrangler inventory, KV backup transformation, checksum,
  command-result, and provider-evidence copies with pinned Platform primitives;
  Store continues to own every command, provider call, environment ID, release
  gate, rollout, and rollback.
- Removed insecure `Math.random()` fallbacks from payment-event and
  reconciliation lease identifiers. Both now use Platform's characterized
  Web Crypto token primitive and fail closed if secure randomness is absent.
- Expanded consumer tests for private-origin fallback, full JSON security
  headers, daylight-saving boundaries, Stripe provider identity, missing
  credentials/object IDs, secure-random failure, and the exact Platform pin.

## v1.1.2 - 2026-08-06

### Shared exact-duplicate extraction

- Advanced the exact `dust-wave-platform` gitlink to immutable `v0.12.0`,
  including `@dustwave/build-core` `0.1.0`, `@dustwave/site-shell` `0.1.0`,
  `@dustwave/tax-core` `0.2.0`, and `@dustwave/worker-core` `0.4.0`.
- Migrated the byte-identical header navigation, live announcements, Worker
  timezone primitives, New Mexico GRT starter snapshot, updater, and generated
  asset minifier to their pinned Platform sources.
- Removed Store's duplicate implementation files while preserving its
  characterization suites and executable exact-pin/source-path contract.
- Retained Store ownership of templates, localization, catalog and product
  content, tax-provider and taxability policy, checkout, orders, inventory,
  fulfillment, credentials, storage, build orchestration, and deployment.
- Recorded a one-commit, consumer-only rollback to `v1.1.1` and Platform
  `v0.11.5`; Pool, Dust Wave, Podcast, and Platform do not need to roll back
  with Store.

## v1.1.1 - 2026-08-06

### Public inventory accuracy

- Updated inventory-tracked home and product pages from confirmed live
  availability once per navigation, so completed orders appear without waiting
  for a static catalog rebuild. Static counts remain the no-JavaScript or
  network-failure fallback, while cart validation and checkout continue to
  enforce reservation-aware inventory authoritatively.
- Added a 15-second browser and edge-cached public projection that exposes only
  public SKU availability, plus endpoint, projection, browser, and responsive
  regression coverage for multiple cards, variants, and sold-out states.

### Shared platform alignment

- Advanced the exact `dust-wave-platform` gitlink to workspace `0.11.5`,
  including `@dustwave/admin-shell` `0.10.2` and `@dustwave/worker-core`
  `0.3.6`, without moving Store's catalog, checkout, order, inventory,
  fulfillment, storage, or deployment authority.
- Added an executable consumer contract for the immutable gitlink, canonical
  submodule remote, package versions, and every raw shared module Store serves
  or imports so an incomplete platform update fails before deployment.
- Enabled safe local-identifier minification in generated JavaScript while
  preserving global names, bringing the real production build back under its
  existing JavaScript budgets, and wired that budget audit into pre-merge.
- Made deployment setup dry-runs non-interactive around secret planning, so
  provider values are neither requested nor passed to a CLI during rehearsal.
- Preserved Store's independently reversible release identity across the site,
  Worker, lockfiles, provider User-Agent, and release documentation.

## v1.1.0 - 2026-08-05

### Shared platform foundation

- Added the pinned `aindaco1/dust-wave-platform` submodule as the versioned boundary for primitives shared with Pool, Dust Wave, and Podcast.
- Moved the byte-identical Turnstile implementation into `@dustwave/worker-core` while retaining Store's local import seam and adding a consumer contract test.
- Advanced the shared boundary to `@dustwave/worker-core` 0.2.0, which adds
  typed product-neutral crypto and Stripe mechanics for Podcast without moving
  Store business rules or changing Store's existing Turnstile adapter.
- Kept Store's catalog, order, inventory, fulfillment, configuration, session, storage, and deployment authority independent; the submodule contains no Store data or secrets and can be rolled back by pointer.
- Advanced the shared workspace to 0.6.0 and
  `@dustwave/admin-shell` 0.2.0, moving Store and Pool's byte-identical QR
  generator into the pinned shared boundary. Store still loads the same
  characterized implementation through its static admin shell; only the
  source authority and generated path changed.
- Advanced the pinned shared workspace to 0.8.1 and
  `@dustwave/admin-shell` 0.7.1. The additive rich-editor `setHtml` API routes
  restored HTML through the existing allowlist sanitizer; Store behavior is
  unchanged until a form opts into it, and rollback remains a one-commit
  submodule-pointer change.
- Advanced `@dustwave/admin-shell` to 0.8.1 and replaced Store's duplicated
  dirty-action state logic, including product-order saving, with the shared
  class, state-attribute, label, and clean-state disabling primitive. Store
  retains its editor baselines, force-disabled rules, and focus-ring style.
- Finished the v1.1.0 release identity across canonical site config and the
  Worker provider User-Agent, with an executable contract that keeps both
  package locks, both packages, config, Stripe, and Resend aligned.

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

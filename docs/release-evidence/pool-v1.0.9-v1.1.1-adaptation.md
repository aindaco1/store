# Store v1.0.8 — Pool v1.0.9-v1.1.1 Adaptation Plan

Date: 2026-07-13

## Objective and boundaries

Adapt reusable primitives from Pool `v1.0.9`, `v1.1.0`, and `v1.1.1` to Store while preserving Store's repository catalog, Cloudflare state boundaries, Stripe PaymentIntent checkout, inventory Durable Object, fulfillment, customer order lookup, and admin model.

This document is the implementation record for the Store `v1.0.8` release candidate. It does not claim that the candidate has been deployed, that production secrets or webhooks exist, or that live provider evidence has passed.

Approved decisions:

- Cover every recommended implementation milestone in the first Store change set.
- Cover image, video, and audio media.
- Retain pending email payloads for 30 days, webhook/idempotency markers for 35 days, and minimized processor/delivery/reconciliation evidence for 400 days.
- Follow Pool's conservative payment posture: deterministic retry-safe recovery and read-only reconciliation, with no ambiguous manual charge action.
- Keep production deployment manual and reviewed.

## Release mapping

| Pool source | Reusable primitive | Store adaptation | Deliberately not copied |
| --- | --- | --- | --- |
| `v1.0.9` | Root agent guidance; backup/recovery classification and immutable release discipline | Root `AGENTS.md`; new KV families classified, retained, backed up, restored, or quarantined explicitly | Pool campaign/pledge/vote data model and settlement recovery |
| `v1.1.0` | DRY variant price inheritance/override/ceiling rules | Optional Store add-on variants: blank inherits, explicit zero is valid, current catalog authority, historical confirmed prices preserved | Manage Pledge behavior and campaign add-on authoring |
| `v1.1.1` | Deterministic media manifest and rich picker | Store product/default/add-on image, video, and audio browser; SHA-safe replace; reference/budget/repair evidence | Campaign-scoped media library or KV media database |
| `v1.1.1` | Stripe API pinning, observations, leases, journal, indexed reconciliation | Store PaymentIntent timing/currency, 35-day webhook markers, 400-day processor events/breaks, daily and super-admin read-only reconciliation | Settlement-group charging, pooled pledges, manual ambiguous-charge recovery |
| `v1.1.1` | Durable Resend outbox and signed delivery events | Store order confirmations, event reminders, and consented abandoned-cart reminders; delivery evidence and hashed suppression | Campaign broadcasts/audiences; delayed one-time admin/login/order-lookup links |

## Execution milestones

### 1. Repository guidance and DRY pricing

Status: implemented.

Actions and acceptance criteria:

1. Move `docs/AGENTS.md` to repository root and update contributor links.
2. Define one browser price resolver and mirror the exact contract in catalog/admin/Worker normalization.
3. Prove blank inheritance, zero override, invalid/negative rejection, ceiling enforcement, current selection repricing, and historical confirmed-order preservation.
4. Regenerate the Worker catalog snapshot.

### 2. Repository media governance

Status: implemented.

Actions and acceptance criteria:

1. Generate a deterministic manifest for all repository image/video/audio sources, hashes, dimensions/duration, byte sizes, derivatives, references, warnings, and intentionally skipped larger outputs.
2. Treat Git sources as authoritative and the manifest as rebuildable metadata.
3. Add accessible type/scope/search/sort controls, local previews, reference locations, broken-reference warnings, placement budgets, and source/derivative distinction to Store product media administration.
4. Require meaningful alt text; permit empty alt only through explicit decorative state.
5. Constrain upload/replace to matching Store directories and media types; require current content SHA for replacement.
6. Dispatch changed/all optimization through the existing reviewable workflow; never transcode in the Worker.
7. Pass the manifest freshness/broken-reference gate with no unexplained missing derivative.

### 3. Payment integrity and reconciliation

Status: implemented.

Actions and acceptance criteria:

1. Pin Stripe API behavior and normalize redacted request observations/errors.
2. Apply deterministic idempotency only to retry-safe writes.
3. Persist explicit USD and value/booking/webhook/processor timing on new order/payment state without rewriting historical orders.
4. Use 10-minute webhook processing leases and 35-day processed markers; prove replay, live-conflict, stale-resume, and failure-release behavior.
5. Retain a raw-payload-free processor event journal for 400 days.
6. Reconcile bounded batches from `admin-store-orders:index:v2` to read-only Stripe PaymentIntent retrieval, never an `orders:` namespace scan.
7. Record open/resolved 400-day breaks and expose a super-admin CSRF route using the same reconciler.
8. Stop ambiguous money states for review; expose no manual create/confirm/retry/refund/cancel action.

### 4. Durable email delivery

Status: implemented.

Actions and acceptance criteria:

1. Queue order confirmations, event reminders, and consented abandoned-cart reminders after canonical state commits.
2. Freeze the provider payload/content hash, use deterministic job IDs and stable Resend idempotency, acquire 10-minute leases, and apply bounded backoff.
3. Stop ambiguous/out-of-window sends for review rather than risk duplicates.
4. Verify Resend/Svix raw-body signatures and retain dedupe markers for 35 days.
5. Retain minimized acceptance/delivery evidence and hashed permanent-bounce/complaint suppression for 400 days.
6. Keep one-time admin/login/order-lookup links and explicit test sends immediate because queue delay would materially consume their short validity windows.
7. Commit order truth independently of provider success.

### 5. Configuration, recovery, and documentation

Status: implemented.

Actions and acceptance criteria:

1. Mirror `EMAIL_OUTBOX_ENABLED=true` and `PAYMENT_RECONCILIATION_ENABLED=true` from `_config.yml`; force payment reconciliation off in dev.
2. Add `RESEND_WEBHOOK_SECRET` to local/production setup, secret-name inventory, example env, admin secret status, and readiness guidance without ever exporting a value.
3. Add every KV family to the canonical data inventory and executable audit.
4. Restore delivery/idempotency evidence before queues; quarantine pending outbox payloads by default; rebuild queue/reconciliation cursors.
5. Update the owning Store docs, README, changelog, Worker reference, and roadmap.
6. Keep the existing `v1.0.7` tag immutable; package this work as `v1.0.8` and create its tag only after the release-closure evidence is approved.

## Verification matrix

The implementation is merge-ready only when all local rows pass. Production rows remain post-merge operator gates.

| Layer | Command/evidence | Required result |
| --- | --- | --- |
| Syntax/config | `node --check` on changed modules; `ruby -c scripts/sync-worker-config.rb`; `npm run sync:worker-config` | Clean; second sync produces no diff |
| Pricing/media/payment/email | Focused Vitest files listed in `docs/TESTING.md` | Pass |
| Media | `npm run media:optimize:check` | Current manifest, zero broken references, only explained skipped derivatives |
| Recovery inventory | `npm run backup:inventory:audit` | Every runtime family classified with approved retention |
| Site/content | Jekyll build, content/i18n/SEO/minification audits | Pass |
| Full regression | `npm run test:unit` and `npm run test:premerge` | Pass, or any environment-only skip/block recorded exactly |
| Diff hygiene | `git diff --check`; secret audit; workflow security checks | Pass; unrelated user files untouched |

Local implementation evidence captured on 2026-07-13:

- `npm run test:premerge`: passed all 10 phases on the final working tree. This includes secret/content/i18n/syntax checks, focused regressions, 79 unit files with 370 tests, build artifacts through the supported host-to-Podman fallback, the Podman resource gate, 22 live Worker security tests, Worker smoke, and 31 Playwright tests.
- `npm run media:optimize:check`: 51 source assets, zero stale manifest changes, zero missing derivatives, and zero broken references. Deliberately skipped larger derivatives remain recorded in the manifest.
- `npm run backup:inventory:audit`: all 42 detected Worker storage families are classified under the approved recovery policy.
- `npm run build`, `npm run assets:minify:check`, `npm run test:seo`, `npm run test:performance:budgets`, and `npm run test:cache-policy`: passed. The SEO audit covered 108 non-admin pages and 50 sitemap URLs.
- `npm run launch:readiness -- --json`: no repo-visible action blockers. Provider secrets/webhooks, a signed delivery event, production checkout/fulfillment, and the first reconciliation cycle remain correctly reported as manual gates.
- `git diff --check` and config-sync idempotence: passed. Unrelated working-tree files were not modified.

## Production rollout checklist

1. Review and merge the exact tested commit; do not deploy from an unreviewed working tree.
2. Create `https://checkout.dustwave.xyz/webhooks/resend` in Resend for delivered, bounced, complained, failed, and suppressed events; set `RESEND_WEBHOOK_SECRET` in Cloudflare without recording its value.
3. Confirm production Stripe webhook subscriptions and the pinned API behavior using read-only provider checks. Do not create a live charge for readiness proof.
4. Run config sync and a Worker deploy dry run. Confirm the binding summary includes `EMAIL_OUTBOX_ENABLED=true` and `PAYMENT_RECONCILIATION_ENABLED=true`.
5. Run the complete release smoke/provider evidence path and attach its sanitized output. Treat unavailable credentials as explicit skips, never inferred passes.
6. Dispatch the manual reviewed production deployment.
7. Verify public/admin route boundaries: unsigned Resend webhook and unauthenticated reconciliation/media routes fail closed; admin responses remain private/no-store.
8. Send a provider test message that produces a signed delivery event without customer data; confirm the 35-day marker and minimized delivery row.
9. Review the first scheduled outbox and reconciliation cycles, including queue state, open breaks, cron heartbeat, and redacted logs. Investigate critical breaks before any money-affecting intervention.
10. Review the checked-in media manifest and dashboard warnings after deployment; use `scope=changed` for routine repair and `scope=all` only after explicit review.

## Risk review

- Money: reconciliation is read-only and cannot create a second charge. Processor evidence omits raw payload/card/customer data.
- Messaging: transactional order truth is separate from retries; optional reminders retain consent/unsubscribe/suppression; ambiguous retries stop.
- Privacy: pending payload PII is short-lived and quarantined; long-term delivery/suppression evidence is minimized or hashed.
- Admin power: replace/repair/reconciliation operations preserve role, session, CSRF, path, and SHA boundaries.
- Media/accessibility: meaningful images require alt text; decorative state is explicit; budgets warn without silently deleting sources.
- Operations: no deployment or provider readiness claim is made by unit tests. Production evidence requires the reviewed manual checklist above.

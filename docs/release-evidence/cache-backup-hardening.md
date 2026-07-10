# Cache And Recovery Hardening Evidence

- Generated: `2026-07-10T04:04:07Z`
- Branch: `release/1.0.6-cache-backup-hardening`
- Base commit/tag: `42a5e902fa4fc7f479b6bf147736506caff4636d` / `v1.0.6`
- Release status: additional `v1.0.6` hardening; the published tag was not moved
- Production deployment at initial evidence capture: not performed; follow-up deployment and operational evidence are recorded below

## Automated Evidence

| Result | Check | Evidence |
| --- | --- | --- |
| PASS | Definitive release smoke | `npm run release:smoke -- --podman-e2e --evidence-file /tmp/store-1.0.6-cache-recovery-operations-final-release-smoke.md`; all enabled phases passed. Logs: `/tmp/store-release-smoke-logs.yKiK7b`. |
| PASS | Full unit suite | Vitest 4 ran 289 tests across 65 files, including cache policy, endpoint, telemetry, observability, benchmark, backup, retention, restore, recovery preflight, and workflow safeguards. |
| PASS | Podman security | 22 tests passed against the production-like local stack, including evidence-secret authorization, admin boundaries, input limits, webhook signatures, rate limiting, CORS, and fail-closed behavior. |
| PASS | Podman runtime/browser evidence | Worker smoke and both Podman headless E2E phases passed. Automated accessibility, rendered English/Spanish and SEO, fulfillment, admin dashboard, responsive, and private-route behavior were exercised through the container stack. |
| SKIP | Optional screen-reader transcript | This backend/admin operations slice did not require a new VoiceOver audio artifact. Axe, keyboard/status, high-zoom, responsive, and localized Playwright checks passed. |
| PASS | Read-only provider/payment readiness | Cloudflare provider evidence and payment smoke passed without production writes. A direct Cloudflare Analytics Engine token query and Worker-wide invocation/error preflight also succeeded during implementation. |
| PASS | Representative restore rehearsal | The Podman drill verified 19 integrity artifacts and 35 actions, restored 17 records and one R2 object across physical, digital, ticket, RSVP, failed-payment, idempotency, reminder, audit, and inventory-control classes, excluded quarantine/derived state, issued no side-effect provider commands, and received `401` plus `private, no-store` from the Worker admin probe. |
| PASS | Backup/recovery readiness | The strict release phase classified 33 Worker storage families, planned snapshot v2, found required credential names and an encryption backend, accepted current provider/rehearsal evidence, and reported zero failures. The missing live encrypted snapshot receipt remains an explicit warning. |
| PASS | Retention and artifact safety | Tests cover exact acknowledgement, newest/release/bucket protection, invalid receipts, checksum mismatch, symlinked roots, real-root containment, immediate pre-delete eligibility revalidation, and temporary detailed restore output excluded from uploaded artifacts. |
| PASS | Dependency audit | `npm audit` and `npm audit --omit=dev` both reported zero vulnerabilities. |

## Operations Configuration

- **Workers Cache Evidence** is scheduled for `03:17 America/Denver` with read-only repository permissions and the `production-observability` environment.
- **Recovery Readiness** is scheduled for `03:43 America/Denver` each Sunday and uses synthetic data plus read-only provider metadata.
- **Quarterly Recovery Operations** is scheduled for `04:17 America/Denver` on the first day of each quarter. Its captured-data job is disabled by default and protected by the `production-recovery` environment, a required reviewer, Worker-wide traffic/error evidence, and preview-only restore targets.
- Deploy, cache evidence, and protected recovery share `production-operations` concurrency. Repository secret/variable names and environment protections were configured without storing values in this evidence file.

## Post-Deployment Operations Evidence

- [Deploy Production run 29070114312](https://github.com/aindaco1/store/actions/runs/29070114312) passed the Worker deploy, entrypoint-scoped Workers Cache purge, Pages deploy, and public Cloudflare purge.
- [Workers Cache Evidence run 29070218894](https://github.com/aindaco1/store/actions/runs/29070218894) passed its low-traffic gate and uploaded sanitized evidence. The production probe recorded a full `EXPIRED` read in 51 ms, a no-change warmup `EXPIRED` read in 62 ms, and an identical no-change repeat `HIT` in 4 ms with zero order-data KV reads/lists. Both no-change reads returned `unchanged: true`; credential and customer-data flags were false. Aggregate hit-ratio evidence remained `insufficient_data` because only two eligible telemetry rows existed, so no rollout conclusion was inferred.
- [Recovery Readiness run 29070260385](https://github.com/aindaco1/store/actions/runs/29070260385) passed provider evidence, the representative Podman rehearsal, and six readiness checks with zero failures. Its single warning correctly records the missing live encrypted snapshot receipt.
- [Quarterly Recovery Operations run 29070592197](https://github.com/aindaco1/store/actions/runs/29070592197) passed the Worker-wide 15-minute preflight with 18 requests, 7 subrequests, and zero errors against a 100-request/zero-error ceiling. The artifact reported no credentials or customer data. The protected preview-restore job was correctly skipped because `RECOVERY_DRILL_ENABLED=false`.

## Cache Evidence Boundary

Unit, integration, security, and Podman tests prove canonical key policy, role/scope partitioning, no-change responses, browser `private, no-store`, search bypass, mutation invalidation, purge failure behavior, operation budgets, evidence redaction, and dashboard refresh UX. Podman does not implement or prove Cloudflare's real edge cache behavior.

The required 30-sample cache-disabled/cache-enabled `Cf-Cache-Status`, p50/p95/p99, operation-budget, and post-purge Cloudflare edge comparison remains open. It requires an authorized short-lived super-admin login token and controlled sequential deployments. Analytics, order-derived inventory, and download-readiness caching therefore remain disabled by default.

## Recovery Evidence Boundary

The metadata plan and synthetic Podman drill contain no production customer/provider data and perform no production writes. Business approval of RPO/RTO and retention remains open, as do an operator-controlled live encrypted KV/admin/R2 snapshot, isolated decryption, durable off-device retention, complete captured-data preview rehearsal, and Durable Object/Stripe reconciliation.

`RECOVERY_DRILL_ENABLED` remains `false`. Enabling the captured-data job requires a dedicated recovery age identity, a fresh one-time super-admin token, reviewed preview resources, the protected environment reviewer, and an approved off-account retention destination. Production restore remains a separate manual incident operation with maintenance, Stripe, inventory, pre-snapshot, conflict-policy, and exact-acknowledgement gates.

## Sign-Off

- Automated gate owner/date:
- Cache edge evidence owner/date:
- Backup key/retention owner/date:
- Restore drill owner/date:
- Notes/blockers:

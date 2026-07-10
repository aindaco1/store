# Cache And Recovery Hardening Evidence

- Generated: `2026-07-10T04:04:07Z`; updated `2026-07-10T20:17:26Z`
- Branches: `feature/cache-recovery-operations`, then `hotfix/1.0.6-order-index-bulk-read`
- Release commit/tag before the hotfix: `85e24b5` / `v1.0.6`
- Release status: the published `v1.0.6` tag and release point to the merged hardening commit; the same-release bulk-read hotfix passed the complete pre-merge release gate and awaits merge, tag retargeting, deployment, and production evidence
- Production deployment: completed through the protected manual workflow; no production restore or recovery mutation was performed

## Automated Evidence

| Result | Check | Evidence |
| --- | --- | --- |
| PASS | Definitive hotfix release smoke | `npm run release:smoke -- --podman-e2e --evidence-file /tmp/store-1.0.6-order-index-bulk-read-release-smoke-final.md`; all enabled phases passed against the final hotfix tree. Logs: `/tmp/store-release-smoke-logs.UKCZIG`. |
| PASS | Full unit suite | Vitest 4 ran 325 tests across 69 files, including a 417-order, five-batch KV rebuild and non-bulk adapter fallback plus cache policy, endpoint, telemetry, deployment observability, benchmark, backup, retention, preview verification/cleanup, captured reconciliation, maker/checker plus provider-gated recovery, and workflow safeguards. |
| PASS | Podman security | 22 tests passed against the production-like local stack, including evidence-secret authorization, admin boundaries, input limits, webhook signatures, rate limiting, CORS, and fail-closed behavior. |
| PASS | Podman runtime/browser evidence | Worker smoke and both independent Podman headless E2E phases in the final release smoke passed. Automated accessibility, rendered English/Spanish and SEO, fulfillment, admin dashboard, responsive, and private-route behavior were exercised through the production-like container stack. |
| SKIP | Optional screen-reader transcript | This backend/admin operations slice did not require a new VoiceOver audio artifact. Axe, keyboard/status, high-zoom, responsive, and localized Playwright checks passed. |
| PASS | Read-only provider/payment readiness | Cloudflare provider evidence and payment smoke passed without production writes. A direct Cloudflare Analytics Engine token query and Worker-wide invocation/error preflight also succeeded during implementation. |
| PASS | Representative restore rehearsal | The Podman drill verified 19 integrity artifacts and 36 actions, restored 17 records and one R2 object across physical, digital, ticket, RSVP, failed-payment, idempotency, reminder, audit, and inventory-control classes, compared four fake Stripe-backed orders with zero mismatches/writes, excluded quarantine/derived state, and received `401` plus `private, no-store` from the Worker admin probe. |
| PASS | Backup/recovery readiness | The strict release phase classified 34 Worker storage families, planned snapshot v2, found required credential names and an encryption backend, accepted current provider/rehearsal evidence, and reported zero failures. Its generic release invocation did not receive the separate operator-owned live receipt and therefore retained one explicit warning; captured drill evidence is recorded below. |
| PASS | Retention and artifact safety | Tests cover exact acknowledgement, newest/release/bucket protection, invalid receipts, checksum mismatch, symlinked roots, real-root containment, immediate pre-delete eligibility revalidation, and temporary detailed restore output excluded from uploaded artifacts. |
| PASS | Dependency audit | `npm audit` and `npm audit --omit=dev` both reported zero vulnerabilities. |

## Operations Configuration

- **Workers Cache Evidence** is scheduled for `03:17 America/Denver` with read-only repository permissions and the `production-observability` environment.
- **Recovery Readiness** is scheduled for `03:43 America/Denver` each Sunday and uses synthetic data plus read-only provider metadata.
- **Quarterly Recovery Operations** is scheduled for `04:17 America/Denver` on the first day of each quarter. Its captured-data job is disabled by default and protected by the `production-recovery` environment, a required reviewer, Worker-wide traffic/error evidence, and preview-only restore targets.
- Deploy, cache evidence, and protected recovery share `production-operations` concurrency. Repository secret/variable names and environment protections were configured without storing values in this evidence file.
- The dedicated recovery age identity/recipient are configured in `production-recovery`; the empty preview KV namespace and `store-downloads-preview` R2 bucket are available. The protected job remains disabled because the fresh one-time admin token, restricted live Stripe read key, approved off-account S3 destination/credentials, and operator retention/RPO/RTO approval are not configured.

## Post-Deployment Operations Evidence

- [Deploy Production run 29113512713](https://github.com/aindaco1/store/actions/runs/29113512713) deployed merged commit `85e24b5` and passed the Worker deploy, Workers Cache purge, Pages deploy, Cloudflare zone purge, and public admin security-policy verification.
- [Workers Cache Evidence run 29113627591](https://github.com/aindaco1/store/actions/runs/29113627591) ran from protected `main` under zero recent cache-read traffic. Because the deployment was 0.02 hours old, aggregate acceptance correctly returned `inconclusive` for the four-hour stability window. Its bounded probe recorded a full `MISS` in `53,109 ms` with 417 billed KV reads and one list, a no-change warmup `MISS` in `387 ms` with one KV index read, and an identical no-change repeat `HIT` in `4 ms` with zero order-data KV reads/lists.
- The `53,109 ms` result exposed sequential `STORE_STATE.get` calls in the index rebuild after expiry or mutation invalidation. The v1.0.6 hotfix replaces them with five memory-bounded, 100-key bulk operations for the observed 417-order shape. Cloudflare billing still counts 417 key reads; the optimization targets wall time, simultaneous-connection queuing, and per-invocation external-operation headroom. Focused tests, all 325 unit tests, Wrangler production dry run, 22 Podman security tests, and the complete final release smoke pass before the production repeat.
- [Deploy Production run 29070114312](https://github.com/aindaco1/store/actions/runs/29070114312) passed the Worker deploy, entrypoint-scoped Workers Cache purge, Pages deploy, and public Cloudflare purge.
- [Workers Cache Evidence run 29070218894](https://github.com/aindaco1/store/actions/runs/29070218894) passed its low-traffic gate and uploaded sanitized evidence. The production probe recorded a full `EXPIRED` read in 51 ms, a no-change warmup `EXPIRED` read in 62 ms, and an identical no-change repeat `HIT` in 4 ms with zero order-data KV reads/lists. Both no-change reads returned `unchanged: true`; credential and customer-data flags were false. Aggregate hit-ratio evidence remained `insufficient_data` because only two eligible telemetry rows existed, so no rollout conclusion was inferred.
- [Recovery Readiness run 29070260385](https://github.com/aindaco1/store/actions/runs/29070260385) passed provider evidence, the representative Podman rehearsal, and six readiness checks with zero failures. Its single warning correctly records the missing live encrypted snapshot receipt.
- [Quarterly Recovery Operations run 29070592197](https://github.com/aindaco1/store/actions/runs/29070592197) passed the Worker-wide 15-minute preflight with 18 requests, 7 subrequests, and zero errors against a 100-request/zero-error ceiling. The artifact reported no credentials or customer data. The protected preview-restore job was correctly skipped because `RECOVERY_DRILL_ENABLED=false`.
- A later deployment-scoped live collector identified deployment churn as the reason prior 24-hour evidence mixed versions. The current schema queries only the current deployment and returns `inconclusive` during its stability window. Its slowest Orders row was `59,383 ms` with an expected 417 KV reads plus one list, tracing the tail-latency cliff to the ten-minute materialized-index expiry rather than a cache hit; the index now uses a seven-day safety TTL with explicit mutation invalidation.
- A controlled production Orders probe after that investigation recorded a full `EXPIRED` read in 39 ms, no-change warmup `EXPIRED` in 46 ms, and repeat `HIT` in 3 ms with zero order-data KV reads/lists. This remains bounded probe evidence, not the required disabled/enabled 30-sample comparison.

## Captured Recovery Drill Evidence

- At `2026-07-10T13:58:27Z`, an operator-controlled age snapshot outside the repository captured 444 KV records across 14 authoritative/control families and one R2 object from a complete provider enumeration. Encryption decryptability and the encrypted archive checksum were verified; the final receipt contains warning categories/counts only. The sole warning was an expired Stripe CLI metadata inventory probe.
- Isolated planning verified 70 checksum-covered artifacts, 417 order shapes, zero invalid actions, and zero missing value families. The restore performed seven writes only to the empty preview KV namespace and `store-downloads-preview` bucket.
- Readback compared five non-empty KV families containing all 444 records plus the R2 object checksum using ten read commands, with zero command failures or mismatches. Exact-snapshot cleanup then targeted 444 KV records and one R2 object and verified zero residual snapshot-owned data. No production KV/R2 write or delete occurred.
- The drill exposed and fixed three live-format defects before sign-off: Wrangler bulk-get's 100-key request limit, Wrangler v4 raw-string value output, and missing-object R2 CLI exit/file behavior. Regression coverage now protects chunking, dual-format normalization, complete R2 capture, preview readback, idempotent cleanup, and sanitized evidence.
- Store inventory aggregation covered 417 confirmed orders, 33 sold SKUs, and 639 sold units without emitting identifiers. Live Stripe comparison was intentionally blocked before provider access because Store/Pool local files contain a test-mode key; protected reconciliation now requires a dedicated restricted live-mode read key.
- Admin exports were not included because a fresh one-time super-admin login token was unavailable. Decryption was verified on the originating operator machine, not a second isolated device. The encrypted archive is retained in operator-controlled storage, but no durable off-account S3 copy has been proven.

## Cache Evidence Boundary

Unit, integration, security, and Podman tests prove canonical key policy, role/scope partitioning, no-change responses, browser `private, no-store`, search bypass, mutation invalidation, purge failure behavior, operation budgets, evidence redaction, and dashboard refresh UX. Podman does not implement or prove Cloudflare's real edge cache behavior.

The required 30-sample cache-disabled/cache-enabled `Cf-Cache-Status`, p50/p95/p99, operation-budget, and post-purge Cloudflare edge comparison remains open. It requires authorized short-lived super-admin login tokens and controlled sequential deployments. Normal-traffic deployment-scoped aggregate evidence also remains below a decision-quality sample count. Analytics, order-derived inventory, and download-readiness caching therefore remain disabled by default.

## Recovery Evidence Boundary

The live encrypted KV/R2 snapshot, preview restore, readback, cleanup, and reviewed Durable Object inventory recovery implementation are complete. This does not prove the complete recurring objective: business approval of RPO/RTO/retention, encrypted admin exports, second-device/location decryption, restricted live Stripe comparison, durable off-account S3 retention, and a fully enabled protected quarterly run remain open.

`RECOVERY_DRILL_ENABLED` remains `false`. The age identity, reviewed preview resources, and protected reviewer are present. Enabling the captured-data job still requires a fresh one-time super-admin token, restricted live Stripe read key, approved S3 destination/credentials, and operator retention/RPO/RTO approval. Production restore remains a separate manual incident operation with maintenance, Stripe, inventory, pre-snapshot, conflict-policy, and exact-acknowledgement gates.

## Sign-Off

- Automated gate owner/date:
- Cache edge evidence owner/date:
- Backup key/retention owner/date:
- Restore drill owner/date:
- Notes/blockers:

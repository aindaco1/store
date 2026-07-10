# Cache And Recovery Hardening Evidence

- Generated: `2026-07-10T01:44:15Z`
- Branch: `release/1.0.6-cache-backup-hardening`
- Base commit/tag: `42a5e902fa4fc7f479b6bf147736506caff4636d` / `v1.0.6`
- Release status: documented as additional `v1.0.6` hardening; the published tag was not moved
- Production deployment: not performed

## Automated Evidence

| Result | Check | Evidence |
| --- | --- | --- |
| PASS | Final release smoke | `npm run release:smoke -- --podman-e2e --evidence-file /tmp/store-cache-backup-hardening-definitive-release-smoke.md`; pre-merge, launch readiness, Podman doctor/E2E, accessibility automation, rendered i18n/SEO, Worker fulfillment, read-only provider readiness, and payment readiness passed. Logs: `/tmp/store-release-smoke-logs.6gA2He`. |
| SKIP | Optional screen-reader transcript | Not required for this backend/admin hardening slice. Existing UI changes remain covered by axe, keyboard/status, high-zoom, responsive, and localized Podman Playwright checks. |
| PASS | Focused cache/backup/restore suite | Vitest 4 ran 65 tests across the admin export client, shared order model, cache policy/endpoint/benchmark, snapshot, restore, inventory, setup, and Film adapter suites. |
| PASS | Podman security | 21 tests passed, including clean-state concurrent admin-auth burst throttling, auth boundaries, input limits, webhook signatures, CORS, and fail-closed behavior. |
| PASS | Synthetic restore rehearsal | `npm run restore:rehearse` verified 16 fixture artifacts including its finalized manifest, prepared 34 actions with zero missing value families, restored one authoritative record, excluded quarantine state, planned derived repair, and received `401` plus `private, no-store` from the Podman Worker admin probe. |
| PASS | Metadata snapshot and restore plan | Snapshot v2 at `/tmp/store-cache-backup-hardening-snapshot-v3` created 424 payload artifacts plus the finalized manifest, for 425 checksum-covered artifacts, with `0700` directory and `0600` manifest/checksum permissions. `npm run restore:plan` verified all 425 artifacts, prepared 20 no-write actions, and explicitly blocked execution because a metadata-only snapshot lacks 14 value artifacts. The only snapshot warning was the intentional skip of remote provider inventory. |
| PASS | Storage inventory | `npm run backup:inventory:audit` covered 33 Worker storage families. |
| PASS | Dependency audit | Vitest/esbuild and vulnerable transitive development dependencies were upgraded; `npm audit` and `npm audit --omit=dev` both reported zero vulnerabilities. |

## Cache Evidence Boundary

Unit, integration, security, and Podman tests prove canonical key policy, role/scope partitioning, no-change responses, browser `private, no-store`, search bypass, mutation invalidation, purge failure behavior, operation budgets, and dashboard refresh UX. Podman does not implement or prove Cloudflare's real edge cache behavior.

No preview or production Worker was deployed from this branch. The required 30-sample enabled/disabled `Cf-Cache-Status`, p50/p95/p99, Worker CPU, hit-ratio, and post-purge edge benchmark remains open. Analytics, order-derived inventory, and download-readiness caching therefore remain disabled by default.

## Recovery Evidence Boundary

The metadata snapshot and synthetic Podman drill contain no production customer/provider data and perform no production writes. A live encrypted KV/admin/R2 snapshot with an operator-controlled key, isolated decryption, complete R2 capture, off-device retention, and full restore rehearsal remains open. Production restore remains manually gated by maintenance, paused Stripe webhooks, inventory review, a verified pre-restore snapshot, conflict policy, and exact acknowledgement.

## Sign-Off

- Automated gate owner/date:
- Cache edge evidence owner/date:
- Backup key/retention owner/date:
- Restore drill owner/date:
- Notes/blockers:

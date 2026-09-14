# Platform reuse batch 2 — September 14, 2026

## Scope

Release Core 0.4.0 now owns retention selection, evidence-age classification and read-only receipt inspection. The scripts retain file discovery, deletion/copy execution, acknowledgement checks, product configuration and recovery. Site Shell 0.3.0 owns video poster observation, preview/canvas lifecycle and cleanup. Consumer markup supplies its global/cache names and URL policy.

Store retains page-location resolution and strict same-origin behavior.

The old poster file is removed; layouts load the pinned shared entry directly. Starter recipe sources are excluded from public Jekyll output and the build gate checks that exclusion.

## Immutable source and validation

- Previous consumer release source: `3ef837e8cf709472f16289eb7857171014637705`.
- Characterization-only commit: `db76521e67e1cea93b53f81ba9761217a5092bcd`.
- Previous Platform pin: `ae380c43a16af352ae946f47dd1b7aa4e5b093f0`.
- New Platform v0.38.0 pin: `8609b10348da42f20e51b5a9048e074a3a3ae5e2`.

Before extraction: 13 backup tests and 4 poster tests passed. After extraction: the same 17 tests passed. Real Chromium 151 decoded synthetic WebM and produced a 128x72 JPEG with no page errors before and after migration; cross-origin requests were rejected and explicit posters retained. The full merge smoke gate is required before merging, including build, security, Worker smoke and browser coverage.

Local consumer tests: 566 passed. Hosted merge smoke remains required.

Platform release checks establish the shared contract separately. Consumer CI,
deployment versions and live checks are recorded in this migration's pull request;
a source pin is not a claim of production acceptance.

## Independent rollback

The characterization commit retains the previous implementation and Platform pin.
Reverting the following migration commit restores the old source, gitlink,
package/version expectations and lockfile together while retaining the behavior
tests. Initialize submodules, run npm ci (also in worker for this project's Worker
subdirectory if present), run the complete release gate, and redeploy this consumer's
reviewed prior release. The rollback does not change another consumer.

No storage/schema migration is introduced. Do not roll back only the gitlink:
the adapters and shared script paths must move with it. Retain the previous
production deployment version for immediate rollback while source checks run.

# Runtime trust and Platform TOML repair — October 21, 2026

This source candidate pins CI Node to 24.22.1, prevents host NVM downgrades,
and gives Worker/Playwright images a checksum-pinned 24.22.1 executable and
new cache tags. Entrypoints fail before dependency installation when the runtime
is older than the supported fixed patch. It does not deploy Store.

The separate TOML advisory is repaired by adopting the already-reviewed
Platform commit `e2046752800bbad6e71f9aceb24c28be99e95111` (workspace 0.43.1,
Release Core 0.5.1), including its exact smol-toml 1.9.0 pin. The preceding
Platform commit is `2e5df578c08c4af0b827a08fefee8986acf5f24b`. The only
upstream differences are the Release Core dependency/version and release docs.
Store's consumed browser/Worker package APIs remain unchanged.

Validation:
- 668 unit tests pass, including 14 runtime-selection cases.
- Focused Platform/package contracts pass (24 tests).
- Root and Worker full dependency audits report zero vulnerabilities.
- Pre-merge secret, template, product-content, i18n, syntax, focused/full unit
  and build-artifact phases pass after adoption.
- Local pre-merge stops at the selected Podman engine being unreachable.
  Do not treat this as a full pre-merge pass; the PR's CI run owns that result.
- The shutdown test probes a new TCP connection while the controlled generator
  remains active, then requires normal process exit after the generator finishes.
  No production shutdown behavior was changed.

Independent source rollback was exercised by restoring the previous gitlink,
root manifest/lock and pin-contract expectations, running the Platform pin
suite successfully, then restoring this candidate. This is source compatibility
evidence, not a production rollback or a test of an older deployed Worker.
Reverting the Platform adoption commit restores that coherent source state
independently of Pool or other consumers. It also restores the older vulnerable
TOML parser, so prefer a forward fix if an unrelated regression appears.

Runtime-only changes can be reverted independently and container images rebuilt.
Retain signed release/production deployment authority with Store. No live
Stripe mutation, order change, customer email or publication was used for testing.

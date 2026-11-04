# Weekly maintenance candidate — 2026-11-03

Axe-core 4.14 exposed accessible names that omit the empty cart's visible price
or interrupt the admin button's visible label. Site Shell owns the shared cart
fix; Store retains download-action copy and RSVP question controls. No rules are
disabled. The browser suite continues exercising the actual controls and axe
checks.

## Migration

Pin Platform `782831f6b8fed8bb03488300446331222250efe9` (workspace 0.49.1,
Site Shell 0.6.1, Release Core 0.7.1) and exact `smol-toml` 1.9.1 together.
The dependency is [Platform PR 65](https://github.com/aindaco1/dust-wave-platform/pull/65).
It must land while preserving that commit before consumer release.
[Pool PR 111](https://github.com/aindaco1/pool/pull/111) independently characterizes
the same shared change.

This candidate incorporates Playwright 1.64.1, axe-core 4.14.0 and jsdom 30.1.3
from PR 120, plus the coordinated TOML upgrade from PR 121. Lighthouse is pinned
to 13.5.0: the proposed 13.6.0 introduces five moderate dependency audit findings
through Sentry, glob and minimatch. The observed advisories are
[GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) and
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
Keeping the existing clean Lighthouse release avoids an unreviewed transitive
override. Existing PRs 120/121 remain open until this replacement lands.

## Validation

The new translated empty-cart regression fails on the old Platform pin and
passes on the candidate; all 11 cart/pin tests pass. All four root/Worker
production/full audits report zero vulnerabilities with the final lockfile.

The initial full premerge attempt passed 794 unit tests, security, build,
resource and Worker-smoke checks, then passed 101 of 102 browser tests. The
remaining failure was the existing admin test searching for the old accessible
name; selectors were updated to the corrected labels. The complete gate then
passed against the final dependencies and selectors: 794 unit tests, 22 security
tests, all 102 browser tests, and every secret/template/content/i18n/build/resource/
Worker-smoke phase. Logs: `/tmp/store-premerge-logs.wKmLx1`.

## Independent rollback

A separate clean checkout of consumer `027080d76c12c6ad2bec407f83e8bc925dc93847`
with Platform `d882c79c028cad982f49b4c4829b035717a5f552` (workspace 0.49.0,
Site Shell 0.6.0, Release Core 0.7.0) passed `npm ci` and all ten pre-migration
cart/pin tests. Restore this consumer's gitlink, exact version-contract test,
manifests/lockfile and matching test changes together to return to `smol-toml`
1.9.0 and the previous dependency group. The new empty-cart regression intentionally
detects the old defect and must be reverted with that rollback. Admin copy and its
matching browser selectors can also be reverted as one unit.

Pool can retain its candidate independently. No storage or data migration is
involved. This is source-level rollback evidence, not a production rollback.
No deployment, live payment, email send or production-provider acceptance was
performed for this candidate.

# Licensing server-secret recovery and admin preview

Store base: `53f2bd03b56dacc3cb57c704502cbe0812160f4e`.
Compatible authority: `e84e61090de73c921096c0a86449e9265229d98b`,
[private PR #3](https://github.com/aindaco1/dust-wave-licensing/pull/3).
This is test-only implementation evidence, not a production deployment.

## Changes

Authority credentials have one bounded previous value; capture credentials keep
their read-only role. Current activation tokens identify their signer and old
signers retire at an absolute deadline. Grant generations and device revisions
still deny revoked/replaced credentials. Store preserves its stable derivation
root and sends only its current service credential.

Restore compares checkpoint HMAC proofs for the complete bounded token key set,
key IDs/deadline, Store derivation root and updater public key before importing.
The existing age/checksum/archive/restore flow remains the owner. Data archives
exclude raw secrets and do not replace protected key custody. No new persistent
data family or Platform release/pin is needed.

`preview:licensing-admin` builds the existing Jekyll dashboard and real Workers
with disposable synthetic data. Visible inspection confirmed signed login,
paid-order/refund history, active installation controls, private releases and
complimentary licenses. No new admin renderer, auth bypass in the product, live
provider calls or real email sends were introduced.

## Validation

- Authority: 15 Worker/SQLite tests and Wrangler dry-run build passed. Hosted
  [Feasibility checks 42455294576](https://github.com/aindaco1/dust-wave-licensing/actions/runs/42455294576)
  passed on the exact authority ref above.
- Store: full `test:premerge` passed: 874 unit tests, seven payment contracts,
  22 security tests, 113 browser tests, and all audit/build/resource/Worker checks.
  Final focused recovery/credential/administration checks passed 14 tests.
- Updated local encrypted restore passed: 50 Store records, 41 authority rows,
  two artifact objects; zero external requests, live payments and real emails.
  Wrong current/root/previous keys, missing previous keys and altered retirement
  policy were rejected with no imported rows. The recovered legacy signer worked
  during overlap and failed after retirement; current tokens and customer-key
  recovery continued working. Existing refund/revocation/withdrawal/retry checks
  passed and raw server secrets were absent from the software snapshot.
- ASCII VJ Remix: local receipt validation accepts four/five/six parts within its
  existing size/character/installation bounds. 96 Rust tests and Tauri policy
  passed; two existing environment-specific checks were ignored. Its dirty pilot
  work was preserved. This change is local source compatibility, not a shipped
  signed-app or new Keychain acceptance claim.
- Platform: 397 tests and both clean-checkout recipes passed; execution-doc
  changes remain local. No runtime package or pin changed.
- Original dirty Store: all 105 recorded file hashes remained unchanged.

## Provider and launch boundary

The direct deployed attempt failed during initial Cloudflare KV enumeration with
Wrangler authentication error 10000. No Worker, bucket or namespace was allocated;
cleanup completed. The updated deployed/off-account rotation checks are implemented
in the existing protected rehearsal, but have not passed on this revision. Run
the main-only `production-recovery` workflow after review/merge; retain its normal
reviewer gate and existing archive credentials/destination. Do not treat the prior
run 42453190850 as evidence for this new code.

Independent Cloudflare/GitHub reads found production `store-worker` unchanged:
modified `2026-11-04T02:43:42.429179Z`, ETag
`40a09ab32dc3a1e84d27fcfb3bd189508b7477e0a82749babb521f7948d11e05`.
No licensing enablement binding or repository/environment licensing capture opt-in
was present. The existing ordinary `BACKUP_SCHEDULE_ENABLED=true` was preserved.
Paid Entitle sales and scheduled licensing capture stay disabled. No production
secret was generated, transferred or rotated by this phase.

## Operation and rollback

Follow [the server-secret procedure](../SOFTWARE_SERVER_SECRETS.md). Deploy the
rotation-capable authority before Store; preserve a schema-4 reader that understands
versioned tokens when rolling back. Retain original roots and key material needed
by retained archives. Rebuild the compatible ASCII pilot before its separate
signed activation/reactivation acceptance. A retired signer may require a user to
enter their existing key again; installed rendering continues to work offline.

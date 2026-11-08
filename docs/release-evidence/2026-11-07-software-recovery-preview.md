# Software recovery preview rehearsal — November 7, 2026

Implemented in Store and the licensing consumer. Paid checkout, paid catalog
publication, production licensing and scheduled licensing capture remain disabled.
No production Worker was deployed or restored; no live payment or real email was
sent. The protected off-account archive leg is prepared but has not run.

## Implementation

- The existing restore planner accepts a software preview only with dedicated
  run-specific Worker origins/configuration, test mode, checkout false, matching
  namespace bindings and provider namespace ownership. Authenticated identity and
  original-key proofs are checked before ordinary KV/R2 writes. Production
  software restore is still rejected.
- The local and deployed rehearsals share the same synthetic Store fixture,
  stopped source checkpoint, logical export/import, encryption and archive
  verification. No shared Platform runtime or pin changed.
- The manual main-only workflow uses the existing `production-recovery`
  environment, age identity, off-account bucket and credential names. It uploads
  ciphertext before the receipt, downloads fresh copies, checks digests/receipt
  equality and verifies the downloaded archive before extraction/restore.
  Synthetic snapshots use a sibling `software-rehearsal/` prefix, outside the
  production `store/` prefix, and are retained under the existing bucket policy.
- Preview secrets are ephemeral provider secrets. Newly named test Workers,
  namespace and buckets are cleaned up; retained archive objects are not deleted.
  Capture uses read-only credentials. Restore authority is never added to the
  unattended capture workflow. The rehearsal cannot enable paid checkout.

## Validation

The encrypted local rehearsal passed on the restored checkouts. The real
Cloudflare preview run passed using locally encrypted/decrypted synthetic data:

- Two Store owners, 50 journal records, 36 authority rows and two licensing
  artifacts restored, with ordinary Store KV/download readback.
- Read-only credentials could not import; a lost upload reply and complete replay
  were safe. Removing checkpoint mode without acceptance left downloads blocked.
- Explicit acceptance restored the original activation/key and signed download;
  seat limits, coverage gaps, refunded renewals and seller revocation held.
- A repeated initial-payment event queued no mail. Stripe was a synthetic
  read-only fixture; live-provider and real-recipient delivery were not exercised.
- The final reviewed-source acceptance run measured 50.8 seconds for restore/readback and
  218.3 seconds for the complete synthetic exercise. These are measurements of
  this fixture, not a production RTO. Resource deletion and subsequent absence
  checks passed.

Store's full pre-merge gate passed all stages: 848 unit tests, seven payment
contracts, 22 security tests, 109 browser tests, build/resource checks and Worker
smoke. After the final recovery guard changes, 45 focused tests and the local
rehearsal passed. Licensing passed 10 tests and its dry-run build. Platform passed
397 tests and both clean-checkout recipes. Full gate logs:
`/tmp/store-premerge-logs.7z3JiU`.

The first deployed attempts exposed a transient upload failure, the fixture's
missing rate-limit binding, and Wrangler's current literal namespace title.
Those were corrected; independent provider reads confirmed no resources remained
from those runs. Cloudflare's default deferred Durable Object update initially
retained the pre-acceptance configuration. The rehearsal now uses immediate
updates only on its isolated Workers. This does not substitute for production
quiescence; see the operator guide's linked Cloudflare documentation.

## Remaining protected run

The user chose GitHub's existing protected environment for archive credentials.
Read-only GitHub inspection confirmed `production-recovery` requires a reviewer
and admits only `main`. Its protections remain unchanged. The reviewed licensing
consumer is now published in the private
[`aindaco1/dust-wave-licensing`](https://github.com/aindaco1/dust-wave-licensing)
repository at `374cebde87529a1946fe7164cd820b094559586e`.
Its [CI checks passed](https://github.com/aindaco1/dust-wave-licensing/actions/runs/42427715673).
A read-only SSH deploy key scoped only to that repository is held as
`LICENSING_SOURCE_READ_KEY` in the existing protected recovery environment;
private-source checkout does not use a broad personal access token.

Before the full protected run:

1. Review/merge the Store implementation and manual workflow to `main`.
2. Dispatch **Rehearse Software Recovery** with that reviewed licensing commit
   and approve the existing protected environment review.
3. Require `remoteArchive:true`, successful restore checks and verified cleanup
   in the resulting receipt. Leave paid checkout and production capture off.

The deployed source drain, live Stripe/Resend comparison, independent secret
escrow, production scheduling and operational licensing RPO/RTO remain separate
gates. No paid-launch readiness is claimed.

Private working evidence and before/after source copies are retained outside
iCloud at `/Users/aindaco1/Documents/Codex/2026-11-07/licensing-preview-recovery`.

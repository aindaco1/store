# Licensing backup integration and restore rehearsal

Requested November 4, 2026. Implemented locally in Store and the licensing
consumer. Paid catalog offers remain unpublished, production licensing remains
disabled and the rehearsal explicitly sets paid checkout false. No deployment,
live payment, real email, production restore or remote archive write occurred.

## Implementation

- Store's existing snapshot/restore tools now include versioned logical billing
  and complimentary journals, licensing schema-3 authority and all licensing R2
  artifacts. Existing checksum, encryption, archive-copy and retention machinery
  is reused. No Platform runtime/package/submodule change was needed.
- Both source Workers require a drained maintenance checkpoint. The capture
  rejects missing/repeated pages, unknown journal/schema versions, missing owner
  membership, mismatched canonical KV, absent completed coverage/refunds and
  missing/changed artifacts. Source uploads must remain paused.
- A read-only credential can capture but cannot import/upload/issue/revoke.
  The scheduled workflow remains opt-in off and retains its existing ban on
  admin/payment authority. New read credentials were not provisioned.
- Restore requires empty isolated targets, original key proofs, fresh read-only
  payment/invoice/refund comparison, full logical/object readback and signed
  artifact verification. Provider drift blocks acceptance. Seller revocations
  after a backup still require operator reconciliation. Due indexes, alarms,
  card sessions, inventory holds and stale notification jobs are excluded.
- Imports stay persistently locked until complete and explicitly accepted.
  Source artifacts bind to the new R2 version only after digest/signature checks.
  Lost upload replies and complete import retries are safe.
- The macOS archive path now excludes AppleDouble metadata that would otherwise
  escape the existing checksum inventory. The checksum verifier was not weakened.

## Acceptance evidence

`npm run restore:rehearse:software` passed using actual isolated workerd instances,
synthetic provider fixtures and ephemeral age/Minisign keys. The existing Store
archive implementation and pinned Platform archive verifier handled the encrypted
round trip. Sanitized results are in `2026-11-04-software-backup.json`:

- Two Store owners / 50 journal records, 36 licensing rows and two R2 objects
  (including an unattached object) restored and read back.
- Mixed merch/ticket/license purchase, renewal and scoped refund survived.
  Old coverage stayed accessible; gaps, the refunded renewal and seller-revoked
  access remained denied. Original activation/key and seat limits survived.
- Missing pages and inconsistent KV checkpoints failed capture. A refund not in
  the backup failed money acceptance. Read-only credentials failed import.
- A lost upload reply and a second complete restore were recovered safely.
  Restart without explicit acceptance remained closed. Approved KV/mail receipts
  restored; sessions and pending mail did not. Duplicate payment replay queued
  no new email. External requests, live payments and real emails: zero.

Validation: licensing 10 tests and Wrangler dry-run build passed (60.55 KiB).
Platform 397 tests and both clean-checkout recipes passed before its original
checkout disappeared. Store final pre-merge passed (exit 0): all 12 stages, 844 unit tests, seven
payment contracts, 22 security tests and 109 browser tests (5.0 minutes), plus
build/budget/SEO/resource/Worker checks. Logs: `/tmp/store-premerge-logs.jVrb0J`.
After the final export no-store/noindex header correction, 41 focused tests and
the actual encrypted Worker rehearsal passed again. Source/snapshot/schema
checks and `git diff --check` passed. All test runtimes and the isolated Podman
stack exited; no production process was stopped.

The first full Store attempt correctly rejected admin credentials in the capture
workflow. It was fixed with read-only capture credentials; the security contract
was preserved. No failing check was waived.

## Operations and remaining launch gates

See `../BACKUP_RESTORE.md` for commands and explicit operator acceptance. The
snapshot workflow's remote upload/readback/retention mechanisms were reused but
not newly exercised against a live archive. This evidence is a local synthetic
restore, not an operational RPO/RTO claim. Production scheduling/credential
provisioning and a reviewed live quiescence/restore procedure remain future gates.
The existing payment UI/SCA, real-recipient mail and app distribution/signing
acceptance gates also remain; no paid launch was authorized.

The original Platform checkout unexpectedly disappeared during this task. The
user did not report moving it. Its two licensing planning documents were recovered
from recorded edits into the non-iCloud task backup, and updated there with this
outcome. Consumer changes and this evidence remain in their original repositories.
The original Platform directory and its unrelated files have not been recreated
or claimed recovered. A source-only task backup is retained at
`/Users/aindaco1/Documents/Codex/2026-11-04/licensing-backup-integration`.


## November 5 restoration follow-up

The original Platform directory is present again at `d33b417`. Its completed
licensing backup results were reconciled from the outside-iCloud recovery copies.
The implementation's consumer source files matched the saved versions; two
reverted test additions and this missing Markdown record were restored. Original
copies of differing files are retained in the November 5 restoration audit.

The restored Platform object database lacked history objects. Immutable objects
from Store's healthy pinned Platform checkout repaired all missing objects in
HEAD's history without changing commits, refs, the index or consumer pins. Three
historical `security/github-tokens-20260915-*` tags still reference unavailable
objects; those refs were preserved, so full `git fsck` is not clean. Platform's
pinned dependencies were reinstalled from the offline cache after a missing
esbuild executable was detected. Its 397 tests and both clean-checkout recipes
then passed. Audit files are under
`/Users/aindaco1/Documents/Codex/2026-11-05/platform-restoration-check`.


Store's restored test runner initially could not start workers. Reinstalling its
unchanged lockfile from the offline cache resolved that; all 41 focused backup,
restore and workflow-security tests passed on November 5. The incomplete generated
dependency directory was set aside at
`/Users/aindaco1/Library/Mobile Documents/com~apple~CloudDocs/.store-node-modules-recovery-20261105`.
No package versions, paid-sales flags or deployments changed.


## November 6 Git integrity follow-up

GitHub retained the three missing security snapshot tags and their histories.
Their original hashes were verified in an isolated bare repository, then only
immutable object files were added to Platform. `git fsck --full` now passes,
including reflogs. All refs, HEAD, index, configuration and existing Platform
working-file hashes are unchanged. No history rewrite or tag deletion was needed.

Recovery evidence and an isolated copy of the fetched histories are retained in
`/Users/aindaco1/Documents/Codex/2026-11-05/platform-restoration-check/security-tag-followup`.
This follow-up changed no runtime code, dependencies, paid-sales flags or deployments;
application tests were not rerun for the Git metadata repair.

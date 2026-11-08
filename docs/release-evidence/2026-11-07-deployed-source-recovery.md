# Deployed-source software recovery — November 7, 2026

Paid Entitle sales, production licensing and scheduled licensing capture remain
disabled. No production Worker, customer payment or real recipient email changed.

## Published baseline

Store PRs [#123](https://github.com/aindaco1/store/pull/123) and
[#124](https://github.com/aindaco1/store/pull/124) merged; private licensing commit
`374cebde87529a1946fe7164cd820b094559586e` was published. Protected run
[42430004952](https://github.com/aindaco1/store/actions/runs/42430004952) passed
the existing encrypted off-account round trip and isolated restore with a stopped
local source. Those publication and archive gates are no longer pending.

## Deployed-source extension

Store and licensing now gate dedicated test sources with bounded, persistent
admissions. Store drains requests, deferred tasks and coordinator alarms before
licensing is paused. Both must expose the same frozen checkpoint. Ordinary
fixture KV/download data is seeded and read back from the deployed source;
software journals, authority and signed artifacts use the existing capture
adapter. State/generation comparisons reject a source that resumes during capture.

The original fixture, resource lifecycle, archive and restore owners are reused.
No new scheduler, backup destination, encryption implementation or shared Platform
package is introduced. Source admission state remains local to each source;
restored targets still omit alarms, transient sessions and pending mail payloads.

## Observed validation

The Cloudflare preview-only candidate passed with both source and destination
cleanup, independently confirmed by provider reads. It restored two owners,
50 journal records, 36 authority rows and two artifacts. The receipt is
[the deployed-source preview evidence](2026-11-07-deployed-source-recovery.json).

Checks passed for in-flight/deferred/alarm completion before freeze; rejection of
new webhooks and early resume; blocked scheduled work; capture-only credential
boundaries; frozen state surviving redeployment; original key access after resume;
idempotent resume and payment replay; and the existing restore acceptance lock,
seat/coverage/refund/revocation, signature and lost-upload-reply checks.

Measured source drain was 3.1 seconds, target restore/readback 39.9 seconds, and
the full synthetic exercise 287.6 seconds. These are fixture measurements, not
production RPO/RTO. This local-run receipt has `remoteArchive:false`; the existing
protected archive leg was not re-exercised by that command. Protected acceptance
of the final published sources remains the next check through the existing manual
main-only workflow. Its outcome will also be retained on the reviewed PR.

Licensing's 11 tests and dry-run build passed; focused Store source/recovery tests
and the local encrypted rehearsal passed. The full Store gate is running.
Platform changes are execution documentation only; its test/recipe gate passed.

## Limits and rollback

Source mode must be present from source provisioning and retained through capture.
No direct provider writes or guard-removing deployments may straddle a checkpoint.
An abandoned admission never expires automatically: a timeout fails closed and
requires investigation, not a force-open or ticket-deletion shortcut. The preview
uses synthetic Stripe truth and real isolated Cloudflare resources; it does not
prove live provider reconciliation, independent key escrow, general transactional
KV/inventory capture, or production scheduling. Existing real-browser/Resend,
operator lifecycle, capacity and ASCII VJ release gates remain open.

Default non-source behavior and exact Platform pins remain unchanged. Roll back
consumer code only outside a paused source or after explicit completed resume;
do not bypass an outstanding source/restore lock. Paid sales and scheduled
licensing capture remain off regardless of this rehearsal's result.

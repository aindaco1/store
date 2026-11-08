# Provider follow-up and license administration — November 7, 2026

Paid Entitle sales, production licensing and scheduled licensing capture remain
disabled. This phase changes consumer-owned code and exercises isolated fixtures;
it does not deploy Store, launch a paid ASCII build or enable a backup schedule.

## Changes and ownership

- The licensing authority owns atomic key replacement, per-installation
  deactivation, all-seat reset and immutable idempotency receipts. Store derives
  replacement keys using its existing secret; it maintains no second rotation
  journal. Deactivated devices retain a revision tombstone so an old token cannot
  become valid after reactivation. Seat limits and installed-use policy remain.
- Existing private order capabilities and admin session/role/CSRF checks guard
  the English/Spanish controls. Operator and customer identity references are
  hashed by Store and retained in authority receipts; customer responses exclude
  those references and internal key hashes. Key recovery remains an explicit
  reveal operation. No raw key is stored in browser storage or audit history.
- Super-admin release withdrawal removes a build from lists, feeds and all
  download paths, including HEAD/range requests. Artifact bytes and metadata
  remain available for recovery. Operator payment/refund/review/work history,
  customer invoices and authority history/releases have bounded cursor pages.
- The existing encrypted pipeline captures schema 4 administration state. It
  still restores schema 3 archives with additive defaults. No new backup store,
  scheduler, email integration or Platform runtime package was introduced.

## Provider follow-up

The first full sandbox run reproduced the early declined-payment webhook's 409:
`Store PaymentIntent mismatch`. The journal stored only this bounded error label,
not the provider payload. The order subsequently contained the correct identity.
A behavior test reproduced the stale pre-provider KV checkpoint while the existing
checkout Durable Object already held the committed PaymentIntent identity.

The fix reads that existing coordinator only when the identity is absent and its
attempt/order hash matches. Normal identity, amount and currency checks still
apply; a conflicting nonempty PaymentIntent is rejected. An unavailable committed
checkpoint produces a retryable 503. The read neither creates a payment nor returns
a client secret. This follows the existing ownership boundary; KV visibility does
not become payment authority. Cloudflare documents KV's cross-location visibility
and cache delay in [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

The full run completed authenticated 3DS for a single $60 merch/ticket/software
purchase, hosted card changes, an $11 declined renewal with recalculated tax and
recovery of that original invoice. Signed public webhook fulfillment added
coverage once. The replay assertion observed a later receipt for the same paid
event with HTTP 200, then verified two payments and zero additional sends. Exactly
three approved-recipient messages were verified delivered through Resend, with
test labels, text/HTML, reply-to and private management links. Inbox rendering was
not observed. This closes the prior post-run replay-assertion evidence gap.

A second allocation attempt failed authentication before any Worker or KV
namespace was created. After the existing Wrangler credential refreshed, a fresh
checkout-only run exercised the patched handler: initial decline HTTP 200 with no
fulfillment, authenticated 3DS, one settlement, and a fresh signed declined-event
replay with HTTP 200 and no extra fulfillment. It sent no emails. The sanitized
JSON records the before/after receipt timestamps; Stripe CLI acknowledgement alone
is not acceptance ([Stripe webhook guidance](https://docs.stripe.com/webhooks)).

Both successful runs cleaned their Workers/KV, Stripe endpoints and clocks/customers;
test catalog entries were deactivated. An independent Cloudflare read found no
rehearsal Workers. Production Worker modified time/etag were unchanged, no paid
licensing bindings were present, and repository/production-backup licensing capture
opt-ins remained unset. The existing ordinary backup schedule was not altered.

## Validation and recovery

- Store's complete pre-merge gate passed: 872 unit tests, seven payment contracts,
  22 security tests, 111 browser tests, and build/artifact/resource/Worker checks.
  A final action/cursor hardening review passed 74 focused tests. All nine final management UI cases passed,
  including withdrawal after a lost reply and invoice/operator pagination.
- Licensing passed all 14 real Workers/SQLite tests and its dry-run bundle build.
  Tests cover legacy tokens, stale generations, exact retries, conflicting command
  IDs, cross-product denial, token non-resurrection, withdrawal and pagination.
- The age-encrypted local rehearsal captured 50 Store records, 41 authority rows
  and two artifacts, verified archive checksums, restored into empty quarantine,
  and reconciled two payments/one refund. It recovered the replacement key, denied
  old keys and old device tokens, retained withdrawal and administration receipts,
  and safely replayed a lost upload/restore. It made zero external requests, live
  payments or emails. Schema 3 import compatibility has a separate authority test.
- Platform passed 397 tests and both clean-checkout recipes after its execution
  documentation refresh. Those local documentation edits are not a package release.
- The original dirty iCloud Store checkout's 105 preserved-file hashes still match.
  Source edits and provider credentials/state were kept in separate local locations.

The companion JSON contains aggregate evidence only. Provider IDs, private order
URLs, tokens, raw keys, credentials and customer data are excluded.

## Deployment order, rollback and remaining gates

Publish a compatible schema 4 authority before the new Store administration UI.
Once schema 4 has been opened, do not roll the authority binary back to a schema 3
reader; it deliberately rejects newer schemas. Roll Store back independently or
disable the pilot, retaining the schema 4 reader and authority history. Use a fresh
isolated restore for schema experiments, never a destructive in-place downgrade.

Before any paid launch: run the protected off-account/deployed-source rehearsal on
the reviewed schema 4 commits; complete production secret recovery/rotation and
capacity/retention acceptance; decide dispute, pricing and support policy; and
close ASCII distribution/source/font and release-identity update gates. VCR OSD
Mono remains retained pending redistribution evidence. No approval to enable paid
sales or scheduled capture follows from these test results.

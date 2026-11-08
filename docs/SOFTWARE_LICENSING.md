# Software licensing: Store billing pilot

The first slice is test-only. ASCII VJ Remix is the only accepted product.
Software offers now use the existing Store checkout and its inventory coordinator.
Only carts with recurring software create a subscription; one-time carts retain
the existing PaymentIntent flow. Licensing owns access; Store owns the customer, grant intent,
admin authorization, email templates and Resend delivery receipts.

## Configuration and operation

Use a separate test Worker environment with:

- `APP_MODE=test` and `SOFTWARE_LICENSING_ENABLED=true`.
- `LICENSING_SERVICE`: Worker service binding to the licensing consumer.
- `LICENSING_ADMIN_SECRET`: its internal API secret.
- `LICENSING_KEY_SECRET`: a separate random secret of at least 32 characters.
- Existing `STORE_INVENTORY_COORDINATOR`, `STORE_STATE`, admin configuration,
  Resend sender/account and scheduled outbox processing.

No production bindings or secrets are added by this change. For local probes,
set `STORE_EMAIL_DRY_RUN=true`; do not reuse synthetic fixture secrets remotely.

Authenticated Store admins with `fulfillment:manage` and Store access can POST
`/admin/store/licenses/complimentary`, with the existing admin session cookie,
trusted Origin and `x-store-admin-csrf` header:

```json
{
  "id": "a-stable-operator-request-id",
  "email": "recipient@example.test",
  "product": "ascii-vj-remix",
  "seats": 1,
  "policy": { "kind": "lifetime" },
  "preferredLang": "en"
}
```

The first response is 202/pending. Repeating the same request returns the
existing state; changing its meaning returns 409. The policy may instead be
`{"kind":"major","major":1}` or a term with integer `start`/`end` timestamps
in **milliseconds since the Unix epoch** (exclusive end). There is no default
paid offer, revenue record, Stripe charge or automatic seat policy.

POST `/admin/store/licenses/recover` with `{"id":"a-stable-operator-request-id"}`
uses the same authorization and returns an already-issued key to the operator.
Recovery responses are private/no-store and audited without recording the key.
Complimentary recovery remains operator-assisted; paid orders use the private
order-page controls described below. There is no new customer account database. Do not put response bodies in diagnostics or screenshots.

## Retry and ownership rules

The existing inventory DO class uses a separate named object, `software-licenses`.
It stores immutable grant intent before calling the service. A replay uses the
same ID and HMAC-derived key. `complimentary:v1:` records retain the request,
key hash, issuance checkpoint and handoff state. Ordered
`complimentary-due:v1:` keys bound each alarm pass to 25 pending records. A lease
prevents overlapping passes; the scheduled watchdog resumes exhausted alarms.

A confirmed grant is retained if mail persistence fails. Retrying that state
only hands off to the existing email outbox. The `software_license` job holds a
grant ID and recipient; the template retrieves the canonical issued key before
freezing the provider payload. Existing Resend idempotency, reply-to, text part,
localized templates, receipts and ambiguous-delivery handling remain in force.
The rendered outbox payload includes the key and follows the existing restricted
30-day quarantine policy. Email failure never revokes the grant.

Keep the original derivation secret while grants exist. A changed secret fails
closed on recovery and rendering instead of emailing an unusable replacement.
Versioned secret rotation, independent encrypted exports, erasure policy and
reconciliation after restore are production gates. Preserve the grant checkpoint,
licensing authority, derivation secret and Resend receipts together; do not
restore due keys/outbox payloads and blindly resend. The data inventory records
this state under the existing DO binding and email-outbox families.

## Validation and rollback

Focused tests cover concurrent issuance, conflicts, lost grant responses,
mail-storage failure, more than 100 completed grants, wrong-secret recovery,
policy validation and production-mode denial. A sibling licensing harness runs
both real Workers, checks admin/CSRF denial and replay, drives the Resend dry-run,
and provides a key for the native private updater. See that consumer's README.

Disable `SOFTWARE_LICENSING_ENABLED` to stop complimentary issues and handoffs. Preserve
all existing records and secrets; disabling delivery does not revoke licenses.
The separate licensing consumer controls downloads. No Platform extraction or
consumer submodule advance is needed for this slice.

## Paid checkout, renewals and refunds

Set `SOFTWARE_CHECKOUT_ENABLED=true` in the isolated test environment as well as
the licensing flag. Keep both off in production. To pause **new paid orders**,
disable only `SOFTWARE_CHECKOUT_ENABLED`; keep the billing/licensing flag,
webhooks, alarms, original keys and service binding available for existing orders.
Turning off all billing while subscriptions remain active is not a rollback.

Products remain repository-owned. Add `software_license` to a fixed-price
`digital` product (or an offer variant), without download metadata or inventory
tracking. An offer has quantity one; its explicit `seats` supplies the allowance.
Do not publish real offers/prices until the paid-launch gates close.

```yaml
fulfillment_type: digital
price: 10 # illustrative test price only
software_license:
  product: ascii-vj-remix
  seats: 1
  billing: month # month, year, or once
```

For `billing: once`, require one tagged `updates` policy:
`{kind: term, days: 365}`, `{kind: major, major: 1}`, or `{kind: lifetime}`.
Recurring offers omit `updates`. The generator carries the reviewed offer into
the Worker catalog. Checkout ignores browser-supplied licensing fields, validates
the catalog offer, and includes it in the immutable order hash. During this pilot,
edit offer variants in repository source; the dashboard refuses variant edits
that would discard their licensing policy. Historical purchases do not follow
later catalog edits. Support-response commitments remain a separate launch decision.

Initial term purchases include already-published builds plus releases through
the purchased end date. Initial subscriptions do the same through the first
invoice period end. Later renewals add only their own paid interval, preserving
gaps and previously covered releases. The original billed period is retained
separately from release eligibility. One-time term duration starts at the actual
successful charge timestamp. Refunds never remotely disable installed software.

### Payment ownership

One-time-only baskets retain Store's PaymentIntent flow. A basket containing any
recurring offer uses one incomplete, flexible Stripe subscription invoice and the
existing Payment Element. One-time lines, shipping, tips and initial tax appear
only on the first invoice. The current test implementation supports USD, up to
16 cart lines (20 invoice lines including adjustments), monthly/annual cadence,
and cards for recurring checkout. It rejects unsupported/prorated/provider-edited
invoices instead of inventing entitlements.

Store recalculates initial shipping and tax from canonical product data and the
validated address; browser totals cannot underpay. Existing coupon allocation
determines each initial line. **Provisional policy:** coupons apply to the first
payment only; each recurring discounted line uses a once-only Stripe coupon.
Renewal amounts and automatic billing are disclosed before payment confirmation,
in English and Spanish. Product copy must also disclose the selected update and
support terms before adding the offer to the cart.

The checkout coordinator freezes the provider request and retains its normal
inventory hold, same-key retry and 23-hour ambiguous-creation cutoff. It stores
the subscription, initial invoice and subscription-item mapping before exposing
the payment secret. An isolated Stripe customer per order prevents unrelated
pending invoice items or customer credit from joining the invoice. Store owns
customer identity and email; the Stripe customer is not assigned a delivery email.

Subscribe the same signed Store webhook to:

- Existing `payment_intent.succeeded`, `.payment_failed`, `.canceled`.
- `checkout.session.completed` for verified card-setup completion.
- `invoice.created`, `invoice.paid`, `invoice.payment_failed`,
  `invoice.payment_action_required`.
- `customer.subscription.updated`, `customer.subscription.deleted`.
- `refund.created`, `refund.updated`, `refund.failed`.

Webhook payloads trigger fresh Stripe reads. Store validates mode, ownership,
invoice/payment identity, exact cents, currency and complete line mappings.
Manually marked-paid invoices and missing/extra/prorated lines cannot grant access.
Only the initial invoice confirms inventory/order fulfillment. Renewal invoices
never resend merchandise, tickets or one-time licenses.

Per owner decision, renewal tax is recalculated through Store's existing provider,
using the retained billing destination. Before exposing the initial payment
secret, Store sets the subscription's `pause_collection.behavior=keep_as_draft`.
Future invoices therefore start with `auto_advance=false`, including during a
Store outage; the already-created initial invoice remains payable. Do not unset
this provider guard. Merely rejecting `invoice.created` delays automatic
finalization for only 72 hours. See Stripe's [draft collection behavior](https://docs.stripe.com/billing/subscriptions/pause-payment)
and [webhook finalization timing](https://docs.stripe.com/billing/subscriptions/webhooks).

Store checks the due items, saves the tax snapshot before adding its tax item,
and checks for an existing item on retries. It then finalizes and pays that
specific invoice with stable keys, leaving the subscription guard in place.
Recovery between finalization and collection validates the frozen lines again
before paying the same invoice; it never creates a replacement PaymentIntent.
Tax failure leaves the invoice in draft. A paid renewal without a verified
snapshot requires review. Address/price changes remain operator-assisted. The private order page supports
payment-method and existing-invoice recovery. Failed payment does not extend or
remove coverage; monitor draft invoices and failed attempts. An approved dunning
schedule remains a launch gate. Hosted-browser sandbox acceptance is recorded below.

### Durable fulfillment and money records

Each order has a separate `software-billing:<orderToken>` instance of Store's
existing DO class. `billing-order` freezes its identity and snapshot;
`billing-payment:` receipts and balanced integer-cent `billing-ledger:` postings
are append-only. `billing-tax:` retains renewal tax evidence. Refund request,
reservation and provider-ID records prevent duplicate allocation and overspending.
These are a bounded commerce subledger, not general-purpose business accounting;
processor fees and bank payouts remain in existing reconciliation/reporting owners.

`billing-work:` commands and ordered `billing-due:` keys retry through DO alarms,
25 jobs per pass. A scheduled watchdog scans 25 canonical orders per run using
the rebuildable `software-billing-watchdog:v1` cursor and resumes their due work
after alarm retries exhaust. Each recurring order discovers at most 25 Stripe
invoices per pass with a disposable `billing-invoice-cursor`, recovering missed
draft/paid notifications. Unconfirmed initial orders resume the existing Store
settlement path using the original successful payment. It adds no second order
index. Per-invoice in-flight coalescing and durable leases prevent
overlapping workers from duplicating effects. Licenses use one stable derived key
per purchased software line; every paid period is a separate coverage command.
Refund revision 1 permanently supersedes grant revision 0 for that period, even
when delivered first. A lost acknowledgement reuses the same key, command and
coverage identity. Key-secret mismatches fail closed. No raw key is stored in the
billing authority; existing restricted email-outbox payloads contain the rendered key.

Successful coverage queues the existing `software_license` Resend template once.
Renewal, payment-failure, cancellation and refund notices use `software_billing`
through the same outbox, sender, plain-text rendering, reply-to and receipts.
Mail failure cannot undo paid coverage. No SMTP service or second mail queue was added.

### Operator API

These private POST routes require a Store super-admin session, trusted origin,
CSRF and rate checks. Bodies are capped at 16 KiB. Actions are audited without keys.

| Route under `/admin/store/licenses/` | Body | Result |
| --- | --- | --- |
| `billing` | `orderToken` | Frozen lines, first 25 receipts/refunds/reviews/work summaries per family, continuation cursors, cancellation state. |
| `paid-recover` | `orderToken`, `lineId` | Already-issued key and matched recipient. |
| `refunds` | `orderToken`, unique stable `id`, `paymentId`, `allocations` | Durable refund request (202); reuse the exact request to inspect/retry. |
| `cancel-renewals` | `orderToken` | End-of-period subscription cancellation; existing coverage remains. |
| `reconcile` | `orderToken` | Discover existing invoices, drain due work and resume initial settlement without another purchase. |

Refund example (invoice ID comes from `billing`; one-time receipts use a PI ID):

```json
{
  "orderToken": "store-order-<64-hex-attempt>",
  "id": "support-refund-001",
  "paymentId": "in_test_invoice",
  "allocations": [{"lineId": "line-2", "amountCents": 1000}]
}
```

Amounts are positive integer cents. Successful cumulative refunds of an entire
software line remove only that receipt's coverage. Partial software refunds enter
`billing-review:` without guessing a shorter term. Merchandise/ticket refunds
do not revoke software; this API records their money allocation but does not
restock merchandise or cancel attendance. Those fulfillment actions remain
operator-owned. Allocate tax separately when appropriate. **Provisional policy:**
refunds do not cancel renewals; use `cancel-renewals` explicitly. A canceled or
failed renewal never removes time already paid for.

Dashboard refunds have no trusted Store allocation and enter review. To import
one, include its existing `refundId` in a new `refunds` request with matching
payment, total and explicit allocation. Store retrieves it and never sends a new
refund. Unknown provider outcomes retain reserved amounts; after 23 hours an
unidentified refund stops automatic creation retries and requires review. Do not
replace that request ID to bypass ambiguity or retry it manually as a new charge.
No maker/checker ambiguous-money override is implemented.

### Recovery, validation and launch gates

Recover the billing DO journal before resuming its alarms. Reconcile receipts and
refund IDs with Stripe, replay refund tombstones into licensing, then reconcile
Resend receipts. Never rebuild paid coverage from a latest expiry date or replay
every outbox row after restore. The data inventory and backup guide include the
new key families. Independent encrypted DO exports and a complete restore drill
remain production gates; provider PITR alone is insufficient.

Run `npm run test:unit`. `npm run test:licensing:provider` uses the sibling
licensing consumer's pinned Miniflare/esbuild dev tools and the existing ignored
Store test key. It runs actual Workers with synthetic fixtures, signed local
webhook deliveries, real Stripe test objects and Resend dry runs. It verifies all
one-time policies, mixed monthly/annual first payment, coupon/shipping/tax,
monthly renewal after four days without Store notification, provider-held tax
collection, missed-event discovery, stale events, scoped refund/download denial, cancellation,
decline/SCA-required cancellation, and provider cleanup. It does not prove an
actual browser SCA challenge or public webhook delivery. The report is
`experiments/software-licensing/paid-runtime-result.json`.

Live prices/seat/support policy, approved retention and dispute policy,
production backup/restore acceptance and app distribution gates remain required
before launch. Sandbox browser/webhook and approved-recipient Resend evidence is
recorded in the acceptance section below. No public price, production webhook configuration,
production deployment or app release is performed by these changes.

## Customer and operator management UI

The pilot remains disabled outside `APP_MODE=test`, with
`SOFTWARE_LICENSING_ENABLED=true`. No paid ASCII VJ Remix product is published.
Keep existing `STORE_FULFILLMENT_SECRET` (or its supported legacy fallback)
configured: the confirmed private order summary mints a 15-minute management
capability using Store's existing signer. The same private order URL is available
through the existing order-lookup email flow; there is no second account/login
system. Treat that URL as sensitive and use normal support ownership checks.

On a confirmed order page, customers can:

- View update coverage, device allowance and eligible releases; reveal/hide an
  already-issued key explicitly. The installed app remains usable after expiry.
- Download a covered release through a short-lived, release-specific URL. Store
  checks the order and licensing rechecks coverage on every request, including
  ranges. A refund takes effect even for a URL from an already-open page. Website
  download does not activate a device or expose R2 object keys.
- Cancel all future recurring licenses in that order at period end, with explicit
  confirmation. Previously paid coverage stays intact; refunds are separate.
- Save a new card on Stripe-hosted Checkout in **setup mode**. Store verifies the
  completed Session and SetupIntent, test mode, customer, order and subscription,
  then updates both customer and subscription payment defaults using stable keys.
  The return page and signed `checkout.session.completed` webhook converge on the
  same serialized owner. Superseded sessions cannot override newer requests.
- Review/pay a currently open, tax-verified invoice on Stripe's hosted invoice
  page. Store validates fresh provider ownership, frozen lines and exact cents
  before returning its URL. Saving a card does not pay that invoice. Recovery
  never creates a replacement charge or removes the draft-invoice tax guard.

Library results are bounded to 100 active coverage periods and 25 eligible builds;
provider invoices and operator history use 25-record pages with explicit load-more controls.
Refresh/reload the private order page if a 15-minute capability expires. Draft
invoices await Store tax verification and deliberately have no payment button.
Billing and paid-license Resend templates link to the localized private order
page; no Stripe session URL is persisted in mail.

In **Dashboard → Orders → Software licenses**, Store fulfillment admins can issue
and paginate complimentary licenses and explicitly reveal an issued key.
Super-admins additionally load a paid order, inspect fulfillment/review state,
reconcile existing work, reveal keys, cancel renewals and submit item-scoped
refunds. The refund form requires an amount and confirmation; an optional existing
Stripe refund ID imports that refund without sending money again. A session-only
opaque request hint preserves refund identity after a lost response. Retry the
same request or reconcile its status; do not manufacture a new ID when uncertain.
There is no ambiguous-money override. Operator history is paginated by its existing
journal keys; displayed pending/review counts describe the loaded records, not a
global backlog count. No extra history index or copied journal is introduced.

The UI shares one small lazy-loaded renderer and existing Store styles. Copy is
in English/Spanish catalogs. All customer APIs are private/no-store and verify
origin, rate, ownership and capability expiry. Operator routes retain the
existing role/scope/session/CSRF/rate checks and redacted audits. Keys are absent
from lists and browser storage. No card numbers enter Store.

Validation: `tests/unit/software-management.test.ts`, complimentary and paid
billing tests, `tests/e2e/software-management.spec.ts`, the actual-Worker provider
probe and complete pre-merge gate remain the deterministic regression checks.
The E2E redirect fixtures do not substitute for provider acceptance.

### Provider acceptance without a paid launch

`npm run test:licensing:acceptance` runs a manual private Cloudflare fixture using
the actual Store owners and customer-management renderer. It requires an approved
inbox, checks test credentials/account, accepts only one synthetic order, and uses
Store's Resend plan/templates/outbox. Read the [operator procedure](../experiments/software-licensing/ACCEPTANCE.md)
before running; it sends real test emails and cleans up its temporary resources.
There is no new workflow or scheduler.

The [November 7 evidence](release-evidence/2026-11-07-licensing-provider-acceptance.md)
records browser decline and authenticated 3DS, a $60 mixed settlement through a
public signed webhook, hosted card replacement, a failed $11 tax-verified renewal,
payment of the original invoice, coverage extension and three delivered Resend
messages to the approved inbox only. It distinguishes provider delivery from
inbox rendering and records the replay/receipt limitations. Production sales,
licensing and scheduled licensing capture remain disabled.

The pre-launch backup integration now uses the existing encrypted Store pipeline.
See [BACKUP_RESTORE.md](BACKUP_RESTORE.md#software-licensing-checkpoint-integration-pre-launch)
for maintenance checkpoint capture, isolated local/deployed restore, provider comparison and
explicit acceptance. `npm run restore:rehearse:software` exercises actual local
Workers and synthetic provider records without enabling paid checkout.

The protected synthetic archive/restore passed in
[run 42430004952](https://github.com/aindaco1/store/actions/runs/42430004952).
The deployed-source extension adds a persistent admission barrier for dedicated
test Workers; see the backup guide and current deployed-source release evidence.
Production licensing, paid offers and scheduled licensing capture remain disabled.


## Key, installation and release administration

The same private order capability exposes `/software/administration` for an issued
line, with `action: status|history|replace|deactivate|reset`. Store resolves the line
within that order; client-supplied grant IDs, products and actor roles are ignored.
The operator equivalent is `/admin/store/licenses/administration`, scoped by
`grantId` for complimentary grants or `orderToken` plus `lineId` for paid grants.
Existing fulfillment permissions, trusted origin, CSRF and rate limits apply;
paid-order controls and `/admin/store/licenses/releases` require super-admin.
Production mode remains closed. The UI reuses the existing renderer and catalogs.

Load status before mutation. Submit a stable `id` and the observed `generation`;
deactivation also requires the observed `installation` and `revision`. Retry the
same request after a lost reply. Reusing an ID with different meaning or a stale
revision returns 409. A deliberate refresh loads current state for a new action.
Key replacement invalidates the previous key and all existing update tokens; use
**Show license key** afterward and reactivate apps. Deactivation frees one seat;
reset frees all installations but never edits the purchased seat allowance.
Installed software keeps working. No device fingerprint or additional telemetry
is collected; the UI displays the existing installation IDs.

Licensing schema 4 owns current key revision, device tombstones and immutable
operation receipts. Store derives a replacement from its existing secret and the
operation ID, so there is no second key-rotation journal to reconcile. Original
Store key hashes and grant digests remain the identity for coverage/refund replay.
Key recovery consults authority state and verifies the derived active key hash.
Replacing a license key does **not** rotate server signing/derivation secrets.

Receipts persist the operation, action, target, role, time, resulting generation
and an opaque actor reference (admin-email hash or private order hash). Store's
existing admin audit additionally records the authenticated operator. Public
customer projections omit authority IDs, key hashes and actor references. Raw
keys appear only on explicit reveal or in the existing restricted email payload.
Receipts/tombstones/withdrawal records follow license-lifetime retention pending
an approved production policy; deleting them can resurrect access and is unsafe.

Super-admins can list and withdraw an ASCII VJ release. Withdrawal is one-way in
this UI and preserves signed bytes/metadata for recovery. The shared eligibility
predicate excludes it from libraries, native feeds and GET/HEAD/range delivery.
Republishing the same release ID cannot undo withdrawal. If a corrected build is
needed, publish a new immutable release ID through the existing publisher path.

Billing history uses `/admin/store/licenses/history` with the returned cursor and
allowlisted `kind: payments|refunds|reviews|work`. Customer `/software/invoices`
pages only the order's subscription and rejects a cursor owned elsewhere. Release
and administration history are also paginated. The separate customer library's
100 coverage-period/25 release projection remains explicitly bounded.

Schema-4 authority and a compatible Store reader must travel together in a
reviewed test deployment. Deploy the schema-4 authority first, then Store; old
Store callers can still use the original grant/coverage/token contracts. Older
authority binaries intentionally reject schema 4, so keep the new reader during
rollback. After any replacement, Store must also retain the current-key recovery
reader; the old Store recovery implementation would reveal the obsolete key. Do not point old code at a migrated database or reopen an old snapshot
without reconciling later replacement, deactivation, reset, withdrawal and refunds.
No public offer, paid-sales flag or scheduled licensing capture is enabled here.

## Server-secret operations

See [server-secret recovery and rotation](SOFTWARE_SERVER_SECRETS.md) for the stable
derivation root, bounded signing/service/capture rotation, checkpoint key proofs
and the authenticated local admin preview. These are test-only capabilities;
production paid sales and scheduled licensing capture remain disabled.

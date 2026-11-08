# Paid software billing — local test evidence

November 4, 2026. Store baseline `5e8d27f`; pinned Platform `d33b417`.
This is uncommitted, test-only work. No production deployment, live charges,
public product prices, real-recipient email or new app release occurred.

## Implemented scope

The existing canonical cart and inventory coordinator now handle software offers
alongside merchandise and tickets. One-time term/major/lifetime offers retain
the PaymentIntent path; monthly/annual items share one initial subscription
invoice. Store owns frozen prices, shipping/tax, coupons, financial records,
refund allocations, authenticated operator actions and Resend delivery.

Per-order instances of the existing DO class retain balanced integer-cent
receipts and durable coverage/mail/refund commands. Licensing schema 3 adds
independent coverage periods under one stable key, with permanent refund
tombstones; paid periods and separate licenses remain independent. Native app
code and Platform packages are unchanged in this task.

Renewal tax is recalculated each time, per owner decision. The subscription's
provider guard keeps future invoices in draft, including while Store is down.
After validating and recording tax, Store finalizes and pays that existing
invoice. Bounded order/invoice scans recover missed notifications without
creating purchases. Unconfirmed initial orders resume Store's existing settlement.

Initial term/subscription coverage includes already-published builds; later
renewals retain their actual interval. Two defaults remain provisional pending
owner preference: coupons apply only to the first payment, and refunds do not
implicitly cancel future renewals. Operator cancellation is explicit.

## Verification

| Check | Observed result |
| --- | --- |
| Store unit suite | 818 tests in 131 files plus seven Node payment/fulfillment contracts passed. |
| Store browser | Two Chromium cases passed at 390 px and 1280 px. Renewal amount/cadence, tax, initial-only coupon and installed-use copy was checked and screenshots inspected. Payment Element was a fixture. |
| Local static build | Jekyll build passed to an isolated temporary directory. |
| Localization/data inventory | English/Spanish completeness and all 48 detected Worker storage families passed. |
| Licensing runtime | Nine tests passed against real local workerd, SQLite and R2; additive migrations, concurrent seats, coverage gaps, refund-first ordering, feed exclusion and private-download denial included. Wrangler dry-run passed (48.15 KiB; 13.01 KiB gzip). |
| Platform | 397 tests and both clean-checkout recipes passed on Node 26.12.1. Documentation changes only. |
| Real Stripe test mode + actual local Workers | Three one-time policy baskets each paid $60; mixed monthly/annual + merch + ticket paid $167.80 once. Browser underquotes were replaced by canonical shipping/tax. Duplicate settlement reused the receipt/key. |
| Renewal outage/recovery | Future invoice remained draft through four days without Store notification. Invoice discovery found it, recalculated $1 tax and collected $11 for monthly software only; merchandise, ticket, shipping and annual software were not charged again. |
| Refund/private access | Repeated refund request produced one refund. Refunded renewal build returned 403; prior paid build and separate annual license remained accessible. Cancellation remained separate. |
| Failure boundaries | Declined and SCA-required payments were made nonpayable before stock release. Unit tests exercised lost refund replies, overlapping refund/event work, 23-hour ambiguity cutoff, changed invoice rejection, finalization recovery, ordinary-refund isolation, failed mail and refund-before-grant acknowledgement. |
| Resend | Eight dry-run messages; second drain sent zero. No real messages sent. |

Provider evidence: [`paid-runtime-result.json`](../../experiments/software-licensing/paid-runtime-result.json).
Run with `npm run test:licensing:provider`; it uses the existing ignored **test**
key and refuses live keys. The Stripe connector still requested reauthentication.
Signed webhook requests were synthesized locally from fresh Stripe test objects;
public webhook delivery and an actual browser SCA challenge were not tested.
Test subscriptions/customers/clocks/coupons were cleaned up and products/prices
archived or verified already inactive; the final cleanup report has no errors.

## Merge and launch limits

`npm run test:premerge` stopped at its first secret audit: the existing
`STRIPE_PUBLISHABLE_KEY_TEST` value matches `worker/wrangler.toml` and the
iCloud duplicates `worker/wrangler 2.toml` and `worker/wrangler 3.toml`.
Values are omitted here. Those unrelated files were preserved. The complete
pre-merge gate has **not** passed; individual checks do not substitute for it.

Before production: resolve that gate; finish real Elements/SCA and deployed
webhook acceptance, payment-method recovery/dunning, customer/admin UI, dispute
policy, independent encrypted billing-state backup/restore, provider monitoring
and real-recipient email acceptance. Approve actual prices/seats/support terms
and the two provisional policies. Existing app distribution gates, including
VCR OSD Mono redistribution evidence, remain unchanged.

See [software licensing](../SOFTWARE_LICENSING.md) for the operator API, catalog
contract, scope limits and rollback. Pause new intake independently with
`SOFTWARE_CHECKOUT_ENABLED=false`; retain the active billing processor and
Stripe draft-invoice guard. Keep licensing schema-3-compatible readers and
reapply refund tombstones before reopening downloads after recovery.

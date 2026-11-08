# Combined checkout feasibility

Current provider/browser/Resend procedure: [ACCEPTANCE.md](ACCEPTANCE.md).
The November 4 findings below are a historical feasibility checkpoint; current
implementation and remaining gates live in [Software licensing](../../docs/SOFTWARE_LICENSING.md).

Isolated payment experiment; the public checkout does not select it. The existing
inventory coordinator accepts an injected provider for characterization, while
its normal PaymentIntent path is preserved. A separate test-only complimentary
admin API is documented in [Software licensing](../../docs/SOFTWARE_LICENSING.md).
Use patched Node 26.12.1+.

```sh
node --test experiments/software-licensing/*.test.mjs
node experiments/software-licensing/stripe-probe.mjs worker/.dev.vars --test-mode
node experiments/software-licensing/stripe-probe.mjs worker/.dev.vars --test-mode --annual
node experiments/software-licensing/stripe-probe.mjs worker/.dev.vars --test-mode --mixed
node experiments/software-licensing/stripe-failure-probe.mjs worker/.dev.vars --test-mode
```

The provider probe refuses live keys, creates synthetic test-clock customers
without email addresses, uses the pinned Platform Stripe client/API version,
and deletes the clock/customer/subscription and archives its product afterward.
Inline prices are already inactive. It writes a redacted test result beside the
script; fixture amounts are not proposed product prices. No Resend mail is sent.

November 4, 2026: both monthly and annual probes passed. A single $50 test
payment bought $25 merch, a $15 ticket and $10 software coverage. The next
invoice charged only $10. Duplicate subscription creation returned the same
subscription; duplicate $15 refund requests returned the same refund. See
`stripe-month-result.json` and `stripe-year-result.json` for test IDs/evidence.

One correction discovered by the real provider test: recurring invoice lines
do not inherit subscription-item metadata. Persist the subscription-item ID
to canonical order-line mapping. The probe now resolves invoice lines through
that mapping and fails closed if an item is unknown. Initial one-time lines
carry their own metadata. Do not correlate by description, amount or email.

The experiment selects Subscriptions API `default_incomplete` with one-time
`add_invoice_items` and flexible billing. Store must supply a validated,
immutable server-priced snapshot. One-time-only orders keep the existing
PaymentIntent path. The local contract rejects unsafe cents, duplicate lines,
unsupported currency/cadence and recurring merchandise; it is not a replacement
for Store's canonical cart/tax/coupon/inventory validation.

Additional November 4 evidence:

- Mixed monthly + annual: one **$153.87** initial invoice ($22.50 discounted
  merchandise, $15 ticket, $10 monthly software, $100 annual software, $5
  shipping, $1.37 tax); next monthly invoice **$10**, with no annual or one-time
  line charged again. Actual invoices pass the fulfillment normalizer.
- Decline and SCA API fixtures yield `requires_payment_method` and
  `requires_action`, with an Elements-compatible confirmation secret. Canceling
  each incomplete subscription made its PI `canceled`; the adapter also supports
  voiding an unpaid invoice if cancellation alone does not make it nonpayable.
- The real inventory coordinator, with the injected subscription provider,
  persists subscription/invoice/item correlation before returning a client
  secret; ambiguous creation/cancellation retains stock, retries preserve the
  provider key, and late success cannot release capacity.
- Invoice reconciliation emits stable invoice/line intent IDs and independent
  coverage intervals. Renewals cannot create merch/ticket fulfillment. Full
  software-line refunds target only that invoice's coverage; partial software
  refunds require review instead of inventing a prorated entitlement rule.

`stripe-mixed-result.json` and `stripe-failure-result.json` contain synthetic
provider IDs and cleanup results. All final probes cleaned up without errors.
Fixture discounts/tax/shipping demonstrate integer-cent invoice compatibility;
they do **not** establish a production coupon recurrence or tax policy.

At the November 4 feasibility checkpoint, these were still open: actual Elements challenge
completion in the Store UI; catalog-to-snapshot recurring prices and full
canonical tax/coupon/shipping integration; production durable invoice intent
storage/dispatch and signed webhook routing; refund/dispute reconciliation and
revocation in the licensing authority. The pure intent contract is not a durable
queue, and mocked provider failures are not a replacement for end-to-end paid
fulfillment. These belong to phase 3 and remain required launch gates.

Validation: seven experiment contract tests, three subscription-provider/hold
characterizations, and **803 Store unit tests** passed. `npm run test:premerge`
still stops at its first secret-audit phase on the existing publishable test key
in the already-modified `worker/wrangler.toml` and iCloud's `worker/wrangler 2.toml`.
Those unrelated files were preserved. The complete pre-merge gate has not passed.

Primary references: [subscription creation](https://docs.stripe.com/api/subscriptions/create),
[invoice payments](https://docs.stripe.com/api/invoice-payment/list),
[test clocks](https://docs.stripe.com/billing/testing).

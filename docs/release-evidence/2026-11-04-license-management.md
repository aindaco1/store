# Store license management and gate remediation — November 4, 2026

## Scope and release state

Local implementation on Store's existing `5e8d27f` checkout, with prior paid
billing work preserved. Platform remains documentation-only at `d33b417`;
licensing remains a separate test-only consumer. No commit, production deployment,
public offer/price, paid ASCII VJ Remix release or real-recipient email occurred.
Existing configuration and iCloud duplicate files were preserved.

## Delivered behavior

- Existing private order pages show per-line license coverage, device allowance,
  explicit key reveal/hide, covered downloads and pending-delivery state.
- Customer billing supports explicit end-of-period cancellation, hosted card
  setup and payment of an existing tax-verified open invoice. Fresh provider
  ownership checks and original invoice identity remain authoritative. Setup
  applies both customer and subscription defaults, with serialized completion,
  stable provider keys and rejection of superseded sessions. It cannot charge
  the customer or remove the renewal-tax draft guard.
- The Orders admin view supports complimentary issuance/list/key recovery, plus
  super-admin paid-order reconciliation, refund allocation/import and renewal
  cancellation. Interrupted refund responses retain the same request identity.
- English/Spanish copy and existing Resend templates link to the private order
  page. No second account, mail queue, billing provider client or Platform package.
- Licensing library projections are bounded; private downloads use the same
  eligibility predicate and pinned R2 streaming/range checks as native updates.
  A refund invalidates a download link that was already on screen.

## Gate remediation

1. Classify only exact Store publishable-key settings with a `pk_test_`/`pk_live_`
   value as public. Secret/restricted/webhook key detection and history scanning
   remain active. Regression coverage rejects a secret assigned to that setting.
2. Reuse existing Store card/form styles and include the small shared additions
   once. Fixed mobile order-token overflow and semantic heading order without
   raising asset budgets. Final measured CSS is 199,929 bytes against 200,000;
   JavaScript is 545,321 against 750,000.
3. Respect explicit Jekyll config overlays. Isolated Podman tests use internal
   test URLs and require both a disposable Worker volume and isolated site;
   ordinary local development retains its local overrides. This fixes the gate
   reaching the private HTTPS preview URL instead of the test Worker.
4. Extend the strict legacy admin browser fixture with the disabled licensing
   config response. Its eight product-price/layout cases passed after the fix.

## Verification

- Full `npm run test:premerge`: **passed**, exit 0. All 12 named stages passed,
  including 838 unit tests, seven payment contracts, 22 security tests, build/
  minification/performance/SEO checks, Podman resource and Worker smoke checks,
  and **109 browser tests** with no retries/failures reported (4.9 minutes).
  Final logs: `/tmp/store-premerge-logs.OHCRdM`. Earlier attempts exposed the
  issues above; none were waived or converted to successful checks.
- Focused management browser suite: five cases passed for EN/ES mobile customer
  flows, key reveal/hide, cancellation confirmation, hosted recovery redirect,
  return verification, interrupted refund retry, complimentary issuance,
  limited-admin visibility and disabled-feature behavior. Automated axe checks
  found no scoped violations; color contrast was excluded by the existing test
  convention. Final Podman customer/admin screenshots in `test-results/software-management-*/`
  were inspected. This is not VoiceOver acceptance.
- Store: 838 unit tests and seven payment contracts passed in the final gate;
  22 runtime security tests and the Worker smoke passed. Management/billing
  focused tests: 28 passed, including serialized
  duplicate setup completion and superseded-session handling. Configuration,
  email and access/recovery focused run: 55 passed before the additional callback
  case. Data inventory audit covers all 48 Worker storage families.
- Licensing: nine actual workerd tests passed; Wrangler dry-run passed (49.93 KiB
  before compression at that checkpoint). Coverage, refunded-download denial,
  cross-product/internal-secret rejection and archive naming are exercised.
- Platform: 397 tests and both clean-checkout recipes passed. No runtime edit or
  submodule advancement was required.

### Actual Workers and Stripe test mode

`npm run test:licensing:provider` passed using actual local Store/licensing
Workers, signed local webhook deliveries and real Stripe test-mode objects.
The [redacted result](../../experiments/software-licensing/paid-runtime-result.json)
records all three one-time policies, mixed merch/ticket/monthly/annual payment,
renewal tax, four-day outage recovery, duplicate/stale events, item refund scope,
cancellation, declined/SCA-required cancellation and cleanup.

The new provider checks created a hosted **setup-only** Checkout session,
verified its SetupIntent customer/order/subscription metadata, rejected an
incomplete setup and expired the session during cleanup. They also read the
customer library and downloaded through Store, then proved the old customer URL
was denied after refund. Cleanup reported zero errors; real emails sent: zero.

A completed hosted card form or SCA challenge was **not** exercised. Stripe
refuses API confirmation of a Checkout-created SetupIntent; the unsuccessful
exploratory probe was cleaned up. Completed/duplicate/partial-failure/superseded
callbacks are tested through the actual Store billing owner with provider
fixtures. Human hosted-form/SCA acceptance and public webhook delivery remain
separate launch gates. No protection was bypassed to simulate that acceptance.

## Operations and remaining launch acceptance

See [the operator/customer guide](../SOFTWARE_LICENSING.md) and
[backup/restore](../BACKUP_RESTORE.md). `SOFTWARE_CHECKOUT_ENABLED` pauses new
purchases; existing billing needs its licensing flag, original secrets, service
binding, alarms and webhooks kept available. Preserve grants, refunds, tax
snapshots and Resend receipts. Never revert to a build unable to process an
existing subscription or discard an uncertain refund to start another.

Paid ASCII VJ Remix remains deferred. Before launch: actual hosted card/SCA and
real-recipient mail acceptance, encrypted independent paid-state backups and
restore drill, retained-history pagination, versioned key replacement/device
administration/release withdrawal controls, approved pricing/support/dunning/
dispute policies and the existing app distribution/source/signing/notarization
gates. VCR OSD Mono is retained pending redistribution evidence. Current customer
key recovery reveals the existing key; it does not rotate it or reset devices.

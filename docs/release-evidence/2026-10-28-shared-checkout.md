# Shared checkout migration — 2026-10-28

## Follow-up: local payment-resolution regression and loading investigation

The local processor journal recorded repeated Stripe HTTP 400
`idempotency_error` responses starting at 2026-10-28 20:11:16 UTC (14:11 Denver).
The matching saved order contains one A Night in Paradiso ticket. The browser
retained an attempt ID whose local coordinator state had been reset
by the earlier pre-merge run. The same Stripe test idempotency key already
belonged to an older request. Its original PaymentIntent was verified canceled.
The logs establish the collision, but do not record the shopper's field edits,
so the precise triggering edit is not independently proven.

Only that verified canceled local attempt/order was recovered, after backing up
the preview volume. No Stripe mutation was used for this repair. Subsequent
status returned `released`. Never generalize this recovery to an unknown or
uncertain payment. Regression wrappers now select `store-test-worker-wrangler`
and refuse to reuse preview storage. Normal preview restarts preserve
`store-dev-worker-wrangler`; fixture tests cover repeated resets and preservation
of preview and host data.

Store also unnecessarily awaited a second `/tax/quote` immediately before
canonical intent creation, and awaited previews after edited details. Those
waits are removed. Fields can prepare while estimates load; Pay remains gated.
The summary now uses the prepared intent's canonical totals/tax details, so late
preview responses cannot overwrite the actual payment amount. Two new browser
cases keep initial/edit previews pending and then return a deliberately stale
estimate. Existing email-edit and terminal-mount recovery cases also prove that
the summary and Pay stay aligned. Before the runtime change, both slow-preview
cases failed; afterward all 22 checkout/address browser cases passed.
Focused unit verification passed 73 tests.
Full `npm run test:premerge` then passed 712 unit tests, 22 security tests, all
build/content/i18n/pin/Worker smoke checks, and 99 browser tests (4.6 minutes).
Gate logs: `/tmp/store-premerge-logs.064xMR`. Runtime inspection during security
and browser checks confirmed `store-test-worker-wrangler`. The first gate attempt
passed units/build but stopped at the occupied-port check because a stopped
preview pod still held port 8989; removing that pod before the rerun corrected
the harness without deleting its volume. No runtime/test failures remained.
After the gate, Store restarted on `store-dev-worker-wrangler`; the repaired
attempt still returned `released`, HTTPS returned 200, both previews served
their real test public keys, and tracked Wrangler defaults were restored.


Fresh headless Chromium, real Stripe test keys, no card entry or confirmation:

| App and case | Details complete to fields ready | Relevant server time |
| --- | ---: | ---: |
| Store, 10467, earlier HEAD adapter | 2.59 s | intent 0.41 s |
| Store, 10467, current adapter | 1.75 s | intent 0.37 s |
| Pool, 10467, earlier HEAD adapter | 2.56 s | setup 0.45 s |
| Pool, 10467, current adapter | 2.29 s | setup 0.52 s |
| Store, 10467 to 87048 edit | 7.18 s from edit | intent 6.04 s |
| Pool, 10467 to 87048 edit | 6.53 s from edit | setup 5.27 s |

The earlier adapter was substituted only in the diagnostic browser; Pool's old
adapter received a readiness listener for measurement. Both apps kept their
current cart code and separate payment models. The NM cases used a synthetic
street and included external GRT lookup time; they are not address-accuracy or
production latency benchmarks. Initial NM tests also measured 10.09 s in Store
and 7.25 s in Pool. These runs show that the early shared SDK loader is not a
consistent multi-second regression. They do not establish a latency guarantee.
One earlier real Store probe timed out waiting for fields at 90 seconds; it did
not capture console/failed-request details, so its cause remains unproven. Later
instrumented runs did not reproduce that stall. Do not describe every earlier
30-second report as a proven CDN issue or claim this outlier fixed.

Diagnostic logs remain local under `/tmp/*-profile*.log`; no customer address,
card data, keys or client secrets are included in this evidence. Production was
not deployed or benchmarked. Provider/network delays and the external NM lookup
can affect production too; the reset/idempotency collision was local test-state
loss. Store/Pool continue using Platform 0.46.0 / Site Shell 0.6.0 unchanged by
this follow-up; preview state recovery and canonical intent display are Store
responsibilities, while Pool already prepares without awaiting previews.

## Follow-up: early Stripe SDK loading across Pool and Store

Platform 0.46.0 / Site Shell 0.6.0 is pinned at
`68b9b3073e0f4dc167dc638f56003f6bfcf49f8e` in both consumers. It adds injected,
key/options-specific SDK instance loading with shared pending promises and retry
on failure. Store now uses the shared script loader too. URLs, public keys,
locales, warmup timing and all payment/session policy remain consumer-owned.

Both apps start immediately on cart intent and also handle direct checkout route
entry. Pool additionally initializes the Checkout SDK with a pending secret;
canonical setup consumes it once. Warmup alone mounts no fields and requests no
server payment session. Store retains PaymentIntents; Pool retains Checkout
Session setup and later campaign settlement. Payment Element downloads still
wait for a valid session/intent, so the earlier network/CDN delay is not claimed
fully resolved. Ordinary catalog browsing stays free of Stripe initialization.

Rollback this follow-up's loader, sidecar/caller changes and version contracts
with the gitlink to `a2c684ceecbbf485c5ae8715a59d25bcf2bb3d53`. Leave canonical
orders/pledges and previous checkout/tax changes intact. The Platform commit is
local and must be published before consumer releases can fetch this pin.
No production deployment or payment confirmation was performed.

Early-loading verification: Platform `npm test` passed 390 tests and both
recipe checks. Focused consumer regressions cover one shared initialization,
failed-warmup recovery, no speculative server session or payment fields,
address/email edits, and slow fields that must not trigger a second mount.
A real Pool cart-only probe observed Stripe.js start at 398 ms, its controller
at 1,311 ms, and the Checkout SDK at 1,315 ms after opening the cart, with zero
payment-session requests during the 12-second observation. This proves overlap
with detail entry, not a fixed latency guarantee for Stripe's later field assets.

Store verification: 709 unit tests and 22 security tests passed, along with
content, i18n, build, pinned dependency and Worker smoke checks.
The final full browser rerun passed all 97 tests. The new slow-field fixture
initially left its artificial delay enabled after reopening checkout; resetting
that test flag after the first render fixed the fixture without changing runtime
behavior. Gate logs: `/tmp/store-premerge-logs.rYvWvQ`; final browser log:
`/tmp/store-early-stripe-e2e-final.log`. The earlier HTTPS preview URL was replaced
only for container tests, then restored with the real local test publishable key.
A fresh HTTPS Store browser probe started Stripe.js 79 ms after opening a paid
cart; the controller started at 3,954 ms, before any email field or payment-session
request. Store HTTPS cart validation returned 200 with the expected HTTPS CORS
origin. Both local previews serve the new shared loader and consumer adapters.
Local previews run with Stripe test keys; webhook forwarding was not started for
this payment-field loading check. No card was entered or payment confirmed.


Local implementation and verification; no production deployment or live payment
acceptance is claimed. Platform commit `a2c684ceecbbf485c5ae8715a59d25bcf2bb3d53`
is on local branch `codex/shared-checkout-behavior` and must be published before
consumer commits using that gitlink can be cloned elsewhere.

## Shared boundary

- Site Shell 0.5.0: common email/ZIP validity, debounced preparation, latest lookup
  generation, detail signature and one-time drawer scrolling.
- Tax Core 0.4.0: attributed GeoNames postal consistency, conservative OpenSalesTax
  snapshot/resolver and explicit-output refresh utilities. The weekly candidate
  refresh belongs to Platform; consumers adopt reviewed pins independently.
- Design Core 0.3.1: mobile form inputs remain at least 16px without disabling zoom.
- Each app retains markup/localization, routes, canonical totals, reservations,
  storage and Stripe lifecycle. Reference JSON is excluded from static output.

Platform `npm test`: 388 tests plus both clean-checkout recipe checks passed.
Source licenses/NOTICE were preserved verbatim, including their trailing blank
lines. No customer data or new storage key family was added to Platform.

## Payment and interaction invariants

Store keeps immediate PaymentIntents, inventory holds, free orders and fulfillment.
Pool keeps Checkout Session setup and later campaign settlement. Edits never
confirm payment/pledges, stale work cannot mount, and failed release blocks new
preparation. Fields remain mounted; only the payment slot and summaries update.
City corrections are optional. Missing local tax coverage stays explicitly
estimated, as requested; the shared data is not nationwide street-level tax accuracy.

## Rollback

Roll back this consumer's adapters, loader, tests and gitlink together, independently
of the other consumer. A pin-only rollback is incompatible with the new imports.
Keep canonical persisted orders/pledges and their stored totals; do not reprice
existing records or retry ambiguous payment confirmation. Store's tool dependency
lock must travel with its release-core pin. The pre-extraction local submodule
changes were preserved in named Git stashes before selecting the immutable commit.

Previous Store Platform pin: `2e5df578c08c4af0b827a08fefee8986acf5f24b`.

## Consumer verification

Complete `npm run test:premerge` passed through the state-preserving HTTPS-preview
wrapper: 707 unit tests, 22 security tests, build/content/i18n/pin checks, Worker
smoke and 96 Podman browser tests. Logs: `/tmp/store-premerge-logs.b72fQX`.
The focused checkout run also passed all 19 cases. The original local Worker
state and HTTPS preview were restored; tracked Wrangler URLs retain HTTP defaults.

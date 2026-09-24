# Checkout holds

Local release candidate: `release/checkout-ux-ticket-holds`. This guide describes the candidate implementation, not a production rollout. The design review is [checkout-ux-review-2026-09-24.md](checkout-ux-review-2026-09-24.md).

## Buyer experience

Explicit **Checkout** validates current catalog prices and atomically reserves finite ticket quantities before contact/tax entry. Adding to a cart does not reserve stock. A mixed cart shares one checkout: finite tickets are held early; other finite stock is reserved when payment or a free order begins. Untracked products and free RSVP forms have no artificial ticket countdown.

The initial ticket window is ten minutes. `checkout.hold_seconds` in `_config.yml` is mirrored to `CHECKOUT_HOLD_SECONDS` (600–1800 seconds). The extension allowance is ten; **More time** appears with two minutes left and adds one full window. Duplicate extensions made outside that warning window do not consume another extension. Refreshing or opening another tab reuses the browser's attempt and deadline. This is a reservation, not a waiting room or a guarantee of one person per device.

The timer uses server time and a monotonic browser clock. It does not poll each second. Status is rechecked on foreground/online, expiry, and immediately before payment confirmation. Time changes are not live-announced every second; warnings and recovery states are. Expiry preserves safe cart/contact/address drafts and offers an explicit availability check. RSVP answers remain memory-only. Back/Close releases an unstarted hold; once a payment exists it must first be safely canceled. An uncertain payment stays attached to its attempt, with a status check instead of a second charge.

Event date/time (labeled venue-local time), venue/address, quantities and ticket delivery instructions use canonical event metadata. Country/postal code precedes conditional New Mexico street/city/state fields. Guest checkout, Stripe's Payment Element, tax authority, and the **5% default optional tip** remain. Final Pay displays the canonical amount and remains explicit. Paid checkout prepares the Payment Element automatically once the required details are valid and input has settled for 350 ms; free orders still require Complete order. Stripe.js is prewarmed while browsing the cart, and Store submits one fresh tax quote during payment preparation.

The drawer labels the stages **Your details** and **Payment**. Email is collected once with the required contact, tax/shipping and RSVP details. The existing inline guidance and button show missing information/loading; there is no separate ready banner or Continue-to-payment step. Automatic preparation is debounced and guarded against duplicate requests. Submitted details and Back/Close are disabled during preparation so a delayed response cannot replace edited details or a different checkout. Failures require an explicit retry; changes after preparation continue to use the safe Back-to-cart cancellation path. Payment shows the delivery email and shipping address as a summary. Its method block appears only when there is a payment to mount, and its ready handler restores keyboard focus when the replaced details form had focus. The reservation card separates the ticket count and labeled timer; expiry replaces the active-reservation claim and exposes availability recovery.

Payment replays and status checks verify Stripe's current status before returning a reusable intent. A canceled intent uses the existing cancellation checkpoint/release path; a processing, succeeded, capture-pending or unreadable intent remains attached to its attempt for signed settlement/recovery. Browser cancellation invalidates the mount and clears its credentials; script or mount failures cannot restore the canceled client secret. These checks follow [Stripe's PaymentIntent lifecycle](https://docs.stripe.com/payments/paymentintents/lifecycle).

## Authority and payment boundaries

`worker/src/checkout-coordinator.js` runs inside the existing `StoreInventoryCoordinator`. Existing inventory primitives remain authoritative; no new database or Durable Object binding is added. Direct claims also subtract outstanding reservations. A checkout's inventory transitions and attempt checkpoint commit in one storage transaction. Stripe/KV I/O occurs outside that transaction.

The browser generates a 256-bit opaque capability and stores only that capability in `store_checkout_attempt_v1`. Web Locks serialize creation/renewal across supporting tabs. Public POST routes `/api/checkout/hold`, `/status`, `/extend`, and `/release` require the trusted origin, bounded JSON, rate limits, and the capability. They are private/no-store. The capability is not a general order lookup or admin credential. No client supplies trusted prices, counts, expiry, or Stripe parameters.

The stable attempt becomes `store-order-<capability>`. The coordinator freezes the validated draft and Stripe request before creating an intent with `store-order:<orderToken>` as its idempotency key. Request retries reuse that checkpoint and intent. Changes after payment begins require safe abandonment followed by a new availability check. Final validation still rejects stale prices/coupons, empty stock, invalid registrations and changed selections.

| State | Stock and recovery |
| --- | --- |
| `held` | Short reservation; expiry can release without contacting Stripe. |
| `creating` | Pinned reservation and frozen create request. A 30-second durable lease and coalesced in-flight work prevent concurrent checkpoint writers. An alarm retries the same request/key after an ambiguous result. |
| `payment` | Pinned reservation; displayed deadline still applies, but stock is not released by lazy inventory cleanup. A declined card remains retryable against this same intent. |
| Expired/abandoned payment | Retrieve Stripe status; cancel only a cancellable intent with a deterministic cancellation key. Checkpoint confirmed `canceled` in order storage before releasing capacity; a failed write keeps the reservation for recovery. |
| Processing/succeeded/unknown at cancellation | Keep stock and record a reconciliation break. Verified signed success commits inventory exactly once; no automatic second charge or refund. |
| `confirmed` / `released` / `expired` | Terminal attempt checkpoint; replay cannot consume stock again. |

Free orders atomically commit inventory with a frozen confirmed-order checkpoint, then persist the order. A retry or alarm can recover its order write without a second stock claim. Paid confirmation remains signed-webhook-only. Subscribe to `payment_intent.succeeded`, `payment_intent.payment_failed`, and `payment_intent.canceled`. A failed card event does **not** release capacity for a still-payable intent.

A bounded due-key index drives the existing DO alarm, including closed tabs. It processes up to 25 records at a time and schedules further work even after provider failures. Creation retries stop before Stripe's minimum 24-hour idempotency retention (at 23 hours). Such an unresolved creation remains reserved and raises an operator reconciliation break; recovery must establish processor truth before capacity can be released. A time limit alone is not proof that a payment cannot succeed.

## Retention, recovery, and limitations

DO `checkout:` records include an anonymous capability, selected counts/deadline, and, during creation/payment, the frozen order (including contact/RSVP data) and necessary Stripe identifiers/secret. `checkout-due:` is the bounded scheduling index. Terminal checkpoints last 30 days; payment payload/client secret are removed from terminal paid records. Confirmed free checkpoints retain the order for write recovery for that period. Unresolved money evidence is retained until resolved rather than silently expiring it with inventory. `orders:` remains canonical historical order storage; canceled new-attempt drafts expire after 30 days.

These live checkpoints are **not rebuildable from claimed inventory alone**. Do not restore transient holds from a backup, roll back an active coordinator, or replace its inventory while checkout reservations exist. Inventory replacement is blocked while these reservations exist. During disaster recovery, stop sales, preserve the live coordinator, compare Stripe and canonical orders, resolve outstanding attempts, then use the existing maker/checker recovery workflow. See [backup/restore](BACKUP_RESTORE.md) and the [data inventory](../config/store-data-inventory.json).

Legacy clients without `attemptId` retain the older intent path during transition; they do not gain early holds. New attempts protect capacity from legacy direct claims. Anonymous devices can still create separate attempts within existing rate limits; this release is not anti-scalping identity enforcement. The public stock projection remains advisory and excludes temporary holds. Existing reconciliation diagnostics are reused rather than logging capabilities, form answers, or raw payment payloads.

See [v1.3.8 release evidence](release-evidence/v1.3.8-checkout-holds.md) for real Stripe test payment and 3DS-required/cancellation checks, automated mobile/keyboard coverage, provider verification and deployment gates. Physical-device wallets, an interactive 3DS challenge and VoiceOver speech are not claimed by those automated checks. No new wallet component or invented descriptor is introduced. The earlier [local evidence](release-evidence/2026-09-24-checkout-ux-local.md) remains historical.

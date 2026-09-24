# Checkout UX and ticket holds: local candidate

Date: September 24, 2026. Branch: `release/checkout-ux-ticket-holds`, based on `7a5c2fb` (v1.3.7). Local implementation only; no version bump, push, provider configuration change, purchase, email send, or deployment was performed.

This is historical local evidence. See [v1.3.8 release verification](v1.3.8-checkout-holds.md) for the later authorized release and provider checks.

## Scope

The owner authorized the [checkout review](../checkout-ux-review-2026-09-24.md) recommendations locally and explicitly retained the **5% default optional tip**. The tip control, mobile cart and summary/actions are more compact. Checkout adds canonical event details, ticket/email guidance, corrected quantity labels, country/postal-first conditional tax fields, automatic payment preparation with explicit final confirmation and the canonical total on Pay.

Finite tickets are held at explicit Checkout for ten minutes by default. The existing inventory Durable Object owns stable attempts, ten explicit time extensions, expiry, same-intent retry, payment-aware cancellation and recovery. No new binding/database/payment component was added. See [implementation and recovery](../CHECKOUT_HOLDS.md).

Config synchronization regenerated the Worker catalog from the existing 53 canonical product files, including the previously absent Monster Bash projection and current display order. No product source, price or inventory count was edited.

## Automated evidence

| Check | Result |
| --- | --- |
| Complete final `npm run test:premerge` | Passed all phases after all runtime and preview changes: secret/content/template/i18n/syntax, focused regressions, full unit suite, generated-site/build audits, Podman resources, security, Worker smoke and E2E. Logs: `/tmp/store-premerge-logs.1ltKxU/`. |
| Full unit suite | **117 files, 603 tests passed** in the final rerun after the uncertain-cancellation test (602 in the pre-merge run). |
| Final `npm run test:unit` after cancellation checkpoint ordering and postal-alias clearing | **117 files, 603 tests passed**. Log: `/tmp/store-checkout-unit-final.log`. |
| Checkout lifecycle suite | **20 tests passed**: last-unit contention, multi-SKU atomicity, direct-claim protection, fixed deadline/reuse, ten extensions, closed-tab expiry, creation retry/lease overlap, cancel races, unresolved/processing stock protection, free-order replay, checkpoint failure, signed decline/success/replay, origin/capability/cache boundaries. Stripe is mocked. |
| Security suite | 4 files, 22 tests passed. |
| Complete browser suite | **62 tests passed** in Chromium. Includes public/admin accessibility and responsive regression coverage. |
| Dedicated checkout browser scenarios | 5 scenarios included in the complete browser gate: localized holds, automatic ticket/physical loading, explicit confirmation and terminal-error recovery. |
| Podman Worker smoke | Healthy Worker; valid carts accepted, tampered carts rejected, malformed checkout fails closed. |
| Data inventory audit | 48 storage families covered; live DO recovery checkpoints classified explicitly. |
| Syntax and whitespace | Changed runtime files parse; `git diff --check` passed. |

The initial broad browser attempt exposed an add-on quantity-label variable error and old policy-copy assertions. Both were corrected. Frontend fixtures now explicitly provide the new hold response; actual reservation transitions are exercised in the coordinator/public-gateway tests. That interrupted attempt is not counted as acceptance. The final gate above passed.

The final cancellation change checkpoints canceled provider state before returning capacity. Its new test injects failure specifically into the order write, confirms stock stays pinned, and confirms a retry safely releases it. Postal-code edits now keep form and tax-quote aliases aligned, including an explicitly cleared value. The complete unit suite and three dedicated checkout browser tests passed after these follow-ups.

The final preview also exposed renamed/missing generated files under the cloud-synced `_site` folder. Podman now serves from an internal temporary directory and explicitly excludes old `_site` output. This affects local preview isolation, not production build destinations.

## Earlier details-to-payment iteration (superseded below)

The owner requested one email entry, clearer readiness before payment, removal of the empty payment-method card, and a better ticket-hold presentation. **Your details** now collects the email and required tax/shipping/RSVP information once. One completion check controls both the next-action status and button; **Payment** shows the delivery email and shipping address as a summary. Saved shipping data continues to drive estimates and payment confirmation after the form disappears. The hold separates its title, reservation count and labeled timer, with explicit warning and expiry states. The optional tip remains 5% by default.

Four focused checkout browser tests passed after the follow-up: English/Spanish mobile details, invalid-email and missing-address gating, expiry/reacquisition, 200% text without horizontal overflow, ticket/physical payment progression, matching order-summary and Pay amounts, preserved confirmation email/address, and same-intent decline retry. Screenshots use only fixture data: [English details](../images/checkout-ux-2026-09-24/09-details-ready-mobile.png), [Spanish details](../images/checkout-ux-2026-09-24/10-details-ready-mobile-es.png), and [physical payment summary](../images/checkout-ux-2026-09-24/11-payment-delivery-summary.png). The payment element in these tests is a fixture, not provider acceptance.

An initial follow-up gate caught the CSS total budget overrun. Removing unused legacy cart/add-on styles kept the existing thresholds intact: final generated CSS totals 198,780 bytes against 200,000. The full final gate recorded above passed after the saved-address and style fixes. The first physical-payment fixture used an inconsistent shipping amount; it now follows the product's $3 shipping and asserts the summary matches Pay.

## Automatic payment and shared UI follow-up

The owner requested automatic Payment Element loading as soon as checkout has the required details and removal of the separate ready notice. The 350 ms input debounce now starts one guarded preparation request; the existing inline note and button provide missing-details/loading feedback. The custom ready banner, its Sass and its redundant localized strings were removed. Stripe prewarming remains, and Store preparation no longer makes the duplicate pre-submit tax request. Final Pay and free Complete order remain explicit. Automatic failures stop for user recovery rather than looping.

The screenshot's terminal-intent error prompted cancellation/replay hardening. Cancellation invalidates pending mounts and clears credentials instead of restoring canceled secrets in failure handlers. Recovery is rendered immediately even after the countdown interval stops. The Worker checks provider state before replaying an existing payment and on status checks: canceled payments use the existing durable release path; processing/succeeded/capture-pending or uncertain payments keep the original attempt and stock. A status check also finishes an earlier uncertain cancellation. No second payment is automatically created to bypass an unresolved one.

The complete pre-merge gate passed (log directory in the table above): 602 unit tests at that point, 22 security tests and 62 browser tests. After the additional uncertain-cancellation test, the full unit suite passed **603 tests in 117 files** (`/tmp/store-auto-payment-all-unit-final.log`); the three focused payment files passed 41 tests. Final syntax, i18n and generated-asset budgets also passed. Provider responses remain fixtures; this does not claim a real-provider purchase or webhook smoke.

Five dedicated browser scenarios cover English/Spanish holds and required fields, automatic ticket/physical payment loading, no automatic confirmation, correct saved contact/address and totals, same-intent card retries, returning to checkout without mounting a canceled secret, and terminal-load failure followed by explicit availability recovery. The RSVP test also waits beyond the preparation debounce and verifies no order is created until Complete order. Reviewed fixture screenshots: [shared inline guidance](../images/checkout-ux-2026-09-24/12-inline-checkout-guidance.png) and [automatically loaded payment](../images/checkout-ux-2026-09-24/13-automatic-payment.png). Earlier screenshots showing the green ready banner are historical.

## Local preview and remaining acceptance

Preview command: `SKIP_STRIPE=true ./scripts/dev.sh --podman --detach`. Site: `http://127.0.0.1:4002`; local Worker: `http://127.0.0.1:8989`. Stripe webhook forwarding stays inactive. Browser/local fixtures do not establish provider-originated payment acceptance.

Manual local browser review at 390px verified the compact 5% tip, real ten-minute hold, event recap, conditional tax fields, empty-postal recovery, natural hold expiry and explicit reacquisition. Back to cart released the review hold. No payment was submitted. Screenshots: [cart](../images/checkout-ux-2026-09-24/05-local-cart-mobile.png), [checkout](../images/checkout-ux-2026-09-24/06-local-checkout-mobile.png), [tax fields](../images/checkout-ux-2026-09-24/07-local-checkout-mobile-fields.png), [expired hold](../images/checkout-ux-2026-09-24/08-local-checkout-expired.png).

Before deployment, complete real Stripe test-mode 3DS/async payments, cancellation races and actual webhook delivery; confirm wallet/domain eligibility and the real statement descriptor; review mobile keyboards and assistive technology on representative devices. Preserve active coordinator checkpoints during rollback/recovery. Legacy clients without an attempt retain the old payment path until rollout completes.

The original HoldMyTicket files remain reference material, not instructions. Personal values from those captures were not copied into code, documentation or fixtures.

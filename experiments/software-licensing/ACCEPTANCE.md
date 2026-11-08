# Stripe browser, webhook and Resend acceptance

This manual test uses Store's real checkout, billing, customer management and
email owners in disposable Cloudflare Workers. The small private Elements page
contains synthetic products; it is not the public storefront or a launch switch.
No production Worker, catalog, route, schedule or backup option changes.

Use patched Node 26.12.1+, the pinned dependencies in Store and the sibling
`dust-wave-licensing` checkout, Wrangler access to Workers/KV and Stripe CLI.
Obtain explicit permission for the test email recipient before starting: the
existing Resend account sends three real, `[TEST]`-labeled transactional messages.
Do not put an inbox, credentials or the private state file in git.

```sh
CLOUDFLARE_ACCOUNT_ID=<approved-account> npm run test:licensing:acceptance -- \
  --account=<approved-stripe-test-account> \
  --recipient=<approved-test-inbox> \
  --credentials=<existing-secure-env-file> \
  --state=<absolute-private-directory>/acceptance.json
```

The credential profile must contain a test secret (`STRIPE_SECRET_KEY_TEST`, or
an explicitly test-prefixed `STRIPE_SECRET_KEY`), `STRIPE_PUBLISHABLE_KEY_TEST`
and the existing `RESEND_API_KEY`. The account is checked before allocation.
The Store sender/reply-to and selected email translations come from their normal
configuration. A fixture-only adapter adds a Stripe test clock. All billing and
email behavior still runs through Store; no alternate provider implementation is
introduced.

The state file is private and contains the temporary base, access code, fixed
order and current phase. Open `<base>/acceptance/login` and enter that code.
The cookie is Secure, HttpOnly, same-site and expires in an hour. Keep this code,
private order link, keys and hosted payment URLs out of logs and screenshots.

1. `decline-and-sca`: use Stripe's decline card `4000 0000 0000 0002`; verify the
   error without fulfillment. Retry the same order with `4000 0025 0000 3155` and
   complete the test bank challenge. Wait for confirmed order/license management.
   Create `<state>.payment` only after the browser succeeds. The runner verifies
   provider-authenticated 3DS, one $60 settlement and an actual signed public
   webhook before draining the license email.
2. `declining-card-setup`: select **Update payment method**, save test card
   `4000 0000 0000 0341` on Stripe Checkout, and return to Store. Leave Link's
   optional saved information unchecked. Create `<state>.setup` only after the
   return succeeds. The runner checks the subscription's payment method, advances
   the clock, and waits for public webhook handling of a declined $11 renewal:
   $10 software plus recalculated $1 fixture tax, no one-time items. It sends the
   existing payment-failure email.
3. `recover-original-invoice`: refresh Store. Verify **Payment needed**, use
   **Update payment method** to save `4242 4242 4242 4242`, and verify that saving
   the card did not pay the invoice. Use **Review and pay securely**, pay the
   original $11 test invoice, and confirm Store shows it paid and extends coverage.
   Create `<state>.recovered` only after browser success. The runner verifies
   exactly two invoices/payments, sends the renewal confirmation, requests actual
   Stripe event redelivery and checks a fresh successful delivery receipt with no
   extra fulfillment or mail.

Use any future expiry, synthetic name/ZIP and test CVC. Never enter real card
information. Stripe's [testing guide](https://docs.stripe.com/testing) is the
source for these fixtures. Handle any interactive CAPTCHA through the normal
user handoff; do not bypass it.

Provider state, webhook journals and KV projections can become visible at
different times. The harness polls bounded conditions (three minutes for service
state, thirty minutes for each manual phase), including the outbox receipt before
moving on. Do not touch a signal file to skip missing evidence. A public webhook
must verify the real Stripe signature and fixed test-order ownership; unrelated
or live events cannot reach the Store handler. The mail filter permits only the
fixed recipient/order's licensing templates, rejects CC/BCC, and bounds the run
to four distinct jobs. No general order receipt or marketing message is drained.

Create `<state>.abort` or interrupt the process to stop. Its `finally` blocks
remove the named Workers/KV, test webhook and clock/customer, and archive only
products/prices carrying this run's exact order metadata. No R2 bucket is needed.
Inspect both cleanup sections in `<state>.evidence.json`; an incomplete cleanup
fails the run and must be resolved before another run. Do not force-kill the
process during cleanup. Private provider logs stay beside that evidence.

Email acceptance requires Resend's `delivered` status, the approved recipient
alone, `[TEST]` subject, text and HTML, reply-to and private order links. Provider
acceptance is not evidence the person opened the inbox. Readback uses the existing
[retrieve-email API](https://resend.com/docs/api-reference/emails/retrieve-email).
The ephemeral order links cease working after cleanup; these are test messages.

Preserve minimized evidence and revision/test scope in `docs/release-evidence/`.
Keep paid Entitle sales, production licensing and scheduled licensing capture
**disabled**. This test establishes a sandbox path, not a paid app launch,
production tax policy, actual inbox rendering, dispute policy or app distribution
acceptance.


For a focused checkout/webhook regression run, add `--checkout-only`. It still
requires the real browser decline, 3DS challenge, one mixed-cart settlement and a
fresh signed redelivery receipt, then cleans up without advancing a renewal or
sending email. The full mode retains all three messages and renewal recovery.
Both modes now require the initial declined PaymentIntent webhook to return 200.
A non-success receipt records only a bounded error label, never the event payload.

Store resolves a missing PaymentIntent identity from its existing checkout DO
when KV still serves the pre-provider checkpoint. Normal payment identity, amount,
currency and order-hash validation still runs; conflicting identities are denied.
The fallback is read-only and does not expose a client secret or retry creation.
This addresses [KV eventual consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).
A fresh receipt after [Stripe redelivery](https://docs.stripe.com/webhooks) is
required; CLI acceptance alone is not delivery evidence.

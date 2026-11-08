# Licensing provider acceptance — November 7, 2026

The deployed private fixture exercised Store `eb9ed3e60d2feb840536b2e873490dd9e14f4bab`
and licensing `8c9b1b41ee10cbbdc2ed895279ba292d8cfa6677`, with the acceptance adapter
in this change. Production runtime files, shared package pins and workflow
configuration were not changed. Fixture prices are not proposed product prices.

Observed provider/browser results:

- Initial card decline displayed in the browser and did not fulfill the order.
  Retrying the same mixed cart completed an actual Stripe test 3DS challenge;
  the provider recorded `authenticated`, `challenge`, version `2.1.0` and $60 paid.
- Public Stripe-signed payment/invoice events reached Store. The shirt, ticket
  and monthly software line settled once, with one licensed seat and initial
  update coverage visible in the actual customer-management renderer.
- Hosted Checkout setup saved the decline-on-charge card to the original
  subscription. Advancing the test clock produced an open, attempted $11 renewal
  with `auto_advance=false`. Store verified tax and excluded one-time items;
  public `invoice.payment_failed` handling queued the existing failure template.
- A second hosted setup saved the successful test card. Saving it left the
  invoice unpaid. The customer paid that original invoice on Stripe's hosted
  page; Store displayed both invoices paid and the additional coverage period.
  Exactly two invoice/payment records remained.
- Stripe CLI accepted a resend of the actual paid-renewal event. The subsequent
  payment count remained two and another outbox drain sent zero messages. The
  final harness additionally waits for a fresh webhook-receipt timestamp; that
  stronger receipt assertion was added after this provider run and is covered by
  focused tests, not claimed as observed in this run.
- Three real Resend messages (license, payment failure, renewed coverage) were
  independently retrieved as `delivered`. All used the approved recipient alone,
  `[TEST]` subject, Store's existing sender/reply-to, HTML/text and private order
  links. No order-receipt or marketing job was sent. Inbox opening/rendering was
  not observed; provider delivery is the acceptance recorded here.

The first allocation attempt hit Cloudflare's variable-size limit while passing
an unnecessarily complete translation catalog. It cleaned up fully. The fixture
now includes only the existing licensing-mail translations. The successful run
also exposed eventual KV visibility: order and email receipts sometimes lagged
provider state by about a minute. The final harness waits for receipt visibility
rather than omitting a recent send from its report. Independent provider retrieval
verified all three messages from the successful run. No production timing promise
is inferred. One early declined-payment webhook returned 409; later paid events
succeeded and preserved the order. This record does not claim every delivery
attempt returned 200 or establish the cause of that transient rejection.

Cleanup passed for both attempts. The successful run removed both disposable
Workers, its KV namespace, Stripe webhook and test clock/customer, and deactivated
its owned provider catalog. No R2 resources were allocated. Independent Cloudflare
readback found no matching Workers; production `store-worker` retained its
November 4 modification timestamp and exact pre-run etag. Production licensing
flags and repository/production-backup licensing opt-ins remained unset.
**Paid Entitle sales and scheduled licensing capture stayed disabled.**

Validation passed: complete local `npm run test:premerge` (863 unit tests,
seven payment contracts, 22 security tests, 109 browser tests, audits, build and
Worker smoke). After the fixture-only receipt/recipient hardening, all 865 unit
tests and seven contracts passed again, along with the 31 focused acceptance,
source and management checks. The encrypted local licensing restore rehearsal
passed with zero external requests, live payments or real emails. Platform's
397 tests and two clean-checkout recipes also passed; final secret audit passed.
The exact final source revision and hosted CI status belong to the associated
review. Local evidence is under the dated `licensing-provider-acceptance` audit
directory, outside git; it includes private state, the successful runner report,
3DS provider proof, three-message Resend readback and the regression logs. The
original dirty iCloud Store checkout's 105 preserved files matched their prior
SHA-256 inventory. No existing user changes were overwritten.

The fixture reuses the preview allocator, actual Store checkout/DO/billing,
customer management, Resend outbox/templates and licensing authority. See the
[repeatable procedure](../../experiments/software-licensing/ACCEPTANCE.md). Remaining
launch work includes operator history/key/device/release controls, dispute and
support/pricing decisions, production recovery/capacity acceptance, and ASCII VJ
font/source/signing/distribution gates. Neither this task nor its tests authorize
paid offers, a production licensing deployment or scheduled licensing capture.

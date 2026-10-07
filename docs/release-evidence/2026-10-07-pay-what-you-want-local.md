# Pay what you want: local candidate

Date: October 7, 2026. Branch: `feat/pay-what-you-want`.

## Scope

The owner selected a standalone contribution, $10 / $25 / $50 / $100 suggestions,
custom amounts, no coupons, a 0% default optional tip and standard tax. The USD
processor floor is $0.50; there is no additional business minimum. The starting
selection is $10. The new `support-paradiso` product reuses the existing event
artwork and links to the separate ticket and sponsorship products.

`pricing_mode: pay_what_you_want` is an opt-in service pricing mode. Existing
repository products, static rendering, private product publishing, canonical
checkout, payment attempts, receipts and reporting remain the shared paths.
Quantity is one; adding the same contribution again updates its chosen amount.
Mixed-cart coupons discount eligible ordinary products only. A customer's explicit
tip choice is retained; an untouched tip defaults to zero when a contribution is
present. No inventory, shipping, ticket, RSVP or download entitlement is created
for the contribution.

## Verification

- The initial pre-merge run passed secret/template/content/i18n/syntax checks,
  focused regression suites, all 653 unit tests, build/SEO/performance audits,
  Podman resource checks, all 22 security tests and the local Worker smoke.
  Its browser pass exposed a dashboard field-layout regression; pricing controls
  were moved after the existing commerce controls to preserve inventory layout.
- Focused final money and recovery checks passed 70 tests across
  `pay-what-you-want`, `checkout-holds` and `cart-pending-item`: preset/custom cents,
  tampering, ceilings, canonical coupon eligibility, standard tax, default/explicit
  tips, immutable order amounts, HTML/plain-text receipt amounts, signed decline/
  success/replay, same-intent reuse and optional reminder recovery.
- The three dedicated Chromium contribution scenarios passed in English/Spanish:
  presets, custom entry, rejected sub-minimum amounts, keyboard Add, cart reload,
  hold and payment-preparation payloads, mobile width and 200% text. The new
  dashboard authoring scenario also passed.
- Desktop and mobile product screenshots were visually inspected. Product copy
  renders through the existing rich-content blocks; system controls are localized.
- Final `npm run test:premerge`: **all phases passed**, including **654 unit tests
  in 120 files**, **22 security tests**, **72 Chromium browser tests**, build/SEO/
  performance checks, local Worker smoke and Podman resource checks. This run
  includes the recovery and dashboard fixes. Logs:
  `/tmp/store-premerge-logs.KB9wzj/` and
  `/tmp/store-contribution-premerge-final.log`.
- Final `git diff --check` passed. Provider and production checks remain outside
  this local evidence.

An untracked `worker/wrangler 2.toml` appeared during verification and is
byte-identical to `worker/wrangler.toml`. It was preserved and is outside this
feature's change set.

## Release boundary

Payments, signed webhooks and receipt rendering use local synthetic fixtures.
No real Stripe charge, provider-originated webhook, actual Resend delivery, push
or production deployment was performed. Production deployment must keep the
reviewed Worker and storefront/catalog change together. Existing recovery,
reconciliation, retention and release procedures continue to apply; no storage
key family or external provider was introduced.

See [product setup](../ADD_ON_PRODUCTS.md#pay-what-you-want),
[payment behavior](../PAYMENT_PROCESSOR.md), [test coverage](../TESTING.md#pay-what-you-want)
and [ethical review](../ETHICAL_RISK.md#pay-what-you-want--2026-10-07).

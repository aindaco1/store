# Daily product reports — local verification

Implemented on `codex/product-daily-reports`. Production has not been deployed,
no existing product has been subscribed, and no real report email was sent.

## Behavior

- Product Create/Edit reuses the existing email-list control for up to 20
  normalized, deduplicated recipients. Removing all recipients disables reports.
- Reports become due at 7 AM in the store time zone, cover yesterday's confirmed
  orders, and skip empty days. All fulfillment types and free orders are supported.
- One row per stored product/variant line shows purchaser email, variant when
  present, quantity and the line amount after discounts. Other products, shipping,
  tax and tips are excluded. No names, addresses, order tokens or access links.
- Existing cron, bounded bulk order reads, canonical fulfillment readiness,
  shared date helpers and durable outbox are reused. No new database or queue.
- Failed passes retry that day with stable outbox identities. Recipient removal
  and provider suppression are checked before delivery. A complete scan is required.
- The shared email-list control now fits 320px editors and wraps long addresses.

## Validation

- Full unit suite: **763 passed** across 128 files, including 20 report tests.
- Worker security suite: **22 passed**.
- Worker smoke: catalog, canonical cart validation and malformed checkout checks passed.
- Full browser suite: 100 of 101 initially passed; the only failure identified
  the new recipient input's inherited minimum width at 320px. After fixing the
  shared control and adding a 320px/long-address regression, the complete admin
  suite passed **43 of 43**. This covers all 102 current browser cases across the
  full run and the affected-suite rerun.
- Final Jekyll build, asset minification/check and performance budgets passed.
- Secret audit (including staged new files), content audit, template drift,
  localization completeness and syntax checks passed.
- An in-memory recipient sentinel was added to every product and the actual
  public catalog (26 products) and a product page were rendered with Jekyll.
  Neither output exposed recipient addresses or the configuration field.
- Email rendering and cron/outbox integration used synthetic orders and
  capture/dry-run mode. This does not claim live Resend delivery.

## Test environment

The normal HTTPS local override initially pointed the browser harness at port
9443, outside its HTTP mock routes. The browser suite was rerun with isolated
HTTP test configuration. The earlier secret audit also flagged the already
public test Stripe publishable key from local settings; isolated fixture
settings passed the audit without changing its rules. Original local credentials,
HTTPS site settings and Worker configuration were restored and compared with the
saved copies afterward. Test evidence and a synthetic HTML report preview are
stored outside the repository in the local Codex application-support directory.

See [Email](../EMAIL.md#daily-product-reports), [Dashboard](../DASHBOARD.md#products),
[Testing](../TESTING.md#daily-product-reports), and the
[ethical-risk review](../ETHICAL_RISK.md#daily-product-reports-review-2026-10-28).

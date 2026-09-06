# Merge Smoke Checklist

Use this checklist for branches that touch checkout, fulfillment, admin, i18n, accessibility, SEO, Podman/release tooling, payment/webhooks, inventory, reminders, or catalog publishing.

This checklist owns acceptance and sign-off. [Testing](TESTING.md) owns the commands, options, and evidence collection procedures.

## Environment

Use the [local Podman stack](CONTRIBUTING.md#local-setup) as the production-like rehearsal environment. Store also has an isolated Stripe test Worker for provider-originated webhook evidence; its scope and explicit invocation are documented in [Testing](TESTING.md#release-smoke). It is not a complete storefront staging environment.

Prefer local signed-webhook evidence for the release gate. Verify production provider state through read-only probes and the **Release Provider Evidence** workflow. Do not point release smoke at production checkout domains.

## Local Rehearsal

Run [release smoke](TESTING.md#release-smoke) from the repository root and retain the generated evidence file. That procedure documents focused reruns, Podman parity, local signed-webhook settlement, optional interactive checkout, and optional VoiceOver transcript evidence.

For direct local settlement, configure the Worker with `STORE_EMAIL_DRY_RUN=true` or `RESEND_EMAIL_DRY_RUN=true`. Confirm the payment matrix reports customer/admin order email dry-run markers without Resend sends. Keep this evidence distinct from provider-originated Stripe delivery and actual email delivery.

Use [production preflight](TESTING.md#production-preflight) for read-only DNS/admin response-policy evidence. Record every provider warning or credential-based skip with an owner, date, reason, and any supporting provider-console evidence.

## Test Data

Prepare or identify safe test records before smoke:

- One paid physical product with tax, shipping, finite inventory, and a product image.
- One paid digital product backed by a reusable download file.
- One paid ticket product with attendee and QR/check-in fulfillment.
- One configured free RSVP product with at least two attendees and a scoped question that confirms without Stripe.
- One coupon covering percent or fixed discounts and at least one rejection case.
- One admin user with `super_admin` access and one limited Store admin user.
- Long product, attendee, filename, and fulfillment labels for wrapping/overflow checks.
- English and Spanish public/order/admin routes.
- Stripe test-mode PaymentIntent success and failure paths through the local direct signed-webhook matrix.

## Pass/Fail Rule

Block merge or release when any of these fail:

- Checkout totals, tax, shipping, coupon, or inventory reservation behavior is wrong.
- Paid orders confirm without a signed Stripe webhook.
- Failed or canceled payments do not release reservations.
- Signed downloads, ticket links, order lookup links, or admin magic links expose reusable secrets.
- Private routes such as `/admin/`, `/orders/`, or `/order-success/` are indexed or appear in the sitemap.
- New user-facing copy bypasses the i18n catalog where the Store architecture expects catalog copy.
- A triggered ethical risk review identifies a high-impact misuse, privacy, fairness, consent, or customer-trust risk without a mitigation, owner, rollback path, or communication plan.
- Accessibility smoke finds a keyboard trap, missing visible focus, broken status announcement, unusable high-zoom layout, or mobile overflow.
- Podman release paths cannot build and run the Store/Worker stack.
- Recovery evidence contains production/customer data, restores quarantined/derived state, targets production, or omits preview R2 isolation.

## Automated Gate

- [ ] Run `npm run release:smoke -- --evidence-file /tmp/store-release-smoke.md`.
- [ ] Confirm `npm run test:premerge` passed or document the exact failing phase and log.
- [ ] Confirm `npm run launch:readiness` passed or document missing external/provider setup.
- [ ] Confirm Podman E2E passed, or record a justified environment skip and rerun on a Podman-ready host.
- [ ] Confirm accessibility automated evidence passed or is covered by the passed Podman E2E suite; attach transcript-assisted VoiceOver/Whisper evidence when available.
- [ ] Confirm rendered i18n/SEO evidence passed.
- [ ] Confirm Worker fulfillment evidence passed.
- [ ] Confirm `npm run release:providers` passed, or record each credential-based skip with owner/date/reason and provider-console evidence.
- [ ] Confirm `npm run release:payment-smoke` passed. For direct local settlement, confirm the Worker used email dry-run flags and the matrix reported customer/admin order email dry-run evidence without Resend sends.
- [ ] Confirm the representative Podman restore rehearsal and backup/recovery readiness phases passed. Treat a missing live encrypted snapshot receipt as an explicit operational warning, not as synthetic proof.
- [ ] Confirm triggered ethical risk review is recorded in the PR or evidence file, or marked `N/A` with a reason.
- [ ] Attach or archive the generated evidence file with release notes.

## Accessibility

- [ ] Navigate home, product detail, cart, checkout entry, order lookup, order success, and admin using only the keyboard.
- [ ] Run `npm run release:a11y-evidence` for focused axe, keyboard, high-zoom, focus order, status, and reduced-motion evidence.
- [ ] Confirm visible focus does not disappear behind sticky headers, drawers, modals, or tab panels.
- [ ] Confirm cart, coupon, checkout, download, ticket/check-in, and admin save/delete states announce status changes.
- [ ] When release scope requires assistive-technology speech evidence, smoke with VoiceOver on Safari for product purchase, cart update, order lookup, and admin login; use `npm run release:screen-reader-evidence -- --audio-file <recording>` to attach Whisper transcript evidence when practical.
- [ ] Review `prefers-reduced-motion`, 200% browser zoom, and mobile widths for overflow or clipped controls.
- [ ] Confirm icon-only controls have accessible names and destructive actions expose clear confirmation text.

## I18N

- [ ] Review English and Spanish home, product, orders, order-success, admin login, and admin dashboard shells.
- [ ] Confirm product titles/descriptions stay creator-authored unless a product defines explicit localized overrides.
- [ ] Run `npm run test:i18n` after adding or changing catalog-backed copy.
- [ ] Run `npm run release:i18n-seo-evidence` and confirm English/Spanish route, locale switch, sitemap, and private-route assertions pass.
- [ ] Confirm email subjects, headings, CTAs, and footers resolve through the email catalog.
- [ ] Confirm locale switch links preserve expected route context and do not route private tokens into public pages.
- [ ] Confirm no new hardcoded Store/admin strings appear in runtime surfaces that already use locale catalogs.

## Podman

- [ ] Run `npm run podman:doctor`.
- [ ] Run `./scripts/dev.sh --podman` and confirm the Storefront and Worker respond on local defaults.
- [ ] Run `SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh --podman`.
- [ ] Run `npm run test:e2e:headless:podman`.
- [ ] If ports or gvproxy are stale, remove `store-dev-site`, `store-dev-worker`, and `store-dev-pod`, then rerun doctor.
- [ ] Rebuild with `PODMAN_REBUILD=1` after Containerfile, package-lock, Ruby gem, or Playwright version changes.

## SEO

- [ ] Run `bundle exec jekyll build --quiet` and `npm run test:seo`.
- [ ] Run `npm run release:i18n-seo-evidence` for rendered canonical, hreflang, social, private noindex, sitemap, robots, and Product JSON-LD evidence.
- [ ] Confirm public pages emit canonical URLs, descriptions, Open Graph/Twitter metadata, and JSON-LD where appropriate.
- [ ] Confirm product pages emit Product JSON-LD with current price, availability, image, SKU/product id, and canonical URL.
- [ ] Confirm localized pages emit expected `hreflang` alternates.
- [ ] Confirm active and sold-out public products appear in `sitemap.xml`; archived, admin, orders, and order-success routes do not.
- [ ] Confirm `/admin/`, `/es/admin/`, `/orders/`, and `/order-success/` carry `noindex,nofollow,noarchive`.
- [ ] Confirm `robots.txt` points to the sitemap and does not block order-success or order lookup before crawlers can observe noindex.

## Checkout And Fulfillment

- [ ] Add a physical product to the cart and change its quantity.
- [ ] Set a test inventory baseline and confirm checkout respects it.
- [ ] Confirm `/order-success/` shows the canonical order and fulfillment state.
- [ ] Confirm order email dry-run evidence; record actual Resend delivery separately when a controlled provider test is in scope.

- [ ] Paid physical checkout calculates tax/shipping and creates the expected order record.
- [ ] Run `npm run release:fulfillment-evidence` for signed downloads, download revoke/refresh, ticket/RSVP check-in, and admin CSV export evidence.
- [ ] Paid digital checkout confirms only after webhook settlement and shows a signed download action.
- [ ] Paid ticket checkout produces attendee/ticket fulfillment and admin check-in works once.
- [ ] Free RSVP checkout places Contact before RSVP details, omits tip/payment controls at `$0.00`, uses **Complete order**, does not load Stripe, and produces expected attendee/receipt behavior.
- [ ] Paid or mixed checkout still renders payment controls and uses the PaymentIntent path.
- [ ] A configured two-attendee RSVP retains the submitted roster; search for a named attendee, review historical response labels, export attendee CSV, and verify partial attendance totals through check-in and undo.
- [ ] Replaying an equivalent signed Stripe test webhook does not duplicate order settlement or inventory changes.
- [ ] Stripe success webhook settles paid orders; failed/canceled payment events release reservations.
- [ ] Customer order lookup sends a generic request response and consumes only token-scoped links.
- [ ] Abandoned-checkout and event reminder suppression/resume behavior is correct in a controlled test.
- [ ] Download revoke/refresh and reusable library file create/delete paths work from admin.
- [ ] Coupon create/apply/reject/delete behavior matches totals and admin state.

## Admin Dashboard

- [ ] Settings readiness and reconciliation exports download and match expected state.
- [ ] Products can preview, publish, bulk publish, update media, and preserve product taxonomy.
- [ ] Coupons can be created, applied in a test cart, and deleted.
- [ ] Downloads can be uploaded/replaced and signed fulfillment actions stay non-public.
- [ ] Orders search, filters, CSV export, attendee export, check-in, and download access actions work.
- [ ] Analytics, referrals, marketing/reminder suppression, and historical Snipcart import panels remain usable.
- [ ] Scoped Store admin users cannot access super-admin-only actions.
- [ ] Spanish admin routes, tab/subtab persistence, and reload behavior remain intact.

## Production Checklist

Provider and runtime checks:

- [ ] Cloudflare routes or custom domains serve `https://shop.dustwave.xyz` and `https://checkout.dustwave.xyz`.
- [ ] `STORE_STATE`, `RATELIMIT`, `STORE_DOWNLOADS`, and `STORE_INVENTORY_COORDINATOR` point at production Cloudflare resources.
- [ ] Worker secrets are set in Cloudflare, not in Git, including Stripe, Resend, admin session/login, checkout intent, magic link, download/order lookup, Turnstile, and USPS secrets as applicable.
- [ ] Production runtime config uses `SITE_BASE=https://shop.dustwave.xyz`, `WORKER_BASE=https://checkout.dustwave.xyz`, `CORS_ALLOWED_ORIGIN=https://shop.dustwave.xyz`, `TAX_PROVIDER=nm_grt`, `SHIPPING_ORIGIN_ZIP=87120`, `SHIPPING_ORIGIN_COUNTRY=US`, and `USPS_ENABLED=true` unless intentionally changed.
- [ ] Stripe production webhook endpoint targets `https://checkout.dustwave.xyz/webhooks/stripe` and subscribes at least to `payment_intent.succeeded` and `payment_intent.payment_failed`.
- [ ] Stripe test webhook endpoint targets `https://store-worker-staging.jogo.workers.dev/webhooks/stripe`, subscribes to the same two events, and uses `STRIPE_WEBHOOK_SECRET_TEST` only in the isolated staging Worker.
- [ ] Resend sender domains and `ORDERS_EMAIL_FROM` / `UPDATES_EMAIL_FROM` are verified.
- [ ] Resend delivery webhook targets `https://checkout.dustwave.xyz/webhooks/resend`, subscribes to delivered/bounced/complained/failed/suppressed events, and its signing secret is stored as `RESEND_WEBHOOK_SECRET`.
- [ ] `EMAIL_OUTBOX_ENABLED=true` and `PAYMENT_RECONCILIATION_ENABLED=true` are present in the deployed production binding summary; the admin readiness checks report their dependencies as ready.
- [ ] USPS live credentials and New Mexico GRT behavior are verified from the production origin address.
- [ ] Real `STORE_DOWNLOADS` objects or approved Worker-only fallback URLs exist for active digital products.
- [ ] Finite-stock products have true inventory baselines or `inventory_baseline_source` / `inventory_verified_at`; unlimited or made-to-order products use `inventory_tracking: false`.

Production smoke:

- [ ] Paid physical checkout works with tax and shipping.
- [ ] Paid digital checkout produces a signed download action.
- [ ] Paid ticket checkout produces ticket/check-in actions.
- [ ] Free RSVP checkout collects configured attendee details, omits tip/payment controls at a zero total, and confirms without Stripe.
- [ ] Paid and mixed checkout still renders the payment method and settles through Stripe.
- [ ] Stripe webhooks confirm paid orders.
- [ ] Failed payments release reservations.
- [ ] Admin product publish triggers deploy.
- [ ] On a harmless test product, selecting Archived remains visibly pending until **Archive product** is used; after publish succeeds, the repository records `status: archived` and the deployed catalog eventually removes the product from public listings.
- [ ] Admin download replacement works on a non-public test product.
- [ ] Admin coupon create/apply/delete works on a harmless test cart.
- [ ] Admin user scopes are correct.
- [ ] Customer order lookup links are generic on request and token-scoped on consume.
- [ ] Reminder cron heartbeat and queue health are visible.
- [ ] Store orders, audit, attendee, and reconciliation CSV exports download and match the expected production order state.

## Sign-Off Template

```text
Release/branch:
Commit:
Evidence file:

Automated gate owner/date:
Accessibility owner/date:
I18N owner/date:
Podman owner/date:
SEO owner/date:
Checkout/fulfillment owner/date:
Admin owner/date:

Known skips:
Blockers:
Release decision:
```

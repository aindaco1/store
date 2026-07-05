# Testing

The current `v1.0.5` release gate adds Store release evidence for accessibility, i18n, Podman, SEO, provider readiness, payment contracts, signed-webhook settlement, fulfillment, and no-send order email rendering. The `v1.0.4` baseline added regression coverage for Store-owned customer/super-admin order email, durable digital download entitlements with admin revoke/refresh, ticket SVG long-name fitting, localized public order routes, authenticated order-notification link consumption, admin tab persistence, i18n completeness, SEO metadata, admin order action responsiveness, and live order attendance refresh.

The default test path is Store-only. It covers product pages, cart behavior, first-party checkout, Store admin operations, coupons, order lookup, reminders, content safety, and Worker security.

## Quick Commands

```bash
bundle exec jekyll build --quiet
npm run test:unit
npm run test:seo
npm run test:content-security
npm run test:security
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh
PLAYWRIGHT_EXTERNAL_SERVER=1 CI=1 npx playwright test --project=chromium --workers=1
```

Local services:

- Storefront: `http://127.0.0.1:4002`
- Worker: `http://127.0.0.1:8989`

## Browser Coverage

Default Playwright specs:

- `tests/e2e/accessibility-public-pages.spec.ts`
- `tests/e2e/public-page-controls.spec.ts`
- `tests/e2e/admin-dashboard.spec.ts`

These cover public layout/accessibility, product-card and product-detail controls, storefront filters, localized product routes, cart quantity updates, keyboard add-to-cart flow, customer order lookup, Store admin login, Store readiness/audit/reconciliation export, Store order CSV/attendee CSV/check-in/download access flow, product publish, download replacement upload, coupon management, inventory baseline writes, scoped Store admin access, and Spanish admin tabs.

Release-focused browser assertions include 200% text-scaling coverage for public checkout/order surfaces and Store admin Products, Orders, Downloads, and Marketing surfaces.

## Unit Coverage

```bash
npm run test:unit
```

Focused Store runs:

```bash
npx vitest run \
  tests/unit/store-catalog.test.ts \
  tests/unit/store-coupons.test.ts \
  tests/unit/shipping.test.ts \
  tests/unit/tax.test.ts \
  tests/unit/tier-inventory-do.test.ts \
  tests/unit/order-lookup-email.test.ts \
  tests/unit/event-reminders.test.ts \
  tests/unit/cart-runtime-loader.test.ts \
  tests/unit/page-prefetch.test.ts
```

## Security

```bash
npm run test:secrets
npm run test:content-security
npm run test:security
npm run test:security:podman
```

The security suite checks Store admin auth boundaries, cart/checkout input validation, oversized payload rejection, Stripe webhook signature enforcement, CORS preflight resilience, and rate-limit behavior.

## SEO

```bash
bundle exec jekyll build --quiet
npm run test:seo
```

The rendered SEO audit checks non-admin HTML, canonical URLs, descriptions, social metadata, JSON-LD, sitemap URLs, localized alternates, and crawl-control rules for `noindex` routes.

## Pre-Merge

```bash
npm run test:premerge
```

The pre-merge script runs secret/content audits, i18n completeness, syntax checks, focused Store unit tests, full unit tests, generated-site build artifact checks, SEO audit, Worker security tests, host Worker smoke, Podman Worker smoke, asset minification checks, and the headless Playwright suite. It waits for the real admin shell before host smoke so a stale listener cannot count as a ready site. When host Jekyll gems are unavailable it falls back to a Podman-backed build, smoke, and browser path.

## Release Smoke

```bash
npm run release:smoke -- --evidence-file /tmp/store-release-smoke.md
```

The release smoke wrapper reuses the pre-merge gate, runs launch readiness, runs the Podman headless E2E path when Podman is available, records accessibility automation evidence, runs optional VoiceOver/Whisper transcript evidence when requested, runs rendered i18n/SEO evidence, runs Worker fulfillment evidence, runs read-only provider probes, runs payment smoke readiness, and writes a Markdown evidence file with sign-off placeholders for accessibility, i18n, Podman, SEO, providers, checkout/fulfillment, and admin review. Use `--podman-e2e` to require Podman on the current host and `--skip-podman-e2e` only with a documented environment reason.

Focused release commands are also available when a gate needs to be rerun independently:

```bash
npm run release:a11y-evidence
npm run release:screen-reader-evidence
npm run release:i18n-seo-evidence
npm run release:fulfillment-evidence
npm run release:providers
npm run release:payment-smoke
```

`npm run release:i18n-seo-evidence` rebuilds the rendered site, runs the i18n and SEO test suites, and samples English/Spanish public, product, order, admin, sitemap, and robots routes for canonical, hreflang, noindex, copy, and Product JSON-LD expectations. `npm run release:fulfillment-evidence` runs an in-process Worker with mock KV/R2 data and proves signed downloads, download revoke/refresh, ticket/RSVP check-in, order CSV, attendee CSV, reconciliation CSV, and audit CSV behavior without calling external providers.

`npm run release:screen-reader-evidence` checks whether Whisper and the host platform can support transcript-assisted VoiceOver evidence. Pass `--audio-file <recording>` to transcribe an existing VoiceOver run, or `--record-voiceover` with `VOICEOVER_AUDIO_DEVICE` on macOS to capture VoiceOver output for a target URL. Transcript evidence is optional unless a release explicitly requires assistive-technology speech evidence.

The release smoke wrapper can pass transcript evidence options through directly:

```bash
VOICEOVER_AUDIO_DEVICE=":0" VOICEOVER_CONTROL=ensure-on VOICEOVER_OPEN_APP=Safari \
  npm run release:smoke -- --screen-reader-record-voiceover \
  --screen-reader-url http://127.0.0.1:4002/ \
  --screen-reader-expect "Shop" \
  --evidence-file /tmp/store-release-smoke.md
```

Use an existing recording instead with `--screen-reader-audio-file <recording>`. For reliable VoiceOver capture, prefer a system-audio loopback device; microphone capture can prove the pipeline but depends on room audio and macOS microphone permissions.

`npm run release:providers` is read-only. It checks public DNS and, when credentials or authenticated CLIs are present, GitHub deploy secret names, Cloudflare API/KV/R2/DNS records, Stripe webhook endpoints, Resend domains, and USPS quote fixtures. The probe uses `gh`, `wrangler`, and `stripe` CLI auth as fallback evidence without printing secrets. `npm run release:payment-smoke` always runs payment contract checks; the release-grade mutation path is the direct local signed-webhook matrix with `PAYMENT_SMOKE_ALLOW_MUTATION=1`.

Release provider and payment probes read `worker/.dev.vars` by default, with shell environment values taking precedence. Use `--no-dev-vars` only for clean-shell CI probes. The direct local webhook path is:

```bash
PAYMENT_SMOKE_ALLOW_MUTATION=1 npm run release:payment-smoke -- --direct-webhook
```

That path creates Stripe test-mode PaymentIntents for paid digital, paid physical, paid ticket, and failed-payment paths, confirms successful intents with the Stripe test card, signs local `payment_intent.succeeded` or `payment_intent.payment_failed` webhooks with the configured test webhook secret, posts them to the non-production Worker, and polls Store orders until they settle. It also runs a free RSVP checkout without Stripe. Run the Worker with `STORE_EMAIL_DRY_RUN=true` or `RESEND_EMAIL_DRY_RUN=true`; the smoke checks order `emailDelivery` markers to prove customer/admin order emails rendered without calling Resend. It never targets `checkout.dustwave.xyz`.

For optional interactive checkout rehearsal outside the release gate, run:

```bash
SKIP_CHECKOUT_PROMPT=1 ./scripts/test-checkout.sh --podman
```

This headed helper is exploratory desktop/browser evidence. It is not part of `npm run release:smoke` because automated payment contracts, direct signed-webhook settlement, and fulfillment evidence cover the release-critical checkout/payment risks more deterministically.

The generated evidence file distinguishes automated checks from external evidence gates: production Cloudflare DNS workflow evidence and provider-console checks for any Cloudflare, Stripe, Resend, USPS, DNS, or R2 probe that was skipped because credentials or CLI access were not available. Optional VoiceOver/Whisper transcript evidence and deployed Stripe settlement evidence can be attached when a release explicitly requires them.

Use [MERGE_SMOKE_CHECKLIST.md](MERGE_SMOKE_CHECKLIST.md) as the release checklist for branches touching checkout, fulfillment, admin, i18n, accessibility, SEO, Podman/release tooling, payment/webhooks, inventory, reminders, or catalog publishing.

## Production Preflight

Before deploys that affect checkout, fulfillment, admin publishing, product inventory, or production settings, run from the repository root:

```bash
npm run sync:worker-config
npm run catalog:generate
npm run launch:readiness
bundle exec jekyll build --config _config.yml,_config.local.yml
npm run assets:minify:check
npm run test:unit
```

For checkout, admin, or Worker changes, also run:

```bash
npm run test:security
CI=1 npx playwright test tests/e2e/admin-dashboard.spec.ts --workers=1
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh
```

Payment-specific setup, webhook, and reconciliation checks are documented in [PAYMENT_PROCESSOR.md](PAYMENT_PROCESSOR.md).

`npm run launch:readiness` checks repo-visible production inputs. `npm run release:providers` can verify external account state when read-only provider credentials are present. Anything skipped by that probe still needs provider-console evidence in the release notes.

For production Cloudflare DNS evidence, use the `Release Provider Evidence` GitHub Actions workflow. It runs the provider probe in Cloudflare DNS-only strict mode with the production Cloudflare secrets that are intentionally not readable from a local checkout.

## Manual Store Smoke

After checkout, fulfillment, email, admin, inventory, or catalog changes:

1. Add a physical product to cart.
2. Change quantity in the cart.
3. Complete a paid Stripe test checkout.
4. Confirm `/order-success/` shows fulfillment state.
5. Confirm the order email sends through Resend.
6. Export Store audit CSV from **Settings -> Store readiness**.
7. Export Store reconciliation CSV from **Settings -> Store readiness**.
8. Export Store orders CSV from admin.
9. Search for a ticket attendee and export attendee CSV from admin.
10. Check in a ticket/RSVP order from admin.
11. Upload or replace a digital download in admin.
12. Create and delete a reusable download library file.
13. Revoke and refresh a confirmed digital fulfillment item from admin.
14. Download a confirmed digital fulfillment item.
15. Create, apply, and delete a coupon.
16. Request an order lookup link and consume it.
17. Verify abandoned-checkout reminder suppression/resume behavior in a controlled test.
18. Set an inventory baseline and verify checkout respects it.
19. Replay or send an equivalent Stripe webhook test event for paid settlement.
20. Confirm failed/canceled payments release reservations.

## Production Checklist

Provider and runtime checks:

- Cloudflare routes or custom domains serve `https://shop.dustwave.xyz` and `https://checkout.dustwave.xyz`.
- `STORE_STATE`, `RATELIMIT`, `STORE_DOWNLOADS`, and `STORE_INVENTORY_COORDINATOR` point at production Cloudflare resources.
- Worker secrets are set in Cloudflare, not in Git, including Stripe, Resend, admin session/login, checkout intent, magic link, download/order lookup, Turnstile, and USPS secrets as applicable.
- Production runtime config uses `SITE_BASE=https://shop.dustwave.xyz`, `WORKER_BASE=https://checkout.dustwave.xyz`, `CORS_ALLOWED_ORIGIN=https://shop.dustwave.xyz`, `TAX_PROVIDER=nm_grt`, `SHIPPING_ORIGIN_ZIP=87120`, `SHIPPING_ORIGIN_COUNTRY=US`, and `USPS_ENABLED=true` unless intentionally changed.
- Stripe production webhook endpoint targets `https://checkout.dustwave.xyz/webhooks/stripe` and subscribes at least to `payment_intent.succeeded` and `payment_intent.payment_failed`.
- Resend sender domains and `ORDERS_EMAIL_FROM` / `UPDATES_EMAIL_FROM` are verified.
- USPS live credentials and New Mexico GRT behavior are verified from the production origin address.
- Real `STORE_DOWNLOADS` objects or approved Worker-only fallback URLs exist for active digital products.
- Finite-stock products have true inventory baselines or `inventory_baseline_source` / `inventory_verified_at`; unlimited or made-to-order products use `inventory_tracking: false`.

Production smoke:

- Paid physical checkout works with tax and shipping.
- Paid digital checkout produces a signed download action.
- Paid ticket checkout produces ticket/check-in actions.
- Free RSVP checkout confirms without Stripe.
- Stripe webhooks confirm paid orders.
- Failed payments release reservations.
- Admin product publish triggers deploy.
- Admin download replacement works on a non-public test product.
- Admin coupon create/apply/delete works on a harmless test cart.
- Admin user scopes are correct.
- Customer order lookup links are generic on request and token-scoped on consume.
- Reminder cron heartbeat and queue health are visible.
- Store orders, audit, attendee, and reconciliation CSV exports download and match the expected production order state.

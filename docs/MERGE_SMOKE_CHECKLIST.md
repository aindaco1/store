# Merge Smoke Checklist

Use this checklist for branches that touch checkout, fulfillment, admin, i18n, accessibility, SEO, Podman/release tooling, payment/webhooks, inventory, reminders, or catalog publishing.

## Environment

Store does not maintain a separate staging environment. Use the local Podman path as the production-like rehearsal environment, with local defaults:

- Storefront: `http://127.0.0.1:4002`
- Worker: `http://127.0.0.1:8989`
- Admin: `http://127.0.0.1:4002/admin/`

The release gate should prefer Podman and local signed-webhook evidence over deployed-branch targets. Production-only provider state is verified through read-only provider probes and the GitHub Actions Cloudflare DNS evidence workflow.

## Local Rehearsal

Run the DRY release smoke wrapper from the repository root:

```bash
npm run release:smoke -- --evidence-file /tmp/store-release-smoke.md
```

For an optional interactive local checkout rehearsal outside the release gate, run the headed helper directly:

```bash
SKIP_CHECKOUT_PROMPT=1 ./scripts/test-checkout.sh --podman
```

This helper is exploratory desktop/browser evidence. It is intentionally not a `release:smoke` phase because checkout/payment release risks are covered by automated payment, webhook, and fulfillment evidence.

For Podman-only parity checks:

```bash
npm run podman:doctor
./scripts/dev.sh --podman
npm run test:e2e:headless:podman
```

For focused reruns of the automatable manual gates:

```bash
npm run release:a11y-evidence
npm run release:screen-reader-evidence
npm run release:i18n-seo-evidence
npm run release:fulfillment-evidence
npm run release:providers
npm run release:payment-smoke
```

`npm run release:providers` can use authenticated `gh`, `wrangler`, and `stripe` CLIs for read-only evidence. Record any remaining warnings or skips in the generated evidence file.

GitHub Actions also has a read-only Cloudflare DNS evidence workflow for production DNS records. `Release Provider Evidence` runs `npm run release:providers -- --cloudflare-dns-only --strict --no-dev-vars` with the production `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_ZONE` secrets injected by Actions. Manually dispatch it for release branches when local provider probes cannot read the GitHub-only zone id; it runs automatically on `main`.

Provider and payment release probes read `worker/.dev.vars` by default, with shell environment values taking precedence. Use `--no-dev-vars` only for clean-shell CI probes. For local signed-webhook settlement without Stripe CLI forwarding:

```bash
PAYMENT_SMOKE_ALLOW_MUTATION=1 npm run release:payment-smoke -- --direct-webhook
```

Run the target Worker with `STORE_EMAIL_DRY_RUN=true` or `RESEND_EMAIL_DRY_RUN=true` for that direct path. The smoke fails when order email dry-run markers are missing, so it proves the customer/admin order emails would render without sending through Resend. The default direct matrix covers paid digital, paid physical, paid ticket, free RSVP, and failed-payment suppression.

Rendered i18n/SEO and in-process fulfillment evidence are provider-free:

```bash
npm run release:i18n-seo-evidence
npm run release:fulfillment-evidence
```

For transcript-assisted screen-reader evidence, record a VoiceOver smoke and run:

```bash
npm run release:screen-reader-evidence -- --audio-file <recording> --expect "Add to Cart" --expect "Order"
```

Or include it in the release smoke evidence file:

```bash
VOICEOVER_AUDIO_DEVICE=":0" VOICEOVER_CONTROL=ensure-on VOICEOVER_OPEN_APP=Safari \
  npm run release:smoke -- --screen-reader-record-voiceover \
  --screen-reader-url http://127.0.0.1:4002/ \
  --screen-reader-expect "Shop" \
  --evidence-file /tmp/store-release-smoke.md
```

On macOS, `--record-voiceover` can open a target URL and capture VoiceOver audio when `ffmpeg` and `VOICEOVER_AUDIO_DEVICE` are configured. Whisper transcript evidence helps verify spoken labels and state changes when a release explicitly requires assistive-technology speech evidence.

For local test-mode PaymentIntent creation and signed-webhook settlement, use the direct local webhook matrix above. Do not point release smoke at production checkout domains.

## Test Data

Prepare or identify safe test records before smoke:

- One paid physical product with tax, shipping, finite inventory, and a product image.
- One paid digital product backed by a reusable download file.
- One paid ticket product with attendee and QR/check-in fulfillment.
- One free RSVP product that confirms without Stripe.
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
- Accessibility smoke finds a keyboard trap, missing visible focus, broken status announcement, unusable high-zoom layout, or mobile overflow.
- Podman release paths cannot build and run the Store/Worker stack.

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

- [ ] Paid physical checkout calculates tax/shipping and creates the expected order record.
- [ ] Run `npm run release:fulfillment-evidence` for signed downloads, download revoke/refresh, ticket/RSVP check-in, and admin CSV export evidence.
- [ ] Paid digital checkout confirms only after webhook settlement and shows a signed download action.
- [ ] Paid ticket checkout produces attendee/ticket fulfillment and admin check-in works once.
- [ ] Free RSVP checkout confirms without Stripe and produces expected attendee/receipt behavior.
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

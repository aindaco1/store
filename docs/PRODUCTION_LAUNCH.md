# Production Launch Runbook

This runbook is for the first Store production launch at:

- Storefront: `https://shop.dustwave.xyz`
- Worker API: `https://checkout.dustwave.xyz`

Launch can favor the long-term Store shape over compatibility shims. Do not re-enable removed Snipcart or campaign routes to get through smoke testing.

## Preflight

Run from the repository root:

```bash
npm run sync:worker-config
npm run catalog:generate
npm run launch:readiness
bundle exec jekyll build --config _config.yml,_config.local.yml
npm run assets:minify:check
npm run test:unit
```

`npm run launch:readiness` only checks repo-visible launch inputs. It does not prove production secrets, Stripe webhooks, USPS credentials, or R2 objects exist in the external accounts; those remain explicit manual checks below.

For checkout, admin, and Worker changes, also run:

```bash
npm run test:security
CI=1 npx playwright test tests/e2e/admin-dashboard.spec.ts --workers=1
SITE_URL=http://127.0.0.1:4002 WORKER_URL=http://127.0.0.1:8989 ./scripts/test-worker.sh
```

## Cloudflare

Required production resources:

- Worker route or custom domain for `https://checkout.dustwave.xyz`
- KV namespace bound as `STORE_STATE`
- KV namespace bound as `RATELIMIT`
- R2 bucket bound as `STORE_DOWNLOADS`
- Durable Object binding `STORE_INVENTORY_COORDINATOR`
- DNS records for `shop.dustwave.xyz` and `checkout.dustwave.xyz`
- Cron trigger enabled for Store background maintenance

Before deploy:

1. Confirm `worker/wrangler.toml` production bindings point at production resources.
2. Set production Worker secrets with `wrangler secret put`.
3. Keep Cloudflare deploy tokens in GitHub or local operator env only, not Worker runtime config.
4. Deploy Worker:

   ```bash
   npm run deploy:worker
   ```

## Worker Secrets

Production secrets must be configured outside Git:

- `ADMIN_SECRET`
- `ADMIN_SESSION_SECRET`
- `MAGIC_LINK_SECRET`
- `CHECKOUT_INTENT_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `TURNSTILE_SECRET_KEY` when admin Turnstile is required
- `USPS_CLIENT_SECRET` when USPS live quotes are enabled
- `ZIP_TAX_API_KEY` only if the tax provider changes to ZIP.TAX

Recommended dedicated secrets:

- `STORE_DOWNLOAD_SECRET` for signed download/fulfillment links.
- `STORE_ORDER_LOOKUP_SECRET` for customer order lookup tokens.
- `ABANDONED_CART_TOKEN_SECRET` for checkout reminder resume/unsubscribe links.
- `ADMIN_TURNSTILE_SECRET_KEY` if admin Turnstile should not share the global Turnstile secret.
- `STORE_ORDER_TURNSTILE_SECRET_KEY` if order lookup Turnstile should not share the global Turnstile secret.

Production admin publish/rebuild integrations also need `GITHUB_TOKEN` plus the intended `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_REF`, `GITHUB_WORKFLOW`, and optional `GITHUB_MEDIA_OPTIMIZATION_WORKFLOW` runtime values. Set owner/repo/ref explicitly; do not rely on legacy helper fallbacks. Keep GitHub and Cloudflare deploy credentials separate from public `_config.yml`.

Production non-secret config should match the intended launch values:

- `SITE_BASE=https://shop.dustwave.xyz`
- `WORKER_BASE=https://checkout.dustwave.xyz`
- `CORS_ALLOWED_ORIGIN=https://shop.dustwave.xyz`
- `TAX_PROVIDER=nm_grt`
- `SHIPPING_ORIGIN_ZIP=87120`
- `SHIPPING_ORIGIN_COUNTRY=US`
- `USPS_ENABLED=true`

## Stripe

Before launch:

1. Confirm the production publishable key in Store config.
2. Confirm the production secret key is set as a Worker secret.
3. Create the production webhook endpoint for:

   ```text
   https://checkout.dustwave.xyz/webhooks/stripe
   ```

4. Subscribe at least to `payment_intent.succeeded` and `payment_intent.payment_failed`.
5. Set the production webhook signing secret as `STRIPE_WEBHOOK_SECRET`.
6. Run one paid physical, paid digital, and paid ticket checkout in Stripe test mode before switching to live keys.

## Resend

Before launch:

1. Verify sender domains and sender identities.
2. Confirm `ORDERS_EMAIL_FROM` and `UPDATES_EMAIL_FROM` match approved senders.
3. Confirm `RESEND_API_KEY` is set as a Worker secret.
4. Confirm admin magic links and order confirmation emails arrive in inboxes controlled by the team.

## USPS And Tax

Before launch:

1. Confirm `USPS_CLIENT_ID` is configured as non-secret runtime config.
2. Confirm `USPS_CLIENT_SECRET` is set as a Worker secret.
3. Run:

   ```bash
   npm run test:usps
   ```

4. Complete a physical checkout smoke test for a New Mexico address and a non-New Mexico US address.
5. Confirm New Mexico GRT behavior from the production origin address.
6. Keep the flat-rate fallback configured so checkout remains available if USPS is temporarily unavailable.

## Digital Downloads

Before launch:

1. For each active digital product, confirm `_products/*` has a stable `download.file_key`.
2. Upload the real production file to the matching `STORE_DOWNLOADS` object key, or configure a Worker-only `STORE_DOWNLOAD_URL_<KEY>` fallback for externally hosted media.
3. In admin, open **Settings -> Store readiness** and confirm download readiness is ready.
4. Complete a paid digital checkout and confirm the signed download works from `/order-success/`.

Products marked `public: false` and `launch_test: true` are direct-link smoke-test fixtures. They stay out of the public storefront and launch readiness download requirements, but remain available to the Worker/admin catalog for controlled checkout and download replacement tests.

## Admin Launch Checks

Before launch:

1. Review `ADMIN_USERS_JSON` and any runtime admin users stored in KV.
2. Confirm the trusted super admin list. A second super admin is recommended for lockout recovery, but not required before first launch.
3. Confirm limited admins only have the `store` access scope.
4. Open `/admin/` and confirm magic-link sign-in works on the production origin.
5. Open **Settings -> Store readiness** and review secrets, webhook activity, R2 readiness, inventory baselines, cron heartbeat, and catalog snapshot posture.
6. Open **Settings -> Plan usage** and confirm Cloudflare and Resend quota posture is visible, or that missing optional usage credentials are clearly reported.
7. Enter true inventory baselines for finite-stock physical products, or set made-to-order/unlimited products to `inventory_tracking: false`.
8. Create a draft coupon, save it, and delete it.
9. Create a test referral link and confirm QR download/copy actions work.
10. Add and clear an abandoned-checkout suppression address.
11. Export Store orders CSV and confirm it downloads.

When a product has a verified physical inventory count, add `inventory_baseline_source` or `inventory_verified_at` to its product front matter. This lets `npm run launch:readiness` distinguish a true zero-stock baseline from an untouched imported `0`.

Use `inventory_tracking: false` for unlimited or made-to-order products. The Worker will still validate catalog price/status and shipping/tax, but it will not reserve or commit SKU inventory for those items.

## Static Storefront

Before launch:

1. Confirm product cards and product pages render the active catalog.
2. Confirm cart quantity and variant price behavior on at least one variant product.
3. Confirm `/api/products.json` and `/api/add-ons.json` return expected Store payloads.
4. Confirm `/orders/` renders the customer order lookup form.
5. Confirm `/order-success/` is not indexed and is not prefetched.
6. Confirm Terms and policy copy are production-ready.

## Launch Smoke

Run these against production before public announcement:

1. Paid physical checkout with shipping and tax.
2. Paid digital checkout with signed download fulfillment.
3. Paid ticket checkout with QR/check-in action.
4. Free RSVP checkout without Stripe.
5. Admin ticket/RSVP check-in and undo check-in.
6. Admin product edit/publish on a harmless draft product.
7. Admin download replacement on a non-public test product.
8. Coupon application on a harmless test cart.
9. Customer order lookup email/link flow.
10. Abandoned-checkout reminder suppression/resume link behavior in a controlled test.
11. Stripe webhook replay or equivalent test event for paid settlement.

## Rollback

If launch smoke fails before announcement:

1. Stop public traffic by removing the launch link or DNS exposure.
2. Revert the storefront deploy to the last known good GitHub Pages build.
3. Revert Worker to the previous deployed version.
4. If a checkout created bad order state, mark the issue in KV notes or audit logs before deleting anything.
5. If inventory reservations are stuck, inspect the order token first, then release through the Worker-controlled path.
6. Do not rotate customer-facing order/download tokens unless a token leak is confirmed.

## Post-Launch

Within the first 24 hours:

1. Review Stripe payments against Store orders with the admin reconciliation CSV.
2. Review Resend delivery and bounce events.
3. Review admin **Settings -> Store readiness** for webhook activity and cron heartbeat.
4. Review abandoned-checkout and event reminder health after the first scheduled cron windows.
5. Export orders CSV for fulfillment reconciliation.
6. Export audit CSV for admin mutation review.
7. Back up launch notes, configured resource ids, coupon/referral changes, and any manual inventory adjustments using [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

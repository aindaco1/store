# Admin Dashboard

The Store admin dashboard is available at `/admin/` and `/es/admin/`.

## Authentication

Admins sign in by email magic link. The browser receives a `store_admin_session` cookie and a CSRF token. Mutations send `x-store-admin-csrf`.

## Tabs

- Settings: platform config, canonical URLs, checkout, pricing, tax, shipping, design, users, add-ons, Store readiness, Plan usage, performance, debug, secrets, diagnostics.
- Add-ons: platform add-on inventory.
- Orders: fulfillment rows, CSV export, attendee CSV export, attendance summary, ticket/RSVP check-in, and digital download expiry/reissue controls.
- Products: catalog review and product publish.
- Downloads: R2 readiness checks and upload/replacement.
- Inventory: Store inventory overrides and restocks.

## Roles

- `super_admin`: full dashboard access.
- `limited_admin` with `accessScopes: ["store"]`: Store orders, products, downloads, and inventory only.

## Publish Paths

- Settings publish patches `_config.yml` through GitHub and triggers deploy.
- Product publish patches `_products/*.md` through GitHub and triggers deploy.
- Product image uploads write to `assets/images/products/`.
- Download uploads write to the configured `STORE_DOWNLOADS` R2 object.
- Digital download expiry/reissue writes per-order access state to KV and records an audit event.
- Inventory writes persist KV overrides.
- Audit CSV export reads recent `admin-audit:` KV events and does not mutate state.
- Store readiness runs launch/runtime checks and includes order reconciliation CSV export plus super-admin audit CSV export.
- Plan usage shows Cloudflare Workers/KV and Resend quota posture.
- Reconciliation CSV export reads Store order records and flags payment/order amount, currency, and status mismatches.

## Verification

```bash
npx playwright test tests/e2e/admin-dashboard.spec.ts --project=chromium --workers=1
```

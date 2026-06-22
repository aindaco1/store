# Store Cleanup Status

Store started from The Pool's operational baseline, then replaced the public commerce path with product/order/fulfillment concepts.

## Store-Native Pieces

- Product source lives in `_products/`.
- Public product data is generated at `/api/products.json`.
- Worker catalog data is generated into `worker/src/generated/catalog-snapshot.js`.
- Browser checkout posts Store carts to `/api/checkout/intent`.
- Paid orders use Stripe PaymentIntents; free RSVP-style orders confirm without Stripe.
- Confirmed order state uses `store-order:{token}` records in `STORE_STATE`.
- SKU reservations use `StoreInventoryCoordinator`.
- Digital downloads use the `STORE_DOWNLOADS` R2 binding.
- Admin sessions use `store_admin_session`.
- Browser admin CSRF uses `x-store-admin-csrf`.
- Store admin surfaces cover orders, products, downloads, inventory, add-ons, settings, users, and cron/observability.

## Removed Legacy Surface

- Public campaign/community/manage layouts and includes.
- Campaign public JavaScript and CSS partials.
- Empty campaign API compatibility shim.
- Campaign seed/report/projection/smoke scripts.
- Legacy campaign/community/manage Playwright specs.
- Vote/pledge/stats security tests.
- Campaign-runner settings and cron behavior.
- Settlement and vote Worker bindings.

## Status

This file is a historical extraction log. Launch-facing docs now point to Store products, orders, fulfillment, downloads, inventory, and admin operations only.

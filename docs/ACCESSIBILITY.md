# Accessibility

Store accessibility coverage focuses on public product browsing, cart/checkout controls, order success, and the admin dashboard.

## Release v1.0.4 Audit

- Admin async status updates are written as live regions with `role="status"` or `role="alert"`.
- Store Orders rows have mobile/tablet card layouts and responsive action buttons covered by E2E assertions.
- Order Success, product controls, localized public/product routes, admin product editing, download creation, long-content fixtures, and compact tablet tabs are covered by automated checks.
- Public Spanish shells for home, Terms, Orders, and Order Success reuse the same structural layout as the English routes; product/user-generated content remains canonical unless a product provides explicit localized copy.
- iOS Safari auto-link styling is suppressed with `format-detection` metadata and inherited form/button colors so detected addresses, emails, dates, and hamburger controls do not turn blue unexpectedly.
- Manual VoiceOver and NVDA passes remain required before major public releases and checkout/admin workflow changes.

## Covered Surfaces

- Home/product grid.
- Product detail pages.
- Add-to-cart buttons, variant controls, and quantity steppers.
- Cart drawer quantity controls and checkout actions.
- Terms, Orders, and Order Success pages in English and Spanish.
- Admin login.
- Store admin settings, products, coupons, downloads, orders, analytics, marketing, inventory controls, and scoped access.
- Spanish public shells, Spanish product routes, Spanish admin route, and compact tablet tabs.

## Automated Checks

```bash
npm run test:unit
npx playwright test tests/e2e/accessibility-public-pages.spec.ts --project=chromium --workers=1
npx playwright test tests/e2e/public-page-controls.spec.ts --project=chromium --workers=1
npx playwright test tests/e2e/admin-dashboard.spec.ts --project=chromium --workers=1
```

The admin E2E injects axe-core for the signed-in dashboard. Public-page E2E covers home, product detail, Terms, order lookup, Order Success, mobile overflow, keyboard add-to-cart, cart quantity updates, storefront filters, localized public/product routes, and expected product-control behavior. Admin coverage includes product editing, download creation, large/long content fixtures, mobile rows, and compact tablet tabs.

## Admin Smoke Checklist

- Keyboard: sign in, switch tabs, move through settings sections, edit a product, upload/create a download, export CSVs, and return focus to the active control after async actions.
- Screen reader: confirm status updates are announced for settings publish, order check-in/download access, product publish, coupon save, referral save, download upload/delete, and readiness exports.
- Reduced motion: repeat checkout/cart and admin tab flows with `prefers-reduced-motion: reduce`.
- Focus order: verify visible focus moves through tab lists, mobile tab selects, dialogs/tooltips, file pickers, and product editor controls in reading order.
- Mobile overflow: check cart, checkout, English/Spanish order lookup, English/Spanish Order Success, product editor, download rows, order rows, and admin tables at phone and tablet widths.

## Manual Checks

- Keyboard-only add to cart, quantity adjustment, and checkout start.
- VoiceOver/NVDA pass through product title, price, option, quantity, and cart summary.
- Focus order in the cart drawer and admin dashboard.
- Error/status announcements for checkout, order lookup, admin saves, uploads, coupon edits, reminder suppression, and check-in actions.
- Mobile text wrapping in product cards, product pages, buttons, coupon editors, download rows, order rows, and admin tables.

Before major public releases or checkout/admin workflow changes, run one VoiceOver pass on macOS/Safari and one NVDA pass on Windows/Firefox or Edge for the covered surfaces above. Record blockers with the affected route, viewport, assistive technology, browser, and exact control label.

# Accessibility

Store accessibility coverage focuses on public product browsing, cart/checkout controls, order success, and the admin dashboard.

## Covered Surfaces

- Home/product grid.
- Product detail pages.
- Add-to-cart buttons, variant controls, and quantity steppers.
- Cart drawer quantity controls and checkout actions.
- Terms and Order Success pages.
- Admin login.
- Store admin settings, orders, products, downloads, inventory, and scoped access.
- Spanish admin route and compact tablet tabs.

## Automated Checks

```bash
npm run test:unit
npx playwright test tests/e2e/accessibility-public-pages.spec.ts --project=chromium --workers=1
npx playwright test tests/e2e/public-page-controls.spec.ts --project=chromium --workers=1
npx playwright test tests/e2e/admin-dashboard.spec.ts --project=chromium --workers=1
```

The admin E2E injects axe-core for the signed-in dashboard. Public-page E2E covers mobile overflow, keyboard add-to-cart, cart quantity updates, and expected product-control behavior.

## Manual Checks

- Keyboard-only add to cart, quantity adjustment, and checkout start.
- VoiceOver/NVDA pass through product title, price, option, quantity, and cart summary.
- Focus order in the cart drawer and admin dashboard.
- Error/status announcements for checkout, admin saves, uploads, and check-in actions.
- Mobile text wrapping in product cards, product pages, buttons, and admin tables.

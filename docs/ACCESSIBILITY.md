# Accessibility

Store accessibility coverage focuses on public product browsing, cart/checkout controls, order success, and the admin dashboard.

## Current Coverage

- Admin async status updates are written as live regions with `role="status"` or `role="alert"`.
- Store Orders rows have mobile/tablet card layouts and responsive action buttons covered by E2E assertions.
- Order Success, product controls, localized public/product routes, admin product editing, download creation, long-content fixtures, and compact tablet tabs are covered by automated checks.
- Public Spanish shells for home, Terms, Orders, and Order Success reuse the same structural layout as the English routes; product/user-generated content remains canonical unless a product provides explicit localized copy.
- iOS Safari auto-link styling is suppressed with `format-detection` metadata and inherited form/button colors so detected addresses, emails, dates, and hamburger controls do not turn blue unexpectedly.
- `v1.0.6` release evidence keeps the axe, keyboard add-to-cart, focus order, order lookup live status, reduced motion, 200% text scaling, mobile overflow, and optional VoiceOver/Whisper transcript coverage from `v1.0.5`, and covers the super-admin Workers Cache clear status through the admin dashboard E2E path.
- VoiceOver/Whisper transcript evidence can be attached when a release explicitly requires assistive-technology speech evidence.

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

The release E2E path also covers 200% text scaling for public checkout/order surfaces and Store admin Products, Orders, Downloads, and Marketing surfaces, including long product/variant/file/coupon/referral fixtures and tablet/mobile rows. The mounted checkout/payment surface remains in automated axe coverage. This does not replace manual assistive-technology testing, but it catches high-zoom layout regressions in the automated gate.

## Admin Smoke Checklist

- Keyboard: sign in, switch tabs, move through settings sections, edit a product, upload/create a download, export CSVs, and return focus to the active control after async actions.
- Screen reader: confirm status updates are announced for settings publish, order check-in/download access, product publish, coupon save, referral save, download upload/delete, and readiness exports.
- Reduced motion: repeat checkout/cart and admin tab flows with `prefers-reduced-motion: reduce`.
- Focus order: verify visible focus moves through tab lists, mobile tab selects, dialogs/tooltips, file pickers, and product editor controls in reading order.
- Mobile overflow: check cart, checkout, English/Spanish order lookup, English/Spanish Order Success, product editor, download rows, order rows, and admin tables at phone and tablet widths.

## Manual Checks

- Keyboard-only add to cart, quantity adjustment, and checkout start.
- VoiceOver pass through product title, price, option, quantity, and cart summary.
- Focus order in the cart drawer and admin dashboard.
- Error/status announcements for checkout, order lookup, admin saves, uploads, coupon edits, reminder suppression, and check-in actions.
- Mobile text wrapping in product cards, product pages, buttons, coupon editors, download rows, order rows, and admin tables.

When a release explicitly requires assistive-technology speech evidence, run one VoiceOver pass on macOS/Safari for the covered surfaces above. Record blockers with the affected route, viewport, assistive technology, browser, and exact control label.

For focused automated evidence, run `npm run release:a11y-evidence`; `npm run release:smoke -- --evidence-file <path>` records that focused pass or the equivalent passed Podman E2E coverage. The focused release pass covers axe, keyboard add-to-cart, visible focus order, order lookup live status, reduced motion, 200% text scaling, and mobile-overflow checks.

For transcript-assisted screen-reader evidence, run `npm run release:screen-reader-evidence`. By default it reports host capability and whether Whisper is available. Pass `--audio-file <recording>` to transcribe an existing VoiceOver smoke, or use `--record-voiceover` with `VOICEOVER_AUDIO_DEVICE` on macOS when `ffmpeg` can capture system audio. Transcript checks can confirm spoken labels and expected phrases when release scope requires that evidence.

Complete the Accessibility section in [MERGE_SMOKE_CHECKLIST.md](MERGE_SMOKE_CHECKLIST.md). The generated evidence file should link to or summarize keyboard, high-zoom, reduced-motion, and mobile-overflow evidence plus optional VoiceOver/Whisper transcript evidence when collected.

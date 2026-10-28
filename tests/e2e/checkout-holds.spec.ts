import { test, expect } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers/mobile';
import { routeCheckoutHold, gotoCheckoutProduct } from './helpers/checkout';
import { checkAddressConsistency } from '../../worker/src/address-consistency.js';
import { normalizeTaxDestination } from '../../worker/src/tax.js';
import { isValidEmail } from '../../worker/src/validation.js';

test('checkout leaves autofill overlays interactive while locking Store content', async ({ page }) => {
  await routeCheckoutHold(page);
  await page.route('**/api/checkout/release', (route) => route.fulfill({ json: { success: true, phase: 'released' } }));
  await gotoCheckoutProduct(page, '/products/a-night-in-paradiso/');
  // Password managers inject their own UI outside the site's dialog, sometimes
  // before it opens. Exercise real pointer/focus behavior through a shadow root.
  await page.evaluate(() => {
    const host = document.createElement('autofill-fixture');
    host.style.cssText = 'position:fixed;top:100px;left:20px;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.textContent = 'Fill test details';
    button.addEventListener('click', () => {
      const email = document.querySelector<HTMLInputElement>('[data-cart-custom-checkout-email]');
      if (!email) return;
      email.value = 'autofill-test@example.com';
      email.dispatchEvent(new Event('input', { bubbles: true }));
    });
    shadow.append(button);
    document.body.append(host);
  });
  const add = page.locator('.store-add-item').first();
  await add.click();
  const cart = page.locator('[data-store-cart-root]');
  await cart.locator('[data-cart-continue]').click();
  for (const selector of ['.skip-link', '.site-header', '#main-content', '.site-footer', '#aria-live-region']) {
    await expect(page.locator(`body > ${selector}`)).toHaveAttribute('inert', '');
  }
  await expect(page.locator('autofill-fixture')).not.toHaveAttribute('inert');
  await expect(page.locator('autofill-fixture')).not.toHaveAttribute('aria-hidden');
  await page.getByRole('button', { name: 'Fill test details' }).click({ timeout: 3000 });
  await expect(cart.locator('[data-cart-custom-checkout-email]')).toHaveValue('autofill-test@example.com');
  const close = cart.getByRole('button', { name: 'Close cart' });
  await close.focus();
  await close.press('Shift+Tab');
  await expect(cart.locator('[data-cart-back]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await close.press('Escape');
  await expect(cart).toHaveAttribute('aria-hidden', 'true');
  await expect(cart.getByRole('dialog')).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(page.locator('#main-content')).not.toHaveAttribute('inert');
  await expect(page.locator('#main-content')).not.toHaveAttribute('aria-hidden');
});

for (const width of [390, 1280]) {
  test(`${width}px: saving a billing ZIP preserves the next address field and scroll position`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    await routeCheckoutHold(page);
    let releaseInventory!: () => void;
    const inventoryReady = new Promise<void>((resolve) => { releaseInventory = resolve; });
    await page.route('**/add-ons/inventory', async (route) => {
      await inventoryReady;
      await route.fulfill({ json: { products: {}, lowStockThreshold: 3 } });
    });
    await gotoCheckoutProduct(page, '/products/a-night-in-paradiso/');
    await page.locator('.store-add-item').first().click();
    const cart = page.locator('[data-store-cart-root]');
    await cart.locator('[data-cart-continue]').click();
    const postal = cart.locator('[data-cart-tax-destination-field="postal_code"]');
    const street = cart.locator('[data-cart-tax-destination-field="line1"]');
    await postal.fill('87102');
    await postal.press('Tab');
    await expect(street).toBeFocused();
    await street.fill('708 First Street');
    const body = cart.locator('.store-first-party-cart__body');
    const scrollTop = await body.evaluate((node) => node.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
    // The ZIP save is debounced; users may already be typing in the next field.
    await expect.poll(() => page.evaluate(() => (window as any).StoreCartProvider.store.getState().cart.billingAddress.postal_code)).toBe('87102');
    await expect(street).toHaveValue('708 First Street');
    await expect(street).toBeFocused();
    expect(await body.evaluate((node) => node.scrollTop)).toBeCloseTo(scrollTop, 0);
    await expect(cart.locator('[data-cart-tax-destination-field="city"]')).toBeVisible();
    // A cart-only request may finish after the shopper has entered checkout.
    releaseInventory();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('store_add_on_inventory'))).not.toBeNull();
    await expect(street).toHaveValue('708 First Street');
    await expect(street).toBeFocused();
    expect(await body.evaluate((node) => node.scrollTop)).toBeCloseTo(scrollTop, 0);
    await street.press('Tab');
    const secondLine = cart.locator('[data-cart-tax-destination-field="line2"]');
    await secondLine.fill('Suite 2');
    await expect.poll(() => page.evaluate(() => (window as any).StoreCartProvider.store.getState().cart.billingAddress.line1)).toBe('708 First Street');
    await expect(secondLine).toHaveValue('Suite 2');
    await expect(secondLine).toBeFocused();
  });
}

// Provider-free browser characterization; real serialized inventory transitions
// and Stripe failure boundaries are exercised by checkout-holds.test.ts.
for (const lang of ['en', 'es']) {
  test(`${lang}: mobile hold, extension, expiry recovery and checkout clarity`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: lang === 'en' ? 320 : 390, height: 844 });
    let attempts: string[] = []; let phase = 'held'; let nearExpiry = false;
    await page.route('**/api/checkout/*', async (route) => {
      const body = route.request().postDataJSON();
      const action = new URL(route.request().url()).pathname.split('/').pop();
      if (action === 'hold') { attempts.push(body.attemptId); phase = 'held'; }
      if (action === 'extend') nearExpiry = false;
      if (action === 'release') phase = 'released';
      await route.fulfill({ json: { success: true, attemptId: body.attemptId, phase, heldQuantity: 1, extensionsRemaining: 9,
        serverTime: new Date().toISOString(), expiresAt: new Date(Date.now() + (nearExpiry ? 90000 : 600000)).toISOString(),
        items: [{ productId: 'a-night-in-paradiso', eventDetails: { starts_at: '2026-10-24T19:00:00-06:00', venue: 'The Cell Theatre at FUSION', address: '708 1st St NW, Albuquerque, NM' } }] } });
    });
    await gotoCheckoutProduct(page, `${lang === 'es' ? '/es' : ''}/products/a-night-in-paradiso/`);
    await page.locator('.store-add-item').first().click();
    const cart = page.locator('[data-store-cart-root]');
    await expect(cart.locator('[data-cart-tip]')).toHaveValue('5');
    await expect(cart.locator('[data-cart-item-quantity]')).not.toHaveAttribute('aria-label', /%\{/);
    await cart.locator('[data-cart-continue]').click();
    await expect(cart.locator('[data-cart-hold]')).toBeVisible();
    await expect(cart.locator('[data-cart-hold]')).toHaveAttribute('data-state', 'active');
    await expect(cart.locator('#store-first-party-cart-title')).toHaveText(lang === 'es' ? 'Pagar' : 'Checkout');
    await expect(cart.locator('[data-cart-custom-checkout-region="payment"]')).toHaveCount(0);
    await expect(cart.locator('[data-cart-custom-checkout-email]')).toHaveCount(1);
    await expect(cart).toContainText('The Cell Theatre at FUSION');
    await expect(cart.locator('[data-cart-tax-destination-field="line1"]')).toBeHidden();
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').fill('87102');
    await expect(cart.locator('[data-cart-tax-destination-field="line1"]')).toBeVisible();
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').fill('10001');
    await expect(cart.locator('[data-cart-tax-destination-field="line1"]')).toBeVisible();
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').press('Tab');
    await expect(cart.locator('[data-cart-tax-destination-field="postal_code"]')).toHaveValue('10001');
    await expect.poll(() => page.evaluate(() => (window as any).StoreCartProvider.store.getState().cart.billingAddress.postal_code)).toBe('10001');
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').fill('');
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').press('Tab');
    await expect(cart.locator('[data-cart-tax-destination-field="postal_code"]')).toHaveValue('');
    await expect.poll(() => page.evaluate(() => (window as any).StoreCartProvider.store.getState().cart.billingAddress.postal_code)).toBe('');
    await expect(cart.locator('[data-cart-start-checkout]')).toBeDisabled();
    await expectNoHorizontalOverflow(page);
    nearExpiry = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(cart.locator('[data-cart-hold-extend]')).toBeVisible();
    await expect(cart.locator('[data-cart-hold]')).toHaveAttribute('data-state', 'warning');
    await cart.locator('[data-cart-hold-extend]').click();
    await expect(cart.locator('[data-cart-hold-extend]')).toBeHidden();
    await cart.locator('[data-cart-custom-checkout-email]').fill('not-an-email');
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').fill('10001');
    await expect(cart.locator('[data-cart-start-checkout]')).toBeDisabled();
    await expect(cart.locator('.store-first-party-cart__readiness')).toHaveCount(0);
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').fill('');
    await cart.locator('[data-cart-custom-checkout-email]').fill('checkout-test@example.com');
    await cart.locator('[data-cart-custom-checkout-email]').blur();
    await expect(cart.locator('[data-cart-start-checkout]')).toBeDisabled();
    await cart.locator('[data-cart-hold]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('details-ready-mobile.png'), animations: 'disabled' });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalOverflow(page);
    await page.addStyleTag({ content: 'html { font-size: 100% !important; }' });
    phase = 'expired';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(cart.locator('[data-cart-hold-retry]')).toBeVisible();
    await expect(cart.locator('[data-cart-hold-clock]')).toBeHidden();
    await expect(cart.locator('[data-cart-start-checkout]')).toBeDisabled();
    await cart.locator('[data-cart-hold-retry]').click();
    await expect.poll(() => attempts.length).toBe(2);
    expect(attempts[1]).not.toBe(attempts[0]);
    await expect(cart.locator('[data-cart-custom-checkout-email]')).toHaveValue('checkout-test@example.com');
    await expect(cart.locator('[data-cart-hold-retry]')).toBeHidden();
    await cart.locator('[data-cart-back]').click();
    await expect(cart.locator('[data-cart-tip]')).toHaveValue('5');
    await expectNoHorizontalOverflow(page);
  });
}

for (const { physical, failFirstMount, failPreparation, editDuringPreparation, editAfterPreparation, failCancellation, editBillingZip, estimateFallback, delayedFields, slowEstimates, width } of [
  { physical: false, failFirstMount: false, width: 320 },
  { physical: true, failFirstMount: false, width: 390 },
  { physical: false, failFirstMount: false, width: 768 },
  { physical: false, failFirstMount: true, width: 1280 },
  { physical: false, failFirstMount: false, failPreparation: true, width: 390 },
  { physical: true, editDuringPreparation: true, editAfterPreparation: true, width: 1280 },
  { physical: false, editDuringPreparation: true, editAfterPreparation: true, width: 390 },
  { physical: false, editAfterPreparation: true, failCancellation: true, width: 1280 },
  { physical: false, editBillingZip: 'NM', width: 390 },
  { physical: false, editBillingZip: 'New Mexico', width: 1280 },
  { physical: false, editBillingZip: 'NM', estimateFallback: true, width: 320 },
  { physical: false, delayedFields: true, width: 390 },
  { physical: false, slowEstimates: 'initial', width: 390 },
  { physical: false, editBillingZip: 'NM', slowEstimates: 'edit', width: 390 }
]) {
test(`${physical ? 'Physical' : 'Ticket'} ${width}px${slowEstimates ? ` with slow ${slowEstimates} estimates` : delayedFields ? ' with delayed fields' : editBillingZip ? ' with ZIP correction' : failFirstMount ? ' with terminal mount recovery' : failPreparation ? ' with network recovery' : failCancellation ? ' with uncertain cancellation' : editDuringPreparation ? ' with edited details' : ''}: automatic payment uses saved details and safe retries`, async ({ page }, testInfo) => {
  let creations = 0; let confirms = 0;
  let succeed = false;
  let finishPreparation!: () => void;
  const preparation = new Promise<void>((resolve) => { finishPreparation = resolve; });
  let releasedAttempt = ''; const mounts: string[] = []; const canceledSecrets = new Set<string>();
  let lastConfirm: any;
  let submittedDetails: any;
  let refuseCancellation = Boolean(failCancellation);
  let updatedPayment = false;
  const quotedPostals: string[] = [];
  const invalidDestinations: string[] = [];
  const initialCreations = failFirstMount || failPreparation || editDuringPreparation ? 2 : 1;
  const editedZip = estimateFallback ? '80205' : '10467';
  const editedTax = estimateFallback ? 58 : 178;
  const editedTotal = estimateFallback ? '$21.58' : '$22.78';
  let releaseEstimates!: () => void;
  const estimates = new Promise<void>(resolve => { releaseEstimates = resolve; });
  await page.setViewportSize({ width, height: 844 });
  if (width === 768) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.exposeFunction('recordFixtureConfirm', (params: any) => {
    confirms++; lastConfirm = params;
    return succeed ? { paymentIntent: { status: 'succeeded' } } : { error: { message: 'Fixture card declined' } };
  });
  await page.exposeFunction('recordFixtureMount', (secret: string) => {
    mounts.push(secret);
    return canceledSecrets.has(secret) || (failFirstMount && secret === 'pi_browser_fixture_1_secret');
  });
  await page.addInitScript(() => {
    (window as any).__stripeConstructions = 0;
    (window as any).__stripeElementCreations = 0;
    (window as any).Stripe = () => {
      (window as any).__stripeConstructions++;
      return {
      elements: ({ clientSecret }: any) => ({ create: () => {
        (window as any).__stripeElementCreations++;
        const handlers: Record<string, Function> = {};
        return { on: (event: string, callback: Function) => { handlers[event] = callback; },
          mount: (node: HTMLElement) => {
            (window as any).recordFixtureMount(clientSecret).then((terminal: boolean) => {
              const render = () => {
                node.innerHTML = '<div style="min-height: 320px">Fixture payment element</div>';
                if (terminal) handlers.loaderror?.({ error: { message: 'This PaymentIntent is in a terminal state' } });
                else { handlers.ready?.(); handlers.change?.({ complete: true }); }
              };
              (window as any).__renderPaymentFields = render;
              if (!(window as any).__delayPaymentFields) render();
            });
          }, unmount: () => {} };
      } }),
      confirmPayment: (params: any) => (window as any).recordFixtureConfirm(params)
    }; };
  });
  await page.route('**/address/check', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { billing: checkAddressConsistency(body.billing), shipping: checkAddressConsistency(body.shipping) } });
  });
  await page.route('**/tax/quote', async (route) => {
    const body = route.request().postDataJSON();
    const normalized = normalizeTaxDestination(body.billingAddress || body.shippingAddress);
    if (!normalized.valid) {
      invalidDestinations.push(normalized.error);
      await route.fulfill({ status: 400, json: { error: normalized.error } });
      return;
    }
    quotedPostals.push(normalized.destination!.postalCode);
    const edited = editBillingZip && normalized.destination!.postalCode === editedZip;
    if (slowEstimates === 'initial' || (slowEstimates === 'edit' && edited)) await estimates;
    await route.fulfill({ json: { taxCents: slowEstimates ? 0 : edited ? editedTax : updatedPayment ? 253 : 153,
      taxDetails: { effectiveRate: edited ? (estimateFallback ? 0.029 : 0.08875) : 0.0765,
        estimated: Boolean(edited), coverage: edited ? (estimateFallback ? 'state_only' : 'zip_local') : null,
        destination: normalized.destination } } });
  });
  await page.route('**/shipping/quote', (route) => route.fulfill({ json: { shippingCents: 300, source: 'manual' } }));
  await page.route('**/api/checkout/*', async (route) => {
    const action = new URL(route.request().url()).pathname.split('/').pop();
    const attempt = route.request().postDataJSON().attemptId;
    if (action === 'release' && refuseCancellation) {
      await route.fulfill({ status: 409, json: { success: false, code: 'payment_resolving' } });
      return;
    }
    if (action === 'release') { releasedAttempt = attempt; canceledSecrets.add(`pi_browser_fixture_${creations}_secret`); }
    const base = { success: true, phase: attempt === releasedAttempt ? 'released' : action === 'hold' ? 'held' : 'payment', heldQuantity: physical ? 0 : 1, extensionsRemaining: 10,
      serverTime: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() };
    if (action === 'intent') {
      creations++;
      submittedDetails = route.request().postDataJSON();
      if (!isValidEmail(submittedDetails.customer.email)) {
        await route.fulfill({ status: 400, json: { error: 'Invalid email format' } });
        return;
      }
      const normalized = normalizeTaxDestination(submittedDetails.billingAddress || submittedDetails.shippingAddress);
      if (!normalized.valid) {
        invalidDestinations.push(normalized.error);
        await route.fulfill({ status: 400, json: { error: normalized.error } });
        return;
      }
      if (creations === 1) await preparation;
      if (failPreparation && creations === 1) {
        await route.fulfill({ status: 503, json: { error: 'Payment service unavailable. Please retry.' } });
        return;
      }
    }
    const zipEdited = editBillingZip && submittedDetails?.billingAddress?.postalCode === editedZip;
    const canonicalTax = zipEdited ? editedTax : updatedPayment ? 253 : 153;
    await route.fulfill({ json: action === 'intent' ? { ...base, checkoutUiMode: 'payment_intent', requiresPayment: true,
      paymentIntentId: `pi_browser_fixture_${creations}`, clientSecret: `pi_browser_fixture_${creations}_secret`, publishableKey: 'pk_test_fixture', orderToken: 'store-order-browser-fixture', totals: { taxCents: canonicalTax, shippingCents: physical ? 300 : 0, totalCents: (physical ? 3450 : 2100) + canonicalTax },
      orderDraft: { taxDetails: { effectiveRate: zipEdited ? (estimateFallback ? 0.029 : 0.08875) : 0.0765,
        estimated: Boolean(zipEdited), coverage: zipEdited ? (estimateFallback ? 'state_only' : 'zip_local') : null } } } : base });
  });
  await gotoCheckoutProduct(page, physical ? '/products/fronteras-t-shirt/' : '/products/a-night-in-paradiso/');
  expect(await page.evaluate(() => (window as any).__stripeConstructions)).toBe(0);
  await page.evaluate(delayed => {
    (window as any).STORE_CONFIG.stripePublishableKey = 'pk_test_fixture';
    (window as any).__delayPaymentFields = delayed;
  }, Boolean(delayedFields));
  await page.locator('.store-add-item').first().click();
  await expect.poll(() => page.evaluate(() => (window as any).__stripeConstructions)).toBe(1);
  expect(creations).toBe(0);
  expect(mounts).toHaveLength(0);
  const cart = page.locator('[data-store-cart-root]');
  await cart.locator('[data-cart-continue]').click();
  await cart.locator('[data-cart-custom-checkout-email]').fill('checkout-test@example.com');
  const body = cart.locator('.store-first-party-cart__body');
  let detailsScrollTop = 0;
  if (physical) {
    for (const [field, value] of Object.entries({ name: 'Checkout Test', line1: '123 Test Street', city: 'New York', state: 'NY', postal_code: '10001' })) {
      await cart.locator(`[data-cart-custom-shipping-field="${field}"]`).fill(value);
    }
    detailsScrollTop = await body.evaluate((node) => node.scrollTop);
    expect(detailsScrollTop).toBeGreaterThan(0);
    await cart.locator('[data-cart-custom-shipping-field="postal_code"]').blur();
  } else {
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').fill(editBillingZip ? '87048' : editDuringPreparation ? '87102' : '10001');
    if (editDuringPreparation || editBillingZip) {
      for (const [field, value] of Object.entries({ line1: '708 First Street', city: 'Albuquerque', state: editBillingZip || 'NM' })) {
        await cart.locator(`[data-cart-tax-destination-field="${field}"]`).fill(value);
      }
    }
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').blur();
  }
  // No intermediate Continue action: the final field automatically loads payment.
  await expect.poll(() => creations).toBe(1);
  if (physical) expect(await body.evaluate((node) => node.scrollTop)).toBeCloseTo(detailsScrollTop, 0);
  await expect(cart.locator('[data-cart-custom-checkout-email]')).toBeEnabled();
  await expect(cart.locator('[data-cart-back]')).toBeDisabled();
  await expect(cart.locator('button[data-cart-close]')).toBeDisabled();
  await expect(cart.locator('[data-cart-start-checkout]')).toHaveText('Loading secure payment...');
  await page.keyboard.press('Escape');
  await expect(cart).toBeVisible();
  expect(releasedAttempt).toBe('');
  expect(submittedDetails.customer.email).toBe('checkout-test@example.com');
  const focusedField = cart.locator(physical ? '[data-cart-custom-shipping-field="postal_code"]' : '[data-cart-tax-destination-field="postal_code"]');
  if (editDuringPreparation) {
    // Editing while the first response is delayed must keep typing available,
    // discard that stale payment safely, and prepare from the latest details.
    await cart.locator('[data-cart-custom-checkout-email]').fill('edited@example.com');
    await cart.locator(physical ? '[data-cart-custom-shipping-field="line2"]' : '[data-cart-tax-destination-field="line2"]').fill('Suite 4');
  }
  await focusedField.focus();
  detailsScrollTop = await body.evaluate((node) => node.scrollTop);
  const originalField = await focusedField.elementHandle();
  const pageScrollBeforePayment = await page.evaluate(() => window.scrollY);
  finishPreparation();
  if (slowEstimates === 'initial') {
    await expect.poll(() => mounts.length).toBe(1);
    await expect(cart.locator('[data-cart-custom-checkout-region="payment"]')).toContainText('Fixture payment element');
    await expect(cart.locator('[data-cart-confirm-custom-checkout]')).toBeDisabled();
    releaseEstimates();
  }
  if (delayedFields) {
    await expect.poll(() => mounts.length).toBe(1);
    await page.evaluate(async () => { await (window as any).StoreCartProvider.getApi().api.cart.update({}); });
    await expect(cart.locator('[data-cart-confirm-custom-checkout]')).toBeDisabled();
    expect(await page.evaluate(() => (window as any).__stripeElementCreations)).toBe(1);
    expect(mounts).toHaveLength(1);
    await page.evaluate(() => {
      (window as any).__delayPaymentFields = false;
      (window as any).__renderPaymentFields();
    });
  }
  if (failPreparation) {
    await expect(cart.locator('[data-cart-checkout-error]')).toHaveText('Payment service unavailable. Please retry.');
    await expect(cart.locator('[data-cart-custom-checkout-email]')).toBeEnabled();
    await expect(cart.locator('[data-cart-back]')).toBeEnabled();
    await page.waitForTimeout(500); // A failed automatic attempt must not loop.
    expect(creations).toBe(1);
    await cart.getByRole('button', { name: 'Retry loading payment' }).click();
  }
  if (failFirstMount) {
    await expect(cart.locator('[data-cart-hold-retry]')).toBeVisible();
    await expect(cart.locator('[data-cart-checkout-error]')).toHaveText('Secure payment could not load. Your hold ended. Check availability to continue.');
    await expect(cart.locator('[data-cart-custom-checkout-region="payment"]')).toHaveCount(0);
    expect(creations).toBe(1);
    await cart.locator('[data-cart-hold-retry]').click();
  }
  await expect(cart.locator('#store-first-party-cart-title')).toHaveText('Checkout');
  await expect(cart.locator('[data-cart-custom-checkout-email]')).toHaveValue(editDuringPreparation ? 'edited@example.com' : 'checkout-test@example.com');
  await expect(cart.locator('[data-cart-custom-checkout-email]')).toBeEnabled();
  await expect(cart.locator('[data-cart-custom-checkout-region="payment"]')).toContainText('Fixture payment element');
  const pay = cart.locator('[data-cart-confirm-custom-checkout]');
  await expect(pay).toHaveText(physical ? 'Pay $36.03' : 'Pay $22.53');
  await expect(cart.locator('[data-cart-checkout-summary-total]')).toHaveText(physical ? '$36.03' : '$22.53');
  await expect(pay).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__stripeConstructions)).toBe(1);
  if (!failFirstMount && !failPreparation) await expect(focusedField).toBeFocused();
  expect(await originalField!.evaluate((field) => field.isConnected)).toBe(true);
  expect(await cart.locator('[data-cart-payment-slot]').evaluate((slot) => {
    const fields = [...slot.parentElement!.querySelectorAll('input, select, textarea')];
    return fields.every((field) => Boolean(field.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  // Once Stripe is ready, the drawer brings its fields into view without
  // scrolling the underlying page or replacing/focusing away from the address.
  await expect.poll(() => cart.locator('[data-cart-custom-checkout-region="payment"]').evaluate((payment) => {
    const viewport = payment.closest('.store-first-party-cart__body')!.getBoundingClientRect();
    const rect = payment.getBoundingClientRect();
    return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
  })).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBeforePayment);
  expect(creations).toBe(initialCreations);
  expect(confirms).toBe(0);
  if (editDuringPreparation) {
    expect(canceledSecrets.has('pi_browser_fixture_1_secret')).toBe(true);
    expect(mounts).not.toContain('pi_browser_fixture_1_secret');
    expect(submittedDetails.customer.email).toBe('edited@example.com');
    expect((physical ? submittedDetails.shippingAddress : submittedDetails.billingAddress).line2).toBe('Suite 4');
  }
  if (physical) {
    await expect(cart.locator('[data-cart-custom-shipping-field="line1"]')).toHaveValue('123 Test Street');
    await expect(cart.locator('[data-cart-custom-shipping-field="line1"]')).toBeEnabled();
  }
  await expectNoHorizontalOverflow(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expectNoHorizontalOverflow(page);
  await page.addStyleTag({ content: 'html { font-size: 100% !important; }' });
  await page.screenshot({ path: testInfo.outputPath('payment.png'), animations: 'disabled' });
  await pay.click();
  await expect(cart.locator('[data-cart-checkout-error]')).toHaveText('Fixture card declined');
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect.poll(() => confirms).toBe(2);
  expect(creations).toBe(initialCreations);
  expect(lastConfirm.confirmParams.payment_method_data.billing_details.email).toBe(editDuringPreparation ? 'edited@example.com' : 'checkout-test@example.com');
  if (physical) expect(lastConfirm.confirmParams.payment_method_data.billing_details.address.line1).toBe('123 Test Street');
  if (editAfterPreparation) {
    const email = cart.locator('[data-cart-custom-checkout-email]');
    await email.fill('');
    await expect(pay).toBeDisabled();
    await expect(cart.locator('[data-cart-payment-slot]')).toBeHidden();
    if (failCancellation) {
      await expect(cart.locator('[data-cart-checkout-error]')).toHaveText('We are checking your payment. Do not pay again.');
      // Even reverting the edit cannot revive a payment whose cancellation is uncertain.
      await email.fill('checkout-test@example.com');
      await page.waitForTimeout(500);
      expect(creations).toBe(initialCreations);
      await expect(pay).toBeDisabled();
      refuseCancellation = false; // Back retries cancellation of the original intent.
    } else {
      await expect.poll(() => canceledSecrets.has(`pi_browser_fixture_${initialCreations}_secret`)).toBe(true);
      await page.waitForTimeout(500); // Incomplete details must not start a payment.
      expect(creations).toBe(initialCreations);
      // Keep the email visible without sitting at the scroll limit, which
      // browsers naturally clamp when the footer's validation hint disappears.
      await body.evaluate((node) => { node.scrollTop = 100; });
      const emailScrollTop = await body.evaluate((node) => node.scrollTop);
      for (const incomplete of ['updated@', 'updated@example', 'updated@example.', `${'a'.repeat(243)}@example.com`]) {
        await email.fill(incomplete);
        await page.waitForTimeout(700); // Pause mid-edit beyond the automatic preparation debounce.
        expect(creations).toBe(initialCreations);
        await expect(cart.locator('[data-cart-checkout-action]')).toBeDisabled();
        await expect(cart.locator('[data-cart-checkout-error]')).toBeHidden();
        await expect(email).toBeFocused();
        expect(await body.evaluate((node) => node.scrollTop)).toBeCloseTo(emailScrollTop, 0);
      }
      updatedPayment = true;
      await email.fill('updated@example.com');
      await expect(pay).toBeEnabled();
      await expect(email).toBeFocused();
      await expect(cart.locator('[data-cart-checkout-error]')).toBeHidden();
      expect(await body.evaluate((node) => node.scrollTop)).toBeCloseTo(emailScrollTop, 0);
      expect(await originalField!.evaluate((field) => field.isConnected)).toBe(true);
      expect(creations).toBe(initialCreations + 1);
      expect(submittedDetails.customer.email).toBe('updated@example.com');
      await expect(pay).toHaveText(physical ? 'Pay $37.03' : 'Pay $23.53');
      await expect(cart.locator('[data-cart-checkout-summary-total]')).toHaveText(physical ? '$37.03' : '$23.53');
      expect(canceledSecrets.has(mounts.at(-1)!)).toBe(false);
    }
  }
  if (editBillingZip) {
    const street = cart.locator('[data-cart-tax-destination-field="line1"]');
    const originalStreet = await street.elementHandle();
    for (const partial of ['', '1', '1046x', '10467-']) {
      await focusedField.fill(partial);
      await page.waitForTimeout(700); // Longer than draft-save and automatic-payment debounces.
      expect(invalidDestinations).toEqual([]);
      expect(creations).toBe(initialCreations);
      await expect(cart.locator('[data-cart-checkout-action]')).toBeDisabled();
      await expect(street).toBeVisible();
      await expect(street).toHaveValue('708 First Street');
      await expect(focusedField).toBeFocused();
    }
    await focusedField.fill(editedZip);
    const zipScrollTop = await body.evaluate((node) => node.scrollTop);
    const feedback = cart.locator('[data-cart-address-feedback="billing"]');
    await expect(feedback.locator('[data-cart-state-conflict]')).toContainText(`belongs to ${estimateFallback ? 'CO' : 'NY'}`);
    await expect(cart.locator('[data-cart-checkout-action]')).toBeDisabled();
    expect(creations).toBe(initialCreations);
    await expect(focusedField).toBeFocused();
    expect(await body.evaluate((node) => node.scrollTop)).toBeCloseTo(zipScrollTop, 0);
    const stateField = cart.locator('[data-cart-tax-destination-field="state"]');
    await stateField.fill(estimateFallback ? 'Colorado' : 'New York');
    const correctedScrollTop = await body.evaluate((node) => node.scrollTop);
    await expect(feedback.locator('[data-cart-state-conflict]')).toBeHidden();
    await expect(feedback.locator('[data-cart-city-suggestion]')).toContainText(estimateFallback ? 'Denver' : 'Bronx');
    if (slowEstimates === 'edit') {
      await expect.poll(() => mounts.length).toBe(initialCreations + 1);
      await expect(cart.locator('[data-cart-custom-checkout-region="payment"]')).toContainText('Fixture payment element');
      await expect(pay).toBeDisabled();
      releaseEstimates();
    }
    // Keeping an alternate city is allowed; state correction alone unblocks Pay.
    await expect(pay).toHaveText(`Pay ${editedTotal}`);
    await expect(pay).toBeEnabled();
    await expect(cart.locator('[data-cart-checkout-summary-tax]')).toHaveText(estimateFallback ? '$0.58' : '$1.78');
    await expect(cart.locator('[data-cart-checkout-summary-tax-label]')).toHaveText(estimateFallback
      ? 'Estimated tax (2.9%; local taxes may be missing)' : 'Estimated tax (8.875%)');
    await expect(cart.locator('[data-cart-checkout-summary-total]')).toHaveText(editedTotal);
    expect(quotedPostals).toContain(editedZip);
    expect(submittedDetails.billingAddress.postalCode).toBe(editedZip);
    await expectNoHorizontalOverflow(page);
    expect(creations).toBe(initialCreations + 1);
    expect(canceledSecrets.has('pi_browser_fixture_1_secret')).toBe(true);
    expect(await originalStreet!.evaluate((field) => field.isConnected)).toBe(true);
    await expect(street).toBeVisible();
    await expect(stateField).toBeFocused();
    expect(await body.evaluate((node) => node.scrollTop)).toBeCloseTo(correctedScrollTop, 0);
    expect(invalidDestinations).toEqual([]);
  }
  if (editDuringPreparation) {
    // Clear and retype a required street after payment is ready, for both
    // shipping and NM billing addresses. No replacement may start mid-edit.
    const street = cart.locator(physical ? '[data-cart-custom-shipping-field="line1"]' : '[data-cart-tax-destination-field="line1"]');
    const originalStreet = await street.elementHandle();
    const creationsBeforeAddressEdit = creations;
    await street.fill('');
    await page.waitForTimeout(700);
    await expect(cart.locator('[data-cart-checkout-action]')).toBeDisabled();
    await expect(cart.locator('[data-cart-payment-slot]')).toBeHidden();
    expect(creations).toBe(creationsBeforeAddressEdit);
    await expect(street).toBeVisible();
    await expect(street).toBeFocused();
    await street.fill('456 Updated Street');
    await expect(pay).toBeEnabled();
    expect(creations).toBe(creationsBeforeAddressEdit + 1);
    expect(canceledSecrets.has(`pi_browser_fixture_${creationsBeforeAddressEdit}_secret`)).toBe(true);
    expect((physical ? submittedDetails.shippingAddress : submittedDetails.billingAddress).line1).toBe('456 Updated Street');
    expect(await originalStreet!.evaluate((field) => field.isConnected)).toBe(true);
    await expect(street).toHaveValue('456 Updated Street');
    await expect(street).toBeFocused();
    await expect(cart.locator('[data-cart-checkout-error]')).toBeHidden();
  }
  const creationsBeforeBack = creations;
  const mountedBeforeBack = mounts.length;
  await cart.locator('[data-cart-back]').click();
  await expect(cart.locator('[data-cart-continue]')).toBeVisible();
  expect(mounts).toHaveLength(mountedBeforeBack);
  await cart.locator('[data-cart-continue]').click();
  await expect(pay).toBeEnabled();
  if (editBillingZip) await expect(cart.locator('[data-cart-tax-destination-field="line1"]')).toBeVisible();
  expect(creations).toBe(creationsBeforeBack + 1);
  expect(mounts.length).toBeGreaterThan(mountedBeforeBack);
  expect(mounts.slice(mountedBeforeBack).every((secret) => secret === `pi_browser_fixture_${creations}_secret`)).toBe(true);
  expect(canceledSecrets.has(mounts.at(-1)!)).toBe(false);
  // Successful confirmation redirects once and clears the basket. The real
  // signed-webhook settlement is covered by the Worker/provider smoke matrix.
  await page.route('**/order-success/?orderToken=*', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Order received</h1>' }));
  succeed = true;
  await pay.click();
  await expect(page).toHaveURL(/\/order-success\/\?orderToken=store-order-browser-fixture/);
  expect(confirms).toBe(3);
  if (editDuringPreparation) expect(lastConfirm.confirmParams.payment_method_data.billing_details.address.line1).toBe('456 Updated Street');
  expect(await page.evaluate(() => localStorage.getItem('store_checkout_attempt_v1'))).toBeNull();
});
}

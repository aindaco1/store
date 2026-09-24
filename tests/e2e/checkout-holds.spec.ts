import { test, expect } from '@playwright/test';
import { gotoDomReady } from './helpers/navigation';
import { expectNoHorizontalOverflow } from './helpers/mobile';

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
    await gotoDomReady(page, `${lang === 'es' ? '/es' : ''}/products/a-night-in-paradiso/`);
    await page.locator('.store-add-item').first().click();
    const cart = page.locator('[data-store-cart-root]');
    await expect(cart.locator('[data-cart-tip]')).toHaveValue('5');
    await expect(cart.locator('[data-cart-item-quantity]')).not.toHaveAttribute('aria-label', /%\{/);
    await cart.locator('[data-cart-continue]').click();
    await expect(cart.locator('[data-cart-hold]')).toBeVisible();
    await expect(cart.locator('[data-cart-hold]')).toHaveAttribute('data-state', 'active');
    await expect(cart.locator('#store-first-party-cart-title')).toHaveText(lang === 'es' ? 'Tus datos' : 'Your details');
    await expect(cart.locator('[data-cart-custom-checkout-region="payment"]')).toHaveCount(0);
    await expect(cart.locator('[data-cart-custom-checkout-email]')).toHaveCount(1);
    await expect(cart).toContainText('The Cell Theatre at FUSION');
    await expect(cart.locator('[data-cart-tax-destination-field="line1"]')).toBeHidden();
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').fill('87102');
    await expect(cart.locator('[data-cart-tax-destination-field="line1"]')).toBeVisible();
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').fill('10001');
    await expect(cart.locator('[data-cart-tax-destination-field="line1"]')).toBeHidden();
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').press('Tab');
    await expect(cart.locator('[data-cart-tax-destination-field="postal_code"]')).toHaveAttribute('value', '10001');
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').fill('');
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').press('Tab');
    await expect(cart.locator('[data-cart-tax-destination-field="postal_code"]')).toHaveAttribute('value', '');
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

for (const { physical, failFirstMount, failPreparation, width } of [
  { physical: false, failFirstMount: false, width: 320 },
  { physical: true, failFirstMount: false, width: 390 },
  { physical: false, failFirstMount: false, width: 768 },
  { physical: false, failFirstMount: true, width: 1280 },
  { physical: false, failFirstMount: false, failPreparation: true, width: 390 }
]) {
test(`${physical ? 'Physical' : 'Ticket'} ${width}px${failFirstMount ? ' with terminal mount recovery' : failPreparation ? ' with network recovery' : ''}: automatic payment uses saved details and safe retries`, async ({ page }, testInfo) => {
  let creations = 0; let confirms = 0;
  let succeed = false;
  let finishPreparation!: () => void;
  const preparation = new Promise<void>((resolve) => { finishPreparation = resolve; });
  let releasedAttempt = ''; const mounts: string[] = []; const canceledSecrets = new Set<string>();
  let lastConfirm: any;
  let submittedDetails: any;
  await page.setViewportSize({ width, height: 844 });
  await page.exposeFunction('recordFixtureConfirm', (params: any) => {
    confirms++; lastConfirm = params;
    return succeed ? { paymentIntent: { status: 'succeeded' } } : { error: { message: 'Fixture card declined' } };
  });
  await page.exposeFunction('recordFixtureMount', (secret: string) => {
    mounts.push(secret);
    return canceledSecrets.has(secret) || (failFirstMount && secret === 'pi_browser_fixture_1_secret');
  });
  await page.addInitScript(() => {
    (window as any).Stripe = () => ({
      elements: ({ clientSecret }: any) => ({ create: () => {
        const handlers: Record<string, Function> = {};
        return { on: (event: string, callback: Function) => { handlers[event] = callback; },
          mount: (node: HTMLElement) => {
            node.innerHTML = '<div>Fixture payment element</div>';
            (window as any).recordFixtureMount(clientSecret).then((terminal: boolean) => terminal
              ? handlers.loaderror?.({ error: { message: 'This PaymentIntent is in a terminal state' } })
              : (handlers.ready?.(), handlers.change?.({ complete: true })));
          }, unmount: () => {} };
      } }),
      confirmPayment: (params: any) => (window as any).recordFixtureConfirm(params)
    });
  });
  await page.route('**/tax/quote', (route) => route.fulfill({ json: { taxCents: 153, taxDetails: { effectiveRate: 0.0765, destination: { country: 'US', postalCode: '10001' } } } }));
  await page.route('**/shipping/quote', (route) => route.fulfill({ json: { shippingCents: 300, source: 'manual' } }));
  await page.route('**/api/checkout/*', async (route) => {
    const action = new URL(route.request().url()).pathname.split('/').pop();
    const attempt = route.request().postDataJSON().attemptId;
    if (action === 'release') { releasedAttempt = attempt; canceledSecrets.add(`pi_browser_fixture_${creations}_secret`); }
    const base = { success: true, phase: attempt === releasedAttempt ? 'released' : action === 'hold' ? 'held' : 'payment', heldQuantity: physical ? 0 : 1, extensionsRemaining: 10,
      serverTime: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() };
    if (action === 'intent') {
      creations++;
      submittedDetails = route.request().postDataJSON();
      if (creations === 1) await preparation;
      if (failPreparation && creations === 1) {
        await route.fulfill({ status: 503, json: { error: 'Payment service unavailable. Please retry.' } });
        return;
      }
    }
    await route.fulfill({ json: action === 'intent' ? { ...base, checkoutUiMode: 'payment_intent', requiresPayment: true,
      paymentIntentId: `pi_browser_fixture_${creations}`, clientSecret: `pi_browser_fixture_${creations}_secret`, publishableKey: 'pk_test_fixture', orderToken: 'store-order-browser-fixture', totals: { totalCents: physical ? 3603 : 2253 } } : base });
  });
  await gotoDomReady(page, physical ? '/products/fronteras-t-shirt/' : '/products/a-night-in-paradiso/');
  await page.locator('.store-add-item').first().click();
  const cart = page.locator('[data-store-cart-root]');
  await cart.locator('[data-cart-continue]').click();
  await cart.locator('[data-cart-custom-checkout-email]').fill('checkout-test@example.com');
  if (physical) {
    for (const [field, value] of Object.entries({ name: 'Checkout Test', line1: '123 Test Street', city: 'New York', state: 'NY', postal_code: '10001' })) {
      await cart.locator(`[data-cart-custom-shipping-field="${field}"]`).fill(value);
    }
    await cart.locator('[data-cart-custom-shipping-field="postal_code"]').blur();
  } else {
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').fill('10001');
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').blur();
  }
  // No intermediate Continue action: the final field automatically loads payment.
  await expect.poll(() => creations).toBe(1);
  await expect(cart.locator('[data-cart-custom-checkout-email]')).toBeDisabled();
  await expect(cart.locator('[data-cart-back]')).toBeDisabled();
  await expect(cart.locator('button[data-cart-close]')).toBeDisabled();
  await expect(cart.locator('[data-cart-start-checkout]')).toHaveText('Loading secure payment...');
  await page.keyboard.press('Escape');
  await expect(cart).toBeVisible();
  expect(releasedAttempt).toBe('');
  expect(submittedDetails.customer.email).toBe('checkout-test@example.com');
  finishPreparation();
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
  await expect(cart.locator('#store-first-party-cart-title')).toHaveText('Payment');
  await expect(cart.locator('[data-cart-custom-checkout-email]')).toHaveCount(0);
  await expect(cart.locator('[data-cart-delivery-email]')).toHaveText('Order link will be sent to checkout-test@example.com.');
  await expect(cart.locator('[data-cart-custom-checkout-region="payment"]')).toContainText('Fixture payment element');
  const pay = cart.locator('[data-cart-confirm-custom-checkout]');
  await expect(pay).toHaveText(physical ? 'Pay $36.03' : 'Pay $22.53');
  await expect(cart.locator('[data-cart-checkout-summary-total]')).toHaveText(physical ? '$36.03' : '$22.53');
  await expect(pay).toBeEnabled();
  expect(creations).toBe(failFirstMount || failPreparation ? 2 : 1);
  expect(confirms).toBe(0);
  if (physical) {
    await expect(cart.locator('[data-cart-delivery-address]')).toContainText('123 Test Street');
    await expect(cart.locator('[data-cart-custom-shipping-field]')).toHaveCount(0);
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
  expect(creations).toBe(failFirstMount || failPreparation ? 2 : 1);
  expect(lastConfirm.confirmParams.payment_method_data.billing_details.email).toBe('checkout-test@example.com');
  if (physical) expect(lastConfirm.confirmParams.payment_method_data.billing_details.address.line1).toBe('123 Test Street');
  const mountedBeforeBack = mounts.length;
  await cart.locator('[data-cart-back]').click();
  await expect(cart.locator('[data-cart-continue]')).toBeVisible();
  expect(mounts).toHaveLength(mountedBeforeBack);
  await cart.locator('[data-cart-continue]').click();
  await expect(pay).toBeEnabled();
  expect(creations).toBe(failFirstMount || failPreparation ? 3 : 2);
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
  expect(await page.evaluate(() => localStorage.getItem('store_checkout_attempt_v1'))).toBeNull();
});
}

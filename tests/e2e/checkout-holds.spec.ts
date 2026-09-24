import { test, expect } from '@playwright/test';
import { gotoDomReady } from './helpers/navigation';
import { expectNoHorizontalOverflow } from './helpers/mobile';

// Provider-free browser characterization; real serialized inventory transitions
// and Stripe failure boundaries are exercised by checkout-holds.test.ts.
for (const lang of ['en', 'es']) {
  test(`${lang}: mobile hold, extension, expiry recovery and checkout clarity`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
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
    await cart.locator('[data-cart-hold-extend]').click();
    await expect(cart.locator('[data-cart-hold-extend]')).toBeHidden();
    await cart.locator('[data-cart-custom-checkout-email]').fill('checkout-test@example.com');
    await cart.locator('[data-cart-custom-checkout-email]').blur();
    phase = 'expired';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(cart.locator('[data-cart-hold-retry]')).toBeVisible();
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

test('Pay uses the canonical total and a card error keeps the same checkout attempt', async ({ page }) => {
  let creations = 0; let confirms = 0;
  await page.exposeFunction('recordFixtureConfirm', () => { confirms++; });
  await page.addInitScript(() => {
    (window as any).Stripe = () => ({
      elements: () => ({ create: () => {
        const handlers: Record<string, Function> = {};
        return { on: (event: string, callback: Function) => { handlers[event] = callback; },
          mount: (node: HTMLElement) => { node.textContent = 'Fixture payment element'; setTimeout(() => handlers.change?.({ complete: true }), 10); }, unmount: () => {} };
      } }),
      confirmPayment: async () => { await (window as any).recordFixtureConfirm(); return { error: { message: 'Fixture card declined' } }; }
    });
  });
  await page.route('**/tax/quote', (route) => route.fulfill({ json: { taxCents: 0, taxDetails: { effectiveRate: 0, destination: { country: 'US', postalCode: '10001' } } } }));
  await page.route('**/api/checkout/*', async (route) => {
    const action = new URL(route.request().url()).pathname.split('/').pop();
    const base = { success: true, phase: action === 'hold' ? 'held' : 'payment', heldQuantity: 1, extensionsRemaining: 10,
      serverTime: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() };
    if (action === 'intent') creations++;
    await route.fulfill({ json: action === 'intent' ? { ...base, checkoutUiMode: 'payment_intent', requiresPayment: true,
      paymentIntentId: 'pi_browser_fixture', clientSecret: 'pi_browser_fixture_secret', publishableKey: 'pk_test_fixture', orderToken: 'store-order-browser-fixture', totals: { totalCents: 2253 } } : base });
  });
  await gotoDomReady(page, '/products/a-night-in-paradiso/');
  await page.locator('.store-add-item').first().click();
  const cart = page.locator('[data-store-cart-root]');
  await cart.locator('[data-cart-continue]').click();
  await cart.locator('[data-cart-custom-checkout-email]').fill('checkout-test@example.com');
  await cart.locator('[data-cart-tax-destination-field="postal_code"]').fill('10001');
  await cart.locator('[data-cart-tax-destination-field="postal_code"]').blur();
  await cart.locator('[data-cart-start-checkout]').click();
  const pay = cart.locator('[data-cart-confirm-custom-checkout]');
  await expect(pay).toHaveText('Pay $22.53');
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect(cart.locator('[data-cart-checkout-error]')).toHaveText('Fixture card declined');
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect.poll(() => confirms).toBe(2);
  expect(creations).toBe(1);
});

import { test, expect } from '@playwright/test';
import { gotoDomReady } from './helpers/navigation';
import { expectNoHorizontalOverflow } from './helpers/mobile';
import { applyTextScale } from './helpers/rendering';

for (const locale of ['en', 'es']) {
  test(`contribution presets, custom amount and checkout survive reload (${locale})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const url = `${locale === 'es' ? '/es' : ''}/products/support-paradiso/`;
    let submitted: any;
    let intent: any;
    await page.route('**/tax/quote', (route) => route.fulfill({ json: { taxCents: 0, taxDetails: { destination: { country: 'US', postalCode: '10001' } } } }));
    await page.route('**/api/checkout/*', async (route) => {
      const body = route.request().postDataJSON();
      const action = new URL(route.request().url()).pathname.split('/').pop();
      if (action === 'hold') submitted = body;
      if (action === 'intent') {
        intent = body;
        await route.fulfill({ status: 503, json: { error: 'Fixture payment provider unavailable' } });
        return;
      }
      await route.fulfill({ json: { success: true, attemptId: body.attemptId, phase: 'held', heldQuantity: 0, extensionsRemaining: 10, serverTime: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() } });
    });
    await gotoDomReady(page, url);
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const card = page.locator('#support-paradiso');
    const amount = card.locator('[data-store-contribution-amount]');
    const add = card.locator('.store-add-item');
    await expect(page.locator('html')).toHaveAttribute('data-store-product-options-ready', 'true');
    await expect(card.locator('[data-store-suggested-amount]')).toHaveCount(4);
    await page.screenshot({ path: testInfo.outputPath('contribution-mobile.png'), fullPage: true, animations: 'disabled' });
    for (const value of [10, 25, 50, 100]) {
      await card.locator(`[data-store-suggested-amount="${value}"]`).click();
      await expect(amount).toHaveValue(String(value));
      await expect(add).toHaveAttribute('data-custom-amount-cents', String(value * 100));
    }
    await amount.fill('0.49');
    await expect(add).toBeDisabled();
    await expect(card.locator('[data-store-amount-error]')).toBeVisible();
    await amount.fill('25.37');
    await expect(add).toBeEnabled();
    await expect(card.locator('[data-store-quantity]')).toHaveCount(0);
    await amount.focus();
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await page.keyboard.press('Enter');
    const cart = page.locator('[data-store-cart-root]');
    await expect(cart.locator('[data-cart-tip]')).toHaveValue('0');
    await expect(cart.locator('[data-cart-coupon-form]')).toHaveCount(0);
    await expect(cart.locator('[data-cart-item-quantity]')).toHaveCount(0);
    await expect(cart.locator('.store-first-party-cart__item-price')).toHaveText('$25.37');
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Open the existing cart without adding another contribution.
    await page.locator('#header-cart-btn').first().click();
    await expect(cart.locator('.store-first-party-cart__item-price')).toHaveText('$25.37');
    await expect(cart.locator('[data-cart-tip]')).toHaveValue('0');
    await expectNoHorizontalOverflow(page);
    await cart.locator('[data-cart-continue]').click();
    await expect.poll(() => submitted?.items?.[0]?.customAmountCents).toBe(2537);
    expect(submitted.items[0]).toMatchObject({ productId: 'support-paradiso', price: 25.37, quantity: 1 });
    await expect(cart.locator('[data-cart-hold]')).toBeHidden();
    await cart.locator('[data-cart-custom-checkout-email]').fill('contribution-test@example.com');
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').fill('10001');
    await cart.locator('[data-cart-tax-destination-field="postal_code"]').blur();
    await expect.poll(() => intent?.items?.[0]?.customAmountCents).toBe(2537);
    expect(intent.tipPercent).toBe(0);
  });
}

test('contribution controls fit narrow screens and 200% text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await gotoDomReady(page, '/products/support-paradiso/');
  await applyTextScale(page, 200);
  await expectNoHorizontalOverflow(page);
  await expect(page.locator('[data-store-contribution-amount]')).toBeVisible();
});

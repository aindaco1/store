import { test, expect } from '@playwright/test';
import { routeCheckoutHold, gotoCheckoutProduct } from './helpers/checkout';
import { checkAddressConsistency } from '../../worker/src/address-consistency.js';

for (const { kind, lang, width } of [
  { kind: 'billing', lang: 'en', width: 1280 },
  { kind: 'billing', lang: 'es', width: 390 },
  { kind: 'shipping', lang: 'en', width: 390 }
]) {
  test(`${kind} ${lang}: ZIP conflict and optional city correction preserve the form`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 700 });
    await routeCheckoutHold(page);
    let releaseOld!: () => void;
    let oldSeen = false;
    const oldResponse = new Promise<void>((resolve) => { releaseOld = resolve; });
    await page.route('**/address/check', async (route) => {
      const body = route.request().postDataJSON();
      // Hold a now-obsolete result until the shopper has entered another ZIP.
      if (body[kind]?.postalCode === '10467') { oldSeen = true; await oldResponse; }
      await route.fulfill({ json: { billing: checkAddressConsistency(body.billing), shipping: checkAddressConsistency(body.shipping) } });
    });
    await page.route('**/tax/quote', (route) => route.fulfill({ json: { taxCents: 100, taxDetails: { effectiveRate: 0.05 } } }));
    await page.route('**/shipping/quote', (route) => route.fulfill({ json: { shippingCents: 300, source: 'manual' } }));
    await gotoCheckoutProduct(page, `${lang === 'es' ? '/es' : ''}/products/${kind === 'billing' ? 'a-night-in-paradiso' : 'fronteras-t-shirt'}/`);
    await page.locator('.store-add-item').first().click();
    const cart = page.locator('[data-store-cart-root]');
    await cart.locator('[data-cart-continue]').click();
    const attribute = kind === 'billing' ? 'data-cart-tax-destination-field' : 'data-cart-custom-shipping-field';
    const field = (name: string) => cart.locator(`[${attribute}="${name}"]`);
    await field('postal_code').fill('87048');
    await field('line1').fill('123 Test Street');
    await field('city').fill('Corrales');
    await field('state').fill('NM');
    const original = await field('line1').elementHandle();
    const feedback = cart.locator(`[data-cart-address-feedback="${kind}"]`);
    await field('postal_code').fill('10467');
    await expect.poll(() => oldSeen).toBe(true);
    await field('postal_code').fill('90012');
    const body = cart.locator('.store-first-party-cart__body');
    const scrollTop = await body.evaluate((node) => node.scrollTop);
    await expect(feedback.locator('[data-cart-state-conflict]')).toContainText('90012');
    await expect(feedback.locator('[data-cart-state-conflict]')).toContainText('CA');
    const conflictText = await feedback.locator('[data-cart-state-conflict]').innerText();
    await expect(cart.getByText(conflictText, { exact: true })).toHaveCount(1);
    await expect(cart.locator('[data-cart-checkout-next]')).toBeHidden();
    await expect(cart.locator('[data-cart-checkout-action]')).toBeDisabled();
    const suggestionText = feedback.locator('[data-cart-city-suggestion-text]');
    await expect(suggestionText).toHaveText(lang === 'es'
      ? 'Para el código postal 90012, la ciudad indicada es Los Angeles. Puedes conservar tu ciudad si es un nombre postal alternativo.'
      : 'For ZIP 90012, the listed city is Los Angeles. You can keep your city if it is an alternate mailing name.');
    // The full explanation wraps normally; a separate action must not stretch
    // the last line of text with its 44px touch target or look like prose.
    const textBounds = await suggestionText.boundingBox();
    const actionBounds = await feedback.locator('[data-cart-use-city]').boundingBox();
    expect(actionBounds!.y).toBeGreaterThanOrEqual(textBounds!.y + textBounds!.height);
    expect(actionBounds!.height).toBeGreaterThanOrEqual(44);

    await expect(field('postal_code')).toHaveAttribute('aria-invalid', 'true');
    await expect(field('state')).toHaveAttribute('aria-invalid', 'true');
    await expect(field('city')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(feedback.locator('[data-cart-city-suggestion]')).toContainText('Los Angeles');
    await expect(field('postal_code')).toBeFocused();
    expect(await body.evaluate((node) => node.scrollTop)).toBeCloseTo(scrollTop, 0);
    await feedback.screenshot({ path: testInfo.outputPath('address-feedback.png') });
    releaseOld();
    await page.waitForTimeout(450);
    await expect(feedback.locator('[data-cart-state-conflict]')).toContainText('90012');
    await expect(feedback.locator('[data-cart-state-conflict]')).not.toContainText('10467');
    await field('state').fill('California');
    await expect(feedback.locator('[data-cart-state-conflict]')).toBeHidden();
    await expect(field('state')).toHaveAttribute('aria-invalid', 'false');
    await expect(field('city')).toHaveValue('Corrales');
    await feedback.locator('[data-cart-use-city]').click();
    const cityScroll = await body.evaluate((node) => node.scrollTop);
    await expect(field('city')).toHaveValue('Los Angeles');
    await expect(field('city')).toBeFocused();
    await expect(feedback.locator('[data-cart-city-suggestion]')).toBeHidden();
    expect(await body.evaluate((node) => node.scrollTop)).toBeCloseTo(cityScroll, 0);
    await expect(field('line1')).toHaveValue('123 Test Street');
    expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
    // Unknown/international postcodes must not retain a previous US conflict.
    await field('postal_code').fill('99999');
    await expect(feedback.locator('[data-cart-state-conflict]')).toBeHidden();
    await field('country').selectOption('CA');
    await field('postal_code').fill('K1A 0B1');
    await expect(feedback.locator('[data-cart-state-conflict]')).toBeHidden();
    await expect(field('line1')).toHaveValue('123 Test Street');
  });
}

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers/mobile';

test('mobile form text stays readable across component overrides and touch tablet widths', async ({ browser }) => {
  const css = readFileSync('_site/assets/main.css', 'utf8');
  const context = await browser.newContext({ hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    await page.route('**/*', (route) => route.abort());
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1">
      <style>${css}</style>
      <style>.compact-consumer input { font-size: 12px; }</style>
      <main style="padding: 16px; max-width: 100%;">
        <input type="email" class="store-first-party-cart__input" aria-label="Email">
        <input type="number" class="store-first-party-cart__quantity-input" aria-label="Quantity" value="2">
        <input type="text" class="store-first-party-cart__coupon-input" aria-label="Coupon">
        <select class="store-first-party-cart__input store-first-party-cart__input--summary-select" aria-label="Country"><option>United States</option></select>
        <textarea class="store-first-party-cart__input" aria-label="RSVP answer"></textarea>
        <div class="compact-consumer">
          ${['text', 'number', 'email', 'tel', 'password', 'search', 'url'].map((type) => `<input type="${type}" aria-label="Shared ${type}">`).join('')}
          <input aria-label="Default text input">
        </div>
      </main>`);

    for (const width of [320, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 1024 });
      const sizes = await page.locator('input, select, textarea').evaluateAll((fields) => fields.map((field) => ({
        label: field.getAttribute('aria-label'),
        size: parseFloat(getComputedStyle(field).fontSize)
      })));
      for (const { label, size } of sizes) expect(size, `${label} at ${width}px`).toBeGreaterThanOrEqual(16);
      await expectNoHorizontalOverflow(page);
    }

    await page.addStyleTag({ content: 'html { font-size: 20px; }' });
    expect(await page.locator('input, select, textarea').evaluateAll((fields) => (
      fields.every((field) => parseFloat(getComputedStyle(field).fontSize) >= 20)
    ))).toBe(true);
  } finally {
    await context.close();
  }
});

test('wide pointer-based layouts keep their compact form styling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent(`<style>${readFileSync('_site/assets/main.css', 'utf8')}</style>
    <input type="email" class="store-first-party-cart__input" aria-label="Email">`);
  await expect(page.getByLabel('Email')).toHaveCSS('font-size', '14px');
});

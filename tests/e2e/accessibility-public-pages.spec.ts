import { test, expect } from '@playwright/test';
import path from 'node:path';
import { expectNoHorizontalOverflow } from './helpers/mobile';
import { gotoDomReady } from './helpers/navigation';
import { applyTextScale } from './helpers/rendering';

const axePath = path.resolve(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');
const SITE_BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4002';
const CART_ROOT = '[data-store-cart-root]';

async function runAxe(page: any) {
  await page.route('**/__axe-core.js', async (route: any) => {
    await route.fulfill({
      path: axePath,
      contentType: 'application/javascript'
    });
  });
  await page.addScriptTag({ url: '/__axe-core.js' });
  return page.evaluate(async () => {
    // @ts-ignore
    return window.axe.run(document, {
      rules: {
        'color-contrast': { enabled: false }
      }
    });
  });
}

async function expectNoAxeViolations(page: any) {
  const results = await runAxe(page);
  expect(
    results.violations,
    results.violations
      .map((violation: any) => `${violation.id}: ${violation.help}`)
      .join('\n')
  ).toEqual([]);
}

async function expectAriaSnapshotToContain(locator: any, fragments: string[]) {
  const snapshot = await locator.ariaSnapshot();
  for (const fragment of fragments) {
    expect(snapshot).toContain(fragment);
  }
}

test.describe('Public Page Accessibility', () => {
  test('home page stays tidy on a small phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDomReady(page, '/');
    await expect(page.locator('main')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const productCard = page.locator('.store-product-card').first();
    await expect(productCard).toBeVisible();
    await productCard.scrollIntoViewIfNeeded();
    await expect(productCard).toBeInViewport();
  });

  test('home page has no obvious axe violations', async ({ page }) => {
    await gotoDomReady(page, '/');
    await expect(page.locator('main')).toBeVisible();
    await expect.poll(() => page.locator('.store-product-card').count()).toBeGreaterThan(0);
    await expectNoAxeViolations(page);
    await expectAriaSnapshotToContain(page.locator('main'), [
      'heading "Fronteras T-Shirt"',
      'button "Add to Cart - $30"'
    ]);
  });

  test('localized public navigation exposes stable shipping and return policy links', async ({ page }) => {
    await gotoDomReady(page, '/');
    const englishPolicies = page.locator('.site-footer__policies');
    await expect(englishPolicies.getByRole('link', { name: 'Shipping Policy' })).toHaveAttribute('href', '/terms/#shipping-policy');
    await expect(englishPolicies.getByRole('link', { name: 'Return Policy' })).toHaveAttribute('href', '/terms/#returns-refunds');

    await gotoDomReady(page, '/es/');
    const spanishPolicies = page.locator('.site-footer__policies');
    await expect(spanishPolicies.getByRole('link', { name: 'Política de envíos' })).toHaveAttribute('href', '/es/terms/#shipping-policy');
    await expect(spanishPolicies.getByRole('link', { name: 'Política de devoluciones' })).toHaveAttribute('href', '/es/terms/#returns-refunds');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Abrir menú' }).click();
    const mobileNav = page.locator('#mobile-nav');
    await expect(mobileNav.getByRole('link', { name: 'Política de envíos' })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'Política de devoluciones' })).toBeVisible();
  });

  test('product detail page has no obvious axe violations', async ({ page }) => {
    await gotoDomReady(page, '/products/fronteras-poster-big/');
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Fronteras Poster (Big)');
    await expectNoAxeViolations(page);
    await expectAriaSnapshotToContain(page.locator('main'), [
      'heading "Fronteras Poster (Big)"',
      'button "Add to Cart - $35"'
    ]);
  });

  test('product detail page stays tidy on a small phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDomReady(page, '/products/fronteras-poster-big/');
    await expect(page.locator('main')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const addButton = page.getByRole('button', { name: 'Add to Cart - $35' });
    await expect(addButton).toBeVisible();
    await addButton.scrollIntoViewIfNeeded();
    await expect(addButton).toBeInViewport();
  });

  test('cart and checkout panel have no obvious axe violations', async ({ page }) => {
    await gotoDomReady(page, '/');
    const productCard = page.locator('.store-product-card').filter({ hasText: 'Fronteras T-Shirt' });
    await expect(productCard).toHaveCount(1);
    await productCard.locator('button.store-add-item').click();

    const cart = page.locator(CART_ROOT);
    await expect(cart).toBeVisible();
    await expect(cart).toContainText('Fronteras T-Shirt');
    await expectNoAxeViolations(page);

    await cart.getByRole('button', { name: 'Checkout' }).click();
    await expect(cart.getByLabel('Email address')).toBeVisible();
    await expect(cart).toContainText('Order summary');
    await expect(cart).toContainText('All sales are final after payment.');
    await expect(cart.getByRole('link', { name: 'Read the return and fulfillment policy.' })).toHaveAttribute('href', '/terms/#returns-refunds');
    await expectNoAxeViolations(page);
  });

  test('terms page has no obvious axe violations', async ({ page }) => {
    await gotoDomReady(page, '/terms/');
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Terms & Privacy');
    await expectNoAxeViolations(page);
    await expectAriaSnapshotToContain(page.locator('main'), [
      'heading "Terms & Privacy"',
      'paragraph: Effective July 14, 2026.'
    ]);
  });

  test('order lookup page has no obvious axe violations', async ({ page }) => {
    await page.route('**/api/orders/lookup', async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': SITE_BASE,
          'access-control-allow-credentials': 'true'
        },
        body: JSON.stringify({
          ok: true,
          message: 'If that email has Shop orders, a secure lookup link has been sent.'
        })
      });
    });
    await gotoDomReady(page, '/orders/');
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Find your order');
    await page.getByLabel('Email address').fill('customer@example.com');
    await page.getByRole('button', { name: 'Email lookup link' }).click();
    await expect(page.locator('[data-store-order-lookup-status]')).toContainText('If that email has Shop orders');
    await expectNoAxeViolations(page);
    await expectAriaSnapshotToContain(page.locator('main'), [
      'heading "Find your order"',
      'textbox "Email address"',
      'button "Email lookup link"'
    ]);
  });

  test('order success page has no obvious axe violations', async ({ page }) => {
    await page.route('**/api/orders/store-order-demo123', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderToken: 'store-order-demo123',
          status: 'confirmed',
          fulfillmentReady: true,
          confirmedAt: '2026-06-11T18:00:00.000Z',
          totals: {
            totalCents: 3500,
            currency: 'USD'
          },
          items: [{
            name: 'Fronteras Poster (Big)',
            sku: 'poster-1',
            quantity: 1,
            subtotalCents: 3500,
            fulfillmentType: 'physical'
          }]
        })
      });
    });
    await gotoDomReady(page, '/order-success/?orderToken=store-order-demo123');
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Order received');
    await expect(page.locator('[data-store-order-status]')).toContainText('Ready for fulfillment.');
    await expectNoAxeViolations(page);
    await expectAriaSnapshotToContain(page.locator('main'), [
      'heading "Order received"',
      'heading "Order confirmed"',
      'heading "Fronteras Poster (Big)"',
      'link "Return to the store"'
    ]);
  });

  test('release checkout and order surfaces tolerate 200% text scaling', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await gotoDomReady(page, '/');
    await applyTextScale(page);
    await expect(page.locator('main')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const productCard = page.locator('.store-product-card').filter({ hasText: 'Fronteras T-Shirt' });
    await expect(productCard).toHaveCount(1);
    await productCard.locator('button.store-add-item').click();

    const cart = page.locator(CART_ROOT);
    await expect(cart).toBeVisible();
    await expect(cart.getByRole('button', { name: 'Checkout' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await cart.getByRole('button', { name: 'Checkout' }).click();
    await expect(cart.getByLabel('Email address')).toBeVisible();
    await expect(cart).toContainText('Order summary');
    await expectNoHorizontalOverflow(page);

    await gotoDomReady(page, '/orders/');
    await applyTextScale(page);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Email lookup link' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.route('**/api/orders/store-order-zoom', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderToken: 'store-order-zoom',
          status: 'confirmed',
          fulfillmentReady: true,
          confirmedAt: '2026-06-11T18:00:00.000Z',
          totals: { totalCents: 3500, currency: 'USD' },
          items: [{
            name: 'Fronteras Poster (Big)',
            sku: 'poster-1',
            quantity: 1,
            subtotalCents: 3500,
            fulfillmentType: 'physical'
          }]
        })
      });
    });
    await gotoDomReady(page, '/order-success/?orderToken=store-order-zoom');
    await applyTextScale(page);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('[data-store-order-status]')).toContainText('Ready for fulfillment.');
    await expectNoHorizontalOverflow(page);
  });
});

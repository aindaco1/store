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

  test('policy links stay in the footer on larger screens and move below Terms in the mobile menu', async ({ page }) => {
    await gotoDomReady(page, '/');

    for (const viewport of [
      { name: 'desktop', width: 1280, height: 900 },
      { name: 'tablet', width: 820, height: 1180 }
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const footer = page.locator('.site-footer');
      const copyright = footer.locator('.site-footer__copyright');
      const shipping = footer.getByRole('link', { name: 'Shipping', exact: true });
      const returns = footer.getByRole('link', { name: 'Return Policy', exact: true });
      await expect(shipping, viewport.name).toBeVisible();
      await expect(returns, viewport.name).toBeVisible();
      await expect(shipping).toHaveAttribute('href', '/terms/#shipping-policy');
      await expect(returns).toHaveAttribute('href', '/terms/#returns-refunds');
      await expect(page.locator('#mobile-nav .site-header__mobile-policy-link').first()).toBeHidden();
      await expectNoHorizontalOverflow(page);

      expect(await copyright.evaluate((element) => {
        const copyrightBox = element.getBoundingClientRect();
        const policiesBox = element.parentElement?.querySelector('.site-footer__policies')?.getBoundingClientRect();
        return Boolean(policiesBox && policiesBox.left >= copyrightBox.right);
      }), viewport.name).toBe(true);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const footer = page.locator('.site-footer');
    await expect(footer.locator('.site-footer__policies')).toBeHidden();
    const menu = page.locator('#mobile-nav');
    const terms = menu.getByRole('link', { name: 'Terms', exact: true });
    const shipping = menu.getByRole('link', { name: 'Shipping', exact: true });
    const returns = menu.getByRole('link', { name: 'Return Policy', exact: true });
    await expect(shipping).toBeHidden();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(shipping).toBeVisible();
    await expect(returns).toBeVisible();
    await expect(shipping).toHaveAttribute('href', '/terms/#shipping-policy');
    await expect(returns).toHaveAttribute('href', '/terms/#returns-refunds');
    expect(await terms.evaluate((element) => {
      const shippingLink = element.parentElement?.querySelector('.site-header__mobile-policy-link');
      return Boolean(shippingLink && (element.compareDocumentPosition(shippingLink) & Node.DOCUMENT_POSITION_FOLLOWING));
    })).toBe(true);
    expect((await shipping.boundingBox())?.y || 0).toBeGreaterThan((await terms.boundingBox())?.y || 0);
    await expectNoHorizontalOverflow(page);

    await gotoDomReady(page, '/es/');
    await expect(page.locator('.site-footer__policies')).toBeHidden();
    await page.getByRole('button', { name: 'Abrir menú' }).click();
    const spanishMenu = page.locator('#mobile-nav');
    await expect(spanishMenu.getByRole('link', { name: 'Envío', exact: true })).toBeVisible();
    await expect(spanishMenu.getByRole('link', { name: 'Política de devoluciones', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
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
    await expect(page.locator('h1')).toContainText('Terms & Store Policies');
    await expect(page.locator('#shipping-policy')).toContainText('4. Shipping and fulfillment');
    await expect(page.locator('#returns-refunds')).toContainText('5. No returns, fulfillment problems, and refunds');
    await expectNoAxeViolations(page);
    await expectAriaSnapshotToContain(page.locator('main'), [
      'heading "Terms & Store Policies"',
      'heading "4. Shipping and fulfillment"',
      'heading "5. No returns, fulfillment problems, and refunds"'
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

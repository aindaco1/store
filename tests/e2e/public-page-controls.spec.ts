import { test, expect } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers/mobile';
import { gotoDomReady } from './helpers/navigation';
import { waitForStableRendering } from './helpers/rendering';

const SITE_BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4002';

const CART_ROOT = '[data-store-cart-root]';
const PRODUCT_CARD = '[data-store-product-card]';
const LEGACY_CART_SELECTORS = [
  '[data-' + 'pool-cart-root]',
  '.' + 'pool' + 'cart-add-item',
  '[data-' + 'pool' + 'cart-add-item]'
].join(', ');

async function clearCartStorage(page: any) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

async function firstProductCard(page: any) {
  const card = page.locator(PRODUCT_CARD).filter({ hasText: 'Fronteras T-Shirt' });
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-store-availability]')).toHaveAttribute('data-store-inventory-state', 'low');
  return card;
}

async function storefrontLayoutMetrics(page: any) {
  await waitForStableRendering(page);

  return page.evaluate((productCardSelector) => {
    function renderedLineCount(element: Element) {
      const target = element.querySelector('a') || element;
      const range = document.createRange();
      range.selectNodeContents(target);
      const lineTops = Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => Math.round(rect.top));
      range.detach();
      return new Set(lineTops).size;
    }

    const cards = Array.from(document.querySelectorAll(productCardSelector));
    const firstTop = Math.round(cards[0]?.getBoundingClientRect().top || 0);
    const titles = Array.from(document.querySelectorAll('.store-product-card__title'));
    const descriptions = Array.from(document.querySelectorAll('.store-product-card__description'));

    return {
      firstRowCount: cards.filter((card) => Math.abs(Math.round(card.getBoundingClientRect().top) - firstTop) <= 1).length,
      maxTitleLines: Math.max(...titles.map(renderedLineCount)),
      titleOverflows: titles
        .filter((title) => title.scrollHeight > title.clientHeight + 1)
        .map((title) => title.textContent?.trim() || ''),
      titleBlockHeights: Array.from(new Set(titles.map((title) => Math.round(title.getBoundingClientRect().height)))),
      descriptionFontSize: parseFloat(window.getComputedStyle(descriptions[0]).fontSize)
    };
  }, PRODUCT_CARD);
}

async function visibleProductMetadata(page: any) {
  return page.locator(PRODUCT_CARD).evaluateAll((cards: Element[]) => cards
    .filter((card) => !(card as HTMLElement).hidden)
    .map((card) => ({
      title: card.querySelector('.store-product-card__title')?.textContent?.trim() || '',
      collection: (card as HTMLElement).dataset.storeCollection || '',
      category: (card as HTMLElement).dataset.storeCategory || ''
    })));
}

async function productCardImageMetrics(page: any, limit = 3) {
  return page.locator(`${PRODUCT_CARD} img.store-product-card__image`).evaluateAll((images: HTMLImageElement[], limit: number) => images
    .slice(0, limit)
    .map((image) => ({
      alt: image.alt,
      src: image.getAttribute('src') || '',
      loading: image.getAttribute('loading') || '',
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      currentSrc: image.currentSrc,
      objectFit: window.getComputedStyle(image).objectFit
    })), limit);
}

test.describe('Store Public Page Controls', () => {
  test.beforeEach(async ({ page }) => {
    await clearCartStorage(page);
  });

  test('storefront grid uses wider cards and reserves two-line product titles', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await gotoDomReady(page, '/');
    await expect(page.locator(PRODUCT_CARD).first()).toBeVisible();
    await expect(page.locator('.store-product-card__eyebrow').first()).toBeVisible();
    await expect.poll(async () => {
      const images = await productCardImageMetrics(page, 3);
      return images.length === 3 && images[0].loading === 'eager' && images.slice(1).every((image) => image.loading === 'lazy') && images.every((image) => image.complete && image.naturalWidth > 0 && image.objectFit === 'contain');
    }).toBe(true);

    await expect.poll(async () => (await storefrontLayoutMetrics(page)).firstRowCount).toBe(3);
    await expect.poll(async () => (await storefrontLayoutMetrics(page)).maxTitleLines).toBeLessThanOrEqual(2);
    let metrics = await storefrontLayoutMetrics(page);
    expect(metrics.titleOverflows).toEqual([]);
    expect(metrics.titleBlockHeights).toHaveLength(1);
    expect(metrics.descriptionFontSize).toBeLessThan(13);

    await page.setViewportSize({ width: 768, height: 900 });
    await expect.poll(async () => (await storefrontLayoutMetrics(page)).firstRowCount).toBe(2);
    await expect.poll(async () => (await storefrontLayoutMetrics(page)).maxTitleLines).toBeLessThanOrEqual(2);
    metrics = await storefrontLayoutMetrics(page);
    expect(metrics.titleOverflows).toEqual([]);
    expect(metrics.titleBlockHeights).toHaveLength(1);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await storefrontLayoutMetrics(page)).firstRowCount).toBe(1);
    await expect.poll(async () => (await storefrontLayoutMetrics(page)).maxTitleLines).toBeLessThanOrEqual(2);
    metrics = await storefrontLayoutMetrics(page);
    expect(metrics.titleOverflows).toEqual([]);
    expect(metrics.titleBlockHeights).toHaveLength(1);
    expect(metrics.descriptionFontSize).toBeLessThan(13);
    await expectNoHorizontalOverflow(page);
  });

  test('product card images survive product navigation and browser back', async ({ page }) => {
    await gotoDomReady(page, '/');
    await expect.poll(async () => {
      const images = await productCardImageMetrics(page, 3);
      return images.length === 3 && images.every((image) => image.complete && image.naturalWidth > 0);
    }).toBe(true);

    await page.locator('a.store-product-card__media[href="/products/dust-wave-sticker/"]').click();
    await expect(page).toHaveURL(/\/products\/dust-wave-sticker\/$/);
    await expect(page.locator('h1')).toContainText('DUST WAVE Sticker');
    await expect.poll(async () => {
      const images = await productCardImageMetrics(page, 1);
      return images.length === 1 && images[0].loading === 'eager' && images[0].complete && images[0].naturalWidth > 0;
    }).toBe(true);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(async () => {
      const images = await productCardImageMetrics(page, 3);
      return images.length === 3 && images.every((image) => image.complete && image.naturalWidth > 0);
    }).toBe(true);
    await expectNoHorizontalOverflow(page);
  });

  test('storefront filters products by collection and category metadata', async ({ page }) => {
    await gotoDomReady(page, '/');

    const filters = page.locator('[data-store-product-filters]');
    await expect(filters.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await expect(filters.getByRole('button', { name: 'Clear filters' })).toBeHidden();

    await filters.getByRole('button', { name: 'Fronteras' }).click();
    await expect(filters.getByRole('button', { name: 'Fronteras' })).toHaveAttribute('aria-pressed', 'true');
    let visibleProducts = await visibleProductMetadata(page);
    expect(visibleProducts.length).toBeGreaterThan(3);
    expect(visibleProducts.every((product) => product.collection === 'fronteras')).toBe(true);
    await expect(page.locator('[data-store-filter-status]')).toContainText(/Showing \d+ Fronteras products\./);
    await expect(filters.getByRole('button', { name: 'Clear filters' })).toBeVisible();

    await filters.getByRole('button', { name: 'Apparel' }).click();
    await expect(filters.getByRole('button', { name: 'Fronteras' })).toHaveAttribute('aria-pressed', 'true');
    await expect(filters.getByRole('button', { name: 'Apparel' })).toHaveAttribute('aria-pressed', 'true');
    visibleProducts = await visibleProductMetadata(page);
    expect(visibleProducts.length).toBeGreaterThan(0);
    expect(visibleProducts.every((product) => product.collection === 'fronteras')).toBe(true);
    expect(visibleProducts.every((product) => product.category === 'apparel')).toBe(true);
    expect(visibleProducts.some((product) => product.title === 'Fronteras T-Shirt')).toBe(true);
    await expect(page.locator('[data-store-filter-status]')).toContainText(/matching Fronteras \+ Apparel\./);

    await filters.getByRole('button', { name: 'All' }).click();
    await expect(filters.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await expect(filters.getByRole('button', { name: 'Apparel' })).toHaveAttribute('aria-pressed', 'true');
    visibleProducts = await visibleProductMetadata(page);
    expect(visibleProducts.length).toBeGreaterThan(3);
    expect(visibleProducts.every((product) => product.category === 'apparel')).toBe(true);

    await filters.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('[data-store-filter-status]')).toHaveText('');
    await expect(filters.getByRole('button', { name: 'Clear filters' })).toBeHidden();
    await expect(filters.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await expect(filters.getByRole('button', { name: 'Apparel' })).toHaveAttribute('aria-pressed', 'false');
    visibleProducts = await visibleProductMetadata(page);
    expect(visibleProducts.length).toBe(await page.locator(PRODUCT_CARD).count());
    await expectNoHorizontalOverflow(page);
  });

  test('product controls render with Store-only markup on desktop and mobile', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoDomReady(page, '/');

    await expect(page).toHaveTitle(/Shop/);
    await expect(page.locator(CART_ROOT)).toHaveCount(1);
    await expect(page.locator(LEGACY_CART_SELECTORS)).toHaveCount(0);
    expect(await page.locator(PRODUCT_CARD).count()).toBeGreaterThan(3);

    const card = await firstProductCard(page);
    await expect(card.locator('[data-store-price]')).toHaveText('$30');
    await expect(card.locator('[data-store-variant-select]')).toBeVisible();
    await expect(card.locator('[data-store-variant-select]')).toHaveValue('s');
    await expect(card.locator('[data-store-availability]')).toHaveText('Only 1 left');
    await expect(card.locator('[data-store-availability]')).toHaveAttribute('data-store-inventory-state', 'low');
    await expect(card.locator('[data-store-quantity]')).toHaveValue('1');
    await expect(card.locator('button.store-add-item')).toHaveText(/Add to Cart - \$30/i);
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator(CART_ROOT)).toHaveCount(1);
    await expect(page.locator(LEGACY_CART_SELECTORS)).toHaveCount(0);
    await expect(await firstProductCard(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('product pages expose language-prefixed localized routes with canonical product controls', async ({ page }) => {
    await gotoDomReady(page, '/products/fronteras-t-shirt/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('h1')).toContainText('Fronteras T-Shirt');
    const englishCard = page.locator('.storefront__product-detail > .store-product-card').first();
    await expect(englishCard).toBeVisible();
    await expect(englishCard.locator('.store-product-card__title')).toHaveCount(0);
    await expect(englishCard.locator('.store-product-card__description')).toHaveCount(0);
    await expect(page.locator('.storefront--product .storefront__eyebrow')).toHaveCount(0);
    await expect(page.locator('.storefront--product .store-product-card__eyebrow')).toHaveCount(0);
    await expect(page.locator('link[rel="alternate"][hreflang="es"]')).toHaveAttribute('href', /\/es\/products\/fronteras-t-shirt\/$/);
    await expect(page.getByRole('link', { name: 'Español' })).toHaveAttribute('href', '/es/products/fronteras-t-shirt/');

    await gotoDomReady(page, '/es/products/fronteras-t-shirt/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('.storefront--product .storefront__eyebrow')).toHaveCount(0);
    await expect(page.locator('.storefront--product .store-product-card__eyebrow')).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/es\/products\/fronteras-t-shirt\/$/);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', /\/products\/fronteras-t-shirt\/$/);
    await expect(page.locator('h1')).toContainText('Fronteras T-Shirt');

    const card = page.locator('.storefront__product-detail > .store-product-card').first();
    await expect(card).toBeVisible();
    await expect(card.locator('.store-product-card__title')).toHaveCount(0);
    await expect(card.locator('.store-product-card__description')).toHaveCount(0);
    await expect(card.locator('.store-product-card__label').filter({ hasText: 'Talla' })).toBeVisible();
    await expect(card.locator('.store-product-card__label').filter({ hasText: 'Cantidad' })).toBeVisible();
    await expect(card.locator('button.store-add-item')).toHaveText(/Añadir al carrito - \$30/i);
    await expect(page.getByRole('link', { name: 'English' })).toHaveAttribute('href', '/products/fronteras-t-shirt/');
    await expect(page.getByRole('link', { name: 'Español' })).toHaveAttribute('aria-current', 'page');
    await expectNoHorizontalOverflow(page);
  });

  test('product availability warning follows selected variant inventory', async ({ page }) => {
    await gotoDomReady(page, '/');

    const card = await firstProductCard(page);
    const variantSelect = card.locator('[data-store-variant-select]');
    await variantSelect.evaluate((select: HTMLSelectElement) => {
      const option = select.options[select.selectedIndex];
      option.setAttribute('data-inventory', '3');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(card.locator('[data-store-availability]')).toHaveText('Only 3 left');
    await expect(card.locator('[data-store-availability]')).toHaveAttribute('data-store-inventory-state', 'low');
    await expect(card.locator('button.store-add-item')).toHaveAttribute('data-product-inventory', '3');
    await expectNoHorizontalOverflow(page);
  });

  test('product quantity stepper updates the card button total', async ({ page }) => {
    await gotoDomReady(page, '/');

    const card = await firstProductCard(page);
    await card.locator('[data-store-quantity-step="1"]').click();

    await expect(card.locator('[data-store-quantity]')).toHaveValue('2');
    await expect(card.locator('[data-store-price]')).toHaveText('$30');
    await expect(card.locator('button.store-add-item')).toHaveText(/Add to Cart - \$60/i);

    await card.locator('[data-store-quantity-step="-1"]').click();
    await expect(card.locator('[data-store-quantity]')).toHaveValue('1');
    await expect(card.locator('button.store-add-item')).toHaveText(/Add to Cart - \$30/i);
  });

  test('cart quantity controls update item quantity and order totals', async ({ page }) => {
    await gotoDomReady(page, '/');

    const card = await firstProductCard(page);
    await card.locator('[data-store-quantity-step="1"]').click();
    await card.locator('button.store-add-item').click();

    const cart = page.locator(CART_ROOT);
    await expect(cart).toBeVisible();
    await expect(cart).toContainText('Fronteras T-Shirt');
    await expect(cart.locator('input[type="number"]').first()).toHaveValue('2');
    await expect(cart).toContainText('Subtotal $60.00');

    await cart.locator('button', { hasText: '+' }).click();
    await expect(cart.locator('input[type="number"]').first()).toHaveValue('3');
    await expect(cart).toContainText('Subtotal $90.00');

    await cart.locator('button', { hasText: '-' }).click();
    await expect(cart.locator('input[type="number"]').first()).toHaveValue('2');
    await expect(cart).toContainText('Subtotal $60.00');
    await expectNoHorizontalOverflow(page);
  });

  test('order lookup sends a generic email response and renders token results', async ({ page }) => {
    const lookupCalls: any[] = [];
    await page.route('**/api/orders/lookup**', async (route: any) => {
      const request = route.request();
      const url = new URL(request.url());
      const fulfillJson = (payload: Record<string, any>, status = 200) => route.fulfill({
        status,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': SITE_BASE,
          'access-control-allow-credentials': 'true'
        },
        body: JSON.stringify(payload)
      });

      if (request.method() === 'POST') {
        const body = JSON.parse(request.postData() || '{}');
        lookupCalls.push(body);
        return fulfillJson({
          ok: true,
          message: 'If that email has Shop orders, a secure lookup link has been sent.'
        });
      }

      if (request.method() === 'GET' && url.searchParams.get('token') === 'lookup-token') {
        return fulfillJson({
          ok: true,
          orders: [{
            orderToken: 'store-order-demo123',
            status: 'confirmed',
            fulfillmentReady: true,
            confirmedAt: '2026-06-11T18:00:00.000Z',
            totalCents: 3500,
            currency: 'USD',
            itemCount: 1,
            orderUrl: '/order-success/?orderToken=store-order-demo123',
            items: [{
              name: 'Fronteras Poster (Big)',
              variantLabel: '',
              quantity: 1,
              subtotalCents: 3500,
              fulfillmentType: 'physical'
            }]
          }]
        });
      }

      return fulfillJson({ error: 'Unexpected lookup request' }, 500);
    });

    await gotoDomReady(page, '/orders/');
    await expect(page.locator('h1')).toContainText('Find your order');
    await page.getByLabel('Email address').fill('customer@example.com');
    await page.getByRole('button', { name: 'Email lookup link' }).click();

    await expect(page.locator('[data-store-order-lookup-status]')).toContainText('If that email has Shop orders');
    expect(lookupCalls).toEqual([{ email: 'customer@example.com' }]);

    await gotoDomReady(page, '/orders/?token=lookup-token');
    await expect(page.locator('[data-store-order-lookup-status]')).toContainText('Lookup link verified.');
    await expect(page.locator('.store-order-lookup__order')).toContainText('Fronteras Poster (Big)');
    await expect(page.locator('.store-order-lookup__order')).toContainText('$35.00');
    await expect(page.getByRole('link', { name: 'View order' })).toHaveAttribute('href', /order-success\/\?orderToken=store-order-demo123/);
    await expectNoHorizontalOverflow(page);
  });

  test('supports keyboard-only product add-to-cart flow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDomReady(page, '/');

    const card = await firstProductCard(page);
    const increase = card.locator('[data-store-quantity-step="1"]');
    const addButton = card.locator('button.store-add-item');

    await increase.focus();
    await expect(increase).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(card.locator('[data-store-quantity]')).toHaveValue('2');

    await addButton.focus();
    await expect(addButton).toBeFocused();
    await page.keyboard.press('Enter');

    const cart = page.locator(CART_ROOT);
    await expect(cart).toBeVisible();
    await expect(cart).toContainText('Fronteras T-Shirt');
    await expect(cart.locator('input[type="number"]').first()).toHaveValue('2');
    await expectNoHorizontalOverflow(page);
  });
});

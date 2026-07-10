import { test, expect } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers/mobile';
import { gotoDomReady } from './helpers/navigation';

const SITE_BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4002';

async function focusedElementSummary(page: any) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element) return null;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      tagName: element.tagName.toLowerCase(),
      text: element.textContent?.replace(/\s+/g, ' ').trim() || '',
      ariaLabel: element.getAttribute('aria-label') || '',
      role: element.getAttribute('role') || '',
      id: element.id || '',
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
      borderColor: style.borderColor
    };
  });
}

function hasVisibleFocusStyle(summary: any) {
  if (!summary) return false;
  const outlineWidth = Number.parseFloat(String(summary.outlineWidth || '0'));
  return outlineWidth > 0 ||
    !['none', 'auto', ''].includes(String(summary.outlineStyle || '')) ||
    String(summary.boxShadow || '') !== 'none';
}

test.describe('Release Accessibility Evidence', () => {
  test('release focus order reaches named purchase controls with visible focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDomReady(page, '/');
    await expect(page.locator('main')).toBeVisible();

    let foundAddToCart = false;
    const visited = [];
    for (let index = 0; index < 35; index += 1) {
      await page.keyboard.press('Tab');
      const focused = await focusedElementSummary(page);
      if (focused?.visible) visited.push(focused.text || focused.ariaLabel || focused.id || focused.tagName);
      if (/Add to Cart/i.test(focused?.text || focused?.ariaLabel || '')) {
        foundAddToCart = true;
        expect(focused.visible).toBe(true);
        expect(hasVisibleFocusStyle(focused)).toBe(true);
        break;
      }
    }

    expect(foundAddToCart, `Visited focusables: ${visited.join(' -> ')}`).toBe(true);
    await expectNoHorizontalOverflow(page);
  });

  test('release live status regions announce order lookup state changes', async ({ page }) => {
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
    const status = page.locator('[data-store-order-lookup-status]');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveAttribute('aria-live', 'polite');

    await page.getByLabel('Email address').fill('customer@example.com');
    await page.getByRole('button', { name: 'Email lookup link' }).click();
    await expect(status).toContainText('If that email has Shop orders');
    await expectNoHorizontalOverflow(page);
  });

  test('release reduced motion preference keeps checkout surfaces usable', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoDomReady(page, '/');
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('[data-store-cart-root]')).toHaveCount(1);
    await expect(page.locator('.store-product-card').first()).toBeVisible();
    await expect(page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).resolves.toBe(true);
    await expectNoHorizontalOverflow(page);
  });
});

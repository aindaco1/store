import type { Page } from '@playwright/test';
import { gotoDomReady } from './navigation';

// General cart/RSVP browser tests do not need a live inventory reservation.
// Checkout lifecycle and contention have dedicated Worker and browser suites.
export async function routeCheckoutHold(page: Page) {
  await page.route('**/api/checkout/hold', async (route) => {
    await route.fulfill({ json: {
      success: true, attemptId: route.request().postDataJSON().attemptId,
      phase: 'held', heldQuantity: 0, extensionsRemaining: 10,
      serverTime: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString()
    } });
  });
}

// Checkout interaction tests mock the Worker and use a stable $20 ticket.
// Keep the real catalog's archived status: enable this sample only in this page.
export async function gotoCheckoutProduct(page: Page, url: string) {
  await gotoDomReady(page, url);
  if (!url.endsWith('/products/a-night-in-paradiso/')) return;
  await page.locator('.store-add-item').first().evaluate((element) => {
    const button = element as HTMLButtonElement;
    button.dataset.productStatus = 'active';
    button.dataset.productBaseStatus = 'active';
    button.disabled = false;
    button.removeAttribute('aria-disabled');
  });
}

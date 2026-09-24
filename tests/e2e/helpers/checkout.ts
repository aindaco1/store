import type { Page } from '@playwright/test';

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

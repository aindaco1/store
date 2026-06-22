import { describe, expect, it } from 'vitest';
import { STORE_CART_ITEM, burstRequests, expectStatusIn, securityFetch } from './helpers';

describe('Store rate limiting and resilience', () => {
  it('handles Store cart validation bursts without server errors', async () => {
    const responses = await burstRequests(() => securityFetch('/api/cart/validate', {
      method: 'POST',
      body: JSON.stringify({ items: [STORE_CART_ITEM] })
    }), 8);

    for (const res of responses) {
      expectStatusIn(res, [200, 429], 'cart validation burst');
    }
  });

  it('throttles or rejects admin auth brute force attempts without leaking success', async () => {
    const responses = await burstRequests(() => securityFetch('/admin/auth/start', {
      method: 'POST',
      body: JSON.stringify({ email: 'attacker@example.com' })
    }), 12);

    for (const res of responses) {
      expectStatusIn(res, [200, 400, 401, 403, 429], 'admin auth burst');
    }
    expect(responses.some((res) => res.status === 429 || res.status === 400 || res.status === 403)).toBe(true);
  });

  it('answers rapid CORS preflight checks cleanly', async () => {
    const responses = await burstRequests(() => securityFetch('/api/checkout/intent', {
      method: 'OPTIONS'
    }), 10);

    for (const res of responses) {
      expectStatusIn(res, [200, 204], 'checkout preflight burst');
    }
  });
});

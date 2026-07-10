import { describe, expect, it } from 'vitest';
import { MALICIOUS_STRINGS, STORE_CART_ITEM, expectStatusIn, securityFetch } from './helpers';

describe('Store input validation', () => {
  it('rejects tampered Store cart prices', async () => {
    const res = await securityFetch('/api/cart/validate', {
      method: 'POST',
      body: JSON.stringify({
        items: [{
          ...STORE_CART_ITEM,
          price: 1
        }]
      })
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(JSON.stringify(body.errors || [])).toContain('price_mismatch');
  });

  it('fails closed for malformed Store checkout payloads', async () => {
    const res = await securityFetch('/api/checkout/intent', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ id: 'not-a-real-product', quantity: 1 }]
      })
    });

    expectStatusIn(res, [400, 401, 422, 503], 'malformed checkout');
  });

  it.each(MALICIOUS_STRINGS)('does not accept malicious product IDs: %s', async (value) => {
    const res = await securityFetch('/api/cart/validate', {
      method: 'POST',
      body: JSON.stringify({
        items: [{
          id: value,
          price: 30,
          quantity: 1
        }]
      })
    });

    expectStatusIn(res, [400, 422], value);
  });

  it('rejects non-JSON Store write payloads', async () => {
    const res = await securityFetch('/api/cart/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'items=t-shirt-2'
    });

    expectStatusIn(res, [400, 415], 'non-json cart validation');
  });

  it('rejects malformed Store order lookup emails', async () => {
    const res = await securityFetch('/api/orders/lookup', {
      method: 'POST',
      body: JSON.stringify({
        email: 'not-an-email'
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid email format');
  });

  it('rejects oversized Store request bodies before parsing', async () => {
    const largeBody = JSON.stringify({
      items: Array.from({ length: 8000 }, (_, index) => ({
        id: `t-shirt-2__m-${index}`,
        price: 30,
        quantity: 1
      }))
    });

    const res = await securityFetch('/api/cart/validate', {
      method: 'POST',
      body: largeBody
    });

    expect(res.status).toBe(413);
  });

  it('handles malicious shipping and tax destinations without crashing', async () => {
    for (const [endpoint, body] of [
      ['/shipping/quote', {
        items: [STORE_CART_ITEM],
        destination: { country: '<script>', postalCode: '../../../etc/passwd' }
      }],
      ['/tax/quote', {
        subtotalCents: 2500,
        shippingAddress: { country: 'US', postalCode: "'; DROP TABLE orders; --" }
      }]
    ] as const) {
      const res = await securityFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
      });

      expect(res.status).toBe(400);
    }
  });
});

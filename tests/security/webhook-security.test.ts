import { describe, expect, it } from 'vitest';
import { generateFakeStripeSignature, securityFetch } from './helpers';

describe('Store webhook security', () => {
  const fakeStoreEvent = {
    id: 'evt_fake_store_123',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        id: 'cs_fake_store_123',
        mode: 'payment',
        customer: 'cus_fake',
        customer_email: 'attacker@example.com',
        payment_intent: 'pi_fake',
        metadata: {
          flow: 'store_order',
          orderId: 'store-order-malicious',
          orderToken: 'store-order-malicious',
          orderDraftKey: 'store-order-draft:malicious'
        }
      }
    }
  };

  it('rejects Stripe webhooks without a signature', async () => {
    const res = await securityFetch('/webhooks/stripe', {
      method: 'POST',
      body: JSON.stringify(fakeStoreEvent)
    });

    expect([401, 500]).toContain(res.status);
  });

  it('rejects Stripe webhooks with invalid signatures', async () => {
    const res = await securityFetch('/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': generateFakeStripeSignature()
      },
      body: JSON.stringify(fakeStoreEvent)
    });

    expect(res.status).toBe(401);
  });

  it('rejects forged webhook payloads with malicious shipping details before processing', async () => {
    const payload = JSON.stringify({
      ...fakeStoreEvent,
      data: {
        object: {
          ...fakeStoreEvent.data.object,
          shipping_details: {
            name: '<script>alert(1)</script>',
            address: {
              line1: "'; DROP TABLE orders; --",
              city: '../../../etc/passwd',
              state: 'NM',
              postal_code: '87101',
              country: 'US'
            }
          }
        }
      }
    });

    const res = await securityFetch('/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': generateFakeStripeSignature()
      },
      body: payload
    });

    expect(res.status).toBe(401);
  });

  it('rejects oversized Stripe webhook bodies before parsing', async () => {
    const res = await securityFetch('/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': generateFakeStripeSignature()
      },
      body: JSON.stringify({
        ...fakeStoreEvent,
        padding: 'A'.repeat(300 * 1024)
      })
    });

    expect(res.status).toBe(413);
  });
});

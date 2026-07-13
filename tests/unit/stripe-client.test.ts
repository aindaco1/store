import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STRIPE_API_VERSION, StripeApiError, createStripeClient } from '../../worker/src/stripe.js';

describe('Stripe Worker client integrity', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pins the API version, carries idempotency, flattens metadata, and emits redacted observations', async () => {
    const observations: unknown[] = [];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'pi_123', object: 'payment_intent' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Request-Id': 'req_123' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const stripe = createStripeClient('sk_test_secret', { onRequest: (event: unknown) => observations.push(event) });
    await stripe.paymentIntents.create({ amount: 1200, currency: 'usd', metadata: { orderId: 'order-1' } }, { idempotencyKey: 'store-order:order-1' });
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('Stripe-Version')).toBe(DEFAULT_STRIPE_API_VERSION);
    expect(headers.get('Idempotency-Key')).toBe('store-order:order-1');
    expect(String(init?.body)).toContain('metadata%5BorderId%5D=order-1');
    expect(observations).toEqual([expect.objectContaining({
      path: '/payment_intents', success: true, status: 200, requestId: 'req_123', objectId: 'pi_123'
    })]);
    expect(JSON.stringify(observations)).not.toContain('sk_test_secret');
  });

  it('normalizes Stripe decline details for durable recovery decisions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: {
      type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card was declined.',
      payment_intent: { id: 'pi_failed' }
    } }), { status: 402, headers: { 'Request-Id': 'req_failed' } })));
    const stripe = createStripeClient('sk_test_secret');
    await expect(stripe.paymentIntents.create({ amount: 1200, currency: 'usd' }, { idempotencyKey: 'store-order:failed' }))
      .rejects.toMatchObject<Partial<StripeApiError>>({
        name: 'StripeApiError', type: 'card_error', code: 'card_declined', declineCode: 'insufficient_funds',
        statusCode: 402, requestId: 'req_failed', objectId: 'pi_failed', retryable: false
      });
  });

  it('classifies no-response failures as retryable without claiming an object id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket reset'); }));
    const stripe = createStripeClient('sk_test_secret');
    await expect(stripe.customers.create({ email: 'customer@example.com' }, { idempotencyKey: 'customer:order-1' }))
      .rejects.toMatchObject({ name: 'StripeApiError', type: 'network_error', retryable: true, objectId: '' });
  });
});

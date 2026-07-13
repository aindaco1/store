import { describe, expect, it, vi } from 'vitest';
import {
  PROCESSOR_EVENT_RETENTION_SECONDS,
  createStoreStripeClient,
  recordStripeProcessorEvent,
  storeReconciliationBreak
} from '../../worker/src/payment-integrity.js';

describe('Store payment integrity evidence', () => {
  it('stores a bounded redacted processor event for 400 days', async () => {
    const put = vi.fn();
    const result = await recordStripeProcessorEvent({ STORE_STATE: { put } }, {
      method: 'POST',
      path: '/payment_intents?customer=secret',
      success: false,
      status: 500,
      errorType: 'api_error',
      errorCode: 'temporary',
      idempotencyKey: 'store-order:one'
    }, { operation: 'checkout', orderToken: 'one', mode: 'test' });

    expect(result.stored).toBe(true);
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^processor-event:v1:/),
      expect.not.stringContaining('customer=secret'),
      { expirationTtl: PROCESSOR_EVENT_RETENTION_SECONDS }
    );
    expect(JSON.parse(put.mock.calls[0][1])).toMatchObject({
      orderToken: 'one',
      path: '/payment_intents',
      status: 500,
      reconciliationStatus: 'unreviewed'
    });
  });

  it('connects Stripe request observations to STORE_STATE without changing API behavior', async () => {
    const put = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'pi_store', object: 'payment_intent', status: 'requires_payment_method'
    }), { status: 200, headers: { 'request-id': 'req_store' } })));

    const client = createStoreStripeClient({ STORE_STATE: { put } }, 'sk_test_example', {
      operation: 'checkout', orderToken: 'store-order-one', intent: 'create'
    });
    const paymentIntent = await client.paymentIntents.create({ amount: 100, currency: 'usd' }, { idempotencyKey: 'store-order:one' });

    expect(paymentIntent.id).toBe('pi_store');
    expect(put).toHaveBeenCalledOnce();
    expect(JSON.parse(put.mock.calls[0][1])).toMatchObject({
      objectId: 'pi_store',
      requestId: 'req_store',
      idempotencyKey: 'store-order:one',
      mode: 'test'
    });
    vi.unstubAllGlobals();
  });

  it('stores open and resolved reconciliation breaks without provider payloads', async () => {
    const put = vi.fn();
    const result = await storeReconciliationBreak({ STORE_STATE: { put } }, {
      orderToken: 'order-one',
      paymentIntentId: 'pi_one',
      reasons: ['amount_mismatch'],
      severity: 'critical',
      source: 'scheduled'
    });
    expect(result.record).toMatchObject({ status: 'open', severity: 'critical', reasons: ['amount_mismatch'] });
    expect(put.mock.calls[0][0]).toBe('reconciliation-break:v1:order-one');
  });
});

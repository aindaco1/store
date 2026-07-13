import { describe, expect, it, vi } from 'vitest';
import { ADMIN_STORE_ORDER_INDEX_KEY } from '../../worker/src/admin-store-read-model.js';
import { reconciliationKey } from '../../worker/src/payment-integrity.js';
import {
  compareStoreOrderToPaymentIntent,
  reconcileIndexedStorePayments,
  STORE_PAYMENT_RECONCILIATION_ALGORITHM_VERSION,
  STORE_PAYMENT_RECONCILIATION_STATE_KEY
} from '../../worker/src/store-payment-reconciliation.js';

function memoryKv(seed: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  return {
    values,
    get: vi.fn(async (key: string, options?: { type?: string }) => {
      const value = values.get(key);
      if (value === undefined) return null;
      return options?.type === 'json' ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    delete: vi.fn(async (key: string) => { values.delete(key); })
  };
}

function paidOrder() {
  return {
    orderToken: 'store-order-one',
    status: 'confirmed',
    totals: { totalCents: 1200, currency: 'USD' },
    payment: {
      required: true,
      provider: 'stripe',
      status: 'succeeded',
      paymentIntentId: 'pi_one',
      amountCents: 1200,
      currency: 'USD'
    }
  };
}

describe('bounded Store payment reconciliation', () => {
  it('classifies amount, currency, and state mismatches as critical', () => {
    expect(compareStoreOrderToPaymentIntent(paidOrder(), {
      id: 'pi_one', amount: 1100, currency: 'eur', status: 'requires_payment_method'
    })).toEqual({
      applicable: true,
      severity: 'critical',
      reasons: expect.arrayContaining([
        'amount_mismatch',
        'currency_mismatch',
        'confirmed_without_succeeded_processor_payment',
        'stored_succeeded_status_mismatch'
      ])
    });
  });

  it('uses the fixed order index, stores a break, and later resolves it without a namespace scan', async () => {
    const order = paidOrder();
    const kv = memoryKv({
      [ADMIN_STORE_ORDER_INDEX_KEY]: {
        version: 2,
        generatedAt: '2026-07-13T00:00:00.000Z',
        watermark: 'orders-v2-0123456789abcdef',
        orders: [order]
      },
      'orders:store-order-one': order
    });
    const retrieve = vi.fn()
      .mockResolvedValueOnce({ id: 'pi_one', amount: 1000, currency: 'usd', status: 'succeeded' })
      .mockResolvedValueOnce({ id: 'pi_one', amount: 1200, currency: 'usd', status: 'succeeded' });

    const first = await reconcileIndexedStorePayments({ STORE_STATE: kv }, {
      force: true,
      source: 'test',
      stripe: { paymentIntents: { retrieve } },
      now: new Date('2026-07-13T01:00:00.000Z')
    });
    expect(first).toMatchObject({ attempted: true, processed: 1, open: 1, cycleComplete: true });
    expect(JSON.parse(kv.values.get(reconciliationKey('store-order-one')) || '{}')).toMatchObject({
      status: 'open', reasons: ['amount_mismatch'], occurrenceCount: 1
    });

    const second = await reconcileIndexedStorePayments({ STORE_STATE: kv }, {
      force: true,
      source: 'test',
      stripe: { paymentIntents: { retrieve } },
      now: new Date('2026-07-13T02:00:00.000Z')
    });
    expect(second).toMatchObject({ attempted: true, processed: 1, open: 0, resolved: 1 });
    expect(JSON.parse(kv.values.get(reconciliationKey('store-order-one')) || '{}')).toMatchObject({
      status: 'resolved', occurrenceCount: 1
    });
    expect(JSON.parse(kv.values.get(STORE_PAYMENT_RECONCILIATION_STATE_KEY) || '{}')).toMatchObject({
      status: 'idle', cursor: 0
    });
    expect((kv as Record<string, unknown>).list).toBeUndefined();
  });

  it('treats historical non-Stripe orders as non-applicable and resolves stale Stripe breaks', async () => {
    const order = {
      ...paidOrder(),
      payment: {
        required: true,
        provider: 'snipcart',
        status: 'succeeded',
        amountCents: 1200,
        currency: 'USD'
      }
    };
    expect(compareStoreOrderToPaymentIntent(order)).toEqual({
      reasons: [],
      severity: 'info',
      applicable: false,
      disposition: 'non_stripe_order'
    });

    const kv = memoryKv({
      [ADMIN_STORE_ORDER_INDEX_KEY]: {
        version: 2,
        watermark: 'orders-v2-historical',
        orders: [order]
      },
      'orders:store-order-one': order,
      [reconciliationKey('store-order-one')]: {
        status: 'open',
        severity: 'critical',
        occurrenceCount: 1,
        reasons: ['payment_intent_missing']
      },
      [STORE_PAYMENT_RECONCILIATION_STATE_KEY]: {
        version: 1,
        algorithmVersion: 1,
        watermark: 'orders-v2-historical',
        cursor: 0,
        lastCycleCompletedAt: '2026-07-13T01:30:00.000Z'
      }
    });
    const retrieve = vi.fn();

    const result = await reconcileIndexedStorePayments({ STORE_STATE: kv }, {
      source: 'test',
      stripe: { paymentIntents: { retrieve } },
      now: new Date('2026-07-13T02:00:00.000Z')
    });

    expect(result).toMatchObject({ attempted: true, processed: 1, open: 0, resolved: 1 });
    expect(retrieve).not.toHaveBeenCalled();
    expect(JSON.parse(kv.values.get(reconciliationKey('store-order-one')) || '{}')).toMatchObject({
      status: 'resolved', occurrenceCount: 1
    });
    expect(JSON.parse(kv.values.get(STORE_PAYMENT_RECONCILIATION_STATE_KEY) || '{}')).toMatchObject({
      status: 'idle',
      algorithmVersion: STORE_PAYMENT_RECONCILIATION_ALGORITHM_VERSION,
      cursor: 0
    });
  });
});

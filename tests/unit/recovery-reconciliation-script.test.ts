import { describe, expect, it, vi } from 'vitest';

import {
  reconcileCapturedStoreOrders,
  recoveryReconciliationGate,
  stripeCredentialMode
} from '../../scripts/recovery-reconciliation.mjs';

function order(overrides: Record<string, unknown> = {}) {
  return {
    orderToken: 'store-order-recovery',
    status: 'confirmed',
    orderDraft: {
      status: 'confirmed',
      totals: { totalCents: 2500, currency: 'USD' },
      items: [{ sku: 'poster', quantity: 2, fulfillmentType: 'physical' }],
      customer: { email: 'private@example.com' }
    },
    payment: {
      required: true,
      provider: 'stripe',
      status: 'succeeded',
      amountCents: 2500,
      currency: 'USD',
      paymentIntentId: 'pi_private'
    },
    ...overrides
  };
}

describe('captured Store recovery reconciliation evidence', () => {
  it('emits only aggregate inventory and read-only Stripe comparison evidence', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer sk_test_private' });
      return new Response(JSON.stringify({
        id: 'pi_private',
        status: 'succeeded',
        amount: 2500,
        currency: 'usd',
        metadata: { orderToken: 'store-order-recovery' }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const result = await reconcileCapturedStoreOrders([order()], {
      stripeMode: 'required',
      stripeSecretKey: 'sk_test_private',
      expectedStripeMode: 'test',
      fetchImpl
    });

    expect(result).toMatchObject({
      containsCredentials: false,
      containsCustomerData: false,
      containsOrderIds: false,
      containsProviderIds: false,
      providerWritesExecuted: false,
      orders: { total: 1, confirmedForInventory: 1, soldSkus: 1, soldQuantity: 2 },
      stripe: { state: 'complete', compared: 1, matches: 1, mismatches: 0 }
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private@example.com');
    expect(serialized).not.toContain('store-order-recovery');
    expect(serialized).not.toContain('pi_private');
    expect(serialized).not.toContain('sk_test_private');
  });

  it('reports bounded mismatch categories and no provider writes', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 }));
    const result = await reconcileCapturedStoreOrders([order(), order({ orderToken: 'store-order-second' })], {
      stripeSecretKey: 'sk_test_private',
      maximumStripeRequests: 1,
      fetchImpl
    });
    expect(result.stripe).toMatchObject({
      state: 'bounded',
      paidOrders: 2,
      candidates: 1,
      compared: 1,
      mismatches: 1,
      providerUnavailable: 0,
      providerNotFound: 1,
      truncated: true,
      mismatchReasons: { provider_payment_intent_not_found: 1 }
    });
    expect(result.providerWritesExecuted).toBe(false);
  });

  it('fails before provider access when required Stripe credentials are unavailable', async () => {
    await expect(reconcileCapturedStoreOrders([order()], {
      stripeMode: 'required',
      stripeSecretKey: ''
    })).rejects.toThrow(/credential/i);
  });

  it('fails before provider access when the credential mode does not match the drill', async () => {
    const fetchImpl = vi.fn();
    await expect(reconcileCapturedStoreOrders([order()], {
      stripeMode: 'required',
      stripeSecretKey: 'sk_test_private',
      expectedStripeMode: 'live',
      fetchImpl
    })).rejects.toThrow(/live-mode read credential/i);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(stripeCredentialMode('rk_live_private')).toBe('live');
    expect(stripeCredentialMode('sk_test_private')).toBe('test');
  });

  it('does not classify non-Stripe paid orders as Stripe reconciliation candidates', async () => {
    const result = await reconcileCapturedStoreOrders([order({
      payment: { required: true, provider: 'snipcart', status: 'succeeded' }
    })], { stripeMode: 'off' });
    expect(result.stripe).toMatchObject({ stripeOrders: 0, candidates: 0, compared: 0 });
  });

  it('fails the strict gate for bounded coverage or provider failures', async () => {
    const bounded = await reconcileCapturedStoreOrders([order({
      payment: { required: true, provider: 'stripe', status: 'succeeded' }
    })], { stripeMode: 'available', stripeSecretKey: 'sk_test_private' });
    expect(bounded.stripe).toMatchObject({ state: 'bounded', candidates: 0, stripeOrders: 1 });
    expect(recoveryReconciliationGate(bounded, 'required')).toEqual({
      passed: false,
      reasons: ['stripe_comparison_incomplete']
    });

    const unavailable = await reconcileCapturedStoreOrders([order()], {
      stripeMode: 'required',
      stripeSecretKey: 'sk_test_private',
      expectedStripeMode: 'test',
      fetchImpl: vi.fn(async () => { throw new Error('provider unavailable'); })
    });
    expect(unavailable.stripe).toMatchObject({
      state: 'complete',
      mismatches: 1,
      providerUnavailable: 1,
      mismatchReasons: { provider_unavailable: 1 }
    });
    expect(recoveryReconciliationGate(unavailable, 'required')).toMatchObject({ passed: false });
    expect(recoveryReconciliationGate(unavailable, 'off')).toEqual({ passed: true, reasons: [] });
  });
});

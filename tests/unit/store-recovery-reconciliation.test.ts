import { describe, expect, it } from 'vitest';

import {
  buildExpectedStoreRecoveryInventory,
  buildStoreInventoryRecoveryReconciliation,
  compareStoreOrderToStripePaymentIntent,
  storeRecoveryFingerprint
} from '../../worker/src/store-recovery-reconciliation.js';

describe('Store recovery reconciliation', () => {
  it('derives claimed inventory from confirmed-order sold counts and reports unsafe gaps', () => {
    const expected = buildExpectedStoreRecoveryInventory({
      poster: { limit: 10, claimed: 0, productId: 'poster' },
      ticket: { limit: 2, claimed: 0, productId: 'ticket' }
    }, { poster: 3, ticket: 4, removed: 1 });
    expect(expected).toMatchObject({
      inventory: {
        poster: { limit: 10, claimed: 3 },
        ticket: { limit: 2, claimed: 4 }
      },
      totals: { skus: 2, claimed: 7, orphanedSoldSkus: 1, overLimitSkus: 1 },
      orphanedSoldSkus: ['removed'],
      overLimitSkus: ['ticket']
    });
  });

  it('compares current coordinator state and includes transient reservation risk', () => {
    const expected = buildExpectedStoreRecoveryInventory({ poster: { limit: 10 } }, { poster: 3 });
    const result = buildStoreInventoryRecoveryReconciliation({
      inventory: { poster: { limit: 10, claimed: 2 } },
      reservedCounts: { poster: 1 }
    }, expected);
    expect(result).toMatchObject({
      matches: false,
      differences: [{ sku: 'poster', currentClaimed: 2, expectedClaimed: 3 }],
      totals: { differingSkus: 1, reservedSkus: 1, reservedQuantity: 1 }
    });
  });

  it('fingerprints equivalent plans deterministically without relying on object insertion order', async () => {
    await expect(storeRecoveryFingerprint({ b: 2, a: { y: 2, x: 1 } })).resolves.toBe(
      await storeRecoveryFingerprint({ a: { x: 1, y: 2 }, b: 2 })
    );
  });

  it('performs a read-only Stripe comparison without returning provider or order payloads', () => {
    expect(compareStoreOrderToStripePaymentIntent({
      payment: { required: true, provider: 'snipcart', status: 'succeeded' }
    }, null)).toEqual({ compared: false, matches: true, reasons: [] });

    const match = compareStoreOrderToStripePaymentIntent({
      orderToken: 'store-order-1',
      totals: { totalCents: 2500, currency: 'USD' },
      payment: { required: true, provider: 'stripe', status: 'succeeded', amountCents: 2500, currency: 'USD', paymentIntentId: 'pi_1' }
    }, {
      id: 'pi_1', status: 'succeeded', amount: 2500, currency: 'usd', metadata: { orderToken: 'store-order-1' }
    });
    expect(match).toEqual({ compared: true, matches: true, reasons: [] });

    const mismatch = compareStoreOrderToStripePaymentIntent({
      orderToken: 'store-order-1',
      totals: { totalCents: 2500, currency: 'USD' },
      payment: { required: true, provider: 'stripe', status: 'succeeded', amountCents: 2500, currency: 'USD', paymentIntentId: 'pi_1' }
    }, {
      id: 'pi_1', status: 'requires_payment_method', amount: 2600, currency: 'eur', metadata: { orderToken: 'store-order-other' }
    });
    expect(mismatch.matches).toBe(false);
    expect(mismatch.reasons).toEqual([
      'amount_mismatch',
      'currency_mismatch',
      'settlement_status_mismatch',
      'provider_order_token_mismatch'
    ]);
    expect(JSON.stringify(mismatch)).not.toContain('pi_1');
    expect(JSON.stringify(mismatch)).not.toContain('store-order-1');
  });
});

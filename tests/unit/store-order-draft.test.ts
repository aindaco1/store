import { describe, expect, it } from 'vitest';

import { buildStoreOrderDraft } from '../../worker/src/orders.js';

describe('Store order draft totals', () => {
  it('recomputes platform tips from validated catalog subtotal', () => {
    const result = buildStoreOrderDraft({
      items: [
        {
          id: 't-shirt-2__m',
          price: 30,
          quantity: 2
        }
      ],
      tipPercent: 5
    }, {
      shippingCents: 955,
      taxCents: 458
    });

    expect(result.ok).toBe(true);
    expect(result.orderDraft?.totals).toMatchObject({
      subtotalCents: 6000,
      tipPercent: 5,
      tipAmountCents: 300,
      shippingCents: 955,
      taxCents: 458,
      totalCents: 7713,
      requiresPayment: true
    });
  });

  it('allows max platform tip percent to disable tips', () => {
    const result = buildStoreOrderDraft({
      items: [
        {
          id: 't-shirt-2__m',
          price: 30,
          quantity: 1
        }
      ],
      tipPercent: 10
    }, {
      env: {
        DEFAULT_PLATFORM_TIP_PERCENT: '5',
        MAX_PLATFORM_TIP_PERCENT: '0'
      }
    });

    expect(result.ok).toBe(true);
    expect(result.orderDraft?.totals).toMatchObject({
      subtotalCents: 3000,
      tipPercent: 0,
      tipAmountCents: 0,
      totalCents: 3000
    });
  });
});

import { describe, expect, it } from 'vitest';

import {
  applyStoreCouponCode,
  applyStoreCouponToValidation,
  normalizeStoreCoupon,
  saveStoreCoupons,
  STORE_COUPONS_STORAGE_KEY,
  upsertStoreCoupon
} from '../../worker/src/coupons.js';
import { buildStoreOrderDraft } from '../../worker/src/orders.js';

function memoryEnv() {
  const values = new Map<string, string>();
  return {
    STORE_STATE: {
      async get(key: string, options?: { type?: string }) {
        const value = values.get(key) || null;
        return options?.type === 'json' && value ? JSON.parse(value) : value;
      },
      async put(key: string, value: string) {
        values.set(key, value);
      }
    },
    values
  };
}

const validation = {
  valid: true,
  errors: [],
  warnings: [],
  items: [
    {
      productId: 'shirt',
      variantId: '',
      sku: 'shirt',
      name: 'Shirt',
      quantity: 1,
      unitPriceCents: 3000,
      subtotalCents: 3000,
      currency: 'USD',
      fulfillmentType: 'physical',
      shippable: true,
      taxCategory: 'standard'
    },
    {
      productId: 'poster',
      variantId: '',
      sku: 'poster',
      name: 'Poster',
      quantity: 1,
      unitPriceCents: 2000,
      subtotalCents: 2000,
      currency: 'USD',
      fulfillmentType: 'physical',
      shippable: true,
      taxCategory: 'standard'
    }
  ],
  totals: {
    itemCount: 2,
    subtotalCents: 5000,
    requiresPayment: true,
    requiresShipping: true,
    requiresTurnstile: false
  },
  catalog: {
    version: 1,
    source: 'test',
    sourceHash: 'test'
  }
};

describe('Store coupons', () => {
  it('normalizes coupon definitions', () => {
    const result = normalizeStoreCoupon({
      code: ' save-10 ',
      status: 'active',
      discountType: 'percent',
      percentOff: 10,
      appliesTo: 'cart'
    });

    expect(result.ok).toBe(true);
    expect(result.coupon).toMatchObject({
      id: 'save-10',
      code: 'SAVE-10',
      percentOff: 10,
      appliesTo: 'cart'
    });
  });

  it('applies percent discounts to the whole cart', () => {
    const applied = applyStoreCouponToValidation(validation, {
      code: 'SAVE10',
      status: 'active',
      discountType: 'percent',
      percentOff: 10,
      appliesTo: 'cart'
    });

    expect(applied.ok).toBe(true);
    expect(applied.validation.totals).toMatchObject({
      subtotalCents: 5000,
      discountCents: 500,
      discountedSubtotalCents: 4500,
      taxableSubtotalCents: 4500
    });
    expect(applied.validation.items.map((item: any) => item.discountCents)).toEqual([300, 200]);
  });

  it('caps fixed discounts at eligible product subtotal', () => {
    const applied = applyStoreCouponToValidation(validation, {
      code: 'POSTER50',
      status: 'active',
      discountType: 'amount',
      amountOffCents: 5000,
      appliesTo: 'products',
      productIds: ['poster']
    });

    expect(applied.ok).toBe(true);
    expect(applied.validation.totals).toMatchObject({
      discountCents: 2000,
      discountedSubtotalCents: 3000
    });
    expect(applied.validation.items.map((item: any) => item.discountCents)).toEqual([0, 2000]);
  });

  it('loads active coupons from storage and applies by code', async () => {
    const env = memoryEnv();
    await saveStoreCoupons(env, [{
      code: 'SAVE5',
      status: 'active',
      discountType: 'amount',
      amountOffCents: 500,
      appliesTo: 'cart'
    }]);

    expect(env.values.has(STORE_COUPONS_STORAGE_KEY)).toBe(true);
    const applied = await applyStoreCouponCode(env, 'save5', validation);

    expect(applied.ok).toBe(true);
    expect(applied.coupon).toMatchObject({
      code: 'SAVE5',
      discountCents: 500
    });
  });

  it('adds new coupons and rejects duplicate creates', () => {
    const existing = [{
      id: 'save10',
      code: 'SAVE10',
      status: 'active',
      discountType: 'percent',
      percentOff: 10,
      appliesTo: 'cart',
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:00.000Z'
    }];

    const created = upsertStoreCoupon(existing, {
      code: 'POSTER5',
      status: 'active',
      discountType: 'amount',
      amountOffCents: 500,
      appliesTo: 'products',
      productIds: ['poster']
    }, { nowIso: '2026-06-23T00:00:00.000Z' });
    const duplicate = upsertStoreCoupon(existing, {
      code: 'save10',
      status: 'active',
      discountType: 'percent',
      percentOff: 15,
      appliesTo: 'cart'
    });

    expect(created.ok).toBe(true);
    expect(created.coupons).toHaveLength(2);
    expect(created.coupon).toMatchObject({
      code: 'POSTER5',
      discountType: 'amount',
      amountOffCents: 500
    });
    expect(duplicate).toMatchObject({
      ok: false,
      status: 409
    });
  });

  it('renames coupons without allowing collisions', () => {
    const existing = [
      {
        id: 'save10',
        code: 'SAVE10',
        description: 'Original',
        status: 'active',
        discountType: 'percent',
        percentOff: 10,
        appliesTo: 'cart',
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z'
      },
      {
        id: 'poster5',
        code: 'POSTER5',
        status: 'active',
        discountType: 'amount',
        amountOffCents: 500,
        appliesTo: 'products',
        productIds: ['poster'],
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z'
      }
    ];

    const renamed = upsertStoreCoupon(existing, {
      code: 'SAVE15',
      description: 'Updated',
      status: 'active',
      discountType: 'percent',
      percentOff: 15,
      appliesTo: 'cart'
    }, {
      originalCode: 'SAVE10',
      nowIso: '2026-06-23T00:00:00.000Z'
    });
    const collision = upsertStoreCoupon(existing, {
      code: 'POSTER5',
      status: 'active',
      discountType: 'percent',
      percentOff: 15,
      appliesTo: 'cart'
    }, { originalCode: 'SAVE10' });

    expect(renamed.ok).toBe(true);
    expect(renamed.coupons.map((coupon: any) => coupon.code).sort()).toEqual(['POSTER5', 'SAVE15']);
    expect(renamed.coupon).toMatchObject({
      code: 'SAVE15',
      description: 'Updated',
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-23T00:00:00.000Z'
    });
    expect(collision).toMatchObject({
      ok: false,
      status: 409
    });
  });

  it('builds order drafts with tips based on post-discount subtotal', () => {
    const applied = applyStoreCouponToValidation(validation, {
      code: 'SAVE20',
      status: 'active',
      discountType: 'percent',
      percentOff: 20,
      appliesTo: 'cart'
    });
    const draft = buildStoreOrderDraft({}, {
      validation: applied.validation,
      tipPercent: 5,
      shippingCents: 955,
      taxCents: 305
    });

    expect(draft.ok).toBe(true);
    expect(draft.orderDraft.totals).toMatchObject({
      subtotalCents: 5000,
      discountCents: 1000,
      discountedSubtotalCents: 4000,
      tipAmountCents: 200,
      shippingCents: 955,
      taxCents: 305,
      totalCents: 5460,
      couponCode: 'SAVE20'
    });
  });
});

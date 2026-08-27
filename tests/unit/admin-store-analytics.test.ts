import { describe, expect, it } from 'vitest';

import {
  adminStoreFulfillmentMatchesFilter,
  buildAdminStoreAnalyticsPayload,
  buildAdminStoreProductFilterOptions,
  scopeAdminStoreOrderToProduct
} from '../../worker/src/index.js';

describe('Store admin analytics', () => {
  it('counts every ticket-like product row in ticket totals', () => {
    const payload = buildAdminStoreAnalyticsPayload({
      orders: [
        { orderToken: 'store-order-ticket', status: 'confirmed', totals: { totalCents: 1200 }, payment: { status: 'succeeded' } },
        { orderToken: 'store-order-rsvp', status: 'confirmed', totals: { totalCents: 0 }, payment: { status: 'not_required' } },
        { orderToken: 'store-order-legacy', status: 'confirmed', totals: { totalCents: 1000 }, payment: { status: 'succeeded' } },
        { orderToken: 'store-order-shirt', status: 'confirmed', totals: { totalCents: 2500 }, payment: { status: 'succeeded' } }
      ],
      fulfillments: [
        {
          orderToken: 'store-order-ticket',
          itemName: 'DUST WAVE Event Ticket',
          fulfillmentType: 'ticket',
          quantity: 2,
          subtotalCents: 2400,
          checkInAvailable: false,
          checkedInQuantity: 0
        },
        {
          orderToken: 'store-order-rsvp',
          itemName: 'DUST WAVE Free RSVP',
          fulfillmentType: 'rsvp',
          quantity: 1,
          subtotalCents: 0,
          checkInAvailable: true,
          checkedInQuantity: 1
        },
        {
          orderToken: 'store-order-legacy',
          itemName: 'A Dust Wave Benefit at Studio 123!',
          fulfillmentType: 'legacy',
          taxCategory: 'admission',
          shippable: false,
          quantity: 3,
          subtotalCents: 3000,
          checkInAvailable: false,
          checkedInQuantity: 0
        },
        {
          orderToken: 'store-order-shirt',
          itemName: 'DUST WAVE T-Shirt',
          fulfillmentType: 'physical',
          taxCategory: 'standard',
          shippable: true,
          quantity: 4,
          subtotalCents: 10000,
          checkInAvailable: false,
          checkedInQuantity: 0
        }
      ]
    });

    expect(payload.totals.ticketQuantity).toBe(6);
    expect(payload.totals.checkedInQuantity).toBe(1);
    expect(payload.totals.uncheckedQuantity).toBe(5);
  });

  it('excludes unsettled checkout attempts from sales analytics', () => {
    const payload = buildAdminStoreAnalyticsPayload({
      orders: [
        {
          orderToken: 'store-order-confirmed',
          status: 'confirmed',
          totals: { subtotalCents: 5000, tipAmountCents: 232, totalCents: 5232 },
          payment: { required: true, status: 'succeeded' }
        },
        {
          orderToken: 'store-order-pending-a',
          status: 'payment_pending',
          totals: { subtotalCents: 5000, tipAmountCents: 232, totalCents: 5232 },
          payment: { required: true, status: 'requires_payment_method' }
        },
        {
          orderToken: 'store-order-pending-b',
          status: 'payment_pending',
          totals: { subtotalCents: 5000, tipAmountCents: 232, totalCents: 5232 },
          payment: { required: true, status: 'requires_payment_method' }
        }
      ],
      fulfillments: [
        {
          orderToken: 'store-order-confirmed',
          itemName: 'DUST WAVE Sticker',
          fulfillmentType: 'physical',
          quantity: 1,
          subtotalCents: 300
        },
        {
          orderToken: 'store-order-pending-a',
          itemName: 'DUST WAVE Sticker',
          fulfillmentType: 'physical',
          quantity: 1,
          subtotalCents: 300
        },
        {
          orderToken: 'store-order-pending-b',
          itemName: 'DUST WAVE Sticker',
          fulfillmentType: 'physical',
          quantity: 1,
          subtotalCents: 300
        }
      ]
    });

    expect(payload.totals.orders).toBe(1);
    expect(payload.totals.revenueCents).toBe(5232);
    expect(payload.totals.tipRevenueCents).toBe(232);
    expect(payload.totals.physicalQuantity).toBe(1);
    expect(payload.excluded.unsettledOrders).toBe(2);
    expect(payload.breakdowns.status).toEqual([
      { key: 'confirmed', count: 1, quantity: 1, revenueCents: 5232 }
    ]);
    expect(payload.breakdowns.payment).toEqual([
      { key: 'succeeded', count: 1, quantity: 1, revenueCents: 5232 }
    ]);
  });

  it('scopes product analytics to matching line-item revenue in mixed orders', () => {
    const payload = buildAdminStoreAnalyticsPayload({
      filters: { productId: 'film-ticket' },
      filterOptions: { products: [{ productId: 'film-ticket', name: 'Film Ticket' }] },
      orders: [{
        orderToken: 'store-order-mixed',
        status: 'confirmed',
        totals: { subtotalCents: 4000, tipAmountCents: 400, totalCents: 4400 },
        payment: { status: 'succeeded' },
        attribution: { ref: 'poster' }
      }],
      fulfillments: [{
        orderToken: 'store-order-mixed',
        productId: 'film-ticket',
        itemName: 'Film Ticket',
        fulfillmentType: 'ticket',
        quantity: 2,
        subtotalCents: 2400
      }]
    });

    expect(payload.totals.revenueCents).toBe(2400);
    expect(payload.totals.tipRevenueCents).toBe(240);
    expect(payload.totals.averageOrderCents).toBe(2400);
    expect(payload.breakdowns.status[0].revenueCents).toBe(2400);
    expect(payload.breakdowns.referral[0].revenueCents).toBe(2400);
    expect(payload.filterOptions.products).toEqual([{ productId: 'film-ticket', name: 'Film Ticket' }]);
  });

  it('builds stable product options and removes unrelated items from product-scoped orders', () => {
    const orders = [{
      orderToken: 'store-order-mixed',
      counts: { fulfillmentRows: 2 },
      items: [
        { productId: 'zine', name: 'Zine', fulfillmentType: 'physical', quantity: 1 },
        { productId: 'film-ticket', name: 'Film Ticket', fulfillmentType: 'ticket', quantity: 2 }
      ]
    }, {
      items: [{ productId: 'film-ticket', name: 'Film Ticket', fulfillmentType: 'ticket', quantity: 1 }]
    }];

    expect(buildAdminStoreProductFilterOptions(orders, [{ id: 'poster', name: 'Poster' }])).toEqual([
      { productId: 'film-ticket', name: 'Film Ticket' },
      { productId: 'poster', name: 'Poster' },
      { productId: 'zine', name: 'Zine' }
    ]);
    expect(adminStoreFulfillmentMatchesFilter(
      { productId: 'zine', fulfillmentType: 'physical' },
      { productId: 'film-ticket', fulfillment: 'all' }
    )).toBe(false);
    const scoped = scopeAdminStoreOrderToProduct(orders[0], { productId: 'film-ticket' });
    expect(scoped.items).toHaveLength(1);
    expect(scoped.items[0].productId).toBe('film-ticket');
    expect(scoped.fulfillmentTypes).toEqual(['ticket']);
    expect(scoped.counts.fulfillmentRows).toBe(1);
  });
});

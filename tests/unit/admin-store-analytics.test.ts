import { describe, expect, it } from 'vitest';

import { buildAdminStoreAnalyticsPayload } from '../../worker/src/index.js';

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
});

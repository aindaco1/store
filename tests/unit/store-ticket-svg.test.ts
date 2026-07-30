import { describe, expect, it } from 'vitest';

import { buildStoreTicketSvg } from '../../worker/src/index.js';

describe('Store ticket SVG rendering', () => {
  it('wraps every customer-controlled text block inside the ticket bounds', () => {
    const orderToken = 'store-order-d990fc50-2e3b-4f14-a42a-fce90ea8413c';
    const svg = buildStoreTicketSvg(
      { PLATFORM_TIMEZONE: 'America/Denver' } as any,
      {
        orderToken,
        orderDraft: {
          customer: {
            name: 'A Customer With An Intentionally Very Long Name That Must Never Escape The Ticket Container'
          }
        }
      },
      {
        name: 'Demo Event Ticket',
        variantLabel: 'General Admission',
        quantity: 2,
        fulfillmentType: 'ticket',
        eventDetails: {
          starts_at: '2026-08-15T02:00:00.000Z',
          venue: 'A Very Long Venue Name for the Dust Wave Community Film Exhibition and Gathering',
          address: '3405 Central Avenue Northeast, Albuquerque, New Mexico 87106, United States of America'
        }
      },
      'demo-ticket-general',
      'https://checkout.test/check-in',
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    );

    expect(svg).toContain('aria-label="Ticket Demo Event Ticket (General Admission)"');
    expect(svg).toContain('<tspan x="88" y="210">Demo Event Ticket</tspan>');
    expect(svg).toContain('<tspan x="88" y="264">(General Admission)</tspan>');
    expect(svg).not.toContain('font-size="48" font-weight="900" fill="#101215">Demo Event Ticket');
    expect(svg).toContain('<image href="data:image/svg+xml;base64,');
    expect(svg).toContain(`<desc>Ticket Demo Event Ticket (General Admission). Order ${orderToken}. Quantity 2.</desc>`);
    expect(svg).toContain('<tspan x="88" y="908">Order: d990fc50-2e3b-4f14-a42a-fce90ea8413c</tspan>');
    expect(svg).not.toContain('Order: store-order-');
    expect(svg).not.toContain('<text x="88" y="908"');
    expect(svg).not.toContain('A Customer With An Intentionally Very Long Name That Must Never Escape The Ticket Container</tspan>');
  });
});

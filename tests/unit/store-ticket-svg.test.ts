import { describe, expect, it } from 'vitest';

import { buildStoreTicketSvg } from '../../worker/src/index.js';

describe('Store ticket SVG rendering', () => {
  it('wraps long ticket names and variants inside the ticket bounds', () => {
    const svg = buildStoreTicketSvg(
      { PLATFORM_TIMEZONE: 'America/Denver' } as any,
      {
        orderToken: 'store-order-local-demo-all',
        orderDraft: {
          customer: {
            name: 'Demo Customer'
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
          venue: 'Guild Cinema',
          address: '3405 Central Ave NE, Albuquerque, NM 87106'
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
  });
});

import { describe, expect, it } from 'vitest';

import { buildAdminStoreProductPreviewHtml } from '../../worker/src/index.js';

describe('Store admin product preview', () => {
  it('renders event addresses like the public product page', () => {
    const html = buildAdminStoreProductPreviewHtml({
      id: 'film-fatale',
      name: 'Film Fatale',
      fulfillment_type: 'ticket',
      price_cents: 1200,
      image: '/assets/images/film-fatale.png',
      event_details: {
        starts_at: '2026-08-22T13:30:00-06:00',
        venue: 'Guild Cinema',
        address: 'The Guild Cinema, 3405, Central Avenue Northeast, Nob Hill, Albuquerque, Bernalillo County, New Mexico, 87106, United States'
      }
    }, {
      SITE_BASE: 'https://shop.dustwave.xyz',
      CANONICAL_SITE_BASE: 'https://shop.dustwave.xyz'
    });

    const expectedQuery = encodeURIComponent('Guild Cinema 3405 Central Ave NE Albuquerque, NM 87106');

    expect(html).toContain('class="store-product-card__event-link"');
    expect(html).toContain(`href="https://www.google.com/maps/search/?api=1&amp;query=${expectedQuery}"`);
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('3405 Central Ave NE<br>Albuquerque, NM 87106');
    expect(html).not.toContain('Bernalillo County');
    expect(html).not.toContain('United States');
  });
});

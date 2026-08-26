import { describe, expect, it } from 'vitest';

import { buildAdminStoreEventFollowupAudience } from '../../worker/src/index.js';
import { suppressPromotionalEmail } from '../../worker/src/email-outbox.js';

class MemoryKV {
  store = new Map<string, string>();

  async get(key: string | string[], options?: { type?: string }) {
    if (Array.isArray(key)) {
      const values = new Map<string, unknown>();
      for (const name of key) values.set(name, await this.get(name, options));
      return values;
    }
    const value = this.store.get(key);
    if (value === undefined) return null;
    return options?.type === 'json' ? JSON.parse(value) : value;
  }

  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list({ prefix = '', limit = 1000 } = {}) {
    const keys = [...this.store.keys()]
      .filter((name) => name.startsWith(prefix))
      .sort()
      .slice(0, limit)
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }
}

function order(
  token: string,
  email: string,
  quantity = 1,
  source = 'first_party',
  preferredLang = 'en',
  confirmedAt = '2026-08-20T18:00:00.000Z'
) {
  return {
    version: 1,
    orderToken: token,
    source,
    status: 'confirmed',
    confirmedAt,
    orderDraft: {
      orderToken: token,
      source,
      status: 'confirmed',
      preferredLang,
      customer: { email },
      items: [{
        productId: 'film-fatale-at-the-guild-cinema',
        sku: 'film-fatale-at-the-guild-cinema',
        name: 'FILM FATALE at the Guild Cinema',
        fulfillmentType: 'ticket',
        quantity,
        eventDetails: {
          starts_at: '2026-08-22T13:30:00-06:00',
          ends_at: '2026-08-22T15:00:00-06:00',
          followup: { enabled: true }
        }
      }],
      totals: { itemCount: quantity, totalCents: quantity * 1500, currency: 'USD' }
    },
    payment: { required: false, status: 'not_required' }
  };
}

describe('Store event follow-up audience', () => {
  it('uses a fresh confirmed-order scan, deduplicates normalized email, and excludes imported, invalid, suppressed, and processed recipients', async () => {
    const kv = new MemoryKV();
    const orders = [
      order('store-order-one', 'BUYER@example.com', 2),
      order('store-order-two', ' buyer@example.com ', 1, 'first_party', 'es', '2026-08-20T19:00:00.000Z'),
      order('store-order-imported', 'legacy@example.com', 1, 'snipcart'),
      order('store-order-invalid', 'not-an-email', 1),
      order('store-order-suppressed', 'suppressed@example.com', 1),
      order('store-order-processed', 'processed@example.com', 1)
    ];
    for (const storedOrder of orders) {
      await kv.put(`orders:${storedOrder.orderToken}`, JSON.stringify(storedOrder));
    }
    await suppressPromotionalEmail({ STORE_STATE: kv }, 'suppressed@example.com');
    const processedHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('processed@example.com'));
    const processedHex = [...new Uint8Array(processedHash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    await kv.put(`store-event-followup-sent:v1:film-fatale-at-the-guild-cinema:${processedHex}`, '{}');

    const result = await buildAdminStoreEventFollowupAudience({
      STORE_STATE: kv,
      SITE_BASE: 'https://shop.test',
      WORKER_BASE: 'https://checkout.test',
      MAGIC_LINK_SECRET: 'local-followup-secret',
      PLATFORM_NAME: 'Shop',
      PLATFORM_COMPANY_NAME: 'Dust Wave',
      UPDATES_EMAIL_FROM: 'Dust Wave Shop <updates@shop.test>',
      EVENT_FOLLOWUP_MISSION: 'Dust Wave makes independent films and gatherings.',
      EVENT_FOLLOWUP_POSTAL_ADDRESS: '709 Haines Avenue NW\nAlbuquerque, NM 87102',
      EVENT_FOLLOWUP_ORGANIZATION_URL: 'https://dustwave.xyz',
      EVENT_FOLLOWUP_SHOP_URL: 'https://shop.dustwave.xyz',
      EVENT_FOLLOWUP_PROJECT_SUPPORT_URL: 'https://pool.dustwave.xyz',
      EVENT_FOLLOWUP_PROJECT_SUPPORT_NAME: 'The Pool',
      EVENT_FOLLOWUP_SUPPORT_ONE_TIME_URL: 'https://buy.stripe.com/one-time',
      EVENT_FOLLOWUP_SUPPORT_MONTHLY_URL: 'https://buy.stripe.com/monthly',
      EVENT_FOLLOWUP_NEWSLETTER_URL: 'https://dustwave.xyz/newsletter.html',
      I18N_CATALOG_JSON: JSON.stringify({
        en: { email: {} },
        es: {
          email: {
            subjects: { store_event_followup: 'Gracias por acompañarnos en %{event}' },
            store_event_followup: { heading: 'Viniste -- y eso importa.' }
          }
        }
      }),
      STORE_CATALOG_JSON: JSON.stringify({
        version: 1,
        products: [{
          id: 'film-fatale-at-the-guild-cinema',
          name: 'FILM FATALE at the Guild Cinema',
          type: 'ticket',
          fulfillment_type: 'ticket',
          launch_test: false,
          event_details: {
            starts_at: '2026-08-22T13:30:00-06:00',
            ends_at: '2026-08-22T15:00:00-06:00',
            followup: { enabled: true }
          }
        }]
      })
    } as any, 'film-fatale-at-the-guild-cinema');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.audience).toMatchObject({
      matchingOrders: 6,
      matchingTicketQuantity: 7,
      uniquePurchasersBeforeSuppression: 3,
      duplicatePurchasersCollapsed: 1,
      eligibleRecipientCount: 1,
      exclusions: {
        importedOrders: 1,
        invalidEmailOrders: 1,
        suppressedRecipients: 1,
        alreadyProcessedRecipients: 1
      }
    });
    expect(result.audience.recipients).toEqual([expect.objectContaining({
      email: 'buyer@example.com',
      preferredLang: 'es',
      orderCount: 2,
      ticketQuantity: 3
    })]);
    expect(result.preview).toMatchObject({
      configurationReady: true,
      from: 'Dust Wave Shop <updates@shop.test>',
      subject: 'Gracias por acompañarnos en FILM FATALE at the Guild Cinema | Dust Wave Shop',
      digest: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
  });
});

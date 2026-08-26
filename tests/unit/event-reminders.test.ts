import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildStoreOrderEmailPayload,
  processStoreEventFollowups,
  processStoreEventReminders,
  queueStoreEventFollowups,
  queueStoreEventReminders
} from '../../worker/src/index.js';
import { getStoreOrderStorageKey } from '../../worker/src/orders.js';

class MockKVNamespace {
  store = new Map<string, string>();

  async get(key: string, options?: { type?: string }) {
    if (!this.store.has(key)) return null;
    const value = this.store.get(key) as string;
    if (options?.type === 'json') return JSON.parse(value);
    return value;
  }

  async put(key: string, value: string) {
    this.store.set(key, value);
  }

  async delete(key: string) {
    this.store.delete(key);
  }

  async list({ prefix = '', limit = 100 }: { prefix?: string; limit?: number } = {}) {
    const keys = Array.from(this.store.keys())
      .filter((name) => name.startsWith(prefix))
      .sort()
      .slice(0, limit)
      .map((name) => ({ name }));
    return {
      keys,
      list_complete: true,
      cursor: undefined
    };
  }
}

function mockResend() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'email_123' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function getEmailPayload(fetchMock: ReturnType<typeof mockResend>) {
  const [, init] = fetchMock.mock.calls.at(-1) || [];
  return JSON.parse(String(init?.body || '{}'));
}

function buildConfirmedEventOrder(now: Date) {
  const startsAt = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000) + (60 * 1000)).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + (2 * 60 * 60 * 1000)).toISOString();
  return {
    version: 1,
    orderToken: 'store-order-event123',
    status: 'confirmed',
    confirmedAt: now.toISOString(),
    orderDraft: {
      orderToken: 'store-order-event123',
      status: 'confirmed',
      preferredLang: 'en',
      customer: {
        email: 'alonso@dustwave.xyz',
        name: 'Alonso'
      },
      items: [{
        productId: 'dancewave',
        sku: 'ticket-1',
        name: 'DANCEWAVE',
        quantity: 1,
        unitPriceCents: 1200,
        subtotalCents: 1200,
        fulfillmentType: 'ticket',
        eventDetails: {
          starts_at: startsAt,
          ends_at: endsAt,
          venue: 'Sund Brewery',
          address: '4501 1st St NW, Albuquerque, NM 87107',
          ics: true,
          followup: { enabled: true }
        }
      }],
      totals: {
        subtotalCents: 1200,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 1200
      }
    },
    payment: {
      required: false,
      status: 'not_required'
    }
  };
}

function buildEnv(storeState = new MockKVNamespace()) {
  return {
    STORE_STATE: storeState,
    SITE_BASE: 'https://shop.test',
    WORKER_BASE: 'https://checkout.test',
    STORE_FULFILLMENT_SECRET: 'local-fulfillment-secret',
    MAGIC_LINK_SECRET: 'local-magic-secret',
    RESEND_API_KEY: 'resend_test',
    SUPPORT_EMAIL: 'info@dustwave.xyz',
    ORDERS_EMAIL_FROM: 'Dust Wave Shop <orders@dustwave.xyz>',
    UPDATES_EMAIL_FROM: 'Dust Wave Shop <updates@dustwave.xyz>',
    PLATFORM_COMPANY_NAME: 'Dust Wave',
    PLATFORM_NAME: 'Shop',
    EMAIL_LOGO_PATH: '/assets/images/defaults/dust-wave-square.png',
    I18N_CATALOG_JSON: JSON.stringify({ en: { email: {} } }),
    EVENT_FOLLOWUP_MISSION: "We make films, put on screenings, and try to clear a little more room for ambitious work outside the usual industry machinery. We’re proud practitioners of DIY -- but even **DIY ain't cheap.** Just by showing up, you helped.",
    EVENT_FOLLOWUP_POSTAL_ADDRESS: '709 Haines Avenue NW\nAlbuquerque, NM 87102',
    EVENT_FOLLOWUP_ORGANIZATION_URL: 'https://dustwave.xyz',
    EVENT_FOLLOWUP_SHOP_URL: 'https://shop.dustwave.xyz',
    EVENT_FOLLOWUP_PROJECT_SUPPORT_URL: 'https://pool.dustwave.xyz',
    EVENT_FOLLOWUP_PROJECT_SUPPORT_NAME: 'The Pool',
    EVENT_FOLLOWUP_SUPPORT_ONE_TIME_URL: 'https://buy.stripe.com/test-one-time',
    EVENT_FOLLOWUP_SUPPORT_MONTHLY_URL: 'https://buy.stripe.com/test-monthly',
    EVENT_FOLLOWUP_NEWSLETTER_URL: 'https://dustwave.xyz/newsletter.html'
  } as any;
}

describe('Store event email attachments and reminders', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('adds calendar attachments to event order emails without attaching SVG tickets or QR codes', async () => {
    const env = buildEnv();
    const order = buildConfirmedEventOrder(new Date());

    const payload = await buildStoreOrderEmailPayload(env, order);

    expect(payload?.email).toBe('alonso@dustwave.xyz');
    expect(payload?.attachments.map((attachment: { filename: string }) => attachment.filename)).toEqual([
      'ticket-1.ics'
    ]);
    const calendar = Buffer.from(payload?.attachments[0].content || '', 'base64').toString('utf8');
    expect(calendar).toContain('METHOD:REQUEST');
    expect(calendar).toContain('SUMMARY:DANCEWAVE');
    expect(calendar).toContain('LOCATION:Sund Brewery\\, 4501 1st St NW\\, Albuquerque\\, NM 87107');
  });

  it('sends due event reminders with calendar attachments and order-page ticket links', async () => {
    const now = new Date();
    const storeState = new MockKVNamespace();
    const env = buildEnv(storeState);
    const order = buildConfirmedEventOrder(now);
    await storeState.put(getStoreOrderStorageKey(order.orderToken), JSON.stringify(order));
    const fetchMock = mockResend();

    await expect(queueStoreEventReminders(env, order, now)).resolves.toMatchObject({ queued: 4 });
    await expect(processStoreEventReminders(env, new Date(now.getTime() + (2 * 60 * 1000)))).resolves.toMatchObject({
      sent: 1,
      failed: 0
    });

    const payload = getEmailPayload(fetchMock);
    expect(payload.to).toBe('alonso@dustwave.xyz');
    expect(payload.from).toBe('Dust Wave Shop <updates@dustwave.xyz>');
    expect(payload.subject).toBe('Event reminder | DANCEWAVE | Dust Wave Shop');
    expect(payload.html).toContain('This is your 1 week before reminder.');
    expect(payload.html).toContain('Sund Brewery, 4501 1st St NW, Albuquerque, NM 87107');
    expect(payload.html).toContain('Open your <a href="https://shop.test/order-success/?orderToken=store-order-event123"');
    expect(payload.attachments.map((attachment: { filename: string }) => attachment.filename)).toEqual([
      'ticket-1.ics'
    ]);
  });

  it('queues one post-event email per normalized purchaser and sends it after the event end plus 24 hours', async () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    const storeState = new MockKVNamespace();
    const first = buildConfirmedEventOrder(now);
    const duplicate = JSON.parse(JSON.stringify(first));
    duplicate.orderToken = 'store-order-event456';
    duplicate.orderDraft.orderToken = duplicate.orderToken;
    duplicate.orderDraft.customer.email = ' ALONSO@DUSTWAVE.XYZ ';
    duplicate.orderDraft.items[0].quantity = 2;
    const eventDetails = first.orderDraft.items[0].eventDetails;
    const env = {
      ...buildEnv(storeState),
      EMAIL_OUTBOX_ENABLED: 'false',
      STORE_CATALOG_JSON: JSON.stringify({
        version: 1,
        products: [{
          id: 'dancewave',
          name: 'DANCEWAVE',
          type: 'ticket',
          fulfillment_type: 'ticket',
          event_details: eventDetails
        }]
      })
    } as any;
    const fetchMock = mockResend();

    await expect(queueStoreEventFollowups(env, first, now)).resolves.toMatchObject({ queued: 1 });
    await expect(queueStoreEventFollowups(env, duplicate, now)).resolves.toMatchObject({ queued: 1 });
    const due = new Date(Date.parse(eventDetails.ends_at) + (24 * 60 * 60 * 1000));
    await expect(processStoreEventFollowups(env, new Date(due.getTime() - 1))).resolves.toMatchObject({
      sent: 0,
      skippedReason: 'not_due'
    });
    await expect(processStoreEventFollowups(env, due)).resolves.toMatchObject({ sent: 1, failed: 0 });

    const payload = getEmailPayload(fetchMock);
    expect(payload.to).toBe('alonso@dustwave.xyz');
    expect(payload.from).toBe('Dust Wave Shop <updates@dustwave.xyz>');
    expect(payload.reply_to).toBe('info@dustwave.xyz');
    expect(payload.subject).toBe('Thanks for showing up for DANCEWAVE | Dust Wave Shop');
    expect(payload.html).toContain('You showed up -- and that matters.');
    expect(payload.html).toContain('A roomful of people choosing to experience weird, handmade, independent work together -- that’s the whole point.');
    expect(payload.html).toContain('but even <strong style="font-weight: 700;">DIY ain&#39;t cheap.</strong>');
    expect(payload.text).toContain("but even DIY ain't cheap.");
    expect(payload.html).toContain('max-width: 128px');
    expect(payload.html).toContain('href="https://dustwave.xyz/"');
    expect(payload.html).toContain('Pick up something from the Dust Wave Shop');
    expect(payload.html).toContain('href="https://shop.dustwave.xyz/"');
    expect(payload.html).toContain('Back an active project on The Pool');
    expect(payload.html).toContain('href="https://pool.dustwave.xyz/"');
    expect(payload.html).toContain('store-event-followup-support-column');
    expect(payload.html).toContain('width: 50%');
    expect(payload.html).toContain('It isn’t tied to a specific campaign');
    expect(payload.text).toContain('Dust Wave (https://dustwave.xyz/)');
    expect(payload.text).toContain('The Pool (https://pool.dustwave.xyz/)');
    expect(payload.html).toContain('709 Haines Avenue NW');
    expect(payload.html).toContain('Opt out of optional Store emails');
    expect(payload.attachments).toBeUndefined();
    expect(payload.headers).toMatchObject({
      'List-Unsubscribe': expect.stringContaining('/event-followup/unsubscribe?t='),
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    });
  });

  it('uses the language from the purchaser’s most recent checkout after deduplication', async () => {
    const firstConfirmedAt = new Date('2026-08-01T12:00:00.000Z');
    const laterConfirmedAt = new Date('2026-08-02T12:00:00.000Z');
    const storeState = new MockKVNamespace();
    const englishOrder = buildConfirmedEventOrder(firstConfirmedAt);
    const spanishOrder = JSON.parse(JSON.stringify(englishOrder));
    spanishOrder.orderToken = 'store-order-event-spanish';
    spanishOrder.orderDraft.orderToken = spanishOrder.orderToken;
    spanishOrder.confirmedAt = laterConfirmedAt.toISOString();
    spanishOrder.orderDraft.preferredLang = 'es';
    const eventDetails = englishOrder.orderDraft.items[0].eventDetails;
    const env = {
      ...buildEnv(storeState),
      EMAIL_OUTBOX_ENABLED: 'false',
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
          id: 'dancewave',
          name: 'DANCEWAVE',
          type: 'ticket',
          fulfillment_type: 'ticket',
          event_details: eventDetails
        }]
      })
    } as any;
    const fetchMock = mockResend();

    await queueStoreEventFollowups(env, englishOrder, firstConfirmedAt);
    await queueStoreEventFollowups(env, spanishOrder, laterConfirmedAt);
    await processStoreEventFollowups(env, new Date(Date.parse(eventDetails.ends_at) + (24 * 60 * 60 * 1000)));

    const payload = getEmailPayload(fetchMock);
    expect(payload.subject).toBe('Gracias por acompañarnos en DANCEWAVE | Dust Wave Shop');
    expect(payload.html).toContain('Viniste -- y eso importa.');
  });
});

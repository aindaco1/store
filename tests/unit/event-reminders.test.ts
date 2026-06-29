import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildStoreOrderEmailPayload,
  processStoreEventReminders,
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
          ics: true
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
    ORDERS_EMAIL_FROM: 'Dust Wave Shop <orders@dustwave.xyz>',
    UPDATES_EMAIL_FROM: 'Dust Wave Shop <updates@dustwave.xyz>',
    PLATFORM_COMPANY_NAME: 'Dust Wave',
    PLATFORM_NAME: 'Shop',
    I18N_CATALOG_JSON: JSON.stringify({ en: { email: {} } })
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
});

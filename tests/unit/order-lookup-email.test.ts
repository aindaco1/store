import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/src/index.js';

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

  async list() {
    return {
      keys: Array.from(this.store.keys()).map((name) => ({ name })),
      list_complete: true,
      cursor: undefined
    };
  }
}

function emailHash(email: string) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function mockResend() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'email_123' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Store order lookup delivery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('delivers lookup emails inline for local development requests', async () => {
    const storeState = new MockKVNamespace();
    const ratelimit = new MockKVNamespace();
    const email = 'alonso@dustwave.xyz';
    const hash = emailHash(email);
    await storeState.put(`store-order-email:${hash}`, JSON.stringify({
      version: 1,
      emailHash: hash,
      updatedAt: '2026-06-26T00:00:00.000Z',
      orders: [{
        orderToken: 'store-order-local123',
        createdAt: '2026-06-26T00:00:00.000Z',
        totalCents: 2500,
        preferredLang: 'en'
      }]
    }));
    const fetchMock = mockResend();
    const waitUntil = vi.fn();

    const response = await worker.fetch(new Request('http://127.0.0.1:8989/api/orders/lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:4002',
        'CF-Connecting-IP': '127.0.0.1'
      },
      body: JSON.stringify({ email })
    }), {
      SITE_BASE: 'http://127.0.0.1:4002',
      MAGIC_LINK_SECRET: 'local-order-lookup-secret',
      RESEND_API_KEY: 'resend_test',
      ORDERS_EMAIL_FROM: 'Dust Wave Shop <orders@dustwave.xyz>',
      UPDATES_EMAIL_FROM: 'Dust Wave Shop <updates@dustwave.xyz>',
      PLATFORM_COMPANY_NAME: 'Dust Wave',
      PLATFORM_NAME: 'Shop',
      I18N_CATALOG_JSON: JSON.stringify({ en: { email: {} } }),
      STORE_STATE: storeState,
      RATELIMIT: ratelimit,
      OBSERVABILITY_SAMPLE_RATE: '0'
    } as any, { waitUntil } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.debug.orderLookup).toMatchObject({
      matchedOrders: 1,
      deliverySent: true
    });
    expect(body.debug.orderLookup.lookupUrl).toContain('http://127.0.0.1:4002/orders/?token=');
    expect(waitUntil).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body || '{}'));
    expect(payload.to).toBe(email);
    expect(payload.subject).toBe('Find your order | Dust Wave Shop');
  });

  it('rebuilds missing lookup indexes from confirmed orders and keeps lookup links reusable until expiry', async () => {
    const storeState = new MockKVNamespace();
    const ratelimit = new MockKVNamespace();
    const email = 'alonso@dustwave.xyz';
    const orderToken = 'store-order-lookup123';
    await storeState.put(`orders:${orderToken}`, JSON.stringify({
      orderToken,
      status: 'confirmed',
      createdAt: '2026-06-26T00:00:00.000Z',
      confirmedAt: '2026-06-26T00:01:00.000Z',
      updatedAt: '2026-06-26T00:01:00.000Z',
      orderDraft: {
        orderToken,
        status: 'confirmed',
        createdAt: '2026-06-26T00:00:00.000Z',
        confirmedAt: '2026-06-26T00:01:00.000Z',
        preferredLang: 'en',
        currency: 'USD',
        customer: {
          email,
          name: 'Alonso Indacochea'
        },
        totals: {
          itemCount: 2,
          totalCents: 5232
        },
        items: [{
          id: 'line-1',
          productId: 'dust-wave-sticker',
          sku: 'sticker-1',
          name: 'DUST WAVE Sticker',
          quantity: 1,
          subtotalCents: 300,
          fulfillmentType: 'physical',
          shippable: true
        }, {
          id: 'line-2',
          productId: 'attack-poster',
          sku: 'poster-1',
          name: 'Attack of the 50 Ft. Dust Wave! Poster',
          quantity: 1,
          subtotalCents: 3500,
          fulfillmentType: 'physical',
          shippable: true
        }]
      },
      payment: {
        required: true,
        status: 'succeeded',
        amountCents: 5232,
        currency: 'USD',
        paymentIntentId: 'pi_lookup123'
      }
    }));
    mockResend();

    const env = {
      SITE_BASE: 'http://127.0.0.1:4002',
      MAGIC_LINK_SECRET: 'local-order-lookup-secret',
      RESEND_API_KEY: 'resend_test',
      ORDERS_EMAIL_FROM: 'Dust Wave Shop <orders@dustwave.xyz>',
      UPDATES_EMAIL_FROM: 'Dust Wave Shop <updates@dustwave.xyz>',
      PLATFORM_COMPANY_NAME: 'Dust Wave',
      PLATFORM_NAME: 'Shop',
      I18N_CATALOG_JSON: JSON.stringify({ en: { email: {} } }),
      STORE_STATE: storeState,
      RATELIMIT: ratelimit,
      OBSERVABILITY_SAMPLE_RATE: '0'
    } as any;

    const requestResponse = await worker.fetch(new Request('http://127.0.0.1:8989/api/orders/lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:4002',
        'CF-Connecting-IP': '127.0.0.1'
      },
      body: JSON.stringify({ email })
    }), env);

    expect(requestResponse.status).toBe(200);
    const requestBody = await requestResponse.json();
    expect(requestBody.debug.orderLookup.matchedOrders).toBe(1);
    const lookupUrl = new URL(requestBody.debug.orderLookup.lookupUrl);
    const token = lookupUrl.searchParams.get('token') || '';
    expect(token).toBeTruthy();
    expect(await storeState.get(`store-order-email:${emailHash(email)}`, { type: 'json' })).toMatchObject({
      orders: [{
        orderToken,
        fulfillmentReady: true
      }]
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const consumeResponse = await worker.fetch(new Request(`http://127.0.0.1:8989/api/orders/lookup?token=${encodeURIComponent(token)}`, {
        method: 'GET',
        headers: {
          Origin: 'http://127.0.0.1:4002',
          'CF-Connecting-IP': '127.0.0.1'
        }
      }), env);
      expect(consumeResponse.status).toBe(200);
      const consumeBody = await consumeResponse.json();
      expect(consumeBody.orders).toHaveLength(1);
      expect(consumeBody.orders[0]).toMatchObject({
        orderToken,
        totalCents: 5232,
        fulfillmentReady: true
      });
    }
  });
});

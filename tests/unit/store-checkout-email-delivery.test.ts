import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { attemptStoreOrderAdminNotificationDelivery } from '../../worker/src/index.js';

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

function baseEnv(storeState = new MockKVNamespace(), ratelimit = new MockKVNamespace()) {
  return {
    APP_MODE: 'test',
    SITE_BASE: 'http://127.0.0.1:4002',
    CORS_ALLOWED_ORIGIN: 'http://127.0.0.1:4002',
    STRIPE_SECRET_KEY: 'sk_test_store',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_store',
    RESEND_API_KEY: 'resend_test',
    ORDERS_EMAIL_FROM: 'Dust Wave Shop <orders@dustwave.xyz>',
    UPDATES_EMAIL_FROM: 'Dust Wave Shop <updates@dustwave.xyz>',
    SUPPORT_EMAIL: 'support@dustwave.xyz',
    PLATFORM_COMPANY_NAME: 'Dust Wave',
    PLATFORM_NAME: 'Shop',
    I18N_CATALOG_JSON: JSON.stringify({ en: { email: {} } }),
    OBSERVABILITY_SAMPLE_RATE: '0',
    STORE_STATE: storeState,
    RATELIMIT: ratelimit
  };
}

describe('Store checkout email delivery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates Stripe PaymentIntents without delegating receipt email delivery to Stripe', async () => {
    const storeState = new MockKVNamespace();
    const ratelimit = new MockKVNamespace();
    let stripeBody = '';
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input || '');
      if (url === 'https://api.stripe.com/v1/payment_intents') {
        stripeBody = String(init?.body || '');
        return new Response(JSON.stringify({
          id: 'pi_store_no_receipt',
          client_secret: 'pi_store_no_receipt_secret',
          status: 'requires_payment_method'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ id: 'email_ignored' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }));

    const response = await worker.fetch(new Request('http://127.0.0.1:8989/api/checkout/intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:4002',
        'CF-Connecting-IP': '127.0.0.1'
      },
      body: JSON.stringify({
        items: [{
          id: 'download-1',
          price: 5,
          quantity: 1
        }],
        customer: {
          email: 'buyer@example.com',
          name: 'Buyer Example'
        },
        preferredLang: 'en'
      })
    }), baseEnv(storeState, ratelimit) as any, { waitUntil: vi.fn() } as any);

    expect(response.status).toBe(200);
    const params = new URLSearchParams(stripeBody);
    expect(params.get('metadata[email]')).toBe('buyer@example.com');
    expect(params.has('receipt_email')).toBe(false);
  });

  it('notifies effective super admins for confirmed orders and records per-recipient delivery state', async () => {
    const storeState = new MockKVNamespace();
    const env = {
      ...baseEnv(storeState),
      ADMIN_USERS_JSON: JSON.stringify([
        { name: 'Owner', email: 'owner@example.com', role: 'super_admin', accessScopes: [] },
        { name: 'Backup', email: 'backup@example.com', role: 'super_admin', accessScopes: [] },
        { name: 'Store Ops', email: 'ops@example.com', role: 'limited_admin', accessScopes: ['store'] }
      ])
    };
    const orderToken = 'store-order-admin-email123';
    const storedOrder = {
      orderToken,
      status: 'confirmed',
      orderDraft: {
        orderToken,
        preferredLang: 'en',
        customer: {
          email: 'buyer@example.com',
          name: 'Buyer Example'
        },
        totals: {
          subtotalCents: 500,
          totalCents: 500
        },
        items: [{
          name: 'DUST WAVE Digital Download',
          quantity: 1,
          subtotalCents: 500,
          fulfillmentType: 'digital'
        }]
      },
      payment: {
        required: true,
        provider: 'stripe',
        status: 'succeeded',
        amountCents: 500,
        currency: 'USD'
      }
    };
    await storeState.put(`orders:${orderToken}`, JSON.stringify(storedOrder));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'email_123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(attemptStoreOrderAdminNotificationDelivery(env as any, storedOrder)).resolves.toMatchObject({
      ok: true,
      sent: ['owner@example.com', 'backup@example.com']
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const payloads = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body || '{}')));
    expect(payloads.map((payload) => payload.to)).toEqual(['owner@example.com', 'backup@example.com']);
    expect(payloads.map((payload) => payload.subject)).toEqual(['New order | Dust Wave Shop', 'New order | Dust Wave Shop']);
    expect(payloads[0].html).toContain('buyer@example.com');
    expect(payloads[0]).not.toHaveProperty('attachments');

    const updated = await storeState.get(`orders:${orderToken}`, { type: 'json' });
    expect(updated.adminNotificationEmailSent).toBe(true);
    expect(updated.adminNotificationEmailRecipients).toEqual(['owner@example.com', 'backup@example.com']);
    expect(updated.adminNotificationEmailErrors).toEqual([]);

    await expect(attemptStoreOrderAdminNotificationDelivery(env as any, storedOrder)).resolves.toMatchObject({
      ok: true,
      sent: [],
      skipped: ['owner@example.com', 'backup@example.com']
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const idempotentUpdate = await storeState.get(`orders:${orderToken}`, { type: 'json' });
    expect(idempotentUpdate.adminNotificationEmailSent).toBe(true);
    expect(idempotentUpdate.adminNotificationEmailRecipients).toEqual(['owner@example.com', 'backup@example.com']);
  });
});

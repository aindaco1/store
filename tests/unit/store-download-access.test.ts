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
}

function buildEnv(storeState = new MockKVNamespace()) {
  return {
    SITE_BASE: 'http://127.0.0.1:4002',
    CORS_ALLOWED_ORIGIN: 'http://127.0.0.1:4002',
    STORE_FULFILLMENT_SECRET: 'local-fulfillment-secret',
    STORE_STATE: storeState,
    RATELIMIT: new MockKVNamespace(),
    STORE_DOWNLOADS: {},
    OBSERVABILITY_SAMPLE_RATE: '0'
  } as any;
}

function buildDigitalOrder(downloadAccess: Record<string, unknown>) {
  return {
    orderToken: 'store-order-download123',
    status: 'confirmed',
    createdAt: '2026-06-01T12:00:00.000Z',
    confirmedAt: '2026-06-01T12:05:00.000Z',
    orderDraft: {
      orderToken: 'store-order-download123',
      status: 'confirmed',
      preferredLang: 'en',
      customer: {
        email: 'buyer@example.com',
        name: 'Buyer Example'
      },
      items: [{
        sku: 'download-1',
        name: 'Digital Download',
        quantity: 1,
        subtotalCents: 500,
        fulfillmentType: 'digital',
        download: {
          file_key: 'digital-download.pdf',
          filename: 'Digital Download.pdf',
          delivery: 'signed_link'
        }
      }],
      totals: {
        itemCount: 1,
        totalCents: 500
      }
    },
    payment: {
      required: true,
      status: 'succeeded',
      amountCents: 500,
      currency: 'USD'
    },
    downloadAccess: {
      'download-1': downloadAccess
    }
  };
}

async function fetchOrderSummary(env: any) {
  return worker.fetch(new Request('http://127.0.0.1:8989/api/orders/store-order-download123', {
    headers: {
      Origin: 'http://127.0.0.1:4002',
      'CF-Connecting-IP': '127.0.0.1'
    }
  }), env);
}

describe('Store digital download access', () => {
  afterEach(() => {
    // Keep the test isolated from fetch stubs in neighboring suites.
    vi.restoreAllMocks();
  });

  it('keeps paid digital entitlements active even when legacy expiry metadata is present', async () => {
    const storeState = new MockKVNamespace();
    await storeState.put('orders:store-order-download123', JSON.stringify(buildDigitalOrder({
      status: 'active',
      issuedAt: '2026-06-01T12:05:00.000Z',
      expiresAt: '2026-06-02T12:05:00.000Z',
      expiresHours: 24
    })));

    const response = await fetchOrderSummary(buildEnv(storeState));
    expect(response.status).toBe(200);
    const body = await response.json();
    const download = body.items[0].actions.download;

    expect(download.available).toBe(true);
    expect(download.href).toContain('/api/orders/store-order-download123/downloads/download-1');
    expect(download.access).toMatchObject({
      status: 'active',
      available: true,
      expiresAt: '',
      expiresInSeconds: 0,
      expiresHours: 0
    });
  });

  it('blocks explicitly revoked digital entitlements', async () => {
    const storeState = new MockKVNamespace();
    await storeState.put('orders:store-order-download123', JSON.stringify(buildDigitalOrder({
      status: 'revoked',
      revokedAt: '2026-06-03T12:05:00.000Z'
    })));

    const response = await fetchOrderSummary(buildEnv(storeState));
    expect(response.status).toBe(200);
    const body = await response.json();
    const download = body.items[0].actions.download;

    expect(download.available).toBe(false);
    expect(download.reason).toBe('revoked');
    expect(download.message).toContain('revoked');
    expect(download.access).toMatchObject({
      status: 'revoked',
      available: false,
      revokedAt: '2026-06-03T12:05:00.000Z'
    });
  });
});

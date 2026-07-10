import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import worker from '../../worker/src/index.js';
import {
  ADMIN_STORE_ORDER_INDEX_KEY,
  buildAdminStoreOrderIndexSnapshot
} from '../../worker/src/admin-store-read-model.js';

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

  async list({ prefix = '', cursor }: { prefix?: string; cursor?: string } = {}) {
    if (cursor) {
      return { keys: [], list_complete: true, cursor: undefined };
    }
    return {
      keys: Array.from(this.store.keys())
        .filter((key) => key.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
      cursor: undefined
    };
  }
}

function buildEnv(storeState = new MockKVNamespace()) {
  return {
    SITE_BASE: 'http://127.0.0.1:4002',
    CORS_ALLOWED_ORIGIN: 'https://film.test',
    APP_MODE: 'test',
    FILM_STRIPE_SUMMARY_ADAPTER_SECRET: 'film-adapter-secret',
    STORE_STATE: storeState,
    RATELIMIT: new MockKVNamespace(),
    OBSERVABILITY_SAMPLE_RATE: '0'
  } as any;
}

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    orderToken: 'store-order-film123',
    status: 'confirmed',
    createdAt: '2026-07-01T12:00:00.000Z',
    confirmedAt: '2026-07-01T12:05:00.000Z',
    updatedAt: '2026-07-01T12:05:00.000Z',
    orderDraft: {
      orderToken: 'store-order-film123',
      status: 'confirmed',
      customer: {
        email: 'buyer@example.com',
        name: 'Buyer Example'
      },
      attribution: {
        ref: 'film-echoes',
        utmCampaign: 'launch'
      },
      items: [{
        id: 'line_1',
        productId: 'store_echoes',
        variantId: 'poster',
        sku: 'poster_echoes',
        name: 'Echoes Poster',
        quantity: 2,
        subtotalCents: 60000,
        fulfillmentType: 'physical'
      }],
      totals: {
        itemCount: 2,
        totalCents: 60000
      }
    },
    payment: {
      required: true,
      provider: 'stripe',
      status: 'succeeded',
      amountCents: 60000,
      currency: 'USD',
      paymentIntentId: 'pi_should_not_return',
      chargeId: 'ch_should_not_return',
      balanceTransactionId: 'txn_should_not_return',
      stripeFinancials: {
        source: 'actual',
        paymentIntentId: 'pi_should_not_return',
        chargeId: 'ch_should_not_return',
        balanceTransactionId: 'txn_should_not_return',
        grossAmount: 60000,
        feeAmount: 1800,
        netAmount: 58200
      }
    },
    ...overrides
  };
}

function buildIndexedOrder(overrides: Record<string, unknown> = {}) {
  const rawOrder = buildOrder();
  const orderDraft = rawOrder.orderDraft;
  return {
    orderToken: rawOrder.orderToken,
    status: rawOrder.status,
    fulfillmentReady: true,
    createdAt: rawOrder.createdAt,
    confirmedAt: rawOrder.confirmedAt,
    updatedAt: rawOrder.updatedAt,
    totals: {
      totalCents: orderDraft.totals.totalCents,
      itemCount: orderDraft.totals.itemCount,
      currency: 'USD'
    },
    payment: {
      required: rawOrder.payment.required,
      provider: rawOrder.payment.provider,
      status: rawOrder.payment.status,
      amountCents: rawOrder.payment.amountCents,
      currency: rawOrder.payment.currency,
      stripeFinancials: rawOrder.payment.stripeFinancials
    },
    attribution: orderDraft.attribution,
    items: orderDraft.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      sku: item.sku,
      quantity: item.quantity,
      subtotalCents: item.subtotalCents,
      fulfillmentType: item.fulfillmentType
    })),
    ...overrides
  };
}

async function fetchStoreSummary(env: any, token = 'film-adapter-secret') {
  return worker.fetch(new Request('http://127.0.0.1:8989/film/stripe-summary', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '127.0.0.1'
    },
    body: JSON.stringify({
      workspaceId: 'workspace_acme',
      projectId: 'proj_echoes',
      source: 'store',
      mappedRefs: ['store_echoes'],
      dataBoundary: 'summary_only',
      requestedFields: [
        'grossAmountCents',
        'feeAmountCents',
        'netAmountCents',
        'orderRevenueCents',
        'paymentFailedAmountCents',
        'paymentCount',
        'paymentFailedCount'
      ]
    })
  }), env, { waitUntil: () => {} });
}

describe('Film Stripe summary adapter for Store', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns matched Store payment aggregates without raw Stripe or customer fields', async () => {
    const storeState = new MockKVNamespace();
    await storeState.put('orders:store-order-film123', JSON.stringify(buildOrder()));
    await storeState.put('orders:store-order-failed123', JSON.stringify(buildOrder({
      orderToken: 'store-order-failed123',
      status: 'payment_failed',
      failedAt: '2026-07-01T12:06:00.000Z',
      orderDraft: {
        ...buildOrder().orderDraft,
        orderToken: 'store-order-failed123',
        status: 'payment_failed',
        totals: { itemCount: 1, totalCents: 15000 }
      },
      payment: {
        required: true,
        provider: 'stripe',
        status: 'payment_failed',
        amountCents: 15000,
        currency: 'USD',
        paymentIntentId: 'pi_failed_should_not_return'
      }
    })));
    await storeState.put('orders:store-order-other123', JSON.stringify(buildOrder({
      orderToken: 'store-order-other123',
      orderDraft: {
        ...buildOrder().orderDraft,
        orderToken: 'store-order-other123',
        items: [{
          id: 'line_other',
          productId: 'other_product',
          variantId: 'standard',
          sku: 'other_sku',
          name: 'Other Product',
          quantity: 1,
          subtotalCents: 9900,
          fulfillmentType: 'physical'
        }],
        totals: { itemCount: 1, totalCents: 9900 }
      },
      payment: {
        required: true,
        provider: 'stripe',
        status: 'succeeded',
        amountCents: 9900,
        currency: 'USD'
      }
    })));

    const response = await fetchStoreSummary(buildEnv(storeState));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      source: 'store',
      status: 'available',
      currency: 'USD',
      dataBoundary: 'summary_only',
      mappedRefCount: 1,
      matchedRefCount: 1,
      missingRefCount: 0,
      matchedOrderCount: 2,
      totals: {
        grossAmountCents: 60000,
        feeAmountCents: 1800,
        netAmountCents: 58200,
        chargedAmountCents: 60000,
        orderRevenueCents: 60000,
        paymentFailedAmountCents: 15000
      },
      counts: {
        paymentCount: 1,
        paymentFailedCount: 1
      }
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('pi_should_not_return');
    expect(serialized).not.toContain('ch_should_not_return');
    expect(serialized).not.toContain('txn_should_not_return');
    expect(serialized).not.toContain('buyer@example.com');
    expect(Array.from(storeState.store.keys()).some((key) => key.includes('film_stripe_summary_adapter:read'))).toBe(true);
  });

  it('uses the Store order index for Film summary reads when the index is fresh', async () => {
    const storeState = new MockKVNamespace();
    await storeState.put(ADMIN_STORE_ORDER_INDEX_KEY, JSON.stringify(buildAdminStoreOrderIndexSnapshot({
      generatedAt: new Date().toISOString(),
      scanned: 2500,
      indexed: 1,
      listCalls: 18,
      truncated: false,
      orders: [buildIndexedOrder()]
    })));
    const listSpy = vi.spyOn(storeState, 'list');

    const response = await fetchStoreSummary(buildEnv(storeState));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      source: 'store',
      status: 'available',
      matchedOrderCount: 1,
      totals: {
        grossAmountCents: 60000,
        feeAmountCents: 1800,
        netAmountCents: 58200,
        chargedAmountCents: 60000,
        orderRevenueCents: 60000
      },
      counts: {
        paymentCount: 1
      }
    });
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('keeps a no-change one-day-old order index available instead of rescanning every order', async () => {
    const storeState = new MockKVNamespace();
    await storeState.put(ADMIN_STORE_ORDER_INDEX_KEY, JSON.stringify(buildAdminStoreOrderIndexSnapshot({
      generatedAt: new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString(),
      scanned: 417,
      indexed: 1,
      listCalls: 1,
      truncated: false,
      orders: [buildIndexedOrder()]
    })));
    const listSpy = vi.spyOn(storeState, 'list');
    const getSpy = vi.spyOn(storeState, 'get');

    const response = await fetchStoreSummary(buildEnv(storeState));

    expect(response.status).toBe(200);
    expect(listSpy).not.toHaveBeenCalled();
    expect(getSpy).toHaveBeenCalledWith(ADMIN_STORE_ORDER_INDEX_KEY, { type: 'json' });
  });

  it('rejects requests without the adapter bearer token', async () => {
    const response = await fetchStoreSummary(buildEnv(), 'wrong-token');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' });
  });

  it('fails closed when the adapter secret is not configured', async () => {
    const env = buildEnv();
    delete env.FILM_STRIPE_SUMMARY_ADAPTER_SECRET;

    const response = await fetchStoreSummary(env);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Film Stripe summary adapter is not configured'
    });
  });
});

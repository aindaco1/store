import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAddOnInventoryProjectionDelta, ensureAddOnInventorySoldProjection, getAddOnInventorySnapshot, invalidateAddOnInventorySnapshot } from '../../worker/src/add-ons.js';

class MockKVNamespace {
  store = new Map<string, string>();
  listCount = 0;

  async get(key: string, options?: { type?: string }) {
    if (!this.store.has(key)) return null;
    const value = this.store.get(key) as string;
    if (options?.type === 'json') {
      return JSON.parse(value);
    }
    return value;
  }

  async put(key: string, value: string) {
    this.store.set(key, value);
  }

  async list({ prefix = '', cursor }: { prefix?: string; cursor?: string } = {}) {
    this.listCount += 1;
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

describe('add-on inventory snapshot cache', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function stubAddOnCatalog() {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      enabled: true,
      low_stock_threshold: 5,
      products: [
        {
          id: 'dust-wave-sticker',
          name: 'DUST WAVE Sticker',
          price: 3,
          category: 'physical',
          inventory: 50,
          variants: []
        }
      ]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as any);
  }

  it('rebuilds add-on inventory after invalidation when saved Store orders change', async () => {
    const env = {
      SITE_BASE: 'https://pool.test',
      STORE_STATE: new MockKVNamespace()
    } as any;

    stubAddOnCatalog();

    const firstSnapshot = await getAddOnInventorySnapshot(env);
    expect(firstSnapshot.products['dust-wave-sticker']).toMatchObject({
      sold: 0,
      remaining: 50
    });
    expect(env.STORE_STATE.listCount).toBe(1);

    await env.STORE_STATE.put('orders:order-1', JSON.stringify({
      orderId: 'order-1',
      status: 'confirmed',
      orderDraft: {
        status: 'confirmed',
        items: [
          { id: 'addon__dust-wave-sticker', quantity: 2 }
        ]
      }
    }));
    await applyAddOnInventoryProjectionDelta(env, [], [
      { productId: 'dust-wave-sticker', quantity: 2 }
    ]);

    const staleSnapshot = await getAddOnInventorySnapshot(env);
    expect(staleSnapshot.products['dust-wave-sticker']).toMatchObject({
      sold: 2,
      remaining: 48
    });

    invalidateAddOnInventorySnapshot(env);

    const refreshedSnapshot = await getAddOnInventorySnapshot(env);
    expect(refreshedSnapshot.products['dust-wave-sticker']).toMatchObject({
      sold: 2,
      remaining: 48
    });
    expect(env.STORE_STATE.listCount).toBe(1);
  });

  it('bootstraps the sold projection before modifying Store add-ons', async () => {
    const env = {
      SITE_BASE: 'https://pool.test',
      STORE_STATE: new MockKVNamespace()
    } as any;
    stubAddOnCatalog();

    await env.STORE_STATE.put('orders:order-1', JSON.stringify({
      orderId: 'order-1',
      status: 'confirmed',
      orderDraft: {
        status: 'confirmed',
        items: [
          { id: 'addon__dust-wave-sticker', quantity: 2 }
        ]
      }
    }));

    await ensureAddOnInventorySoldProjection(env);
    await env.STORE_STATE.put('orders:order-1', JSON.stringify({
      orderId: 'order-1',
      status: 'confirmed',
      orderDraft: {
        status: 'confirmed',
        items: [
          { id: 'addon__dust-wave-sticker', quantity: 3 }
        ]
      }
    }));
    await applyAddOnInventoryProjectionDelta(env, [
      { productId: 'dust-wave-sticker', quantity: 2 }
    ], [
      { productId: 'dust-wave-sticker', quantity: 3 }
    ]);

    const snapshot = await getAddOnInventorySnapshot(env);
    expect(snapshot.products['dust-wave-sticker']).toMatchObject({
      sold: 3,
      remaining: 47
    });
    expect(env.STORE_STATE.listCount).toBe(1);
  });
});

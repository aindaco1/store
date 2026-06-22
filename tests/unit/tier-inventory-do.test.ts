import { describe, expect, it, vi } from 'vitest';

import { StoreInventoryCoordinator } from '../../worker/src/tier-inventory-do.js';

class MockStorage {
  store = new Map<string, unknown>();

  async get(key: string) {
    return this.store.get(key);
  }

  async put(key: string, value: unknown) {
    this.store.set(key, value);
  }

  async transaction<T>(callback: (storage: MockStorage) => Promise<T>) {
    return callback(this);
  }
}

class MockDurableObjectState {
  storage = new MockStorage();
}

class MockKVNamespace {
  store = new Map<string, string>();

  async put(key: string, value: string) {
    this.store.set(key, value);
  }

  async get(key: string, options?: { type?: string }) {
    const value = this.store.get(key);
    if (value == null) return null;
    if (options?.type === 'json') {
      return JSON.parse(value);
    }
    return value;
  }
}

describe('StoreInventoryCoordinator', () => {
  it('serializes competing claims against the same limited SKU', async () => {
    const env = { STORE_STATE: new MockKVNamespace() };
    const coordinator = new StoreInventoryCoordinator(new MockDurableObjectState() as never, env as never);

    const first = await coordinator.fetch(new Request('https://store-inventory/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        sku: 'vip-pass',
        qty: 1,
        inventory: {
          'vip-pass': { limit: 1, claimed: 0 }
        }
      })
    }));

    const second = await coordinator.fetch(new Request('https://store-inventory/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        sku: 'vip-pass',
        qty: 1,
        inventory: {
          'vip-pass': { limit: 1, claimed: 0 }
        }
      })
    }));

    expect(await first.json()).toMatchObject({ success: true, remaining: 0 });
    expect(await second.json()).toMatchObject({ success: false, remaining: 0 });
    expect(await env.STORE_STATE.get('store-inventory:v1:catalog', { type: 'json' })).toEqual({
      'vip-pass': { limit: 1, claimed: 1 }
    });
  });

  it('applies multi-SKU selection changes atomically', async () => {
    const env = { STORE_STATE: new MockKVNamespace() };
    const coordinator = new StoreInventoryCoordinator(new MockDurableObjectState() as never, env as never);

    const response = await coordinator.fetch(new Request('https://store-inventory/apply-selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        previousCounts: { 'frame-slot': 1 },
        nextCounts: { 'frame-slot': 1, 'vip-pass': 2 },
        inventory: {
          'frame-slot': { limit: 5, claimed: 1 },
          'vip-pass': { limit: 1, claimed: 0 }
        }
      })
    }));

    const payload = await response.json();
    expect(payload).toMatchObject({ success: false, remaining: 1 });
    expect(await env.STORE_STATE.get('store-inventory:v1:catalog', { type: 'json' })).toBeNull();
  });

  it('tracks reservations without changing the public claimed projection until confirmation', async () => {
    const env = { STORE_STATE: new MockKVNamespace() };
    const coordinator = new StoreInventoryCoordinator(new MockDurableObjectState() as never, env as never);

    const reserve = await coordinator.fetch(new Request('https://store-inventory/reserve-selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        reservationId: 'intent-1',
        nextCounts: { 'vip-pass': 1 },
        inventory: {
          'vip-pass': { limit: 2, claimed: 0 }
        }
      })
    }));

    expect(await reserve.json()).toMatchObject({
      success: true,
      inventory: {
        'vip-pass': { limit: 2, claimed: 0 }
      },
      reservations: {
        'intent-1': {
          counts: { 'vip-pass': 1 },
          expiresAt: expect.any(String)
        }
      }
    });

    expect(await env.STORE_STATE.get('store-inventory:v1:catalog', { type: 'json' })).toEqual({
      'vip-pass': { limit: 2, claimed: 0 }
    });

    const confirm = await coordinator.fetch(new Request('https://store-inventory/confirm-reservation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        reservationId: 'intent-1',
        inventory: {
          'vip-pass': { limit: 2, claimed: 0 }
        }
      })
    }));

    expect(await confirm.json()).toMatchObject({
      success: true,
      inventory: {
        'vip-pass': { limit: 2, claimed: 1 }
      },
      reservations: {}
    });

    expect(await env.STORE_STATE.get('store-inventory:v1:catalog', { type: 'json' })).toEqual({
      'vip-pass': { limit: 2, claimed: 1 }
    });
  });

  it('accounts for an existing reservation when updating that same reservation', async () => {
    const env = { STORE_STATE: new MockKVNamespace() };
    const coordinator = new StoreInventoryCoordinator(new MockDurableObjectState() as never, env as never);

    await coordinator.fetch(new Request('https://store-inventory/reserve-selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        reservationId: 'intent-1',
        nextCounts: { 'vip-pass': 1 },
        inventory: {
          'vip-pass': { limit: 2, claimed: 0 }
        }
      })
    }));

    await coordinator.fetch(new Request('https://store-inventory/reserve-selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        reservationId: 'intent-2',
        nextCounts: { 'vip-pass': 1 },
        inventory: {
          'vip-pass': { limit: 2, claimed: 0 }
        }
      })
    }));

    const response = await coordinator.fetch(new Request('https://store-inventory/reserve-selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        reservationId: 'intent-1',
        nextCounts: { 'vip-pass': 2 },
        inventory: {
          'vip-pass': { limit: 2, claimed: 0 }
        }
      })
    }));

    expect(await response.json()).toMatchObject({
      success: false,
      remaining: 1
    });
  });

  it('migrates inventory-only storage into coordinator state', async () => {
    const state = new MockDurableObjectState();
    const env = { STORE_STATE: new MockKVNamespace() };
    await state.storage.put('inventory', {
      'vip-pass': { limit: 3, claimed: 1 }
    });
    const coordinator = new StoreInventoryCoordinator(state as never, env as never);

    const response = await coordinator.fetch(new Request('https://store-inventory/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        sku: 'vip-pass',
        qty: 1,
        inventory: {
          'vip-pass': { limit: 3, claimed: 1 }
        }
      })
    }));

    expect(await response.json()).toMatchObject({
      success: true,
      inventory: {
        'vip-pass': { limit: 3, claimed: 0 }
      },
      state: {
        inventory: {
          'vip-pass': { limit: 3, claimed: 0 }
        },
        reservations: {}
      }
    });
  });

  it('reports reserved counts while excluding the current reservation when requested', async () => {
    const env = { STORE_STATE: new MockKVNamespace() };
    const coordinator = new StoreInventoryCoordinator(new MockDurableObjectState() as never, env as never);

    await coordinator.fetch(new Request('https://store-inventory/reserve-selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        reservationId: 'intent-1',
        nextCounts: { 'vip-pass': 1 },
        inventory: {
          'vip-pass': { limit: 2, claimed: 0 }
        }
      })
    }));

    await coordinator.fetch(new Request('https://store-inventory/reserve-selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        reservationId: 'intent-2',
        nextCounts: { 'vip-pass': 1 },
        inventory: {
          'vip-pass': { limit: 2, claimed: 0 }
        }
      })
    }));

    const response = await coordinator.fetch(new Request('https://store-inventory/reserved-counts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        reservationId: 'intent-1'
      })
    }));

    expect(await response.json()).toEqual({
      success: true,
      reservedCounts: {
        'vip-pass': 1
      }
    });
  });

  it('drops expired reservations from availability snapshots', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T06:00:00Z'));

    const state = new MockDurableObjectState();
    const env = { STORE_STATE: new MockKVNamespace() };
    await state.storage.put('state', {
      inventory: {
        'vip-pass': { limit: 2, claimed: 1 }
      },
      reservations: {
        stale: {
          counts: { 'vip-pass': 1 },
          expiresAt: '2026-04-09T05:55:00Z'
        }
      },
      updatedAt: '2026-04-09T05:50:00Z'
    });

    const coordinator = new StoreInventoryCoordinator(state as never, env as never);
    const snapshot = await coordinator.fetch(new Request('https://store-inventory/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog'
      })
    }));

    expect(await snapshot.json()).toEqual({
      success: true,
      inventory: {
        'vip-pass': { limit: 2, claimed: 1 }
      },
      reservedCounts: {},
      updatedAt: '2026-04-09T05:50:00Z'
    });

    expect(await state.storage.get('state')).toMatchObject({
      reservations: {}
    });

    vi.useRealTimers();
  });

  it('clears transient reservations when inventory is replaced during a rebuild', async () => {
    const env = { STORE_STATE: new MockKVNamespace() };
    const coordinator = new StoreInventoryCoordinator(new MockDurableObjectState() as never, env as never);

    await coordinator.fetch(new Request('https://store-inventory/reserve-selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        reservationId: 'intent-stale',
        nextCounts: { 'vip-pass': 1 },
        inventory: {
          'vip-pass': { limit: 2, claimed: 0 }
        }
      })
    }));

    const replace = await coordinator.fetch(new Request('https://store-inventory/replace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        inventory: {
          'vip-pass': { limit: 2, claimed: 1 }
        }
      })
    }));

    expect(await replace.json()).toMatchObject({
      success: true,
      inventory: {
        'vip-pass': { limit: 2, claimed: 1 }
      },
      state: {
        reservations: {}
      }
    });

    const snapshot = await coordinator.fetch(new Request('https://store-inventory/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog'
      })
    }));

    expect(await snapshot.json()).toEqual({
      success: true,
      inventory: {
        'vip-pass': { limit: 2, claimed: 1 }
      },
      reservedCounts: {},
      updatedAt: expect.any(String)
    });
  });
});

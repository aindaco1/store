import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from '../../worker/src/index.js';

const SITE_BASE = 'https://shop.example.com';
const WORKER_BASE = 'https://checkout.example.com';

function buildEnv(projection: unknown) {
  const get = vi.fn(async (key: string, options?: { type?: string }) => {
    expect(key).toBe('store-inventory:v1:store');
    expect(options).toEqual({ type: 'json' });
    return projection;
  });
  return {
    APP_MODE: 'test',
    SITE_BASE,
    WORKER_BASE,
    CORS_ALLOWED_ORIGIN: SITE_BASE,
    RATELIMIT: {},
    STORE_STATE: { get }
  } as any;
}

describe('public Store inventory endpoint', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a briefly cacheable, sanitized confirmed-availability projection', async () => {
    const env = buildEnv({
      'mug-1': {
        limit: 5,
        claimed: 1,
        productId: 'mug-1',
        name: 'DUST WAVE Mug',
        customerEmail: 'must-not-leak@example.com'
      },
      't-shirt-4-xs': { limit: 8, claimed: 0 }
    });

    const response = await worker.fetch(new Request(`${WORKER_BASE}/api/store/inventory`), env, {} as any);
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=15, s-maxage=15');
    expect(await response.json()).toEqual({
      ok: true,
      status: 'ready',
      inventory: {
        'mug-1': { available: 4 }
      }
    });
    expect(env.STORE_STATE.get).toHaveBeenCalledTimes(1);
  });

  it('uses one cold KV read for repeated requests within the edge TTL', async () => {
    const env = buildEnv({ 'mug-1': { limit: 5, claimed: 1 } });
    let cachedResponse: Response | null = null;
    const cache = {
      match: vi.fn(async () => cachedResponse?.clone() || null),
      put: vi.fn(async (_request: Request, response: Response) => {
        cachedResponse = response.clone();
      })
    };
    vi.stubGlobal('caches', { default: cache });
    const waitUntilTasks: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (task: Promise<unknown>) => waitUntilTasks.push(task)
    } as any;

    const first = await worker.fetch(new Request(`${WORKER_BASE}/api/store/inventory?ignored=1`), env, ctx);
    await Promise.all(waitUntilTasks);
    const second = await worker.fetch(new Request(`${WORKER_BASE}/api/store/inventory?ignored=2`), env, ctx);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(env.STORE_STATE.get).toHaveBeenCalledTimes(1);
    expect(cache.match).toHaveBeenCalledTimes(2);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.put.mock.calls[0][0].url).toBe(`${WORKER_BASE}/api/store/inventory`);
    expect(await second.json()).toEqual({
      ok: true,
      status: 'ready',
      inventory: { 'mug-1': { available: 4 } }
    });
  });

  it('fails closed and disables caching when the projection is absent', async () => {
    const env = buildEnv(null);
    const response = await worker.fetch(new Request(`${WORKER_BASE}/api/store/inventory`), env, {} as any);

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      ok: false,
      status: 'unavailable',
      inventory: {}
    });
  });
});

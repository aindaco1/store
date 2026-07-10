import { afterEach, describe, expect, it, vi } from 'vitest';

import worker, { buildAdminStoreOrdersWorkersCachePurgeProps } from '../../worker/src/index.js';
import {
  adminStoreReadCacheTagsForDomains
} from '../../worker/src/workers-cache-policy.js';

class MockKVNamespace {
  store = new Map<string, string>();

  get = vi.fn(async (key: string, options?: { type?: string }) => {
    if (!this.store.has(key)) return null;
    const value = this.store.get(key) as string;
    return options?.type === 'json' ? JSON.parse(value) : value;
  });

  put = vi.fn(async (key: string, value: string, _options?: unknown) => {
    this.store.set(key, value);
  });

  delete = vi.fn(async (key: string) => {
    this.store.delete(key);
  });

  list = vi.fn(async ({ prefix = '', cursor }: { prefix?: string; cursor?: string } = {}) => {
    if (cursor) return { keys: [], list_complete: true, cursor: undefined };
    return {
      keys: Array.from(this.store.keys())
        .filter((key) => key.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
      cursor: undefined
    };
  });
}

const SITE_BASE = 'http://127.0.0.1:4002';
const WORKER_BASE = 'http://127.0.0.1:8989';
let nextIpOctet = 10;

function requestIp() {
  nextIpOctet += 1;
  return `127.0.0.${nextIpOctet}`;
}

function buildEnv(overrides: Record<string, unknown> = {}) {
  return {
    APP_MODE: 'test',
    SITE_BASE,
    WORKER_BASE,
    CORS_ALLOWED_ORIGIN: SITE_BASE,
    ADMIN_BOOTSTRAP_EMAILS: 'admin@example.com',
    ADMIN_USERS_JSON: JSON.stringify([{
      name: 'Admin User',
      email: 'admin@example.com',
      role: 'super_admin'
    }]),
    ADMIN_SESSION_SECRET: 'test_admin_session_secret',
    MAGIC_LINK_SECRET: 'test_magic_link_secret',
    ADMIN_SECRET: 'test_admin_secret',
    ADMIN_EXPOSE_LOGIN_LINK: 'true',
    WORKERS_CACHE_PURGE_SECRET: 'deploy_secret',
    OBSERVABILITY_SAMPLE_RATE: '0',
    STORE_STATE: new MockKVNamespace(),
    RATELIMIT: new MockKVNamespace(),
    ...overrides
  } as any;
}

function buildCtx(cacheFetch = vi.fn()) {
  const waitUntilTasks: Promise<unknown>[] = [];
  return {
    waitUntilTasks,
    waitUntil: vi.fn((task: Promise<unknown>) => {
      waitUntilTasks.push(Promise.resolve(task));
    }),
    exports: {
      CachedAdminStoreReads: {
        fetch: cacheFetch
      }
    }
  } as any;
}

async function createAdminSession(env: any, ctx: any) {
  const startResponse = await worker.fetch(new Request(`${WORKER_BASE}/admin/auth/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: SITE_BASE,
      'CF-Connecting-IP': requestIp()
    },
    body: JSON.stringify({ email: 'admin@example.com', preferredLang: 'en' })
  }), env, ctx);
  expect(startResponse.status).toBe(200);
  const startBody = await startResponse.json();
  const token = new URL(String(startBody.loginUrl)).searchParams.get('admin_login') || '';
  expect(token).toBeTruthy();

  const exchangeResponse = await worker.fetch(new Request(`${WORKER_BASE}/admin/auth/exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: SITE_BASE,
      'CF-Connecting-IP': requestIp()
    },
    body: JSON.stringify({ token })
  }), env, ctx);
  expect(exchangeResponse.status).toBe(200);
  const exchangeBody = await exchangeResponse.json();
  const setCookie = exchangeResponse.headers.get('Set-Cookie') || '';
  expect(setCookie).toContain('store_admin_session=');

  return {
    cookie: setCookie.split(';')[0],
    csrfToken: String(exchangeBody.csrfToken || ''),
    user: exchangeBody.user
  };
}

function cachedOrdersPayload() {
  return {
    user: null,
    scope: 'store',
    orders: [],
    fulfillments: [],
    totals: {
      orders: 0,
      fulfillmentRows: 0,
      totalCents: 0,
      ticketQuantity: 0,
      checkedInQuantity: 0,
      physicalQuantity: 0,
      digitalQuantity: 0
    },
    attendance: {
      totals: {
        eventCount: 0,
        orderCount: 0,
        quantity: 0,
        checkedInQuantity: 0,
        uncheckedQuantity: 0
      },
      events: []
    },
    page: {
      limit: 100,
      cursor: 0,
      nextCursor: null,
      returned: 0,
      matched: 0,
      matchedOrders: 0,
      scanned: 0,
      indexed: 0,
      truncated: false,
      cache: null,
      generatedAt: '2026-07-09T00:00:00.000Z'
    },
    filters: {
      status: 'confirmed',
      fulfillment: 'all',
      query: ''
    },
    writeBudget: {
      readOnly: true,
      kvReadsExpected: 0,
      kvWritesExpected: 0,
      kvListExpected: 0
    },
    generatedAt: '2026-07-09T00:00:00.000Z'
  };
}

function auditEvents(env: any) {
  return Array.from(env.STORE_STATE.store.entries())
    .filter(([key]) => String(key).startsWith('admin-audit:'))
    .map(([, value]) => JSON.parse(String(value)));
}

describe('Workers Cache admin endpoints', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serves admin Orders from Workers Cache without forwarding credentials or admin identity', async () => {
    const env = buildEnv();
    const cacheFetch = vi.fn(async () => new Response(JSON.stringify(cachedOrdersPayload()), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cf-Cache-Status': 'HIT'
      }
    }));
    const ctx = buildCtx(cacheFetch);
    const session = await createAdminSession(env, ctx);

    const response = await worker.fetch(new Request(`${WORKER_BASE}/admin/store/orders?status=Confirmed&limit=250&q=&locale=ES&ignored=1`, {
      headers: {
        Cookie: session.cookie,
        Origin: SITE_BASE,
        Authorization: 'Bearer browser-token-never-forward',
        'CF-Connecting-IP': requestIp()
      }
    }), env, ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('X-Store-Workers-Cache')).toBe('HIT');
    expect(response.headers.get('X-Store-Workers-Cache-Entry')).toBe('CachedAdminStoreReads');
    expect(response.headers.get('X-Store-Workers-Cache-Route')).toBe('orders');
    expect(cacheFetch).toHaveBeenCalledOnce();

    const [cacheRequest, cacheInit] = cacheFetch.mock.calls[0] as [Request, { props: Record<string, unknown> }];
    const cacheUrl = new URL(cacheRequest.url);
    expect(cacheUrl.origin).toBe('https://store-cache.internal');
    expect(cacheUrl.pathname).toBe('/admin/store/orders');
    expect(cacheUrl.searchParams.get('status')).toBe('confirmed');
    expect(cacheUrl.searchParams.get('limit')).toBe('100');
    expect(cacheUrl.searchParams.get('locale')).toBe('es');
    expect(cacheUrl.searchParams.has('q')).toBe(false);
    expect(cacheUrl.searchParams.has('ignored')).toBe(false);
    expect(cacheRequest.headers.has('Authorization')).toBe(false);
    expect(cacheRequest.headers.has('Cookie')).toBe(false);
    expect(cacheRequest.headers.has('x-store-admin-csrf')).toBe(false);
    expect(JSON.stringify(cacheInit.props)).not.toContain('admin@example.com');
    expect(cacheInit.props).toMatchObject({
      source: 'store-admin-read-cache-gateway',
      version: 2,
      routeId: 'orders',
      role: 'super_admin',
      scopeKey: 'super_admin',
      accessScope: 'store'
    });

    const body = await response.json();
    expect(body.user).toMatchObject({
      email: 'admin@example.com',
      role: 'super_admin'
    });
    expect(body.page.cache.workers).toMatchObject({
      enabled: true,
      entrypoint: 'CachedAdminStoreReads',
      status: 'HIT',
      bypass: ''
    });
  });

  it('bypasses Workers Cache for free-text admin Orders searches', async () => {
    const env = buildEnv();
    const cacheFetch = vi.fn();
    const ctx = buildCtx(cacheFetch);
    const session = await createAdminSession(env, ctx);

    const response = await worker.fetch(new Request(`${WORKER_BASE}/admin/store/orders?q=buyer@example.com`, {
      headers: {
        Cookie: session.cookie,
        Origin: SITE_BASE,
        'CF-Connecting-IP': requestIp()
      }
    }), env, ctx);

    expect(response.status).toBe(200);
    expect(response.headers.has('X-Store-Workers-Cache')).toBe(false);
    expect(cacheFetch).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.page.cache.workers).toMatchObject({
      enabled: true,
      entrypoint: 'CachedAdminStoreReads',
      status: 'unavailable',
      bypass: 'search_query'
    });
  });

  it('honors the admin Orders Workers Cache kill switch', async () => {
    const env = buildEnv({ WORKERS_CACHE_ADMIN_ORDERS_ENABLED: 'false' });
    const cacheFetch = vi.fn();
    const ctx = buildCtx(cacheFetch);
    const session = await createAdminSession(env, ctx);

    const response = await worker.fetch(new Request(`${WORKER_BASE}/admin/store/orders?status=confirmed`, {
      headers: {
        Cookie: session.cookie,
        Origin: SITE_BASE,
        'CF-Connecting-IP': requestIp()
      }
    }), env, ctx);

    expect(response.status).toBe(200);
    expect(cacheFetch).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.page.cache.workers).toMatchObject({
      enabled: false,
      entrypoint: 'CachedAdminStoreReads',
      status: 'disabled',
      bypass: 'disabled'
    });
  });

  it('honors the global Workers Cache kill switch', async () => {
    const env = buildEnv({ WORKERS_CACHE_ENABLED: 'false' });
    const cacheFetch = vi.fn();
    const ctx = buildCtx(cacheFetch);
    const session = await createAdminSession(env, ctx);

    const response = await worker.fetch(new Request(`${WORKER_BASE}/admin/store/orders?status=confirmed`, {
      headers: { Cookie: session.cookie, Origin: SITE_BASE, 'CF-Connecting-IP': requestIp() }
    }), env, ctx);

    expect(response.status).toBe(200);
    expect(cacheFetch).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.workersCache).toMatchObject({ enabled: false, bypass: 'disabled' });
  });

  it('routes Analytics, Inventory, and Downloads through the cohesive cached entrypoint', async () => {
    const env = buildEnv();
    const cacheFetch = vi.fn(async (request: Request, init: { props: Record<string, unknown> }) => {
      const routeId = String(init.props.routeId || '');
      return new Response(JSON.stringify({
        scope: 'store',
        routeId,
        rows: [],
        files: [],
        page: {},
        writeBudget: { readOnly: true, kvWritesExpected: 0 }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cf-Cache-Status': 'HIT' }
      });
    });
    const ctx = buildCtx(cacheFetch);
    const session = await createAdminSession(env, ctx);

    for (const [path, routeId] of [
      ['/admin/store/analytics', 'analytics'],
      ['/admin/store/inventory', 'inventory'],
      ['/admin/store/downloads', 'downloads']
    ]) {
      const response = await worker.fetch(new Request(`${WORKER_BASE}${path}`, {
        headers: { Cookie: session.cookie, Origin: SITE_BASE, 'CF-Connecting-IP': requestIp() }
      }), env, ctx);
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      expect(response.headers.get('X-Store-Workers-Cache-Route')).toBe(routeId);
      const body = await response.json();
      expect(body.user.email).toBe('admin@example.com');
      expect(body.workersCache).toMatchObject({ routeId, status: 'HIT' });
      expect(body.writeBudget).toMatchObject({ workersRequestsExpected: 1 });
    }

    expect(cacheFetch).toHaveBeenCalledTimes(3);
    expect(cacheFetch.mock.calls.map((call) => new URL(String(call[0].url)).pathname)).toEqual([
      '/admin/store/analytics',
      '/admin/store/inventory',
      '/admin/store/downloads'
    ]);
    expect(cacheFetch.mock.calls.map((call) => call[1].props.routeId)).toEqual([
      'analytics', 'inventory', 'downloads'
    ]);
  });

  it('returns a minimal unchanged Orders payload for a matching non-PII watermark', async () => {
    const env = buildEnv({ WORKERS_CACHE_ENABLED: 'false' });
    env.STORE_STATE.store.set('orders:store-order-alpha', JSON.stringify({
      orderToken: 'store-order-alpha',
      status: 'confirmed',
      createdAt: '2026-07-09T12:00:00.000Z',
      confirmedAt: '2026-07-09T12:01:00.000Z',
      updatedAt: '2026-07-09T12:02:00.000Z',
      orderDraft: {
        status: 'confirmed',
        customer: { email: 'buyer@example.com', name: 'Private Buyer' },
        items: [{ id: 'line-1', sku: 'poster', quantity: 1, fulfillmentType: 'physical' }],
        totals: { totalCents: 2500, currency: 'USD' }
      }
    }));
    const ctx = buildCtx();
    const session = await createAdminSession(env, ctx);
    const headers = { Cookie: session.cookie, Origin: SITE_BASE, 'CF-Connecting-IP': requestIp() };
    const first = await worker.fetch(new Request(`${WORKER_BASE}/admin/store/orders?status=all`, { headers }), env, ctx);
    const firstBody = await first.json();
    expect(firstBody.unchanged).toBe(false);
    expect(firstBody.watermark).toMatch(/^orders-v2-[a-f0-9]{16}$/);
    expect(Array.isArray(firstBody.orders)).toBe(true);

    const second = await worker.fetch(new Request(
      `${WORKER_BASE}/admin/store/orders?status=all&watermark=${encodeURIComponent(firstBody.watermark)}`,
      { headers: { ...headers, 'CF-Connecting-IP': requestIp() } }
    ), env, ctx);
    const secondBody = await second.json();
    expect(secondBody).toMatchObject({
      unchanged: true,
      watermark: firstBody.watermark,
      latestKnownUpdatedAt: '2026-07-09T12:02:00.000Z'
    });
    expect(secondBody.orders).toBeUndefined();
    expect(secondBody.fulfillments).toBeUndefined();
  });

  it('falls back to KV order scanning when the Workers Cache entrypoint is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = buildEnv();
    const cacheFetch = vi.fn().mockRejectedValue(new Error('cache unavailable'));
    const ctx = buildCtx(cacheFetch);
    const session = await createAdminSession(env, ctx);

    const response = await worker.fetch(new Request(`${WORKER_BASE}/admin/store/orders?status=confirmed`, {
      headers: {
        Cookie: session.cookie,
        Origin: SITE_BASE,
        'CF-Connecting-IP': requestIp()
      }
    }), env, ctx);

    expect(response.status).toBe(200);
    expect(cacheFetch).toHaveBeenCalledOnce();
    expect(warn.mock.calls.some((call) => (
      call.includes('Admin Store orders Workers Cache bypassed:') &&
      call.includes('cache unavailable')
    ))).toBe(true);
    const body = await response.json();
    expect(body.page.cache.workers).toMatchObject({
      enabled: true,
      entrypoint: 'CachedAdminStoreReads',
      status: 'unavailable',
      bypass: 'entrypoint_unavailable'
    });
  });

  it('keeps mutations successful and records bounded diagnostics when background purge fails', async () => {
    const env = buildEnv();
    const cacheFetch = vi.fn().mockRejectedValue(new Error('synthetic purge outage'));
    const ctx = buildCtx(cacheFetch);
    const session = await createAdminSession(env, ctx);
    const response = await worker.fetch(new Request(`${WORKER_BASE}/admin/store/marketing/referrals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: session.cookie,
        Origin: SITE_BASE,
        'x-store-admin-csrf': session.csrfToken,
        'CF-Connecting-IP': requestIp()
      },
      body: JSON.stringify({
        code: 'cache-test',
        referrer: 'Cache Test',
        url: `${SITE_BASE}/?ref=cache-test`
      })
    }), env, ctx);

    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    await Promise.all(ctx.waitUntilTasks);
    const failure = JSON.parse(env.STORE_STATE.store.get('workers-cache-purge-failure:recent') || '{}');
    expect(failure).toMatchObject({
      entrypoint: 'CachedAdminStoreReads',
      domains: ['marketing'],
      status: 0,
      error: 'synthetic purge outage'
    });
    expect(JSON.stringify(failure)).not.toContain('admin@example.com');
    expect(JSON.stringify(failure)).not.toContain('Cache Test');
  });

  it('returns a bounded purge failure when the cache binding throws synchronously', async () => {
    const env = buildEnv();
    const cacheFetch = vi.fn(() => {
      throw new Error('synthetic synchronous binding failure');
    });
    const ctx = buildCtx(cacheFetch);
    const session = await createAdminSession(env, ctx);

    const response = await worker.fetch(new Request(`${WORKER_BASE}/admin/workers-cache/purge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: session.cookie,
        Origin: SITE_BASE,
        'x-store-admin-csrf': session.csrfToken,
        'CF-Connecting-IP': requestIp()
      },
      body: JSON.stringify({ target: 'admin_orders', source: 'dashboard' })
    }), env, ctx);

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      target: 'admin_orders',
      purges: [expect.objectContaining({
        ok: false,
        status: 0,
        error: 'synthetic synchronous binding failure'
      })]
    });
    expect(auditEvents(env)[0]).toMatchObject({
      action: 'workers_cache:purge',
      target: 'admin_orders'
    });
  });

  it('allows a super-admin session with CSRF to purge known Workers Cache tags', async () => {
    const env = buildEnv();
    const cacheFetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      purgedAt: '2026-07-09T00:00:00.000Z'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    const ctx = buildCtx(cacheFetch);
    const session = await createAdminSession(env, ctx);

    const response = await worker.fetch(new Request(`${WORKER_BASE}/admin/workers-cache/purge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: session.cookie,
        Origin: SITE_BASE,
        'x-store-admin-csrf': session.csrfToken,
        'CF-Connecting-IP': requestIp()
      },
      body: JSON.stringify({ target: 'admin_orders', source: 'dashboard button' })
    }), env, ctx);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      target: 'admin_orders'
    });
    expect(body.purges[0]).toMatchObject({
      ok: true,
      entrypoint: 'CachedAdminStoreReads',
      tags: adminStoreReadCacheTagsForDomains(['orders', 'order-index'])
    });
    expect(cacheFetch).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST' }), {
      props: buildAdminStoreOrdersWorkersCachePurgeProps()
    });

    expect(auditEvents(env)[0]).toMatchObject({
      action: 'workers_cache:purge',
      adminEmail: 'admin@example.com',
      adminRole: 'super_admin',
      authSource: 'admin_session',
      target: 'admin_orders',
      purgeSource: 'dashboard-button'
    });
  });

  it('allows deploy-secret cache purges without storing the secret in audit data', async () => {
    const purgeSecret = 's3cr3t-cache-purge-token';
    const env = buildEnv({ WORKERS_CACHE_PURGE_SECRET: purgeSecret });
    const cacheFetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      purgedAt: '2026-07-09T00:00:00.000Z'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    const ctx = buildCtx(cacheFetch);

    const response = await worker.fetch(new Request(`${WORKER_BASE}/admin/workers-cache/purge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${purgeSecret}`,
        Origin: SITE_BASE,
        'CF-Connecting-IP': requestIp()
      },
      body: JSON.stringify({ target: 'all-known', source: 'deploy workflow 1' })
    }), env, ctx);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      target: 'all_known'
    });

    const [purgeRequest, purgeInit] = cacheFetch.mock.calls[0] as [Request, { props: Record<string, unknown> }];
    expect(purgeRequest.url).toBe(
      'https://store-cache.internal/__store-cache/admin-reads/purge?domains=analytics%2Cdownloads%2Cinventory%2Cmarketing%2Corder-index%2Corders%2Cproducts'
    );
    expect(purgeRequest.method).toBe('POST');
    expect(purgeInit.props).toEqual(buildAdminStoreOrdersWorkersCachePurgeProps());

    const events = auditEvents(env);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'workers_cache:purge',
      adminEmail: 'deploy@github-actions',
      adminRole: 'super_admin',
      authSource: 'deploy_secret',
      target: 'all_known',
      purgeSource: 'deploy-workflow-1'
    });
    expect(JSON.stringify(events[0])).not.toContain(purgeSecret);
  });
});

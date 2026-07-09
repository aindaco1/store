import { describe, expect, it, vi } from 'vitest';

import {
  CachedAdminStoreOrders,
  adminStoreOrdersWorkersCacheBypassReason,
  buildAdminStoreOrdersCacheRequest,
  buildAdminStoreOrdersWorkersCachePurgeProps,
  buildAdminStoreOrdersWorkersCachePurgeRequest,
  buildAdminStoreOrdersWorkersCacheProps,
  cacheableAdminStoreOrdersJsonResponse,
  fetchAdminStoreOrdersWorkersCache,
  purgeAdminStoreOrdersWorkersCacheNow,
  readAdminStoreOrdersWorkersCacheProps,
  workersCacheEnabledForAdminStoreOrders
} from '../../worker/src/index.js';

describe('Workers Cache policy helpers', () => {
  it('builds a normalized admin Orders cache request without credentials or search PII', () => {
    const request = new Request('https://checkout.dustwave.xyz/admin/store/orders?fulfillment=Ticket&status=Confirmed&cursor=12&limit=250&q=buyer@example.com&locale=es&ignored=1', {
      headers: {
        Authorization: 'Bearer secret',
        Cookie: 'store_admin_session=session-token',
        'x-store-admin-csrf': 'csrf-token'
      }
    });

    const cacheRequest = buildAdminStoreOrdersCacheRequest(request);
    const url = new URL(cacheRequest.url);

    expect(url.origin).toBe('https://store-cache.internal');
    expect(url.pathname).toBe('/admin/store/orders');
    expect(url.searchParams.get('status')).toBe('confirmed');
    expect(url.searchParams.get('fulfillment')).toBe('ticket');
    expect(url.searchParams.get('cursor')).toBe('12');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.get('locale')).toBe('es');
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('ignored')).toBe(false);
    expect(cacheRequest.headers.has('Authorization')).toBe(false);
    expect(cacheRequest.headers.has('Cookie')).toBe(false);
    expect(cacheRequest.headers.has('x-store-admin-csrf')).toBe(false);
  });

  it('bypasses Workers Cache for free-text admin Orders searches', () => {
    const searchRequest = new Request('https://checkout.dustwave.xyz/admin/store/orders?q=buyer@example.com');
    const listRequest = new Request('https://checkout.dustwave.xyz/admin/store/orders?status=confirmed');

    expect(adminStoreOrdersWorkersCacheBypassReason(searchRequest)).toBe('search_query');
    expect(adminStoreOrdersWorkersCacheBypassReason(listRequest)).toBe('');
  });

  it('enables admin Orders Workers Cache by default and honors the runtime kill switch', () => {
    expect(workersCacheEnabledForAdminStoreOrders({})).toBe(true);
    expect(workersCacheEnabledForAdminStoreOrders({ WORKERS_CACHE_ADMIN_ORDERS_ENABLED: 'true' })).toBe(true);
    expect(workersCacheEnabledForAdminStoreOrders({ WORKERS_CACHE_ADMIN_ORDERS_ENABLED: 'false' })).toBe(false);
    expect(workersCacheEnabledForAdminStoreOrders({ WORKERS_CACHE_ADMIN_ORDERS_ENABLED: ' FALSE ' })).toBe(false);
  });

  it('partitions cached admin Orders reads without storing admin identity', () => {
    const props = buildAdminStoreOrdersWorkersCacheProps({
      user: {
        email: 'admin@example.com',
        name: 'Store Admin',
        role: 'limited_admin',
        accessScopes: ['store']
      }
    });

    expect(JSON.stringify(props)).not.toContain('admin@example.com');
    expect(JSON.stringify(props)).not.toContain('Store Admin');
    expect(props).toMatchObject({
      source: 'store-admin-orders-cache-gateway',
      version: 1,
      role: 'limited_admin',
      scopeKey: 'store',
      accessScope: 'store'
    });
    expect(readAdminStoreOrdersWorkersCacheProps({ props })).toMatchObject({
      role: 'limited_admin',
      scopeKey: 'store',
      accessScope: 'store'
    });
    expect(readAdminStoreOrdersWorkersCacheProps({ props: { ...props, source: 'client' } })).toBeNull();
  });

  it('uses cacheable headers only on the inner cached response', () => {
    const response = cacheableAdminStoreOrdersJsonResponse({ ok: true }, 200, {
      CORS_ALLOWED_ORIGIN: 'https://shop.dustwave.xyz'
    });

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=20, stale-while-revalidate=40, stale-if-error=0');
    expect(response.headers.get('Cache-Tag')).toBe('admin-orders,orders,order-index,admin-orders-v1');
    expect(response.headers.has('Set-Cookie')).toBe(false);
    for (const tag of response.headers.get('Cache-Tag')!.split(',')) {
      expect(tag).toMatch(/^[!-~]+$/);
      expect(tag).not.toContain('@');
    }
  });

  it('passes ctx.props on loopback fetch calls to the cached entrypoint', async () => {
    const props = buildAdminStoreOrdersWorkersCacheProps({ user: { role: 'super_admin' } });
    const request = new Request('https://store-cache.internal/admin/store/orders?status=confirmed');
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));

    await fetchAdminStoreOrdersWorkersCache({
      exports: {
        CachedAdminStoreOrders: { fetch }
      }
    }, request, props);

    expect(fetch).toHaveBeenCalledWith(request, { props });
  });

  it('supports function-style Workers Cache entrypoint bindings', async () => {
    const props = buildAdminStoreOrdersWorkersCacheProps({ user: { role: 'limited_admin', accessScopes: ['store'] } });
    const request = new Request('https://store-cache.internal/admin/store/orders?status=confirmed');
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    const factory = vi.fn().mockReturnValue({ fetch });

    await fetchAdminStoreOrdersWorkersCache({
      exports: {
        CachedAdminStoreOrders: factory
      }
    }, request, props);

    expect(factory).toHaveBeenCalledWith({ props });
    expect(fetch).toHaveBeenCalledWith(request);
  });

  it('rejects malformed Workers Cache props before reading private order data', () => {
    const validProps = buildAdminStoreOrdersWorkersCacheProps({
      user: {
        role: 'limited_admin',
        accessScopes: ['store']
      }
    });

    expect(readAdminStoreOrdersWorkersCacheProps({ props: validProps })).toMatchObject({
      role: 'limited_admin',
      scopeKey: 'store'
    });
    expect(readAdminStoreOrdersWorkersCacheProps({ props: { ...validProps, source: 'browser' } })).toBeNull();
    expect(readAdminStoreOrdersWorkersCacheProps({ props: { ...validProps, version: 2 } })).toBeNull();
    expect(readAdminStoreOrdersWorkersCacheProps({ props: { ...validProps, role: 'owner' } })).toBeNull();
    expect(readAdminStoreOrdersWorkersCacheProps({ props: { ...validProps, scopeKey: '' } })).toBeNull();
    expect(readAdminStoreOrdersWorkersCacheProps({ props: { ...validProps, scopeKey: 'store admin' } })).toBeNull();
    expect(readAdminStoreOrdersWorkersCacheProps({ props: { ...validProps, scopeKey: 'admin@example.com' } })).toBeNull();
  });

  it('requires trusted internal props before purging admin Orders cache tags', async () => {
    const request = new Request('https://store-cache.internal/__store-cache/admin-orders/purge', {
      method: 'POST'
    });
    const rejected = await CachedAdminStoreOrders.fetch(request, {}, { props: {}, cache: { purge: vi.fn() } });
    expect(rejected.status).toBe(403);

    const purge = vi.fn().mockResolvedValue(undefined);
    const props = {
      ...buildAdminStoreOrdersWorkersCacheProps({ user: { role: 'super_admin' } }),
      scopeKey: 'purge'
    };
    const accepted = await CachedAdminStoreOrders.fetch(request, {}, { props, cache: { purge } });
    expect(accepted.status).toBe(200);
    expect(purge).toHaveBeenCalledWith({ tags: ['admin-orders', 'orders', 'order-index', 'admin-orders-v1'] });
  });

  it('uses the same trusted purge request and props for endpoint-driven purge calls', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, purgedAt: '2026-07-09T00:00:00.000Z' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    const result = await purgeAdminStoreOrdersWorkersCacheNow({
      exports: {
        CachedAdminStoreOrders: { fetch }
      }
    });

    const request = buildAdminStoreOrdersWorkersCachePurgeRequest();
    expect(request.url).toBe('https://store-cache.internal/__store-cache/admin-orders/purge');
    expect(request.method).toBe('POST');
    expect(buildAdminStoreOrdersWorkersCachePurgeProps()).toMatchObject({
      source: 'store-admin-orders-cache-gateway',
      version: 1,
      role: 'super_admin',
      scopeKey: 'purge',
      accessScope: 'store'
    });
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST' }), {
      props: buildAdminStoreOrdersWorkersCachePurgeProps()
    });
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      entrypoint: 'CachedAdminStoreOrders',
      tags: ['admin-orders', 'orders', 'order-index', 'admin-orders-v1']
    });
  });
});

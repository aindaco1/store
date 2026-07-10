import { describe, expect, it, vi } from 'vitest';

import {
  CachedAdminStoreReads,
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
import {
  ADMIN_STORE_READ_CACHE_POLICIES,
  adminStoreReadCacheBypassReason,
  adminStoreReadCachePoliciesForDomains,
  adminStoreReadCacheTagsForDomains,
  buildAdminStoreReadCacheProps,
  buildAdminStoreReadCacheRequest,
  readAdminStoreReadCacheProps,
  STORE_READ_CACHE_MUTATION_DOMAINS,
  workersCacheEnabledForAdminStoreRead
} from '../../worker/src/workers-cache-policy.js';

describe('Workers Cache policy helpers', () => {
  it('builds canonical cache requests without credentials, search PII, or unknown fields', () => {
    const request = new Request('https://checkout.dustwave.xyz/admin/store/orders?watermark=ORDERS-V2-0123456789ABCDEF&fulfillment=Ticket&status=Confirmed&cursor=12&limit=250&q=buyer@example.com&locale=ES&ignored=1', {
      headers: {
        Authorization: 'Bearer secret',
        Cookie: 'store_admin_session=session-token',
        'x-store-admin-csrf': 'csrf-token'
      }
    });
    const cacheRequest = buildAdminStoreOrdersCacheRequest(request);
    const equivalent = buildAdminStoreReadCacheRequest(new Request(
      'https://checkout.dustwave.xyz/admin/store/orders?locale=es&limit=100&cursor=12&status=confirmed&fulfillment=ticket&watermark=orders-v2-0123456789abcdef'
    ), 'orders');
    const url = new URL(cacheRequest.url);

    expect(cacheRequest.url).toBe(equivalent?.url);
    expect(url.origin).toBe('https://store-cache.internal');
    expect(url.pathname).toBe('/admin/store/orders');
    expect(url.searchParams.get('status')).toBe('confirmed');
    expect(url.searchParams.get('fulfillment')).toBe('ticket');
    expect(url.searchParams.get('cursor')).toBe('12');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.get('locale')).toBe('es');
    expect(url.searchParams.get('watermark')).toBe('orders-v2-0123456789abcdef');
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('ignored')).toBe(false);
    expect(cacheRequest.headers.has('Authorization')).toBe(false);
    expect(cacheRequest.headers.has('Cookie')).toBe(false);
    expect(cacheRequest.headers.has('x-store-admin-csrf')).toBe(false);
  });

  it('bypasses search and unsafe requests while allowing reviewed read paths', () => {
    expect(adminStoreOrdersWorkersCacheBypassReason(new Request('https://checkout.dustwave.xyz/admin/store/orders?q=buyer@example.com'))).toBe('search_query');
    expect(adminStoreReadCacheBypassReason(new Request('https://checkout.dustwave.xyz/admin/store/analytics?q=buyer'), 'analytics')).toBe('search_query');
    expect(adminStoreReadCacheBypassReason(new Request('https://checkout.dustwave.xyz/admin/store/inventory', { method: 'POST' }), 'inventory')).toBe('unsafe_method');
    expect(adminStoreReadCacheBypassReason(new Request('https://checkout.dustwave.xyz/webhooks/stripe'), 'orders')).toBe('path_mismatch');
    expect(adminStoreReadCacheBypassReason(new Request('https://checkout.dustwave.xyz/admin/store/downloads'), 'downloads')).toBe('');
  });

  it('honors global and route-level kill switches', () => {
    expect(workersCacheEnabledForAdminStoreOrders({})).toBe(true);
    expect(workersCacheEnabledForAdminStoreRead({ WORKERS_CACHE_ENABLED: 'false' }, 'orders')).toBe(false);
    expect(workersCacheEnabledForAdminStoreRead({ WORKERS_CACHE_ADMIN_ANALYTICS_ENABLED: ' FALSE ' }, 'analytics')).toBe(false);
    expect(workersCacheEnabledForAdminStoreRead({ WORKERS_CACHE_ENABLED: 'true', WORKERS_CACHE_ADMIN_DOWNLOADS_ENABLED: 'true' }, 'downloads')).toBe(true);
    expect(workersCacheEnabledForAdminStoreRead({}, 'checkout')).toBe(false);
  });

  it('partitions reads by route, role, and scope without storing admin identity', () => {
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
      source: 'store-admin-read-cache-gateway',
      version: 2,
      routeId: 'orders',
      role: 'limited_admin',
      scopeKey: 'store',
      accessScope: 'store'
    });
    expect(readAdminStoreOrdersWorkersCacheProps({ props })).toMatchObject({ routeId: 'orders', role: 'limited_admin' });
    expect(buildAdminStoreReadCacheProps({ user: { role: 'super_admin' } }, 'analytics')).toMatchObject({
      routeId: 'analytics',
      role: 'super_admin',
      scopeKey: 'super_admin'
    });
  });

  it('declares route-specific freshness and low-cardinality dependency tags', () => {
    expect(ADMIN_STORE_READ_CACHE_POLICIES.orders.cacheControl).toBe('public, max-age=15, stale-if-error=0');
    expect(ADMIN_STORE_READ_CACHE_POLICIES.analytics.cacheControl).toBe('public, max-age=60, stale-while-revalidate=120, stale-if-error=0');
    expect(ADMIN_STORE_READ_CACHE_POLICIES.inventory.cacheControl).toBe('public, max-age=15, stale-if-error=0');
    expect(ADMIN_STORE_READ_CACHE_POLICIES.downloads.cacheControl).toBe('public, max-age=30, stale-if-error=0');
    for (const policy of Object.values(ADMIN_STORE_READ_CACHE_POLICIES)) {
      for (const tag of policy.tags) {
        expect(tag).toMatch(/^[a-z0-9-]+$/);
        expect(tag).not.toContain('@');
      }
    }
    expect(adminStoreReadCachePoliciesForDomains(['orders']).map((policy) => policy.routeId).sort()).toEqual([
      'analytics', 'inventory', 'orders'
    ]);
  });

  it('uses cacheable headers only on inner cached responses', () => {
    const response = cacheableAdminStoreOrdersJsonResponse({ ok: true }, 200, {
      CORS_ALLOWED_ORIGIN: 'https://shop.dustwave.xyz'
    });

    expect(response.headers.get('Cache-Control')).toBe(ADMIN_STORE_READ_CACHE_POLICIES.orders.cacheControl);
    expect(response.headers.get('Cache-Tag')).toBe(ADMIN_STORE_READ_CACHE_POLICIES.orders.tags.join(','));
    expect(response.headers.has('Set-Cookie')).toBe(false);
  });

  it('supports object and function-style ctx.exports bindings', async () => {
    const props = buildAdminStoreOrdersWorkersCacheProps({ user: { role: 'super_admin' } });
    const request = new Request('https://store-cache.internal/admin/store/orders?status=confirmed');
    const objectFetch = vi.fn().mockResolvedValue(new Response('{}'));
    await fetchAdminStoreOrdersWorkersCache({ exports: { CachedAdminStoreReads: { fetch: objectFetch } } }, request, props);
    expect(objectFetch).toHaveBeenCalledWith(request, { props });

    const functionFetch = vi.fn().mockResolvedValue(new Response('{}'));
    const factory = vi.fn().mockReturnValue({ fetch: functionFetch });
    await fetchAdminStoreOrdersWorkersCache({ exports: { CachedAdminStoreReads: factory } }, request, props);
    expect(factory).toHaveBeenCalledWith({ props });
    expect(functionFetch).toHaveBeenCalledWith(request);

    const hybridFetch = vi.fn().mockResolvedValue(new Response('{}'));
    const hybridFactory = vi.fn().mockReturnValue({ fetch: functionFetch }) as any;
    hybridFactory.fetch = hybridFetch;
    await fetchAdminStoreOrdersWorkersCache({ exports: { CachedAdminStoreReads: hybridFactory } }, request, props);
    expect(hybridFactory).toHaveBeenCalledWith({ props });
    expect(hybridFetch).not.toHaveBeenCalled();
  });

  it('rejects malformed internal props before reading private data', () => {
    const validProps = buildAdminStoreOrdersWorkersCacheProps({ user: { role: 'limited_admin', accessScopes: ['store'] } });
    expect(readAdminStoreReadCacheProps({ props: validProps })).toMatchObject({ routeId: 'orders' });
    expect(readAdminStoreReadCacheProps({ props: { ...validProps, source: 'browser' } })).toBeNull();
    expect(readAdminStoreReadCacheProps({ props: { ...validProps, version: 3 } })).toBeNull();
    expect(readAdminStoreReadCacheProps({ props: { ...validProps, routeId: 'checkout' } })).toBeNull();
    expect(readAdminStoreReadCacheProps({ props: { ...validProps, role: 'owner' } })).toBeNull();
    expect(readAdminStoreReadCacheProps({ props: { ...validProps, scopeKey: '' } })).toBeNull();
    expect(readAdminStoreReadCacheProps({ props: { ...validProps, scopeKey: 'admin@example.com' } })).toBeNull();
    expect(readAdminStoreReadCacheProps({ props: { ...validProps, accessScope: 'platform' } })).toBeNull();
  });

  it('purges dependency tags only with trusted internal props', async () => {
    const request = buildAdminStoreOrdersWorkersCachePurgeRequest();
    const rejected = await CachedAdminStoreReads.fetch(request, {}, { props: {}, cache: { purge: vi.fn() } });
    expect(rejected.status).toBe(403);

    const purge = vi.fn().mockResolvedValue(undefined);
    const props = buildAdminStoreOrdersWorkersCachePurgeProps();
    const accepted = await CachedAdminStoreReads.fetch(request, {}, { props, cache: { purge } });
    const expectedTags = adminStoreReadCacheTagsForDomains(['orders', 'order-index']);
    expect(accepted.status).toBe(200);
    expect(purge).toHaveBeenCalledWith({ tags: expectedTags });
    expect(await accepted.json()).toMatchObject({ domains: ['order-index', 'orders'], tags: expectedTags });
  });

  it('uses the same trusted purge request and props for gateway purge calls', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, purgedAt: '2026-07-09T00:00:00.000Z' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    const result = await purgeAdminStoreOrdersWorkersCacheNow({ exports: { CachedAdminStoreReads: { fetch } } });
    const request = buildAdminStoreOrdersWorkersCachePurgeRequest();

    expect(request.url).toBe('https://store-cache.internal/__store-cache/admin-reads/purge?domains=order-index%2Corders');
    expect(buildAdminStoreOrdersWorkersCachePurgeProps()).toMatchObject({
      source: 'store-admin-read-cache-gateway',
      version: 2,
      routeId: 'orders',
      role: 'super_admin',
      scopeKey: 'purge'
    });
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST' }), {
      props: buildAdminStoreOrdersWorkersCachePurgeProps()
    });
    expect(result).toMatchObject({ ok: true, status: 200, entrypoint: 'CachedAdminStoreReads' });
  });

  it('keeps a complete mutation-to-domain invalidation matrix', () => {
    expect(Object.keys(STORE_READ_CACHE_MUTATION_DOMAINS).sort()).toEqual([
      'check_in',
      'checkout_confirmation',
      'deployment',
      'download_access',
      'download_library',
      'fulfillment',
      'inventory_override',
      'marketing_referrals',
      'product_publish',
      'restore_order',
      'snipcart_import',
      'stripe_failure',
      'stripe_settlement'
    ]);
    for (const domains of Object.values(STORE_READ_CACHE_MUTATION_DOMAINS)) {
      expect(adminStoreReadCachePoliciesForDomains(domains).length).toBeGreaterThan(0);
    }
  });
});

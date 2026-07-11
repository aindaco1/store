export const ADMIN_STORE_READS_CACHE_ENTRYPOINT = 'CachedAdminStoreReads';
export const ADMIN_STORE_READS_CACHE_LEGACY_ENTRYPOINT = 'CachedAdminStoreOrders';
export const ADMIN_STORE_ORDER_INDEX_CACHE_ENTRYPOINT = 'CachedAdminStoreOrderIndex';
export const ADMIN_STORE_READS_CACHE_SOURCE = 'store-admin-read-cache-gateway';
export const ADMIN_STORE_READS_CACHE_PROPS_VERSION = 2;
export const ADMIN_STORE_READS_CACHE_INTERNAL_ORIGIN = 'https://store-cache.internal';
export const ADMIN_STORE_READS_CACHE_PURGE_PATH = '/__store-cache/admin-reads/purge';
export const ADMIN_STORE_ORDER_INDEX_CACHE_PATH = '/__store-cache/admin-order-index';
export const ADMIN_STORE_ORDER_INDEX_CACHE_CONTROL = 'public, max-age=20, stale-if-error=0';
export const ADMIN_STORE_ORDER_INDEX_CACHE_TAGS = Object.freeze([
  'admin-store-reads',
  'admin-store-reads-v2',
  'admin-orders',
  'orders',
  'order-index'
]);

const COMMON_TAGS = ['admin-store-reads', 'admin-store-reads-v2'];

export const ADMIN_STORE_READ_CACHE_POLICIES = Object.freeze({
  orders: Object.freeze({
    routeId: 'orders',
    path: '/admin/store/orders',
    enabledVar: 'WORKERS_CACHE_ADMIN_ORDERS_ENABLED',
    allowedParams: Object.freeze(['status', 'fulfillment', 'limit', 'cursor', 'lang', 'locale', 'since', 'watermark']),
    cacheControl: 'public, max-age=15, stale-if-error=0',
    tags: Object.freeze([...COMMON_TAGS, 'admin-orders', 'orders', 'order-index']),
    domains: Object.freeze(['orders', 'order-index']),
    label: 'Admin Orders'
  }),
  analytics: Object.freeze({
    routeId: 'analytics',
    path: '/admin/store/analytics',
    enabledVar: 'WORKERS_CACHE_ADMIN_ANALYTICS_ENABLED',
    allowedParams: Object.freeze(['status', 'fulfillment', 'lang', 'locale']),
    cacheControl: 'public, max-age=60, stale-while-revalidate=120, stale-if-error=0',
    tags: Object.freeze([...COMMON_TAGS, 'admin-analytics', 'orders', 'order-index', 'analytics', 'marketing']),
    domains: Object.freeze(['orders', 'order-index', 'analytics', 'marketing']),
    label: 'Admin Analytics'
  }),
  inventory: Object.freeze({
    routeId: 'inventory',
    path: '/admin/store/inventory',
    enabledVar: 'WORKERS_CACHE_ADMIN_INVENTORY_ENABLED',
    allowedParams: Object.freeze(['lang', 'locale']),
    cacheControl: 'public, max-age=15, stale-if-error=0',
    tags: Object.freeze([...COMMON_TAGS, 'admin-inventory', 'orders', 'order-index', 'inventory', 'products']),
    domains: Object.freeze(['orders', 'order-index', 'inventory', 'products']),
    label: 'Admin Inventory'
  }),
  downloads: Object.freeze({
    routeId: 'downloads',
    path: '/admin/store/downloads',
    enabledVar: 'WORKERS_CACHE_ADMIN_DOWNLOADS_ENABLED',
    allowedParams: Object.freeze(['lang', 'locale']),
    cacheControl: 'public, max-age=30, stale-if-error=0',
    tags: Object.freeze([...COMMON_TAGS, 'admin-downloads', 'downloads', 'products']),
    domains: Object.freeze(['downloads', 'products']),
    label: 'Admin Download readiness'
  })
});

export const STORE_READ_CACHE_MUTATION_DOMAINS = Object.freeze({
  checkout_confirmation: Object.freeze(['orders', 'order-index']),
  stripe_settlement: Object.freeze(['orders', 'order-index']),
  stripe_failure: Object.freeze(['orders', 'order-index']),
  snipcart_import: Object.freeze(['orders', 'order-index']),
  fulfillment: Object.freeze(['orders', 'order-index']),
  check_in: Object.freeze(['orders', 'order-index']),
  download_access: Object.freeze(['orders', 'order-index']),
  restore_order: Object.freeze(['orders', 'order-index']),
  inventory_override: Object.freeze(['inventory']),
  download_library: Object.freeze(['downloads']),
  marketing_referrals: Object.freeze(['marketing']),
  product_publish: Object.freeze(['products']),
  deployment: Object.freeze(['orders', 'order-index', 'analytics', 'inventory', 'products', 'downloads', 'marketing'])
});

const WATERMARK_PATTERN = /^orders-v2-[a-f0-9]{16}$/;

function enabledValue(value, fallback = true) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return String(value).trim().toLowerCase() !== 'false';
}

export function adminStoreReadCachePolicy(routeId) {
  return ADMIN_STORE_READ_CACHE_POLICIES[String(routeId || '').trim().toLowerCase()] || null;
}

export function adminStoreReadCachePolicyForPath(pathname) {
  const path = String(pathname || '');
  return Object.values(ADMIN_STORE_READ_CACHE_POLICIES).find((policy) => policy.path === path) || null;
}

export function workersCacheEnabledForAdminStoreRead(env = {}, routeId) {
  const policy = adminStoreReadCachePolicy(routeId);
  if (!policy) return false;
  return workersCacheGloballyEnabled(env) && enabledValue(env[policy.enabledVar], true);
}

export function workersCacheGloballyEnabled(env = {}) {
  return enabledValue(env.WORKERS_CACHE_ENABLED, true);
}

export function adminStoreReadCacheBypassReason(request, routeId) {
  const policy = adminStoreReadCachePolicy(routeId);
  if (!policy) return 'unsupported_route';
  const method = String(request?.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return 'unsafe_method';
  const url = new URL(request.url);
  if (url.pathname !== policy.path) return 'path_mismatch';
  if ((routeId === 'orders' || routeId === 'analytics') && String(url.searchParams.get('q') || '').trim()) {
    return 'search_query';
  }
  return '';
}

function clampPageLimit(value) {
  return Math.min(100, Math.max(1, Number.parseInt(String(value || '25'), 10) || 25));
}

export function sanitizeAdminStoreReadCacheParam(key, value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (key === 'limit') return String(clampPageLimit(text));
  if (key === 'cursor') return String(Math.max(0, Number.parseInt(text, 10) || 0));
  if (key === 'lang' || key === 'locale') {
    return text.toLowerCase().replace(/[^a-z-]/g, '').slice(0, 12);
  }
  if (key === 'since') {
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
  }
  if (key === 'watermark') {
    const normalized = text.toLowerCase();
    return WATERMARK_PATTERN.test(normalized) ? normalized : '';
  }
  return text.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

export function buildAdminStoreReadCacheRequest(request, routeId) {
  const policy = adminStoreReadCachePolicy(routeId);
  if (!policy) return null;
  const sourceUrl = new URL(request.url);
  const cacheUrl = new URL(policy.path, ADMIN_STORE_READS_CACHE_INTERNAL_ORIGIN);
  for (const key of policy.allowedParams) {
    if (!sourceUrl.searchParams.has(key)) continue;
    const value = sanitizeAdminStoreReadCacheParam(key, sourceUrl.searchParams.get(key));
    if (value) cacheUrl.searchParams.set(key, value);
  }
  return new Request(cacheUrl.toString(), {
    method: String(request.method || 'GET').toUpperCase() === 'HEAD' ? 'HEAD' : 'GET',
    headers: { Accept: 'application/json' },
    cf: { cacheControl: policy.cacheControl }
  });
}

export function buildAdminStoreOrderIndexCacheRequest() {
  return new Request(new URL(ADMIN_STORE_ORDER_INDEX_CACHE_PATH, ADMIN_STORE_READS_CACHE_INTERNAL_ORIGIN), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cf: { cacheControl: ADMIN_STORE_ORDER_INDEX_CACHE_CONTROL }
  });
}

function normalizedRole(auth = {}) {
  return String(auth.user?.role || '').trim().toLowerCase() === 'super_admin'
    ? 'super_admin'
    : 'limited_admin';
}

export function buildAdminStoreReadCacheProps(auth = {}, routeId) {
  const policy = adminStoreReadCachePolicy(routeId);
  if (!policy) return null;
  const role = normalizedRole(auth);
  const scopes = role === 'super_admin'
    ? ['super_admin']
    : (Array.isArray(auth.user?.accessScopes) ? auth.user.accessScopes : [])
      .map((scope) => String(scope || '').trim().toLowerCase())
      .filter(Boolean)
      .sort();
  return {
    source: ADMIN_STORE_READS_CACHE_SOURCE,
    version: ADMIN_STORE_READS_CACHE_PROPS_VERSION,
    routeId: policy.routeId,
    role,
    scopeKey: scopes.join('|') || 'none',
    accessScope: 'store'
  };
}

export function readAdminStoreReadCacheProps(ctx = null) {
  const props = ctx?.props && typeof ctx.props === 'object' ? ctx.props : {};
  if (props.source !== ADMIN_STORE_READS_CACHE_SOURCE) return null;
  if (Number(props.version || 0) !== ADMIN_STORE_READS_CACHE_PROPS_VERSION) return null;
  const policy = adminStoreReadCachePolicy(props.routeId);
  if (!policy) return null;
  const role = String(props.role || '').trim().toLowerCase();
  if (role !== 'super_admin' && role !== 'limited_admin') return null;
  const scopeKey = String(props.scopeKey || '').trim().toLowerCase();
  if (!scopeKey || /[^a-z0-9:_|-]/.test(scopeKey)) return null;
  const accessScope = String(props.accessScope || '').trim().toLowerCase();
  if (accessScope !== 'store') return null;
  return { routeId: policy.routeId, role, scopeKey, accessScope };
}

export function buildAdminStoreReadCachePurgeProps(routeId) {
  const props = buildAdminStoreReadCacheProps({ user: { role: 'super_admin' } }, routeId);
  return props ? { ...props, scopeKey: 'purge' } : null;
}

export function adminStoreReadCachePoliciesForDomains(domains = []) {
  const requested = new Set((Array.isArray(domains) ? domains : [domains])
    .map((domain) => String(domain || '').trim().toLowerCase())
    .filter(Boolean));
  return Object.values(ADMIN_STORE_READ_CACHE_POLICIES).filter((policy) => (
    policy.domains.some((domain) => requested.has(domain))
  ));
}

export function adminStoreReadCacheTagsForDomains(domains = []) {
  const tags = new Set();
  for (const policy of adminStoreReadCachePoliciesForDomains(domains)) {
    for (const tag of policy.tags) tags.add(tag);
  }
  return Array.from(tags).sort();
}

export function storeReadCacheDomainsForMutation(mutationId) {
  return STORE_READ_CACHE_MUTATION_DOMAINS[String(mutationId || '').trim().toLowerCase()] || [];
}

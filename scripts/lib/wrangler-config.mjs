import { parse } from 'smol-toml';

function normalizedBinding(entry = {}) {
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => (
    ['string', 'number', 'boolean'].includes(typeof value)
  )));
}

export function parseWranglerConfig(content = '') {
  return parse(String(content || ''));
}

export function normalizeWranglerInventory(content = '', options = {}) {
  const parsed = typeof content === 'string' ? parseWranglerConfig(content) : content;
  const environment = String(options.environment || '').trim();
  const envConfig = environment ? parsed.env?.[environment] || {} : {};
  const mergedVars = { ...(parsed.vars || {}), ...(envConfig.vars || {}) };
  const exportsConfig = parsed.exports || {};
  return {
    name: String(parsed.name || ''),
    environment,
    compatibilityDate: String(envConfig.compatibility_date || parsed.compatibility_date || ''),
    compatibilityFlags: Array.isArray(envConfig.compatibility_flags || parsed.compatibility_flags)
      ? [...(envConfig.compatibility_flags || parsed.compatibility_flags)]
      : [],
    cache: {
      enabled: (envConfig.cache?.enabled ?? parsed.cache?.enabled) === true,
      crossVersionCache: (envConfig.cache?.cross_version_cache ?? parsed.cache?.cross_version_cache) === true
    },
    cachedExports: Object.entries(exportsConfig)
      .filter(([, entry]) => entry?.cache?.enabled === true)
      .map(([name]) => name)
      .sort(),
    vars: mergedVars,
    kvNamespaces: (envConfig.kv_namespaces || parsed.kv_namespaces || []).map(normalizedBinding),
    r2Buckets: (envConfig.r2_buckets || parsed.r2_buckets || []).map(normalizedBinding),
    durableObjects: (envConfig.durable_objects?.bindings || parsed.durable_objects?.bindings || []).map(normalizedBinding),
    routes: (envConfig.routes || parsed.routes || []).map(normalizedBinding),
    migrations: (parsed.migrations || []).map(normalizedBinding)
  };
}

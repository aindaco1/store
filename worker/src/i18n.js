import {
  DEFAULT_SITE_BASE,
  getSiteBase
} from './provider-config.js';

export const DEFAULT_STORE_I18N_LANG = 'en';

const FALLBACK_SITE_BASE = DEFAULT_SITE_BASE || 'https://shop.dustwave.xyz';
const STORE_I18N_CACHE = new Map();

export function normalizeStoreLang(value, fallback = DEFAULT_STORE_I18N_LANG) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized) ? normalized : fallback;
}

function interpolateStoreTemplate(template, replacements = {}) {
  let result = String(template || '');
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(`%{${key}}`, String(value ?? ''));
  }
  return result;
}

function getNestedStoreValue(source, key) {
  return String(key || '')
    .split('.')
    .reduce((value, segment) => (value && typeof value === 'object' ? value[segment] : undefined), source);
}

function getStoreI18nSiteBase(env = {}) {
  const configured = String(env.CANONICAL_SITE_BASE || '').trim() || getSiteBase(env);
  try {
    return new URL(configured || FALLBACK_SITE_BASE).origin;
  } catch {
    return FALLBACK_SITE_BASE;
  }
}

function getStoreI18nCatalogUrl(env = {}) {
  return new URL('/assets/i18n.json', getStoreI18nSiteBase(env)).toString();
}

async function loadStoreI18nCatalog(env = {}) {
  if (env.I18N_CATALOG && typeof env.I18N_CATALOG === 'object') {
    return env.I18N_CATALOG;
  }

  if (env.I18N_CATALOG_JSON) {
    const cacheKey = `json:${env.I18N_CATALOG_JSON}`;
    if (!STORE_I18N_CACHE.has(cacheKey)) {
      STORE_I18N_CACHE.set(cacheKey, Promise.resolve()
        .then(() => JSON.parse(String(env.I18N_CATALOG_JSON || '{}')))
        .catch(() => ({})));
    }
    return STORE_I18N_CACHE.get(cacheKey);
  }

  const catalogUrl = getStoreI18nCatalogUrl(env);
  if (!STORE_I18N_CACHE.has(catalogUrl)) {
    STORE_I18N_CACHE.set(catalogUrl, (async () => {
      try {
        const response = await fetch(catalogUrl, {
          headers: {
            Accept: 'application/json'
          }
        });
        if (!response.ok) return {};
        return await response.json();
      } catch (_error) {
        return {};
      }
    })());
  }
  return STORE_I18N_CACHE.get(catalogUrl);
}

export async function getStoreTranslator(env, preferredLang, namespace = '') {
  const lang = normalizeStoreLang(preferredLang);
  const catalog = await loadStoreI18nCatalog(env);
  const normalizedNamespace = String(namespace || '').trim();
  const localizedRoot = normalizedNamespace
    ? catalog?.[lang]?.[normalizedNamespace]
    : catalog?.[lang];
  const defaultRoot = normalizedNamespace
    ? catalog?.[DEFAULT_STORE_I18N_LANG]?.[normalizedNamespace]
    : catalog?.[DEFAULT_STORE_I18N_LANG];

  return {
    lang,
    t(key, fallback, replacements = {}) {
      const localized = getNestedStoreValue(localizedRoot, key);
      const defaultValue = getNestedStoreValue(defaultRoot, key);
      return interpolateStoreTemplate(localized ?? defaultValue ?? fallback ?? key, replacements);
    }
  };
}

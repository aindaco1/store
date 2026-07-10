#!/usr/bin/env node
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const API_BASE = 'https://api.cloudflare.com/client/v4';
export const ADMIN_RESPONSE_RULE_PHASE = 'http_response_cache_settings';
export const ADMIN_RESPONSE_RULE_REF = 'store_admin_no_transform_v1';
export const ADMIN_RESPONSE_RULE_DESCRIPTION = 'Store admin no-transform and no-store';
const ADMIN_PATHS = Object.freeze(['/admin', '/es/admin']);
const ADMIN_PUBLIC_PATHS = Object.freeze(['/admin/', '/es/admin/']);

function normalizedSiteBase(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error('Cloudflare admin response rule requires an HTTPS site origin.');
  }
  return url.origin;
}

function normalizedZoneId(value) {
  const zoneId = String(value || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(zoneId)) {
    throw new Error('Cloudflare admin response rule requires CLOUDFLARE_ZONE_ID.');
  }
  return zoneId;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((output, key) => {
    output[key] = canonicalJson(value[key]);
    return output;
  }, {});
}

export function buildAdminResponseRule(siteBase) {
  const hostname = new URL(normalizedSiteBase(siteBase)).hostname;
  const pathExpression = ADMIN_PATHS.map((path) => (
    `http.request.uri.path eq "${path}" or starts_with(http.request.uri.path, "${path}/")`
  )).join(' or ');
  return {
    action: 'set_cache_control',
    action_parameters: {
      'max-age': { operation: 'set', value: 0 },
      'must-revalidate': { operation: 'set' },
      'no-store': { operation: 'set' },
      'no-transform': { operation: 'set' },
      private: { operation: 'set' }
    },
    description: ADMIN_RESPONSE_RULE_DESCRIPTION,
    enabled: true,
    expression: `(http.host eq "${hostname}" and (${pathExpression}))`,
    ref: ADMIN_RESPONSE_RULE_REF
  };
}

export function adminResponseRuleMatches(actual, desired) {
  if (!actual) return false;
  const selected = {
    action: actual.action,
    action_parameters: actual.action_parameters,
    description: actual.description,
    enabled: actual.enabled !== false,
    expression: actual.expression,
    ref: actual.ref
  };
  return JSON.stringify(canonicalJson(selected)) === JSON.stringify(canonicalJson(desired));
}

function cacheControlDirectives(value) {
  return new Map(String(value || '').split(',').map((part) => {
    const [name, directiveValue = ''] = part.trim().toLowerCase().split('=', 2);
    return [name, directiveValue.replace(/^"|"$/g, '')];
  }).filter(([name]) => name));
}

export async function verifyAdminResponsePolicy(options = {}) {
  const siteBase = normalizedSiteBase(options.siteBase);
  const fetchImpl = options.fetchImpl || fetch;
  const routes = [];
  for (const [index, route] of ADMIN_PUBLIC_PATHS.entries()) {
    const response = await fetchImpl(`${siteBase}${route}?edge-policy-check=${Date.now()}-${index}`, {
      headers: { Accept: 'text/html' },
      redirect: 'error'
    });
    const body = await response.text();
    const cacheControl = response.headers.get('cache-control') || '';
    const directives = cacheControlDirectives(cacheControl);
    const missing = ['private', 'no-store', 'no-transform', 'must-revalidate'].filter((name) => !directives.has(name));
    if (directives.get('max-age') !== '0') missing.push('max-age=0');
    const injected = /challenge-platform\/scripts\/jsd|__CF\$cv|static\.cloudflareinsights\.com\/beacon\.min|data-cf-beacon/i.test(body);
    if (!response.ok || missing.length || injected) {
      throw new Error(`Admin response policy verification failed for ${route} (status ${response.status}; missing ${missing.join(',') || 'none'}; edge injection ${injected ? 'present' : 'absent'}).`);
    }
    routes.push({ route, status: response.status, cacheControl, edgeInjection: false });
  }
  return {
    schemaVersion: 1,
    mode: 'public_verification',
    state: 'current',
    hostname: new URL(siteBase).hostname,
    routes,
    containsResponseBodies: false,
    containsCredentials: false,
    containsCustomerData: false
  };
}

function apiErrorDetails(payload) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  if (!errors.length) return 'no Cloudflare error code';
  return errors.map((error) => String(error?.code || 'unknown')).join(',');
}

async function cloudflareRequest({ zoneId, token, path, method = 'GET', body, fetchImpl = fetch, allowNotFound = false }) {
  const response = await fetchImpl(`${API_BASE}/zones/${zoneId}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error'
  });
  const payload = await response.json().catch(() => ({}));
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok || payload?.success === false) {
    throw new Error(`Cloudflare Rulesets API ${method} failed with status ${response.status} (${apiErrorDetails(payload)}).`);
  }
  return payload?.result || null;
}

function findManagedRule(ruleset) {
  return (ruleset?.rules || []).find((rule) => (
    rule?.ref === ADMIN_RESPONSE_RULE_REF || rule?.description === ADMIN_RESPONSE_RULE_DESCRIPTION
  )) || null;
}

async function readEntrypoint(options) {
  return cloudflareRequest({
    ...options,
    path: `/rulesets/phases/${ADMIN_RESPONSE_RULE_PHASE}/entrypoint`,
    allowNotFound: true
  });
}

export async function configureAdminResponseRule(options = {}) {
  const zoneId = normalizedZoneId(options.zoneId);
  const token = String(options.token || '').trim();
  if (!token) throw new Error('Cloudflare admin response rule requires a dedicated API token.');
  const desired = buildAdminResponseRule(options.siteBase);
  const requestOptions = { zoneId, token, fetchImpl: options.fetchImpl };
  let ruleset = await readEntrypoint(requestOptions);
  let existing = findManagedRule(ruleset);
  let state = existing ? (adminResponseRuleMatches(existing, desired) ? 'current' : 'drifted') : 'missing';
  let operation = 'none';

  if (options.apply === true && state !== 'current') {
    if (!ruleset) {
      operation = 'create_ruleset';
      ruleset = await cloudflareRequest({
        ...requestOptions,
        path: '/rulesets',
        method: 'POST',
        body: {
          name: 'Store cache response rules',
          description: 'Store-managed response cache controls',
          kind: 'zone',
          phase: ADMIN_RESPONSE_RULE_PHASE,
          rules: [desired]
        }
      });
    } else if (!existing) {
      operation = 'add_rule';
      ruleset = await cloudflareRequest({
        ...requestOptions,
        path: `/rulesets/${ruleset.id}/rules`,
        method: 'POST',
        body: desired
      });
    } else {
      operation = 'update_rule';
      ruleset = await cloudflareRequest({
        ...requestOptions,
        path: `/rulesets/${ruleset.id}/rules/${existing.id}`,
        method: 'PATCH',
        body: desired
      });
    }
    existing = findManagedRule(ruleset) || findManagedRule(await readEntrypoint(requestOptions));
    if (!adminResponseRuleMatches(existing, desired)) {
      throw new Error('Cloudflare admin response rule did not verify after apply.');
    }
    state = 'current';
  }

  return {
    schemaVersion: 1,
    mode: options.apply === true ? 'apply' : 'read_only',
    state,
    operation,
    changed: operation !== 'none',
    hostname: new URL(normalizedSiteBase(options.siteBase)).hostname,
    paths: [...ADMIN_PATHS],
    cacheControl: 'private, no-store, no-transform, max-age=0, must-revalidate',
    containsCredentials: false,
    containsCustomerData: false
  };
}

function valueArg(args, name, fallback = '') {
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm run cloudflare:admin-response-rule -- [--verify-public | --apply] [--require-current] [--site-base=https://example.com]');
    console.log('API reads/apply require CLOUDFLARE_ZONE_ID and CLOUDFLARE_CACHE_RULES_API_TOKEN; public verification requires neither.');
    return;
  }
  const siteBase = valueArg(args, '--site-base', process.env.SITE_BASE || 'https://shop.dustwave.xyz');
  const result = args.includes('--verify-public')
    ? await verifyAdminResponsePolicy({ siteBase })
    : await configureAdminResponseRule({
      apply: args.includes('--apply'),
      zoneId: process.env.CLOUDFLARE_ZONE_ID || process.env.CLOUDFLARE_ZONE,
      token: process.env.CLOUDFLARE_CACHE_RULES_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN,
      siteBase
    });
  console.log(JSON.stringify(result, null, 2));
  if (args.includes('--require-current') && result.state !== 'current') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}

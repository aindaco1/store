import { getAllowedOrigin, isValidEmail, SECURITY_HEADERS } from './validation.js';
import { sendAdminLoginEmail } from './email.js';
import { DEFAULT_SITE_BASE } from './provider-config.js';
import { getTurnstileSecret, shouldBypassTurnstile, verifyTurnstile } from './turnstile.js';

export const ADMIN_SESSION_COOKIE = 'store_admin_session';
export const ADMIN_USERS_KV_KEY = 'admin-users:v1';
const ADMIN_CORS_ALLOWED_HEADERS = 'Content-Type, Authorization, x-admin-key, x-store-admin-csrf';

const ADMIN_LOGIN_TTL_SECONDS = 15 * 60;
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
const ADMIN_LOGIN_HISTORY_TTL_SECONDS = 30 * 24 * 60 * 60;
const ADMIN_SESSION_LIST_LIMIT = 200;
const ADMIN_ORDER_NOTIFICATION_SOURCE = 'store_order_admin_notification';
const ADMIN_ORDER_NOTIFICATION_LOGIN_TTL_SECONDS = 5 * 60;
const ADMIN_ORDER_NOTIFICATION_SESSION_TTL_SECONDS = 30 * 60;
const ADMIN_TURNSTILE_ACTION = 'admin_login';

function privateAdminJsonResponse(data, status = 200, env = null, extraHeaders = {}) {
  const origin = getAllowedOrigin(env, false);
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': ADMIN_CORS_ALLOWED_HEADERS,
      'Cache-Control': 'private, no-store, max-age=0',
      ...extraHeaders,
      ...SECURITY_HEADERS
    }
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeLang(lang) {
  const value = String(lang || '').trim().toLowerCase();
  return value === 'es' ? 'es' : 'en';
}

export function getAdminBootstrapEmails(env) {
  return String(env?.ADMIN_BOOTSTRAP_EMAILS || '')
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean);
}

function normalizeAdminAccessScopes(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  return Array.from(new Set(source
    .map((scope) => String(scope || '').trim())
    .filter(Boolean)));
}

function normalizeConfiguredAdminUser(user, source = 'config') {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return null;
  const email = normalizeEmail(user.email);
  if (!isValidEmail(email)) return null;
  const role = String(user.role || '').trim() === 'super_admin' ? 'super_admin' : 'limited_admin';
  const scopeSource = user.accessScopes ?? user.access_scopes ?? [];
  return {
    name: String(user.name || '').trim(),
    email,
    role,
    accessScopes: role === 'super_admin' ? [] : normalizeAdminAccessScopes(scopeSource),
    source
  };
}

export function getConfiguredAdminUsers(env) {
  const raw = String(env?.ADMIN_USERS_JSON || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeConfiguredAdminUser).filter(Boolean);
  } catch {
    return [];
  }
}

export async function getStoredAdminUsers(env) {
  if (!env?.STORE_STATE) return null;
  const stored = await env.STORE_STATE.get(ADMIN_USERS_KV_KEY, { type: 'json' });
  if (!stored) return null;
  const users = Array.isArray(stored) ? stored : stored.users;
  if (!Array.isArray(users)) return null;
  const normalized = users.map((user) => normalizeConfiguredAdminUser(user, 'kv')).filter(Boolean);
  return normalized.length ? normalized : null;
}

export async function getEffectiveAdminUsers(env) {
  const storedUsers = await getStoredAdminUsers(env);
  if (storedUsers?.length) return storedUsers;

  const configuredUsers = getConfiguredAdminUsers(env);
  if (configuredUsers.length) return configuredUsers;

  return getAdminBootstrapEmails(env).map((email) => ({
    name: '',
    email,
    role: 'super_admin',
    accessScopes: [],
    source: 'bootstrap'
  }));
}

export async function saveStoredAdminUsers(env, users = [], meta = {}) {
  if (!env?.STORE_STATE) {
    return { ok: false, status: 503, error: 'Admin user storage unavailable' };
  }
  const normalized = (Array.isArray(users) ? users : [])
    .map((user) => normalizeConfiguredAdminUser(user, 'kv'))
    .filter(Boolean)
    .map((user) => ({
      name: user.name || '',
      email: user.email,
      role: user.role,
      accessScopes: user.role === 'super_admin' ? [] : user.accessScopes
    }));
  await env.STORE_STATE.put(ADMIN_USERS_KV_KEY, JSON.stringify({
    users: normalized,
    updatedAt: new Date().toISOString(),
    updatedBy: normalizeEmail(meta.updatedBy)
  }));
  return { ok: true, users: normalized };
}

function getAdminSecret(env) {
  return env?.ADMIN_SESSION_SECRET || env?.MAGIC_LINK_SECRET || env?.ADMIN_SECRET || '';
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value || ''));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

function base64urlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacSign(secret, data) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return base64urlEncode(new Uint8Array(signature));
}

async function signLoginToken(env, nonce, email, ttlSeconds = ADMIN_LOGIN_TTL_SECONDS) {
  const payload = {
    nonce,
    email,
    exp: Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSeconds || ADMIN_LOGIN_TTL_SECONDS) || ADMIN_LOGIN_TTL_SECONDS)
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = btoa(payloadJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const signature = await hmacSign(getAdminSecret(env), payloadB64);
  return `${payloadB64}.${signature}`;
}

async function verifyLoginToken(env, token) {
  if (!getAdminSecret(env)) return null;
  const [payloadB64, signature] = String(token || '').split('.');
  if (!payloadB64 || !signature) return null;
  const expected = await hmacSign(getAdminSecret(env), payloadB64);
  if (signature.length !== expected.length) return null;
  let result = 0;
  for (let index = 0; index < signature.length; index += 1) {
    result |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  if (result !== 0) return null;

  try {
    const normalized = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
    const payload = JSON.parse(atob(padded));
    if (!payload?.nonce || !payload?.email) return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) {
      return decodeURIComponent(rawValue.join('=') || '');
    }
  }
  return '';
}

function getAdminCsrfHeader(request) {
  return String(request.headers.get('x-store-admin-csrf') || '').trim();
}

function timingSafeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left || !right || left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function getAdminSiteOrigin(env) {
  const configured = String(env?.CORS_ALLOWED_ORIGIN || env?.SITE_BASE || '').trim();
  if (!configured || configured === '*') return '';
  try {
    return new URL(configured).origin;
  } catch {
    return '';
  }
}

function isTrustedAdminOriginRequest(request, env) {
  const expectedOrigin = getAdminSiteOrigin(env);
  if (!expectedOrigin) return true;

  const secFetchSite = String(request.headers.get('Sec-Fetch-Site') || '').trim().toLowerCase();
  if (secFetchSite === 'cross-site') {
    return false;
  }

  const origin = String(request.headers.get('Origin') || '').trim();
  if (origin) {
    return timingSafeEqual(origin, expectedOrigin);
  }

  const referer = String(request.headers.get('Referer') || '').trim();
  if (!referer) return true;

  try {
    return timingSafeEqual(new URL(referer).origin, expectedOrigin);
  } catch {
    return false;
  }
}

function getSiteAdminPath(lang) {
  return normalizeLang(lang) === 'es' ? '/es/admin/' : '/admin/';
}

function getAdminPublicSiteBase(env = {}) {
  const candidates = [
    env?.CANONICAL_SITE_BASE,
    env?.SITE_BASE,
    DEFAULT_SITE_BASE
  ];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(String(candidate || '').trim());
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.origin;
      }
    } catch {
      // Try the next configured origin.
    }
  }
  return DEFAULT_SITE_BASE;
}

function buildAdminUrl(env, token, lang, params = {}) {
  const url = new URL(getSiteAdminPath(lang), getAdminPublicSiteBase(env));
  url.searchParams.set('admin_login', token);
  for (const [key, value] of Object.entries(params || {})) {
    const normalizedKey = String(key || '').trim();
    const normalizedValue = String(value ?? '').trim();
    if (normalizedKey && normalizedKey !== 'admin_login' && normalizedValue) url.searchParams.set(normalizedKey, normalizedValue);
  }
  return url.toString();
}

function isTruthyAdminEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isLocalAdminUrl(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  try {
    const hostname = new URL(text).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function shouldExposeAdminLoginUrl(env) {
  if (isTruthyAdminEnv(env?.ADMIN_EXPOSE_LOGIN_LINK) || isTruthyAdminEnv(env?.ADMIN_DEV_LOGIN_LINKS)) {
    return true;
  }
  if (String(env?.APP_MODE || '').trim().toLowerCase() !== 'test') return false;
  return isLocalAdminUrl(env?.SITE_BASE) || isLocalAdminUrl(env?.WORKER_BASE) || isLocalAdminUrl(env?.CORS_ALLOWED_ORIGIN);
}

function normalizeLoginSource(source) {
  return String(source || 'internal').trim() || 'internal';
}

function summarizeAdminUserAgent(value = '') {
  const userAgent = String(value || '');
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /CriOS\//.test(userAgent)
        ? 'Chrome iOS'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Other';
  const operatingSystem = /iPhone|iPad|iPod/.test(userAgent)
    ? 'iOS/iPadOS'
    : /Mac OS X/.test(userAgent)
      ? 'macOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Other';
  const device = /iPad|Tablet/.test(userAgent)
    ? 'Tablet'
    : /Mobile|iPhone|Android/.test(userAgent)
      ? 'Mobile'
      : 'Desktop';
  return { browser, operatingSystem, device };
}

async function adminNetworkFingerprint(request, env) {
  const address = String(request.headers.get('CF-Connecting-IP') || '').trim();
  const secret = getAdminSecret(env);
  if (!address || !secret) return '';
  return (await hmacSign(secret, `admin-network:${address}`)).slice(0, 16);
}

async function recordAdminLoginHistory(request, env, sessionKey, session = {}) {
  if (!env?.STORE_STATE) return;
  const createdAt = String(session.createdAt || new Date().toISOString());
  const dateKey = createdAt.slice(0, 10);
  const eventId = crypto.randomUUID();
  const historyRecord = {
    sessionKey,
    email: normalizeEmail(session.email),
    role: session.role === 'super_admin' ? 'super_admin' : 'limited_admin',
    source: normalizeLoginSource(session.source),
    createdAt,
    expiresAt: String(session.expiresAt || ''),
    client: summarizeAdminUserAgent(request.headers.get('User-Agent') || ''),
    networkId: await adminNetworkFingerprint(request, env)
  };
  await env.STORE_STATE.put(`admin-login-history:${dateKey}:${eventId}`, JSON.stringify(historyRecord), {
    expirationTtl: ADMIN_LOGIN_HISTORY_TTL_SECONDS,
    metadata: historyRecord
  });
}

function getAdminLoginTtlSeconds(source) {
  return normalizeLoginSource(source) === ADMIN_ORDER_NOTIFICATION_SOURCE
    ? ADMIN_ORDER_NOTIFICATION_LOGIN_TTL_SECONDS
    : ADMIN_LOGIN_TTL_SECONDS;
}

function getAdminSessionTtlSeconds(loginRecord = {}) {
  return normalizeLoginSource(loginRecord.source) === ADMIN_ORDER_NOTIFICATION_SOURCE
    ? ADMIN_ORDER_NOTIFICATION_SESSION_TTL_SECONDS
    : ADMIN_SESSION_TTL_SECONDS;
}

function getAdminTurnstileSecret(env) {
  return getTurnstileSecret(env, ['TURNSTILE_SECRET_KEY', 'ADMIN_TURNSTILE_SECRET_KEY']);
}

function shouldBypassAdminTurnstile(env) {
  return shouldBypassTurnstile(env, 'ADMIN_TURNSTILE_BYPASS');
}

function isAdminTurnstileRequired(env) {
  if (shouldBypassAdminTurnstile(env)) return false;
  return Boolean(getAdminTurnstileSecret(env)) || isTruthyAdminEnv(env?.ADMIN_TURNSTILE_REQUIRED);
}

function adminChallengeErrorResponse(error, status, env) {
  return privateAdminJsonResponse({ error, code: 'admin_challenge_failed' }, status, env);
}

async function verifyAdminTurnstile(request, env, token) {
  if (!isAdminTurnstileRequired(env)) return { ok: true };

  const result = await verifyTurnstile(request, env, token, {
    action: ADMIN_TURNSTILE_ACTION,
    secretEnvNames: ['TURNSTILE_SECRET_KEY', 'ADMIN_TURNSTILE_SECRET_KEY'],
    requiredEnvName: 'ADMIN_TURNSTILE_REQUIRED',
    bypassEnvName: 'ADMIN_TURNSTILE_BYPASS'
  });

  if (result.ok) return { ok: true };

  if (result.code === 'challenge_not_configured') {
    return {
      ok: false,
      response: privateAdminJsonResponse({
        error: 'Admin challenge is not configured',
        code: 'admin_challenge_not_configured'
      }, 503, env)
    };
  }

  if (result.code === 'challenge_required') {
    return {
      ok: false,
      response: privateAdminJsonResponse({
        error: 'Admin challenge required',
        code: 'admin_challenge_required'
      }, 400, env)
    };
  }

  const errorMessage = result.code === 'challenge_unavailable'
    ? 'Admin challenge verification unavailable'
    : 'Admin challenge verification failed';
  return {
    ok: false,
    response: adminChallengeErrorResponse(errorMessage, result.status || 400, env)
  };
}

export async function verifyAdminAuthStartChallenge(request, env, body = {}) {
  const challenge = await verifyAdminTurnstile(request, env, body.turnstileToken || body['cf-turnstile-response']);
  return challenge.ok ? null : challenge.response;
}

export async function createAdminLoginUrl(env, {
  email,
  preferredLang = 'en',
  params = {},
  source = 'internal'
} = {}) {
  const normalizedEmail = normalizeEmail(email);
  const lang = normalizeLang(preferredLang);
  if (!isValidEmail(normalizedEmail) || !env?.STORE_STATE || !getAdminSecret(env)) return '';

  const user = await resolveAdminUser(env, normalizedEmail);
  if (!user) return '';

  const nonce = randomToken(24);
  const normalizedSource = normalizeLoginSource(source);
  const loginTtlSeconds = getAdminLoginTtlSeconds(normalizedSource);
  const token = await signLoginToken(env, nonce, normalizedEmail, loginTtlSeconds);
  await env.STORE_STATE.put(`admin-login:${await sha256Hex(nonce)}`, JSON.stringify({
    email: normalizedEmail,
    role: user.role,
    accessScopes: user.accessScopes || [],
    preferredLang: lang,
    source: normalizedSource,
    createdAt: new Date().toISOString()
  }), { expirationTtl: loginTtlSeconds });

  return buildAdminUrl(env, token, lang, params);
}

function getSessionCookie(token, request, maxAge = ADMIN_SESSION_TTL_SECONDS) {
  const secure = new URL(request.url).protocol === 'https:';
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/admin',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, maxAge)}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie(request) {
  return getSessionCookie('', request, 0);
}

async function getStoredAdminUser(env, email) {
  if (!env?.STORE_STATE) return null;
  const key = `admin-user:${await sha256Hex(email)}`;
  return env.STORE_STATE.get(key, { type: 'json' });
}

async function resolveAdminUser(env, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) return null;

  const storedUsers = await getStoredAdminUsers(env);
  if (storedUsers?.length) {
    const storedUser = storedUsers.find((user) => user.email === normalizedEmail);
    if (storedUser) return storedUser;
    if (getAdminBootstrapEmails(env).includes(normalizedEmail)) {
      return {
        email: normalizedEmail,
        role: 'super_admin',
        accessScopes: [],
        source: 'bootstrap'
      };
    }
    return null;
  }

  const configuredUsers = getConfiguredAdminUsers(env);
  if (configuredUsers.length) {
    const configuredUser = configuredUsers.find((user) => user.email === normalizedEmail);
    if (configuredUser) return configuredUser;
    if (getAdminBootstrapEmails(env).includes(normalizedEmail)) {
      return {
        email: normalizedEmail,
        role: 'super_admin',
        accessScopes: [],
        source: 'bootstrap'
      };
    }
    return null;
  }

  const storedUser = await getStoredAdminUser(env, normalizedEmail);
  if (storedUser?.email) {
    return {
      email: normalizeEmail(storedUser.email),
      role: storedUser.role === 'super_admin' ? 'super_admin' : 'limited_admin',
      accessScopes: Array.isArray(storedUser.accessScopes) ? storedUser.accessScopes.map(String) : [],
      source: 'kv'
    };
  }

  if (getAdminBootstrapEmails(env).includes(normalizedEmail)) {
    return {
      email: normalizedEmail,
      role: 'super_admin',
      accessScopes: [],
      source: 'bootstrap'
    };
  }

  return null;
}

function publicUser(user) {
  return {
    email: user.email,
    role: user.role,
    accessScopes: user.role === 'super_admin' ? [] : (user.accessScopes || [])
  };
}

export async function handleAdminAuthStart(request, env, body = {}) {
  const email = normalizeEmail(body.email);
  const preferredLang = normalizeLang(body.preferredLang);

  if (!isValidEmail(email)) {
    return privateAdminJsonResponse({ error: 'Invalid email' }, 400, env);
  }

  const user = await resolveAdminUser(env, email);
  if (!user) {
    return privateAdminJsonResponse({ success: true, sent: true }, 200, env);
  }

  if (!env?.STORE_STATE || !getAdminSecret(env)) {
    return privateAdminJsonResponse({ error: 'Admin auth not configured' }, 503, env);
  }

  const nonce = randomToken(24);
  const token = await signLoginToken(env, nonce, email);
  const loginUrl = buildAdminUrl(env, token, preferredLang);
  await env.STORE_STATE.put(`admin-login:${await sha256Hex(nonce)}`, JSON.stringify({
    email,
    role: user.role,
    accessScopes: user.accessScopes || [],
    preferredLang,
    createdAt: new Date().toISOString()
  }), { expirationTtl: ADMIN_LOGIN_TTL_SECONDS });

  const exposeLoginUrl = shouldExposeAdminLoginUrl(env);
  const emailResult = exposeLoginUrl
    ? { sent: false, reason: 'development login link exposed' }
    : await sendAdminLoginEmail(env, { email, loginUrl, lang: preferredLang });

  return privateAdminJsonResponse({
    success: true,
    sent: emailResult.sent !== false,
    loginUrl: exposeLoginUrl ? loginUrl : undefined
  }, 200, env);
}

export async function handleAdminAuthExchange(request, env, body = {}) {
  const payload = await verifyLoginToken(env, body.token);
  if (!payload || !env?.STORE_STATE) {
    return privateAdminJsonResponse({ error: 'Invalid or expired token' }, 401, env);
  }

  const nonceKey = `admin-login:${await sha256Hex(payload.nonce)}`;
  const loginRecord = await env.STORE_STATE.get(nonceKey, { type: 'json' });
  if (!loginRecord || normalizeEmail(loginRecord.email) !== normalizeEmail(payload.email)) {
    return privateAdminJsonResponse({ error: 'Invalid or expired token' }, 401, env);
  }
  await env.STORE_STATE.delete(nonceKey);

  const user = await resolveAdminUser(env, loginRecord.email);
  if (!user) {
    return privateAdminJsonResponse({ error: 'Unauthorized' }, 401, env);
  }

  const sessionToken = randomToken(32);
  const csrfToken = randomToken(24);
  const sessionTtlSeconds = getAdminSessionTtlSeconds(loginRecord);
  const expiresAt = new Date(Date.now() + sessionTtlSeconds * 1000).toISOString();
  const sessionKey = `admin-session:${await sha256Hex(sessionToken)}`;
  const sessionRecord = {
    email: user.email,
    role: user.role,
    accessScopes: user.accessScopes || [],
    csrfToken,
    preferredLang: normalizeLang(loginRecord.preferredLang),
    source: normalizeLoginSource(loginRecord.source),
    createdAt: new Date().toISOString(),
    expiresAt
  };
  await env.STORE_STATE.put(sessionKey, JSON.stringify(sessionRecord), { expirationTtl: sessionTtlSeconds });
  await recordAdminLoginHistory(request, env, sessionKey, sessionRecord);

  return privateAdminJsonResponse({
    success: true,
    user: publicUser(user),
    csrfToken,
    expiresAt
  }, 200, env, {
    'Set-Cookie': getSessionCookie(sessionToken, request, sessionTtlSeconds)
  });
}

async function listAdminKeys(env, prefix, limit = ADMIN_SESSION_LIST_LIMIT) {
  if (!env?.STORE_STATE?.list) return [];
  const listing = await env.STORE_STATE.list({ prefix, limit: Math.max(1, Math.min(1000, limit)) });
  return Array.isArray(listing?.keys) ? listing.keys : [];
}

export async function listAdminSessionReview(env) {
  const [sessionKeys, historyKeys] = await Promise.all([
    listAdminKeys(env, 'admin-session:'),
    listAdminKeys(env, 'admin-login-history:', 1000)
  ]);
  const now = Date.now();
  const active = [];
  for (const key of sessionKeys) {
    const keyName = String(key?.name || '');
    if (!/^admin-session:[a-f0-9]{64}$/.test(keyName)) continue;
    const session = await env.STORE_STATE.get(keyName, { type: 'json' });
    if (!session?.email || new Date(session.expiresAt || 0).getTime() <= now) continue;
    active.push({
      id: keyName.slice('admin-session:'.length),
      email: normalizeEmail(session.email),
      role: session.role === 'super_admin' ? 'super_admin' : 'limited_admin',
      source: normalizeLoginSource(session.source),
      createdAt: String(session.createdAt || ''),
      expiresAt: String(session.expiresAt || '')
    });
  }
  const activeIds = new Set(active.map((session) => session.id));
  const historyBySessionId = new Map();
  const recent = [];
  for (const key of historyKeys) {
    const keyName = String(key?.name || '');
    if (!keyName.startsWith('admin-login-history:')) continue;
    const record = key?.metadata && typeof key.metadata === 'object'
      ? key.metadata
      : await env.STORE_STATE.get(keyName, { type: 'json' });
    if (!record?.email || !record?.createdAt) continue;
    const sessionId = String(record.sessionKey || '').replace(/^admin-session:/, '');
    if (/^[a-f0-9]{64}$/.test(sessionId)) historyBySessionId.set(sessionId, record);
    recent.push({
      email: normalizeEmail(record.email),
      role: record.role === 'super_admin' ? 'super_admin' : 'limited_admin',
      source: normalizeLoginSource(record.source),
      createdAt: String(record.createdAt || ''),
      expiresAt: String(record.expiresAt || ''),
      client: record.client && typeof record.client === 'object' ? record.client : {},
      networkId: String(record.networkId || ''),
      active: activeIds.has(sessionId)
    });
  }
  active.forEach((session) => {
    const history = historyBySessionId.get(session.id) || {};
    session.client = history.client && typeof history.client === 'object' ? history.client : {};
    session.networkId = String(history.networkId || '');
  });
  active.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  recent.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    active: active.slice(0, ADMIN_SESSION_LIST_LIMIT),
    recent: recent.slice(0, ADMIN_SESSION_LIST_LIMIT),
    retentionDays: ADMIN_LOGIN_HISTORY_TTL_SECONDS / (24 * 60 * 60)
  };
}

export async function revokeAdminSessionById(env, id = '') {
  const normalized = String(id || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    return { ok: false, status: 400, error: 'Invalid admin session ID' };
  }
  const key = `admin-session:${normalized}`;
  const session = await env?.STORE_STATE?.get(key, { type: 'json' });
  if (!session?.email) return { ok: false, status: 404, error: 'Admin session not found' };
  await env.STORE_STATE.delete(key);
  return {
    ok: true,
    session: {
      id: normalized,
      email: normalizeEmail(session.email),
      role: session.role === 'super_admin' ? 'super_admin' : 'limited_admin',
      createdAt: String(session.createdAt || ''),
      expiresAt: String(session.expiresAt || '')
    }
  };
}

export async function requireAdminSession(request, env, permission = 'store:read', options = {}) {
  const sessionToken = getCookie(request, ADMIN_SESSION_COOKIE);
  if (!sessionToken || !env?.STORE_STATE) {
    return { ok: false, response: privateAdminJsonResponse({ error: 'Unauthorized' }, 401, env) };
  }

  const sessionId = await sha256Hex(sessionToken);
  const session = await env.STORE_STATE.get(`admin-session:${sessionId}`, { type: 'json' });
  if (!session?.email || !session?.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    return { ok: false, response: privateAdminJsonResponse({ error: 'Unauthorized' }, 401, env) };
  }

  if (options.requireCsrf === true) {
    if (!isTrustedAdminOriginRequest(request, env)) {
      return { ok: false, response: privateAdminJsonResponse({ error: 'Origin not allowed' }, 403, env) };
    }
    if (!timingSafeEqual(getAdminCsrfHeader(request), session.csrfToken)) {
      return { ok: false, response: privateAdminJsonResponse({ error: 'Invalid CSRF token' }, 403, env) };
    }
  }

  const user = await resolveAdminUser(env, session.email);
  if (!user) {
    return { ok: false, response: privateAdminJsonResponse({ error: 'Unauthorized' }, 401, env) };
  }

  const accessScope = options.accessScope ? String(options.accessScope) : '';
  const allowedScope = user.role === 'super_admin' || !accessScope || user.accessScopes.includes(accessScope);
  const allowed = user.role === 'super_admin' || (
    allowedScope &&
    ['store:read', 'settings:publish', 'fulfillment:manage'].includes(permission)
  );

  if (!allowed) {
    return { ok: false, response: privateAdminJsonResponse({ error: 'Forbidden' }, 403, env) };
  }

  return {
    ok: true,
    user: publicUser(user),
    session,
    sessionId,
    csrfToken: session.csrfToken
  };
}

export async function handleAdminSession(request, env) {
  const auth = await requireAdminSession(request, env, 'store:read');
  if (!auth.ok) return auth.response;
  return privateAdminJsonResponse({
    user: auth.user,
    csrfToken: auth.csrfToken,
    expiresAt: auth.session.expiresAt,
    sessionId: auth.sessionId
  }, 200, env);
}

export async function handleAdminLogout(request, env) {
  const sessionToken = getCookie(request, ADMIN_SESSION_COOKIE);
  if (!sessionToken) {
    return privateAdminJsonResponse({ success: true }, 200, env, {
      'Set-Cookie': clearSessionCookie(request)
    });
  }

  if (sessionToken && env?.STORE_STATE) {
    const sessionKey = `admin-session:${await sha256Hex(sessionToken)}`;
    const session = await env.STORE_STATE.get(sessionKey, { type: 'json' });
    if (session?.csrfToken && !isTrustedAdminOriginRequest(request, env)) {
      return privateAdminJsonResponse({ error: 'Origin not allowed' }, 403, env);
    }
    if (session?.csrfToken && !timingSafeEqual(getAdminCsrfHeader(request), session.csrfToken)) {
      return privateAdminJsonResponse({ error: 'Invalid CSRF token' }, 403, env);
    }
    await env.STORE_STATE.delete(sessionKey);
  }
  return privateAdminJsonResponse({ success: true }, 200, env, {
    'Set-Cookie': clearSessionCookie(request)
  });
}

export function adminCorsResponse(env = null) {
  const origin = getAllowedOrigin(env, false);
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': ADMIN_CORS_ALLOWED_HEADERS,
      ...SECURITY_HEADERS
    }
  });
}

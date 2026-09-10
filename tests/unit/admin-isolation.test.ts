import { describe, expect, it } from 'vitest';
import worker from '../../worker/src/index.js';
import {
  createAdminLoginUrl, getEffectiveAdminUsers, handleAdminAuthExchange,
  listAdminSessionReview, requireAdminSession, revokeAdminSessionById, saveStoredAdminUsers
} from '../../worker/src/admin-auth.js';

class MemoryKV {
  values = new Map<string, string>();
  async get(key: string, options?: { type?: string }) {
    const value = this.values.get(key);
    return value == null ? null : options?.type === 'json' ? JSON.parse(value) : value;
  }
  async put(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
  async list({ prefix = '' } = {}) {
    return { keys: [...this.values.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })), list_complete: true };
  }
}

function environment() {
  return {
    APP_MODE: 'test', SITE_BASE: 'https://shop.test', WORKER_BASE: 'https://checkout.test',
    CORS_ALLOWED_ORIGIN: 'https://shop.test', ADMIN_SESSION_SECRET: 'isolation-test-secret',
    ADMIN_USERS_JSON: JSON.stringify([{ email: 'owner@example.com', role: 'super_admin' }]),
    STORE_STATE: new MemoryKV(), RATELIMIT: new MemoryKV()
  };
}

async function signIn(env: ReturnType<typeof environment>, email: string) {
  const url = await createAdminLoginUrl(env, { email });
  const response = await handleAdminAuthExchange(new Request(`${env.WORKER_BASE}/admin/auth/exchange`, { method: 'POST' }), env, {
    token: new URL(url).searchParams.get('admin_login')
  });
  expect(response.status).toBe(200);
  const data = await response.json();
  return {
    Cookie: String(response.headers.get('set-cookie')).split(';')[0],
    Origin: env.SITE_BASE, 'Content-Type': 'application/json', 'x-store-admin-csrf': data.csrfToken
  };
}

describe('Store admin isolation from a shared Pool namespace', () => {
  it('ignores Pool users and never overwrites their campaign assignments', async () => {
    const env = environment();
    const pool = JSON.stringify({ users: [
      { email: 'pool-owner@example.com', role: 'super_admin', campaignSlugs: [] },
      { email: 'both@example.com', role: 'campaign_user', campaignSlugs: ['film'] },
      { email: 'pool-only@example.com', role: 'campaign_user', campaignSlugs: [] }
    ] });
    await env.STORE_STATE.put('admin-users:v1', pool);
    expect((await getEffectiveAdminUsers(env)).map(user => user.email)).toEqual(['owner@example.com']);
    expect(await createAdminLoginUrl(env, { email: 'pool-owner@example.com' })).toBe('');
    expect(await createAdminLoginUrl(env, { email: 'pool-only@example.com' })).toBe('');

    await saveStoredAdminUsers(env, [
      { email: 'owner@example.com', role: 'super_admin' },
      { email: 'both@example.com', role: 'limited_admin', accessScopes: ['store'] },
      { email: 'store-only@example.com', role: 'limited_admin', accessScopes: ['store'] }
    ]);
    expect(await env.STORE_STATE.get('admin-users:v1')).toBe(pool);
    expect((await getEffectiveAdminUsers(env)).map(user => user.email)).toEqual([
      'owner@example.com', 'both@example.com', 'store-only@example.com'
    ]);
    await signIn(env, 'both@example.com');
    await signIn(env, 'store-only@example.com');
    expect(await createAdminLoginUrl(env, { email: 'pool-only@example.com' })).toBe('');
  });

  it('does not reinterpret copied Pool roles as Store access', async () => {
    const env = environment();
    env.ADMIN_USERS_JSON = JSON.stringify([
      { email: 'pool-only@example.com', role: 'campaign_user', campaignSlugs: ['film'] },
      { email: 'unassigned@example.com', role: 'limited_admin', accessScopes: [] },
      { email: 'owner@example.com', role: 'super_admin' }
    ]);
    expect((await getEffectiveAdminUsers(env)).map(user => user.email)).toEqual(['owner@example.com']);
  });

  it('rejects unscoped login nonces and sessions, and leaves Pool session review and revocation untouched', async () => {
    const env = environment();
    const url = await createAdminLoginUrl(env, { email: 'owner@example.com' });
    const nonceKey = [...env.STORE_STATE.values.keys()].find(key => key.startsWith('store-admin-login:'))!;
    const poolNonceKey = nonceKey.replace('store-', '');
    await env.STORE_STATE.put(poolNonceKey, env.STORE_STATE.values.get(nonceKey)!);
    await env.STORE_STATE.delete(nonceKey);
    const exchange = await handleAdminAuthExchange(new Request(`${env.WORKER_BASE}/admin/auth/exchange`), env, {
      token: new URL(url).searchParams.get('admin_login')
    });
    expect(exchange.status).toBe(401);
    expect(env.STORE_STATE.values.has(poolNonceKey)).toBe(true);

    const headers = await signIn(env, 'owner@example.com');
    const sessionKey = [...env.STORE_STATE.values.keys()].find(key => key.startsWith('store-admin-session:'))!;
    const poolSessionKey = sessionKey.replace('store-', '');
    await env.STORE_STATE.put(poolSessionKey, env.STORE_STATE.values.get(sessionKey)!);
    await env.STORE_STATE.delete(sessionKey);
    const request = new Request(`${env.WORKER_BASE}/admin/session`, { headers });
    expect((await requireAdminSession(request, env)).response.status).toBe(401);
    expect((await listAdminSessionReview(env)).active).toHaveLength(0);
    expect((await revokeAdminSessionById(env, poolSessionKey.slice('admin-session:'.length))).ok).toBe(false);
    expect(env.STORE_STATE.values.has(poolSessionKey)).toBe(true);
  });

  it('allows limited Store operations while denying settings and user management at the API', async () => {
    const env = environment();
    await saveStoredAdminUsers(env, [
      { email: 'owner@example.com', role: 'super_admin' },
      { email: 'operator@example.com', role: 'limited_admin', accessScopes: ['store'] }
    ]);
    const headers = await signIn(env, 'operator@example.com');
    const request = new Request(`${env.WORKER_BASE}/admin/store/products`, { headers });
    for (const permission of ['store:read', 'settings:publish', 'fulfillment:manage']) {
      expect((await requireAdminSession(request, env, permission, { accessScope: 'store', requireCsrf: true })).ok).toBe(true);
    }
    for (const [path, method, body] of [
      ['/admin/settings', 'GET', undefined], ['/admin/plan-usage', 'GET', undefined],
      ['/admin/users', 'POST', { users: [] }],
      ['/admin/settings/preview', 'POST', { changes: [{ path: 'platform.name', value: 'Changed' }] }],
      ['/admin/settings/publish', 'POST', { changes: [{ path: 'platform.name', value: 'Changed' }] }]
    ] as const) {
      const response = await worker.fetch(new Request(`${env.WORKER_BASE}${path}`, {
        method, headers, body: body ? JSON.stringify(body) : undefined
      }), env as any, { waitUntil() {} } as any);
      expect(response.status, path).toBe(403);
      expect(response.headers.get('cache-control')).toContain('private');
    }
    expect((await getEffectiveAdminUsers(env)).find(user => user.email === 'operator@example.com')?.role).toBe('limited_admin');
  });

  it('returns an actionable validation error without changing either user list', async () => {
    const env = environment();
    const headers = await signIn(env, 'owner@example.com');
    const response = await worker.fetch(new Request(`${env.WORKER_BASE}/admin/users`, {
      method: 'POST', headers, body: JSON.stringify({ users: [
        { email: 'owner@example.com', role: 'super_admin' },
        { email: 'operator@example.com', role: 'limited_admin', accessScopes: [] }
      ] })
    }), env as any, { waitUntil() {} } as any);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'Limited admin "operator@example.com" needs at least one access area.' });
    expect(env.STORE_STATE.values.has('store-admin-users:v1')).toBe(false);
    expect(env.STORE_STATE.values.has('admin-users:v1')).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { createAdminLoginUrl, handleAdminAuthExchange, handleAdminAuthStart, listAdminSessionReview, revokeAdminSessionById } from '../../worker/src/admin-auth.js';

class MockKVNamespace {
  store = new Map<string, string>();
  put = vi.fn(async (key: string, value: string, _options?: unknown) => {
    this.store.set(key, value);
  });
  get = vi.fn(async (key: string, options?: { type?: string }) => {
    if (!this.store.has(key)) return null;
    const value = this.store.get(key) as string;
    return options?.type === 'json' ? JSON.parse(value) : value;
  });
  delete = vi.fn(async (key: string) => {
    this.store.delete(key);
  });
  list = vi.fn(async (options?: { prefix?: string; limit?: number }) => ({
    keys: Array.from(this.store.keys())
      .filter((key) => key.startsWith(options?.prefix || ''))
      .sort()
      .slice(0, options?.limit || 1000)
      .map((name) => ({ name })),
    list_complete: true
  }));
}

describe('admin auth links', () => {
  it('builds exposed admin login links from the canonical public site base', async () => {
    const storeState = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined)
    };
    const response = await handleAdminAuthStart(
      new Request('http://127.0.0.1:8989/admin/auth/start', {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:4002' }
      }),
      {
        APP_MODE: 'test',
        SITE_BASE: 'http://127.0.0.1:4002',
        CANONICAL_SITE_BASE: 'https://shop.dustwave.xyz',
        CORS_ALLOWED_ORIGIN: 'http://127.0.0.1:4002',
        ADMIN_BOOTSTRAP_EMAILS: 'admin@example.com',
        ADMIN_EXPOSE_LOGIN_LINK: 'true',
        ADMIN_SESSION_SECRET: 'test_admin_session_secret',
        STORE_STATE: storeState
      },
      { email: 'admin@example.com', preferredLang: 'en' }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.loginUrl).toMatch(/^https:\/\/shop\.dustwave\.xyz\/admin\/\?admin_login=/);
    expect(storeState.put).toHaveBeenCalledOnce();
  });

  it('builds authenticated admin deep links with requested admin params', async () => {
    const storeState = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined)
    };
    const loginUrl = await createAdminLoginUrl(
      {
        SITE_BASE: 'http://127.0.0.1:4002',
        CANONICAL_SITE_BASE: 'https://shop.dustwave.xyz',
        ADMIN_BOOTSTRAP_EMAILS: 'admin@example.com',
        ADMIN_SESSION_SECRET: 'test_admin_session_secret',
        STORE_STATE: storeState
      },
      {
        email: 'admin@example.com',
        preferredLang: 'en',
        params: { tab: 'store-orders', admin_login: 'clobber-token' },
        source: 'store_order_admin_notification'
      }
    );

    const parsed = new URL(loginUrl);
    expect(parsed.origin).toBe('https://shop.dustwave.xyz');
    expect(parsed.pathname).toBe('/admin/');
    expect(parsed.searchParams.get('admin_login')).toBeTruthy();
    expect(parsed.searchParams.get('admin_login')).not.toBe('clobber-token');
    expect(parsed.searchParams.get('tab')).toBe('store-orders');
    expect(storeState.put).toHaveBeenCalledOnce();
    const [key, value, options] = storeState.put.mock.calls[0];
    expect(key).toMatch(/^admin-login:/);
    expect(JSON.parse(String(value))).toMatchObject({
      email: 'admin@example.com',
      role: 'super_admin',
      source: 'store_order_admin_notification'
    });
    expect(options).toMatchObject({ expirationTtl: 300 });
  });

  it('consumes authenticated order notification links once and creates a shorter admin session', async () => {
    const storeState = new MockKVNamespace();
    const env = {
      SITE_BASE: 'http://127.0.0.1:4002',
      CANONICAL_SITE_BASE: 'https://shop.dustwave.xyz',
      ADMIN_BOOTSTRAP_EMAILS: 'admin@example.com',
      ADMIN_SESSION_SECRET: 'test_admin_session_secret',
      STORE_STATE: storeState
    };
    const loginUrl = await createAdminLoginUrl(env, {
      email: 'admin@example.com',
      preferredLang: 'en',
      params: { tab: 'store-orders' },
      source: 'store_order_admin_notification'
    });
    const token = new URL(loginUrl).searchParams.get('admin_login') || '';

    const firstResponse = await handleAdminAuthExchange(
      new Request('https://shop.dustwave.xyz/admin/auth/exchange', { method: 'POST' }),
      env,
      { token }
    );

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('Set-Cookie')).toContain('Max-Age=1800');
    expect(Array.from(storeState.store.keys()).filter((key) => key.startsWith('admin-login:'))).toHaveLength(0);
    const sessionKeys = Array.from(storeState.store.keys()).filter((key) => key.startsWith('admin-session:'));
    expect(sessionKeys).toHaveLength(1);
    expect(JSON.parse(storeState.store.get(sessionKeys[0]) || '{}')).toMatchObject({
      email: 'admin@example.com',
      role: 'super_admin',
      source: 'store_order_admin_notification'
    });
    const sessionPut = storeState.put.mock.calls.find(([key]) => String(key).startsWith('admin-session:'));
    expect(sessionPut?.[2]).toMatchObject({ expirationTtl: 1800 });

    const secondResponse = await handleAdminAuthExchange(
      new Request('https://shop.dustwave.xyz/admin/auth/exchange', { method: 'POST' }),
      env,
      { token }
    );
    expect(secondResponse.status).toBe(401);
  });

  it('retains redacted login metadata and supports explicit session revocation', async () => {
    const storeState = new MockKVNamespace();
    const env = {
      SITE_BASE: 'https://shop.dustwave.xyz',
      CORS_ALLOWED_ORIGIN: 'https://shop.dustwave.xyz',
      ADMIN_BOOTSTRAP_EMAILS: 'admin@example.com',
      ADMIN_SESSION_SECRET: 'test_admin_session_secret',
      STORE_STATE: storeState
    };
    const loginUrl = await createAdminLoginUrl(env, { email: 'admin@example.com' });
    const token = new URL(loginUrl).searchParams.get('admin_login') || '';
    const rawUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36';
    const rawIp = '203.0.113.42';
    const response = await handleAdminAuthExchange(new Request('https://shop.dustwave.xyz/admin/auth/exchange', {
      method: 'POST',
      headers: {
        'User-Agent': rawUserAgent,
        'CF-Connecting-IP': rawIp
      }
    }), env, { token });

    expect(response.status).toBe(200);
    const review = await listAdminSessionReview(env);
    expect(review.retentionDays).toBe(30);
    expect(review.active).toHaveLength(1);
    expect(review.active[0]).toMatchObject({
      email: 'admin@example.com',
      client: { browser: 'Chrome', operatingSystem: 'macOS', device: 'Desktop' }
    });
    expect(review.active[0].networkId).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(review.recent[0]).toMatchObject({ email: 'admin@example.com', active: true });
    expect(Array.from(storeState.store.values()).join('\n')).not.toContain(rawUserAgent);
    expect(Array.from(storeState.store.values()).join('\n')).not.toContain(rawIp);

    const revoked = await revokeAdminSessionById(env, review.active[0].id);
    expect(revoked.ok).toBe(true);
    expect((await listAdminSessionReview(env)).active).toHaveLength(0);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { createAdminLoginUrl, handleAdminAuthStart } from '../../worker/src/admin-auth.js';

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
    expect(options).toMatchObject({ expirationTtl: 900 });
  });
});

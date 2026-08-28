import { describe, expect, it } from 'vitest';

import worker from '../../worker/src/index.js';

class MockKVNamespace {
  store = new Map<string, string>();

  async get(key: string, options?: { type?: string }) {
    const value = this.store.get(key);
    if (value == null) return null;
    return options?.type === 'json' ? JSON.parse(value) : value;
  }

  async put(key: string, value: string) {
    this.store.set(key, value);
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}

function buildEnvironment() {
  return {
    APP_MODE: 'test',
    SITE_BASE: 'https://shop.test',
    WORKER_BASE: 'https://checkout.test',
    CORS_ALLOWED_ORIGIN: 'https://shop.test',
    ADMIN_USERS_JSON: JSON.stringify([
      { name: 'Owner', email: 'owner@example.com', role: 'super_admin', accessScopes: [] }
    ]),
    ADMIN_SESSION_SECRET: 'test-admin-session-secret',
    ADMIN_EXPOSE_LOGIN_LINK: 'true',
    RESEND_API_KEY: 'test-resend-key',
    STORE_EMAIL_CAPTURE_PAYLOAD: 'true',
    PLATFORM_NAME: 'Test Store',
    SUPPORT_EMAIL: 'support@shop.test',
    UPDATES_EMAIL_FROM: 'Test Store <updates@shop.test>',
    I18N_CATALOG_JSON: JSON.stringify({ en: { email: {} } }),
    STORE_STATE: new MockKVNamespace(),
    RATELIMIT: new MockKVNamespace()
  };
}

async function createAdminSession(env: ReturnType<typeof buildEnvironment>) {
  const start = await worker.fetch(new Request(`${env.WORKER_BASE}/admin/auth/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: env.SITE_BASE,
      'CF-Connecting-IP': '203.0.113.10'
    },
    body: JSON.stringify({ email: 'owner@example.com', preferredLang: 'en' })
  }), env as any, { waitUntil() {} } as any);
  const loginUrl = String((await start.json()).loginUrl || '');
  const token = new URL(loginUrl).searchParams.get('admin_login') || '';
  const exchange = await worker.fetch(new Request(`${env.WORKER_BASE}/admin/auth/exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: env.SITE_BASE,
      'CF-Connecting-IP': '203.0.113.11'
    },
    body: JSON.stringify({ token })
  }), env as any, { waitUntil() {} } as any);
  const body = await exchange.json() as { csrfToken?: string };
  return {
    cookie: String(exchange.headers.get('set-cookie') || '').split(';')[0],
    csrfToken: String(body.csrfToken || '')
  };
}

describe('admin user invitations', () => {
  it('sends a one-click invite that exchanges directly for the invited user session', async () => {
    const env = buildEnvironment();
    const session = await createAdminSession(env);
    const save = await worker.fetch(new Request(`${env.WORKER_BASE}/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: session.cookie,
        Origin: env.SITE_BASE,
        'x-store-admin-csrf': session.csrfToken,
        'CF-Connecting-IP': '203.0.113.12'
      },
      body: JSON.stringify({
        preferredLang: 'en',
        users: [
          { name: 'Owner', email: 'owner@example.com', role: 'super_admin', accessScopes: [] },
          { name: 'Editor', email: 'editor@example.com', role: 'limited_admin', accessScopes: ['store'] }
        ]
      })
    }), env as any, { waitUntil() {} } as any);

    expect(save.status).toBe(200);
    expect(await save.json()).toMatchObject({
      success: true,
      notifications: {
        newUserEmails: ['editor@example.com'],
        sent: ['editor@example.com'],
        failed: []
      }
    });

    const emailPayload = (env as any).__STORE_CAPTURED_EMAIL_PAYLOAD;
    expect(emailPayload.to).toBe('editor@example.com');
    const inviteUrl = String(emailPayload.text || '').match(/https:\/\/shop\.test\/admin\/\?[^\s)]+/)?.[0] || '';
    const invitation = new URL(inviteUrl);
    expect(invitation.searchParams.get('tab')).toBe('store-orders');
    const inviteToken = invitation.searchParams.get('admin_login') || '';
    expect(inviteToken).toBeTruthy();

    const exchange = await worker.fetch(new Request(`${env.WORKER_BASE}/admin/auth/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: env.SITE_BASE,
        'CF-Connecting-IP': '203.0.113.13'
      },
      body: JSON.stringify({ token: inviteToken })
    }), env as any, { waitUntil() {} } as any);

    expect(exchange.status).toBe(200);
    expect(await exchange.json()).toMatchObject({
      success: true,
      user: {
        email: 'editor@example.com',
        role: 'limited_admin',
        accessScopes: ['store']
      }
    });
    expect(exchange.headers.get('set-cookie')).toContain('store_admin_session=');
  });
});

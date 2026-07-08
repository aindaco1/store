import { describe, expect, it } from 'vitest';
import worker from '../../worker/src/index.js';

class MockKVNamespace {
  store = new Map<string, string>();

  async get(key: string, options?: { type?: string }) {
    if (!this.store.has(key)) return null;
    const value = this.store.get(key) as string;
    if (options?.type === 'json') return JSON.parse(value);
    return value;
  }

  async put(key: string, value: string) {
    this.store.set(key, value);
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}

function buildEnv() {
  return {
    APP_MODE: 'live',
    SITE_BASE: 'http://127.0.0.1:4002',
    WORKER_BASE: 'http://127.0.0.1:8989',
    CORS_ALLOWED_ORIGIN: 'http://127.0.0.1:4002',
    ADMIN_SECRET: 'admin-secret',
    ADMIN_SESSION_SECRET: 'admin-session-secret',
    MAGIC_LINK_SECRET: 'magic-link-secret',
    ADMIN_USERS_JSON: JSON.stringify([
      { name: 'Admin', email: 'admin@example.com', role: 'super_admin', accessScopes: [] }
    ]),
    STORE_STATE: new MockKVNamespace(),
    RATELIMIT: new MockKVNamespace()
  };
}

function productRequest(path: string, env: ReturnType<typeof buildEnv>) {
  return worker.fetch(new Request(`http://127.0.0.1:8989${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:4002',
      'CF-Connecting-IP': '203.0.113.10'
    },
    body: JSON.stringify({
      createProduct: true,
      productId: 'preview-rate-limit-test',
      fields: {
        name: 'Preview Rate Limit Test',
        price: 1,
        status: 'draft',
        fulfillmentType: 'physical'
      },
      variants: []
    })
  }), env as any, { waitUntil() {} } as any);
}

describe('Store admin product rate limits', () => {
  it('keeps preview bursts from exhausting product publish attempts', async () => {
    const env = buildEnv();

    for (let index = 0; index < 8; index += 1) {
      const response = await productRequest('/admin/store/products/preview', env);
      expect(response.status).not.toBe(429);
      expect([401, 403]).toContain(response.status);
    }

    const publishResponse = await productRequest('/admin/store/products/publish', env);
    expect(publishResponse.status).not.toBe(429);
    expect([401, 403]).toContain(publishResponse.status);
  });
});

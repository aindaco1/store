import { describe, expect, it, vi } from 'vitest';

import worker, { StoreInventoryCoordinator } from '../../worker/src/index.js';
import { STORE_INVENTORY_RECONCILIATION_ACKNOWLEDGEMENT } from '../../worker/src/store-recovery-reconciliation.js';

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

  async list({ prefix = '' }: { prefix?: string } = {}) {
    return {
      keys: Array.from(this.store.keys()).filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true
    };
  }
}

class MockStorage {
  store = new Map<string, unknown>();

  async get(key: string) {
    return this.store.get(key);
  }

  async put(key: string, value: unknown) {
    this.store.set(key, value);
  }

  async transaction<T>(callback: (storage: MockStorage) => Promise<T>) {
    return callback(this);
  }
}

function buildContext() {
  const tasks: Promise<unknown>[] = [];
  return {
    tasks,
    waitUntil: vi.fn((task: Promise<unknown>) => tasks.push(Promise.resolve(task))),
    exports: { CachedAdminStoreReads: { fetch: vi.fn(async () => new Response('{}')) } }
  } as any;
}

function buildEnvironment() {
  const storeState = new MockKVNamespace();
  const env: any = {
    APP_MODE: 'test',
    SITE_BASE: 'http://127.0.0.1:4002',
    WORKER_BASE: 'http://127.0.0.1:8989',
    CORS_ALLOWED_ORIGIN: 'http://127.0.0.1:4002',
    ADMIN_USERS_JSON: JSON.stringify([
      { email: 'maker@example.com', role: 'super_admin' },
      { email: 'checker@example.com', role: 'super_admin' }
    ]),
    ADMIN_SESSION_SECRET: 'recovery-session-secret',
    MAGIC_LINK_SECRET: 'recovery-magic-secret',
    ADMIN_EXPOSE_LOGIN_LINK: 'true',
    OBSERVABILITY_SAMPLE_RATE: '0',
    WORKERS_CACHE_ENABLED: 'false',
    STORE_STATE: storeState,
    RATELIMIT: new MockKVNamespace()
  };
  const coordinator = new StoreInventoryCoordinator({ storage: new MockStorage() } as never, env);
  env.STORE_INVENTORY_COORDINATOR = {
    idFromName: vi.fn(() => ({ toString: () => 'store' })),
    get: vi.fn(() => ({
      fetch: (input: RequestInfo | URL, init?: RequestInit) => coordinator.fetch(new Request(input, init))
    }))
  };
  return env;
}

async function adminSession(env: any, ctx: any, email: string) {
  const start = await worker.fetch(new Request(`${env.WORKER_BASE}/admin/auth/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: env.SITE_BASE, 'CF-Connecting-IP': '127.0.0.2' },
    body: JSON.stringify({ email })
  }), env, ctx);
  const loginUrl = String((await start.json()).loginUrl || '');
  const token = new URL(loginUrl).searchParams.get('admin_login') || '';
  const exchange = await worker.fetch(new Request(`${env.WORKER_BASE}/admin/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: env.SITE_BASE, 'CF-Connecting-IP': '127.0.0.3' },
    body: JSON.stringify({ token })
  }), env, ctx);
  const body = await exchange.json();
  return {
    cookie: String(exchange.headers.get('set-cookie') || '').split(';')[0],
    csrfToken: String(body.csrfToken || '')
  };
}

let reconcileSequence = 0;

async function reconcileRequest(env: any, ctx: any, session: any, body: Record<string, unknown>) {
  reconcileSequence += 1;
  return worker.fetch(new Request(`${env.WORKER_BASE}/admin/store/recovery/inventory-reconciliation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
      Origin: env.SITE_BASE,
      'x-store-admin-csrf': session.csrfToken,
      'CF-Connecting-IP': `127.0.0.${10 + reconcileSequence}`
    },
    body: JSON.stringify(body)
  }), env, ctx);
}

describe('reviewed Store inventory recovery endpoint', () => {
  it('requires distinct authenticated super-admins and exact execution interlocks', async () => {
    const env = buildEnvironment();
    const ctx = buildContext();
    const maker = await adminSession(env, ctx, 'maker@example.com');
    const checker = await adminSession(env, ctx, 'checker@example.com');

    const planned = await reconcileRequest(env, ctx, maker, { action: 'plan' });
    const plan = await planned.json();
    expect(planned.status, JSON.stringify(plan)).toBe(200);
    expect(plan).toMatchObject({ success: true, approved: false, requiresSecondOperator: true });
    expect(plan.planId).toMatch(/^[a-f0-9]{48}$/);

    const selfApproval = await reconcileRequest(env, ctx, maker, { action: 'approve', planId: plan.planId });
    expect(selfApproval.status).toBe(409);

    const approved = await reconcileRequest(env, ctx, checker, { action: 'approve', planId: plan.planId });
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({ approved: true, approvedBy: 'checker@example.com' });

    const checkerExecution = await reconcileRequest(env, ctx, checker, { action: 'execute', planId: plan.planId });
    expect(checkerExecution.status).toBe(403);

    const missingInterlocks = await reconcileRequest(env, ctx, maker, { action: 'execute', planId: plan.planId });
    expect(missingInterlocks.status).toBe(409);
    await expect(missingInterlocks.json()).resolves.toMatchObject({
      missing: expect.arrayContaining([
        'exact reconciliation acknowledgement',
        'maintenance confirmation',
        'Stripe webhook pause confirmation',
        'inventory reservation review'
      ])
    });

    const executed = await reconcileRequest(env, ctx, maker, {
      action: 'execute',
      planId: plan.planId,
      acknowledgement: STORE_INVENTORY_RECONCILIATION_ACKNOWLEDGEMENT,
      maintenanceConfirmed: true,
      stripeWebhooksPaused: true,
      inventoryReservationsReviewed: true
    });
    expect(executed.status).toBe(200);
    await expect(executed.json()).resolves.toMatchObject({
      success: true,
      executed: true,
      approvedBy: 'checker@example.com'
    });
    expect(Array.from(env.STORE_STATE.store.keys()).some((key: string) => key.startsWith('store-recovery-approval:'))).toBe(false);
    const auditActions = Array.from(env.STORE_STATE.store.entries())
      .filter(([key]: [string, string]) => key.startsWith('admin-audit:'))
      .map(([, value]: [string, string]) => JSON.parse(value).action);
    expect(auditActions).toEqual(expect.arrayContaining([
      'store_recovery_inventory:plan',
      'store_recovery_inventory:approve',
      'store_recovery_inventory:execute'
    ]));
  });

  it('blocks approved execution when read-only Stripe comparison does not match', async () => {
    const env = buildEnvironment();
    env.STRIPE_SECRET_KEY = 'sk_test_recovery';
    await env.STORE_STATE.put('orders:store-order-stripe-recovery', JSON.stringify({
      orderToken: 'store-order-stripe-recovery',
      status: 'confirmed',
      orderDraft: {
        orderToken: 'store-order-stripe-recovery',
        status: 'confirmed',
        items: [{ sku: 't-shirt-2__m', quantity: 1, fulfillmentType: 'physical' }]
      },
      totals: { totalCents: 3000, currency: 'USD' },
      payment: {
        required: true,
        provider: 'stripe',
        status: 'succeeded',
        amountCents: 3000,
        currency: 'USD',
        paymentIntentId: 'pi_recovery_mismatch'
      }
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { type: 'invalid_request_error', code: 'resource_missing' }
    }), { status: 404, headers: { 'Content-Type': 'application/json' } })));
    try {
      const ctx = buildContext();
      const maker = await adminSession(env, ctx, 'maker@example.com');
      const checker = await adminSession(env, ctx, 'checker@example.com');
      const planned = await reconcileRequest(env, ctx, maker, { action: 'plan' });
      const plan = await planned.json();
      expect(planned.status).toBe(200);
      expect(plan).toMatchObject({
        stripe: {
          state: 'complete',
          compared: 1,
          mismatches: 1,
          providerNotFound: 1
        }
      });

      const approved = await reconcileRequest(env, ctx, checker, { action: 'approve', planId: plan.planId });
      expect(approved.status).toBe(200);
      const blocked = await reconcileRequest(env, ctx, maker, {
        action: 'execute',
        planId: plan.planId,
        acknowledgement: STORE_INVENTORY_RECONCILIATION_ACKNOWLEDGEMENT,
        maintenanceConfirmed: true,
        stripeWebhooksPaused: true,
        inventoryReservationsReviewed: true
      });
      expect(blocked.status).toBe(409);
      await expect(blocked.json()).resolves.toMatchObject({
        missing: expect.arrayContaining(['complete matching Stripe recovery comparison'])
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

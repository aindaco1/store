import { describe, expect, it, vi } from 'vitest';
import worker from '../../worker/src/index.js';

class MemoryKV {
  store = new Map<string, string>();
  putOptions = new Map<string, unknown>();
  async get(key: string, options?: { type?: string }) {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return options?.type === 'json' ? JSON.parse(value) : value;
  }
  async put(key: string, value: string, options?: unknown) {
    this.store.set(key, value);
    this.putOptions.set(key, options);
  }
  async delete(key: string) { this.store.delete(key); }
  async list({ prefix = '' } = {}) {
    return { keys: [...this.store.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
  }
}

async function stripeSignature(payload: string, secret: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

function context() {
  const tasks: Promise<unknown>[] = [];
  return { tasks, waitUntil: vi.fn((task: Promise<unknown>) => tasks.push(Promise.resolve(task))) } as any;
}

async function postWebhook(env: any, event: unknown, ctx = context()) {
  const payload = JSON.stringify(event);
  const signingSecret = env.STRIPE_WEBHOOK_SECRET_LIVE || env.STRIPE_WEBHOOK_SECRET_TEST || env.STRIPE_WEBHOOK_SECRET;
  const response = await worker.fetch(new Request('http://127.0.0.1:8989/webhooks/stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': await stripeSignature(payload, signingSecret) },
    body: payload
  }), env, ctx);
  await Promise.all(ctx.tasks);
  return response;
}

function environment(storeState = new MemoryKV()) {
  return {
    APP_MODE: 'test',
    STRIPE_WEBHOOK_SECRET_TEST: 'whsec_store_resume_test',
    OBSERVABILITY_SAMPLE_RATE: '0',
    STORE_STATE: storeState,
    RATELIMIT: new MemoryKV()
  };
}

describe('Stripe webhook crash and replay controls', () => {
  it('verifies signatures before acknowledging a cross-mode event', async () => {
    const env = {
      ...environment(),
      APP_MODE: 'live',
      STRIPE_WEBHOOK_SECRET_TEST: '',
      STRIPE_WEBHOOK_SECRET_LIVE: 'whsec_store_live_test'
    };
    const event = { id: 'evt_test_to_live', type: 'customer.updated', livemode: false, data: { object: { id: 'cus_one' } } };
    const unsigned = await worker.fetch(new Request('http://127.0.0.1:8989/webhooks/stripe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    }), env, context());
    expect(unsigned.status).toBe(401);
    expect((await postWebhook(env, event)).status).toBe(200);
    expect(await env.STORE_STATE.get('stripe-event:evt_test_to_live')).toBeNull();
  });

  it('stores 35-day processed evidence and safely acknowledges replayed events', async () => {
    const storeState = new MemoryKV();
    const env = environment(storeState);
    const event = { id: 'evt_store_ignored', type: 'customer.updated', livemode: false, data: { object: { id: 'cus_one' } } };
    expect((await postWebhook(env, event)).status).toBe(200);
    expect(JSON.parse(storeState.store.get('stripe-event:evt_store_ignored') || '{}')).toMatchObject({ status: 'processed', eventId: 'evt_store_ignored' });
    expect(storeState.putOptions.get('stripe-event:evt_store_ignored')).toEqual({ expirationTtl: 35 * 24 * 60 * 60 });
    expect((await postWebhook(env, event)).status).toBe(200);
  });

  it('rejects a live processing lease, resumes a stale lease, and releases a failed attempt for retry', async () => {
    const storeState = new MemoryKV();
    const env = environment(storeState);
    const ignored = { id: 'evt_store_lease', type: 'customer.updated', livemode: false, data: { object: { id: 'cus_one' } } };
    await storeState.put('stripe-event:evt_store_lease', JSON.stringify({ status: 'processing', leaseId: 'other', startedAt: new Date().toISOString() }));
    expect((await postWebhook(env, ignored)).status).toBe(409);
    await storeState.put('stripe-event:evt_store_lease', JSON.stringify({ status: 'processing', leaseId: 'stale', startedAt: '2026-01-01T00:00:00.000Z' }));
    expect((await postWebhook(env, ignored)).status).toBe(200);

    const failed = {
      id: 'evt_store_missing_order',
      type: 'payment_intent.succeeded',
      livemode: false,
      data: { object: {
        id: 'pi_missing', amount: 1200, currency: 'usd', status: 'succeeded',
        metadata: { checkoutProvider: 'first_party', orderToken: 'store-order-missing', storeOrderVersion: '1' }
      } }
    };
    expect((await postWebhook(env, failed)).status).toBe(404);
    expect(await storeState.get('stripe-event:evt_store_missing_order')).toBeNull();
  });
});

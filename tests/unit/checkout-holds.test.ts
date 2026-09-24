import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreInventoryCoordinator } from '../../worker/src/tier-inventory-do.js';

// Serial transactions with rollback/cloning: concurrent calls cannot share a
// mutable object, as they could in a simplistic Map mock.
class Storage {
  data = new Map<string, any>(); alarmAt: number | null = null; queue = Promise.resolve();
  async get(key: string) { return structuredClone(this.data.get(key)); }
  async put(key: string, value: any) { this.data.set(key, structuredClone(value)); }
  async delete(keys: string | string[]) { for (const key of [keys].flat()) this.data.delete(key); }
  async getAlarm() { return this.alarmAt; }
  async setAlarm(at: number) { this.alarmAt = at; }
  async list({ prefix, limit }: any) { return new Map([...this.data].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)); }
  async transaction<T>(callback: (storage: Storage) => Promise<T>) {
    const run = this.queue.then(async () => {
      const snapshot = structuredClone(this.data);
      try { return await callback(this); } catch (error) { this.data = snapshot; throw error; }
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}
const first = 'a'.repeat(64), second = 'b'.repeat(64);
const inventory = { ticket: { limit: 1, claimed: 0 }, mug: { limit: 2, claimed: 0 } };
let storage: Storage, coordinator: StoreInventoryCoordinator, orders: Map<string, string>;
let providerAmount: number;
let status: string, createCount: number, createKeys: string[], cancelFails: boolean;
const call = async (action: string, body: any = {}) => (await coordinator.fetch(new Request(`https://inventory/${action}`, {
  method: 'POST', body: JSON.stringify({ scope: 'store', attemptId: first, ...body })
}))).json() as Promise<any>;
const hold = (attemptId = first, counts = { ticket: 1 }) => call('checkout-hold', { attemptId, counts, inventory, selection: 'cart-1' });
const pay = (attemptId = first) => call('checkout-pay', { attemptId, counts: { ticket: 1 }, inventory, selection: 'cart-1',
  publishableKey: 'pk_test_fixture', params: { amount: 1000, currency: 'usd' },
  order: { orderToken: `store-order-${attemptId}`, orderHash: 'hash-1', status: 'draft', orderDraft: { totals: { totalCents: 1000 } }, payment: { required: true } }
});
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
  storage = new Storage(); orders = new Map(); status = 'requires_payment_method'; providerAmount = 1000; createCount = 0; createKeys = []; cancelFails = false;
  coordinator = new StoreInventoryCoordinator({ storage } as never, {
    APP_MODE: 'test', STRIPE_SECRET_KEY_TEST: 'sk_test_fixture', STORE_STATE: {
      put: async (key: string, value: string) => { orders.set(key, value); },
      delete: async (key: string) => { orders.delete(key); },
      list: async () => ({ keys: [], list_complete: true }),
      get: async (key: string, options?: any) => { const value = orders.get(key); return options?.type === 'json' ? (value ? JSON.parse(value) : null) : value; }
    }
  } as never);
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: any) => {
    if (url.endsWith('/cancel')) {
      if (cancelFails) return Response.json({ error: { message: 'race' } }, { status: 409 });
      status = 'canceled';
    } else if (options?.method === 'POST') {
      providerAmount = Number(new URLSearchParams(options.body).get('amount')) || providerAmount;
      createCount++; createKeys.push(options.headers['Idempotency-Key']);
    }
    return Response.json({ id: 'pi_fixture', client_secret: 'pi_fixture_secret_test', status, amount: providerAmount, currency: 'usd' });
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('checkout inventory lifecycle', () => {
  it('does not return a canceled intent on replay and releases it through the existing checkpoint', async () => {
    await hold(); await pay(); status = 'canceled';
    expect(await pay()).toMatchObject({ code: 'hold_expired' });
    expect(await call('checkout-status')).toMatchObject({ phase: 'released' });
    expect(createCount).toBe(1);
    expect(await hold(second)).toMatchObject({ success: true });
  });
  it.each(['succeeded', 'processing', 'requires_capture'])('blocks remounting a %s intent without creating another charge', async (paymentStatus) => {
    await hold(); await pay(); status = paymentStatus;
    expect(await pay()).toMatchObject({ code: 'payment_resolving' });
    expect(await call('checkout-status')).toMatchObject({ code: 'payment_resolving' });
    expect(await hold(second)).toMatchObject({ code: 'temporarily_held' });
    expect(createCount).toBe(1);
  });
  it('rejects a terminal intent returned by a replayed Stripe create', async () => {
    await hold(); status = 'canceled';
    expect(await pay()).toMatchObject({ code: 'hold_expired' });
    expect(await call('checkout-status')).toMatchObject({ phase: 'released' });
  });
  it('finishes an uncertain cancellation on status check before offering another payment', async () => {
    await hold(); await pay(); cancelFails = true;
    expect(await call('checkout-release')).toMatchObject({ code: 'payment_resolving' });
    expect(await call('checkout-status')).toMatchObject({ code: 'payment_resolving' });
    cancelFails = false;
    expect(await call('checkout-status')).toMatchObject({ phase: 'released' });
    expect(createCount).toBe(1);
  });
  it('keeps the same payment and stock when Stripe status cannot be read', async () => {
    await hold(); await pay();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    expect(await pay()).toMatchObject({ code: 'payment_resolving' });
    expect(await call('checkout-status')).toMatchObject({ code: 'payment_resolving' });
    expect(await hold(second)).toMatchObject({ code: 'temporarily_held' });
    expect(createCount).toBe(1);
  });
  it('serializes simultaneous buyers and reuses the winning attempt without resetting time', async () => {
    const results = await Promise.all([hold(), hold(second)]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results[1]).toMatchObject({ code: 'temporarily_held', remaining: 0 });
    const deadline = results[0].expiresAt;
    vi.setSystemTime(Date.now() + 120000);
    expect(await hold()).toMatchObject({ success: true, expiresAt: deadline, heldQuantity: 1 });
    expect(orders.has('store-inventory:v1:store')).toBe(false);
  });
  it('does not let direct or multi-item claims steal reserved units', async () => {
    await hold();
    expect(await call('claim', { sku: 'ticket', qty: 1, inventory })).toMatchObject({ success: false });
    expect(await call('claim-selection', { nextCounts: { ticket: 1 }, inventory })).toMatchObject({ success: false });
  });
  it('checks a selection atomically and reports genuine sellout separately', async () => {
    expect(await hold(first, { ticket: 2, mug: 1 } as any)).toMatchObject({ code: 'sold_out' });
    expect((await call('snapshot')).reservedCounts).toEqual({});
  });
  it('allows ten explicit extensions near expiry; duplicates do not consume time allowances', async () => {
    await hold();
    for (let index = 0; index < 10; index++) {
      vi.setSystemTime(Date.now() + 480000);
      const extended = await call('checkout-extend');
      expect(extended).toMatchObject({ success: true, extensionsRemaining: 9 - index });
      expect(await call('checkout-extend')).toMatchObject(index === 9 ? { code: 'extension_limit' } : { expiresAt: extended.expiresAt });
      vi.setSystemTime(Date.parse(extended.expiresAt) - 600000);
    }
  });
  it('releases an abandoned pre-payment hold when its alarm runs', async () => {
    await hold(); vi.setSystemTime(Date.now() + 601000);
    await coordinator.alarm();
    expect(await call('checkout-status')).toMatchObject({ phase: 'expired' });
    expect(await hold(second)).toMatchObject({ success: true });
  });
  it('reuses one frozen PaymentIntent for duplicate requests and rejects changed totals', async () => {
    await hold();
    expect(await pay()).toMatchObject({ success: true, paymentIntentId: 'pi_fixture' });
    expect(await pay()).toMatchObject({ success: true, paymentIntentId: 'pi_fixture' });
    expect(createCount).toBe(1);
    expect(await call('checkout-pay', { order: { orderHash: 'changed' } })).toMatchObject({ code: 'checkout_locked' });
  });
  it('recovers an ambiguous creation with the same request/key and keeps stock', async () => {
    await hold();
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('response lost')).mockImplementation(original));
    expect(await pay()).toMatchObject({ code: 'payment_resolving' });
    expect(await hold(second)).toMatchObject({ success: false });
    vi.setSystemTime(Date.now() + 31000);
    expect(await pay()).toMatchObject({ success: true });
    const calls = (globalThis.fetch as any).mock.calls;
    expect(calls[0][1].headers['Idempotency-Key']).toBe(calls[1][1].headers['Idempotency-Key']);
    expect(calls[0][1].body).toBe(calls[1][1].body);
  });
  it('coalesces a slow in-flight creation even after its durable lease expires', async () => {
    await hold();
    const original = globalThis.fetch;
    let complete!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { complete = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (...args: Parameters<typeof fetch>) => {
      started(); await waiting; return original(...args);
    }));
    const firstRequest = pay();
    await entered;
    vi.setSystemTime(Date.now() + 31000);
    const retry = pay();
    await vi.advanceTimersByTimeAsync(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    complete();
    const results = await Promise.all([firstRequest, retry]);
    expect(results.every((result) => result.paymentIntentId === 'pi_fixture')).toBe(true);
    expect(createCount).toBe(1);
  });
  it('cancels a payable intent before releasing expired inventory', async () => {
    await hold(); await pay(); vi.setSystemTime(Date.now() + 601000);
    await coordinator.alarm();
    expect(status).toBe('canceled');
    expect(await call('checkout-status')).toMatchObject({ phase: 'expired' });
    expect(await hold(second)).toMatchObject({ success: true });
  });
  it.each(['processing', 'succeeded'])('pins stock while Stripe reports %s, then commits success exactly once', async (providerStatus) => {
    await hold(); await pay(); status = providerStatus; vi.setSystemTime(Date.now() + 601000);
    expect(await call('checkout-release')).toMatchObject({ code: 'payment_resolving' });
    expect(await hold(second)).toMatchObject({ success: false });
    status = 'succeeded';
    await call('checkout-confirm'); await call('checkout-confirm');
    expect((await call('snapshot')).inventory.ticket.claimed).toBe(1);
  });
  it('keeps stock and schedules recovery after a cancel/success race or provider failure', async () => {
    await hold(); await pay(); cancelFails = true;
    expect(await call('checkout-release')).toMatchObject({ code: 'payment_resolving' });
    expect(await hold(second)).toMatchObject({ success: false });
    expect(storage.alarmAt).toBeGreaterThan(Date.now());
  });
  it('retries a failed canceled-order checkpoint before returning its capacity', async () => {
    await hold(); await pay();
    const orderPut = coordinator.env.STORE_STATE.put;
    let failCheckpoint = true;
    coordinator.env.STORE_STATE.put = vi.fn(async (key: string, value: string) => {
      if (key.startsWith('orders:') && failCheckpoint) {
        failCheckpoint = false;
        throw new Error('KV unavailable');
      }
      return orderPut(key, value);
    });
    expect(await call('checkout-release')).toMatchObject({ code: 'payment_resolving' });
    expect(status).toBe('canceled');
    expect(await hold(second)).toMatchObject({ success: false });
    expect(await call('checkout-release')).toMatchObject({ phase: 'released' });
    expect(JSON.parse(orders.get(`orders:store-order-${first}`)!)).toMatchObject({ status: 'payment_failed', payment: { status: 'canceled' } });
    expect(await hold(second)).toMatchObject({ success: true });
  });
  it('allows payment-stage extensions without exposing payable stock to lazy expiry', async () => {
    await hold(); await pay(); vi.setSystemTime(Date.now() + 481000);
    expect(await call('checkout-extend')).toMatchObject({ success: true, extensionsRemaining: 9 });
    vi.setSystemTime(Date.now() + 200000);
    expect(await hold(second)).toMatchObject({ success: false });
  });
  it('does not show artificial ticket holds for non-ticket checkout and can confirm empty inventory', async () => {
    await hold(first, {} as any);
    const response = await call('checkout-pay', { inventory, counts: {}, selection: 'cart-1', publishableKey: 'pk_test_fixture', params: { amount: 1000 }, order: { orderHash: 'hash-1', orderDraft: { totals: {} } } });
    expect(response).toMatchObject({ heldQuantity: 0, success: true });
    expect(await call('checkout-confirm')).toMatchObject({ confirmed: true });
  });
  it('commits a free ticket only once across retry and preserves a recovery checkpoint', async () => {
    await hold();
    const body = { selection: 'cart-1', counts: { ticket: 1 }, inventory, order: { orderToken: `store-order-${first}`, status: 'confirmed' } };
    expect(await call('checkout-free', body)).toMatchObject({ success: true });
    expect(await call('checkout-free', body)).toMatchObject({ success: true });
    expect((await call('snapshot')).inventory.ticket.claimed).toBe(1);
    expect(JSON.parse(orders.get(`orders:store-order-${first}`)!)).toMatchObject({ status: 'confirmed' });
  });
  it('does not overwrite fulfillment on free-order replay or after its checkpoint expires', async () => {
    await hold();
    const body = { selection: 'cart-1', counts: { ticket: 1 }, inventory, order: { orderToken: `store-order-${first}`, status: 'confirmed' } };
    await call('checkout-free', body);
    orders.set(`orders:store-order-${first}`, JSON.stringify({ ...body.order, checkedIn: true }));
    expect(await call('checkout-free', body)).toMatchObject({ order: { checkedIn: true } });
    vi.setSystemTime(Date.now() + 31 * 86400000);
    await coordinator.alarm();
    expect(JSON.parse(orders.get(`orders:store-order-${first}`)!)).toMatchObject({ checkedIn: true });
    expect(await hold()).toMatchObject({ phase: 'confirmed' });
    expect(createCount).toBe(0);
  });
  it('stops ambiguous creation retries before the provider idempotency window ends', async () => {
    await hold();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('lost response')));
    await pay();
    vi.setSystemTime(Date.now() + 23 * 3600000);
    await coordinator.alarm();
    expect((globalThis.fetch as any).mock.calls).toHaveLength(1);
    const record = await storage.get(`checkout:${first}`);
    expect(record.phase).toBe('unresolved');
    expect(record.order).toBeUndefined();
    expect(await hold(second)).toMatchObject({ success: false });
  });
  it('blocks inventory rebuild while a checkout owns stock', async () => {
    await hold(); await pay();
    expect(await call('replace', { inventory })).toMatchObject({ success: false });
    expect(await hold(second)).toMatchObject({ success: false });
  });
});

describe('public checkout gateway', () => {
  it('checks origin and capability, returns canonical event details, and reuses a paid attempt', async () => {
    const { default: worker } = await import('../../worker/src/index.js');
    const env: any = { ...(coordinator as any).env,
      SITE_BASE: 'http://127.0.0.1:4002', CORS_ALLOWED_ORIGIN: 'http://127.0.0.1:4002',
      STRIPE_WEBHOOK_SECRET_TEST: 'whsec_fixture',
      STRIPE_PUBLISHABLE_KEY_TEST: 'pk_test_fixture', TAX_PROVIDER: 'flat', SALES_TAX_RATE: '0',
      OBSERVABILITY_SAMPLE_RATE: '0', STORE_EMAIL_DRY_RUN: 'true', ADMIN_SESSION_SECRET: 'fixture_admin_secret',
      RATELIMIT: { get: async () => null, put: async () => {} },
      STORE_INVENTORY_COORDINATOR: { idFromName: () => 'store', get: () => ({ fetch: (url: string, options: any) => coordinator.fetch(new Request(url, options)) }) }
    };
    const request = (action: string, body: any, origin = 'http://127.0.0.1:4002') => worker.fetch(new Request(`http://127.0.0.1:8989/api/checkout/${action}`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }), env, { waitUntil: vi.fn() } as any);
    const cart = { attemptId: first, items: [{ id: 'a-night-in-paradiso', price: 20, quantity: 1 }], customer: { email: 'fixture@example.com' }, tipPercent: 5 };
    for (const action of ['hold', 'status', 'extend', 'release']) {
      for (const origin of ['https://untrusted.example', 'null']) {
        const rejected = await request(action, cart, origin);
        expect(rejected.status).toBe(403);
        expect(rejected.headers.get('cache-control')).toContain('no-store');
      }
      expect((await request(action, { ...cart, attemptId: 'guessable' })).status).toBe(400);
    }
    expect((await request('status', { attemptId: second })).status).toBe(404);
    expect((await request('hold', { ...cart, items: [{ id: 'a-night-in-paradiso', price: 0.01, quantity: 1 }] })).status).toBe(422);
    expect(createCount).toBe(0);
    const held = await request('hold', cart);
    expect(held.headers.get('cache-control')).toContain('no-store');
    expect(await held.json()).toMatchObject({ success: true, heldQuantity: 1, items: [{ productId: 'a-night-in-paradiso', eventDetails: { venue: expect.any(String) } }] });
    const paid = await request('intent', cart);
    expect(await paid.json()).toMatchObject({ success: true, orderToken: `store-order-${first}`, totals: { tipPercent: 5, tipAmountCents: 100 }, paymentIntentId: 'pi_fixture' });
    expect((await request('intent', cart)).status).toBe(200);
    expect(createCount).toBe(1);
    const stored = JSON.parse(orders.get(`orders:store-order-${first}`)!);
    const intent = { id: 'pi_fixture', amount: stored.payment.amountCents, currency: 'usd', status: 'requires_payment_method',
      metadata: { checkoutProvider: 'first_party', orderToken: stored.orderToken, orderHash: stored.orderHash } };
    const webhook = async (type: string, id: string) => {
      const payload = JSON.stringify({ id, type, livemode: false, data: { object: intent } });
      const timestamp = Math.floor(Date.now() / 1000);
      const secret = await crypto.subtle.importKey('raw', new TextEncoder().encode('whsec_fixture'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', secret, new TextEncoder().encode(`${timestamp}.${payload}`))), (b) => b.toString(16).padStart(2, '0')).join('');
      const tasks: Promise<any>[] = [];
      const response = await worker.fetch(new Request('http://127.0.0.1:8989/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': `t=${timestamp},v1=${signature}`, 'Content-Type': 'application/json' }, body: payload }), env, { waitUntil: (task: Promise<any>) => tasks.push(task) } as any);
      await Promise.allSettled(tasks);
      return response;
    };
    expect((await webhook('payment_intent.payment_failed', 'evt_decline')).status).toBe(200);
    expect((await call('checkout-status')).phase).toBe('payment');
    status = intent.status = 'succeeded';
    expect((await webhook('payment_intent.succeeded', 'evt_success')).status).toBe(200);
    expect((await webhook('payment_intent.succeeded', 'evt_success_replay')).status).toBe(200);
    expect(JSON.parse(orders.get(`orders:store-order-${first}`)!).status).toBe('confirmed');
    expect((await call('snapshot')).inventory['a-night-in-paradiso'].claimed).toBe(1);
  });
});

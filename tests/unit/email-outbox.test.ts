import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMAIL_DELIVERY_PREFIX,
  EMAIL_OUTBOX_PREFIX,
  EMAIL_SUPPRESSION_PREFIX,
  enqueueEmailOutbox,
  processEmailOutbox,
  processResendWebhook,
  verifyResendWebhook
} from '../../worker/src/email-outbox.js';

class MemoryKV {
  store = new Map<string, string>();
  async get(key: string, options?: { type?: string }) {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return options?.type === 'json' ? JSON.parse(value) : value;
  }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list({ prefix = '', limit = 1000 } = {}) {
    const keys = [...this.store.keys()].filter((key) => key.startsWith(prefix)).sort().slice(0, limit);
    return { keys: keys.map((name) => ({ name })), list_complete: true };
  }
}

function baseEnv(kv: MemoryKV) {
  return {
    STORE_STATE: kv,
    RESEND_API_KEY: 're_test',
    SITE_BASE: 'https://shop.test',
    WORKER_BASE: 'https://checkout.test',
    PLATFORM_NAME: 'Shop',
    PLATFORM_COMPANY_NAME: 'Dust Wave',
    SUPPORT_EMAIL: 'info@shop.test',
    ORDERS_EMAIL_FROM: 'Shop <orders@shop.test>',
    UPDATES_EMAIL_FROM: 'Shop <updates@shop.test>',
    I18N_CATALOG_JSON: JSON.stringify({ en: { email: {} } })
  };
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function orderPayload() {
  return {
    email: 'buyer@example.com',
    orderToken: 'store-order-one',
    preferredLang: 'en',
    orderDraft: {
      customer: { email: 'buyer@example.com' },
      totals: { totalCents: 1200, currency: 'USD' },
      items: []
    },
    payment: { status: 'succeeded', amountCents: 1200, currency: 'USD' },
    attachments: []
  };
}

describe('Store durable Resend email outbox', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('deduplicates jobs, freezes the rendered payload, and uses a stable provider key', async () => {
    const kv = new MemoryKV();
    await kv.put('orders:store-order-one', JSON.stringify({ orderToken: 'store-order-one', emailSent: false }));
    const env = baseEnv(kv);
    const request = { kind: 'store_order', dedupeKey: 'store-order-one', orderToken: 'store-order-one', payload: orderPayload() };
    const first = await enqueueEmailOutbox(env, request);
    const duplicate = await enqueueEmailOutbox(env, request);
    expect(first).toMatchObject({ queued: true, deduped: false });
    expect(duplicate).toMatchObject({ queued: true, deduped: true, jobId: first.jobId });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'email_one' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await processEmailOutbox(env, { now: new Date('2027-07-13T12:00:00Z') });
    expect(result.sent).toBe(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(`store/${first.jobId}`);
    expect(JSON.parse(String(init?.body)).tags).toEqual(expect.arrayContaining([
      { name: 'store_job', value: first.jobId },
      { name: 'category', value: 'store_order' }
    ]));
    expect(await kv.get(`${EMAIL_OUTBOX_PREFIX}${first.jobId}`)).toBeNull();
    expect(await kv.get(`${EMAIL_DELIVERY_PREFIX}${first.jobId}`, { type: 'json' })).toMatchObject({ status: 'accepted', providerId: 'email_one' });
    expect(await kv.get('orders:store-order-one', { type: 'json' })).toMatchObject({ emailSent: true, emailOutboxJobId: first.jobId });
  });

  it('retries a rate-limited frozen payload after Retry-After', async () => {
    const kv = new MemoryKV();
    const env = baseEnv(kv);
    const queued = await enqueueEmailOutbox(env, { kind: 'store_order', dedupeKey: 'retry', orderToken: 'store-order-one', payload: orderPayload() });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Slow down' }), { status: 429, headers: { 'Retry-After': '120' } })));
    const result = await processEmailOutbox(env, { now: new Date('2027-07-13T12:00:00Z') });
    expect(result.retried).toBe(1);
    expect(await kv.get(`${EMAIL_OUTBOX_PREFIX}${queued.jobId}`, { type: 'json' })).toMatchObject({
      status: 'retry', attempts: 1, nextAttemptAt: '2027-07-13T12:02:00.000Z', contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
  });

  it.each([
    ['store_abandoned_cart', { email: 'buyer@example.com', resumeUrl: 'https://shop.test/cart', unsubscribeUrl: 'https://shop.test/unsubscribe' }],
    ['store_event_reminder', { email: 'buyer@example.com', orderToken: 'store-order-one', item: { name: 'Event' } }]
  ])('checks suppression immediately before a %s delivery', async (kind, payload) => {
    const kv = new MemoryKV();
    const email = 'buyer@example.com';
    await kv.put(`${EMAIL_SUPPRESSION_PREFIX}${await sha256Hex(email)}`, '{}');
    const env = baseEnv(kv);
    const queued = await enqueueEmailOutbox(env, {
      kind, dedupeKey: `suppressed-${kind}`, orderToken: 'store-order-one', payload
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await processEmailOutbox(env, { now: new Date('2027-07-13T12:00:00Z') });
    expect(result.suppressed).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await kv.get(`${EMAIL_DELIVERY_PREFIX}${queued.jobId}`, { type: 'json' })).toMatchObject({ status: 'suppressed' });
  });

  it('verifies Resend signatures and stores delivery and permanent-bounce evidence', async () => {
    const secretBytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = `whsec_${btoa(String.fromCharCode(...secretBytes))}`;
    const id = 'msg_store';
    const now = new Date('2026-07-13T12:00:00Z');
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const jobId = 'a'.repeat(64);
    const rawBody = JSON.stringify({ type: 'email.bounced' });
    const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
    const signature = btoa(String.fromCharCode(...new Uint8Array(digest)));
    await expect(verifyResendWebhook(rawBody, { id, timestamp, signature: `v1,${signature}` }, secret, now)).resolves.toMatchObject({ valid: true, id });
    const kv = new MemoryKV();
    const result = await processResendWebhook({ STORE_STATE: kv }, {
      type: 'email.bounced', created_at: now.toISOString(), data: {
        email_id: 'email_bounced', to: ['bad@example.com'], bounce: { type: 'permanent' },
        tags: [{ name: 'store_job', value: jobId }]
      }
    }, id);
    expect(result).toMatchObject({ processed: true, suppressed: true, jobId });
    expect(await kv.get(`${EMAIL_DELIVERY_PREFIX}${jobId}`, { type: 'json' })).toMatchObject({ status: 'bounced' });
  });
});

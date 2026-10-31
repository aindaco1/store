import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMAIL_DELIVERY_PREFIX,
  EMAIL_OUTBOX_PREFIX,
  EMAIL_SUPPRESSION_PREFIX,
  PROMOTIONAL_EMAIL_SUPPRESSION_PREFIX,
  enqueueEmailOutbox,
  processEmailOutbox,
  processResendWebhook,
  suppressPromotionalEmail,
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

function retryWindowReceipt() {
  return { kind: 'store_order', dedupeKey: 'window', orderToken: 'store-order-one', payload: orderPayload() };
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

  it.each([
    { label: 'one millisecond inside', elapsed: 23 * 3_600_000 - 1, allowed: true },
    { label: 'at the cutoff', elapsed: 23 * 3_600_000, allowed: false },
    { label: 'after a 25-hour outage', elapsed: 25 * 3_600_000, allowed: false }
  ])('protects an unacknowledged provider send $label', async ({ elapsed, allowed }) => {
    const kv = new MemoryKV();
    const env = baseEnv(kv);
    const request = retryWindowReceipt();
    const { jobId } = await enqueueEmailOutbox(env, request);
    const start = new Date();
    const send = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ id: 'accepted_once' }))
      .mockRejectedValueOnce(new TypeError('Connection lost after provider acceptance'));
    vi.stubGlobal('fetch', send);
    expect(await processEmailOutbox(env, { now: start })).toMatchObject({ retried: 1, sent: 0 });
    const key = EMAIL_OUTBOX_PREFIX + jobId;
    const receiptKey = EMAIL_DELIVERY_PREFIX + jobId;
    expect(await kv.get(key, { type: 'json' })).toMatchObject({ status: 'retry', attempts: 1 });
    const result = await processEmailOutbox(env, { now: new Date(start.getTime() + elapsed) });
    const headers = send.mock.calls.map(([, init]) => new Headers(init.headers).get('Idempotency-Key'));
    const expectedKey = `store/${jobId}`;
    if (allowed) {
      expect(headers).toEqual([expectedKey, expectedKey]);
      expect(send.mock.calls[1][1].body).toBe(send.mock.calls[0][1].body);
      expect(result).toMatchObject({ sent: 1, failed: 0 });
      expect(await kv.get(receiptKey, { type: 'json' })).toMatchObject({ status: 'accepted', providerId: 'accepted_once' });
    } else {
      expect(headers).toEqual([expectedKey]);
      expect(result).toMatchObject({ sent: 0, failed: 1 });
      expect(await kv.get(receiptKey, { type: 'json' })).toMatchObject({ status: 'ambiguous', attempts: 1 });
      expect(await enqueueEmailOutbox(env, request)).toMatchObject({ sent: false, queued: false, jobId });
      await processEmailOutbox(env, { now: new Date(start.getTime() + elapsed + 60_000) });
      expect(send).toHaveBeenCalledTimes(1);
    }
    expect(await kv.get(key)).toBeNull();
  });

  it('rechecks the live clock after checkpointing an old processing lease', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const kv = new MemoryKV();
      const env = baseEnv(kv);
      const { jobId } = await enqueueEmailOutbox(env, retryWindowReceipt());
      const send = vi.fn().mockRejectedValue(new TypeError('Provider response lost'));
      vi.stubGlobal('fetch', send);
      expect(await processEmailOutbox(env)).toMatchObject({ retried: 1 });
      const key = EMAIL_OUTBOX_PREFIX + jobId;
      const job = await kv.get(key, { type: 'json' });
      // Simulate a pre-upgrade worker that stopped after persisting its send intent.
      delete job.firstProviderAttemptAt;
      delete job.lastError;
      await kv.put(key, JSON.stringify({ ...job, status: 'processing' }));
      const cutoff = Date.parse(job.firstAttemptAt) + 23 * 3_600_000;
      vi.setSystemTime(cutoff - 1);
      const put = kv.put.bind(kv);
      vi.spyOn(kv, 'put').mockImplementation(async (keyToWrite, value) => {
        await put(keyToWrite, value);
        if (keyToWrite === key && JSON.parse(value).status === 'processing') vi.setSystemTime(cutoff);
      });
      expect(await processEmailOutbox(env)).toMatchObject({ sent: 0, failed: 1 });
      expect(send).toHaveBeenCalledTimes(1);
      expect(await kv.get(EMAIL_DELIVERY_PREFIX + jobId, { type: 'json' })).toMatchObject({
        status: 'ambiguous', firstProviderAttemptAt: job.firstAttemptAt, attempts: 1
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors provider delivery evidence when recovering an overdue job', async () => {
    const kv = new MemoryKV();
    const env = baseEnv(kv);
    const { jobId } = await enqueueEmailOutbox(env, retryWindowReceipt());
    const start = new Date();
    const send = vi.fn().mockRejectedValue(new TypeError('Response lost'));
    vi.stubGlobal('fetch', send);
    expect(await processEmailOutbox(env, { now: start })).toMatchObject({ retried: 1 });
    const evidence = { status: 'delivered', providerId: 'receipt_from_webhook' };
    const key = EMAIL_DELIVERY_PREFIX + jobId;
    await kv.put(key, JSON.stringify(evidence));
    await processEmailOutbox(env, { now: new Date(start.getTime() + 25 * 3_600_000) });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await kv.get(key, { type: 'json' })).toEqual(evidence);
    expect(await kv.get(EMAIL_OUTBOX_PREFIX + jobId)).toBeNull();
    expect(await enqueueEmailOutbox(env, retryWindowReceipt())).toMatchObject({ deduped: true, queued: false, providerId: evidence.providerId });
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

  it('replaces stale failed evidence when an explicitly requeued job is accepted', async () => {
    const kv = new MemoryKV();
    const env = baseEnv(kv);
    const queued = await enqueueEmailOutbox(env, {
      kind: 'store_order',
      dedupeKey: 'operator-retry',
      orderToken: 'store-order-one',
      payload: orderPayload()
    });
    await kv.put(`${EMAIL_DELIVERY_PREFIX}${queued.jobId}`, JSON.stringify({
      version: 1,
      status: 'failed',
      kind: 'store_order',
      updatedAt: '2027-07-13T11:00:00.000Z'
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'email_operator_retry' }), { status: 200 })));

    const result = await processEmailOutbox(env, { now: new Date('2027-07-13T12:00:00Z') });

    expect(result.sent).toBe(1);
    expect(await kv.get(`${EMAIL_DELIVERY_PREFIX}${queued.jobId}`, { type: 'json' })).toMatchObject({
      status: 'accepted',
      providerId: 'email_operator_retry'
    });
  });

  it('keeps pre-provider rendering failures retryable without risking a duplicate send', async () => {
    const kv = new MemoryKV();
    const env = baseEnv(kv);
    const queued = await enqueueEmailOutbox(env, {
      kind: 'store_order',
      dedupeKey: 'render-retry',
      orderToken: 'store-order-one',
      payload: orderPayload()
    });
    const key = `${EMAIL_OUTBOX_PREFIX}${queued.jobId}`;
    const pending = await kv.get(key, { type: 'json' });
    await kv.put(key, JSON.stringify({ ...pending, kind: 'temporarily_unavailable' }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const first = await processEmailOutbox(env, { now: new Date('2027-07-13T12:00:00Z') });

    expect(first).toMatchObject({ sent: 0, retried: 1, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await kv.get(key, { type: 'json' })).toMatchObject({
      status: 'retry',
      attempts: 1,
      lastError: {
        type: 'Error',
        statusCode: 0,
        stage: 'render'
      }
    });
    expect(await kv.get(`${EMAIL_DELIVERY_PREFIX}${queued.jobId}`)).toBeNull();

    const retry = await kv.get(key, { type: 'json' });
    await kv.put(key, JSON.stringify({
      ...retry,
      kind: 'store_order',
      nextAttemptAt: '2027-07-13T12:02:00.000Z'
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'email_after_retry' }), { status: 200 })));

    // A rendering failure made no provider call and must not consume the send window.
    const second = await processEmailOutbox(env, { now: new Date('2027-07-14T13:00:00Z') });

    expect(second).toMatchObject({ sent: 1, retried: 0, failed: 0 });
    expect(await kv.get(key)).toBeNull();
    expect(await kv.get(`${EMAIL_DELIVERY_PREFIX}${queued.jobId}`, { type: 'json' })).toMatchObject({
      status: 'accepted',
      providerId: 'email_after_retry'
    });
  });

  it('retries an untyped provider-stage failure within the idempotency window', async () => {
    const kv = new MemoryKV();
    const env = baseEnv(kv);
    const queued = await enqueueEmailOutbox(env, {
      kind: 'store_order',
      dedupeKey: 'provider-stage-retry',
      orderToken: 'store-order-one',
      payload: orderPayload()
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      get ok() { throw new Error('Provider transport result unavailable'); }
    })));

    const result = await processEmailOutbox(env, { now: new Date('2027-07-13T12:00:00Z') });

    expect(result).toMatchObject({ sent: 0, retried: 1, failed: 0 });
    expect(await kv.get(`${EMAIL_OUTBOX_PREFIX}${queued.jobId}`, { type: 'json' })).toMatchObject({
      status: 'retry',
      attempts: 1,
      lastError: {
        type: 'Error',
        statusCode: 0,
        stage: 'provider'
      }
    });
    expect(await kv.get(`${EMAIL_DELIVERY_PREFIX}${queued.jobId}`)).toBeNull();
  });

  it.each([
    ['store_abandoned_cart', { email: 'buyer@example.com', resumeUrl: 'https://shop.test/cart', unsubscribeUrl: 'https://shop.test/unsubscribe' }],
    ['store_event_reminder', { email: 'buyer@example.com', orderToken: 'store-order-one', item: { name: 'Event' } }],
    ['store_event_followup', { email: 'buyer@example.com', eventTitle: 'Event' }]
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

  it('applies recipient opt-out only to optional promotional Store email', async () => {
    const kv = new MemoryKV();
    const env = baseEnv(kv);
    await suppressPromotionalEmail(env, 'buyer@example.com');
    const emailHash = await sha256Hex('buyer@example.com');
    expect(await kv.get(`${PROMOTIONAL_EMAIL_SUPPRESSION_PREFIX}${emailHash}`, { type: 'json' })).toMatchObject({
      reason: 'recipient_opt_out'
    });
    const followup = await enqueueEmailOutbox(env, {
      kind: 'store_event_followup',
      dedupeKey: 'optional-followup',
      payload: { email: 'buyer@example.com', eventTitle: 'Event' }
    });
    const receipt = await enqueueEmailOutbox(env, {
      kind: 'store_order',
      dedupeKey: 'essential-receipt',
      orderToken: 'store-order-one',
      payload: orderPayload()
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'email_receipt' }), { status: 200 })));

    const result = await processEmailOutbox(env, { now: new Date('2027-07-13T12:00:00Z'), limit: 10 });

    expect(result).toMatchObject({ suppressed: 1, sent: 1 });
    expect(await kv.get(`${EMAIL_DELIVERY_PREFIX}${followup.jobId}`, { type: 'json' })).toMatchObject({ status: 'suppressed' });
    expect(await kv.get(`${EMAIL_DELIVERY_PREFIX}${receipt.jobId}`, { type: 'json' })).toMatchObject({ status: 'accepted' });
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
    await expect(verifyResendWebhook(rawBody, {
      id,
      timestamp,
      signature: `v1,invalid v1,${signature}`
    }, secret, now)).resolves.toMatchObject({ valid: true, id });
    await expect(verifyResendWebhook(rawBody, {
      id,
      timestamp,
      signature: `v1,${signature}`
    }, secret, new Date(now.getTime() + 301_000))).resolves.toMatchObject({
      valid: false,
      error: 'timestamp_outside_tolerance'
    });
    await expect(verifyResendWebhook(rawBody, {
      id,
      timestamp,
      signature: `v1,${signature}`
    }, 'whsec_***', now)).resolves.toMatchObject({
      valid: false,
      error: 'invalid_secret'
    });
    await expect(verifyResendWebhook(`${rawBody} `, {
      id,
      timestamp,
      signature: `v1,${signature}`
    }, secret, now)).resolves.toEqual({ valid: false, id });
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

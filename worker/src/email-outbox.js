export const EMAIL_OUTBOX_PREFIX = 'email-outbox:v1:';
export const EMAIL_OUTBOX_QUEUE_STATE_KEY = 'email-outbox-queue:v1';
export const EMAIL_DELIVERY_PREFIX = 'email-delivery:v1:';
export const EMAIL_SUPPRESSION_PREFIX = 'email-suppression:v1:';
export const RESEND_WEBHOOK_MARKER_PREFIX = 'resend-webhook:v1:';
export const EMAIL_OUTBOX_PAYLOAD_TTL_SECONDS = 30 * 24 * 60 * 60;
export const EMAIL_DELIVERY_TTL_SECONDS = 400 * 24 * 60 * 60;
export const RESEND_WEBHOOK_MARKER_TTL_SECONDS = 35 * 24 * 60 * 60;
const EMAIL_PROCESSING_LEASE_MS = 10 * 60 * 1000;
const RESEND_IDEMPOTENCY_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const MAX_FROZEN_PROVIDER_PAYLOAD_BYTES = 8 * 1024 * 1024;

const MARKETING_KINDS = new Set(['store_event_reminder', 'store_abandoned_cart']);
const TEMPLATE_SENDERS = Object.freeze({
  store_order: 'sendStoreOrderEmail',
  store_event_reminder: 'sendStoreEventReminderEmail',
  store_abandoned_cart: 'sendStoreAbandonedCartEmail'
});

function jobKey(jobId) { return `${EMAIL_OUTBOX_PREFIX}${jobId}`; }
function deliveryKey(jobId) { return `${EMAIL_DELIVERY_PREFIX}${jobId}`; }
async function suppressionKey(email) { return `${EMAIL_SUPPRESSION_PREFIX}${await sha256Hex(normalizeEmail(email))}`; }

export function emailOutboxEnabled(env = {}) {
  if (env.EMAIL_OUTBOX_ENABLED === undefined) return String(env.APP_MODE || '').trim().toLowerCase() === 'live';
  return ['1', 'true'].includes(String(env.EMAIL_OUTBOX_ENABLED || '').trim().toLowerCase());
}

async function writeQueueState(env, hasPending, nextDueAt = '') {
  if (!env?.STORE_STATE?.put) return;
  await env.STORE_STATE.put(
    EMAIL_OUTBOX_QUEUE_STATE_KEY,
    JSON.stringify(createOutboxQueueState({ hasPending, nextDueAt })),
    { expirationTtl: hasPending ? EMAIL_OUTBOX_PAYLOAD_TTL_SECONDS : 60 * 60 }
  );
}

export async function enqueueEmailOutbox(env, { kind, payload, dedupeKey = '', orderToken = '', expiresAt = '' }) {
  if (!env?.STORE_STATE) return { sent: false, queued: false, reason: 'Email outbox storage is not configured' };
  if (!TEMPLATE_SENDERS[kind]) return { sent: false, queued: false, reason: 'Unsupported email outbox template' };
  const jobId = await createOutboxJobId({ kind, dedupeKey, payload });
  const [delivery, existing] = await Promise.all([
    env.STORE_STATE.get(deliveryKey(jobId), { type: 'json' }),
    env.STORE_STATE.get(jobKey(jobId), { type: 'json' })
  ]);
  if (['accepted', 'delivered'].includes(delivery?.status) || existing?.status === 'sent') {
    return { sent: true, queued: false, deduped: true, jobId, providerId: delivery?.providerId || '' };
  }
  if (existing && ['pending', 'processing', 'retry'].includes(existing.status)) {
    return { sent: true, queued: true, deduped: true, jobId };
  }
  const created = createOutboxJobRecord({
    jobId,
    kind,
    payload,
    metadata: { orderToken: String(orderToken || payload?.orderToken || '') },
    existing,
    expiresAt,
    maxRecordBytes: MAX_FROZEN_PROVIDER_PAYLOAD_BYTES
  });
  if (!created.ok) return { sent: false, queued: false, reason: created.reason, jobId };
  await env.STORE_STATE.put(jobKey(jobId), created.serialized, { expirationTtl: EMAIL_OUTBOX_PAYLOAD_TTL_SECONDS });
  await writeQueueState(env, true, created.record.nextAttemptAt);
  return { sent: true, queued: true, deduped: false, jobId };
}

async function renderProviderPayload(env, job) {
  const emailModule = await import('./email.js');
  const sender = emailModule[TEMPLATE_SENDERS[job.kind]];
  if (typeof sender !== 'function') throw new Error(`Email template is unavailable: ${job.kind}`);
  const captureEnv = { ...env, RESEND_API_KEY: env.RESEND_API_KEY || 'capture-only', STORE_EMAIL_CAPTURE_PAYLOAD: 'true' };
  await sender(captureEnv, job.payload || {});
  const prepared = captureEnv.__STORE_CAPTURED_EMAIL_PAYLOAD;
  if (!prepared) throw new Error('Email template did not produce a provider payload');
  const providerPayload = {
    ...prepared,
    tags: [
      ...(prepared.tags || []),
      { name: 'store_job', value: safeTagValue(job.jobId) },
      { name: 'category', value: safeTagValue(job.kind) },
      ...(job.orderToken ? [{ name: 'order', value: safeTagValue(job.orderToken) }] : [])
    ]
  };
  if (new TextEncoder().encode(JSON.stringify(providerPayload)).byteLength > MAX_FROZEN_PROVIDER_PAYLOAD_BYTES) {
    throw new Error('Rendered email exceeds the durable outbox limit');
  }
  return providerPayload;
}

async function recipientSuppressed(env, job) {
  if (!MARKETING_KINDS.has(job.kind)) return false;
  const email = normalizeEmail(job.payload?.email || job.payload?.to);
  return email ? Boolean(await env.STORE_STATE.get(await suppressionKey(email))) : false;
}

async function markAcceptedStoreOrder(env, job, acceptedAt) {
  if (job.kind !== 'store_order' || !job.orderToken) return;
  const key = `orders:${job.orderToken}`;
  const order = await env.STORE_STATE.get(key, { type: 'json' });
  if (order) {
    await env.STORE_STATE.put(key, JSON.stringify({
      ...order,
      emailQueued: true,
      emailSent: true,
      emailError: null,
      emailSentAt: acceptedAt,
      emailOutboxJobId: job.jobId,
      updatedAt: acceptedAt
    }));
  }
  await env.STORE_STATE.put(`store-order-email-sent:${job.orderToken}`, 'sent', { expirationTtl: EMAIL_OUTBOX_PAYLOAD_TTL_SECONDS });
}

export async function processEmailOutbox(env, { now = new Date(), limit = 10 } = {}) {
  const empty = { attempted: false, checked: 0, sent: 0, retried: 0, failed: 0, suppressed: 0 };
  if (!env?.STORE_STATE?.list) return empty;
  const queueState = await env.STORE_STATE.get(EMAIL_OUTBOX_QUEUE_STATE_KEY, { type: 'json' });
  if (queueState?.hasPending === false) return { ...empty, skippedReason: 'idle' };
  const queueDueMs = Date.parse(queueState?.nextDueAt || '');
  if (Number.isFinite(queueDueMs) && queueDueMs > now.getTime()) return { ...empty, skippedReason: 'not_due' };

  const listing = await env.STORE_STATE.list({ prefix: EMAIL_OUTBOX_PREFIX, limit: Math.max(1, Math.min(100, limit)) });
  const results = { ...empty, attempted: (listing.keys || []).length > 0 };
  let hasPending = listing.list_complete === false;
  let nextDueAt = '';

  for (const keyInfo of listing.keys || []) {
    const key = String(keyInfo?.name || '');
    const job = await env.STORE_STATE.get(key, { type: 'json' });
    const disposition = classifyOutboxJob(job, { now, leaseMs: EMAIL_PROCESSING_LEASE_MS });
    if (disposition.state === 'missing' || disposition.state === 'terminal') continue;
    results.checked += 1;
    if (disposition.state === 'not_due') {
      hasPending = true;
      if (!nextDueAt || Date.parse(disposition.nextDueAt) < Date.parse(nextDueAt)) nextDueAt = disposition.nextDueAt;
      continue;
    }
    if (disposition.state === 'expired') {
      await env.STORE_STATE.put(deliveryKey(job.jobId), JSON.stringify({ version: 1, status: 'expired', kind: job.kind, orderToken: job.orderToken, updatedAt: now.toISOString() }), { expirationTtl: EMAIL_DELIVERY_TTL_SECONDS });
      await env.STORE_STATE.delete(key);
      results.failed += 1;
      continue;
    }
    if (disposition.state === 'leased') {
      hasPending = true;
      continue;
    }
    if (await recipientSuppressed(env, job)) {
      await env.STORE_STATE.put(deliveryKey(job.jobId), JSON.stringify({ version: 1, status: 'suppressed', kind: job.kind, orderToken: job.orderToken, updatedAt: now.toISOString() }), { expirationTtl: EMAIL_DELIVERY_TTL_SECONDS });
      await env.STORE_STATE.delete(key);
      results.suppressed += 1;
      continue;
    }

    let deliveryStage = job.providerPayload ? 'provider' : 'render';
    try {
      if (!job.providerPayload) {
        job.providerPayload = await renderProviderPayload(env, job);
        job.contentHash = await sha256Hex(stableStringify(job.providerPayload));
      }
      job.status = 'processing';
      job.attempts = Number(job.attempts || 0) + 1;
      job.firstAttemptAt = job.firstAttemptAt || now.toISOString();
      job.lastAttemptAt = now.toISOString();
      deliveryStage = 'persist';
      await env.STORE_STATE.put(key, JSON.stringify(job), { expirationTtl: EMAIL_OUTBOX_PAYLOAD_TTL_SECONDS });
      deliveryStage = 'provider';
      const { sendPreparedResendEmail } = await import('./email.js');
      const response = await sendPreparedResendEmail(env, job.providerPayload, {
        idempotencyKey: `store/${job.jobId}`,
        errorLabel: `Resend outbox error (${job.kind})`,
        failureLabel: `Failed to deliver ${job.kind} email`
      });
      const acceptedAt = new Date().toISOString();
      const existingDelivery = await env.STORE_STATE.get(deliveryKey(job.jobId), { type: 'json' });
      const status = ['delivered', 'bounced', 'complained', 'suppressed'].includes(existingDelivery?.status) ? existingDelivery.status : 'accepted';
      await env.STORE_STATE.put(deliveryKey(job.jobId), JSON.stringify({
        ...(existingDelivery || {}), version: 1, status, kind: job.kind, orderToken: job.orderToken,
        providerId: String(existingDelivery?.providerId || response?.id || ''), contentHash: job.contentHash, acceptedAt
      }), { expirationTtl: EMAIL_DELIVERY_TTL_SECONDS });
      await markAcceptedStoreOrder(env, job, acceptedAt);
      await env.STORE_STATE.delete(key);
      results.sent += 1;
    } catch (error) {
      const failedBeforeProvider = deliveryStage !== 'provider';
      if (deliveryStage === 'render') {
        job.attempts = Number(job.attempts || 0) + 1;
        job.firstAttemptAt = job.firstAttemptAt || now.toISOString();
        job.lastAttemptAt = now.toISOString();
        if (!job.contentHash) job.providerPayload = null;
      }
      const firstAttemptMs = Date.parse(job.firstAttemptAt || '');
      const ambiguityExpired = error?.ambiguous && Number.isFinite(firstAttemptMs) && now.getTime() - firstAttemptMs > RESEND_IDEMPOTENCY_RETRY_WINDOW_MS;
      const retryable = error?.retryable === true || failedBeforeProvider;
      if (!retryable || ambiguityExpired) {
        await env.STORE_STATE.put(deliveryKey(job.jobId), JSON.stringify({
          version: 1, status: ambiguityExpired ? 'ambiguous' : 'failed', kind: job.kind, orderToken: job.orderToken,
          contentHash: job.contentHash, attempts: job.attempts,
          lastError: outboxDeliveryErrorEvidence(error, { stage: deliveryStage }), updatedAt: now.toISOString()
        }), { expirationTtl: EMAIL_DELIVERY_TTL_SECONDS });
        await env.STORE_STATE.delete(key);
        results.failed += 1;
        continue;
      }
      const next = new Date(now.getTime() + outboxRetryDelayMs(error, job.attempts));
      job.status = 'retry';
      job.nextAttemptAt = next.toISOString();
      job.lastError = outboxDeliveryErrorEvidence(error, { stage: deliveryStage });
      await env.STORE_STATE.put(key, JSON.stringify(job), { expirationTtl: EMAIL_OUTBOX_PAYLOAD_TTL_SECONDS });
      hasPending = true;
      if (!nextDueAt || next.getTime() < Date.parse(nextDueAt)) nextDueAt = next.toISOString();
      results.retried += 1;
    }
  }
  await writeQueueState(env, hasPending, nextDueAt);
  return results;
}

export async function verifyResendWebhook(rawBody, headers, secret, now = new Date()) {
  const result = await verifySharedResendWebhook(rawBody, headers, secret, { now });
  if (result.valid) return { valid: true, id: result.id };
  if (result.error === 'invalid_signature') return { valid: false, id: result.id };
  return {
    valid: false,
    error: result.error === 'invalid_timestamp'
      ? 'timestamp_outside_tolerance'
      : result.error
  };
}

export async function processResendWebhook(env, event, svixId) {
  if (!env?.STORE_STATE) return { processed: false, reason: 'storage_not_configured' };
  const markerKey = `${RESEND_WEBHOOK_MARKER_PREFIX}${svixId}`;
  if (await env.STORE_STATE.get(markerKey)) return { processed: false, duplicate: true };
  const type = String(event?.type || '');
  const data = event?.data || {};
  const tags = outboxWebhookTags(data);
  const jobId = String(tags.store_job || '');
  const providerId = String(data.email_id || '');
  if (validOutboxJobId(jobId)) {
    const key = deliveryKey(jobId);
    const delivery = await env.STORE_STATE.get(key, { type: 'json' }) || { version: 1, providerId };
    delivery.providerId = delivery.providerId || providerId;
    delivery.lastEvent = type;
    delivery.lastEventAt = String(event.created_at || new Date().toISOString());
    delivery.status = outboxWebhookDeliveryStatus(type) || delivery.status;
    await env.STORE_STATE.put(key, JSON.stringify(delivery), { expirationTtl: EMAIL_DELIVERY_TTL_SECONDS });
  }
  const shouldSuppress = outboxWebhookShouldSuppress(event);
  if (shouldSuppress) {
    for (const email of Array.isArray(data.to) ? data.to : []) {
      const normalized = normalizeEmail(email);
      if (!normalized) continue;
      await env.STORE_STATE.put(await suppressionKey(normalized), JSON.stringify({
        version: 1, emailHash: await sha256Hex(normalized), reason: type, providerId,
        suppressedAt: String(event.created_at || new Date().toISOString())
      }), { expirationTtl: EMAIL_DELIVERY_TTL_SECONDS });
    }
  }
  await env.STORE_STATE.put(markerKey, JSON.stringify({ type, providerId, processedAt: new Date().toISOString() }), { expirationTtl: RESEND_WEBHOOK_MARKER_TTL_SECONDS });
  return { processed: true, type, jobId, suppressed: shouldSuppress };
}
import {
  verifyResendWebhook as verifySharedResendWebhook
} from '../../shared/dust-wave-platform/packages/worker-core/src/resend.js';
import { sha256Hex } from '../../shared/dust-wave-platform/packages/worker-core/src/crypto.js';
import {
  classifyOutboxJob,
  createOutboxJobId,
  createOutboxJobRecord,
  createOutboxQueueState,
  normalizeOutboxEmail as normalizeEmail,
  outboxDeliveryErrorEvidence,
  outboxRetryDelayMs,
  outboxWebhookDeliveryStatus,
  outboxWebhookShouldSuppress,
  outboxWebhookTags,
  safeOutboxTagValue as safeTagValue,
  stableOutboxStringify as stableStringify,
  validOutboxJobId
} from '../../shared/dust-wave-platform/packages/worker-core/src/outbox.js';

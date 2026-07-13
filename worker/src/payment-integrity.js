import { createStripeClient, DEFAULT_STRIPE_API_VERSION } from './stripe.js';

export const PROCESSOR_EVENT_PREFIX = 'processor-event:v1:';
export const PROCESSOR_EVENT_RETENTION_SECONDS = 400 * 24 * 60 * 60;
export const RECONCILIATION_BREAK_PREFIX = 'reconciliation-break:v1:';
export const RECONCILIATION_BREAK_RETENTION_SECONDS = 400 * 24 * 60 * 60;

function bounded(value, max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function stripeMode(secretKey = '') {
  const key = String(secretKey || '');
  if (key.startsWith('sk_live_')) return 'live';
  if (key.startsWith('sk_test_')) return 'test';
  return 'unknown';
}

function eventKey(now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:.TZ]/g, '');
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${PROCESSOR_EVENT_PREFIX}${timestamp}:${random}`;
}

export async function recordStripeProcessorEvent(env = {}, event = {}, context = {}) {
  if (!env?.STORE_STATE?.put) return { stored: false, reason: 'store_state_unavailable' };
  const now = new Date();
  const record = {
    version: 1,
    processor: 'stripe',
    kind: bounded(context.kind || 'api_request', 40),
    recordedAt: now.toISOString(),
    bookedAt: now.toISOString(),
    valueTime: context.valueTime || event.valueTime || null,
    processorAvailableAt: context.processorAvailableAt || event.processorAvailableAt || null,
    operation: bounded(context.operation || `${event.method || ''} ${event.path || ''}`, 120),
    intent: bounded(context.intent || '', 80),
    orderToken: bounded(context.orderToken || '', 100),
    eventId: bounded(event.eventId || '', 120),
    eventType: bounded(event.eventType || '', 120),
    method: bounded(event.method || '', 12),
    path: bounded(String(event.path || '').split('?')[0], 160),
    status: Math.max(0, Number(event.status || 0) || 0),
    success: event.success === true,
    retryable: event.retryable === true,
    idempotencyKey: bounded(event.idempotencyKey || '', 180),
    stripeVersion: bounded(event.stripeVersion || DEFAULT_STRIPE_API_VERSION, 80),
    mode: bounded(context.mode || 'unknown', 12),
    requestId: bounded(event.requestId || '', 120),
    objectId: bounded(event.objectId || '', 120),
    objectType: bounded(event.objectType || '', 80),
    errorType: bounded(event.errorType || '', 80),
    errorCode: bounded(event.errorCode || '', 80),
    reconciliationStatus: 'unreviewed'
  };
  const key = eventKey(now);
  await env.STORE_STATE.put(key, JSON.stringify(record), { expirationTtl: PROCESSOR_EVENT_RETENTION_SECONDS });
  return { stored: true, key, record };
}

export function createStoreStripeClient(env = {}, secretKey = '', context = {}) {
  return createStripeClient(secretKey, {
    stripeVersion: String(env.STRIPE_API_VERSION || DEFAULT_STRIPE_API_VERSION).trim() || DEFAULT_STRIPE_API_VERSION,
    onRequest: (event) => recordStripeProcessorEvent(env, event, {
      ...context,
      mode: stripeMode(secretKey)
    })
  });
}

export function reconciliationKey(orderToken = '') {
  return `${RECONCILIATION_BREAK_PREFIX}${bounded(orderToken || 'unknown', 100)}`;
}

export async function storeReconciliationBreak(env = {}, discrepancy = {}) {
  if (!env?.STORE_STATE?.put) return { stored: false, reason: 'store_state_unavailable' };
  const orderToken = bounded(discrepancy.orderToken || '', 100);
  if (!orderToken) return { stored: false, reason: 'order_token_required' };
  const now = new Date().toISOString();
  const key = reconciliationKey(orderToken);
  const existing = env.STORE_STATE.get
    ? await env.STORE_STATE.get(key, { type: 'json' })
    : null;
  const resolved = discrepancy.resolved === true;
  const record = {
    version: 1,
    orderToken,
    paymentIntentId: bounded(discrepancy.paymentIntentId || '', 120),
    status: resolved ? 'resolved' : 'open',
    severity: ['info', 'warning', 'critical'].includes(discrepancy.severity) ? discrepancy.severity : 'warning',
    reasons: Array.from(new Set((discrepancy.reasons || []).map((reason) => bounded(reason, 80)).filter(Boolean))).slice(0, 20),
    firstSeenAt: existing?.firstSeenAt || existing?.checkedAt || now,
    lastSeenAt: now,
    occurrenceCount: Math.max(0, Number(existing?.occurrenceCount || 0) || 0) + (resolved ? 0 : 1),
    checkedAt: now,
    resolvedAt: resolved ? now : '',
    source: bounded(discrepancy.source || 'scheduled', 40),
    notes: bounded(discrepancy.notes || '', 320)
  };
  await env.STORE_STATE.put(key, JSON.stringify(record), { expirationTtl: RECONCILIATION_BREAK_RETENTION_SECONDS });
  return { stored: true, key, record };
}

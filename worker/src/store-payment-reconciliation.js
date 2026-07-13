import { ADMIN_STORE_ORDER_INDEX_KEY } from './admin-store-read-model.js';
import { createStoreStripeClient, reconciliationKey, storeReconciliationBreak } from './payment-integrity.js';

export const STORE_PAYMENT_RECONCILIATION_STATE_KEY = 'store-payment-reconciliation-state:v1';
export const STORE_PAYMENT_RECONCILIATION_STATE_TTL_SECONDS = 400 * 24 * 60 * 60;
export const STORE_PAYMENT_RECONCILIATION_DEFAULT_BATCH_SIZE = 20;
export const STORE_PAYMENT_RECONCILIATION_LEASE_MS = 10 * 60 * 1000;
export const STORE_PAYMENT_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const STORE_PAYMENT_RECONCILIATION_ALGORITHM_VERSION = 2;

function boundedInteger(value, fallback, min, max) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function upper(value = '') {
  return String(value || '').trim().toUpperCase();
}

function orderToken(order = {}) {
  return String(order.orderToken || order.orderDraft?.orderToken || '').trim();
}

function paymentIntentId(order = {}) {
  return String(order.payment?.paymentIntentId || order.stripePaymentIntentId || '').trim();
}

export function compareStoreOrderToPaymentIntent(order = {}, paymentIntent = null) {
  const reasons = [];
  const payment = order.payment || {};
  const provider = String(payment.provider || '').trim().toLowerCase();
  if (provider && provider !== 'stripe') {
    return { reasons, severity: 'info', applicable: false, disposition: 'non_stripe_order' };
  }
  const expectedAmount = Math.trunc(Number(payment.amountCents ?? order.totals?.totalCents ?? order.orderDraft?.totals?.totalCents ?? 0) || 0);
  const expectedCurrency = upper(payment.currency || order.totals?.currency || order.orderDraft?.currency);
  const required = payment.required === true;
  const storedStatus = String(order.status || '').trim();
  const storedPaymentStatus = String(payment.status || '').trim();

  if (!required) {
    if (expectedAmount > 0) reasons.push('free_order_has_total');
    if (storedPaymentStatus && storedPaymentStatus !== 'not_required') reasons.push('free_order_payment_status_unexpected');
    return { reasons, severity: reasons.length ? 'warning' : 'info', applicable: true };
  }

  const expectedId = paymentIntentId(order);
  if (!expectedId) {
    reasons.push('payment_intent_missing');
    return { reasons, severity: 'critical', applicable: true };
  }
  if (!paymentIntent) {
    reasons.push('processor_object_unavailable');
    return { reasons, severity: 'warning', applicable: true };
  }

  const actualId = String(paymentIntent.id || '').trim();
  const actualAmount = Math.trunc(Number(paymentIntent.amount ?? paymentIntent.amount_received ?? 0) || 0);
  const actualCurrency = upper(paymentIntent.currency);
  const processorStatus = String(paymentIntent.status || '').trim();
  if (actualId !== expectedId) reasons.push('payment_intent_id_mismatch');
  if (actualAmount !== expectedAmount) reasons.push('amount_mismatch');
  if (expectedCurrency && actualCurrency && actualCurrency !== expectedCurrency) reasons.push('currency_mismatch');
  if (storedStatus === 'confirmed' && processorStatus !== 'succeeded') reasons.push('confirmed_without_succeeded_processor_payment');
  if (processorStatus === 'succeeded' && storedStatus !== 'confirmed') reasons.push('succeeded_processor_payment_without_confirmed_order');
  if (storedPaymentStatus === 'succeeded' && processorStatus !== 'succeeded') reasons.push('stored_succeeded_status_mismatch');
  if (storedStatus === 'payment_failed' && processorStatus === 'succeeded') reasons.push('failed_order_has_succeeded_processor_payment');

  const critical = reasons.some((reason) => [
    'payment_intent_id_mismatch',
    'amount_mismatch',
    'currency_mismatch',
    'confirmed_without_succeeded_processor_payment',
    'succeeded_processor_payment_without_confirmed_order',
    'stored_succeeded_status_mismatch',
    'failed_order_has_succeeded_processor_payment'
  ].includes(reason));
  return { reasons: Array.from(new Set(reasons)), severity: critical ? 'critical' : (reasons.length ? 'warning' : 'info'), applicable: true };
}

async function readJson(storage, key) {
  if (!storage?.get) return null;
  return storage.get(key, { type: 'json' });
}

async function writeState(storage, state) {
  await storage.put(STORE_PAYMENT_RECONCILIATION_STATE_KEY, JSON.stringify(state), {
    expirationTtl: STORE_PAYMENT_RECONCILIATION_STATE_TTL_SECONDS
  });
}

export async function reconcileIndexedStorePayments(env = {}, options = {}) {
  if (!env.STORE_STATE?.get || !env.STORE_STATE?.put) {
    return { attempted: false, skipped: 'store_state_unavailable' };
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const source = String(options.source || 'scheduled').trim().slice(0, 40) || 'scheduled';
  const force = options.force === true;
  const previousState = await readJson(env.STORE_STATE, STORE_PAYMENT_RECONCILIATION_STATE_KEY) || {};
  const leaseAgeMs = Date.parse(String(previousState.startedAt || ''));
  if (
    previousState.status === 'processing' &&
    Number.isFinite(leaseAgeMs) &&
    nowMs - leaseAgeMs < STORE_PAYMENT_RECONCILIATION_LEASE_MS
  ) {
    return { attempted: false, skipped: 'processing_in_progress', state: previousState };
  }

  const index = await readJson(env.STORE_STATE, ADMIN_STORE_ORDER_INDEX_KEY);
  const indexedOrders = Array.isArray(index?.orders) ? index.orders : [];
  if (!indexedOrders.length) {
    return { attempted: false, skipped: 'order_index_unavailable', indexed: 0 };
  }

  const watermark = String(index.watermark || index.generatedAt || '');
  const currentAlgorithm = Number(previousState.algorithmVersion) === STORE_PAYMENT_RECONCILIATION_ALGORITHM_VERSION;
  const sameCycle = currentAlgorithm && String(previousState.watermark || '') === watermark;
  const priorCursor = sameCycle ? boundedInteger(previousState.cursor, 0, 0, indexedOrders.length) : 0;
  const lastCompletedMs = Date.parse(String(previousState.lastCycleCompletedAt || ''));
  if (!force && currentAlgorithm && priorCursor === 0 && Number.isFinite(lastCompletedMs) && nowMs - lastCompletedMs < STORE_PAYMENT_RECONCILIATION_INTERVAL_MS) {
    return { attempted: false, skipped: 'interval_not_due', nextAt: new Date(lastCompletedMs + STORE_PAYMENT_RECONCILIATION_INTERVAL_MS).toISOString() };
  }

  const batchSize = boundedInteger(options.batchSize ?? env.PAYMENT_RECONCILIATION_BATCH_SIZE, STORE_PAYMENT_RECONCILIATION_DEFAULT_BATCH_SIZE, 1, 100);
  const selected = indexedOrders.slice(priorCursor, priorCursor + batchSize);
  const leaseId = globalThis.crypto?.randomUUID?.() || `${nowMs}-${Math.random().toString(36).slice(2)}`;
  await writeState(env.STORE_STATE, {
    ...previousState,
    version: 1,
    algorithmVersion: STORE_PAYMENT_RECONCILIATION_ALGORITHM_VERSION,
    status: 'processing',
    leaseId,
    source,
    watermark,
    cursor: priorCursor,
    startedAt: nowIso,
    updatedAt: nowIso
  });

  const stripeSecretKey = String(options.stripeSecretKey || '').trim();
  const stripe = options.stripe || (stripeSecretKey
    ? createStoreStripeClient(env, stripeSecretKey, { operation: 'payment_reconciliation', intent: 'read' })
    : null);
  const results = [];
  let open = 0;
  let resolved = 0;
  let unavailable = 0;

  try {
    for (const indexedOrder of selected) {
      const token = orderToken(indexedOrder);
      if (!token) continue;
      const canonical = await readJson(env.STORE_STATE, `orders:${token}`);
      const order = canonical || indexedOrder;
      const intentId = paymentIntentId(order);
      let paymentIntent = null;
      let providerError = '';
      if (order.payment?.required === true && intentId && stripe?.paymentIntents?.retrieve) {
        try {
          paymentIntent = await stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge.balance_transaction'] });
        } catch (error) {
          providerError = String(error?.type || error?.name || 'processor_read_failed').slice(0, 80);
          unavailable += 1;
        }
      }

      const comparison = compareStoreOrderToPaymentIntent(order, paymentIntent);
      if (providerError && !comparison.reasons.includes('processor_object_unavailable')) {
        comparison.reasons.push('processor_object_unavailable');
        comparison.severity = comparison.severity === 'critical' ? 'critical' : 'warning';
      }
      const existingBreak = await readJson(env.STORE_STATE, reconciliationKey(token));
      let breakRecord = null;
      if (comparison.reasons.length) {
        const stored = await storeReconciliationBreak(env, {
          orderToken: token,
          paymentIntentId: intentId,
          reasons: comparison.reasons,
          severity: comparison.severity,
          source,
          notes: providerError
        });
        breakRecord = stored.record || null;
        open += 1;
      } else if (existingBreak?.status === 'open') {
        const stored = await storeReconciliationBreak(env, {
          orderToken: token,
          paymentIntentId: intentId,
          reasons: [],
          severity: existingBreak.severity || 'warning',
          source,
          resolved: true,
          notes: 'Latest bounded reconciliation found no discrepancy.'
        });
        breakRecord = stored.record || null;
        resolved += 1;
      }
      results.push({
        orderToken: token,
        paymentIntentId: intentId,
        status: breakRecord?.status || 'matched',
        severity: comparison.severity,
        reasons: comparison.reasons
      });
    }

    const nextCursorValue = priorCursor + selected.length;
    const cycleComplete = nextCursorValue >= indexedOrders.length;
    const nextState = {
      version: 1,
      algorithmVersion: STORE_PAYMENT_RECONCILIATION_ALGORITHM_VERSION,
      status: 'idle',
      source,
      watermark,
      cursor: cycleComplete ? 0 : nextCursorValue,
      indexed: indexedOrders.length,
      processed: selected.length,
      open,
      resolved,
      unavailable,
      startedAt: nowIso,
      completedAt: new Date().toISOString(),
      lastCycleCompletedAt: cycleComplete ? new Date().toISOString() : (previousState.lastCycleCompletedAt || ''),
      updatedAt: new Date().toISOString()
    };
    await writeState(env.STORE_STATE, nextState);
    return {
      attempted: true,
      source,
      indexed: indexedOrders.length,
      processed: selected.length,
      open,
      resolved,
      unavailable,
      cycleComplete,
      nextCursor: nextState.cursor,
      results
    };
  } catch (error) {
    await writeState(env.STORE_STATE, {
      ...previousState,
      version: 1,
      status: 'idle',
      source,
      watermark,
      cursor: priorCursor,
      startedAt: nowIso,
      completedAt: new Date().toISOString(),
      lastError: String(error?.message || error).slice(0, 320),
      updatedAt: new Date().toISOString()
    });
    throw error;
  }
}

export const STORE_INVENTORY_RECONCILIATION_ACKNOWLEDGEMENT = 'STORE_INVENTORY_RECONCILE';

function nonNegativeInteger(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function normalizeInventoryEntry(value = {}) {
  return {
    ...value,
    limit: nonNegativeInteger(value.limit),
    claimed: nonNegativeInteger(value.claimed)
  };
}

function sortedObject(value = {}) {
  return Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right)));
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function increment(target, key) {
  const normalized = String(key || 'unknown').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64) || 'unknown';
  target[normalized] = (target[normalized] || 0) + 1;
}

function normalizedStripeRecoveryOrder(order = {}) {
  const orderDraft = order.orderDraft || {};
  return {
    orderToken: String(order.orderToken || orderDraft.orderToken || ''),
    totals: order.totals || orderDraft.totals || {},
    payment: order.payment || {},
    stripePaymentIntentId: String(order.stripePaymentIntentId || '')
  };
}

export function stripeCredentialMode(secretKey = '') {
  const prefix = String(secretKey || '').trim().split('_').slice(0, 2).join('_');
  if (['sk_live', 'rk_live'].includes(prefix)) return 'live';
  if (['sk_test', 'rk_test'].includes(prefix)) return 'test';
  return 'unknown';
}

async function retrieveStripePaymentIntent(secretKey, paymentIntentId, fetchImpl = fetch, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secretKey}`, Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal
    });
  } catch {
    return { paymentIntent: null, reason: 'provider_unavailable' };
  } finally {
    clearTimeout(timeout);
  }
  if (response.ok) {
    const paymentIntent = await response.json().catch(() => null);
    return paymentIntent && typeof paymentIntent === 'object'
      ? { paymentIntent, reason: '' }
      : { paymentIntent: null, reason: 'provider_invalid_response' };
  }
  const reason = response.status === 404
    ? 'provider_payment_intent_not_found'
    : ([401, 403].includes(response.status)
      ? 'provider_authentication_failed'
      : (response.status === 429
        ? 'provider_rate_limited'
        : (response.status >= 500 ? 'provider_unavailable' : 'provider_request_failed')));
  return { paymentIntent: null, reason };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function buildExpectedStoreRecoveryInventory(catalogInventory = {}, soldBySku = {}) {
  const expected = {};
  const orphanedSoldSkus = [];
  const overLimitSkus = [];
  for (const [sku, entry] of Object.entries(sortedObject(catalogInventory))) {
    const claimed = nonNegativeInteger(soldBySku[sku]);
    expected[sku] = { ...normalizeInventoryEntry(entry), claimed };
    if (claimed > expected[sku].limit) overLimitSkus.push(sku);
  }
  for (const [sku, sold] of Object.entries(sortedObject(soldBySku))) {
    if (nonNegativeInteger(sold) > 0 && !expected[sku]) orphanedSoldSkus.push(sku);
  }
  return {
    inventory: expected,
    totals: {
      skus: Object.keys(expected).length,
      claimed: Object.values(expected).reduce((sum, entry) => sum + nonNegativeInteger(entry.claimed), 0),
      orphanedSoldSkus: orphanedSoldSkus.length,
      overLimitSkus: overLimitSkus.length
    },
    orphanedSoldSkus,
    overLimitSkus
  };
}

export function buildStoreInventoryRecoveryReconciliation(currentSnapshot = {}, expectedResult = {}) {
  const current = currentSnapshot?.inventory && typeof currentSnapshot.inventory === 'object'
    ? currentSnapshot.inventory
    : {};
  const expected = expectedResult?.inventory && typeof expectedResult.inventory === 'object'
    ? expectedResult.inventory
    : {};
  const skus = Array.from(new Set([...Object.keys(current), ...Object.keys(expected)])).sort();
  const differences = [];
  for (const sku of skus) {
    const currentEntry = current[sku] ? normalizeInventoryEntry(current[sku]) : null;
    const expectedEntry = expected[sku] ? normalizeInventoryEntry(expected[sku]) : null;
    if (
      currentEntry?.limit === expectedEntry?.limit &&
      currentEntry?.claimed === expectedEntry?.claimed
    ) continue;
    differences.push({
      sku,
      currentLimit: currentEntry?.limit ?? null,
      expectedLimit: expectedEntry?.limit ?? null,
      currentClaimed: currentEntry?.claimed ?? null,
      expectedClaimed: expectedEntry?.claimed ?? null
    });
  }
  const reservedCounts = currentSnapshot?.reservedCounts && typeof currentSnapshot.reservedCounts === 'object'
    ? currentSnapshot.reservedCounts
    : {};
  return {
    matches: differences.length === 0 && Object.keys(reservedCounts).length === 0,
    differences,
    totals: {
      comparedSkus: skus.length,
      differingSkus: differences.length,
      currentClaimed: Object.values(current).reduce((sum, entry) => sum + nonNegativeInteger(entry?.claimed), 0),
      expectedClaimed: Object.values(expected).reduce((sum, entry) => sum + nonNegativeInteger(entry?.claimed), 0),
      reservedSkus: Object.keys(reservedCounts).length,
      reservedQuantity: Object.values(reservedCounts).reduce((sum, count) => sum + nonNegativeInteger(count), 0),
      orphanedSoldSkus: nonNegativeInteger(expectedResult?.totals?.orphanedSoldSkus),
      overLimitSkus: nonNegativeInteger(expectedResult?.totals?.overLimitSkus)
    }
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function storeRecoveryFingerprint(value) {
  const bytes = new TextEncoder().encode(stableJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function compareStoreOrderToStripePaymentIntent(order = {}, paymentIntent = null) {
  const reasons = [];
  const payment = order.payment || {};
  const expectedIntentId = String(payment.paymentIntentId || order.stripePaymentIntentId || '').trim();
  const stripePayment = String(payment.provider || '').toLowerCase() === 'stripe' || Boolean(expectedIntentId);
  if (!stripePayment) return { compared: false, matches: true, reasons };
  if (!paymentIntent || typeof paymentIntent !== 'object') {
    return { compared: true, matches: false, reasons: ['provider_payment_intent_missing'] };
  }
  const orderToken = String(order.orderToken || '').trim();
  if (!expectedIntentId) reasons.push('order_payment_intent_missing');
  if (expectedIntentId && String(paymentIntent.id || '') !== expectedIntentId) reasons.push('payment_intent_id_mismatch');
  const expectedAmount = nonNegativeInteger(payment.amountCents ?? order.totals?.totalCents);
  if (expectedAmount !== nonNegativeInteger(paymentIntent.amount)) reasons.push('amount_mismatch');
  const expectedCurrency = String(payment.currency || order.totals?.currency || '').trim().toLowerCase();
  const providerCurrency = String(paymentIntent.currency || '').trim().toLowerCase();
  if (expectedCurrency && providerCurrency && expectedCurrency !== providerCurrency) reasons.push('currency_mismatch');
  const orderPaymentStatus = String(payment.status || '').trim().toLowerCase();
  const providerStatus = String(paymentIntent.status || '').trim().toLowerCase();
  if (orderPaymentStatus === 'succeeded' && providerStatus !== 'succeeded') reasons.push('settlement_status_mismatch');
  if (orderPaymentStatus !== 'succeeded' && providerStatus === 'succeeded') reasons.push('provider_succeeded_order_unsettled');
  const providerOrderToken = String(paymentIntent.metadata?.orderToken || '').trim();
  if (providerOrderToken && orderToken && providerOrderToken !== orderToken) reasons.push('provider_order_token_mismatch');
  return { compared: true, matches: reasons.length === 0, reasons };
}

export async function compareStoreOrdersToStripePaymentIntents(orders = [], options = {}) {
  const normalizedOrders = orders.map(normalizedStripeRecoveryOrder).filter((order) => order.orderToken);
  const stripeOrders = normalizedOrders.filter((order) => (
    String(order.payment?.provider || '').trim().toLowerCase() === 'stripe' ||
    Boolean(String(order.payment?.paymentIntentId || order.stripePaymentIntentId || '').trim())
  ));
  const maximumRequests = boundedInteger(options.maximumRequests, 500, 1, 5000);
  const requestTimeoutMs = boundedInteger(options.requestTimeoutMs, 10000, 1000, 30000);
  const secretKey = String(options.secretKey || '').trim();
  const mode = String(options.mode || 'available').trim().toLowerCase();
  const expectedCredentialMode = String(options.expectedCredentialMode || 'any').trim().toLowerCase();
  const credentialMode = secretKey ? stripeCredentialMode(secretKey) : 'unavailable';
  if (!['off', 'available', 'required'].includes(mode)) throw new Error('Stripe recovery mode must be off, available, or required.');
  if (!['any', 'live', 'test'].includes(expectedCredentialMode)) throw new Error('Expected Stripe credential mode must be any, live, or test.');
  if (mode === 'required' && stripeOrders.length > 0 && !secretKey) {
    throw new Error('Required read-only Stripe recovery comparison credential is unavailable.');
  }
  if (mode !== 'off' && secretKey && expectedCredentialMode !== 'any' && credentialMode !== expectedCredentialMode) {
    throw new Error(`Stripe recovery requires a ${expectedCredentialMode}-mode read credential.`);
  }

  const candidates = stripeOrders.filter((order) => String(
    order.payment?.paymentIntentId || order.stripePaymentIntentId || ''
  ).trim()).slice(0, maximumRequests);
  const mismatchReasons = {};
  let matches = 0;
  let mismatches = 0;
  let providerUnavailable = 0;
  let providerNotFound = 0;
  if (mode !== 'off' && secretKey) {
    const comparisons = await mapWithConcurrency(candidates, boundedInteger(options.concurrency, 4, 1, 10), async (order) => {
      const paymentIntentId = String(order.payment?.paymentIntentId || order.stripePaymentIntentId || '').trim();
      const providerResult = await retrieveStripePaymentIntent(
        secretKey,
        paymentIntentId,
        options.fetchImpl || fetch,
        requestTimeoutMs
      );
      if (!providerResult.paymentIntent) {
        return { compared: true, matches: false, reasons: [providerResult.reason] };
      }
      return compareStoreOrderToStripePaymentIntent(order, providerResult.paymentIntent);
    });
    for (const comparison of comparisons) {
      if (comparison.matches) matches += 1;
      else {
        mismatches += 1;
        if (comparison.reasons.includes('provider_payment_intent_not_found')) providerNotFound += 1;
        if (comparison.reasons.some((reason) => [
          'provider_authentication_failed',
          'provider_rate_limited',
          'provider_unavailable',
          'provider_invalid_response',
          'provider_request_failed'
        ].includes(reason))) providerUnavailable += 1;
        for (const reason of comparison.reasons) increment(mismatchReasons, reason);
      }
    }
  }

  const state = mode === 'off'
    ? 'disabled'
    : (!secretKey && stripeOrders.length > 0
      ? 'credential_unavailable'
      : (candidates.length < stripeOrders.length ? 'bounded' : 'complete'));
  return {
    state,
    credentialMode,
    expectedCredentialMode,
    stripeOrders: stripeOrders.length,
    paidOrders: stripeOrders.length,
    candidates: candidates.length,
    compared: matches + mismatches,
    matches,
    mismatches,
    providerUnavailable,
    providerNotFound,
    truncated: candidates.length < stripeOrders.length,
    maximumRequests,
    requestTimeoutMs,
    mismatchReasons
  };
}

export function storeStripeRecoveryComparisonGate(stripe = {}, mode = 'available') {
  const normalizedMode = String(mode || 'available').trim().toLowerCase();
  if (normalizedMode === 'off') return { passed: true, reasons: [] };
  const reasons = [];
  if (stripe?.state !== 'complete') reasons.push('stripe_comparison_incomplete');
  if (Number(stripe?.mismatches || 0) > 0) reasons.push('stripe_mismatches');
  if (Number(stripe?.providerUnavailable || 0) > 0) reasons.push('stripe_provider_unavailable');
  return { passed: reasons.length === 0, reasons };
}

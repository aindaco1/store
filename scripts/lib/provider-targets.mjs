const DEFAULT_SITE_BASE = 'https://shop.dustwave.xyz';
const DEFAULT_WORKER_BASE = 'https://checkout.dustwave.xyz';

function normalizedValue(value) {
  return String(value || '').trim();
}

export function resolveProviderTargets({
  siteBaseOverride = '',
  workerBaseOverride = '',
  stripeTestWebhookBase = '',
  vars = {},
  stagingVars = {}
} = {}) {
  const siteBase = normalizedValue(siteBaseOverride) ||
    normalizedValue(vars.CANONICAL_SITE_BASE) ||
    normalizedValue(vars.SITE_BASE) ||
    DEFAULT_SITE_BASE;
  const workerBase = normalizedValue(workerBaseOverride) ||
    normalizedValue(vars.CANONICAL_WORKER_BASE) ||
    normalizedValue(vars.WORKER_BASE) ||
    DEFAULT_WORKER_BASE;
  const testWorkerBase = normalizedValue(stripeTestWebhookBase) ||
    normalizedValue(stagingVars.WORKER_BASE) ||
    normalizedValue(stagingVars.CANONICAL_WORKER_BASE) ||
    workerBase;

  return { siteBase, workerBase, testWorkerBase };
}

function hasRequiredStripeWebhook(endpoint, workerBase) {
  const requiredEvents = new Set(['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled']);
  const url = String(endpoint?.url || '').replace(/\/+$/, '');
  const expectedUrl = `${workerBase.replace(/\/+$/, '')}/webhooks/stripe`;
  if (url !== expectedUrl) return false;
  if (endpoint.status && endpoint.status !== 'enabled') return false;
  const enabledEvents = new Set(endpoint.enabled_events || []);
  if (enabledEvents.has('*')) return true;
  return Array.from(requiredEvents).every((event) => enabledEvents.has(event));
}

export function findRequiredStripeWebhook(endpoints, workerBase, { livemode = null } = {}) {
  return (endpoints || []).find((entry) => {
    if (livemode !== null && entry?.livemode !== livemode) return false;
    return hasRequiredStripeWebhook(entry, workerBase);
  });
}

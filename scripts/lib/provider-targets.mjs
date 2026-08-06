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
    normalizedValue(vars.SITE_BASE) ||
    DEFAULT_SITE_BASE;
  const workerBase = normalizedValue(workerBaseOverride) ||
    normalizedValue(vars.WORKER_BASE) ||
    DEFAULT_WORKER_BASE;
  const testWorkerBase = normalizedValue(stripeTestWebhookBase) ||
    normalizedValue(stagingVars.WORKER_BASE) ||
    workerBase;

  return { siteBase, workerBase, testWorkerBase };
}

import fs from 'node:fs';
import { quoteStoreShipment, __resetShippingRuntimeStateForTests } from '../worker/src/shipping.js';

function loadWorkerDevVars() {
  const env = {};
  const path = new URL('../worker/.dev.vars', import.meta.url);
  if (!fs.existsSync(path)) {
    return env;
  }

  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const pivot = trimmed.indexOf('=');
    const key = trimmed.slice(0, pivot).trim();
    const value = trimmed.slice(pivot + 1).trim();
    env[key] = value;
  }
  return env;
}

function buildEnv() {
  return {
    APP_MODE: 'development',
    USPS_ENABLED: 'true',
    SHIPPING_ORIGIN_ZIP: '87102',
    SHIPPING_ORIGIN_COUNTRY: 'US',
    SHIPPING_FALLBACK_FLAT_RATE: '3.00',
    ...loadWorkerDevVars()
  };
}

const posterShipment = {
  selectedTiers: [{
    qty: 1,
    tier: {
      id: 'limited-poster',
      category: 'physical',
      shipping: {
        weight_oz: 5,
        packaging_weight_oz: 3,
        length_in: 18,
        width_in: 3,
        height_in: 3,
        stack_height_in: 0.5
      }
    }
  }]
};

const platformStickerAddOn = {
  productId: 'dust-wave-sticker',
  quantity: 2,
  category: 'physical',
  shipping: {
    weight_oz: 1,
    packaging_weight_oz: 0.5,
    length_in: 4,
    width_in: 4,
    height_in: 0.1,
    stack_height_in: 0.05
  }
};

const scenarios = [
  {
    name: 'domestic_physical_tier_standard',
    args: (env) => [env, posterShipment, { country: 'US', postalCode: '80205' }]
  },
  {
    name: 'domestic_physical_tier_signature_required',
    args: (env) => [env, posterShipment, { country: 'US', postalCode: '80205' }, [], 'signature_required']
  },
  {
    name: 'international_physical_tier_standard',
    args: (env) => [env, posterShipment, { country: 'CA', postalCode: 'M5V 2T6' }]
  },
  {
    name: 'platform_global_add_ons_only',
    args: (env) => [env, { selectedTiers: [] }, { country: 'US', postalCode: '80205' }, [], 'standard', [platformStickerAddOn]]
  }
];

const env = buildEnv();
if (!String(env.USPS_CLIENT_ID || '').trim() || !String(env.USPS_CLIENT_SECRET || '').trim()) {
  console.error('USPS credentials are missing from worker/.dev.vars');
  process.exit(1);
}

for (const scenario of scenarios) {
  __resetShippingRuntimeStateForTests();
  const result = await quoteStoreShipment(...scenario.args(env));
  console.log(JSON.stringify({
    scenario: scenario.name,
    valid: result.valid,
    error: result.error || null,
    shippingCents: result.quote?.shippingCents ?? null,
    source: result.quote?.source ?? null,
    service: result.quote?.service ?? null,
    domestic: result.quote?.domestic ?? null,
    selectedOption: result.selectedOption ?? null,
    availableOptions: Array.isArray(result.availableOptions)
      ? result.availableOptions.map((option) => ({
        id: option.id,
        shippingCents: option.shippingCents
      }))
      : []
  }));
}

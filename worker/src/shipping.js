import {
  getFreeShippingDefault,
  getShippingFallbackFeeCents,
  getShippingDefaultOption,
  getShippingOriginCountry,
  getUspsApiBase,
  getUspsClientId,
  getUspsFailureCooldownMs,
  getUspsQuoteCacheTtlMs,
  getUspsRateLimitCooldownMs,
  getUspsTimeoutMs,
  isUspsEnabled
} from './provider-config.js';
import { normalizeDestinationCountry, normalizeDestinationPostalCode } from './destination-validation.js';
import {
  SHIPPING_OPTION_STANDARD,
  buildFallbackShippingQuote as buildCoreFallbackShippingQuote,
  buildFreeShippingQuote as buildCoreFreeShippingQuote,
  buildManualDomesticRateQuote,
  buildStandardOnlyShippingOptions,
  getAddOnShippingProfile,
  getAvailableShippingOptions as getCoreAvailableShippingOptions,
  getSelectedShippingOptionDetails,
  getSupportItemShippingProfile,
  getTierShippingProfile,
  isShippingMetadataError,
  resolveSelectedShippingOption,
  summarizePhysicalSelectionWithoutMetadata,
  summarizeShipmentSelection
} from '../../shared/dust-wave-platform/packages/shipping-core/src/index.js';

const USPS_DOMESTIC_MAIL_CLASSES = ['USPS_GROUND_ADVANTAGE', 'PRIORITY_MAIL'];
const USPS_INTERNATIONAL_MAIL_CLASSES = [
  'FIRST-CLASS_PACKAGE_INTERNATIONAL_SERVICE',
  'PRIORITY_MAIL_INTERNATIONAL'
];
export {
  getAddOnShippingProfile,
  getSelectedShippingOptionDetails,
  getSupportItemShippingProfile,
  getTierShippingProfile,
  resolveSelectedShippingOption
};
let cachedUspsToken = null;
let cachedUspsQuoteResults = new Map();
let cachedUspsBackoffUntil = 0;
let cachedUspsBackoffReason = '';

export function __resetShippingRuntimeStateForTests() {
  cachedUspsToken = null;
  cachedUspsQuoteResults = new Map();
  cachedUspsBackoffUntil = 0;
  cachedUspsBackoffReason = '';
}

export function normalizeShippingDestination(address = {}) {
  const rawCountry = String(address?.country || '').trim();
  const rawPostalCode = String(address?.postalCode || address?.postal_code || '').trim();
  const country = normalizeDestinationCountry(rawCountry);
  const postalCode = normalizeDestinationPostalCode(rawPostalCode, country);

  if (!rawCountry) {
    return { valid: false, error: 'Shipping country is required' };
  }
  if (!country) return { valid: false, error: 'Shipping country must use a two-letter code' };

  if (!rawPostalCode) {
    return { valid: false, error: 'Shipping postal code is required' };
  }
  if (!postalCode) return { valid: false, error: 'Shipping postal code is invalid' };

  return {
    valid: true,
    destination: {
      country,
      postalCode
    }
  };
}

export function summarizeStoreShipmentSelection(
  tierSelection = { selectedTiers: [] },
  supportItems = [],
  storeConfig = null,
  bundleAddOns = []
) {
  return summarizeShipmentSelection(tierSelection, supportItems, storeConfig, bundleAddOns);
}

export function buildFallbackShippingQuote(env, destination, shipment) {
  return buildCoreFallbackShippingQuote({
    originCountry: getShippingOriginCountry(env),
    fallbackFeeCents: getShippingFallbackFeeCents(env)
  }, destination, shipment);
}

export function buildFreeShippingQuote(env, destination, shipment) {
  return buildCoreFreeShippingQuote({
    originCountry: getShippingOriginCountry(env)
  }, destination, shipment);
}

export function getAvailableShippingOptions(
  env,
  destination = {},
  shipment = { hasPhysical: false },
  baseShippingCents = 0
) {
  return getCoreAvailableShippingOptions({
    originCountry: getShippingOriginCountry(env),
    freeShipping: getFreeShippingDefault(env)
  }, destination, shipment, baseShippingCents);
}

export async function quoteStoreShipment(
  env,
  tierSelection,
  destination,
  supportItems = [],
  selectedOption = SHIPPING_OPTION_STANDARD,
  bundleAddOns = []
) {
  const configuredDefaultOption = getShippingDefaultOption(env);
  const shipmentSummary = summarizeStoreShipmentSelection(tierSelection, supportItems, null, bundleAddOns);
  if (!shipmentSummary.valid) {
    if (!isShippingMetadataError(shipmentSummary.error)) {
      return shipmentSummary;
    }

    const coarseShipmentSummary = summarizePhysicalSelectionWithoutMetadata(tierSelection, supportItems, null, bundleAddOns);
    if (!coarseShipmentSummary.valid) {
      return coarseShipmentSummary;
    }

    const shipment = coarseShipmentSummary.shipment;
    const fallbackQuote = buildFallbackShippingQuote(env, destination, shipment);
    const availableOptions = buildStandardOnlyShippingOptions(shipment, fallbackQuote.shippingCents);
    const resolvedOption = resolveSelectedShippingOption(availableOptions, selectedOption, configuredDefaultOption);
    const selectedOptionDetails = getSelectedShippingOptionDetails(availableOptions, resolvedOption, configuredDefaultOption);
    return {
      valid: true,
      shipment,
      availableOptions,
      defaultOption: configuredDefaultOption,
      selectedOption: resolvedOption,
      selectedOptionDetails,
      quote: {
        ...fallbackQuote,
        source: 'fallback_missing_metadata',
        service: fallbackQuote.domestic ? 'domestic_metadata_fallback' : 'international_metadata_fallback',
        shippingCents: Math.max(0, Number(selectedOptionDetails?.shippingCents ?? fallbackQuote.shippingCents) || 0)
      }
    };
  }

  const shipment = shipmentSummary.shipment;
  if (getFreeShippingDefault(env)) {
    const freeQuote = buildFreeShippingQuote(env, destination, shipment);
    const availableOptions = buildStandardOnlyShippingOptions(shipment, 0);
    const resolvedOption = resolveSelectedShippingOption(availableOptions, selectedOption, configuredDefaultOption);
    const selectedOptionDetails = getSelectedShippingOptionDetails(availableOptions, resolvedOption, configuredDefaultOption);
    return {
      valid: true,
      shipment,
      availableOptions,
      defaultOption: configuredDefaultOption,
      selectedOption: resolvedOption,
      selectedOptionDetails,
      quote: {
        ...freeQuote,
        shippingCents: Math.max(0, Number(selectedOptionDetails?.shippingCents ?? freeQuote.shippingCents) || 0)
      }
    };
  }

  const fallbackQuote = buildFallbackShippingQuote(env, destination, shipment);

  if (!shipment.hasPhysical) {
    return {
      valid: true,
      shipment,
      availableOptions: [],
      defaultOption: configuredDefaultOption,
      selectedOption: SHIPPING_OPTION_STANDARD,
      selectedOptionDetails: null,
      quote: fallbackQuote
    };
  }

  const manualDomesticQuote = buildManualDomesticRateQuote(destination, shipment);
  if (manualDomesticQuote.valid) {
    const availableOptions = buildStandardOnlyShippingOptions(shipment, manualDomesticQuote.quote.shippingCents);
    const resolvedOption = resolveSelectedShippingOption(availableOptions, selectedOption, configuredDefaultOption);
    const selectedOptionDetails = getSelectedShippingOptionDetails(availableOptions, resolvedOption, configuredDefaultOption);
    return {
      valid: true,
      shipment,
      availableOptions,
      defaultOption: configuredDefaultOption,
      selectedOption: resolvedOption,
      selectedOptionDetails,
      quote: {
        ...manualDomesticQuote.quote,
        shippingCents: Math.max(0, Number(selectedOptionDetails?.shippingCents ?? manualDomesticQuote.quote.shippingCents) || 0)
      }
    };
  }

  const liveQuote = await getUspsShippingQuote(env, destination, shipment);
  if (liveQuote.valid) {
    const availableOptions = getAvailableShippingOptions(
      env,
      destination,
      shipment,
      liveQuote.quote.shippingCents
    );
    const resolvedOption = resolveSelectedShippingOption(availableOptions, selectedOption, configuredDefaultOption);
    const selectedOptionDetails = getSelectedShippingOptionDetails(availableOptions, resolvedOption, configuredDefaultOption);
    return {
      valid: true,
      shipment,
      availableOptions,
      defaultOption: configuredDefaultOption,
      selectedOption: resolvedOption,
      selectedOptionDetails,
      quote: {
        ...liveQuote.quote,
        shippingCents: Math.max(0, Number(selectedOptionDetails?.shippingCents ?? liveQuote.quote.shippingCents) || 0)
      }
    };
  }

  const availableOptions = buildStandardOnlyShippingOptions(shipment, fallbackQuote.shippingCents);
  const resolvedOption = resolveSelectedShippingOption(availableOptions, selectedOption, configuredDefaultOption);
  const selectedOptionDetails = getSelectedShippingOptionDetails(availableOptions, resolvedOption, configuredDefaultOption);
  return {
    valid: true,
    shipment,
    availableOptions,
    defaultOption: configuredDefaultOption,
    selectedOption: resolvedOption,
    selectedOptionDetails,
    quote: {
      ...fallbackQuote,
      shippingCents: Math.max(0, Number(selectedOptionDetails?.shippingCents ?? fallbackQuote.shippingCents) || 0)
    }
  };
}

function hasUspsCredentials(env = {}) {
  return Boolean(isUspsEnabled(env) && getUspsClientId(env) && String(env.USPS_CLIENT_SECRET || '').trim());
}

function buildUspsDomesticPayload(env, destination, shipment, mailClass) {
  const profile = shipment?.uspsDomesticProfile && typeof shipment.uspsDomesticProfile === 'object'
    ? shipment.uspsDomesticProfile
    : null;
  return {
    originZIPCode: normalizeUsZip(getEnvString(env.SHIPPING_ORIGIN_ZIP, '')),
    destinationZIPCode: normalizeUsZip(destination.postalCode),
    weight: ouncesToPounds(shipment.weightOz),
    length: shipment.lengthIn,
    width: shipment.widthIn,
    height: shipment.heightIn,
    mailClass,
    processingCategory: profile?.processingCategory || 'MACHINABLE',
    destinationEntryFacilityType: profile?.destinationEntryFacilityType || 'NONE',
    rateIndicator: profile?.rateIndicator || 'DR',
    priceType: profile?.priceType || 'RETAIL',
    mailingDate: getTodayIsoDate()
  };
}

function buildUspsInternationalPayload(env, destination, shipment, mailClass) {
  return {
    originZIPCode: normalizeUsZip(getEnvString(env.SHIPPING_ORIGIN_ZIP, '')),
    foreignPostalCode: normalizeIntlPostalCode(destination.postalCode),
    destinationCountryCode: destination.country,
    weight: ouncesToPounds(shipment.weightOz),
    length: shipment.lengthIn,
    width: shipment.widthIn,
    height: shipment.heightIn,
    mailClass,
    processingCategory: 'NON_MACHINABLE',
    destinationEntryFacilityType: 'NONE',
    rateIndicator: 'SP',
    priceType: 'RETAIL',
    mailingDate: getTodayIsoDate()
  };
}

async function getUspsShippingQuote(env, destination, shipment) {
  if (!hasUspsCredentials(env)) {
    return { valid: false, error: 'USPS credentials unavailable' };
  }

  const cachedQuote = getCachedUspsQuote(env, destination, shipment);
  if (cachedQuote) {
    return cachedQuote;
  }

  const activeBackoff = getUspsBackoff();
  if (activeBackoff.active) {
    return { valid: false, error: activeBackoff.reason || 'USPS temporarily unavailable' };
  }

  const domestic = destination.country === getShippingOriginCountry(env);
  const domesticMailClasses =
    Array.isArray(shipment?.uspsDomesticProfile?.mailClasses) &&
    shipment.uspsDomesticProfile.mailClasses.length > 0
      ? shipment.uspsDomesticProfile.mailClasses
      : USPS_DOMESTIC_MAIL_CLASSES;
  const quoteSearch = domestic
    ? await searchUspsRates(env, domesticMailClasses, (mailClass) => buildUspsDomesticPayload(env, destination, shipment, mailClass))
    : await searchUspsRates(env, USPS_INTERNATIONAL_MAIL_CLASSES, (mailClass) => buildUspsInternationalPayload(env, destination, shipment, mailClass));

  if (!quoteSearch.valid) {
    return quoteSearch;
  }

  clearUspsBackoff();

  const result = {
    valid: true,
    quote: {
      shippingCents: quoteSearch.quote.shippingCents,
      source: 'usps_live',
      carrier: 'usps',
      service: quoteSearch.quote.service,
      domestic
    }
  };
  setCachedUspsQuote(env, destination, shipment, result);
  return result;
}

async function searchUspsRates(env, mailClasses, buildPayload) {
  let firstError = null;

  for (const mailClass of mailClasses) {
    try {
      const payload = buildPayload(mailClass);
      const result = await requestUspsRate(env, payload, mailClass);
      if (result.valid) {
        return result;
      }
      firstError = firstError || result;
      if (getUspsBackoff().active) {
        return firstError;
      }
    } catch (error) {
      armUspsBackoff(getUspsFailureCooldownMs(env), error?.message || 'USPS pricing failed');
      firstError = firstError || { valid: false, error: error?.message || 'USPS pricing failed' };
      if (getUspsBackoff().active) {
        return firstError;
      }
    }
  }

  return firstError || { valid: false, error: 'No USPS rates available' };
}

async function requestUspsRate(env, payload, mailClass) {
  const baseUrl = getUspsApiBase(env);
  const domestic = payload.destinationZIPCode !== undefined;
  const endpoint = domestic
    ? `${baseUrl}/prices/v3/base-rates/search`
    : `${baseUrl}/international-prices/v3/base-rates/search`;
  let response = await performUspsRateRequest(env, endpoint, payload);

  if (response.status === 401) {
    cachedUspsToken = null;
    response = await performUspsRateRequest(env, endpoint, payload);
  }

  if (!response.ok) {
    if (response.status === 429) {
      armUspsBackoff(getUspsRateLimitCooldownMs(env), 'USPS rate limit reached');
    } else if (response.status >= 500) {
      armUspsBackoff(getUspsFailureCooldownMs(env), `USPS ${mailClass} temporarily unavailable`);
    }
    return {
      valid: false,
      error: `USPS ${mailClass} quote failed with ${response.status}`
    };
  }

  const body = await response.json().catch(() => null);
  const amount = getUspsPriceFromResponse(body);
  if (!(Number.isFinite(amount) && amount >= 0)) {
    return { valid: false, error: `USPS ${mailClass} quote was missing a price` };
  }

  const service = getPreferredUspsService(body, mailClass);
  return {
    valid: true,
    quote: {
      shippingCents: Math.round(amount * 100),
      service
    }
  };
}

async function getUspsAccessToken(env) {
  const baseUrl = getUspsApiBase(env);
  const now = Date.now();

  if (
    cachedUspsToken &&
    cachedUspsToken.baseUrl === baseUrl &&
    cachedUspsToken.expiresAt > now + 60_000
  ) {
    return cachedUspsToken.token;
  }

  const response = await fetchJsonWithTimeout(`${baseUrl}/oauth2/v3/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: String(env.USPS_CLIENT_ID || ''),
      client_secret: String(env.USPS_CLIENT_SECRET || ''),
      grant_type: 'client_credentials'
    })
  });

  if (!response.ok) {
    if (response.status === 429) {
      armUspsBackoff(getUspsRateLimitCooldownMs(env), 'USPS OAuth rate limit reached');
    } else if (response.status >= 500) {
      armUspsBackoff(getUspsFailureCooldownMs(env), 'USPS OAuth temporarily unavailable');
    }
    throw new Error(`USPS OAuth failed with ${response.status}`);
  }

  const body = await response.json().catch(() => null);
  const token = String(body?.access_token || '').trim();
  const expiresInSeconds = Number(body?.expires_in);
  if (!token) {
    throw new Error('USPS OAuth response did not include an access token');
  }

  cachedUspsToken = {
    token,
    baseUrl,
    expiresAt: now + ((Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 300) * 1000)
  };

  return token;
}

async function fetchJsonWithTimeout(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getUspsTimeoutMs(init?.env || {}));
  const { env: timeoutEnv, ...fetchInit } = init || {};

  try {
    return await fetch(url, {
      ...fetchInit,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      armUspsBackoff(getUspsFailureCooldownMs(timeoutEnv || {}), 'USPS request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function performUspsRateRequest(env, endpoint, payload) {
  const token = await getUspsAccessToken(env);
  return fetchJsonWithTimeout(endpoint, {
    env,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
}

function getUspsQuoteCacheKey(env, destination, shipment) {
  return JSON.stringify({
    apiBase: getUspsApiBase(env),
    originZip: getEnvString(env.SHIPPING_ORIGIN_ZIP, ''),
    originCountry: getShippingOriginCountry(env),
    destinationCountry: destination?.country || '',
    destinationPostalCode: destination?.postalCode || '',
    weightOz: Number(shipment?.weightOz || 0),
    lengthIn: Number(shipment?.lengthIn || 0),
    widthIn: Number(shipment?.widthIn || 0),
    heightIn: Number(shipment?.heightIn || 0),
    tierIds: Array.isArray(shipment?.tierIds) ? shipment.tierIds : [],
    supportItemIds: Array.isArray(shipment?.supportItemIds) ? shipment.supportItemIds : [],
    addOnIds: Array.isArray(shipment?.addOnIds) ? shipment.addOnIds : [],
    uspsDomesticProfile: shipment?.uspsDomesticProfile ? JSON.stringify(shipment.uspsDomesticProfile) : ''
  });
}

function getCachedUspsQuote(env, destination, shipment) {
  const ttlMs = getUspsQuoteCacheTtlMs(env);
  if (!(ttlMs > 0)) return null;

  const key = getUspsQuoteCacheKey(env, destination, shipment);
  const cached = cachedUspsQuoteResults.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cachedUspsQuoteResults.delete(key);
    return null;
  }
  return cached.result;
}

function setCachedUspsQuote(env, destination, shipment, result) {
  const ttlMs = getUspsQuoteCacheTtlMs(env);
  if (!(ttlMs > 0)) return;
  const key = getUspsQuoteCacheKey(env, destination, shipment);
  cachedUspsQuoteResults.set(key, {
    expiresAt: Date.now() + ttlMs,
    result
  });
}

function armUspsBackoff(durationMs, reason) {
  if (!(Number.isFinite(durationMs) && durationMs > 0)) return;
  const until = Date.now() + durationMs;
  if (until > cachedUspsBackoffUntil) {
    cachedUspsBackoffUntil = until;
    cachedUspsBackoffReason = String(reason || '').trim();
  }
}

function clearUspsBackoff() {
  cachedUspsBackoffUntil = 0;
  cachedUspsBackoffReason = '';
}

function getUspsBackoff() {
  if (cachedUspsBackoffUntil > Date.now()) {
    return {
      active: true,
      reason: cachedUspsBackoffReason
    };
  }
  if (cachedUspsBackoffUntil > 0) {
    clearUspsBackoff();
  }
  return {
    active: false,
    reason: ''
  };
}

function getPreferredUspsService(body, fallbackMailClass) {
  const rate = Array.isArray(body?.rates) ? body.rates[0] : null;
  const mailClass = String(rate?.mailClass || fallbackMailClass || '')
    .trim()
    .toLowerCase();
  const description = String(rate?.description || '')
    .trim()
    .toLowerCase();

  if (mailClass.includes('ground')) return 'usps_ground_advantage';
  if (mailClass.includes('first-class') || description.includes('first-class')) return 'usps_first_class_package_international';
  if (mailClass.includes('priority')) return 'usps_priority_mail';
  return mailClass || 'usps_rate';
}

function getUspsPriceFromResponse(body) {
  if (Number.isFinite(Number(body?.totalBasePrice))) {
    return Number(body.totalBasePrice);
  }

  if (Array.isArray(body?.rates) && body.rates.length > 0) {
    const prices = body.rates
      .map((rate) => Number(rate?.price))
      .filter((price) => Number.isFinite(price) && price >= 0);
    if (prices.length > 0) {
      return Math.min(...prices);
    }
  }

  return null;
}

function ouncesToPounds(weightOz) {
  const normalized = Number(weightOz);
  if (!(Number.isFinite(normalized) && normalized > 0)) return 0;
  return Math.max(0.0625, Number((normalized / 16).toFixed(4)));
}

function normalizeUsZip(value) {
  return String(value || '')
    .trim()
    .replace(/[^0-9]/g, '')
    .slice(0, 5);
}

function normalizeIntlPostalCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getEnvString(value, fallback) {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

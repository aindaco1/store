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
import { createUspsRateClient } from '../../shared/dust-wave-platform/packages/shipping-core/src/usps.js';

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
const uspsRateClient = createUspsRateClient({
  resolveConfig: (env = {}) => ({
    enabled: isUspsEnabled(env),
    apiBase: getUspsApiBase(env),
    clientId: getUspsClientId(env),
    clientSecret: String(env.USPS_CLIENT_SECRET || '').trim(),
    originCountry: getShippingOriginCountry(env),
    originZip: String(env.SHIPPING_ORIGIN_ZIP || '').trim(),
    timeoutMs: getUspsTimeoutMs(env),
    quoteCacheTtlMs: getUspsQuoteCacheTtlMs(env),
    failureCooldownMs: getUspsFailureCooldownMs(env),
    rateLimitCooldownMs: getUspsRateLimitCooldownMs(env)
  }),
  domesticMailClasses: USPS_DOMESTIC_MAIL_CLASSES,
  internationalMailClasses: USPS_INTERNATIONAL_MAIL_CLASSES
});

export function __resetShippingRuntimeStateForTests() {
  uspsRateClient.reset();
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

  const liveQuote = await uspsRateClient.quote(env, destination, shipment);
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

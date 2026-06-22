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

const DEFAULT_DIMENSION_INCHES = 1;
const SHIPPING_OPTION_STANDARD = 'standard';
const SHIPPING_OPTION_SIGNATURE_REQUIRED = 'signature_required';
const SHIPPING_OPTION_ADULT_SIGNATURE_REQUIRED = 'adult_signature_required';
const USPS_SIGNATURE_REQUIRED_FEE_CENTS = 395;
const USPS_ADULT_SIGNATURE_REQUIRED_FEE_CENTS = 970;
const USPS_DOMESTIC_MAIL_CLASSES = ['USPS_GROUND_ADVANTAGE', 'PRIORITY_MAIL'];
const USPS_INTERNATIONAL_MAIL_CLASSES = [
  'FIRST-CLASS_PACKAGE_INTERNATIONAL_SERVICE',
  'PRIORITY_MAIL_INTERNATIONAL'
];
const MANUAL_DOMESTIC_RATE_FIRST_CLASS_FLAT = 'FIRST_CLASS_FLAT';
const FIRST_CLASS_FLAT_MIN_LENGTH_IN = 11.5;
const FIRST_CLASS_FLAT_MAX_LENGTH_IN = 15;
const FIRST_CLASS_FLAT_MIN_WIDTH_IN = 6.125;
const FIRST_CLASS_FLAT_MAX_WIDTH_IN = 12;
const FIRST_CLASS_FLAT_MAX_HEIGHT_IN = 0.75;
const FIRST_CLASS_FLAT_MAX_WEIGHT_OZ = 13;
const FIRST_CLASS_FLAT_RATE_TABLE_CENTS = {
  1: 163,
  2: 190,
  3: 217,
  4: 244,
  5: 272,
  6: 300,
  7: 328,
  8: 356,
  9: 384,
  10: 414,
  11: 444,
  12: 474,
  13: 504
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
  const country = String(address?.country || '')
    .trim()
    .toUpperCase();
  const postalCode = String(address?.postalCode || address?.postal_code || '')
    .trim()
    .toUpperCase();

  if (!country || !/^[A-Z]{2}$/.test(country)) {
    return { valid: false, error: 'Shipping country is required' };
  }

  if (!postalCode) {
    return { valid: false, error: 'Shipping postal code is required' };
  }

  return {
    valid: true,
    destination: {
      country,
      postalCode
    }
  };
}

export function getTierShippingProfile(tier = {}) {
  if (tier?.category !== 'physical') {
    return { valid: true, shipping: null };
  }

  return normalizeShippingProfile(
    tier?.shipping,
    `Physical tier "${tier?.id || 'unknown'}"`
  );
}

export function getSupportItemShippingProfile(supportItem = {}) {
  if (supportItem?.category !== 'physical') {
    return { valid: true, shipping: null };
  }

  return normalizeShippingProfile(
    supportItem?.shipping,
    `Physical support item "${supportItem?.id || 'unknown'}"`
  );
}

export function getAddOnShippingProfile(addOn = {}) {
  if (addOn?.category !== 'physical') {
    return { valid: true, shipping: null };
  }

  return normalizeShippingProfile(
    addOn?.shipping,
    `Physical add-on "${addOn?.productId || addOn?.name || 'unknown'}"`
  );
}

function normalizeShippingProfile(shipping, label) {
  if (!shipping || typeof shipping !== 'object') {
    return { valid: false, error: `${label} is missing shipping metadata` };
  }

  const weightOz = Number(shipping.weight_oz);
  const lengthIn = Number(shipping.length_in);
  const widthIn = Number(shipping.width_in);
  const heightIn = Number(shipping.height_in);
  const packagingWeightOz = Number(shipping.packaging_weight_oz);
  const stackHeightIn = Number(shipping.stack_height_in);
  const uspsDomesticProfile = normalizeUspsDomesticProfile(shipping.usps_domestic);
  const manualDomesticRate = normalizeManualDomesticRate(shipping.manual_domestic_rate || shipping.manualDomesticRate);

  if (!(Number.isFinite(weightOz) && weightOz > 0)) {
    return { valid: false, error: `${label} is missing a valid weight` };
  }

  const normalizedHeightIn = Number.isFinite(heightIn) && heightIn > 0 ? heightIn : DEFAULT_DIMENSION_INCHES;

  return {
    valid: true,
    shipping: {
      weightOz,
      lengthIn: Number.isFinite(lengthIn) && lengthIn > 0 ? lengthIn : DEFAULT_DIMENSION_INCHES,
      widthIn: Number.isFinite(widthIn) && widthIn > 0 ? widthIn : DEFAULT_DIMENSION_INCHES,
      heightIn: normalizedHeightIn,
      packagingWeightOz: Number.isFinite(packagingWeightOz) && packagingWeightOz > 0 ? packagingWeightOz : 0,
      stackHeightIn: Number.isFinite(stackHeightIn) && stackHeightIn > 0 ? stackHeightIn : normalizedHeightIn,
      uspsDomesticProfile,
      manualDomesticRate
    }
  };
}

function normalizeUspsDomesticProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const processingCategory = normalizeOptionalString(profile.processing_category || profile.processingCategory);
  const destinationEntryFacilityType = normalizeOptionalString(
    profile.destination_entry_facility_type || profile.destinationEntryFacilityType
  );
  const rateIndicator = normalizeOptionalString(profile.rate_indicator || profile.rateIndicator);
  const priceType = normalizeOptionalString(profile.price_type || profile.priceType);
  const mailClasses = Array.isArray(profile.mail_classes || profile.mailClasses)
    ? (profile.mail_classes || profile.mailClasses)
        .map((value) => normalizeOptionalString(value))
        .filter(Boolean)
    : [];

  if (!processingCategory && !destinationEntryFacilityType && !rateIndicator && !priceType && mailClasses.length <= 0) {
    return null;
  }

  return {
    ...(processingCategory ? { processingCategory } : {}),
    ...(destinationEntryFacilityType ? { destinationEntryFacilityType } : {}),
    ...(rateIndicator ? { rateIndicator } : {}),
    ...(priceType ? { priceType } : {}),
    ...(mailClasses.length > 0 ? { mailClasses } : {})
  };
}

function normalizeManualDomesticRate(value) {
  const normalized = normalizeOptionalString(value).toUpperCase();
  if (!normalized) {
    return null;
  }

  if (normalized === MANUAL_DOMESTIC_RATE_FIRST_CLASS_FLAT) {
    return normalized;
  }

  return null;
}

function normalizeOptionalString(value) {
  const normalized = String(value || '').trim();
  return normalized ? normalized : '';
}

export function summarizeStoreShipmentSelection(
  tierSelection = { selectedTiers: [] },
  supportItems = [],
  storeConfig = null,
  bundleAddOns = []
) {
  const shipment = {
    hasPhysical: false,
    physicalTierCount: 0,
    physicalSupportItemCount: 0,
    physicalAddOnCount: 0,
    physicalUnitCount: 0,
    weightOz: 0,
    lengthIn: 0,
    widthIn: 0,
    heightIn: 0,
    tierIds: [],
    supportItemIds: [],
    addOnIds: [],
    uspsDomesticProfile: undefined,
    manualDomesticRate: undefined
  };

  for (const selected of tierSelection?.selectedTiers || []) {
    const tier = selected?.tier;
    if (tier?.category !== 'physical') {
      continue;
    }

    const qty = Number(selected?.qty || 0);
    if (!Number.isInteger(qty) || qty <= 0) {
      return { valid: false, error: `Invalid quantity for tier "${tier?.id || 'unknown'}"` };
    }

    const profile = getTierShippingProfile(tier);
    if (!profile.valid) {
      return profile;
    }

    shipment.hasPhysical = true;
    shipment.physicalTierCount += 1;
    shipment.physicalUnitCount += qty;
    shipment.weightOz += (profile.shipping.weightOz * qty) + profile.shipping.packagingWeightOz;
    shipment.lengthIn = Math.max(shipment.lengthIn, profile.shipping.lengthIn);
    shipment.widthIn = Math.max(shipment.widthIn, profile.shipping.widthIn);
    shipment.heightIn += profile.shipping.heightIn + (profile.shipping.stackHeightIn * Math.max(0, qty - 1));
    shipment.tierIds.push(tier.id);
    mergeShipmentUspsDomesticProfile(shipment, profile.shipping.uspsDomesticProfile);
    mergeShipmentManualDomesticRate(shipment, profile.shipping.manualDomesticRate);
  }

  const supportItemDefinitions = new Map((storeConfig?.support_items || []).map((item) => [item.id, item]));
  for (const selected of supportItems || []) {
    const supportItemId = typeof selected?.id === 'string' ? selected.id : '';
    const amount = Number(selected?.amount || 0);
    if (!supportItemId || !Number.isInteger(amount) || amount <= 0) {
      return { valid: false, error: `Invalid amount for support item "${supportItemId || 'unknown'}"` };
    }

    const supportItem = supportItemDefinitions.get(supportItemId);
    if (!supportItem) {
      return { valid: false, error: `Support item "${supportItemId}" not found` };
    }
    if (supportItem.category !== 'physical') {
      continue;
    }

    const profile = getSupportItemShippingProfile(supportItem);
    if (!profile.valid) {
      return profile;
    }

    shipment.hasPhysical = true;
    shipment.physicalSupportItemCount += 1;
    shipment.physicalUnitCount += 1;
    shipment.weightOz += profile.shipping.weightOz + profile.shipping.packagingWeightOz;
    shipment.lengthIn = Math.max(shipment.lengthIn, profile.shipping.lengthIn);
    shipment.widthIn = Math.max(shipment.widthIn, profile.shipping.widthIn);
    shipment.heightIn += profile.shipping.heightIn;
    shipment.supportItemIds.push(supportItemId);
    mergeShipmentUspsDomesticProfile(shipment, profile.shipping.uspsDomesticProfile);
    mergeShipmentManualDomesticRate(shipment, profile.shipping.manualDomesticRate);
  }

  for (const selected of bundleAddOns || []) {
    const productId = typeof selected?.productId === 'string' ? selected.productId : '';
    const quantity = Number(selected?.quantity || 0);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
      return { valid: false, error: `Invalid quantity for add-on "${productId || 'unknown'}"` };
    }
    if (selected?.category !== 'physical') {
      continue;
    }

    const profile = getAddOnShippingProfile(selected);
    if (!profile.valid) {
      return profile;
    }

    shipment.hasPhysical = true;
    shipment.physicalAddOnCount += 1;
    shipment.physicalUnitCount += quantity;
    shipment.weightOz += (profile.shipping.weightOz * quantity) + profile.shipping.packagingWeightOz;
    shipment.lengthIn = Math.max(shipment.lengthIn, profile.shipping.lengthIn);
    shipment.widthIn = Math.max(shipment.widthIn, profile.shipping.widthIn);
    shipment.heightIn += profile.shipping.heightIn + (profile.shipping.stackHeightIn * Math.max(0, quantity - 1));
    shipment.addOnIds.push(productId);
    mergeShipmentUspsDomesticProfile(shipment, profile.shipping.uspsDomesticProfile);
    mergeShipmentManualDomesticRate(shipment, profile.shipping.manualDomesticRate);
  }

  if (!shipment.uspsDomesticProfile) {
    delete shipment.uspsDomesticProfile;
  }
  if (!shipment.manualDomesticRate) {
    delete shipment.manualDomesticRate;
  }

  return { valid: true, shipment };
}

function mergeShipmentUspsDomesticProfile(shipment, profile) {
  if (!shipment || shipment.uspsDomesticProfile === null) {
    return;
  }

  const normalizedProfile = profile && typeof profile === 'object' ? profile : null;
  if (shipment.uspsDomesticProfile === undefined) {
    shipment.uspsDomesticProfile = normalizedProfile;
    return;
  }

  const currentKey = shipment.uspsDomesticProfile ? JSON.stringify(shipment.uspsDomesticProfile) : '';
  const nextKey = normalizedProfile ? JSON.stringify(normalizedProfile) : '';
  if (currentKey !== nextKey) {
    shipment.uspsDomesticProfile = null;
  }
}

function mergeShipmentManualDomesticRate(shipment, manualDomesticRate) {
  if (!shipment || shipment.manualDomesticRate === null) {
    return;
  }

  const normalized = normalizeManualDomesticRate(manualDomesticRate);
  if (shipment.manualDomesticRate === undefined) {
    shipment.manualDomesticRate = normalized;
    return;
  }

  if (shipment.manualDomesticRate !== normalized) {
    shipment.manualDomesticRate = null;
  }
}

function summarizePhysicalSelectionWithoutMetadata(
  tierSelection = { selectedTiers: [] },
  supportItems = [],
  storeConfig = null,
  bundleAddOns = []
) {
  const shipment = {
    hasPhysical: false,
    physicalTierCount: 0,
    physicalSupportItemCount: 0,
    physicalAddOnCount: 0,
    physicalUnitCount: 0,
    weightOz: 0,
    lengthIn: 0,
    widthIn: 0,
    heightIn: 0,
    tierIds: [],
    supportItemIds: [],
    addOnIds: [],
    metadataIncomplete: true
  };

  for (const selected of tierSelection?.selectedTiers || []) {
    const tier = selected?.tier;
    if (tier?.category !== 'physical') continue;

    const qty = Number(selected?.qty || 0);
    if (!Number.isInteger(qty) || qty <= 0) {
      return { valid: false, error: `Invalid quantity for tier "${tier?.id || 'unknown'}"` };
    }

    shipment.hasPhysical = true;
    shipment.physicalTierCount += 1;
    shipment.physicalUnitCount += qty;
    shipment.tierIds.push(tier.id);
  }

  const supportItemDefinitions = new Map((storeConfig?.support_items || []).map((item) => [item.id, item]));
  for (const selected of supportItems || []) {
    const supportItemId = typeof selected?.id === 'string' ? selected.id : '';
    const amount = Number(selected?.amount || 0);
    if (!supportItemId || !Number.isInteger(amount) || amount <= 0) {
      return { valid: false, error: `Invalid amount for support item "${supportItemId || 'unknown'}"` };
    }

    const supportItem = supportItemDefinitions.get(supportItemId);
    if (!supportItem) {
      return { valid: false, error: `Support item "${supportItemId}" not found` };
    }
    if (supportItem.category !== 'physical') continue;

    shipment.hasPhysical = true;
    shipment.physicalSupportItemCount += 1;
    shipment.physicalUnitCount += 1;
    shipment.supportItemIds.push(supportItemId);
  }

  for (const selected of bundleAddOns || []) {
    const productId = typeof selected?.productId === 'string' ? selected.productId : '';
    const quantity = Number(selected?.quantity || 0);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
      return { valid: false, error: `Invalid quantity for add-on "${productId || 'unknown'}"` };
    }
    if (selected?.category !== 'physical') continue;

    shipment.hasPhysical = true;
    shipment.physicalAddOnCount += 1;
    shipment.physicalUnitCount += quantity;
    shipment.addOnIds.push(productId);
  }

  return { valid: true, shipment };
}

function isShippingMetadataError(error) {
  const message = String(error || '');
  return message.includes('missing shipping metadata') || message.includes('missing a valid weight');
}

export function buildFallbackShippingQuote(env, destination, shipment) {
  const domestic = destination.country === getShippingOriginCountry(env);
  return {
    shippingCents: shipment.hasPhysical
      ? getShippingFallbackFeeCents(env)
      : 0,
    source: shipment.hasPhysical ? 'fallback_flat_rate' : 'none',
    carrier: shipment.hasPhysical ? 'fallback' : null,
    service: shipment.hasPhysical
      ? (domestic ? 'domestic_ground_fallback' : 'international_ground_fallback')
      : null,
    domestic
  };
}

function qualifiesForManualDomesticRate(shipment, rateId) {
  if (!shipment?.hasPhysical) {
    return false;
  }

  if (rateId !== MANUAL_DOMESTIC_RATE_FIRST_CLASS_FLAT) {
    return false;
  }

  const weightOz = Number(shipment.weightOz || 0);
  const lengthIn = Number(shipment.lengthIn || 0);
  const widthIn = Number(shipment.widthIn || 0);
  const heightIn = Number(shipment.heightIn || 0);
  return Number.isFinite(weightOz) &&
    weightOz > 0 &&
    weightOz <= FIRST_CLASS_FLAT_MAX_WEIGHT_OZ &&
    Number.isFinite(lengthIn) &&
    lengthIn >= FIRST_CLASS_FLAT_MIN_LENGTH_IN &&
    lengthIn <= FIRST_CLASS_FLAT_MAX_LENGTH_IN &&
    Number.isFinite(widthIn) &&
    widthIn >= FIRST_CLASS_FLAT_MIN_WIDTH_IN &&
    widthIn <= FIRST_CLASS_FLAT_MAX_WIDTH_IN &&
    Number.isFinite(heightIn) &&
    heightIn > 0 &&
    heightIn <= FIRST_CLASS_FLAT_MAX_HEIGHT_IN;
}

function buildManualDomesticRateQuote(destination, shipment) {
  const rateId = normalizeManualDomesticRate(shipment?.manualDomesticRate);
  if (!rateId || destination?.country !== 'US' || !qualifiesForManualDomesticRate(shipment, rateId)) {
    return { valid: false, error: 'Manual domestic rate unavailable' };
  }

  if (rateId === MANUAL_DOMESTIC_RATE_FIRST_CLASS_FLAT) {
    const billableWeightOz = Math.min(
      FIRST_CLASS_FLAT_MAX_WEIGHT_OZ,
      Math.max(1, Math.ceil(Number(shipment.weightOz || 0)))
    );
    const shippingCents = FIRST_CLASS_FLAT_RATE_TABLE_CENTS[billableWeightOz];
    if (!Number.isFinite(shippingCents)) {
      return { valid: false, error: 'Manual domestic flat rate unavailable' };
    }

    return {
      valid: true,
      quote: {
        shippingCents,
        source: 'manual_rate_table',
        carrier: 'usps_manual',
        service: 'first_class_flat',
        domestic: true
      }
    };
  }

  return { valid: false, error: 'Manual domestic rate unavailable' };
}

export function buildFreeShippingQuote(env, destination, shipment) {
  return {
    shippingCents: 0,
    source: shipment.hasPhysical ? 'free_shipping' : 'none',
    carrier: null,
    service: shipment.hasPhysical ? 'free_shipping' : null,
    domestic: destination.country === getShippingOriginCountry(env)
  };
}

export function getAvailableShippingOptions(
  env,
  destination = {},
  shipment = { hasPhysical: false },
  baseShippingCents = 0
) {
  if (!shipment?.hasPhysical) {
    return [];
  }

  const domestic = destination.country === getShippingOriginCountry(env);
  const freeShipping = getFreeShippingDefault(env);
  const optionIds = new Set([SHIPPING_OPTION_STANDARD]);

  if (!freeShipping && domestic) {
    optionIds.add(SHIPPING_OPTION_SIGNATURE_REQUIRED);
    optionIds.add(SHIPPING_OPTION_ADULT_SIGNATURE_REQUIRED);
  }

  return Array.from(optionIds).map((id) => ({
    id,
    label: getShippingOptionLabel(id),
    domesticOnly: id !== SHIPPING_OPTION_STANDARD,
    priceDeltaCents: getShippingOptionDeltaCents(id),
    shippingCents: Math.max(0, Number(baseShippingCents) || 0) + getShippingOptionDeltaCents(id)
  }));
}

export function resolveSelectedShippingOption(availableOptions = [], selectedOption, defaultOption = SHIPPING_OPTION_STANDARD) {
  const requested = String(selectedOption || '').trim().toLowerCase();
  if (requested && availableOptions.some((option) => option?.id === requested)) {
    return requested;
  }

  const normalizedDefault = String(defaultOption || SHIPPING_OPTION_STANDARD).trim().toLowerCase();
  if (availableOptions.some((option) => option?.id === normalizedDefault)) {
    return normalizedDefault;
  }

  return availableOptions[0]?.id || SHIPPING_OPTION_STANDARD;
}

export function getSelectedShippingOptionDetails(availableOptions = [], selectedOption, defaultOption = SHIPPING_OPTION_STANDARD) {
  const resolvedId = resolveSelectedShippingOption(availableOptions, selectedOption, defaultOption);
  return availableOptions.find((option) => option?.id === resolvedId) || null;
}

function getShippingOptionLabel(id) {
  switch (id) {
    case SHIPPING_OPTION_SIGNATURE_REQUIRED:
      return 'Signature required';
    case SHIPPING_OPTION_ADULT_SIGNATURE_REQUIRED:
      return 'Adult signature required';
    case SHIPPING_OPTION_STANDARD:
    default:
      return 'Standard';
  }
}

function getShippingOptionDeltaCents(id) {
  switch (id) {
    case SHIPPING_OPTION_SIGNATURE_REQUIRED:
      return USPS_SIGNATURE_REQUIRED_FEE_CENTS;
    case SHIPPING_OPTION_ADULT_SIGNATURE_REQUIRED:
      return USPS_ADULT_SIGNATURE_REQUIRED_FEE_CENTS;
    case SHIPPING_OPTION_STANDARD:
    default:
      return 0;
  }
}

function buildStandardOnlyShippingOptions(shipment, shippingCents) {
  if (!shipment?.hasPhysical) {
    return [];
  }

  return [{
    id: SHIPPING_OPTION_STANDARD,
    label: getShippingOptionLabel(SHIPPING_OPTION_STANDARD),
    domesticOnly: false,
    priceDeltaCents: 0,
    shippingCents: Math.max(0, Number(shippingCents || 0))
  }];
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

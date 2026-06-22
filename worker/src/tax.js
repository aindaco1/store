import SalesTax from 'sales-tax';

import { getSalesTaxRate, getShippingOriginCountry } from './provider-config.js';
import { NM_GRT_STARTER_LOCATIONS } from './tax-data/nm-grt-starter.js';

const TAX_PROVIDERS = ['flat', 'offline_rules', 'external', 'zip_tax', 'nm_grt'];
const DEFAULT_ZIP_TAX_API_BASE = 'https://api.zip-tax.com';
const DEFAULT_NM_GRT_API_BASE = 'https://grt.edacnm.org';
const US_STATE_ZIP_RANGES = [
  ['AL', 35000, 36999],
  ['AK', 99500, 99999],
  ['AZ', 85000, 86599],
  ['AR', 71600, 72999],
  ['CA', 90000, 96199],
  ['CO', 80000, 81699],
  ['CT', 6000, 6999],
  ['DE', 19700, 19999],
  ['DC', 20000, 20099],
  ['DC', 20200, 20599],
  ['FL', 32000, 34999],
  ['GA', 30000, 31999],
  ['GA', 39800, 39999],
  ['HI', 96700, 96899],
  ['ID', 83200, 83899],
  ['IL', 60000, 62999],
  ['IN', 46000, 47999],
  ['IA', 50000, 52899],
  ['KS', 66000, 67999],
  ['KY', 40000, 42799],
  ['LA', 70000, 71599],
  ['ME', 3900, 4999],
  ['MD', 20600, 21999],
  ['MA', 1000, 2799],
  ['MA', 5500, 5599],
  ['MI', 48000, 49999],
  ['MN', 55000, 56799],
  ['MS', 38600, 39799],
  ['MO', 63000, 65899],
  ['MT', 59000, 59999],
  ['NE', 68000, 69399],
  ['NV', 88900, 89999],
  ['NH', 3000, 3899],
  ['NJ', 7000, 8999],
  ['NM', 87000, 88499],
  ['NY', 10000, 14999],
  ['NC', 27000, 28999],
  ['ND', 58000, 58899],
  ['OH', 43000, 45999],
  ['OK', 73000, 74999],
  ['OR', 97000, 97999],
  ['PA', 15000, 19699],
  ['RI', 2800, 2999],
  ['SC', 29000, 29999],
  ['SD', 57000, 57799],
  ['TN', 37000, 38599],
  ['TX', 75000, 79999],
  ['TX', 88500, 88599],
  ['UT', 84000, 84799],
  ['VT', 5000, 5499],
  ['VA', 20100, 20199],
  ['VA', 22000, 24699],
  ['WA', 98000, 99499],
  ['WV', 24700, 26899],
  ['WI', 53000, 54999],
  ['WY', 82000, 83199],
  ['AS', 96799, 96799],
  ['GU', 96910, 96932],
  ['MP', 96950, 96952],
  ['PR', 600, 999],
  ['VI', 800, 899]
];
const STREET_SUFFIX_MAP = new Map([
  ['ALLEY', 'ALY'],
  ['AVENUE', 'AVE'],
  ['AVE', 'AVE'],
  ['BOULEVARD', 'BLVD'],
  ['BLVD', 'BLVD'],
  ['CIRCLE', 'CIR'],
  ['COURT', 'CT'],
  ['DRIVE', 'DR'],
  ['DR', 'DR'],
  ['HIGHWAY', 'HWY'],
  ['LANE', 'LN'],
  ['PLACE', 'PL'],
  ['ROAD', 'RD'],
  ['RD', 'RD'],
  ['STREET', 'ST'],
  ['ST', 'ST'],
  ['TERRACE', 'TER'],
  ['TRAIL', 'TRL'],
  ['WAY', 'WAY']
]);
const STREET_DIRECTIONS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);

export function getTaxProvider(env = {}) {
  const configured = String(env.TAX_PROVIDER || 'flat').trim().toLowerCase();
  if (configured === 'external') {
    return 'zip_tax';
  }
  return TAX_PROVIDERS.includes(configured) ? configured : 'flat';
}

export function normalizeTaxDestination(value) {
  if (!value || typeof value !== 'object') {
    return {
      valid: false,
      destination: null,
      error: 'Billing address is incomplete'
    };
  }

  const destination = {
    country: String(value.country || value.countryCode || '').trim().toUpperCase(),
    postalCode: String(value.postalCode || value.postal_code || '').trim(),
    state: String(value.state || value.province || value.region || value.stateCode || '').trim().toUpperCase(),
    city: String(value.city || '').trim(),
    line1: String(value.line1 || value.address1 || value.street || '').trim(),
    line2: String(value.line2 || value.address2 || '').trim()
  };

  if (!destination.country) {
    return {
      valid: false,
      destination: null,
      error: 'Billing country is required'
    };
  }

  if (!destination.postalCode) {
    return {
      valid: false,
      destination: null,
      error: 'Billing postal code is required'
    };
  }

  return {
    valid: true,
    destination
  };
}

export async function quoteTax(env = {}, {
  subtotalCents = 0,
  shippingCents = 0,
  destination = null
} = {}) {
  const normalizedSubtotal = Math.max(0, Number(subtotalCents) || 0);
  const normalizedShipping = Math.max(0, Number(shippingCents) || 0);
  const normalizedDestination = destination
    ? normalizeTaxDestination(destination)
    : { valid: false, destination: null };
  const provider = getTaxProvider(env);

  if (provider === 'flat') {
    return buildFlatRateQuote(env, {
      subtotalCents: normalizedSubtotal,
      shippingCents: normalizedShipping,
      destination: normalizedDestination.valid ? normalizedDestination.destination : null
    });
  }

  if (!normalizedDestination.valid) {
    throw new Error('Billing address is required to calculate tax');
  }

  if (provider === 'offline_rules') {
    return quoteOfflineRulesTax(env, {
      subtotalCents: normalizedSubtotal,
      shippingCents: normalizedShipping,
      destination: normalizedDestination.destination
    });
  }

  if (provider === 'nm_grt') {
    return quoteNewMexicoGrossReceiptsTax(env, {
      subtotalCents: normalizedSubtotal,
      shippingCents: normalizedShipping,
      destination: normalizedDestination.destination
    });
  }

  return quoteZipTax(env, {
    subtotalCents: normalizedSubtotal,
    shippingCents: normalizedShipping,
    destination: normalizedDestination.destination
  });
}

function buildFlatRateQuote(env = {}, {
  subtotalCents = 0,
  shippingCents = 0,
  destination = null
} = {}) {
  const normalizedSubtotal = Math.max(0, Number(subtotalCents) || 0);
  const normalizedShipping = Math.max(0, Number(shippingCents) || 0);
  const effectiveRate = getSalesTaxRate(env);
  const taxCents = Math.round(normalizedSubtotal * effectiveRate);
  const normalizedDestination = normalizeJurisdictionDestination(destination);

  return {
    provider: 'flat',
    source: 'flat_rate',
    taxCents,
    effectiveRate,
    taxableSubtotalCents: normalizedSubtotal,
    taxableShippingCents: 0,
    shippingTaxed: false,
    destination: normalizedDestination,
    jurisdiction: normalizedDestination
      ? {
          country: normalizedDestination.country,
          state: normalizedDestination.state || '',
          postalCode: normalizedDestination.postalCode || ''
        }
      : null,
    shippingCents: normalizedShipping,
    breakdown: [{
      label: 'sales_tax',
      rate: effectiveRate,
      taxableSubtotalCents: normalizedSubtotal,
      taxableShippingCents: 0,
      taxCents
    }]
  };
}

async function quoteOfflineRulesTax(env = {}, {
  subtotalCents = 0,
  shippingCents = 0,
  destination
} = {}) {
  const normalizedDestination = normalizeJurisdictionDestination(destination);
  const originCountry = String(env.TAX_ORIGIN_COUNTRY || getShippingOriginCountry(env) || 'US').trim().toUpperCase();
  const useRegionalOrigin = normalizeBooleanish(env.TAX_USE_REGIONAL_ORIGIN) === true;

  SalesTax.setTaxOriginCountry(originCountry, useRegionalOrigin);
  const result = await SalesTax.getSalesTax(
    normalizedDestination.country,
    normalizedDestination.state || undefined
  );

  const directCharge = result?.charge?.direct !== false;
  const effectiveRate = directCharge ? Math.max(0, Number(result?.rate) || 0) : 0;
  const shippingTaxed = false;
  const taxableShippingCents = shippingTaxed ? Math.max(0, Number(shippingCents) || 0) : 0;
  const taxableSubtotalCents = Math.max(0, Number(subtotalCents) || 0);
  const taxBaseCents = taxableSubtotalCents + taxableShippingCents;
  const taxCents = Math.round(taxBaseCents * effectiveRate);

  return {
    provider: 'offline_rules',
    source: 'offline_rules',
    taxCents,
    effectiveRate,
    taxableSubtotalCents,
    taxableShippingCents,
    shippingTaxed,
    destination: normalizedDestination,
    jurisdiction: buildOfflineJurisdiction(result, normalizedDestination),
    shippingCents: Math.max(0, Number(shippingCents) || 0),
    breakdown: Array.isArray(result?.details) && result.details.length > 0
      ? result.details.map((detail) => ({
          label: String(detail?.type || result?.type || 'tax').trim().toLowerCase() || 'tax',
          rate: Math.max(0, Number(detail?.rate ?? effectiveRate) || 0),
          taxableSubtotalCents,
          taxableShippingCents,
          taxCents: Math.round(taxBaseCents * (Math.max(0, Number(detail?.rate ?? effectiveRate) || 0)))
        }))
      : [{
          label: String(result?.type || 'tax').trim().toLowerCase() || 'tax',
          rate: effectiveRate,
          taxableSubtotalCents,
          taxableShippingCents,
          taxCents
        }]
  };
}

async function quoteZipTax(env = {}, {
  subtotalCents = 0,
  shippingCents = 0,
  destination
} = {}) {
  const normalizedDestination = normalizeJurisdictionDestination(destination);

  if (normalizedDestination.country !== 'US' && normalizedDestination.country !== 'CA') {
    return quoteOfflineRulesTax(env, {
      subtotalCents,
      shippingCents,
      destination: normalizedDestination
    });
  }

  const apiKey = String(env.ZIP_TAX_API_KEY || env.TAX_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('ZIP_TAX_API_KEY is required when TAX_PROVIDER=zip_tax');
  }

  const apiBase = String(env.ZIP_TAX_API_BASE || DEFAULT_ZIP_TAX_API_BASE).trim().replace(/\/+$/, '');
  const address = buildZipTaxAddress(normalizedDestination);
  const response = await fetch(
    `${apiBase}/request/v60?address=${encodeURIComponent(address)}&format=json&addressDetailExtended=true`,
    {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey
      }
    }
  );

  const payload = await response.json().catch(() => ({}));
  const responseCode = Number(payload?.metadata?.response?.code || 0);
  if (!response.ok || responseCode !== 100) {
    const message = String(
      payload?.metadata?.response?.message ||
      payload?.message ||
      'Tax lookup failed'
    ).trim();
    throw new Error(message || 'Tax lookup failed');
  }

  const salesSummary = Array.isArray(payload?.taxSummaries)
    ? payload.taxSummaries.find((summary) => String(summary?.taxType || '').trim().toUpperCase() === 'SALES_TAX')
    : null;
  const effectiveRate = Math.max(0, Number(salesSummary?.rate) || 0);
  const shippingTaxed = String(payload?.shipping?.taxable || '').trim().toUpperCase() === 'Y';
  const taxableSubtotalCents = Math.max(0, Number(subtotalCents) || 0);
  const taxableShippingCents = shippingTaxed ? Math.max(0, Number(shippingCents) || 0) : 0;
  const taxBaseCents = taxableSubtotalCents + taxableShippingCents;
  const taxCents = Math.round(taxBaseCents * effectiveRate);

  return {
    provider: 'zip_tax',
    source: 'zip_tax_v60',
    taxCents,
    effectiveRate,
    taxableSubtotalCents,
    taxableShippingCents,
    shippingTaxed,
    destination: normalizedDestination,
    jurisdiction: buildZipTaxJurisdiction(payload, normalizedDestination),
    shippingCents: Math.max(0, Number(shippingCents) || 0),
    breakdown: Array.isArray(salesSummary?.displayRates) && salesSummary.displayRates.length > 0
      ? salesSummary.displayRates.map((entry) => ({
          label: String(entry?.name || 'tax').trim().toLowerCase() || 'tax',
          rate: Math.max(0, Number(entry?.rate) || 0),
          taxableSubtotalCents,
          taxableShippingCents,
          taxCents: Math.round(taxBaseCents * (Math.max(0, Number(entry?.rate) || 0)))
        }))
      : [{
          label: 'sales_tax',
          rate: effectiveRate,
          taxableSubtotalCents,
          taxableShippingCents,
          taxCents
        }]
  };
}

async function quoteNewMexicoGrossReceiptsTax(env = {}, {
  subtotalCents = 0,
  shippingCents = 0,
  destination
} = {}) {
  const normalizedDestination = normalizeJurisdictionDestination(destination);
  const isNewMexicoDestination = normalizedDestination?.country === 'US' && (
    normalizedDestination?.state === 'NM' ||
    isNewMexicoPostalCode(normalizedDestination?.postalCode)
  );
  if (!isNewMexicoDestination) {
    return quoteOfflineRulesTax(env, {
      subtotalCents,
      shippingCents,
      destination: inferUsStateFromPostalCode(normalizedDestination)
    });
  }
  const nmDestination = normalizedDestination.state === 'NM'
    ? normalizedDestination
    : { ...normalizedDestination, state: 'NM' };

  const starterMatch = findNmStarterLocation(nmDestination);
  const parsedStreet = parseStreetAddress(nmDestination?.line1 || '');
  if (parsedStreet && nmDestination.city && nmDestination.postalCode) {
    try {
      return await quoteNmGrtApi(env, {
        subtotalCents,
        shippingCents,
        destination: nmDestination,
        parsedStreet,
        starterMatch
      });
    } catch (_error) {
      if (starterMatch) {
        return buildNmStarterQuote({
          subtotalCents,
          shippingCents,
          destination: nmDestination,
          starterMatch
        });
      }
    }
  }

  if (starterMatch) {
    return buildNmStarterQuote({
      subtotalCents,
      shippingCents,
      destination: nmDestination,
      starterMatch
    });
  }

  return buildNmFallbackFlatQuote(env, {
    subtotalCents,
    shippingCents,
    destination: nmDestination
  });
}

async function quoteNmGrtApi(env = {}, {
  subtotalCents = 0,
  shippingCents = 0,
  destination,
  parsedStreet,
  starterMatch = null
} = {}) {
  const apiBase = String(env.NM_GRT_API_BASE || DEFAULT_NM_GRT_API_BASE).trim().replace(/\/+$/, '');
  const params = new URLSearchParams({
    street_number: parsedStreet.streetNumber,
    street_name: parsedStreet.streetName,
    city: destination.city,
    zipcode: destination.postalCode
  });
  if (parsedStreet.preDirection) params.set('pre_direction', parsedStreet.preDirection);
  if (parsedStreet.streetSuffix) params.set('street_suffix', parsedStreet.streetSuffix);
  if (parsedStreet.postDirection) params.set('street_post_directional', parsedStreet.postDirection);
  if (starterMatch?.county) params.set('county', starterMatch.county);

  const response = await fetch(`${apiBase}/api/by_address?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });
  const payload = await response.json().catch(() => ({}));
  const result = Array.isArray(payload?.results) ? payload.results[0] : null;
  if (!response.ok || !result || result.success !== true) {
    throw new Error('New Mexico GRT lookup failed');
  }

  const effectiveRate = Math.max(0, Number(result.tax_rate) || 0) / 100;
  const taxableSubtotalCents = Math.max(0, Number(subtotalCents) || 0);
  const taxCents = Math.round(taxableSubtotalCents * effectiveRate);

  return {
    provider: 'nm_grt',
    source: `nm_grt_api_${normalizeProviderSource(result.source || 'free_api')}`,
    taxCents,
    effectiveRate,
    taxableSubtotalCents,
    taxableShippingCents: 0,
    shippingTaxed: false,
    locationCode: String(result.location_code || '').trim() || null,
    destination,
    jurisdiction: {
      country: 'US',
      state: 'NM',
      postalCode: destination.postalCode || '',
      county: String(result.county || starterMatch?.county || '').trim(),
      city: destination.city || '',
      locationCode: String(result.location_code || '').trim() || null
    },
    shippingCents: Math.max(0, Number(shippingCents) || 0),
    breakdown: [{
      label: 'nm_gross_receipts_tax',
      rate: effectiveRate,
      taxableSubtotalCents,
      taxableShippingCents: 0,
      taxCents
    }]
  };
}

function buildNmStarterQuote({
  subtotalCents = 0,
  shippingCents = 0,
  destination,
  starterMatch
} = {}) {
  const taxableSubtotalCents = Math.max(0, Number(subtotalCents) || 0);
  const effectiveRate = Math.max(0, Number(starterMatch?.effectiveRate) || 0);
  const taxCents = Math.round(taxableSubtotalCents * effectiveRate);

  return {
    provider: 'nm_grt',
    source: 'nm_grt_starter_dataset',
    taxCents,
    effectiveRate,
    taxableSubtotalCents,
    taxableShippingCents: 0,
    shippingTaxed: false,
    locationCode: starterMatch?.locationCode || null,
    destination,
    jurisdiction: {
      country: 'US',
      state: 'NM',
      postalCode: destination?.postalCode || '',
      county: starterMatch?.county || '',
      city: starterMatch?.city || destination?.city || '',
      locationCode: starterMatch?.locationCode || null
    },
    shippingCents: Math.max(0, Number(shippingCents) || 0),
    breakdown: [{
      label: 'nm_gross_receipts_tax',
      rate: effectiveRate,
      taxableSubtotalCents,
      taxableShippingCents: 0,
      taxCents
    }]
  };
}

function buildNmFallbackFlatQuote(env = {}, {
  subtotalCents = 0,
  shippingCents = 0,
  destination = null
} = {}) {
  const flatQuote = buildFlatRateQuote(env, { subtotalCents, shippingCents, destination });
  return {
    ...flatQuote,
    provider: 'nm_grt',
    source: 'nm_grt_fallback_flat'
  };
}

function buildOfflineJurisdiction(result, destination) {
  return {
    country: destination?.country || '',
    state: destination?.state || '',
    postalCode: destination?.postalCode || '',
    type: String(result?.area || '').trim().toLowerCase() || 'national'
  };
}

function buildZipTaxJurisdiction(payload, destination) {
  const address = payload?.addressDetail?.address || {};
  return {
    country: destination?.country || String(address.countryCode || '').trim().toUpperCase(),
    state: String(address.stateCode || destination?.state || '').trim().toUpperCase(),
    postalCode: String(address.postalCode || destination?.postalCode || '').trim(),
    county: String(address.county || '').trim(),
    city: String(address.city || '').trim(),
    incorporated: String(payload?.addressDetail?.incorporated || '').trim().toLowerCase() === 'true'
  };
}

function buildZipTaxAddress(destination) {
  const parts = [
    destination?.line1,
    destination?.line2,
    destination?.city,
    destination?.state,
    destination?.postalCode,
    destination?.country
  ].filter(Boolean);
  return parts.join(', ');
}

function normalizeJurisdictionDestination(destination) {
  if (!destination || typeof destination !== 'object') {
    return null;
  }

  return {
    country: String(destination.country || '').trim().toUpperCase(),
    postalCode: String(destination.postalCode || destination.postal_code || '').trim(),
    state: String(destination.state || destination.province || '').trim().toUpperCase(),
    city: String(destination.city || '').trim(),
    line1: String(destination.line1 || destination.address1 || '').trim(),
    line2: String(destination.line2 || destination.address2 || '').trim()
  };
}

function isNewMexicoPostalCode(postalCode = '') {
  const match = String(postalCode || '').trim().match(/^(\d{5})/);
  if (!match) return false;
  const value = Number(match[1]);
  return Number.isInteger(value) && value >= 87000 && value <= 88499;
}

function inferUsStateFromPostalCode(destination) {
  const normalizedDestination = normalizeJurisdictionDestination(destination);
  if (!normalizedDestination || normalizedDestination.country !== 'US' || normalizedDestination.state) {
    return normalizedDestination;
  }

  const match = normalizedDestination.postalCode.match(/^(\d{5})/);
  if (!match) {
    return normalizedDestination;
  }

  const zip = Number(match[1]);
  const range = US_STATE_ZIP_RANGES.find(([_state, start, end]) => zip >= start && zip <= end);
  return range
    ? { ...normalizedDestination, state: range[0] }
    : normalizedDestination;
}

function normalizeBooleanish(value) {
  if (value === true || value === false) return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
}

function findNmStarterLocation(destination) {
  const normalizedCity = normalizeNmCityName(destination?.city || '');
  const normalizedPostalCode = String(destination?.postalCode || '').trim();

  const exactCityMatch = NM_GRT_STARTER_LOCATIONS.find((entry) => {
    const aliases = Array.isArray(entry.cityAliases) ? entry.cityAliases : [];
    return entry.postalCodes.includes(normalizedPostalCode) &&
      (aliases.includes(normalizedCity) || normalizeNmCityName(entry.city) === normalizedCity);
  });
  if (exactCityMatch) return exactCityMatch;

  const postalMatches = NM_GRT_STARTER_LOCATIONS.filter((entry) => entry.postalCodes.includes(normalizedPostalCode));
  return postalMatches.length === 1 ? postalMatches[0] : null;
}

function normalizeNmCityName(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function parseStreetAddress(line1) {
  const trimmed = String(line1 || '').trim();
  const match = trimmed.match(/^(\d+)\s+(.+)$/);
  if (!match) return null;

  const streetNumber = match[1];
  const tokens = match[2].trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let preDirection = '';
  let postDirection = '';
  let streetSuffix = '';

  if (tokens.length > 1 && STREET_DIRECTIONS.has(tokens[0].toUpperCase())) {
    preDirection = tokens.shift().toUpperCase();
  }
  if (tokens.length > 1 && STREET_DIRECTIONS.has(tokens[tokens.length - 1].toUpperCase())) {
    postDirection = tokens.pop().toUpperCase();
  }
  if (tokens.length > 1) {
    const suffixCandidate = normalizeStreetSuffix(tokens[tokens.length - 1]);
    if (suffixCandidate) {
      streetSuffix = suffixCandidate;
      tokens.pop();
    }
  }

  const streetName = tokens.join(' ').trim();
  if (!streetName) return null;

  return {
    streetNumber,
    preDirection,
    streetName,
    streetSuffix,
    postDirection
  };
}

function normalizeStreetSuffix(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/\./g, '');
  return STREET_SUFFIX_MAP.get(normalized) || '';
}

function normalizeProviderSource(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'free_api';
}

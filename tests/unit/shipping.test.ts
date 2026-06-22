import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetShippingRuntimeStateForTests,
  buildFallbackShippingQuote,
  getAvailableShippingOptions,
  normalizeShippingDestination,
  quoteStoreShipment,
  summarizeStoreShipmentSelection
} from '../../worker/src/shipping.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetShippingRuntimeStateForTests();
});

const physicalPosterTier = {
  selectedTiers: [
    {
      qty: 2,
      tier: {
        id: 'fronteras-poster',
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
    },
    {
      qty: 1,
      tier: {
        id: 'digital-download',
        category: 'digital'
      }
    }
  ]
};

const stickerAddOn = {
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

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('shipping utilities', () => {
  it('normalizes shipping destination input', () => {
    expect(normalizeShippingDestination({ country: 'us', postalCode: '80205 ' })).toEqual({
      valid: true,
      destination: {
        country: 'US',
        postalCode: '80205'
      }
    });
  });

  it('aggregates quantity-aware Store shipments', () => {
    const result = summarizeStoreShipmentSelection(
      physicalPosterTier,
      [],
      null,
      [stickerAddOn]
    );

    expect(result).toEqual({
      valid: true,
      shipment: {
        hasPhysical: true,
        physicalTierCount: 1,
        physicalSupportItemCount: 0,
        physicalAddOnCount: 1,
        physicalUnitCount: 4,
        weightOz: 15.5,
        lengthIn: 18,
        widthIn: 4,
        heightIn: 3.65,
        tierIds: ['fronteras-poster'],
        supportItemIds: [],
        addOnIds: ['dust-wave-sticker']
      }
    });
  });

  it('rejects a physical Store item without shipping metadata', () => {
    expect(summarizeStoreShipmentSelection({
      selectedTiers: [
        {
          qty: 1,
          tier: {
            id: 'fronteras-shirt',
            category: 'physical'
          }
        }
      ]
    })).toEqual({
      valid: false,
      error: 'Physical tier "fronteras-shirt" is missing shipping metadata'
    });
  });

  it('uses the Store fallback rate when USPS is unavailable', async () => {
    const result = await quoteStoreShipment(
      {
        SHIPPING_ORIGIN_COUNTRY: 'US',
        SHIPPING_FALLBACK_FLAT_RATE: '10.00',
        USPS_ENABLED: 'false'
      },
      physicalPosterTier,
      { country: 'US', postalCode: '80205' }
    );

    expect(result).toEqual({
      valid: true,
      shipment: {
        hasPhysical: true,
        physicalTierCount: 1,
        physicalSupportItemCount: 0,
        physicalAddOnCount: 0,
        physicalUnitCount: 2,
        weightOz: 13,
        lengthIn: 18,
        widthIn: 3,
        heightIn: 3.5,
        tierIds: ['fronteras-poster'],
        supportItemIds: [],
        addOnIds: []
      },
      availableOptions: [
        { id: 'standard', label: 'Standard', domesticOnly: false, priceDeltaCents: 0, shippingCents: 1000 }
      ],
      defaultOption: 'standard',
      selectedOption: 'standard',
      selectedOptionDetails: {
        id: 'standard',
        label: 'Standard',
        domesticOnly: false,
        priceDeltaCents: 0,
        shippingCents: 1000
      },
      quote: {
        shippingCents: 1000,
        source: 'fallback_flat_rate',
        carrier: 'fallback',
        service: 'domestic_ground_fallback',
        domestic: true
      }
    });
    expect(result).not.toHaveProperty('campaignSlug');
  });

  it('falls back cleanly when metadata is incomplete', async () => {
    const result = await quoteStoreShipment(
      {
        SHIPPING_ORIGIN_COUNTRY: 'US',
        SHIPPING_FALLBACK_FLAT_RATE: '7.50',
        USPS_ENABLED: 'false'
      },
      {
        selectedTiers: [
          {
            qty: 1,
            tier: {
              id: 'mystery-physical',
              category: 'physical'
            }
          }
        ]
      },
      { country: 'US', postalCode: '80205' }
    );

    expect(result.quote).toEqual({
      shippingCents: 750,
      source: 'fallback_missing_metadata',
      carrier: 'fallback',
      service: 'domestic_metadata_fallback',
      domestic: true
    });
    expect(result.shipment).toMatchObject({
      hasPhysical: true,
      metadataIncomplete: true,
      tierIds: ['mystery-physical']
    });
  });

  it('builds Store fallback quotes from global shipping settings', () => {
    expect(buildFallbackShippingQuote(
      { SHIPPING_ORIGIN_COUNTRY: 'US', SHIPPING_FALLBACK_FLAT_RATE: '10.00' },
      { country: 'CA', postalCode: 'M5V 2T6' },
      { hasPhysical: true }
    )).toEqual({
      shippingCents: 1000,
      source: 'fallback_flat_rate',
      carrier: 'fallback',
      service: 'international_ground_fallback',
      domestic: false
    });
  });

  it('offers signature options only for paid domestic physical shipments', () => {
    expect(getAvailableShippingOptions(
      { SHIPPING_ORIGIN_COUNTRY: 'US' },
      { country: 'US', postalCode: '80205' },
      { hasPhysical: true },
      675
    )).toEqual([
      { id: 'standard', label: 'Standard', domesticOnly: false, priceDeltaCents: 0, shippingCents: 675 },
      { id: 'signature_required', label: 'Signature required', domesticOnly: true, priceDeltaCents: 395, shippingCents: 1070 },
      { id: 'adult_signature_required', label: 'Adult signature required', domesticOnly: true, priceDeltaCents: 970, shippingCents: 1645 }
    ]);

    expect(getAvailableShippingOptions(
      { SHIPPING_ORIGIN_COUNTRY: 'US' },
      { country: 'CA', postalCode: 'M5V 2T6' },
      { hasPhysical: true },
      1800
    )).toEqual([
      { id: 'standard', label: 'Standard', domesticOnly: false, priceDeltaCents: 0, shippingCents: 1800 }
    ]);

    expect(getAvailableShippingOptions(
      { SHIPPING_ORIGIN_COUNTRY: 'US', FREE_SHIPPING_DEFAULT: 'true' },
      { country: 'US', postalCode: '80205' },
      { hasPhysical: true },
      0
    )).toEqual([
      { id: 'standard', label: 'Standard', domesticOnly: false, priceDeltaCents: 0, shippingCents: 0 }
    ]);
  });

  it('honors free shipping defaults without exposing paid signature options', async () => {
    const result = await quoteStoreShipment(
      {
        SHIPPING_ORIGIN_COUNTRY: 'US',
        FREE_SHIPPING_DEFAULT: 'true',
        USPS_ENABLED: 'true',
        USPS_CLIENT_ID: 'client',
        USPS_CLIENT_SECRET: 'secret'
      },
      physicalPosterTier,
      { country: 'US', postalCode: '80205' },
      [],
      'signature_required'
    );

    expect(result.quote).toEqual({
      shippingCents: 0,
      source: 'free_shipping',
      carrier: null,
      service: 'free_shipping',
      domestic: true
    });
    expect(result.availableOptions).toEqual([
      { id: 'standard', label: 'Standard', domesticOnly: false, priceDeltaCents: 0, shippingCents: 0 }
    ]);
    expect(result.selectedOption).toBe('standard');
  });

  it('uses the manual first-class flat rate table before calling USPS', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('USPS should not be called for a manual domestic flat');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await quoteStoreShipment(
      {
        SHIPPING_ORIGIN_COUNTRY: 'US',
        USPS_ENABLED: 'true',
        USPS_CLIENT_ID: 'client',
        USPS_CLIENT_SECRET: 'secret'
      },
      {
        selectedTiers: [
          {
            qty: 1,
            tier: {
              id: 'sticker-sheet',
              category: 'physical',
              shipping: {
                weight_oz: 1,
                length_in: 12,
                width_in: 8,
                height_in: 0.1,
                manual_domestic_rate: 'FIRST_CLASS_FLAT'
              }
            }
          }
        ]
      },
      { country: 'US', postalCode: '80205' }
    );

    expect(result.quote).toEqual({
      shippingCents: 163,
      source: 'manual_rate_table',
      carrier: 'usps_manual',
      service: 'first_class_flat',
      domestic: true
    });
    expect(result.availableOptions).toEqual([
      { id: 'standard', label: 'Standard', domesticOnly: false, priceDeltaCents: 0, shippingCents: 163 }
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses USPS live rates when Store credentials are configured', async () => {
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === 'https://apis-live.usps.test/oauth2/v3/token') {
        expect(init.method).toBe('POST');
        return jsonResponse({ access_token: 'token', expires_in: 3600 });
      }

      if (url === 'https://apis-live.usps.test/prices/v3/base-rates/search') {
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer token');
        expect(JSON.parse(init.body)).toMatchObject({
          originZIPCode: '87102',
          destinationZIPCode: '80205',
          mailClass: 'USPS_GROUND_ADVANTAGE'
        });
        return jsonResponse({
          totalBasePrice: 6.75,
          rates: [
            {
              mailClass: 'USPS_GROUND_ADVANTAGE',
              price: 6.75
            }
          ]
        });
      }

      throw new Error(`Unexpected USPS request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await quoteStoreShipment(
      {
        USPS_ENABLED: 'true',
        USPS_CLIENT_ID: 'client',
        USPS_CLIENT_SECRET: 'secret',
        USPS_API_BASE: 'https://apis-live.usps.test',
        SHIPPING_ORIGIN_ZIP: '87102',
        SHIPPING_ORIGIN_COUNTRY: 'US'
      },
      physicalPosterTier,
      { country: 'US', postalCode: '80205' },
      [],
      'signature_required'
    );

    expect(result.quote).toEqual({
      shippingCents: 1070,
      source: 'usps_live',
      carrier: 'usps',
      service: 'usps_ground_advantage',
      domestic: true
    });
    expect(result.selectedOptionDetails).toEqual({
      id: 'signature_required',
      label: 'Signature required',
      domesticOnly: true,
      priceDeltaCents: 395,
      shippingCents: 1070
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTaxProvider, normalizeTaxDestination, quoteTax } from '../../worker/src/tax.js';

describe('tax engine scaffold', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to the flat provider when unset', () => {
    expect(getTaxProvider({})).toBe('flat');
    expect(getTaxProvider({ TAX_PROVIDER: 'weird' })).toBe('flat');
    expect(getTaxProvider({ TAX_PROVIDER: 'external' })).toBe('zip_tax');
  });

  it('quotes flat tax using the configured sales tax rate', async () => {
    const quote = await quoteTax({ SALES_TAX_RATE: '0.05' }, {
      subtotalCents: 2000,
      shippingCents: 300,
      destination: {
        country: 'US',
        postalCode: '80205'
      }
    });

    expect(quote).toMatchObject({
      provider: 'flat',
      taxCents: 100,
      effectiveRate: 0.05,
      taxableSubtotalCents: 2000,
      taxableShippingCents: 0,
      shippingTaxed: false,
      shippingCents: 300,
      destination: {
        country: 'US',
        postalCode: '80205'
      }
    });
  });

  it('quotes offline rules for international VAT', async () => {
    const quote = await quoteTax({ TAX_PROVIDER: 'offline_rules', TAX_ORIGIN_COUNTRY: 'US' }, {
      subtotalCents: 2000,
      destination: {
        country: 'DE',
        postalCode: '10115'
      }
    });

    expect(quote).toMatchObject({
      provider: 'offline_rules',
      source: 'offline_rules',
      taxCents: 380,
      effectiveRate: 0.19,
      destination: {
        country: 'DE',
        postalCode: '10115'
      }
    });
  });

  it('quotes zip-tax lookups with shipping taxability', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      metadata: {
        version: 'v60',
        response: {
          code: 100,
          message: 'Successful API Request.'
        }
      },
      shipping: {
        taxable: 'Y',
        description: 'Freight taxable'
      },
      taxSummaries: [
        {
          taxType: 'SALES_TAX',
          rate: 0.0875,
          displayRates: [
            { name: 'State', rate: 0.04 },
            { name: 'County', rate: 0.0175 },
            { name: 'City', rate: 0.03 }
          ]
        }
      ],
      addressDetail: {
        normalizedAddress: '123 Main St, Denver, CO 80205-1234, United States',
        incorporated: 'true',
        address: {
          countryCode: 'US',
          stateCode: 'CO',
          county: 'Denver',
          city: 'Denver',
          postalCode: '80205-1234'
        }
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as typeof fetch);

    const quote = await quoteTax({
      TAX_PROVIDER: 'zip_tax',
      ZIP_TAX_API_KEY: 'zip_tax_test_key'
    }, {
      subtotalCents: 2000,
      shippingCents: 300,
      destination: {
        country: 'US',
        state: 'CO',
        postalCode: '80205'
      }
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.zip-tax.com/request/v60?address='),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-API-KEY': 'zip_tax_test_key'
        })
      })
    );
    expect(quote).toMatchObject({
      provider: 'zip_tax',
      source: 'zip_tax_v60',
      effectiveRate: 0.0875,
      shippingTaxed: true,
      taxableShippingCents: 300,
      taxCents: 201,
      jurisdiction: {
        state: 'CO',
        county: 'Denver',
        city: 'Denver'
      }
    });
  });

  it('uses offline state rules for non-New Mexico ZIP-only destinations while nm_grt is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const quote = await quoteTax({
      TAX_PROVIDER: 'nm_grt'
    }, {
      subtotalCents: 2500,
      shippingCents: 955,
      destination: {
        country: 'US',
        postalCode: '90210'
      }
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(quote).toMatchObject({
      provider: 'offline_rules',
      source: 'offline_rules',
      effectiveRate: 0.0825,
      taxableSubtotalCents: 2500,
      taxableShippingCents: 0,
      shippingTaxed: false,
      taxCents: 206,
      shippingCents: 955,
      destination: {
        country: 'US',
        state: 'CA',
        postalCode: '90210'
      },
      jurisdiction: {
        country: 'US',
        state: 'CA',
        postalCode: '90210',
        type: 'national'
      }
    });
  });

  it('quotes vendored New Mexico GRT starter data by city and postal code', async () => {
    const quote = await quoteTax({
      TAX_PROVIDER: 'nm_grt',
      SALES_TAX_RATE: '0.05'
    }, {
      subtotalCents: 2000,
      destination: {
        country: 'US',
        state: 'NM',
        city: 'Santa Fe',
        postalCode: '87501'
      }
    });

    expect(quote).toMatchObject({
      provider: 'nm_grt',
      source: 'nm_grt_starter_dataset',
      taxCents: 164,
      effectiveRate: 0.081875,
      locationCode: '01-123',
      jurisdiction: {
        state: 'NM',
        city: 'Santa Fe',
        locationCode: '01-123'
      }
    });
  });

  it('treats New Mexico ZIP-only destinations as New Mexico GRT fallback quotes', async () => {
    const quote = await quoteTax({
      TAX_PROVIDER: 'nm_grt',
      SALES_TAX_RATE: '0.07625'
    }, {
      subtotalCents: 2000,
      destination: {
        country: 'US',
        postalCode: '87120'
      }
    });

    expect(quote).toMatchObject({
      provider: 'nm_grt',
      source: 'nm_grt_fallback_flat',
      taxCents: 153,
      effectiveRate: 0.07625,
      destination: {
        country: 'US',
        state: 'NM',
        postalCode: '87120'
      }
    });
  });

  it('uses the free New Mexico API when a full street address is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      results: [
        {
          success: true,
          tax_rate: '8.6875',
          location_code: '17-215',
          source: 'Intuit',
          county: 'Rio Arriba'
        }
      ]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as typeof fetch);

    const quote = await quoteTax({
      TAX_PROVIDER: 'nm_grt',
      NM_GRT_API_BASE: 'https://grt.edacnm.org'
    }, {
      subtotalCents: 2000,
      destination: {
        country: 'US',
        state: 'NM',
        city: 'Española',
        postalCode: '87532',
        line1: '123 Main St'
      }
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://grt.edacnm.org/api/by_address?'),
      expect.objectContaining({
        method: 'GET'
      })
    );
    expect(quote).toMatchObject({
      provider: 'nm_grt',
      source: 'nm_grt_api_intuit',
      effectiveRate: 0.086875,
      taxCents: 174,
      locationCode: '17-215'
    });
  });

  it('normalizes the minimal billing destination shape', () => {
    expect(normalizeTaxDestination({
      country: 'us',
      postal_code: '80205',
      state: 'co'
    })).toMatchObject({
      valid: true,
      destination: {
        country: 'US',
        postalCode: '80205',
        state: 'CO'
      }
    });
  });

  it('rejects incomplete billing destinations', () => {
    expect(normalizeTaxDestination({ country: 'US' })).toMatchObject({
      valid: false,
      error: 'Billing postal code is required'
    });
    expect(normalizeTaxDestination({ country: '<script>', postalCode: '80205' })).toMatchObject({
      valid: false,
      error: 'Billing country must use a two-letter code'
    });
    expect(normalizeTaxDestination({ country: 'US', postalCode: "'; DROP TABLE orders; --" })).toMatchObject({
      valid: false,
      error: 'Billing postal code is invalid'
    });
  });
});

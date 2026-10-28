import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTaxProvider, normalizeTaxDestination, quoteTax } from '../../worker/src/tax.js';

describe('tax engine scaffold', () => {
  beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-27T12:00:00Z')); });
  afterEach(() => {
    vi.restoreAllMocks();
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

  it('uses bundled local rates for covered non-New Mexico ZIP-only destinations', async () => {
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
      provider: 'open_us',
      source: 'opensalestax_zip_snapshot',
      effectiveRate: 0.105,
      taxableSubtotalCents: 2500,
      taxableShippingCents: 0,
      shippingTaxed: false,
      taxCents: 263,
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
        type: 'zip_local'
      }
    });
  });

  it.each(['', 'New York', 'NY'])('resolves edited ZIP 10467 before selecting a tax provider with state "%s"', async (state) => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('Unexpected NM lookup')));
    vi.stubGlobal('fetch', fetchMock);
    const quote = await quoteTax({ TAX_PROVIDER: 'nm_grt', TAX_ORIGIN_COUNTRY: 'US', TAX_USE_REGIONAL_ORIGIN: 'true' }, {
      subtotalCents: 2000,
      destination: { country: 'US', postalCode: '10467', state, city: 'Corrales', line1: '123 Test Street' }
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(quote).toMatchObject({ provider: 'open_us', taxCents: 178, effectiveRate: 0.08875, estimated: true, coverage: 'zip_local', destination: { postalCode: '10467', state: 'NY' } });
  });

  it('keeps a labeled offline estimate for unsupported or stale local coverage', async () => {
    const uncovered = await quoteTax({ TAX_PROVIDER: 'nm_grt' }, {
      subtotalCents: 2000, destination: { country: 'US', postalCode: '80205', state: 'CO' }
    });
    expect(uncovered).toMatchObject({ provider: 'offline_rules', estimated: true, coverage: 'state_only', destination: { state: 'CO' } });
    vi.mocked(Date.now).mockReturnValue(Date.parse('2027-01-01T12:00:00Z'));
    const stale = await quoteTax({ TAX_PROVIDER: 'nm_grt' }, {
      subtotalCents: 2000, destination: { country: 'US', postalCode: '10467', state: 'NY' }
    });
    expect(stale).toMatchObject({ provider: 'offline_rules', estimated: true, coverage: 'state_only', taxCents: 80 });
  });

  it.each([10, 2000, 1999])('keeps rounded jurisdiction cents equal to the combined tax for %i cents', async (subtotalCents) => {
    const quote = await quoteTax({ TAX_PROVIDER: 'offline_rules' }, {
      subtotalCents, destination: { country: 'US', postalCode: '10467' }
    });
    expect(quote.breakdown.reduce((sum, entry) => sum + entry.taxCents, 0)).toBe(quote.taxCents);
    expect(quote.taxCents).toBe(Math.round(subtotalCents * 0.08875));
  });

  it.each([
    { postalCode: '10467-1234', state: 'New York', expectedState: 'NY', provider: 'open_us' },
    { postalCode: '87048', state: 'NM', expectedState: 'NM', provider: 'nm_grt' },
    { postalCode: '96799', state: 'AS', expectedState: 'AS', provider: 'offline_rules' },
    { postalCode: '06390', state: '', expectedState: 'NY', provider: 'open_us' },
    { postalCode: '00501', state: 'NY', expectedState: 'NY', provider: 'offline_rules' }
  ])('resolves ZIP $postalCode without losing overlapping or unmapped state codes', async ({ postalCode, state, expectedState, provider }) => {
    const quote = await quoteTax({ TAX_PROVIDER: 'nm_grt', SALES_TAX_RATE: '0.07625' }, {
      subtotalCents: 2000,
      destination: { country: 'US', postalCode, state }
    });
    expect(quote).toMatchObject({ provider, destination: { postalCode, state: expectedState } });
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

  it('uses the address provider in a Worker-compatible runtime instead of the flat fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      if (!['follow', 'manual'].includes(init?.redirect)) {
        throw new TypeError('Cloudflare fetch only supports follow or manual redirects');
      }
      return new Response(JSON.stringify({ results: [{
        success: true, tax_rate: '7.5625', location_code: '29-504', source: 'Intuit'
      }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch);

    const quote = await quoteTax({ TAX_PROVIDER: 'nm_grt', SALES_TAX_RATE: '0.07625' }, {
      subtotalCents: 15600,
      shippingCents: 517,
      destination: { country: 'US', state: 'NM', city: 'Corrales', postalCode: '87048', line1: '123 Main St' }
    });
    expect(quote).toMatchObject({ source: 'nm_grt_api_intuit', taxCents: 1180,
      effectiveRate: 0.075625, locationCode: '29-504' });
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

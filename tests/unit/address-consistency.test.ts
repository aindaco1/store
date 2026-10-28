import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAddressConsistency, normalizeUsState } from '../../worker/src/address-consistency.js';
import { normalizeTaxDestination } from '../../worker/src/tax.js';
import { normalizeShippingDestination } from '../../worker/src/shipping.js';
import worker from '../../worker/src/index.js';

const wrong = { country: 'US', postalCode: '90012', state: 'NM', city: 'Corrales', line1: '123 Test Street' };
afterEach(() => vi.unstubAllGlobals());

describe('US postal consistency', () => {
  it.each([
    ['90012', 'CA', 'Los Angeles'], ['10467', 'NY', 'Bronx'], ['87048', 'NM', 'Corrales'],
    ['00501', 'NY', 'Holtsville'], ['06390', 'NY', 'Fishers Island'], ['83414', 'WY', 'Alta']
  ])('looks up exact ZIP %s, including exceptions to broad state ranges', (postalCode, state, city) => {
    expect(checkAddressConsistency({ country: 'US', postalCode, state, city })).toMatchObject({ checked: true, stateMismatch: false, states: [state], suggestedCity: '' });
    expect(checkAddressConsistency({ country: 'US', postalCode, state: 'invalid', city: 'Wrong city' })).toMatchObject({ stateMismatch: true, suggestedCity: city });
  });
  it('accepts full state names and ZIP+4 without altering street or city', () => {
    expect(normalizeUsState(' new york ')).toBe('NY');
    const address = { ...wrong, postalCode: '90012-1234', state: 'california' };
    expect(normalizeTaxDestination(address)).toMatchObject({ valid: true, destination: { ...address, state: 'CA' } });
    expect(address.state).toBe('california');
  });
  it('suggests a mailing city but accepts aliases without silently changing them', () => {
    const address = { ...wrong, state: 'CA', city: 'Downtown Los Angeles' };
    expect(checkAddressConsistency(address)).toMatchObject({ stateMismatch: false, suggestedCity: 'Los Angeles' });
    expect(normalizeTaxDestination(address)).toMatchObject({ valid: true, destination: { city: 'Downtown Los Angeles' } });
    expect(normalizeShippingDestination(address).valid).toBe(true);
  });
  it('rejects contradictory supplied states for billing and shipping', () => {
    for (const normalize of [normalizeTaxDestination, normalizeShippingDestination]) {
      expect(normalize(wrong)).toMatchObject({ valid: false, error: 'ZIP code 90012 belongs to CA. Check the ZIP code or state.' });
      expect(normalize({ ...wrong, state: '' }).valid).toBe(true);
    }
  });
  it.each([
    { country: 'US', postalCode: '99999', state: 'NM' },
    { country: 'US', postalCode: '09012', state: 'AE' },
    { country: 'CA', postalCode: 'K1A 0B1', state: 'ON' },
    { country: 'US', postalCode: '9001', state: 'NM' },
    null
  ])('does not invent conflicts for unavailable or incomplete data: %j', (address) => {
    expect(checkAddressConsistency(address)).toEqual({ checked: false, stateMismatch: false });
  });
});

const env: any = {
  APP_MODE: 'test', SITE_BASE: 'http://127.0.0.1:4002', CORS_ALLOWED_ORIGIN: 'http://127.0.0.1:4002',
  OBSERVABILITY_SAMPLE_RATE: '0', RATELIMIT: { get: async () => null, put: async () => {} }
};
const request = (path: string, body: any, origin = env.SITE_BASE) => worker.fetch(new Request(`http://127.0.0.1:8989${path}`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}), env, {} as any);

describe('address consistency gateway', () => {
  it('returns private minimal feedback and rejects an untrusted origin', async () => {
    const response = await request('/address/check', { billing: wrong });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ billing: { checked: true, postalCode: '90012', states: ['CA'], stateMismatch: true, suggestedCity: 'Los Angeles' }, shipping: { checked: false, stateMismatch: false } });
    expect((await request('/address/check', { billing: wrong }, 'https://untrusted.example')).status).toBe(403);
  });
  it.each(['billingAddress', 'shippingAddress'])('cannot bypass a conflict in %s with a direct quote or payment request', async (field) => {
    const fetchMock = vi.fn(() => { throw new Error('No provider should be contacted'); });
    vi.stubGlobal('fetch', fetchMock);
    for (const path of ['/tax/quote', '/api/checkout/intent']) {
      const response = await request(path, { subtotalCents: 2000, [field]: wrong, customer: { email: 'fixture@example.com' } });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'ZIP code 90012 belongs to CA. Check the ZIP code or state.' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('shared shipping option browser utilities', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as any).DustWaveShippingOptionUtils;
  });

  afterEach(() => {
    delete (window as any).DustWaveShippingOptionUtils;
  });

  it('preserves Store selection, fallback pricing, and option visibility', async () => {
    await import('../../shared/dust-wave-platform/packages/site-shell/src/shipping-option-utils-browser.js');
    const shipping = (window as any).DustWaveShippingOptionUtils;
    const options = [
      { id: 'standard', shippingCents: 600, priceDeltaCents: 0 },
      { id: 'priority', shippingCents: 925, priceDeltaCents: 325 }
    ];

    expect(shipping.normalizeSelection(options, 'missing', 'standard')).toBe('standard');
    expect(shipping.resolveQuote({
      totalShippingCents: 600,
      quotes: [{
        source: 'usps_live',
        shippingCents: 600,
        shipment: { hasPhysical: true },
        availableOptions: options,
        defaultOption: 'standard'
      }]
    }, 'priority', 300)).toMatchObject({
      shippingCents: 925,
      source: 'usps_live',
      selectedOption: 'priority'
    });
    expect(shipping.shouldShowOptions({
      source: 'flat_rate',
      shippingCents: 600,
      availableOptions: options
    })).toBe(false);
    expect(shipping.formatChoice(options[1], (id: string) => id.toUpperCase(), (cents: number) => `$${(cents / 100).toFixed(2)}`))
      .toBe('PRIORITY (+$3.25)');
  });
});

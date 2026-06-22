import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLATFORM_TIP_PERCENT,
  MAX_PLATFORM_TIP_PERCENT,
  calculatePlatformTip,
  derivePlatformTipPercent,
  sanitizePlatformTipPercent
} from '../../worker/src/tip.js';

describe('platform tip helpers', () => {
  it('defaults invalid values to the configured default percent', () => {
    expect(sanitizePlatformTipPercent(undefined, DEFAULT_PLATFORM_TIP_PERCENT)).toBe(DEFAULT_PLATFORM_TIP_PERCENT);
    expect(sanitizePlatformTipPercent('nope', DEFAULT_PLATFORM_TIP_PERCENT)).toBe(DEFAULT_PLATFORM_TIP_PERCENT);
  });

  it('accepts integer values between 0 and 15 inclusive', () => {
    expect(sanitizePlatformTipPercent(0, DEFAULT_PLATFORM_TIP_PERCENT)).toBe(0);
    expect(sanitizePlatformTipPercent(MAX_PLATFORM_TIP_PERCENT, DEFAULT_PLATFORM_TIP_PERCENT)).toBe(MAX_PLATFORM_TIP_PERCENT);
  });

  it('rejects values outside the allowed range', () => {
    expect(sanitizePlatformTipPercent(-1, DEFAULT_PLATFORM_TIP_PERCENT)).toBe(DEFAULT_PLATFORM_TIP_PERCENT);
    expect(sanitizePlatformTipPercent(16, DEFAULT_PLATFORM_TIP_PERCENT)).toBe(DEFAULT_PLATFORM_TIP_PERCENT);
    expect(sanitizePlatformTipPercent(4.5, DEFAULT_PLATFORM_TIP_PERCENT)).toBe(DEFAULT_PLATFORM_TIP_PERCENT);
  });

  it('supports a caller-provided max tip cap', () => {
    expect(sanitizePlatformTipPercent(18, DEFAULT_PLATFORM_TIP_PERCENT, 20)).toBe(18);
    expect(sanitizePlatformTipPercent(21, DEFAULT_PLATFORM_TIP_PERCENT, 20)).toBe(DEFAULT_PLATFORM_TIP_PERCENT);
  });

  it('clamps fallback tips when max percent disables tips', () => {
    expect(sanitizePlatformTipPercent(5, DEFAULT_PLATFORM_TIP_PERCENT, 0)).toBe(0);
    expect(sanitizePlatformTipPercent(undefined, DEFAULT_PLATFORM_TIP_PERCENT, 0)).toBe(0);
  });

  it('calculates the tip from subtotal cents and percent', () => {
    expect(calculatePlatformTip(10000, 5)).toBe(500);
    expect(calculatePlatformTip(555, 5)).toBe(28);
    expect(calculatePlatformTip(0, 5)).toBe(0);
  });

  it('derives an effective tip percent from stored totals', () => {
    expect(derivePlatformTipPercent(10000, 500, 0)).toBe(5);
    expect(derivePlatformTipPercent(0, 500, 0)).toBe(0);
    expect(derivePlatformTipPercent(10000, 0, 0)).toBe(0);
  });
});

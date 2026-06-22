import { describe, expect, it } from 'vitest';
import { getAllowedOrigin } from '../../worker/src/validation.js';

describe('worker validation security helpers', () => {
  it('does not default private CORS responses to wildcard origins', () => {
    expect(getAllowedOrigin({}, false)).toBe('https://shop.dustwave.xyz');
    expect(getAllowedOrigin({ CORS_ALLOWED_ORIGIN: '*' }, false)).toBe('https://shop.dustwave.xyz');
    expect(getAllowedOrigin({ SITE_BASE: 'https://pool.example/path' }, false)).toBe('https://pool.example');
  });

  it('keeps explicitly public CORS responses wildcard-accessible', () => {
    expect(getAllowedOrigin({}, true)).toBe('*');
  });
});

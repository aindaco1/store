import { describe, expect, it } from 'vitest';
import {
  SECURITY_HEADERS,
  getAllowedOrigin,
  jsonResponse
} from '../../worker/src/validation.js';

describe('worker validation security helpers', () => {
  it('does not default private CORS responses to wildcard origins', () => {
    expect(getAllowedOrigin({}, false)).toBe('https://shop.dustwave.xyz');
    expect(getAllowedOrigin({ CORS_ALLOWED_ORIGIN: '*' }, false)).toBe('https://shop.dustwave.xyz');
    expect(getAllowedOrigin({ CORS_ALLOWED_ORIGIN: 'not a URL' }, false)).toBe('https://shop.dustwave.xyz');
    expect(getAllowedOrigin({ CORS_ALLOWED_ORIGIN: 'https://admin.example/path' }, false)).toBe('https://admin.example');
    expect(getAllowedOrigin({ SITE_BASE: 'https://pool.example/path' }, false)).toBe('https://pool.example');
  });

  it('keeps explicitly public CORS responses wildcard-accessible', () => {
    expect(getAllowedOrigin({}, true)).toBe('*');
  });

  it('preserves the Store JSON response and baseline security-header contract', async () => {
    const response = jsonResponse({ ok: true }, 201, { SITE_BASE: 'https://shop.example/path' });

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://shop.example');
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, DELETE, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type, Authorization, x-admin-key');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

import { describe, expect, it } from 'vitest';

import {
  getTurnstileSecret,
  isTurnstileRequired,
  shouldBypassTurnstile
} from '../../worker/src/turnstile.js';
import {
  getCookie,
  hmacSha256,
  normalizeEmail,
  randomToken,
  sha256Hex,
  timingSafeEqual
} from '../../shared/dust-wave-platform/packages/worker-core/src/crypto.js';

describe('shared Worker core contract', () => {
  it('preserves Store admin crypto and cookie behavior', async () => {
    const request = new Request('https://shop.test', {
      headers: { Cookie: 'other=1; store_admin_session=token%3Dvalue' }
    });

    expect(normalizeEmail(' Admin@Example.COM ')).toBe('admin@example.com');
    expect(getCookie(request, 'store_admin_session')).toBe('token=value');
    expect(await sha256Hex('store')).toBe(
      '824d80d71985f082a26997a8db88b5d1dd45b777d73585d03d236303e21bde97'
    );
    expect(await hmacSha256('payload', 'secret')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(timingSafeEqual('same-token', 'same-token')).toBe(true);
    expect(timingSafeEqual('same-token', 'other-token')).toBe(false);
    expect(randomToken(24)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(() => randomToken(8)).toThrow(RangeError);
  });

  it('preserves Store Turnstile configuration behavior', () => {
    expect(getTurnstileSecret(
      { ADMIN_TURNSTILE_SECRET_KEY: 'admin-secret' },
      ['TURNSTILE_SECRET_KEY', 'ADMIN_TURNSTILE_SECRET_KEY']
    )).toBe('admin-secret');
    expect(isTurnstileRequired(
      { ADMIN_TURNSTILE_REQUIRED: 'true' },
      { requiredEnvName: 'ADMIN_TURNSTILE_REQUIRED' }
    )).toBe(true);
    expect(shouldBypassTurnstile(
      { APP_MODE: 'test', ADMIN_TURNSTILE_BYPASS: 'true' },
      'ADMIN_TURNSTILE_BYPASS'
    )).toBe(true);
  });
});

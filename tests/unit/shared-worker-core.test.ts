import { describe, expect, it } from 'vitest';

import {
  getTurnstileSecret,
  isTurnstileRequired,
  shouldBypassTurnstile
} from '../../worker/src/turnstile.js';

describe('shared Worker core contract', () => {
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

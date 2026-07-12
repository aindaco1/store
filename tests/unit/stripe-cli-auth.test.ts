import { describe, expect, it, vi } from 'vitest';

import { stripeCliAuthState } from '../../scripts/lib/stripe-cli-auth.mjs';

describe('Stripe CLI authentication detection', () => {
  it('reports an unavailable CLI without executing an auth probe', () => {
    const execute = vi.fn();
    expect(stripeCliAuthState({
      commandAvailableFn: () => false,
      runCommandFn: execute
    })).toEqual({
      available: false,
      authenticated: false,
      reason: 'stripe CLI not found'
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses only whoami and returns a fixed signed-out reason', () => {
    const execute = vi.fn(() => ({
      status: 1,
      error: '',
      stdout: 'sensitive pairing output',
      stderr: 'sensitive authentication URL'
    }));
    const state = stripeCliAuthState({
      commandAvailableFn: () => true,
      runCommandFn: execute
    });

    expect(execute).toHaveBeenCalledWith('stripe', ['whoami'], expect.any(Object));
    expect(state).toEqual({
      available: true,
      authenticated: false,
      reason: 'stripe CLI is not authenticated'
    });
    expect(JSON.stringify(state)).not.toContain('sensitive');
  });

  it('accepts an authenticated CLI without retaining identity output', () => {
    const state = stripeCliAuthState({
      commandAvailableFn: () => true,
      runCommandFn: () => ({ status: 0, error: '', stdout: 'operator@example.com', stderr: '' })
    });

    expect(state).toEqual({ available: true, authenticated: true, reason: '' });
    expect(JSON.stringify(state)).not.toContain('operator@example.com');
  });
});

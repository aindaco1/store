import process from 'node:process';
import { commandAvailable, runCommand } from './command-runner.mjs';

export function stripeCliAuthState(options = {}) {
  const available = options.commandAvailableFn || commandAvailable;
  const execute = options.runCommandFn || runCommand;
  const commandOptions = {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    timeoutMs: options.timeoutMs || 5_000,
    maxBuffer: 1024 * 1024
  };

  if (!available('stripe', commandOptions)) {
    return { available: false, authenticated: false, reason: 'stripe CLI not found' };
  }

  const result = execute('stripe', ['whoami'], commandOptions);
  if (result.status !== 0 || result.error) {
    return { available: true, authenticated: false, reason: 'stripe CLI is not authenticated' };
  }

  return { available: true, authenticated: true, reason: '' };
}

/**
 * Store's Stripe policy adapter over the shared, characterized Worker client.
 */

import {
  StripeApiError,
  createStripeClient as createPlatformStripeClient,
  verifyStripeSignature
} from '../../shared/dust-wave-platform/packages/worker-core/src/stripe.js';
import { WORKER_USER_AGENT } from './version.js';

export const DEFAULT_STRIPE_API_VERSION = '2026-02-25.clover';

export { StripeApiError, verifyStripeSignature };

export function createStripeClient(secretKey, clientOptions = {}) {
  return createPlatformStripeClient(secretKey, {
    ...clientOptions,
    stripeVersion: clientOptions.stripeVersion || DEFAULT_STRIPE_API_VERSION,
    userAgent: clientOptions.userAgent || WORKER_USER_AGENT
  });
}

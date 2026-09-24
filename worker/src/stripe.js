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

// The pinned shared client has no cancellation method yet. Keep this narrow
// Store-only operation here until it can use that characterized upstream seam.
export async function cancelStorePaymentIntent(secretKey, id, options = {}) {
  if (!secretKey || !/^pi_[A-Za-z0-9_]+$/.test(id)) throw new Error('Invalid Stripe cancellation request');
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': options.stripeVersion || DEFAULT_STRIPE_API_VERSION, 'User-Agent': WORKER_USER_AGENT,
      'Idempotency-Key': options.idempotencyKey },
    body: 'cancellation_reason=abandoned'
  });
  const result = await response.json();
  try { await options.onRequest?.({ method: 'POST', path: `/payment_intents/${id}/cancel`, status: response.status,
    success: response.ok, objectId: result.id || id, requestId: response.headers.get('request-id'), idempotencyKey: options.idempotencyKey }); } catch {}
  if (!response.ok) throw new StripeApiError('Payment cancellation could not be confirmed', { statusCode: response.status });
  return result;
}

import { readBoundedJson } from '../../shared/dust-wave-platform/packages/worker-core/src/response-body.js';
import { createStoreStripeClient, recordStripeProcessorEvent } from './payment-integrity.js';
import { checkoutStripeKey } from './checkout-policy.js';
import { DEFAULT_STRIPE_API_VERSION, StripeApiError } from './stripe.js';
import { softwareLicensingEnabled } from './software-licenses.js';

export function softwareStripe(env, orderToken = '') {
  const secret = checkoutStripeKey(env);
  if (!softwareLicensingEnabled(env) || !secret?.startsWith('sk_test_')) throw new Error('Test billing configuration required');
  const context = { operation: 'software_billing', orderToken };
  const stripe = createStoreStripeClient(env, secret, context);
  // Only the missing Store operations live here. Flat form fields avoid a second
  // Stripe serializer/client; ordinary calls use the pinned Platform client.
  async function extra(path, fields = {}, idempotencyKey) {
    if (!/^\/(coupons|invoiceitems|invoices\/in_[A-Za-z0-9_]+(?:\/(?:void|finalize))?|payment_intents\/pi_[A-Za-z0-9_]+)$/.test(path)) throw new Error('Unsupported billing operation');
    const response = await fetch(`https://api.stripe.com/v1${path}`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${secret}`, 'Stripe-Version': env.STRIPE_API_VERSION || DEFAULT_STRIPE_API_VERSION,
        'Content-Type': 'application/x-www-form-urlencoded', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: new URLSearchParams(Object.entries(fields).map(([key, value]) => [key, String(value)]))
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new StripeApiError('Billing redirect rejected', { statusCode: response.status });
    }
    const result = await readBoundedJson(response, 1024 * 1024);
    try { await recordStripeProcessorEvent(env, { method: 'POST', path, status: response.status, success: response.ok,
      requestId: response.headers.get('request-id'), objectId: result.id, idempotencyKey }, { ...context, mode: 'test' }); } catch {}
    if (!response.ok) throw new StripeApiError('Billing request failed', { statusCode: response.status });
    return result;
  }
  return { ...stripe, extra };
}

export const objectId = value => typeof value === 'string' ? value : value?.id;

export async function invoicePayment(stripe, invoice) {
  const payments = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 100 });
  if (payments.has_more || payments.data.length !== 1 || payments.data[0].payment?.type !== 'payment_intent') throw new Error('Ambiguous invoice payment');
  const intent = await stripe.paymentIntents.retrieve(objectId(payments.data[0].payment.payment_intent));
  if (intent.livemode !== false || intent.currency !== invoice.currency || intent.amount !== invoice.amount_due) throw new Error('Invoice payment mismatch');
  return intent;
}

import { objectId } from './software-stripe.js';
import { invoiceItems } from './software-invoice-fulfillment.js';

const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };
const owned = (object, customer) => object?.livemode === false && objectId(object.customer) === customer;
export function stripeHostedUrl(value, host) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password || url.port) fail('Invalid payment page');
  return url.href;
}

// Hosted setup collects card details; this owner verifies and applies the result.
// All callers are serialized by the order DO. No charge is created here.
export async function softwarePaymentRecovery(action, payload, { storage, order, stripe, returnUrl }) {
  if (!order.billing.subscriptionId) fail('This order has no subscription');
  const customer = order.billing.customerId;
  const subscription = await stripe.subscriptions.retrieve(order.billing.subscriptionId);
  if (!owned(subscription, customer) || subscription.metadata?.orderToken !== order.orderToken || subscription.pause_collection?.behavior !== 'keep_as_draft') fail('Subscription ownership or tax guard mismatch');
  if (action === 'card-setup') {
    if (!/^[a-f0-9-]{32,36}$/.test(payload.id || '') || subscription.status === 'canceled') fail('Invalid payment recovery');
    let record = await storage.get('billing-card-setup');
    if (record?.id !== payload.id) {
      record = { id: payload.id, createdAt: Date.now() };
      await storage.put('billing-card-setup', record);
    }
    if (Date.now() - record.createdAt > 30 * 60000 || record.complete) fail('Payment setup expired; start again');
    const metadata = { orderToken: order.orderToken, subscriptionId: subscription.id };
    const session = record.sessionId ? await stripe.checkout.sessions.retrieve(record.sessionId)
      : await stripe.checkout.sessions.create({ mode: 'setup', customer, currency: 'usd', payment_method_types: ['card'],
        locale: order.preferredLang === 'es' ? 'es' : 'en', metadata, setup_intent_data: { metadata },
        success_url: `${returnUrl}&billing_session={CHECKOUT_SESSION_ID}`, cancel_url: returnUrl,
        expires_at: Math.floor(record.createdAt / 1000) + 3600 }, { idempotencyKey: `store-card-setup:${order.orderToken}:${record.id}` });
    if (!owned(session, customer) || session.mode !== 'setup' || session.metadata?.orderToken !== order.orderToken) fail('Payment setup mismatch');
    await storage.put('billing-card-setup', { ...record, sessionId: session.id });
    return { url: stripeHostedUrl(session.url, 'checkout.stripe.com') };
  }
  if (action === 'card-complete') {
    const record = await storage.get('billing-card-setup');
    if (!record?.sessionId || payload.sessionId !== record.sessionId) fail('Payment setup not found; start again');
    if (record.complete) return { updated: true };
    const session = await stripe.checkout.sessions.retrieve(record.sessionId);
    if (!owned(session, customer) || session.mode !== 'setup' || session.status !== 'complete' || session.metadata?.orderToken !== order.orderToken) fail('Payment setup is not complete');
    const setup = await stripe.setupIntents.retrieve(objectId(session.setup_intent));
    if (!owned(setup, customer) || setup.status !== 'succeeded' || setup.metadata?.orderToken !== order.orderToken || setup.metadata?.subscriptionId !== subscription.id || !objectId(setup.payment_method)) fail('Payment method ownership mismatch');
    const paymentMethod = objectId(setup.payment_method);
    await stripe.customers.update(customer, { invoice_settings: { default_payment_method: paymentMethod } }, { idempotencyKey: `store-card-customer:${setup.id}` });
    await stripe.subscriptions.update(subscription.id, { default_payment_method: paymentMethod }, { idempotencyKey: `store-card-subscription:${setup.id}` });
    await storage.put('billing-card-setup', { ...record, complete: true });
    return { updated: true };
  }
  if (action === 'invoice-page') {
    if (!/^in_[A-Za-z0-9_]+$/.test(payload.invoiceId || '')) fail('Invalid invoice');
    const invoice = await stripe.invoices.retrieve(payload.invoiceId);
    const prepared = await storage.get(`billing-tax:${invoice.id}`);
    if (!owned(invoice, customer) || objectId(invoice.parent?.subscription_details?.subscription) !== subscription.id || invoice.status !== 'open' || !prepared) fail('Invoice is not available for payment');
    const items = invoiceItems(invoice, { ...order.snapshot, lines: prepared.lines }, order.billing);
    if (items.length !== prepared.lines.length || items.reduce((sum, item) => sum + item.amountCents, 0) !== invoice.amount_due) fail('Invoice does not match the verified tax snapshot');
    return { url: stripeHostedUrl(invoice.hosted_invoice_url, 'invoice.stripe.com') };
  }
  fail('Unknown payment recovery action');
}

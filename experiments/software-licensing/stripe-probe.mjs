import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createStripeClient, DEFAULT_STRIPE_API_VERSION } from '../../shared/dust-wave-platform/packages/worker-core/src/stripe.js';
import { planCombinedInvoice, invoiceLineId } from './checkout-plan.mjs';
import { invoiceFulfillment } from './invoice-fulfillment.mjs';

// No production entry point. Read the existing local secret without printing it.
const envPath = process.argv[2];
if (!envPath || !process.argv.includes('--test-mode')) throw new Error('Usage: node stripe-probe.mjs <local-dev-vars> --test-mode [--annual]');
const env = parseEnv(await readFile(envPath, 'utf8'));
const key = env.STRIPE_SECRET_KEY;
if (!/^(sk|rk)_test_/.test(key || '')) throw new Error('A Stripe TEST key is required; live mode is refused');
const stripe = createStripeClient(key);
const run = `licensing_${randomUUID().replaceAll('-', '')}`;
const options = step => ({ idempotencyKey: `${run}:${step}` });
const mixed = process.argv.includes('--mixed');
const interval = process.argv.includes('--annual') ? 'year' : 'month';
const report = { run, apiVersion: DEFAULT_STRIPE_API_VERSION, interval, mixed, testMode: true, startedAt: new Date().toISOString(), checks: [] };
let clock, product;
const prices = new Set();
const waitFor = async (check, label) => {
  for (let i = 0; i < 60; i++) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 2000)); }
  throw new Error(`Timed out: ${label}`);
};
// Only cleanup APIs absent from the pinned shared client's narrow surface.
async function archive(resource, id) {
  assert.match(id, /^(prod|price)_[a-zA-Z0-9]+$/);
  const response = await fetch(`https://api.stripe.com/v1/${resource}/${id}`, { method: 'POST', headers: {
    Authorization: `Bearer ${key}`, 'Stripe-Version': DEFAULT_STRIPE_API_VERSION,
    'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `${run}:archive:${id}`,
  }, body: 'active=false', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Test cleanup failed (${resource}, HTTP ${response.status})`);
}
async function assertSinglePayment(invoice, expected) {
  assert.equal(invoice.livemode, false);
  assert.equal(invoice.status, 'paid');
  assert.equal(invoice.amount_paid, expected);
  const payments = await stripe.invoicePayments.list({ invoice: invoice.id, status: 'paid', limit: 100 });
  assert.equal(payments.has_more, false);
  assert.equal(payments.data.length, 1);
  assert.equal(payments.data[0].payment.type, 'payment_intent');
  const pi = await stripe.paymentIntents.retrieve(payments.data[0].payment.payment_intent);
  assert.equal(pi.livemode, false); assert.equal(pi.status, 'succeeded'); assert.equal(pi.amount_received, expected);
  assert.ok(pi.latest_charge);
  return { invoice: invoice.id, paymentIntent: pi.id, charge: pi.latest_charge, amount: expected };
}
try {
  clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now()/1000), name: run }, options('clock'));
  const customer = await stripe.customers.create({ name: 'Synthetic licensing feasibility probe', test_clock: clock.id, payment_method: 'pm_card_visa', invoice_settings: { default_payment_method: 'pm_card_visa' }, metadata: { feasibility_run: run } }, options('customer'));
  assert.equal(customer.livemode, false);
  product = await stripe.products.create({ name: 'Synthetic licensing feasibility fixture', metadata: { feasibility_run: run } }, options('product'));
  const snapshot = { id: run, currency: 'usd', lines: [
    { id: 'merch', kind: 'merch', unitAmount: mixed ? 2250 : 2500, quantity: 1, product: product.id },
    { id: 'ticket', kind: 'ticket', unitAmount: 1500, quantity: 1, product: product.id },
    { id: 'ascii', kind: 'license', unitAmount: 1000, quantity: 1, interval, product: product.id },
  ] };
  if (mixed) snapshot.lines.push(
    { id: 'annual', kind: 'license', unitAmount: 10000, quantity: 1, interval: 'year', product: product.id },
    { id: 'shipping', kind: 'shipping', unitAmount: 500, quantity: 1, product: product.id },
    { id: 'tax', kind: 'tax', unitAmount: 137, quantity: 1, product: product.id },
  );
  const plan = planCombinedInvoice(snapshot);
  const payload = { ...plan.subscription, customer: customer.id };
  const subscription = await stripe.subscriptions.create(payload, options('subscription'));
  const replay = await stripe.subscriptions.create(payload, options('subscription'));
  assert.equal(replay.id, subscription.id);
  for (const item of subscription.items.data) prices.add(item.price.id);
  const initial = await stripe.invoices.pay(subscription.latest_invoice, {}, options('pay-initial'));
  report.initial = await assertSinglePayment(initial, plan.total);
  assert.equal(initial.lines.has_more, false); assert.equal(initial.lines.data.length, snapshot.lines.length);
  assert.deepEqual(initial.lines.data.map(l => invoiceLineId(l, subscription.items.data)).sort(), snapshot.lines.map(l=>l.id).sort());
  const billing={subscriptionId:subscription.id,initialInvoiceId:initial.id,items:subscription.items.data};
  assert.equal(invoiceFulfillment(initial,snapshot,billing).length,snapshot.lines.length);
  report.checks.push('One idempotently created subscription, one initial invoice, one successful PaymentIntent and charge for all three lines; recurring lines map through persisted subscription-item IDs');
  console.log('PASS: combined initial payment and line correlation');
  const active = await stripe.subscriptions.retrieve(subscription.id);
  const end = Math.min(...active.items.data.map(i=>i.current_period_end));
  assert.ok(Number.isSafeInteger(end));
  const advance = async time => {
    await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: time }, options(`advance-${time}`));
    await waitFor(async () => (await stripe.testHelpers.testClocks.retrieve(clock.id)).status === 'ready', 'test clock');
  };
  await advance(end + 60);
  await advance(end + 7200);
  const renewal = await waitFor(async () => {
    const invoices = await stripe.invoices.list({ customer: customer.id, subscription: subscription.id, limit: 10 });
    return invoices.data.find(i => i.id !== initial.id && i.status === 'paid');
  }, 'paid renewal');
  report.renewal = await assertSinglePayment(renewal, 1000);
  assert.equal(renewal.lines.data.length, 1);
  assert.equal(invoiceLineId(renewal.lines.data[0], subscription.items.data), 'ascii');
  assert.equal(invoiceFulfillment(renewal,snapshot,billing).length,1);
  report.checks.push('Test-clock renewal charges only the recurring software line');
  console.log('PASS: recurring-only renewal');
  const refund = await stripe.refunds.create({ payment_intent: report.initial.paymentIntent, amount: 1500, metadata: { order_id: run, order_line_id: 'ticket' } }, options('refund-ticket'));
  const refundReplay = await stripe.refunds.create({ payment_intent: report.initial.paymentIntent, amount: 1500, metadata: { order_id: run, order_line_id: 'ticket' } }, options('refund-ticket'));
  assert.equal(refundReplay.id, refund.id); assert.equal(refund.status, 'succeeded'); assert.equal(refund.amount, 1500);
  report.checks.push('Partial ticket-sized refund is idempotent; local item allocation remains Store work');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = { name: error.name, message: error.message, code: error.code, requestId: error.requestId };
  process.exitCode = 1;
} finally {
  report.cleanupErrors = [];
  for (const action of [
    async () => { if (clock) await stripe.testHelpers.testClocks.delete(clock.id); },
    ...[...prices].map(id => async () => { const price = await stripe.prices.retrieve(id); if (price.active) await archive('prices', id); }),
    async () => { if (product) await archive('products', product.id); },
  ]) try { await action(); } catch (e) { report.cleanupErrors.push(e.message); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await writeFile(new URL(`./stripe-${mixed ? "mixed" : interval}-result.json`, import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

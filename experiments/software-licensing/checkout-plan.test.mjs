import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCombinedInvoice, invoiceLineId } from './checkout-plan.mjs';
const snapshot = () => ({ id: 'probe', currency: 'usd', lines: [
  { id: 'shirt', kind: 'merch', unitAmount: 2500, quantity: 1, product: 'prod_test' },
  { id: 'ticket', kind: 'ticket', unitAmount: 1500, quantity: 2, product: 'prod_test' },
  { id: 'ascii', kind: 'license', unitAmount: 1000, quantity: 1, interval: 'month', product: 'prod_test' },
] });
test('one initial invoice includes merch, ticket and license; renewal excludes one-time lines', () => {
  const plan = planCombinedInvoice(snapshot());
  assert.equal(plan.total, 6500);
  assert.deepEqual(plan.recurringLineIds, ['ascii']);
  assert.deepEqual(plan.initialOnlyLineIds, ['shirt', 'ticket']);
  assert.equal(plan.subscription.items.length, 1);
  assert.equal(plan.subscription.add_invoice_items.length, 2);
  assert.equal(plan.subscription.add_invoice_items[1].metadata.order_line_id, 'ticket');
});
test('rejects duplicate lines, unsafe cents, mixed currencies and recurring merchandise', () => {
  for (const mutate of [
    s => { s.lines[1].id = 'shirt'; },
    s => { s.lines[0].unitAmount = 1.2; },
    s => { s.lines[0].quantity = Number.MAX_SAFE_INTEGER; },
    s => { s.currency = 'eur'; },
    s => { s.lines[0].interval = 'year'; },
  ]) { const s = snapshot(); mutate(s); assert.throws(() => planCombinedInvoice(s)); }
});
test('monthly and annual licenses retain their own cadence; one-time-only orders retain existing path', () => {
  const s = snapshot(); s.lines.push({ ...s.lines[2], id: 'annual', interval: 'year' });
  assert.deepEqual(planCombinedInvoice(s).subscription.items.map(i => i.price_data.recurring.interval), ['month', 'year']);
  delete s.lines[2].interval; delete s.lines[3].interval;
  assert.throws(() => planCombinedInvoice(s), /existing PaymentIntent/);
});
test('recurring invoice correlation uses the persisted subscription item, failing closed on unknown items', () => {
  const items = [{ id: 'si_test', metadata: { order_line_id: 'ascii' } }];
  const line = { parent: { subscription_item_details: { subscription_item: 'si_test' } }, metadata: {} };
  assert.equal(invoiceLineId(line, items), 'ascii');
  assert.throws(() => invoiceLineId(line, []), /Unmapped/);
  assert.equal(invoiceLineId({ metadata: { order_line_id: 'ticket' } }, items), 'ticket');
});

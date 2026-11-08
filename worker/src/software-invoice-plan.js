import { isValidAmount } from './validation.js';

// Input is a stored, server-priced snapshot. Never call this with browser prices.
// Used by both checkout and the isolated provider probes.
export function planCombinedInvoice({ id, currency, lines }) {
  if (!/^[a-z0-9_-]{1,100}$/.test(id) || currency !== 'usd' || !Array.isArray(lines) || !lines.length || lines.length > 20) throw new Error('Invalid snapshot');
  const seen = new Set();
  let total = 0;
  const recurring = [], once = [];
  for (const line of lines) {
    if (!/^[a-z0-9_-]{1,100}$/.test(line.id) || seen.has(line.id) || !['merch', 'ticket', 'license', 'shipping', 'tax', 'tip'].includes(line.kind)) throw new Error('Invalid line identity');
    seen.add(line.id);
    if (!isValidAmount(line.unitAmount) || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || !isValidAmount(line.unitAmount * line.quantity)) throw new Error('Invalid line amount');
    if (line.interval && (line.kind !== 'license' || !['month', 'year'].includes(line.interval))) throw new Error('Invalid recurring line');
    if (typeof line.product !== 'string' || !/^prod_[a-zA-Z0-9]+$/.test(line.product)) throw new Error('Invalid Stripe product');
    total += line.unitAmount * line.quantity;
    if (!isValidAmount(total)) throw new Error('Invalid order total');
    const price_data = { currency, product: line.product, unit_amount: line.renewalAmount ?? line.unitAmount };
    const metadata = { order_id: id, order_line_id: line.id, fulfillment_kind: line.kind };
    if (line.interval) {
      price_data.recurring = { interval: line.interval };
      recurring.push({ price_data, quantity: line.quantity, metadata, ...(line.initialCoupon ? { discounts: [{ coupon: line.initialCoupon }] } : {}) });
    } else {
      once.push({ price_data, quantity: line.quantity, metadata });
    }
  }
  if (!recurring.length) throw new Error('Use existing PaymentIntent checkout for one-time-only orders');
  return {
    total,
    subscription: {
      items: recurring, add_invoice_items: once,
      payment_behavior: 'default_incomplete', billing_mode: { type: 'flexible' },
      payment_settings: { save_default_payment_method: 'on_subscription', payment_method_types: ['card'] },
      metadata: { order_id: id },
    },
    recurringLineIds: lines.filter(l => l.interval).map(l => l.id),
    initialOnlyLineIds: lines.filter(l => !l.interval).map(l => l.id),
  };
}

// Stripe does not copy subscription-item metadata onto recurring invoice lines.
// Persist this mapping when the subscription is created and use it on renewals.
export function invoiceLineId(line, subscriptionItems) {
  const item = line.parent?.subscription_item_details?.subscription_item;
  const id = item ? subscriptionItems.find(i => i.id === item)?.metadata?.order_line_id : line.metadata?.order_line_id;
  if (!id) throw new Error('Unmapped invoice line; do not fulfill');
  return id;
}

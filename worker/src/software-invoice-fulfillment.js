import { purchasedCoverage } from './software-offers.js';
import { invoiceLineId } from './software-invoice-plan.js';

// Consume a freshly retrieved Stripe invoice, never an event payload's mutable
// state. The event is a notification to reconcile, never entitlement authority.
export const invoiceLineAmount = line => line.amount - (line.discount_amounts || []).reduce((sum, value) => sum + value.amount, 0);

export function invoiceFulfillment(invoice, snapshot, billing) {
  if (invoice.status !== 'paid') throw new Error('Invoice is not paid');
  const items = invoiceItems(invoice, snapshot, billing);
  if (invoice.amount_paid !== items.reduce((sum, item) => sum + item.amountCents, 0)) throw new Error('Paid amount does not match invoice lines');
  return items;
}

// Shared validation also protects recovery between finalization and collection.
// These items alone never authorize fulfillment; payment verification stays above.
export function invoiceItems(invoice, snapshot, billing) {
  if (invoice.currency !== snapshot.currency || invoice.lines.has_more) throw new Error('Invoice is not a complete snapshot');
  if (invoice.parent?.subscription_details?.subscription !== billing.subscriptionId) throw new Error('Invoice subscription mismatch');
  const initial = invoice.id === billing.initialInvoiceId;
  const expected = snapshot.lines.filter(line => initial || line.interval || line.renewalTax);
  const seen = new Set();
  const intents = invoice.lines.data.map(line => {
    const id = invoiceLineId(line, billing.items), source = expected.find(item => item.id === id);
    if (!source || seen.has(id) || line.currency !== snapshot.currency || line.quantity !== source.quantity || invoiceLineAmount(line) !== (initial ? source.unitAmount : (source.renewalAmount ?? source.unitAmount)) * source.quantity || line.parent?.subscription_item_details?.proration === true) throw new Error('Invoice line does not match the frozen order');
    seen.add(id);

    if (source.interval && (!Number.isSafeInteger(line.period?.start * 1000) || !Number.isSafeInteger(line.period?.end * 1000) || line.period.start >= line.period.end)) throw new Error('Missing software coverage period');
    return { id: `${invoice.id}:${id}`, orderLineId: id, kind: source.kind, invoiceId: invoice.id,
      amountCents: invoiceLineAmount(line), quantity: source.purchasedQuantity ?? line.quantity,
      ...(source.interval ? { billedPeriod: { start: line.period.start * 1000, end: line.period.end * 1000 }, coverage: { kind: 'term', start: initial && source.offer ? 0 : line.period.start * 1000, end: line.period.end * 1000 } } : source.offer ? { coverage: purchasedCoverage(source, invoice.status_transitions.paid_at * 1000) } : {}) };
  }).filter(Boolean);
  if (initial && expected.some(line => !seen.has(line.id))) throw new Error('Initial invoice omitted a frozen order line');
  // Mixed-cadence renewals intentionally contain only the items due then.
  return intents;
}
export function itemRefundIntent({ invoiceId, orderLineId, amountCents, cumulativeRefundCents }, issued) {
  const item = issued.find(value => value.invoiceId === invoiceId && value.orderLineId === orderLineId);
  if (!item || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !Number.isSafeInteger(cumulativeRefundCents) || cumulativeRefundCents < amountCents || cumulativeRefundCents > item.amountCents) throw new Error('Invalid item refund allocation');
  return { invoiceId, orderLineId, amountCents, cumulativeRefundCents,
    // A partial software refund does not guess a shorter coverage interval.
    entitlementAction: item.kind === 'license' ? (cumulativeRefundCents === item.amountCents ? 'revoke_invoice_coverage' : 'review') : 'none' };
}

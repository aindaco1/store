import { isValidAmount } from './validation.js';
import { softwareLicensingEnabled } from './software-licenses.js';

// Repository-authored offer only. Never read policy, seats or cadence from cart input.
export function softwareOffer(product, variant, env) {
  const offer = variant?.software_license ?? product.software_license;
  if (offer == null) return null;
  const fail = () => { throw new Error('Invalid or unavailable software offer'); };
  if (!softwareLicensingEnabled(env) || env.SOFTWARE_CHECKOUT_ENABLED !== 'true' || product.fulfillment_type !== 'digital' || Object.keys(product.download || {}).length || Object.keys(variant?.download || {}).length ||
      product.inventory_tracking || (product.pricing_mode && product.pricing_mode !== 'fixed') ||
      offer.product !== 'ascii-vj-remix' || !Number.isSafeInteger(offer.seats) || offer.seats < 1 || offer.seats > 100) fail();
  const { billing, updates } = offer;
  if (!['once', 'month', 'year'].includes(billing)) fail();
  if (billing !== 'once') {
    if (updates != null || Object.keys(offer).sort().join(',') !== 'billing,product,seats') fail();
    return { product: offer.product, seats: offer.seats, billing };
  }
  if (!updates || Object.keys(offer).sort().join(',') !== 'billing,product,seats,updates') fail();
  const fields = Object.keys(updates).sort().join(',');
  if (!(updates.kind === 'lifetime' && fields === 'kind') &&
      !(updates.kind === 'major' && fields === 'kind,major' && Number.isSafeInteger(updates.major) && updates.major >= 1) &&
      !(updates.kind === 'term' && fields === 'days,kind' && Number.isSafeInteger(updates.days) && updates.days >= 1 && updates.days <= 3650)) fail();
  return { product: offer.product, seats: offer.seats, billing, updates: { ...updates } };
}

export const hasSoftware = order => order?.items?.some(item => item.softwareLicense);

export function softwareOrderSnapshot(draft) {
  if (!hasSoftware(draft) || draft.currency !== 'USD' || !draft.customer.email || draft.items.length > 16) throw new Error('Invalid software checkout');
  const lines = draft.items.map((item, i) => ({
    id: `line-${i}`, kind: item.softwareLicense ? 'license' : (item.fulfillmentType === 'ticket' ? 'ticket' : 'merch'),
    name: item.name, taxable: String(item.taxCategory || 'standard').trim().toLowerCase() !== 'exempt', unitAmount: item.discountedSubtotalCents, quantity: 1, purchasedQuantity: item.quantity,
    ...(item.softwareLicense ? { offer: item.softwareLicense } : {}),
    ...(item.softwareLicense?.billing !== 'once' && item.softwareLicense ? {
      interval: item.softwareLicense.billing, renewalAmount: item.subtotalCents
    } : {})
  }));
  for (const [kind, amount] of [['shipping', draft.totals.shippingCents], ['tax', draft.totals.taxCents], ['tip', draft.totals.tipAmountCents]]) {
    if (amount) lines.push({ id: kind, kind, name: kind, unitAmount: amount, quantity: 1 });
  }
  const total = lines.reduce((sum, line) => sum + line.unitAmount, 0);
  if (total !== draft.totals.totalCents || !isValidAmount(total) || total < 50 || lines.some(line => !isValidAmount(line.unitAmount))) throw new Error('Invalid software order total');
  return { id: draft.orderToken, currency: 'usd', lines, total };
}

export function purchasedCoverage(line, paidAt) {
  const policy = line.offer.updates;
  return policy.kind === 'term' ? { kind: 'term', start: 0, end: paidAt + policy.days * 86400000 } : policy;
}

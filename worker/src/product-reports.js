import { isStoreOrderFulfillmentReady } from './orders.js';
import { getStoreCatalogSnapshot } from './catalog.js';
import { isValidEmail } from './validation.js';
import { getPlatformDateKey, getPlatformTimeParts, getPlatformTimeZone } from './timezone.js';

export function normalizeProductReportEmails(value = []) {
  if (!Array.isArray(value) || value.length > 20 || value.some((email) => typeof email !== 'string' || !isValidEmail(email.trim()))) {
    return { ok: false, error: 'Daily report recipients must be a list of up to 20 valid email addresses.' };
  }
  return { ok: true, value: [...new Set(value.map((email) => email.trim().toLowerCase()))] };
}

export function productReportRecipients(product = {}) {
  const result = normalizeProductReportEmails(product.daily_report_emails);
  return result.ok ? result.value : [];
}

export function isProductReportRecipient(env, productId, email) {
  const product = getStoreCatalogSnapshot(env).products?.find((item) => item.id === productId);
  return Boolean(product && product.launch_test !== true && productReportRecipients(product).includes(String(email || '').trim().toLowerCase()));
}

export function productReportDate(env, now = new Date()) {
  const { year, month, day } = getPlatformTimeParts(env, now);
  // Subtract a calendar day, not 24 hours in the reporting time zone (DST).
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export function buildProductReportRows(orders, productId, date, env) {
  const rows = [];
  for (const order of orders) {
    const confirmed = Date.parse(order.confirmedAt || '');
    if (!isStoreOrderFulfillmentReady(order) || order.importedAt || order.source === 'snipcart' || !Number.isFinite(confirmed)) continue;
    if (getPlatformDateKey(env, new Date(confirmed)) !== date) continue;
    const draft = order.orderDraft || {};
    const email = String(draft.customer?.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) continue;
    for (const item of draft.items || []) {
      if (item.productId !== productId) continue;
      rows.push({
        email,
        variant: String(item.variantLabel || item.variantId || ''),
        quantity: item.quantity,
        amountCents: Math.max(0, Number(item.discountedSubtotalCents ?? (item.subtotalCents - (item.discountCents || 0)))),
        currency: item.currency || draft.currency || 'USD'
      });
    }
  }
  return rows;
}

// Storage reads and delivery use Store's existing bounded bulk reader and outbox.
export async function processProductReports(env, now, { loadOrders, enqueue }) {
  if (!env.STORE_STATE || getPlatformTimeParts(env, now).hour < 7) return { attempted: false, queued: 0 };
  const date = productReportDate(env, now);
  const marker = `cron:product-reports:${date}`;
  if (await env.STORE_STATE.get(marker)) return { attempted: false, queued: 0 };
  const products = getStoreCatalogSnapshot(env).products || [];
  if (!products.length) return { attempted: false, queued: 0 };
  const configured = products.filter((product) => product.launch_test !== true && productReportRecipients(product).length);
  const orders = configured.length ? await loadOrders() : [];
  let queued = 0;
  for (const product of configured) {
    const rows = buildProductReportRows(orders, product.id, date, env);
    if (!rows.length) continue;
    for (const email of productReportRecipients(product)) {
      const result = await enqueue(env, {
        kind: 'store_product_report',
        dedupeKey: `product-report:${product.id}:${date}:${email}`,
        payload: { email, productId: product.id, productName: product.name, date, timeZone: getPlatformTimeZone(env), rows }
      });
      if (!result.sent && !result.queued) throw new Error('Product report could not be queued');
      queued += 1;
    }
  }
  // Only mark a complete pass; partial failures retry with stable outbox identities.
  await env.STORE_STATE.put(marker, JSON.stringify({ completedAt: now.toISOString(), queued }), { expirationTtl: 172800 });
  return { attempted: true, queued };
}

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

function collectProductReport(orders, productId, date, env, history = false) {
  const rows = [];
  const amounts = new Map();
  let orderCount = 0;
  let quantity = 0;
  for (const order of orders) {
    const confirmed = Date.parse(order.confirmedAt || '');
    const imported = Boolean(order.importedAt || order.source === 'snipcart');
    if (!isStoreOrderFulfillmentReady(order) || !Number.isFinite(confirmed) || (!history && imported)) continue;
    const localDate = getPlatformDateKey(env, new Date(confirmed));
    if (history ? localDate > date : localDate !== date) continue;
    const draft = order.orderDraft || {};
    const email = String(draft.customer?.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) continue;
    let matched = false;
    for (const item of draft.items || []) {
      if (item.productId !== productId) continue;
      const row = {
        confirmedAt: new Date(confirmed).toISOString(),
        date: localDate,
        source: imported ? 'legacy_import' : 'store',
        email,
        variant: String(item.variantLabel || item.variantId || ''),
        quantity: item.quantity,
        amountCents: Math.max(0, Number(item.discountedSubtotalCents ?? (item.subtotalCents - (item.discountCents || 0)))),
        currency: String(item.currency || draft.currency || 'USD').toUpperCase()
      };
      rows.push(row);
      matched = true;
      quantity += Number.isInteger(row.quantity) && row.quantity > 0 ? row.quantity : 0;
      amounts.set(row.currency, (amounts.get(row.currency) || 0) + row.amountCents);
    }
    if (matched) orderCount += 1;
  }
  rows.sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt));
  return { rows, summary: { orders: orderCount, quantity, amounts: [...amounts].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountCents]) => ({ currency, amountCents })) } };
}

export function buildProductReportRows(orders, productId, date, env) {
  return collectProductReport(orders, productId, date, env).rows;
}

export function buildProductReport(orders, productId, date, env) {
  const daily = collectProductReport(orders, productId, date, env);
  const lifetime = collectProductReport(orders, productId, date, env, true);
  return { rows: daily.rows, historyRows: lifetime.rows, summary: { daily: daily.summary, lifetime: lifetime.summary } };
}

export function productReportCsv(rows = []) {
  const cell = (value) => {
    let text = String(value ?? '');
    // Quotes alone do not prevent spreadsheet formula execution.
    if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const header = ['date_local', 'confirmed_at_utc', 'email', 'variant', 'quantity', 'amount', 'currency', 'source'];
  return [header, ...rows.map((row) => [row.date, row.confirmedAt, row.email, row.variant, row.quantity, (row.amountCents / 100).toFixed(2), row.currency, row.source])]
    .map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
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
    const report = buildProductReport(orders, product.id, date, env);
    if (!report.rows.length) continue;
    for (const email of productReportRecipients(product)) {
      const result = await enqueue(env, {
        kind: 'store_product_report',
        dedupeKey: `product-report:${product.id}:${date}:${email}`,
        payload: { email, productId: product.id, productName: product.name, date, timeZone: getPlatformTimeZone(env), ...report }
      });
      if (!result.sent && !result.queued) throw new Error('Product report could not be queued');
      queued += 1;
    }
  }
  // Only mark a complete pass; partial failures retry with stable outbox identities.
  await env.STORE_STATE.put(marker, JSON.stringify({ completedAt: now.toISOString(), configuredProducts: configured.length, queued }), { expirationTtl: 172800 });
  return { attempted: true, queued };
}

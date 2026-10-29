import { describe, expect, it, vi } from 'vitest';
import { buildProductReport, buildProductReportRows, productReportCsv, normalizeProductReportEmails, processProductReports, productReportDate } from '../../worker/src/product-reports.js';
import { enqueueEmailOutbox, processEmailOutbox, EMAIL_OUTBOX_PREFIX } from '../../worker/src/email-outbox.js';
import { sendStoreProductReportEmail } from '../../worker/src/email.js';
import worker, { applyAdminStoreProductPatchToMarkdown, normalizeAdminStoreProductPublishBody } from '../../worker/src/index.js';

class MemoryKV {
  store = new Map<string, string>();
  async get(key: string, options?: { type?: string }) { const value = this.store.get(key); return value === undefined ? null : options?.type === 'json' ? JSON.parse(value) : value; }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list({ prefix = '', limit = 1000 } = {}) { return { keys: [...this.store.keys()].filter(k => k.startsWith(prefix)).slice(0, limit).map(name => ({ name })), list_complete: true }; }
}
const product = { id: 'sample', slug: 'sample', sku: 'sample', price_cents: 2500, fulfillment_type: 'physical', name: 'Sample <product>', daily_report_emails: ['runner@example.com', 'second@example.com'] };
function env() { return { STORE_STATE: new MemoryKV(), PLATFORM_TIMEZONE: 'America/Denver', STORE_CATALOG_JSON: JSON.stringify({ products: [product] }), STORE_EMAIL_DRY_RUN: 'true', I18N_CATALOG_JSON: JSON.stringify({ en: { email: {} } }), UPDATES_EMAIL_FROM: 'Store <updates@example.com>' }; }
function item(overrides = {}) { return { productId: 'sample', variantId: 'blue', variantLabel: 'Blue', quantity: 2, subtotalCents: 5000, discountCents: 1000, discountedSubtotalCents: 4000, currency: 'USD', fulfillmentType: 'physical', ...overrides }; }
function order(overrides = {}) { return { status: 'confirmed', confirmedAt: '2026-10-28T12:00:00Z', createdAt: '2026-10-27T12:00:00Z', payment: { required: true, status: 'succeeded' }, orderDraft: { customer: { email: 'BUYER@example.com', name: 'Private name' }, items: [item(), item({ productId: 'other' })], totals: { totalCents: 999999, shippingCents: 1000, taxCents: 500, tipAmountCents: 250 } }, ...overrides }; }
const due = new Date('2026-10-29T13:02:00Z');

describe('daily product reports', () => {
  it('uses yesterday in the configured zone across DST and year boundaries', () => {
    const e = env();
    expect(productReportDate(e, new Date('2026-03-09T13:00:00Z'))).toBe('2026-03-08');
    expect(productReportDate(e, new Date('2026-11-02T14:00:00Z'))).toBe('2026-11-01');
    expect(productReportDate(e, new Date('2027-01-01T14:00:00Z'))).toBe('2026-12-31');
  });
  it('selects confirmed lines by local confirmation day, with no other products or private customer fields', () => {
    const records = [order(), order({ confirmedAt: '2026-10-28T06:00:00Z' }), order({ confirmedAt: '2026-10-29T05:59:59.999Z' }), order({ confirmedAt: '2026-10-28T05:59:59Z' }), order({ confirmedAt: '2026-10-29T06:00:00Z' }), order({ status: 'payment_pending' }), order({ payment: { required: true, status: 'processing' } }), order({ importedAt: '2026-10-28T12:00:00Z' }), order({ confirmedAt: '' })];
    const rows = buildProductReportRows(records, 'sample', '2026-10-28', env());
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ email: 'buyer@example.com', variant: 'Blue', quantity: 2, amountCents: 4000, currency: 'USD' });
  });
  it.each(['physical', 'digital', 'ticket', 'rsvp', 'service'])('supports %s free orders and non-variant items', (fulfillmentType) => {
    const record = order({ payment: { required: false, status: 'not_required' }, orderDraft: { customer: { email: 'free@example.com' }, items: [item({ fulfillmentType, variantId: '', variantLabel: '', subtotalCents: 0, discountedSubtotalCents: 0, discountCents: 0 })] } });
    expect(buildProductReportRows([record], 'sample', '2026-10-28', env())[0]).toMatchObject({ variant: '', quantity: 2, amountCents: 0 });
  });
  it('uses historical line prices and legacy line discounts without falling back to the full order total', () => {
    const record = order();
    delete (record.orderDraft.items[0] as any).discountedSubtotalCents;
    expect(buildProductReportRows([record], 'sample', '2026-10-28', env())[0].amountCents).toBe(4000);
  });
  it('summarizes lifetime purchases through the local report day, including imports without triggering daily sends', async () => {
    const older = order({ confirmedAt: '2026-09-01T12:00:00Z' });
    const legacy = order({ confirmedAt: '2023-01-01T12:00:00Z', importedAt: '2026-10-28T12:00:00Z', source: 'snipcart' });
    const multi = order({ orderDraft: { customer: { email: 'variants@example.com' }, items: [item(), item({ variantLabel: 'Red', quantity: 1, discountedSubtotalCents: 500 })] } });
    const report = buildProductReport([order({ confirmedAt: '2026-10-29T06:00:00Z' }), older, multi, legacy, order({ status: 'payment_pending' })], 'sample', '2026-10-28', env());
    expect(report.rows).toHaveLength(2);
    expect(report.historyRows).toHaveLength(4);
    expect(report.historyRows[0]).toMatchObject({ date: '2023-01-01', source: 'legacy_import', confirmedAt: '2023-01-01T12:00:00.000Z' });
    expect(report.summary).toEqual({ daily: { orders: 1, quantity: 3, amounts: [{ currency: 'USD', amountCents: 4500 }] }, lifetime: { orders: 3, quantity: 7, amounts: [{ currency: 'USD', amountCents: 12500 }] } });
    const enqueue = vi.fn();
    await processProductReports(env(), due, { loadOrders: async () => [older, legacy], enqueue });
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('keeps currency totals separate and includes free lifetime lines', () => {
    const free = order({ confirmedAt: '2026-10-01T00:00:00Z', payment: { required: false, status: 'not_required' }, orderDraft: { customer: { email: 'free@example.com' }, items: [item({ discountedSubtotalCents: 0 })] } });
    const eur = order({ orderDraft: { customer: { email: 'eur@example.com' }, items: [item({ currency: 'eur', discountedSubtotalCents: 2500 })] } });
    const report = buildProductReport([order(), eur, free], 'sample', '2026-10-28', env());
    expect(report.summary.lifetime.amounts).toEqual([{ currency: 'EUR', amountCents: 2500 }, { currency: 'USD', amountCents: 4000 }]);
    expect(report.summary.lifetime.orders).toBe(3);
    expect(report.historyRows[0].amountCents).toBe(0);
  });
  it('exports chronological UTF-8 history with safe CSV quoting and formula neutralization', () => {
    const rows = buildProductReport([order()], 'sample', '2026-10-28', env()).historyRows;
    const csv = productReportCsv([{ ...rows[0], email: '+formula@example.com', variant: '  =HYPERLINK("bad")' }, { ...rows[0], variant: 'Azul, "edición"\nDos' }]);
    expect(csv).toContain('"date_local","confirmed_at_utc","email","variant","quantity","amount","currency","source"');
    expect(csv).toContain('"\'+formula@example.com"');
    expect(csv).toContain('"\'  =HYPERLINK(""bad"")"');
    expect(csv).toContain('"Azul, ""edición""\nDos"');
    expect(csv).toContain('"40.00","USD","store"');
    expect(csv).not.toContain('Private name');
    expect(csv).not.toContain('orderToken');
  });
  it('renders lifetime summary and complete CSV while bounding the inline daily table', async () => {
    const e: any = { ...env(), STORE_EMAIL_CAPTURE_PAYLOAD: 'true' };
    const records = Array.from({ length: 55 }, () => order());
    const report = buildProductReport(records, 'sample', '2026-10-28', e);
    await sendStoreProductReportEmail(e, { email: 'runner@example.com', productId: 'sample', productName: product.name, date: '2026-10-28', timeZone: 'America/Denver', ...report });
    const mail = e.__STORE_CAPTURED_EMAIL_PAYLOAD;
    expect(mail.text).toContain('Lifetime orders: 55');
    expect(mail.text).toContain('Lifetime units: 110');
    expect(mail.text).toContain('Lifetime sales: $2,200.00');
    expect(mail.text).toContain('Showing the first 50 rows');
    expect(mail.html.match(/buyer@example.com/g)).toHaveLength(50);
    expect(mail.attachments[0].filename).toBe('sample-sales-history-2026-10-28.csv');
    const csv = Buffer.from(mail.attachments[0].content, 'base64').toString('utf8');
    expect(csv.match(/buyer@example.com/g)).toHaveLength(55);
    expect(mail.text).not.toContain('Private name');
  });
  it('waits until 7 AM, catches delayed ticks, and scans only once after success', async () => {
    const e = env(); const loadOrders = vi.fn(async () => [order()]);
    const deps = { loadOrders, enqueue: enqueueEmailOutbox };
    expect(await processProductReports(e, new Date('2026-10-29T12:59:59Z'), deps)).toMatchObject({ attempted: false });
    expect(loadOrders).not.toHaveBeenCalled();
    expect(await processProductReports(e, due, deps)).toMatchObject({ queued: 2 });
    await processProductReports(e, new Date('2026-10-30T01:00:00Z'), deps);
    expect(loadOrders).toHaveBeenCalledTimes(1);
    expect((await e.STORE_STATE.list({ prefix: EMAIL_OUTBOX_PREFIX })).keys).toHaveLength(2);
  });
  it('skips empty days, unconfigured products and launch fixtures', async () => {
    const e = env(); const loadOrders = vi.fn(async () => []); const enqueue = vi.fn();
    await processProductReports(e, due, { loadOrders, enqueue });
    expect(enqueue).not.toHaveBeenCalled();
    for (const p of [{ ...product, daily_report_emails: [] }, { ...product, launch_test: true }]) {
      const e2 = { ...env(), STORE_CATALOG_JSON: JSON.stringify({ products: [p] }) };
      const load = vi.fn(); await processProductReports(e2, due, { loadOrders: load, enqueue }); expect(load).not.toHaveBeenCalled();
    }
  });
  it('retries partial enqueue without duplicating or changing the first recipient snapshot', async () => {
    const e = env(); let attempts = 0;
    const enqueue = async (...args: any[]) => { if (++attempts === 2) throw new Error('temporary write failure'); return enqueueEmailOutbox(...args); };
    await expect(processProductReports(e, due, { loadOrders: async () => [order()], enqueue })).rejects.toThrow();
    expect(await e.STORE_STATE.get('cron:product-reports:2026-10-28')).toBeNull();
    await processProductReports(e, due, { loadOrders: async () => [order()], enqueue });
    const jobs = (await e.STORE_STATE.list({ prefix: EMAIL_OUTBOX_PREFIX })).keys;
    expect(jobs).toHaveLength(2);
    const payload = (await e.STORE_STATE.get(jobs[0].name, { type: 'json' })).payload;
    expect(payload.rows).toHaveLength(1);
    expect(payload.historyRows).toHaveLength(1);
    expect(payload.summary.lifetime.orders).toBe(1);
  });
  it('does not consume the day if order reads fail', async () => {
    const e = env(); await expect(processProductReports(e, due, { loadOrders: async () => { throw new Error('incomplete scan'); }, enqueue: enqueueEmailOutbox })).rejects.toThrow('incomplete scan');
    expect(await e.STORE_STATE.get('cron:product-reports:2026-10-28')).toBeNull();
  });
  it('runs from the real Worker cron and queues reports before draining the outbox', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(due);
    try {
      const e = { ...env(), APP_MODE: 'test', EMAIL_OUTBOX_ENABLED: 'true' };
      await e.STORE_STATE.put('orders:store-order-report-fixture', JSON.stringify(order()));
      await worker.scheduled({ cron: '* * * * *' }, e);
      expect(await e.STORE_STATE.get('cron:product-reports:2026-10-28')).not.toBeNull();
      expect((await e.STORE_STATE.list({ prefix: 'email-delivery:v1:' })).keys).toHaveLength(2);
      expect(await e.STORE_STATE.get('cron:lastError')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('delivers separate report messages through the existing outbox without a provider send', async () => {
    const e = env();
    await processProductReports(e, due, { loadOrders: async () => [order()], enqueue: enqueueEmailOutbox });
    expect(await processEmailOutbox(e, { now: new Date('2027-01-01T00:00:00Z') })).toMatchObject({ sent: 2, failed: 0 });
    expect((await e.STORE_STATE.list({ prefix: EMAIL_OUTBOX_PREFIX })).keys).toHaveLength(0);
    expect((await e.STORE_STATE.list({ prefix: 'email-delivery:v1:' })).keys).toHaveLength(2);
    await processProductReports(e, due, { loadOrders: async () => [order()], enqueue: enqueueEmailOutbox });
    expect((await e.STORE_STATE.list({ prefix: EMAIL_OUTBOX_PREFIX })).keys).toHaveLength(0);
  });
  it('suppresses queued delivery to recipients removed from the published product', async () => {
    const e = env(); await processProductReports(e, due, { loadOrders: async () => [order()], enqueue: enqueueEmailOutbox });
    e.STORE_CATALOG_JSON = JSON.stringify({ products: [{ ...product, daily_report_emails: [] }] });
    expect(await processEmailOutbox(e, { now: new Date('2027-01-01T00:00:00Z') })).toMatchObject({ suppressed: 2, sent: 0 });
  });
  it('renders only requested columns, escapes content, and produces plain text without a provider send', async () => {
    const e: any = { ...env(), STORE_EMAIL_CAPTURE_PAYLOAD: 'true' };
    const rows = buildProductReportRows([order()], 'sample', '2026-10-28', e);
    await sendStoreProductReportEmail(e, { email: 'runner@example.com', productName: product.name, date: '2026-10-28', timeZone: 'America/Denver', rows });
    const mail = e.__STORE_CAPTURED_EMAIL_PAYLOAD;
    expect(mail.to).toBe('runner@example.com');
    expect(mail.html).toContain('Sample &lt;product&gt;');
    expect(mail.html).toContain('$40.00');
    expect(mail.text).toContain('buyer@example.com | Blue | 2 | $40.00');
    expect(mail.html).not.toContain('Private name');
    await sendStoreProductReportEmail(e, { email: 'runner@example.com', productName: 'Free', date: '2026-10-28', timeZone: 'America/Denver', rows: [{ email: 'buyer@example.com', variant: '', quantity: 1, amountCents: 0 }] });
    expect(e.__STORE_CAPTURED_EMAIL_PAYLOAD.attachments).toBeUndefined();
    expect(e.__STORE_CAPTURED_EMAIL_PAYLOAD.text).not.toContain('Lifetime orders');
    expect(e.__STORE_CAPTURED_EMAIL_PAYLOAD.html).not.toContain('>Variant<');
    expect(e.__STORE_CAPTURED_EMAIL_PAYLOAD.html).toContain('$0.00');
  });
});

describe('product report authoring', () => {
  it('normalizes and deduplicates recipients while rejecting malformed or oversized lists', () => {
    expect(normalizeProductReportEmails([' Runner@Example.com ', 'runner@example.com'])).toEqual({ ok: true, value: ['runner@example.com'] });
    for (const invalid of [['bad'], ['a@example.com\nBcc: injected@example.com'], 'a@example.com', Array(21).fill('a@example.com')]) expect(normalizeProductReportEmails(invalid)).toMatchObject({ ok: false });
  });
  it.each([true, false])('persists recipients through canonical %s product authoring, and removes all to disable', (createProduct) => {
    const e = env();
    for (const recipients of [['Runner@Example.com', 'runner@example.com'], []]) {
      const normalized = normalizeAdminStoreProductPublishBody({ intent: 'publish', createProduct, productId: createProduct ? 'new-product' : 'sample', fields: { name: 'Sample', dailyReportEmails: recipients } }, e);
      expect(normalized.ok, JSON.stringify(normalized.errors)).toBe(true);
      const source = '---\nidentifier: sample\nname: Sample\ndaily_report_emails: [old@example.com]\n---\nBody\n';
      const applied = applyAdminStoreProductPatchToMarkdown(source, normalized.patch);
      expect(applied.content).toContain(`daily_report_emails: ${recipients.length ? '["runner@example.com"]' : '[]'}`);
      expect(applied.content).not.toContain('old@example.com');
    }
  });
  it('rejects invalid recipients at the server and preserves omitted configuration', () => {
    const base = { intent: 'publish', productId: 'sample' };
    expect(normalizeAdminStoreProductPublishBody({ ...base, fields: { dailyReportEmails: ['bad'] } }, env()).ok).toBe(false);
    const valid = normalizeAdminStoreProductPublishBody({ ...base, fields: { name: 'New title' } }, env());
    expect(valid.patch.frontMatter.some((field: any) => field.key === 'daily_report_emails')).toBe(false);
  });
});

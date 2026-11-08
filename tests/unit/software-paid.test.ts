import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { softwareBilling, softwareBillingWatchdog } from '../../worker/src/software-billing.js';
import { softwareStripe } from '../../worker/src/software-stripe.js';
import { softwareOffer, softwareOrderSnapshot } from '../../worker/src/software-offers.js';
import { validateStoreOrderDraft } from '../../worker/src/catalog.js';
import { buildStoreOrderDraft, hashStoreOrderDraft } from '../../worker/src/orders.js';
import { Storage } from './helpers/storage';
import { MemoryKV } from './helpers/memory-kv';

let storage: Storage, kv: MemoryKV, env: any, billing: any, stripe: any, receipts: any[], refunds: Map<string, any>, creates: number;
const orderToken = `store-order-${'a'.repeat(64)}`;
const offer = { product: 'ascii-vj-remix', seats: 1, billing: 'month' };
const lines = [
  { id: 'line-0', kind: 'merch', name: 'Shirt', unitAmount: 2500, quantity: 1, purchasedQuantity: 1 },
  { id: 'line-1', kind: 'ticket', name: 'Ticket', unitAmount: 1500, quantity: 1, purchasedQuantity: 1 },
  { id: 'line-2', kind: 'license', name: 'ASCII', unitAmount: 800, renewalAmount: 1000, quantity: 1, purchasedQuantity: 1, interval: 'month', taxable: true, offer }
];
const snapshot = { id: orderToken, currency: 'usd', total: 4800, lines };
const order = () => ({ orderToken, orderHash: 'frozen', orderDraft: { customer: { email: 'buyer@example.test' }, preferredLang: 'en', billingAddress: null },
  payment: { paymentIntentId: 'pi_first', billing: { snapshot, customerId: 'cus_one', subscriptionId: 'sub_one', initialInvoiceId: 'in_first', items: [{ id: 'si_software', metadata: { order_line_id: 'line-2' } }] } } });
const invoice = (id: string, initial = false) => ({ id, status: 'paid', livemode: false, customer: 'cus_one', currency: 'usd',
  parent: { subscription_details: { subscription: 'sub_one' } }, amount_due: initial ? 4800 : 1100, amount_paid: initial ? 4800 : 1100,
  status_transitions: { paid_at: 1793793600 },
  lines: { has_more: false, data: initial ? lines.map(line => ({ id: `il_${line.id}`, currency: 'usd', quantity: 1, amount: line.interval ? 1000 : line.unitAmount,
    discount_amounts: line.interval ? [{ amount: 200 }] : [], metadata: { order_line_id: line.id },
    ...(line.interval ? { parent: { subscription_item_details: { subscription_item: 'si_software' } }, period: { start: 100, end: 200 } } : {}) }))
    : [{ currency: 'usd', quantity: 1, amount: 1000, parent: { subscription_item_details: { subscription_item: 'si_software' } }, period: { start: 300, end: 400 } },
      { currency: 'usd', quantity: 1, amount: 100, metadata: { order_line_id: 'tax' } }] }
});
let invoices: Map<string, any>;
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
  storage = new Storage(); kv = new MemoryKV(); receipts = []; refunds = new Map(); creates = 0;
  invoices = new Map([['in_first', invoice('in_first', true)], ['in_next', invoice('in_next')]]);
  env = { APP_MODE: 'test', SOFTWARE_LICENSING_ENABLED: 'true', SOFTWARE_CHECKOUT_ENABLED: 'true', LICENSING_KEY_SECRET: 'synthetic-key-secret-at-least-32-bytes', LICENSING_ADMIN_SECRET: 'synthetic',
    STORE_STATE: kv, RESEND_API_KEY: 're_test', SALES_TAX_RATE: '0.10', TAX_PROVIDER: 'flat',
    LICENSING_SERVICE: { fetch: async (request: Request) => { const p: any = await request.json(); receipts.push(p); return Response.json({ id: p.id, coverageId: p.coverageId, revision: p.revision }); } } };
  stripe = {
    invoices: { retrieve: async (id: string) => structuredClone(invoices.get(id)), list: vi.fn(async () => ({ has_more: false, data: [...invoices.values()].map(value => structuredClone(value)) })), pay: vi.fn(async () => ({})) },
    invoicePayments: { list: async ({ invoice: id }: any) => ({ has_more: false, data: [{ payment: { type: 'payment_intent', payment_intent: id === 'in_first' ? 'pi_first' : 'pi_next' } }] }) },
    paymentIntents: { retrieve: async (id: string) => ({ id, livemode: false, amount: id === 'pi_first' ? 4800 : 1100, amount_received: id === 'pi_first' ? 4800 : 1100, status: 'succeeded', currency: 'usd', metadata: { orderToken, orderHash: 'frozen' } }) },
    subscriptions: { update: vi.fn(async () => ({ id: 'sub_one', cancel_at_period_end: true, cancel_at: 200 })) },
    extra: vi.fn(async () => ({ id: 'ii_tax' })),
    refunds: {
      create: async (p: any, opts: any) => { creates++; let r = refunds.get(opts.idempotencyKey); if (!r) { r = { id: `re_${refunds.size}`, status: 'succeeded', currency: 'usd', created: 1793793600, ...p }; refunds.set(opts.idempotencyKey, r); } return structuredClone(r); },
      retrieve: async (id: string) => structuredClone([...refunds.values()].find(r => r.id === id))
    }
  };
  billing = softwareBilling({ storage }, env, stripe);
  expect(await billing.handle('register', { order: order() })).toEqual({ registered: true });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const settle = (id = 'in_first', eventId = 'evt_paid') => billing.handle('invoice', { invoiceId: id, eventId });
const requestRefund = (id: string, paymentId: string, lineId: string, amountCents: number) => billing.handle('refund', { id, paymentId, allocations: [{ lineId, amountCents }], actor: 'operator@example.test' });

describe('paid Store billing authority', () => {
  it('persists one balanced receipt and license intent under concurrent webhook replay; failed email does not undo coverage', async () => {
    const replies = await Promise.all(Array.from({ length: 12 }, () => settle()));
    expect(replies.every(value => value.paid)).toBe(true);
    expect([...storage.data.keys()].filter(key => key.startsWith('billing-ledger:paid:'))).toHaveLength(1);
    const put = kv.put.bind(kv); kv.put = async () => { throw new Error('outbox unavailable'); };
    await billing.drain(); await billing.drain();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].policy).toEqual({ kind: 'term', start: 0, end: 200000 });
    expect(await billing.handle('recover', { lineId: 'line-2' })).toMatchObject({ email: 'buyer@example.test', key: expect.stringMatching(/^DW-/) });
    kv.put = put; vi.setSystemTime(Date.now() + 5000); await billing.drain();
    expect(receipts).toHaveLength(1);
    const ledger = await storage.get('billing-ledger:paid:in_first');
    expect(ledger.postings.reduce((sum: number, p: any) => sum + p.cents, 0)).toBe(0);
  });
  it('recalculates renewal tax before allowing collection, then grants only the newly paid software period', async () => {
    await settle(); await billing.drain();
    const draft = invoice('in_next'); draft.status = 'draft'; draft.lines.data.pop(); invoices.set('in_next', draft);
    expect(await settle('in_next', 'evt_draft')).toMatchObject({ prepared: true });
    expect(stripe.extra.mock.calls.slice(-3)).toEqual([
      ['/invoices/in_next', { auto_advance: false }],
      ['/invoiceitems', expect.objectContaining({ invoice: 'in_next', amount: 100 }), 'store-renewal-tax:in_next'],
      ['/invoices/in_next/finalize', { auto_advance: true }, 'store-renewal-finalize:in_next']
    ]);
    invoices.set('in_next', invoice('in_next'));
    expect(await settle('in_next', 'evt_renewed')).toMatchObject({ paid: true });
    await billing.drain(); await billing.drain();
    expect(receipts).toHaveLength(2);
    expect(receipts[1].id).toBe(receipts[0].id);
    expect(receipts[1].policy).toEqual({ kind: 'term', start: 300000, end: 400000 });
    const paid = await storage.get('billing-payment:in_next');
    expect(paid.items.map((x: any) => x.kind)).toEqual(['license', 'tax']);
  });
  it('does not grant unpaid, manually paid, unknown, changed or tax-unprepared renewals', async () => {
    expect(await settle('in_next')).toMatchObject({ error: expect.stringContaining('tax snapshot') });
    invoices.get('in_first').status = 'open'; expect(await settle()).toEqual({ pending: true });
    invoices.get('in_first').status = 'paid'; invoices.get('in_first').paid_out_of_band = true;
    expect(await settle()).toHaveProperty('error');
    invoices.get('in_first').paid_out_of_band = false; invoices.get('in_first').lines.data[2].amount++;
    expect(await settle()).toHaveProperty('error');
    expect([...storage.data.keys()].filter(key => key.startsWith('billing-ledger:'))).toHaveLength(0);
  });
  it('reserves refunds atomically, tolerates lost provider replies, and revokes only a fully refunded software period', async () => {
    await settle(); await billing.drain();
    const partial = await Promise.all(Array.from({ length: 12 }, () => requestRefund('partial', 'in_first', 'line-2', 200)));
    expect(partial.every(value => value.id === 'partial')).toBe(true);
    expect(await requestRefund('over', 'in_first', 'line-2', 700)).toHaveProperty('error');
    const create = stripe.refunds.create; let lose = true;
    stripe.refunds.create = async (...args: any[]) => { const value = await create(...args); if (lose) { lose = false; throw new Error('lost after commit'); } return value; };
    await billing.drain(); vi.setSystemTime(Date.now() + 5000); await billing.drain();
    expect(refunds.size).toBe(1); expect(creates).toBe(2);
    expect((await billing.handle('status', {})).reviews).toContainEqual(expect.objectContaining({ reason: 'partial_software_refund' }));
    expect(receipts.filter(value => value.revision === 1)).toHaveLength(0);
    await requestRefund('rest', 'in_first', 'line-2', 600); await billing.drain(); await billing.drain();
    expect(receipts.filter(value => value.revision === 1)).toHaveLength(1);
    await settle('in_first', 'evt_stale'); await billing.drain();
    expect(receipts.filter(value => value.revision === 0)).toHaveLength(1);
    expect(await requestRefund('merch', 'in_first', 'line-0', 2500)).toMatchObject({ state: 'pending' });
    await billing.drain(); await billing.drain();
    expect(receipts.filter(value => value.revision === 1)).toHaveLength(1);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(await billing.handle('cancel', {})).toMatchObject({ cancelled: true });
    for (const [key, value] of storage.data) if (key.startsWith('billing-ledger:')) expect(value.postings.reduce((sum: number, p: any) => sum + p.cents, 0)).toBe(0);
  });
  it('never replays an unknown refund after Stripe idempotency expiry and releases failed refund reservations', async () => {
    await settle(); await requestRefund('lost', 'in_first', 'line-2', 100);
    vi.setSystemTime(Date.now() + 24 * 3600000); await billing.drain(); expect(creates).toBe(0);
    expect((await storage.get('billing-refund:lost')).state).toBe('review');
    await requestRefund('declined', 'in_first', 'line-2', 700);
    const create = stripe.refunds.create; stripe.refunds.create = async (...args: any[]) => ({ ...await create(...args), status: 'failed' });
    await billing.drain(); expect((await storage.get('billing-refund:declined')).state).toBe('failed');
    expect(await requestRefund('retry', 'in_first', 'line-2', 700)).toMatchObject({ state: 'pending' });
  });
  it('fails closed for live mode and a changed key secret', async () => {
    await settle(); await billing.drain(); env.LICENSING_KEY_SECRET = 'changed-secret-at-least-32-bytes-long';
    expect(await billing.handle('recover', { lineId: 'line-2' })).toMatchObject({ status: 503 });
    env.APP_MODE = 'live'; expect(await billing.handle('status', {})).toMatchObject({ status: 503 });
  });
  it('does not announce a new key when the grant acknowledgement reports an earlier refund tombstone', async () => {
    env.LICENSING_SERVICE.fetch = async (request: Request) => {
      const payload: any = await request.json();
      return Response.json({ id: payload.id, coverageId: payload.coverageId, revision: 1 });
    };
    await settle(); await billing.drain(); await billing.drain();
    expect(await storage.get('billing-work:mail-key-line-2')).toBeUndefined();
  });
  it('does not double-apply a refund when a provider event overlaps the alarm', async () => {
    await settle(); await requestRefund('race', 'in_first', 'line-2', 800);
    const create = stripe.refunds.create; let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let first = true;
    stripe.refunds.create = async (...args: any[]) => {
      const hold = first; first = false;
      const result = await create(...args);
      if (hold) { entered(); await gate; }
      return result;
    };
    const draining = billing.drain();
    await started;
    const refund = [...refunds.values()][0]; expect(refund).toBeTruthy();
    expect(await billing.handle('refund-event', { refundId: refund.id })).toEqual({ reconciled: true });
    release(); await draining;
    expect(await storage.get('billing-refund-settled:in_first:line-2')).toBe(800);
    expect([...storage.data.keys()].filter(key => key.startsWith('billing-ledger:refund:'))).toHaveLength(1);
  });
  it('reuses a tax item after a prolonged lost-response outage and keeps collection paused on tax failure', async () => {
    const draft = invoice('in_next'); draft.status = 'draft'; draft.lines.data.pop(); invoices.set('in_next', draft);
    expect(await settle('in_next', 'evt_draft')).toMatchObject({ prepared: true });
    invoices.get('in_next').lines.data.push({ amount: 100, currency: 'usd', metadata: { order_line_id: 'tax' } });
    vi.setSystemTime(Date.now() + 25 * 3600000); stripe.extra.mockClear();
    expect(await settle('in_next', 'evt_replay')).toMatchObject({ prepared: true });
    expect(stripe.extra.mock.calls.some(([path]: any[]) => path === '/invoiceitems')).toBe(false);
    const failed = invoice('in_other'); failed.status = 'draft'; failed.lines.data.pop(); invoices.set('in_other', failed);
    env.TAX_PROVIDER = 'offline_rules'; stripe.extra.mockClear();
    expect(await settle('in_other', 'evt_missing_address')).toHaveProperty('error');
    expect(stripe.extra.mock.calls).toEqual([['/invoices/in_other', { auto_advance: false }]]);
  });
  it('discovers due work from canonical orders and registers each billing owner before recovery', async () => {
    await kv.put(`orders:${orderToken}`, JSON.stringify(order()));
    await kv.put('orders:ordinary', JSON.stringify({ payment: {} }));
    const fetch = vi.fn(async () => Response.json({ drained: true }));
    env.STORE_INVENTORY_COORDINATOR = { idFromName: (value: string) => value, get: () => ({ fetch }) };
    expect(await softwareBillingWatchdog(env)).toEqual({ checked: 2, drained: 1, failed: 0 });
    expect(fetch.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual(['/license-owner', '/billing-reconcile']);
    expect(await kv.get('software-billing-watchdog:v1', { type: 'json' })).toEqual({ cursor: '' });
  });
  it('discovers missed draft and paid renewal notifications from bounded provider pages', async () => {
    await settle(); await billing.drain();
    const draft = invoice('in_next'); draft.status = 'draft'; draft.lines.data.pop(); invoices.set('in_next', draft);
    expect(await billing.handle('reconcile', {})).toEqual({ drained: true });
    expect(await storage.get('billing-tax:in_next')).toMatchObject({ taxCents: 100 });
    invoices.set('in_next', invoice('in_next'));
    await billing.handle('reconcile', {}); await billing.drain();
    expect(await storage.get('billing-payment:in_next')).toBeTruthy();
    expect(receipts).toHaveLength(2);
    expect(stripe.invoices.list).toHaveBeenCalledWith({ subscription: 'sub_one', limit: 25 });
  });
  it('recovers collection after finalization, rejecting changed lines before attempting payment', async () => {
    const draft = invoice('in_next'); draft.status = 'draft'; draft.lines.data.pop(); invoices.set('in_next', draft);
    await settle('in_next', 'evt_prepare');
    const open: any = invoice('in_next'); open.status = 'open'; open.attempted = false;
    invoices.set('in_next', open); stripe.invoices.pay.mockClear();
    open.lines.data[0].amount++;
    expect(await settle('in_next', 'evt_changed')).toHaveProperty('error');
    expect(stripe.invoices.pay).not.toHaveBeenCalled();
    open.lines.data[0].amount--;
    stripe.invoices.pay.mockImplementation(async () => { invoices.set('in_next', invoice('in_next')); return invoice('in_next'); });
    expect(await settle('in_next', 'evt_resume')).toMatchObject({ paid: true });
    expect(stripe.invoices.pay).toHaveBeenCalledExactlyOnceWith('in_next', {}, { idempotencyKey: 'store-renewal-pay:in_next' });
    expect(await storage.get('billing-payment:in_next')).toBeTruthy();
  });
});

describe('repository software offer contract', () => {
  it('ignores cart policy injection, pins all paid policies in the hash, and rejects legacy/live/free checkout', async () => {
    const product = { id: 'ascii', sku: 'ascii', price_cents: 1000, fulfillment_type: 'digital', currency: 'USD', software_license: offer };
    const input = { items: [{ id: 'ascii', quantity: 1, softwareLicense: { billing: 'once', updates: { kind: 'lifetime' } } }], email: 'buyer@example.test', tipPercent: 0 };
    const validation = validateStoreOrderDraft(input, { env, snapshot: { products: [product] } });
    expect(validation.valid).toBe(true); expect(validation.items[0].softwareLicense).toEqual(offer);
    const draft = buildStoreOrderDraft(input, { env, validation, orderToken }).orderDraft;
    expect(softwareOrderSnapshot(draft).lines[0]).toMatchObject({ interval: 'month', renewalAmount: 1000 });
    const hash = await hashStoreOrderDraft(draft);
    for (const updates of [{ kind: 'lifetime' }, { kind: 'major', major: 2 }, { kind: 'term', days: 365 }]) {
      const license = softwareOffer({ ...product, software_license: { ...offer, billing: 'once', updates } }, null, env);
      expect(license.updates).toEqual(updates);
      draft.items[0].softwareLicense = license;
      expect(await hashStoreOrderDraft(draft)).not.toBe(hash);
    }
    expect(validateStoreOrderDraft(input, { env: { ...env, APP_MODE: 'live' }, snapshot: { products: [product] } }).valid).toBe(false);
    expect(validateStoreOrderDraft(input, { env, snapshot: { products: [{ ...product, price_cents: 0 }] } }).valid).toBe(false);
  });
});

it('uses Worker-compatible manual redirects and bounded bodies for Store-only Stripe operations', async () => {
  env.STRIPE_SECRET_KEY_TEST = 'sk_test_synthetic';
  const fetch = vi.fn(async (_url: string, options: any) => {
    expect(options.redirect).toBe('manual');
    return new Response('', { status: 302, headers: { Location: 'https://untrusted.example.test' } });
  });
  vi.stubGlobal('fetch', fetch);
  await expect(softwareStripe(env).extra('/coupons', {}, 'fixture')).rejects.toThrow('redirect rejected');
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockImplementation(async () => new Response('{}', { headers: { 'Content-Length': String(2 * 1024 * 1024) } }));
  await expect(softwareStripe(env).extra('/coupons', {}, 'fixture')).rejects.toThrow('cap');
});

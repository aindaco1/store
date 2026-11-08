import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import worker, { signStoreFulfillmentToken } from '../../worker/src/index.js';
import { softwarePaymentRecovery, stripeHostedUrl } from '../../worker/src/software-payment-recovery.js';
import { softwareBilling } from '../../worker/src/software-billing.js';
import { MemoryKV } from './helpers/memory-kv';
import { Storage } from './helpers/storage';

const orderToken = `store-order-${'d'.repeat(64)}`;
const other = `store-order-${'e'.repeat(64)}`;
let env: any, call: any, storage: Storage, stripe: any, order: any, session: any, setup: any;
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
  storage = new Storage();
  call = vi.fn(async (request: Request) => {
    const action = new URL(request.url).pathname;
    if (action.endsWith('recover')) return Response.json({ key: 'DW-test', id: 'grant-one', product: 'ascii-vj-remix', keyHash: 'private' });
    if (action.endsWith('customer')) return Response.json({ licenses: [{ lineId: 'line-0', releases: [{ id: 'release-one', version: '1.0.0' }] }], renewal: null, invoices: [] });
    return Response.json({ updated: true });
  });
  env = { APP_MODE: 'test', SOFTWARE_LICENSING_ENABLED: 'true', SITE_BASE: 'https://shop.test', STORE_FULFILLMENT_SECRET: 'fixture-secret',
    STORE_STATE: new MemoryKV(), RATELIMIT: new MemoryKV(), OBSERVABILITY_SAMPLE_RATE: '0',
    STORE_INVENTORY_COORDINATOR: { idFromName: (id: string) => id, get: () => ({ fetch: call }) }, LICENSING_ADMIN_SECRET: 'test',
    LICENSING_SERVICE: { fetch: vi.fn(async () => new Response('archive')) } };
  await env.STORE_STATE.put(`orders:${orderToken}`, JSON.stringify({ orderToken, status: 'confirmed', payment: { required: true, status: 'succeeded' },
    orderDraft: { preferredLang: 'en', items: [{ softwareLicense: { billing: 'month' } }] } }));
  order = { orderToken, preferredLang: 'en', billing: { customerId: 'cus_one', subscriptionId: 'sub_one', initialInvoiceId: 'in_first', items: [] }, snapshot: { currency: 'usd', lines: [] } };
  session = { id: 'cs_test_one', livemode: false, mode: 'setup', status: 'open', customer: 'cus_one', metadata: { orderToken }, url: 'https://checkout.stripe.com/c/pay/test', setup_intent: 'seti_one' };
  setup = { id: 'seti_one', livemode: false, status: 'succeeded', customer: 'cus_one', metadata: { orderToken, subscriptionId: 'sub_one' }, payment_method: 'pm_one' };
  stripe = { subscriptions: { retrieve: vi.fn(async () => ({ id: 'sub_one', livemode: false, customer: 'cus_one', status: 'active', metadata: { orderToken }, pause_collection: { behavior: 'keep_as_draft' } })), update: vi.fn(async () => ({})) },
    checkout: { sessions: { create: vi.fn(async () => session), retrieve: vi.fn(async () => session) } },
    setupIntents: { retrieve: vi.fn(async () => setup) }, customers: { update: vi.fn(async () => ({})) }, invoices: { retrieve: vi.fn() } };
});
afterEach(() => vi.useRealTimers());
async function request(action: string, payload: any, tokenOrder = orderToken, origin = 'https://shop.test') {
  return worker.fetch(new Request(`https://checkout.test/api/orders/${tokenOrder}/software/${action}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), env, { waitUntil() {} });
}
const managementToken = () => signStoreFulfillmentToken(env, { orderToken, itemId: 'software', action: 'manage' }, 900);
const recovery = (action: string, payload: any = {}) => softwarePaymentRecovery(action, payload, { storage, stripe, order, returnUrl: `https://shop.test/order-success/?orderToken=${orderToken}` });

describe('private order software access', () => {
  it('rejects missing, expired, cross-order and cross-origin capabilities before reading billing', async () => {
    const token = await managementToken();
    expect((await request('recover', {})).status).toBe(403);
    expect((await request('recover', { token }, other)).status).toBe(403);
    expect((await request('recover', { token }, orderToken, 'https://attacker.test')).status).toBe(403);
    vi.setSystemTime(Date.now() + 901000);
    expect((await request('recover', { token })).status).toBe(410);
    expect(call).not.toHaveBeenCalled();
  });
  it('reveals only the requested key and scopes downloads to a fresh authorization check', async () => {
    const token = await managementToken();
    const revealed = await request('recover', { token, lineId: 'line-0' });
    expect(await revealed.json()).toEqual({ key: 'DW-test' });
    expect(revealed.headers.get('cache-control')).toContain('no-store');
    const result: any = await (await request('status', { token })).json();
    const url = result.licenses[0].releases[0].url;
    const download = () => worker.fetch(new Request(url), env, { waitUntil() {} });
    expect(await (await download()).text()).toBe('archive');
    env.LICENSING_SERVICE.fetch.mockImplementation(async () => Response.json({ error: 'not_covered' }, { status: 403 }));
    expect((await download()).status).toBe(403);
    const changed = new URL(url); changed.searchParams.set('releaseId', 'another');
    expect((await worker.fetch(new Request(changed), env, { waitUntil() {} })).status).toBe(403);
  });
  it('keeps paid management unavailable in production and for unconfirmed orders', async () => {
    const token = await managementToken(); env.APP_MODE = 'live';
    expect((await request('cancel', { token })).status).toBe(404);
    env.APP_MODE = 'test'; await env.STORE_STATE.put(`orders:${orderToken}`, JSON.stringify({ status: 'pending' }));
    expect((await request('cancel', { token })).status).toBe(409); expect(call).not.toHaveBeenCalled();
  });
});

describe('Stripe hosted payment recovery', () => {
  it('creates a setup-only session and applies its verified method once without charging', async () => {
    const id = 'a'.repeat(32);
    expect(await recovery('card-setup', { id })).toEqual({ url: session.url });
    await recovery('card-setup', { id }); expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(stripe.checkout.sessions.create.mock.calls[0][0]).toMatchObject({ mode: 'setup', customer: 'cus_one' });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    session.status = 'complete';
    await recovery('card-complete', { sessionId: session.id }); await recovery('card-complete', { sessionId: session.id });
    expect(stripe.subscriptions.update).toHaveBeenCalledExactlyOnceWith('sub_one', { default_payment_method: 'pm_one' }, { idempotencyKey: 'store-card-subscription:seti_one' });
  });
  it('rejects incomplete, mismatched and superseded setup results', async () => {
    await recovery('card-setup', { id: 'a'.repeat(32) });
    await expect(recovery('card-complete', { sessionId: 'cs_other' })).rejects.toThrow();
    await expect(recovery('card-complete', { sessionId: session.id })).rejects.toThrow('not complete');
    session.status = 'complete'; setup.customer = 'cus_other';
    await expect(recovery('card-complete', { sessionId: session.id })).rejects.toThrow('ownership');
    setup.customer = 'cus_one'; setup.livemode = true;
    await expect(recovery('card-complete', { sessionId: session.id })).rejects.toThrow('ownership');
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it('rejects recovery without the provider tax guard and unsafe redirect hosts', async () => {
    stripe.subscriptions.retrieve.mockImplementation(async () => ({ livemode: false, customer: 'cus_one', metadata: { orderToken } }));
    await expect(recovery('card-setup', { id: 'a'.repeat(32) })).rejects.toThrow('tax guard');
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('serializes completion callbacks and ignores a superseded setup webhook', async () => {
    await storage.put('billing-order',order);
    const billing = softwareBilling({storage},env,stripe);
    await billing.handle('card-setup',{id:'a'.repeat(32),returnUrl:'https://shop.test/order-success/?orderToken='+orderToken});
    session.status='complete';
    const results=await Promise.all(Array.from({length:8},()=>billing.handle('card-complete-event',{sessionId:session.id})));
    expect(results.every(result=>result.updated)).toBe(true);
    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    await storage.put('billing-card-setup',{sessionId:'cs_new',id:'b'.repeat(32),createdAt:Date.now()});
    expect(await billing.handle('card-complete-event',{sessionId:session.id})).toEqual({ignored:true});
    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
  });
  it('retries a lost subscription update with the original setup identity', async () => {
    await recovery('card-setup', {id:'a'.repeat(32)}); session.status='complete';
    stripe.subscriptions.update.mockRejectedValueOnce(new Error('lost response'));
    await expect(recovery('card-complete',{sessionId:session.id})).rejects.toThrow('lost response');
    expect((await storage.get('billing-card-setup')).complete).toBeUndefined();
    await recovery('card-complete',{sessionId:session.id});
    expect(stripe.subscriptions.update.mock.calls[0]).toEqual(stripe.subscriptions.update.mock.calls[1]);
    expect(stripe.customers.update.mock.calls[0]).toEqual(stripe.customers.update.mock.calls[1]);
    expect((await storage.get('billing-card-setup')).complete).toBe(true);
  });
  it.each(['http://checkout.stripe.com/test','https://checkout.stripe.com.attacker.test/test','https://user@checkout.stripe.com/test','https://checkout.stripe.com:8443/test','javascript:alert(1)'])('rejects an unsafe hosted payment URL: %s', value => {
    expect(()=>stripeHostedUrl(value,'checkout.stripe.com')).toThrow();
  });
  it('offers only the existing, tax-verified open invoice for payment', async () => {
    const invoice = { id: 'in_next', status: 'open', livemode: false, customer: 'cus_one', currency: 'usd', amount_due: 1000,
      parent: { subscription_details: { subscription: 'sub_one' } }, lines: { has_more: false, data: [{ amount: 1000, currency: 'usd', quantity: 1, metadata: { order_line_id: 'tax' } }] },
      hosted_invoice_url: 'https://invoice.stripe.com/i/test' };
    stripe.invoices.retrieve.mockImplementation(async () => invoice);
    await expect(recovery('invoice-page', { invoiceId: invoice.id })).rejects.toThrow('not available');
    await storage.put('billing-tax:in_next', { lines: [{ id: 'tax', kind: 'tax', renewalTax: true, unitAmount: 1000, quantity: 1 }] });
    expect(await recovery('invoice-page', { invoiceId: invoice.id })).toEqual({ url: invoice.hosted_invoice_url });
    invoice.lines.data[0].amount++;
    await expect(recovery('invoice-page', { invoiceId: invoice.id })).rejects.toThrow();
  });
});

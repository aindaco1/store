// Actual Store + licensing Workers and Stripe test-mode APIs. Synthetic fixtures
// only; all email uses Store's existing dry-run path. No deployment is performed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStripeClient, DEFAULT_STRIPE_API_VERSION } from '../../worker/src/stripe.js';

if (!process.argv.includes('--test-mode')) throw new Error('Explicit --test-mode required');
const source = parseEnv(await readFile(new URL('../../worker/.dev.vars', import.meta.url), 'utf8'));
const secretKey = source.STRIPE_SECRET_KEY_TEST || source.STRIPE_SECRET_KEY;
if (!secretKey?.startsWith('sk_test_')) throw new Error('Only Stripe test keys are accepted');
const root = fileURLToPath(new URL('../..', import.meta.url));
const licensingRoot = path.resolve(root, '../dust-wave-licensing');
const require = createRequire(path.join(licensingRoot, 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { buildSync, build } = require('esbuild');
const key = () => randomBytes(32).toString('hex');
const secret = key(), run = `paid-${key().slice(0, 16)}`;
const temp = await mkdtemp('/private/tmp/store-paid-runtime-');
const origin = 'http://127.0.0.1:8798';
const stripe = createStripeClient(secretKey);
const resources = { customers: new Set(), products: new Set(), prices: new Set(), coupons: new Set(), subscriptions: new Set(), sessions: new Set() };
const evidence = { run, testMode: true, apiVersion: DEFAULT_STRIPE_API_VERSION, checks: [], cleanup: [], realEmailsSent: 0 };
let clock, mf;
const reportPath = fileURLToPath(new URL('./paid-runtime-result.json', import.meta.url));
async function api(method, endpoint, fields = {}) {
  const response = await fetch(`https://api.stripe.com/v1${endpoint}`, { method, signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${secretKey}`, 'Stripe-Version': DEFAULT_STRIPE_API_VERSION, 'Content-Type': 'application/x-www-form-urlencoded' },
    ...(method === 'GET' ? {} : { body: new URLSearchParams(fields) }) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(`Stripe ${method} ${endpoint.split('/')[1]}: ${response.status} ${result.error?.code || result.error?.message || ''}`), { statusCode: response.status });
  return result;
}
async function waitFor(fn, label) {
  for (let i = 0; i < 45; i++) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 1000)); }
  throw new Error(`Timed out: ${label}`);
}
try {
  clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: run });
  const storeScript = (await build({ stdin: { resolveDir: root, contents: `
    import worker from './worker/src/index.js';
    export { StoreInventoryCoordinator } from './worker/src/index.js';
    import { createAdminLoginUrl } from './worker/src/admin-auth.js';
    import { processEmailOutbox } from './worker/src/email-outbox.js';
    export default { async fetch(request,env,ctx) {
      const p=new URL(request.url).pathname;
      if(p.startsWith('/probe/') && request.headers.get('Authorization')!=='Bearer '+env.PROBE_SECRET)return new Response(null,{status:403});
      if(p==='/probe/login')return Response.json({url:await createAdminLoginUrl(env,{email:'operator@example.test'})});
      if(p==='/probe/mail')return Response.json(await processEmailOutbox(env));
      return worker.fetch(request,env,ctx);
    }};` }, bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'probe-errors', setup(build) { build.onLoad({ filter: /checkout-coordinator\.js$/ }, async ({ path }) => ({ contents: (await readFile(path, 'utf8')).replace('} catch (_error) {\n      // An ambiguous create', '} catch (_error) {\n      console.error("Probe creation failure", _error.name, String(_error.message).replace(/sk_test_[A-Za-z0-9]+/g, "[redacted]"));\n      // An ambiguous create'), loader: 'js' })); } }], banner: { js: 'import {createRequire} from "node:module"; const require=createRequire("/worker.js");' } })).outputFiles[0].text;
  const licensingScript = buildSync({ entryPoints: [path.join(licensingRoot, 'src/worker.js')], bundle: true, write: false, format: 'esm', platform: 'browser' }).outputFiles[0].text;
  const product = (id, price, type, extra = {}) => ({ id, sku: id, name: id, price_cents: price, currency: 'USD', fulfillment_type: type, status: 'active', ...extra });
  const offer = billing => ({ product: 'ascii-vj-remix', seats: 1, billing });
  const catalog = { version: 1, source: 'synthetic-paid-probe', products: [
    product('shirt', 2500, 'physical', { inventory_tracking: true, inventory: 10 }),
    product('ticket', 1500, 'ticket', { inventory_tracking: true, inventory: 10 }),
    product('monthly', 1000, 'digital', { software_license: offer('month') }),
    product('annual', 10000, 'digital', { software_license: offer('year') }),
    ...[{ kind: 'lifetime' }, { kind: 'major', major: 1 }, { kind: 'term', days: 365 }].map(updates => product(updates.kind, 1000, 'digital', { software_license: { ...offer('once'), updates } }))
  ] };
  mf = new Miniflare(convertV4MiniflareOptions({ resourcePersistencePath: path.join(temp, 'storage'), workers: [
    { name: 'store', modules: true, script: storeScript, compatibilityDate: '2026-10-30', compatibilityFlags: ['nodejs_compat'],
      bindings: { APP_MODE: 'test', SOFTWARE_LICENSING_ENABLED: 'true', SOFTWARE_CHECKOUT_ENABLED: 'true', LICENSING_ADMIN_SECRET: secret, LICENSING_KEY_SECRET: key(), PROBE_SECRET: secret,
        STORE_FULFILLMENT_SECRET: key(), SITE_BASE: origin, WORKER_BASE: origin, CORS_ALLOWED_ORIGIN: origin, ADMIN_SESSION_SECRET: key(), ADMIN_USERS_JSON: JSON.stringify([{ email: 'operator@example.test', role: 'super_admin' }]),
        STRIPE_SECRET_KEY_TEST: secretKey, STRIPE_PUBLISHABLE_KEY_TEST: source.STRIPE_PUBLISHABLE_KEY_TEST || source.STRIPE_PUBLISHABLE_KEY || 'pk_test_fixture', STRIPE_WEBHOOK_SECRET_TEST: secret,
        STORE_CATALOG_JSON: JSON.stringify(catalog), TAX_PROVIDER: 'flat', SALES_TAX_RATE: '0.10', USPS_ENABLED: 'false', SHIPPING_FALLBACK_FLAT_RATE: '5', DEFAULT_PLATFORM_TIP_PERCENT: '0',
        RESEND_API_KEY: 'dry-run', STORE_EMAIL_DRY_RUN: 'true', ORDERS_EMAIL_FROM: 'Dust Wave <orders@example.test>', SUPPORT_EMAIL: 'support@example.test', I18N_CATALOG_JSON: JSON.stringify({ en: { email: {} } }), OBSERVABILITY_SAMPLE_RATE: '0' },
      kvNamespaces: ['STORE_STATE', 'RATELIMIT'], durableObjects: { STORE_INVENTORY_COORDINATOR: { className: 'StoreInventoryCoordinator', useSQLite: true } }, serviceBindings: { LICENSING_SERVICE: 'licensing' },
      outboundService: async request => {
        const url = new URL(request.url);
        if (url.origin !== 'https://api.stripe.com') throw new Error('Unexpected external request');
        let body = request.method === 'GET' ? undefined : await request.text();
        if (url.pathname === '/v1/customers' && request.method === 'POST') {
          const fields = new URLSearchParams(body); fields.set('test_clock', clock.id); body = fields.toString();
        }
        const requestStarted = Date.now();
        const response = await fetch(request.url, { method: request.method, headers: Object.fromEntries([...request.headers].filter(([name]) => name !== 'content-length')), body, signal: AbortSignal.timeout(30000) });
        const result = await response.clone().json();
        console.log('Stripe probe', request.method, url.pathname.split('/')[2], response.status, Date.now() - requestStarted);
        if (result.livemode === true) throw new Error('Unexpected live object');
        for (const [family, prefix] of [['customers','cus_'],['products','prod_'],['coupons','coupon_'],['subscriptions','sub_']]) {
          if (result.id?.startsWith(prefix)) resources[family].add(result.id);
        }
        if (url.pathname === '/v1/checkout/sessions' && response.ok) resources.sessions.add(result.id);
        if (url.pathname === '/v1/coupons' && response.ok) resources.coupons.add(result.id);
        for (const item of result.items?.data || []) if (item.price?.id) resources.prices.add(item.price.id);
        if (!response.ok) console.error('Provider rejected', request.method, url.pathname.split('/')[2], response.status, result.error?.code || result.error?.message);
        return response;
      } },
    { name: 'licensing', modules: true, script: licensingScript, compatibilityDate: '2026-10-30', bindings: { APP_MODE: 'test', ADMIN_SECRET: secret, TOKEN_SECRET: key() },
      durableObjects: { PUBLISHER: { className: 'Publisher', useSQLite: true } }, r2Buckets: ['ARTIFACTS'] }
  ] }));
  const store = await mf.getWorker('store');
  let fixtureAddress = 1;
  // Separate synthetic requests from the production per-IP throttle budget.
  const call = async (route, payload, headers = {}) => store.fetch(`${origin}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': `192.0.2.${fixtureAddress++}`, ...headers }, body: JSON.stringify(payload) });
  const json = async response => { const value = await response.json(); assert.ok(response.ok, JSON.stringify({ status: response.status, ...value })); return value; };
  const login = await json(await call('/probe/login', {}, { Authorization: `Bearer ${secret}` }));
  const exchange = await call('/admin/auth/exchange', { token: new URL(login.url).searchParams.get('admin_login') });
  const session = await json(exchange);
  const admin = { Cookie: exchange.headers.get('set-cookie').split(';')[0], 'x-store-admin-csrf': session.csrfToken };
  const ns = await mf.getDurableObjectNamespace('STORE_INVENTORY_COORDINATOR', 'store');
  const kv = await mf.getKVNamespace('STORE_STATE', 'store');
  await kv.put('store-coupons:v1', JSON.stringify({ coupons: [{ code: 'PILOT', status: 'active', discountType: 'percent', percentOff: 20, appliesTo: 'products', productIds: ['monthly'] }] }));
  async function webhook(type, object, id = `evt_${key().slice(0, 16)}`) {
    const body = JSON.stringify({ id, type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
    const at = Math.floor(Date.now() / 1000), signature = createHmac('sha256', secret).update(`${at}.${body}`).digest('hex');
    const response = await store.fetch(`${origin}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${at},v1=${signature}` }, body });
    return json(response);
  }
  async function drain(token) {
    const stub = ns.get(ns.idFromName(`software-billing:${token}`));
    for (let i = 0; i < 3; i++) await stub.fetch('https://store/billing-drain', { method: 'POST', body: '{}' });
  }
  const address = { name: 'Synthetic Buyer', line1: '1 Test Street', city: 'Albuquerque', state: 'NM', postalCode: '87102', country: 'US' };
  const completed = [];
  for (const policies of [['lifetime'], ['major'], ['term'], ['monthly', 'annual']]) {
    const attemptId = key(), token = `store-order-${attemptId}`;
    const items = ['shirt', 'ticket', ...policies].map(id => ({ id, quantity: 1 }));
    await json(await call('/api/checkout/hold', { attemptId, items }));
    const checkout = await json(await call('/api/checkout/intent', { attemptId, items, email: 'buyer@example.test', tipPercent: 0, shippingAddress: address, billingAddress: address, shippingCents: 1, taxCents: 1, ...(policies.includes('monthly') ? { couponCode: 'PILOT' } : {}) }));
    assert.equal(checkout.totals.shippingCents, 500); // browser cannot underpay
    assert.equal(checkout.totals.taxCents, policies.length === 2 ? 1480 : 500);
    const intent = await api('POST', `/payment_intents/${checkout.paymentIntentId}/confirm`, { payment_method: 'pm_card_visa', return_url: `${origin}/return` });
    assert.equal(intent.status, 'succeeded');
    if (policies.includes('term')) {
      // Recover the original successful payment without any webhook delivery.
      const recovered = await json(await call('/admin/store/licenses/reconcile', { orderToken: token }, admin));
      assert.equal(recovered.paymentIntent, undefined);
    } else await webhook('payment_intent.succeeded', intent);
    await webhook('payment_intent.succeeded', intent); // different delivery ID, same money
    await drain(token);
    const stored = await kv.get(`orders:${token}`, 'json');
    assert.equal(stored.status, 'confirmed');
    const status = await json(await call('/admin/store/licenses/billing', { orderToken: token }, admin));
    assert.equal(status.payments.length, 1);
    const credential = await json(await call('/admin/store/licenses/paid-recover', { orderToken: token, lineId: 'line-2' }, admin));
    const licensing = await mf.getWorker('licensing');
    const activated = await json(await licensing.fetch('https://licensing/v1/activate', { method: 'POST', body: JSON.stringify({ key: credential.key, installation: 'synthetic-mac' }) }));
    assert.ok(activated.token);
    completed.push({ token, stored, status, activation: activated.token });
    evidence.checks.push({ policies, oneInitialPayment: true, amountCents: checkout.totals.totalCents, canonicalShippingTax: true, duplicateSettlement: true, licenseActivation: true });
    console.log('PASS checkout', policies.join('+'), checkout.totals.totalCents);
  }
  const combined = completed.at(-1), billing = combined.stored.payment.billing;
  const active = await stripe.subscriptions.retrieve(billing.subscriptionId);
  assert.equal(active.pause_collection.behavior, 'keep_as_draft');
  const summary = await json(await store.fetch(`${origin}/api/orders/${combined.token}`));
  assert.ok(summary.software.token);
  const customerCall = (action, payload = {}) => call(`/api/orders/${combined.token}/software/${action}`, {token:summary.software.token,...payload});
  const setupResult = await json(await customerCall('card-setup', {id:key().slice(0,32)}));
  assert.equal(new URL(setupResult.url).hostname,'checkout.stripe.com');
  const setupSession = await stripe.checkout.sessions.retrieve([...resources.sessions].at(-1));
  assert.equal(setupSession.mode,'setup');
  assert.equal(setupSession.customer,billing.customerId);
  assert.ok(setupSession.setup_intent?.startsWith('seti_'));
  assert.equal((await customerCall('card-complete',{sessionId:setupSession.id})).status,409);
  const setupIntent=await stripe.setupIntents.retrieve(setupSession.setup_intent);
  assert.equal(setupIntent.customer,billing.customerId);
  assert.equal(setupIntent.metadata.orderToken,combined.token);
  assert.equal(setupIntent.metadata.subscriptionId,billing.subscriptionId);
  assert.equal(setupIntent.status,'requires_payment_method');
  await api('POST',`/checkout/sessions/${setupSession.id}/expire`); resources.sessions.delete(setupSession.id);
  evidence.checks.push({hostedSetupCreated:true,setupModeOnly:true,incompleteSetupRejected:true,setupOwnershipVerified:true,sessionExpired:true,hostedFormCompleted:false});
  const end = Math.min(...active.items.data.map(item => item.current_period_end));
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: end + 60 });
  await waitFor(async () => (await stripe.testHelpers.testClocks.retrieve(clock.id)).status === 'ready', 'test clock');
  const renewal = await waitFor(async () => (await stripe.invoices.list({ subscription: billing.subscriptionId, limit: 10 })).data.find(item => item.id !== billing.initialInvoiceId), 'renewal invoice');
  assert.equal(renewal.status, 'draft');
  assert.equal(renewal.auto_advance, false);
  // Prove Store downtime longer than Stripe's normal webhook grace cannot bill
  // an unprepared renewal. Advance the provider clock without any Store event.
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: end + 4 * 86400 });
  await waitFor(async () => (await stripe.testHelpers.testClocks.retrieve(clock.id)).status === 'ready', 'renewal tax outage');
  assert.equal((await stripe.invoices.retrieve(renewal.id)).status, 'draft');
  // Withhold invoice.created: Store's bounded scan must discover the renewal.
  await json(await call('/admin/store/licenses/reconcile', { orderToken: combined.token }, admin));
  const prepared = await stripe.invoices.retrieve(renewal.id);
  assert.equal(prepared.amount_due, 1100); // monthly only + newly quoted tax
  const paid = await stripe.invoices.retrieve(renewal.id);
  assert.equal(paid.status, 'paid');
  await webhook('invoice.paid', paid);
  await webhook('invoice.payment_failed', renewal); // stale payload reconciles current paid truth
  await drain(combined.token);
  const renewed = await json(await call('/admin/store/licenses/billing', { orderToken: combined.token }, admin));
  assert.equal(renewed.payments.length, 2);
  evidence.checks.push({ renewalAmountCents: paid.amount_paid, oneTimeItemsNotRepeated: true, taxRecalculated: true, collectionHeldAtProvider: true, missedWebhookDiscovered: true, automaticallyCollectedAfterTax: true, staleFailurePreservedPaidCoverage: true });
  const licensing = await mf.getWorker('licensing');
  await (await mf.getR2Bucket('ARTIFACTS', 'licensing')).put('synthetic-app', 'synthetic artifact');
  const firstCoverage = combined.status.payments[0].items.find(item => item.orderLineId === 'line-2').coverage;
  const nextCoverage = renewed.payments.find(payment => payment.receipt.id === renewal.id).items.find(item => item.orderLineId === 'line-2').coverage;
  for (const [id, coverage] of [['first-release', firstCoverage], ['renewal-release', nextCoverage]]) {
    await json(await licensing.fetch('https://licensing/internal/publish', { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify({ id, product: 'ascii-vj-remix', key: 'synthetic-app', major: 1, releasedAt: coverage.start + 1000 }) }));
  }
  const download = (release, token = combined.activation) => licensing.fetch(`https://licensing/v1/releases/${release}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await download('first-release')).status, 200);
  assert.equal((await download('renewal-release')).status, 200);
  const library = await json(await customerCall('status'));
  const monthlyLibrary=library.licenses.find(item=>item.lineId==='line-2');
  const customerDownload=monthlyLibrary.releases.find(item=>item.id==='renewal-release').url;
  assert.equal((await store.fetch(customerDownload)).status,200);
  assert.equal((await customerCall('recover',{lineId:'line-2'})).status,200);
  const refund = { orderToken: combined.token, id: 'refund-renewal', paymentId: renewal.id, allocations: [{ lineId: 'line-2', amountCents: 1000 }] };
  assert.equal((await call('/admin/store/licenses/refunds', refund)).status, 401);
  assert.equal((await call('/admin/store/licenses/refunds', refund, { ...admin, 'x-store-admin-csrf': 'wrong' })).status, 403);
  await json(await call('/admin/store/licenses/refunds', refund, admin));
  await json(await call('/admin/store/licenses/refunds', refund, admin));
  await drain(combined.token);
  const refunded = await waitFor(async () => { await drain(combined.token); const state = await json(await call('/admin/store/licenses/billing', { orderToken: combined.token }, admin)); return state.refunds[0]?.state === 'succeeded' ? state : null; }, 'refund settlement');
  assert.equal(refunded.refunds.length, 1); assert.equal(refunded.refunds[0].state, 'succeeded');
  await drain(combined.token);
  assert.equal((await download('first-release')).status, 200);
  assert.equal((await download('renewal-release')).status, 403);
  assert.equal((await store.fetch(customerDownload)).status,403);
  evidence.checks.push({customerLibraryAndDownload:true,staleCustomerDownloadRevoked:true});
  const annual = await json(await call('/admin/store/licenses/paid-recover', { orderToken: combined.token, lineId: 'line-3' }, admin));
  const annualActivation = await json(await licensing.fetch('https://licensing/v1/activate', { method: 'POST', body: JSON.stringify({ key: annual.key, installation: 'annual-mac' }) }));
  assert.equal((await download('renewal-release', annualActivation.token)).status, 200);
  evidence.checks.push({ realPrivateDownloadRevokedForRefund: true, priorPeriodRetained: true, otherLicenseRetained: true });
  assert.equal((await stripe.subscriptions.retrieve(billing.subscriptionId)).cancel_at_period_end, false);
  await json(await call('/admin/store/licenses/cancel-renewals', { orderToken: combined.token }, admin));
  assert.equal((await stripe.subscriptions.retrieve(billing.subscriptionId)).cancel_at_period_end, true);
  await drain(combined.token);
  const mail = await json(await call('/probe/mail', {}, { Authorization: `Bearer ${secret}` }));
  const replay = await json(await call('/probe/mail', {}, { Authorization: `Bearer ${secret}` }));
  assert.equal(replay.sent, 0);
  evidence.checks.push({ refundIdempotent: true, refundScope: 'renewal-software-line-only', renewalCancellationSeparate: true, adminAndCsrf: true, resendDryRunSent: mail.sent, resendReplaySent: replay.sent });
  for (const [method, expected] of [['pm_card_chargeDeclined', 'requires_payment_method'], ['pm_card_authenticationRequired', 'requires_action']]) {
    const attemptId = key(), items = ['shirt', 'ticket', 'monthly'].map(id => ({ id, quantity: 1 }));
    await json(await call('/api/checkout/hold', { attemptId, items }));
    const checkout = await json(await call('/api/checkout/intent', { attemptId, items, email: 'buyer@example.test', tipPercent: 0, shippingAddress: address, billingAddress: address }));
    try { await api('POST', `/payment_intents/${checkout.paymentIntentId}/confirm`, { payment_method: method, return_url: `${origin}/return`, use_stripe_sdk: true }); }
    catch (error) { if (error.statusCode !== 402) throw error; }
    assert.equal((await stripe.paymentIntents.retrieve(checkout.paymentIntentId)).status, expected);
    const released = await json(await call('/api/checkout/release', { attemptId }));
    assert.equal(released.phase, 'released');
    assert.equal((await stripe.paymentIntents.retrieve(checkout.paymentIntentId)).status, 'canceled');
    evidence.checks.push({ paymentState: expected, cancelledBeforeInventoryRelease: true, scaChallengeCompleted: false });
  }
  evidence.passed = true;
} catch (error) {
  evidence.error = error.message;
  console.error(error.message); process.exitCode = 1;
} finally {
  await mf?.dispose();
  for (const id of resources.sessions) try { if ((await stripe.checkout.sessions.retrieve(id)).status === 'open') await api('POST',`/checkout/sessions/${id}/expire`); } catch { evidence.cleanup.push('session:failed'); }
  for (const id of resources.subscriptions) try { await stripe.subscriptions.cancel(id, { invoice_now: false, prorate: false }); } catch (error) { if (error.statusCode !== 404) evidence.cleanup.push(`subscription:${error.statusCode || 'failed'}`); }
  if (clock) try { await stripe.testHelpers.testClocks.delete(clock.id); } catch { evidence.cleanup.push('clock:failed'); }
  for (const id of resources.coupons) try { await api('DELETE', `/coupons/${id}`); } catch { evidence.cleanup.push('coupon:failed'); }
  for (const [family, values] of [['prices', resources.prices], ['products', resources.products]]) for (const id of values) try { if (family !== 'prices' || (await stripe.prices.retrieve(id)).active) await api('POST', `/${family}/${id}`, { active: false }); } catch (error) { if (error.statusCode !== 404) evidence.cleanup.push({ family, id, error: error.message }); }
  await rm(temp, { recursive: true, force: true });
  await writeFile(reportPath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ passed: evidence.passed === true, cleanupErrors: evidence.cleanup.length, report: reportPath }));
}

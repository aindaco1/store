#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_VARS_PATH = path.join(ROOT, 'worker', '.dev.vars');
const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const noDevVars = args.includes('--no-dev-vars') ||
  process.env.PAYMENT_SMOKE_USE_DEV_VARS === '0' ||
  process.env.RELEASE_USE_DEV_VARS === '0';
const useDevVars = !noDevVars;
const directWebhook = args.includes('--direct-webhook') ||
  process.env.PAYMENT_SMOKE_DIRECT_WEBHOOK === '1';

if (help) {
  console.log(`Usage: npm run release:payment-smoke -- [options]

Options:
  --no-dev-vars      Do not read worker/.dev.vars. Use this for clean-shell CI
                     probes. Shell env still works.
  --direct-webhook   After creating and confirming a test PaymentIntent, sign
                     and POST a local/non-production Stripe webhook directly to the
                     Worker. Never targets production.
  --help   Show this help.

Default behavior runs payment-adjacent unit checks and records explicit skips
for provider mutation. To create and optionally confirm a local/non-production
test Stripe PaymentIntent, set:

  PAYMENT_SMOKE_ALLOW_MUTATION=1
  PAYMENT_SMOKE_WORKER_URL=http://127.0.0.1:8989
  PAYMENT_SMOKE_SITE_URL=http://127.0.0.1:4002
  STRIPE_SECRET_KEY_TEST=sk_test_...

Set PAYMENT_SMOKE_CONFIRM=1 only when the Stripe webhook endpoint is configured
to call that non-production Worker and you want the script to poll order settlement.
For local/test settlement without Stripe CLI forwarding, run with
PAYMENT_SMOKE_ALLOW_MUTATION=1 and --direct-webhook. The target Worker must
run with STORE_EMAIL_DRY_RUN=true or RESEND_EMAIL_DRY_RUN=true so the smoke can
prove order emails would send without calling Resend. The default direct matrix
covers paid digital, paid physical, paid ticket, free RSVP, and failed-payment
email suppression.`);
  process.exit(0);
}

const results = [];
const FETCH_TIMEOUT_MS = Number(process.env.PAYMENT_SMOKE_FETCH_TIMEOUT_MS || 10000);
const devVars = readKeyValueFile(DEV_VARS_PATH);

function add(status, label, detail = '') {
  results.push({ status, label, detail });
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`${status.padEnd(5)} ${label}${suffix}`);
}

function run(command, commandArgs = [], options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, ...(options.env || {}) }
  });
  return result;
}

function readKeyValueFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const pivot = trimmed.indexOf('=');
    env[trimmed.slice(0, pivot).trim()] = trimmed.slice(pivot + 1).trim();
  }
  return env;
}

function shellValue(name) {
  return String(process.env[name] || '').trim();
}

function envValue(name) {
  const value = shellValue(name);
  if (value) return value;
  if (useDevVars) return String(devVars[name] || '').trim();
  return '';
}

function workerUrlFromEnv() {
  return (envValue('PAYMENT_SMOKE_WORKER_URL') || envValue('WORKER_URL') || envValue('WORKER_BASE')).replace(/\/+$/, '');
}

function siteUrlFromEnv() {
  return (envValue('PAYMENT_SMOKE_SITE_URL') || envValue('SITE_URL') || envValue('SITE_BASE')).replace(/\/+$/, '');
}

function urlsAreDerivedFromDevVars() {
  return useDevVars &&
    (devVars.WORKER_BASE || devVars.SITE_BASE) &&
    !shellValue('PAYMENT_SMOKE_WORKER_URL') &&
    !shellValue('WORKER_URL') &&
    !shellValue('WORKER_BASE') &&
    !shellValue('PAYMENT_SMOKE_SITE_URL') &&
    !shellValue('SITE_URL') &&
    !shellValue('SITE_BASE');
}

function requireTestStripeKey() {
  const key = envValue('STRIPE_SECRET_KEY_TEST') || envValue('STRIPE_SECRET_KEY');
  if (!key) return { ok: false, reason: 'set STRIPE_SECRET_KEY_TEST for Stripe API verification' };
  if (!key.startsWith('sk_test_')) return { ok: false, reason: 'payment smoke requires a Stripe test secret key' };
  return { ok: true, key };
}

function assertNonProductionWorker(workerUrl) {
  if (!workerUrl) return { ok: false, reason: 'set PAYMENT_SMOKE_WORKER_URL or WORKER_URL' };
  let host = '';
  try {
    host = new URL(workerUrl).hostname;
  } catch {
    return { ok: false, reason: 'PAYMENT_SMOKE_WORKER_URL must be an absolute URL' };
  }
  if (host === 'checkout.dustwave.xyz' && envValue('PAYMENT_SMOKE_ALLOW_PRODUCTION') !== '1') {
    return { ok: false, reason: 'production Worker mutation is blocked; use a local/non-production Worker or set PAYMENT_SMOKE_ALLOW_PRODUCTION=1 intentionally' };
  }
  return { ok: true };
}

function assertDirectWebhookAllowed(workerUrl) {
  if (!directWebhook) return { ok: true };
  let host = '';
  try {
    host = new URL(workerUrl).hostname;
  } catch {
    return { ok: false, reason: 'PAYMENT_SMOKE_WORKER_URL must be an absolute URL' };
  }
  if (host === 'checkout.dustwave.xyz') {
    return { ok: false, reason: 'direct synthetic webhook delivery is blocked for production' };
  }
  return { ok: true };
}

async function fetchJson(url, { headers = {}, method = 'GET', body = null } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method, headers, body, signal: controller.signal });
    let parsed = null;
    try {
      parsed = await response.json();
    } catch {}
    return { ok: response.ok, status: response.status, body: parsed };
  } catch (error) {
    return { ok: false, status: 0, body: null, error: error?.message || 'request failed' };
  } finally {
    clearTimeout(timeout);
  }
}

function stripeAuthHeader(key) {
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

async function stripeRequest(key, method, path, params = {}) {
  const body = new URLSearchParams(params).toString();
  return fetchJson(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: stripeAuthHeader(key),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: method === 'GET' ? null : body
  });
}

function stripeWebhookSecret() {
  return envValue('STRIPE_WEBHOOK_SECRET_TEST') || envValue('STRIPE_WEBHOOK_SECRET');
}

function signStripeWebhookBody(body, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

async function deliverDirectStripeWebhook(workerUrl, paymentIntent, eventType, label = 'Direct signed Stripe webhook delivery') {
  const secret = stripeWebhookSecret();
  if (!secret) {
    add('FAIL', label, 'set STRIPE_WEBHOOK_SECRET_TEST or STRIPE_WEBHOOK_SECRET');
    return false;
  }

  const event = {
    id: `evt_store_release_smoke_${Date.now()}`,
    object: 'event',
    type: eventType,
    livemode: false,
    pending_webhooks: 1,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: paymentIntent
    }
  };
  const body = JSON.stringify(event);
  const delivered = await fetchJson(`${workerUrl}/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signStripeWebhookBody(body, secret)
    },
    body
  });
  if (!delivered.ok) {
    add('FAIL', label, `Worker returned ${delivered.status || 'unavailable'}`);
    return false;
  }
  add('PASS', label, `${eventType} accepted by Worker`);
  return true;
}

const SHIPPING_ADDRESS = {
  name: 'Store Release Smoke',
  line1: '709 Haines Ave NW',
  city: 'Albuquerque',
  state: 'NM',
  postalCode: '87102',
  country: 'US'
};

function basePaymentSmokePayload(scenario) {
  return {
    customer: {
      email: envValue('PAYMENT_SMOKE_EMAIL') || `store-release-smoke+${scenario.id}@example.com`,
      name: envValue('PAYMENT_SMOKE_CUSTOMER_NAME') || 'Store Release Smoke'
    },
    preferredLang: 'en',
    tipPercent: 0
  };
}

function paymentSmokeScenarios() {
  const customProductId = envValue('PAYMENT_SMOKE_PRODUCT_ID');
  if (customProductId) {
    return [{
      id: 'custom',
      label: 'custom paid checkout',
      expectedStatus: 'confirmed',
      paid: true,
      eventType: 'payment_intent.succeeded',
      item: {
        id: customProductId,
        price: Number(envValue('PAYMENT_SMOKE_PRODUCT_PRICE') || 5),
        quantity: 1
      }
    }];
  }

  const requested = envValue('PAYMENT_SMOKE_SCENARIOS');
  const names = requested
    ? requested.split(',').map((entry) => entry.trim()).filter(Boolean)
    : (directWebhook
        ? ['paid-digital', 'paid-physical', 'paid-ticket', 'free-rsvp', 'failed-payment']
        : ['paid-digital']);
  const definitions = new Map([
    ['paid-digital', {
      id: 'paid-digital',
      label: 'paid digital checkout',
      expectedStatus: 'confirmed',
      paid: true,
      eventType: 'payment_intent.succeeded',
      item: { id: 'download-1', price: 5, quantity: 1 },
      adminNotificationExpected: false
    }],
    ['paid-physical', {
      id: 'paid-physical',
      label: 'paid physical checkout',
      expectedStatus: 'confirmed',
      paid: true,
      eventType: 'payment_intent.succeeded',
      item: { id: 'sticker-1', price: 3, quantity: 1 },
      shippingAddress: SHIPPING_ADDRESS,
      shippingCents: 300,
      adminNotificationExpected: true
    }],
    ['paid-ticket', {
      id: 'paid-ticket',
      label: 'paid ticket checkout',
      expectedStatus: 'confirmed',
      paid: true,
      eventType: 'payment_intent.succeeded',
      item: { id: 'ticket-1__general', price: 12, quantity: 1 },
      adminNotificationExpected: true
    }],
    ['free-rsvp', {
      id: 'free-rsvp',
      label: 'free RSVP checkout',
      expectedStatus: 'confirmed',
      paid: false,
      item: { id: 'rsvp-1', price: 0, quantity: 1 },
      adminNotificationExpected: true
    }],
    ['failed-payment', {
      id: 'failed-payment',
      label: 'failed payment checkout',
      expectedStatus: 'payment_failed',
      paid: true,
      eventType: 'payment_intent.payment_failed',
      item: { id: 'download-1', price: 5, quantity: 1 }
    }]
  ]);
  return names.map((name) => definitions.get(name)).filter(Boolean);
}

function paymentSmokePayload(scenario) {
  const payload = {
    ...basePaymentSmokePayload(scenario),
    items: [scenario.item]
  };
  if (scenario.shippingAddress) {
    payload.shippingAddress = scenario.shippingAddress;
    payload.billingAddress = scenario.shippingAddress;
  }
  if (scenario.shippingCents) payload.shippingCents = scenario.shippingCents;
  return payload;
}

function shouldVerifyEmailDryRun() {
  if (!directWebhook) return false;
  return envValue('PAYMENT_SMOKE_VERIFY_EMAIL_DRY_RUN') !== '0';
}

function evaluateEmailDryRunDelivery(summary, scenario) {
  const delivery = summary?.emailDelivery;
  if (!delivery) {
    return {
      ok: false,
      reason: 'target Worker did not expose emailDelivery; run it with STORE_EMAIL_DRY_RUN=true'
    };
  }
  const customerOk = delivery.customer?.sent === true &&
    delivery.customer?.dryRun === true &&
    delivery.customer?.error === '';
  const adminRequired = scenario.adminNotificationExpected === true;
  const adminDelivered = delivery.admin?.sent === true || Number(delivery.admin?.recipientCount || 0) > 0;
  const adminOk = delivery.admin?.sent === true &&
    delivery.admin?.dryRun === true &&
    Number(delivery.admin?.recipientCount || 0) > 0 &&
    Number(delivery.admin?.errorCount || 0) === 0;
  const adminErrored = Number(delivery.admin?.errorCount || 0) > 0;
  if (!customerOk || adminErrored || (adminRequired && !adminOk) || (!adminRequired && adminDelivered && !adminOk)) {
    const adminExpectation = adminRequired
      ? 'customer order email or required admin notification was not dry-run delivered'
      : 'customer order email was not dry-run delivered or optional admin notification failed';
    return { ok: false, reason: adminExpectation };
  }
  const adminDetail = adminDelivered
    ? ` and ${delivery.admin.recipientCount} admin notification(s)`
    : '';
  return {
    ok: true,
    detail: `customer email${adminDetail} rendered without Resend`
  };
}

function assertNoOrderEmailDelivery(summary, scenario) {
  if (!shouldVerifyEmailDryRun()) return true;
  const delivery = summary?.emailDelivery;
  if (!delivery) {
    add('FAIL', `Order email suppression (${scenario.label})`, 'target Worker did not expose emailDelivery; run it with STORE_EMAIL_DRY_RUN=true');
    return false;
  }
  const customerOk = delivery.customer?.sent !== true;
  const adminOk = delivery.admin?.sent !== true && Number(delivery.admin?.recipientCount || 0) === 0;
  if (!customerOk || !adminOk) {
    add('FAIL', `Order email suppression (${scenario.label})`, 'failed payment unexpectedly queued order email delivery');
    return false;
  }
  add('PASS', `Order email suppression (${scenario.label})`, 'no customer/admin order email was queued for failed payment');
  return true;
}

async function waitForOrderStatus(workerUrl, siteUrl, orderToken, expectedStatus, scenario) {
  const deadline = Date.now() + Number(envValue('PAYMENT_SMOKE_SETTLEMENT_TIMEOUT_MS') || 60000);
  while (Date.now() < deadline) {
    const summary = await fetchJson(`${workerUrl}/api/orders/${encodeURIComponent(orderToken)}`, {
      headers: { Origin: siteUrl }
    });
    if (summary.ok && summary.body?.status === expectedStatus) {
      add('PASS', `Store order state (${scenario.label})`, `order ${expectedStatus} for ${orderToken}`);
      return summary.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  add('FAIL', `Store order state (${scenario.label})`, `order was not ${expectedStatus} before timeout`);
  return null;
}

async function waitForOrderEmailDryRunDelivery(workerUrl, siteUrl, orderToken, scenario) {
  if (!shouldVerifyEmailDryRun()) return true;

  const deadline = Date.now() + Number(envValue('PAYMENT_SMOKE_SETTLEMENT_TIMEOUT_MS') || 60000);
  let lastResult = null;
  while (Date.now() < deadline) {
    const summary = await fetchJson(`${workerUrl}/api/orders/${encodeURIComponent(orderToken)}`, {
      headers: { Origin: siteUrl }
    });
    if (summary.ok) {
      lastResult = evaluateEmailDryRunDelivery(summary.body, scenario);
      if (lastResult.ok) {
        add('PASS', `Order email dry-run delivery (${scenario.label})`, lastResult.detail);
        return summary.body;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  add('FAIL', `Order email dry-run delivery (${scenario.label})`, lastResult?.reason || 'email dry-run delivery evidence did not appear before timeout');
  return null;
}

async function runFreeScenario(workerUrl, siteUrl, scenario) {
  const checkout = await fetchJson(`${workerUrl}/api/checkout/intent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: siteUrl,
      'CF-Connecting-IP': '127.0.0.55'
    },
    body: JSON.stringify(paymentSmokePayload(scenario))
  });
  if (!checkout.ok || !checkout.body?.orderToken || checkout.body?.requiresPayment !== false) {
    add('FAIL', `Free checkout mutation (${scenario.label})`, `checkout intent returned ${checkout.status}`);
    return;
  }
  add('PASS', `Free checkout mutation (${scenario.label})`, `confirmed ${checkout.body.orderToken} without Stripe`);
  const summary = await waitForOrderStatus(workerUrl, siteUrl, checkout.body.orderToken, scenario.expectedStatus, scenario);
  if (summary) await waitForOrderEmailDryRunDelivery(workerUrl, siteUrl, checkout.body.orderToken, scenario);
}

async function runPaidScenario(workerUrl, siteUrl, stripeKey, scenario) {
  const checkout = await fetchJson(`${workerUrl}/api/checkout/intent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: siteUrl,
      'CF-Connecting-IP': '127.0.0.55'
    },
    body: JSON.stringify(paymentSmokePayload(scenario))
  });
  if (!checkout.ok || !checkout.body?.paymentIntentId || !checkout.body?.orderToken) {
    add('FAIL', `Stripe test-mode checkout mutation (${scenario.label})`, `checkout intent returned ${checkout.status}`);
    return;
  }

  add('PASS', `Stripe test-mode checkout mutation (${scenario.label})`, `created PaymentIntent ${checkout.body.paymentIntentId} for ${checkout.body.orderToken}`);
  const retrieved = await stripeRequest(stripeKey.key, 'GET', `/payment_intents/${encodeURIComponent(checkout.body.paymentIntentId)}`);
  if (!retrieved.ok || retrieved.body?.metadata?.orderToken !== checkout.body.orderToken) {
    add('FAIL', `Stripe PaymentIntent metadata verification (${scenario.label})`, `Stripe retrieve returned ${retrieved.status}`);
    return;
  }
  add('PASS', `Stripe PaymentIntent metadata verification (${scenario.label})`, 'order token and Store metadata are present');

  if (scenario.eventType === 'payment_intent.payment_failed') {
    if (directWebhook) {
      const delivered = await deliverDirectStripeWebhook(workerUrl, retrieved.body, scenario.eventType, `Direct signed Stripe webhook delivery (${scenario.label})`);
      if (!delivered) return;
    }
    const summary = await waitForOrderStatus(workerUrl, siteUrl, checkout.body.orderToken, scenario.expectedStatus, scenario);
    if (summary) assertNoOrderEmailDelivery(summary, scenario);
    const canceled = await stripeRequest(stripeKey.key, 'POST', `/payment_intents/${encodeURIComponent(checkout.body.paymentIntentId)}/cancel`);
    if (canceled.ok) add('PASS', `Stripe test PaymentIntent cleanup (${scenario.label})`, 'pending failed-path test PaymentIntent canceled');
    else add('WARN', `Stripe test PaymentIntent cleanup (${scenario.label})`, `cancel returned ${canceled.status}`);
    return;
  }

  if (envValue('PAYMENT_SMOKE_CONFIRM') !== '1' && !directWebhook) {
    const canceled = await stripeRequest(stripeKey.key, 'POST', `/payment_intents/${encodeURIComponent(checkout.body.paymentIntentId)}/cancel`);
    if (canceled.ok) add('PASS', `Stripe test PaymentIntent cleanup (${scenario.label})`, 'pending test PaymentIntent canceled');
    else add('WARN', `Stripe test PaymentIntent cleanup (${scenario.label})`, `cancel returned ${canceled.status}`);
    add('SKIP', `Stripe webhook settlement poll (${scenario.label})`, 'set PAYMENT_SMOKE_CONFIRM=1 after the non-production webhook endpoint is configured');
    return;
  }

  const confirmed = await stripeRequest(stripeKey.key, 'POST', `/payment_intents/${encodeURIComponent(checkout.body.paymentIntentId)}/confirm`, {
    payment_method: 'pm_card_visa',
    return_url: `${siteUrl}/order-success/?orderToken=${encodeURIComponent(checkout.body.orderToken)}`
  });
  if (!confirmed.ok) {
    add('FAIL', `Stripe test PaymentIntent confirmation (${scenario.label})`, `confirm returned ${confirmed.status}`);
    return;
  }
  add('PASS', `Stripe test PaymentIntent confirmation (${scenario.label})`, `status ${confirmed.body?.status || 'unknown'}`);

  if (directWebhook) {
    const delivered = await deliverDirectStripeWebhook(workerUrl, confirmed.body, scenario.eventType, `Direct signed Stripe webhook delivery (${scenario.label})`);
    if (!delivered) return;
  }

  const summary = await waitForOrderStatus(workerUrl, siteUrl, checkout.body.orderToken, scenario.expectedStatus, scenario);
  if (summary) await waitForOrderEmailDryRunDelivery(workerUrl, siteUrl, checkout.body.orderToken, scenario);
}

async function runMutationSmoke() {
  const workerUrl = workerUrlFromEnv();
  const siteUrl = siteUrlFromEnv();
  const workerCheck = assertNonProductionWorker(workerUrl);
  if (!workerCheck.ok) {
    add('FAIL', 'Stripe test-mode checkout mutation', workerCheck.reason);
    return;
  }
  const directWebhookCheck = assertDirectWebhookAllowed(workerUrl);
  if (!directWebhookCheck.ok) {
    add('FAIL', 'Direct signed Stripe webhook delivery', directWebhookCheck.reason);
    return;
  }
  if (!siteUrl) {
    add('FAIL', 'Stripe test-mode checkout mutation', 'set PAYMENT_SMOKE_SITE_URL or SITE_URL');
    return;
  }
  const stripeKey = requireTestStripeKey();
  if (!stripeKey.ok) {
    add('FAIL', 'Stripe test-mode checkout mutation', stripeKey.reason);
    return;
  }

  for (const scenario of paymentSmokeScenarios()) {
    if (scenario.paid) await runPaidScenario(workerUrl, siteUrl, stripeKey, scenario);
    else await runFreeScenario(workerUrl, siteUrl, scenario);
  }
}

async function main() {
  console.log('Store release payment smoke');
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Dev vars: ${useDevVars ? 'yes' : 'no'}`);
  console.log(`Direct webhook: ${directWebhook ? 'yes' : 'no'}`);
  console.log('');

  const unit = run('npx', [
    'vitest',
    'run',
    'tests/unit/store-checkout-email-delivery.test.ts',
    'tests/unit/stripe-checkout-sidecar.test.ts'
  ]);
  if (unit.status === 0) add('PASS', 'Payment unit contract checks', 'PaymentIntent creation and Stripe sidecar contracts passed');
  else add('FAIL', 'Payment unit contract checks', String(unit.stderr || unit.stdout || 'vitest failed').split(/\r?\n/).filter(Boolean).slice(-1)[0] || 'vitest failed');

  const workerUrl = workerUrlFromEnv();
  const siteUrl = siteUrlFromEnv();
  if (workerUrl && siteUrl) {
    const workerBase = workerUrl.replace(/\/+$/, '');
    const reachable = await fetchJson(`${workerBase}/notfound`);
    if (reachable.status === 0) {
      if (urlsAreDerivedFromDevVars()) {
        add('SKIP', 'Worker payment boundary smoke', `local Worker from worker/.dev.vars is not running: ${reachable.error || 'request failed'}`);
      } else {
        add('FAIL', 'Worker payment boundary smoke', `Worker URL is unreachable: ${reachable.error || 'request failed'}`);
      }
    } else {
      const siteBase = siteUrl.replace(/\/+$/, '');
      const products = await fetchJson(`${siteBase}/api/products.json`);
      if (directWebhook && !products.ok) {
        add('SKIP', 'Worker payment boundary smoke', `static site is not running at ${siteBase}; direct Worker checkout and webhook matrix still runs`);
      } else {
        const worker = run('./scripts/test-worker.sh', [], {
          env: {
            WORKER_URL: workerUrl,
            SITE_URL: siteUrl
          }
        });
        if (worker.status === 0) add('PASS', 'Worker payment boundary smoke', 'cart validation and malformed checkout fail-closed checks passed');
        else add('FAIL', 'Worker payment boundary smoke', String(worker.stderr || worker.stdout || 'scripts/test-worker.sh failed').split(/\r?\n/).filter(Boolean).slice(-1)[0] || 'scripts/test-worker.sh failed');
      }
    }
  } else {
    add('SKIP', 'Worker payment boundary smoke', 'set PAYMENT_SMOKE_WORKER_URL and PAYMENT_SMOKE_SITE_URL for a local/non-production Worker probe');
  }

  if (envValue('PAYMENT_SMOKE_ALLOW_MUTATION') === '1' || envValue('RELEASE_PAYMENT_SMOKE') === '1') {
    await runMutationSmoke();
  } else {
    add('SKIP', 'Stripe test-mode checkout mutation', 'set PAYMENT_SMOKE_ALLOW_MUTATION=1 with local/non-production URLs and STRIPE_SECRET_KEY_TEST');
  }

  const failCount = results.filter((entry) => entry.status === 'FAIL').length;
  const warnCount = results.filter((entry) => entry.status === 'WARN').length;
  const skipCount = results.filter((entry) => entry.status === 'SKIP').length;
  console.log('');
  console.log(`Summary: ${failCount} fail, ${warnCount} warn, ${skipCount} skip`);
  if (failCount) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

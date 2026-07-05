#!/usr/bin/env node
import process from 'node:process';
import worker from '../worker/src/index.js';

const SITE_BASE = 'http://127.0.0.1:4002';
const WORKER_BASE = 'http://127.0.0.1:8989';
const ADMIN_EMAIL = 'release-admin@example.com';
const results = [];
const waitUntilTasks = [];
let requestCounter = 0;

class MockKVNamespace {
  constructor() {
    this.store = new Map();
  }

  async get(key, options = {}) {
    if (!this.store.has(key)) return null;
    const value = this.store.get(key);
    return options?.type === 'json' ? JSON.parse(value) : value;
  }

  async put(key, value, _options = {}) {
    this.store.set(key, String(value));
  }

  async delete(key) {
    this.store.delete(key);
  }

  async list(options = {}) {
    const prefix = String(options.prefix || '');
    const limit = Math.max(1, Number(options.limit || 1000) || 1000);
    const keys = Array.from(this.store.keys())
      .filter((key) => key.startsWith(prefix))
      .sort()
      .slice(0, limit)
      .map((name) => ({ name }));
    return { keys, list_complete: true, cursor: undefined };
  }
}

class MockR2Object {
  constructor(body, contentType = 'text/plain; charset=utf-8') {
    this.body = body;
    this.httpMetadata = { contentType };
    this.size = new TextEncoder().encode(String(body || '')).byteLength;
  }

  writeHttpMetadata(headers) {
    headers.set('Content-Type', this.httpMetadata.contentType);
  }
}

class MockR2Bucket {
  constructor() {
    this.objects = new Map();
  }

  async get(key) {
    return this.objects.get(key) || null;
  }

  async put(key, body, options = {}) {
    this.objects.set(key, new MockR2Object(body, options.httpMetadata?.contentType || 'application/octet-stream'));
  }

  async delete(key) {
    this.objects.delete(key);
  }
}

function add(status, label, detail = '') {
  results.push({ status, label, detail });
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`${status.padEnd(5)} ${label}${suffix}`);
}

function pass(label, detail) {
  add('PASS', label, detail);
  return true;
}

function fail(label, detail) {
  add('FAIL', label, detail);
  return false;
}

function assert(condition, label, detail) {
  return condition ? pass(label, detail) : fail(label, detail);
}

function nowIso(offsetMs = 0) {
  return new Date(Date.UTC(2026, 6, 5, 3, 30, 0) + offsetMs).toISOString();
}

function buildOrder({
  orderToken,
  customerEmail,
  items,
  paymentRequired = true,
  totalCents = 1200,
  downloadAccess = {},
  fulfillmentCheckIns = {}
}) {
  return {
    orderToken,
    status: 'confirmed',
    createdAt: nowIso(-300000),
    confirmedAt: nowIso(-240000),
    updatedAt: nowIso(-120000),
    emailSent: true,
    orderDraft: {
      orderToken,
      status: 'confirmed',
      preferredLang: 'en',
      customer: {
        email: customerEmail,
        name: 'Release Evidence Buyer'
      },
      currency: 'USD',
      items,
      totals: {
        itemCount: items.reduce((sum, item) => sum + Number(item.quantity || 1), 0),
        subtotalCents: totalCents,
        totalCents,
        requiresPayment: paymentRequired,
        requiresShipping: items.some((item) => item.fulfillmentType === 'physical'),
        currency: 'USD'
      },
      fulfillment: {
        requiresShipping: items.some((item) => item.fulfillmentType === 'physical')
      },
      shippingAddress: items.some((item) => item.fulfillmentType === 'physical')
        ? {
            name: 'Release Evidence Buyer',
            line1: '709 Haines Ave NW',
            city: 'Albuquerque',
            state: 'NM',
            postalCode: '87102',
            country: 'US'
          }
        : null
    },
    payment: paymentRequired
      ? {
          required: true,
          provider: 'stripe',
          status: 'succeeded',
          amountCents: totalCents,
          currency: 'USD',
          paymentIntentId: `pi_release_${orderToken.replace(/^store-order-/, '')}`,
          chargeId: `ch_release_${orderToken.replace(/^store-order-/, '')}`,
          balanceTransactionId: `txn_release_${orderToken.replace(/^store-order-/, '')}`,
          cardChecks: {
            addressLine1Check: 'pass',
            addressPostalCodeCheck: 'pass',
            cvcCheck: 'pass',
            networkStatus: 'approved_by_network',
            riskLevel: 'normal',
            outcomeType: 'authorized'
          }
        }
      : {
          required: false,
          provider: null,
          status: 'not_required',
          amountCents: 0,
          currency: 'USD'
        },
    downloadAccess,
    fulfillmentCheckIns
  };
}

function digitalItem() {
  return {
    sku: 'download-1',
    productId: 'download-1',
    name: 'Release Digital Download',
    quantity: 1,
    unitPriceCents: 500,
    subtotalCents: 500,
    currency: 'USD',
    fulfillmentType: 'digital',
    download: {
      file_key: 'release-digital-download.txt',
      filename: 'release-digital-download.txt',
      delivery: 'signed_link'
    }
  };
}

function ticketItem() {
  return {
    sku: 'ticket-1',
    productId: 'ticket-1',
    name: 'Release Evidence Ticket',
    variantLabel: 'General Admission',
    quantity: 2,
    unitPriceCents: 1200,
    subtotalCents: 2400,
    currency: 'USD',
    fulfillmentType: 'ticket',
    eventDetails: {
      starts_at: '2026-08-15T02:00:00.000Z',
      ends_at: '2026-08-15T04:00:00.000Z',
      venue: 'Guild Cinema',
      address: '3405 Central Ave NE, Albuquerque, NM 87106'
    }
  };
}

function rsvpItem() {
  return {
    sku: 'rsvp-1',
    productId: 'rsvp-1',
    name: 'Release Evidence RSVP',
    quantity: 1,
    unitPriceCents: 0,
    subtotalCents: 0,
    currency: 'USD',
    fulfillmentType: 'rsvp',
    eventDetails: {
      starts_at: '2026-08-16T02:00:00.000Z',
      venue: 'Launch Room',
      address: 'Albuquerque, NM'
    }
  };
}

function physicalItem() {
  return {
    sku: 'sticker-1',
    productId: 'sticker-1',
    name: 'Release Evidence Sticker',
    quantity: 1,
    unitPriceCents: 300,
    subtotalCents: 300,
    currency: 'USD',
    fulfillmentType: 'physical',
    shippable: true
  };
}

const storeState = new MockKVNamespace();
const downloads = new MockR2Bucket();
const env = {
  APP_MODE: 'test',
  SITE_BASE,
  WORKER_BASE,
  CANONICAL_SITE_BASE: SITE_BASE,
  CANONICAL_WORKER_BASE: WORKER_BASE,
  CORS_ALLOWED_ORIGIN: SITE_BASE,
  PLATFORM_TIMEZONE: 'America/Denver',
  ADMIN_BOOTSTRAP_EMAILS: ADMIN_EMAIL,
  ADMIN_USERS_JSON: JSON.stringify([{ name: 'Release Admin', email: ADMIN_EMAIL, role: 'super_admin', accessScopes: [] }]),
  ADMIN_SESSION_SECRET: 'release-admin-session-secret',
  MAGIC_LINK_SECRET: 'release-magic-link-secret',
  STORE_FULFILLMENT_SECRET: 'release-fulfillment-secret',
  ADMIN_EXPOSE_LOGIN_LINK: 'true',
  ADMIN_TURNSTILE_BYPASS: 'true',
  STORE_STATE: storeState,
  RATELIMIT: new MockKVNamespace(),
  STORE_DOWNLOADS: downloads,
  OBSERVABILITY_SAMPLE_RATE: '0'
};

const ctx = {
  waitUntil(task) {
    waitUntilTasks.push(Promise.resolve(task));
  }
};

async function drainWaitUntil() {
  while (waitUntilTasks.length) {
    const tasks = waitUntilTasks.splice(0, waitUntilTasks.length);
    await Promise.allSettled(tasks);
  }
}

async function seed() {
  await downloads.put('release-digital-download.txt', 'release evidence download payload', {
    httpMetadata: { contentType: 'text/plain; charset=utf-8' }
  });
  const orders = [
    buildOrder({
      orderToken: 'store-order-release-digital',
      customerEmail: 'digital@example.com',
      items: [digitalItem()],
      totalCents: 500,
      downloadAccess: {
        'download-1': {
          status: 'active',
          issuedAt: nowIso(-240000)
        }
      }
    }),
    buildOrder({
      orderToken: 'store-order-release-ticket',
      customerEmail: 'ticket@example.com',
      items: [ticketItem()],
      totalCents: 2400
    }),
    buildOrder({
      orderToken: 'store-order-release-rsvp',
      customerEmail: 'rsvp@example.com',
      items: [rsvpItem()],
      paymentRequired: false,
      totalCents: 0
    }),
    buildOrder({
      orderToken: 'store-order-release-physical',
      customerEmail: 'physical@example.com',
      items: [physicalItem()],
      totalCents: 300
    })
  ];
  for (const order of orders) {
    await storeState.put(`orders:${order.orderToken}`, JSON.stringify(order));
  }
}

function requestUrl(pathOrUrl) {
  if (/^https?:\/\//i.test(String(pathOrUrl))) return String(pathOrUrl);
  return `${WORKER_BASE}${pathOrUrl}`;
}

async function workerRequest(pathOrUrl, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Origin', SITE_BASE);
  requestCounter += 1;
  headers.set('CF-Connecting-IP', `127.0.0.${70 + (requestCounter % 120)}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const request = new Request(requestUrl(pathOrUrl), {
    method: options.method || 'GET',
    headers,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const response = await worker.fetch(request, env, ctx);
  await drainWaitUntil();
  return response;
}

async function jsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Expected JSON response, got: ${text.slice(0, 160)}`);
  }
}

async function authenticateAdmin() {
  const start = await workerRequest('/admin/auth/start', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, preferredLang: 'en' }
  });
  if (start.status !== 200) throw new Error(`admin auth start returned ${start.status}`);
  const startBody = await jsonResponse(start);
  const token = new URL(startBody.loginUrl).searchParams.get('admin_login');
  if (!token) throw new Error('admin login token missing');

  const exchange = await workerRequest('/admin/auth/exchange', {
    method: 'POST',
    body: { token }
  });
  if (exchange.status !== 200) throw new Error(`admin auth exchange returned ${exchange.status}`);
  const body = await jsonResponse(exchange);
  const cookie = String(exchange.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie || !body.csrfToken) throw new Error('admin session cookie or CSRF token missing');
  return { cookie, csrfToken: body.csrfToken };
}

function adminHeaders(session) {
  return {
    Cookie: session.cookie,
    'x-store-admin-csrf': session.csrfToken
  };
}

async function getOrderSummary(orderToken) {
  const response = await workerRequest(`/api/orders/${encodeURIComponent(orderToken)}`);
  if (response.status !== 200) throw new Error(`${orderToken} summary returned ${response.status}`);
  return jsonResponse(response);
}

async function adminPost(path, session, body) {
  const response = await workerRequest(path, {
    method: 'POST',
    headers: adminHeaders(session),
    body
  });
  const parsed = await jsonResponse(response);
  return { response, body: parsed };
}

async function assertCsv(path, session, expectedFragments) {
  const response = await workerRequest(path, {
    headers: adminHeaders(session)
  });
  const body = await response.text();
  const label = `CSV export ${path}`;
  const problems = [];
  if (response.status !== 200) problems.push(`status ${response.status}`);
  if (!String(response.headers.get('content-type') || '').includes('text/csv')) problems.push('content-type is not text/csv');
  if (!String(response.headers.get('content-disposition') || '').includes('attachment;')) problems.push('content-disposition attachment missing');
  for (const fragment of expectedFragments) {
    if (!body.includes(fragment)) problems.push(`missing ${fragment}`);
  }
  return problems.length ? fail(label, problems.join('; ')) : pass(label, `contains ${expectedFragments.join(', ')}`);
}

async function run() {
  console.log('Store release fulfillment evidence');
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log('');

  await seed();
  const session = await authenticateAdmin();
  pass('Admin evidence session', 'magic-link exchange produced session cookie and CSRF token');

  const digitalSummary = await getOrderSummary('store-order-release-digital');
  const downloadAction = digitalSummary.items?.[0]?.actions?.download;
  if (!downloadAction?.available || !downloadAction.href) {
    fail('Signed digital download summary', 'download action was not available');
  } else {
    pass('Signed digital download summary', 'buyer summary exposed a signed download action');
    const downloadResponse = await workerRequest(downloadAction.href);
    const body = await downloadResponse.text();
    assert(
      downloadResponse.status === 200 &&
        body.includes('release evidence download payload') &&
        String(downloadResponse.headers.get('cache-control') || '').includes('no-store') &&
        String(downloadResponse.headers.get('content-disposition') || '').includes('release-digital-download.txt'),
      'Signed digital download response',
      `status ${downloadResponse.status}, private artifact headers present`
    );
  }

  const revoked = await adminPost('/admin/store/orders/download-access', session, {
    orderToken: 'store-order-release-digital',
    itemId: 'download-1',
    action: 'revoke'
  });
  assert(revoked.response.status === 200 && revoked.body.success === true, 'Admin download revoke', 'download access revoke succeeded');
  const revokedSummary = await getOrderSummary('store-order-release-digital');
  const revokedAction = revokedSummary.items?.[0]?.actions?.download;
  assert(revokedAction?.available === false && revokedAction?.reason === 'revoked', 'Revoked download buyer summary', 'download action is blocked after revoke');
  if (downloadAction?.href) {
    const oldLink = await workerRequest(downloadAction.href);
    assert(oldLink.status === 410, 'Revoked signed download link', `old signed link returned ${oldLink.status}`);
  }

  const refreshed = await adminPost('/admin/store/orders/download-access', session, {
    orderToken: 'store-order-release-digital',
    itemId: 'download-1',
    action: 'reissue'
  });
  assert(refreshed.response.status === 200 && refreshed.body.success === true, 'Admin download refresh', 'download access refresh succeeded');
  const refreshedSummary = await getOrderSummary('store-order-release-digital');
  const refreshedAction = refreshedSummary.items?.[0]?.actions?.download;
  if (!refreshedAction?.available || !refreshedAction.href) {
    fail('Refreshed download buyer summary', 'download action was not restored');
  } else {
    pass('Refreshed download buyer summary', 'download action restored after refresh');
    const refreshedDownload = await workerRequest(refreshedAction.href);
    assert(refreshedDownload.status === 200, 'Refreshed signed download link', `new signed link returned ${refreshedDownload.status}`);
  }

  const ticketSummary = await getOrderSummary('store-order-release-ticket');
  const checkInAction = ticketSummary.items?.[0]?.actions?.checkIn;
  if (!checkInAction?.href) {
    fail('Ticket check-in summary', 'ticket check-in action missing');
  } else {
    const publicCheckIn = await workerRequest(checkInAction.href);
    const publicBody = await jsonResponse(publicCheckIn);
    assert(publicCheckIn.status === 200 && publicBody.valid === true && publicBody.checkedIn === false, 'Ticket public check-in preview', 'signed check-in link validates before admin check-in');
  }

  const ticketCheckIn = await adminPost('/admin/store/orders/check-in', session, {
    orderToken: 'store-order-release-ticket',
    itemId: 'ticket-1',
    checkedIn: true,
    quantity: 2,
    note: 'release evidence'
  });
  assert(
    ticketCheckIn.response.status === 200 &&
      ticketCheckIn.body.success === true &&
      ticketCheckIn.body.fulfillment?.checkedIn === true &&
      ticketCheckIn.body.fulfillment?.checkedInQuantity === 2,
    'Admin ticket check-in',
    'ticket check-in mutation recorded quantity 2'
  );
  const ticketRepeat = await adminPost('/admin/store/orders/check-in', session, {
    orderToken: 'store-order-release-ticket',
    itemId: 'ticket-1',
    checkedIn: true,
    quantity: 2,
    note: 'release evidence repeat'
  });
  assert(ticketRepeat.response.status === 200 && ticketRepeat.body.fulfillment?.checkedIn === true, 'Admin ticket check-in repeat', 'repeat check-in remains successful');

  const rsvpCheckIn = await adminPost('/admin/store/orders/check-in', session, {
    orderToken: 'store-order-release-rsvp',
    itemId: 'rsvp-1',
    checkedIn: true,
    quantity: 1
  });
  assert(rsvpCheckIn.response.status === 200 && rsvpCheckIn.body.fulfillment?.checkedIn === true, 'Admin RSVP check-in', 'free RSVP check-in mutation succeeded');

  await assertCsv('/admin/store/orders.csv', session, [
    'order_token,status',
    'store-order-release-digital',
    'download_access_status',
    'revoked'
  ]);
  await assertCsv('/admin/store/attendees.csv', session, [
    'event_starts_at,event_venue',
    'store-order-release-ticket',
    'store-order-release-rsvp',
    'checked_in'
  ]);
  await assertCsv('/admin/store/reconciliation.csv', session, [
    'order_token,status',
    'store-order-release-ticket',
    'amount_match',
    'needs_review'
  ]);
  await assertCsv('/admin/audit.csv', session, [
    'store_order:download_access',
    'store_order:check_in',
    ADMIN_EMAIL
  ]);
}

run().catch((error) => {
  fail('Fulfillment evidence runtime', error?.stack || error?.message || String(error));
}).finally(() => {
  const failCount = results.filter((entry) => entry.status === 'FAIL').length;
  const warnCount = results.filter((entry) => entry.status === 'WARN').length;
  const skipCount = results.filter((entry) => entry.status === 'SKIP').length;
  console.log('');
  console.log(`Summary: ${failCount} fail, ${warnCount} warn, ${skipCount} skip`);
  if (failCount) process.exit(1);
});

#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { hashStoreOrderDraft } from '../worker/src/orders.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = path.join(ROOT, 'worker');
const DEV_VARS_PATH = path.join(WORKER_DIR, '.dev.vars');
const STORE_STATE_BINDING = 'STORE_STATE';
const STORE_ORDER_LOOKUP_SCOPE = 'store_order_lookup';
const STORE_ORDER_EMAIL_INDEX_PREFIX = 'store-order-email:';
const STORE_ORDER_LOOKUP_TOKEN_PREFIX = 'store-order-lookup:';
const LOOKUP_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const EMAIL_INDEX_LIMIT = 50;
const SITE_BASE_FALLBACK = 'http://127.0.0.1:4002';
const LOCAL_R2_BUCKET = 'store-downloads-preview';
const LOCAL_DEMO_DOWNLOAD_KEY = 'local-demo-digital-download.txt';

function parseArgs(argv) {
  const values = {};
  for (const arg of argv) {
    const [key, ...rest] = arg.split('=');
    if (key.startsWith('--')) values[key] = rest.length > 0 ? rest.join('=') : true;
  }
  return values;
}

function commandName(name) {
  return process.platform === 'win32' && name === 'npx' ? 'npx.cmd' : name;
}

function readDevVars() {
  if (!fs.existsSync(DEV_VARS_PATH)) return {};
  const env = {};
  const content = fs.readFileSync(DEV_VARS_PATH, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const pivot = line.indexOf('=');
    const key = line.slice(0, pivot).trim();
    let value = line.slice(pivot + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function ensureLocalTarget(env) {
  const appMode = String(env.APP_MODE || '').trim().toLowerCase();
  const siteBase = String(env.SITE_BASE || '').trim();
  const workerBase = String(env.WORKER_BASE || '').trim();
  const localTargets = [siteBase, workerBase].filter(Boolean).every((value) => (
    /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\b/i.test(value)
  ));
  if (appMode !== 'test' || !localTargets) {
    throw new Error('Refusing to seed orders unless worker/.dev.vars targets local APP_MODE=test URLs.');
  }
}

function getLookupSecret(env) {
  return String(
    env.STORE_ORDER_LOOKUP_SECRET ||
    env.STORE_FULFILLMENT_SECRET ||
    env.MAGIC_LINK_SECRET ||
    env.STORE_DOWNLOAD_SECRET ||
    ''
  ).trim();
}

function hmacBase64url(secret, payload) {
  return crypto.createHmac('sha256', secret).update(String(payload || '')).digest('base64url');
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function emailHash(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error(`Invalid email address: ${email}`);
  return sha256Hex(normalized);
}

function moneyCents(dollars) {
  return Math.max(0, Math.round(Number(dollars || 0) * 100));
}

function addDaysIso(baseIso, days) {
  const base = new Date(baseIso);
  return new Date(base.getTime() + (Number(days || 0) * 24 * 60 * 60 * 1000)).toISOString();
}

function physicalAddress(overrides = {}) {
  return {
    name: overrides.name || 'Alonso Customer',
    line1: overrides.line1 || '123 Central Ave NW',
    line2: overrides.line2 || '',
    city: overrides.city || 'Albuquerque',
    region: overrides.region || 'NM',
    postalCode: overrides.postalCode || '87102',
    country: overrides.country || 'US'
  };
}

function baseItem(overrides = {}) {
  const quantity = Math.max(1, Number(overrides.quantity || 1) || 1);
  const unitPriceCents = Math.max(0, Number(overrides.unitPriceCents ?? moneyCents(overrides.unitPriceDollars || 0)) || 0);
  const subtotalCents = Math.max(0, Number(overrides.subtotalCents ?? unitPriceCents * quantity) || 0);
  const discountCents = Math.max(0, Number(overrides.discountCents || 0) || 0);
  return {
    productId: String(overrides.productId || ''),
    variantId: String(overrides.variantId || ''),
    sku: String(overrides.sku || ''),
    name: String(overrides.name || 'Store item'),
    variantLabel: String(overrides.variantLabel || ''),
    quantity,
    unitPriceCents,
    subtotalCents,
    discountCents,
    discountedSubtotalCents: Math.max(0, Number(overrides.discountedSubtotalCents ?? subtotalCents - discountCents) || 0),
    currency: 'USD',
    fulfillmentType: String(overrides.fulfillmentType || 'physical'),
    event: String(overrides.event || overrides.collection || 'dustwave'),
    collection: String(overrides.collection || 'dustwave'),
    category: String(overrides.category || 'apparel'),
    shippable: overrides.shippable === true,
    shippingPreset: String(overrides.shippingPreset || ''),
    taxCategory: String(overrides.taxCategory || 'standard'),
    inventory: {
      tracking: overrides.inventoryTracking === true,
      quantity: Math.max(0, Number(overrides.inventoryQuantity || 0) || 0)
    },
    image: String(overrides.image || ''),
    url: String(overrides.url || ''),
    eventDetails: overrides.eventDetails || null,
    download: overrides.download || null,
    turnstileRequired: overrides.turnstileRequired === true
  };
}

function buildTotals(items, overrides = {}) {
  const subtotalCents = items.reduce((sum, item) => sum + Number(item.subtotalCents || 0), 0);
  const itemDiscountCents = items.reduce((sum, item) => sum + Number(item.discountCents || 0), 0);
  const discountCents = Math.max(0, Number(overrides.discountCents ?? itemDiscountCents) || 0);
  const discountedSubtotalCents = Math.max(0, Number(overrides.discountedSubtotalCents ?? subtotalCents - discountCents) || 0);
  const tipPercent = Math.max(0, Number(overrides.tipPercent || 0) || 0);
  const tipAmountCents = Math.max(0, Number(overrides.tipAmountCents ?? Math.round(discountedSubtotalCents * (tipPercent / 100))) || 0);
  const shippingCents = Math.max(0, Number(overrides.shippingCents || 0) || 0);
  const taxCents = Math.max(0, Number(overrides.taxCents || 0) || 0);
  const totalCents = Math.max(0, Number(overrides.totalCents ?? discountedSubtotalCents + tipAmountCents + shippingCents + taxCents) || 0);
  return {
    itemCount: items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 1) || 1), 0),
    subtotalCents,
    discountCents,
    discountedSubtotalCents,
    couponCode: String(overrides.couponCode || ''),
    coupon: overrides.coupon || null,
    tipPercent,
    tipAmountCents,
    shippingCents,
    taxCents,
    totalCents,
    requiresPayment: totalCents > 0,
    requiresShipping: items.some((item) => item.shippable === true),
    requiresTurnstile: items.some((item) => item.turnstileRequired === true)
  };
}

async function buildStoredOrder(definition) {
  const createdAt = definition.createdAt;
  const confirmedAt = definition.confirmedAt || createdAt;
  const items = definition.items.map((item) => ({ ...item }));
  const totals = buildTotals(items, definition.totals || {});
  const customer = {
    email: normalizeEmail(definition.customer.email),
    name: String(definition.customer.name || ''),
    phone: String(definition.customer.phone || '')
  };
  const shippingAddress = totals.requiresShipping ? physicalAddress({
    name: customer.name,
    ...(definition.shippingAddress || {})
  }) : null;
  const billingAddress = definition.billingAddress
    ? physicalAddress({ name: customer.name, ...definition.billingAddress })
    : shippingAddress;
  const orderDraft = {
    version: 1,
    orderToken: definition.orderToken,
    status: 'confirmed',
    checkoutProvider: 'first_party',
    source: 'local_seed',
    createdAt,
    confirmedAt,
    expiresAt: definition.expiresAt || addDaysIso(createdAt, 30),
    preferredLang: definition.preferredLang || 'en',
    currency: 'USD',
    customer,
    shippingAddress,
    billingAddress,
    shippingOption: definition.shippingOption || (totals.requiresShipping ? 'standard' : ''),
    attribution: {
      ref: definition.attribution?.ref || 'local-seed',
      utmSource: definition.attribution?.utmSource || 'local',
      utmMedium: definition.attribution?.utmMedium || 'seed',
      utmCampaign: definition.attribution?.utmCampaign || 'order-testing',
      utmContent: definition.attribution?.utmContent || '',
      landingPath: definition.attribution?.landingPath || '/',
      capturedAt: createdAt
    },
    items,
    totals,
    fulfillment: {
      requiresShipping: totals.requiresShipping,
      requiresTurnstile: totals.requiresTurnstile,
      shippableItemCount: items
        .filter((item) => item.shippable)
        .reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 1) || 1), 0)
    },
    catalog: {
      version: 1,
      source: 'local-seed',
      sourceHash: 'local-seed'
    }
  };
  orderDraft.orderHash = await hashStoreOrderDraft(orderDraft);

  const paymentRequired = totals.requiresPayment;
  const storedOrder = {
    version: 1,
    orderToken: definition.orderToken,
    orderHash: orderDraft.orderHash,
    checkoutProvider: 'first_party',
    status: 'confirmed',
    createdAt,
    confirmedAt,
    updatedAt: definition.updatedAt || confirmedAt,
    expiresAt: orderDraft.expiresAt,
    preferredLang: orderDraft.preferredLang,
    orderDraft,
    payment: {
      required: paymentRequired,
      provider: paymentRequired ? 'stripe' : null,
      status: paymentRequired ? 'succeeded' : 'not_required',
      paymentIntentId: paymentRequired ? `pi_local_${definition.orderToken.replace(/^store-order-/, '')}` : '',
      chargeId: paymentRequired ? `ch_local_${definition.orderToken.replace(/^store-order-/, '')}` : '',
      balanceTransactionId: paymentRequired ? `txn_local_${definition.orderToken.replace(/^store-order-/, '')}` : '',
      amountCents: totals.totalCents,
      currency: 'USD',
      confirmedAt
    },
    emailSent: true,
    emailSentAt: confirmedAt,
    validationWarnings: [],
    localSeed: true
  };

  if (definition.downloadAccess) {
    storedOrder.downloadAccess = definition.downloadAccess;
  }
  if (definition.fulfillmentCheckIns) {
    storedOrder.fulfillmentCheckIns = definition.fulfillmentCheckIns;
  }
  return storedOrder;
}

function buildLookupEntry(storedOrder) {
  const orderDraft = storedOrder.orderDraft || {};
  const totals = orderDraft.totals || {};
  const items = Array.isArray(orderDraft.items) ? orderDraft.items : [];
  return {
    orderToken: storedOrder.orderToken || orderDraft.orderToken || '',
    status: storedOrder.status || orderDraft.status || 'confirmed',
    fulfillmentReady: true,
    createdAt: storedOrder.createdAt || orderDraft.createdAt || '',
    confirmedAt: storedOrder.confirmedAt || orderDraft.confirmedAt || '',
    updatedAt: storedOrder.updatedAt || storedOrder.confirmedAt || storedOrder.createdAt || '',
    preferredLang: orderDraft.preferredLang || 'en',
    totalCents: Math.max(0, Number(totals.totalCents || storedOrder.payment?.amountCents || 0) || 0),
    currency: orderDraft.currency || storedOrder.payment?.currency || 'USD',
    itemCount: Math.max(0, Number(totals.itemCount || items.length || 0) || 0),
    items: items.slice(0, 10).map((item) => ({
      name: item.name || '',
      variantLabel: item.variantLabel || '',
      quantity: Math.max(1, Number(item.quantity || 1) || 1),
      subtotalCents: Math.max(0, Number(item.subtotalCents || 0) || 0),
      fulfillmentType: item.fulfillmentType || ''
    }))
  };
}

function compareLookupEntries(a, b) {
  return Date.parse(b.confirmedAt || b.createdAt || '') - Date.parse(a.confirmedAt || a.createdAt || '');
}

function createLookupToken(secret, hash) {
  const jti = crypto.randomUUID().toLowerCase();
  const exp = Math.floor(Date.now() / 1000) + LOOKUP_TOKEN_TTL_SECONDS;
  const payload = {
    v: 1,
    scope: STORE_ORDER_LOOKUP_SCOPE,
    emailHash: hash,
    jti,
    exp
  };
  const payloadB64 = base64urlJson(payload);
  const signature = hmacBase64url(secret, payloadB64);
  return {
    jti,
    token: `${payloadB64}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

function kvPut(key, value, options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-local-orders-'));
  const valuePath = path.join(tmpDir, 'value.json');
  fs.writeFileSync(valuePath, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  const args = [
    'wrangler',
    'kv',
    'key',
    'put',
    key,
    '--binding',
    STORE_STATE_BINDING,
    '--local',
    '--preview',
    '--env',
    'dev',
    '--path',
    valuePath
  ];
  if (Number.isFinite(options.ttlSeconds) && options.ttlSeconds > 0) {
    args.push('--ttl', String(Math.floor(options.ttlSeconds)));
  }
  const result = spawnSync(commandName('npx'), args, {
    cwd: WORKER_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`wrangler kv key put ${key} failed: ${String(result.stderr || result.stdout || '').trim()}`);
  }
}

function r2PutTextObject(key, content, contentType = 'text/plain; charset=utf-8') {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-local-download-'));
  const valuePath = path.join(tmpDir, 'download.txt');
  fs.writeFileSync(valuePath, String(content || ''), 'utf8');
  const args = [
    'wrangler',
    'r2',
    'object',
    'put',
    `${LOCAL_R2_BUCKET}/${key}`,
    '--local',
    '--env',
    'dev',
    '--file',
    valuePath,
    '--content-type',
    contentType
  ];
  const result = spawnSync(commandName('npx'), args, {
    cwd: WORKER_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`wrangler r2 object put ${key} failed: ${String(result.stderr || result.stdout || '').trim()}`);
  }
}

async function buildOrders() {
  const downloadItemId = 'download-1';
  const demoDownloadItemId = 'demo-download';
  const downloadIssuedAt = new Date().toISOString();
  return Promise.all([
    buildStoredOrder({
      orderToken: 'store-order-local-demo-all',
      createdAt: '2026-06-29T17:30:00.000Z',
      confirmedAt: '2026-06-29T17:32:00.000Z',
      customer: {
        email: 'demo@example.com',
        name: 'Demo Customer'
      },
      shippingAddress: {
        name: 'Demo Customer',
        line1: '100 Central Ave NW',
        line2: 'Suite 12',
        city: 'Albuquerque',
        region: 'NM',
        postalCode: '87102'
      },
      items: [
        baseItem({
          productId: 'demo-physical-shirt',
          variantId: 'black-m',
          sku: 'demo-shirt-black-m',
          name: 'Demo Physical Shirt',
          variantLabel: 'Black / M',
          quantity: 1,
          unitPriceDollars: 30,
          fulfillmentType: 'physical',
          collection: 'demo',
          category: 'apparel',
          shippable: true,
          shippingPreset: 'tshirt',
          image: '/assets/images/dustwave-tshirt.png',
          url: '/products/dust-wave-t-shirt/'
        }),
        baseItem({
          productId: 'demo-digital-download',
          sku: demoDownloadItemId,
          name: 'Demo Digital Download',
          quantity: 1,
          unitPriceDollars: 12,
          fulfillmentType: 'digital',
          collection: 'demo',
          category: 'downloads',
          shippable: false,
          taxCategory: 'digital',
          image: '/assets/images/default.png',
          url: '/products/dust-wave-digital-download/',
          download: {
            file_key: LOCAL_DEMO_DOWNLOAD_KEY,
            filename: 'Local Demo Digital Download.txt',
            delivery: 'signed_link'
          }
        }),
        baseItem({
          productId: 'demo-ticket',
          variantId: 'general',
          sku: 'demo-ticket-general',
          name: 'Demo Event Ticket',
          variantLabel: 'General Admission',
          quantity: 2,
          unitPriceDollars: 18,
          fulfillmentType: 'ticket',
          collection: 'demo',
          category: 'tickets',
          shippable: false,
          taxCategory: 'admission',
          image: '/assets/images/calendar-2026.png',
          url: '/products/dust-wave-free-rsvp/',
          eventDetails: {
            title: 'Demo Event Ticket',
            starts_at: '2026-08-15T02:00:00.000Z',
            ends_at: '2026-08-15T05:00:00.000Z',
            venue: 'Guild Cinema',
            address: '3405 Central Ave NE, Albuquerque, NM 87106',
            ticket_delivery: 'qr',
            ics: true
          }
        }),
        baseItem({
          productId: 'demo-free-rsvp',
          sku: 'demo-rsvp',
          name: 'Demo Free RSVP',
          quantity: 1,
          unitPriceDollars: 0,
          fulfillmentType: 'rsvp',
          collection: 'demo',
          category: 'tickets',
          shippable: false,
          taxCategory: 'admission',
          image: '/assets/images/calendar-2026.png',
          url: '/products/dust-wave-free-rsvp/',
          eventDetails: {
            title: 'Demo Free RSVP',
            starts_at: '2026-08-16T01:00:00.000Z',
            ends_at: '2026-08-16T03:00:00.000Z',
            venue: 'Dust Wave',
            address: 'Albuquerque, NM',
            ticket_delivery: 'qr',
            ics: true
          }
        }),
        baseItem({
          productId: 'demo-service',
          sku: 'demo-service',
          name: 'Demo Service Session',
          quantity: 1,
          unitPriceDollars: 45,
          fulfillmentType: 'service',
          collection: 'demo',
          category: 'services',
          shippable: false,
          taxCategory: 'service',
          image: '/assets/images/default.png',
          url: '/'
        })
      ],
      totals: {
        discountCents: 1000,
        couponCode: 'DEMO10',
        coupon: {
          id: 'demo10',
          code: 'DEMO10',
          description: 'Local all-variation demo discount',
          discountType: 'amount',
          percentOff: 0,
          amountOffCents: 1000,
          appliesTo: 'cart',
          productIds: [],
          discountCents: 1000
        },
        tipPercent: 5,
        shippingCents: 750,
        taxCents: 890
      },
      downloadAccess: {
        [demoDownloadItemId]: {
          status: 'active',
          issuedAt: downloadIssuedAt,
          updatedAt: downloadIssuedAt,
          updatedBy: 'local-seed'
        }
      },
      fulfillmentCheckIns: {
        'demo-ticket-general': {
          checkedIn: false,
          quantity: 0,
          updatedAt: '2026-06-29T17:32:00.000Z',
          updatedBy: 'local-seed'
        },
        'demo-rsvp': {
          checkedIn: false,
          quantity: 0,
          updatedAt: '2026-06-29T17:32:00.000Z',
          updatedBy: 'local-seed'
        }
      }
    }),
    buildStoredOrder({
      orderToken: 'store-order-local-alonso-001',
      createdAt: '2026-06-21T17:15:00.000Z',
      confirmedAt: '2026-06-21T17:17:00.000Z',
      customer: {
        email: 'alonso@dustwave.xyz',
        name: 'Alonso'
      },
      shippingAddress: {
        line1: '500 Central Ave NW',
        city: 'Albuquerque',
        region: 'NM',
        postalCode: '87102'
      },
      items: [
        baseItem({
          productId: 'dust-wave-t-shirt',
          variantId: 'm',
          sku: 't-shirt-1-m',
          name: 'DUST WAVE T-Shirt',
          variantLabel: 'M',
          quantity: 1,
          unitPriceDollars: 25,
          fulfillmentType: 'physical',
          collection: 'dustwave',
          category: 'apparel',
          shippable: true,
          shippingPreset: 'tshirt',
          image: '/assets/images/dustwave-tshirt.png',
          url: '/products/dust-wave-t-shirt/'
        }),
        baseItem({
          productId: 'dust-wave-sticker',
          sku: 'sticker-1',
          name: 'DUST WAVE Sticker',
          quantity: 2,
          unitPriceDollars: 3,
          fulfillmentType: 'physical',
          collection: 'dustwave',
          category: 'stickers',
          shippable: true,
          shippingPreset: 'sticker',
          image: '/assets/images/sticker-glove.png',
          url: '/products/dust-wave-sticker/'
        })
      ],
      totals: {
        discountCents: 300,
        couponCode: 'LOCAL10',
        coupon: {
          id: 'local10',
          code: 'LOCAL10',
          description: 'Local seed order discount',
          discountType: 'amount',
          percentOff: 0,
          amountOffCents: 300,
          appliesTo: 'cart',
          productIds: [],
          discountCents: 300
        },
        tipPercent: 5,
        shippingCents: 955,
        taxCents: 214
      }
    }),
    buildStoredOrder({
      orderToken: 'store-order-local-alonso-002',
      createdAt: '2026-06-22T23:30:00.000Z',
      confirmedAt: '2026-06-22T23:31:00.000Z',
      customer: {
        email: 'alonso@dustwave.xyz',
        name: 'Alonso'
      },
      items: [
        baseItem({
          productId: 'dust-wave-free-rsvp',
          sku: 'rsvp-1',
          name: 'DUST WAVE Free RSVP',
          quantity: 1,
          unitPriceDollars: 0,
          fulfillmentType: 'rsvp',
          collection: 'dustwave',
          category: 'tickets',
          shippable: false,
          taxCategory: 'admission',
          image: '/assets/images/calendar-2026.png',
          url: '/products/dust-wave-free-rsvp/',
          eventDetails: {
            title: 'Dust Wave After Dark',
            starts_at: '2026-07-18T02:00:00.000Z',
            ends_at: '2026-07-18T05:00:00.000Z',
            venue: 'Dust Wave',
            address: 'Albuquerque, NM',
            ticket_delivery: 'qr',
            ics: true
          }
        })
      ],
      totals: {
        tipPercent: 0,
        shippingCents: 0,
        taxCents: 0
      },
      fulfillmentCheckIns: {
        'rsvp-1': {
          checkedIn: false,
          quantity: 0,
          updatedAt: '2026-06-22T23:31:00.000Z',
          updatedBy: 'local-seed'
        }
      }
    }),
    buildStoredOrder({
      orderToken: 'store-order-local-customer-001',
      createdAt: '2026-06-23T15:45:00.000Z',
      confirmedAt: '2026-06-23T15:46:00.000Z',
      customer: {
        email: 'customer@example.com',
        name: 'Test Customer'
      },
      items: [
        baseItem({
          productId: 'dust-wave-digital-download',
          sku: downloadItemId,
          name: 'DUST WAVE Digital Download',
          quantity: 1,
          unitPriceDollars: 5,
          fulfillmentType: 'digital',
          collection: 'dustwave',
          category: 'downloads',
          shippable: false,
          taxCategory: 'digital',
          image: '/assets/images/default.png',
          url: '/products/dust-wave-digital-download/',
          download: {
            file_key: 'dust-wave-constitution-code-of-conduct-safety-guidelines-v1.pdf',
            filename: 'Dust Wave Constitution + Code of Conduct + Safety Guidelines V1.pdf',
            delivery: 'signed_link'
          }
        }),
        baseItem({
          productId: 'fronteras-poster-big',
          sku: 'poster-1',
          name: 'Fronteras Poster (Big)',
          quantity: 1,
          unitPriceDollars: 35,
          fulfillmentType: 'physical',
          collection: 'fronteras',
          category: 'prints',
          shippable: true,
          shippingPreset: 'poster',
          image: '/assets/images/fronteras-poster.png',
          url: '/products/fronteras-poster-big/'
        })
      ],
      shippingAddress: {
        name: 'Test Customer',
        line1: '90210 Wilshire Blvd',
        city: 'Beverly Hills',
        region: 'CA',
        postalCode: '90210'
      },
      totals: {
        tipPercent: 5,
        shippingCents: 1250,
        taxCents: 309
      },
      downloadAccess: {
        [downloadItemId]: {
          status: 'active',
          issuedAt: downloadIssuedAt,
          updatedAt: downloadIssuedAt,
          updatedBy: 'local-seed'
        }
      }
    }),
    buildStoredOrder({
      orderToken: 'store-order-local-shopper-001',
      createdAt: '2026-06-20T20:10:00.000Z',
      confirmedAt: '2026-06-20T20:12:00.000Z',
      customer: {
        email: 'shopper@example.com',
        name: 'Local Shopper'
      },
      items: [
        baseItem({
          productId: 'dust-wave-butterfingers-t-shirt',
          variantId: 's',
          sku: 't-shirt-3-s',
          name: 'DUST WAVE Butterfingers T-Shirt',
          variantLabel: 'S',
          quantity: 1,
          unitPriceDollars: 25,
          fulfillmentType: 'physical',
          collection: 'dustwave',
          category: 'apparel',
          shippable: true,
          shippingPreset: 'tshirt',
          image: '/assets/images/butterfingers-tshirt.png',
          url: '/products/dust-wave-butterfingers-t-shirt/'
        }),
        baseItem({
          productId: 'dust-wave-mug',
          sku: 'mug-1',
          name: 'DUST WAVE Mug',
          quantity: 1,
          unitPriceDollars: 20,
          fulfillmentType: 'physical',
          collection: 'dustwave',
          category: 'objects',
          shippable: true,
          shippingPreset: 'mug',
          image: '/assets/images/dustwave-mug.png',
          url: '/products/dust-wave-mug/'
        })
      ],
      shippingAddress: {
        name: 'Local Shopper',
        line1: '88 Broadway',
        city: 'New York',
        region: 'NY',
        postalCode: '10007'
      },
      totals: {
        tipPercent: 5,
        shippingCents: 1180,
        taxCents: 400
      }
    })
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help'] || args['-h']) {
    console.log(`Usage: npm run seed:local-orders [-- --site-base=http://127.0.0.1:4002]

Seeds local Wrangler KV with confirmed Store orders and one-time order lookup links.
This command refuses to run unless worker/.dev.vars uses APP_MODE=test and local URLs.`);
    return;
  }

  const env = readDevVars();
  ensureLocalTarget(env);
  const lookupSecret = getLookupSecret(env);
  if (!lookupSecret) {
    throw new Error('worker/.dev.vars needs MAGIC_LINK_SECRET or STORE_ORDER_LOOKUP_SECRET before lookup links can be seeded.');
  }

  r2PutTextObject(
    LOCAL_DEMO_DOWNLOAD_KEY,
    [
      'Store local demo download',
      '',
      'This file is seeded into local R2 for manual order-page testing.',
      `Generated: ${new Date().toISOString()}`
    ].join('\n')
  );

  const siteBase = String(args['--site-base'] || env.SITE_BASE || SITE_BASE_FALLBACK).replace(/\/+$/, '');
  const orders = await buildOrders();
  const byEmailHash = new Map();

  for (const order of orders) {
    const key = `orders:${order.orderToken}`;
    kvPut(key, order);
    const hash = emailHash(order.orderDraft.customer.email);
    const current = byEmailHash.get(hash) || {
      email: order.orderDraft.customer.email,
      emailHash: hash,
      entries: []
    };
    current.entries.push(buildLookupEntry(order));
    byEmailHash.set(hash, current);
  }

  const lookupLinks = [];
  for (const record of byEmailHash.values()) {
    const nowIso = new Date().toISOString();
    const index = {
      version: 1,
      emailHash: record.emailHash,
      createdAt: nowIso,
      updatedAt: nowIso,
      orders: record.entries
        .sort(compareLookupEntries)
        .slice(0, EMAIL_INDEX_LIMIT)
    };
    kvPut(`${STORE_ORDER_EMAIL_INDEX_PREFIX}${record.emailHash}`, index);

    const lookup = createLookupToken(lookupSecret, record.emailHash);
    kvPut(`${STORE_ORDER_LOOKUP_TOKEN_PREFIX}${lookup.jti}`, {
      version: 1,
      scope: STORE_ORDER_LOOKUP_SCOPE,
      emailHash: record.emailHash,
      createdAt: nowIso,
      expiresAt: lookup.expiresAt
    }, {
      ttlSeconds: LOOKUP_TOKEN_TTL_SECONDS
    });
    lookupLinks.push({
      email: record.email,
      orderCount: index.orders.length,
      url: `${siteBase}/orders/?token=${encodeURIComponent(lookup.token)}`
    });
  }

  console.log(`Seeded ${orders.length} local Store orders into ${STORE_STATE_BINDING}.`);
  console.log(`Seeded local R2 download object: ${LOCAL_R2_BUCKET}/${LOCAL_DEMO_DOWNLOAD_KEY}`);
  console.log('');
  console.log(`All-variation demo: ${siteBase}/order-success/?orderToken=store-order-local-demo-all`);
  console.log('');
  console.log('Order lookup links are one-time links. Re-run this command after using one.');
  for (const link of lookupLinks.sort((a, b) => a.email.localeCompare(b.email))) {
    console.log(`- ${link.email} (${link.orderCount}): ${link.url}`);
  }
  console.log('');
  console.log('Direct order URLs:');
  for (const order of orders) {
    console.log(`- ${order.orderDraft.customer.email}: ${siteBase}/order-success/?orderToken=${encodeURIComponent(order.orderToken)}`);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});

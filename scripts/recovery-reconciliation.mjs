#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { buildStoreInventorySoldCountsFromOrders } from '../worker/src/admin-store-read-model.js';
import {
  compareStoreOrdersToStripePaymentIntents,
  storeStripeRecoveryComparisonGate,
  stripeCredentialMode
} from '../worker/src/store-recovery-reconciliation.js';
import { buildStoreRestorePlan, readAndVerifySnapshot, transformKvValuesToRestoreRecords } from './store-restore.mjs';

function valueArg(args, name, fallback = '') {
  const exact = args.indexOf(name);
  if (exact >= 0 && args[exact + 1]) return args[exact + 1];
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function increment(target, key) {
  const normalized = String(key || 'unknown').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64) || 'unknown';
  target[normalized] = (target[normalized] || 0) + 1;
}

function readCapturedOrders(snapshot) {
  const plan = buildStoreRestorePlan(snapshot, { target: 'plan' });
  const action = plan.actions.find((entry) => entry.type === 'kv-restore' && entry.familyId === 'orders');
  if (!action?.valuesFile || !action.validation?.ok) {
    throw new Error('Captured snapshot does not contain a valid orders value artifact.');
  }
  const values = JSON.parse(fs.readFileSync(action.valuesFile, 'utf8'));
  return transformKvValuesToRestoreRecords(values).map((record) => JSON.parse(record.value));
}

function normalizedRecoveryOrder(order = {}) {
  const orderDraft = order.orderDraft || {};
  return {
    orderToken: String(order.orderToken || orderDraft.orderToken || ''),
    status: String(order.status || orderDraft.status || ''),
    totals: order.totals || orderDraft.totals || {},
    payment: order.payment || {},
    stripePaymentIntentId: String(order.stripePaymentIntentId || ''),
    items: Array.isArray(order.items) ? order.items : (Array.isArray(orderDraft.items) ? orderDraft.items : [])
  };
}

export { stripeCredentialMode };

export async function reconcileCapturedStoreOrders(orders = [], options = {}) {
  const normalizedOrders = orders.map(normalizedRecoveryOrder).filter((order) => order.orderToken);
  const statusCounts = {};
  const fulfillmentCounts = {};
  for (const order of normalizedOrders) {
    increment(statusCounts, order.status);
    for (const item of order.items) increment(fulfillmentCounts, item.fulfillmentType || 'unknown');
  }
  const sold = buildStoreInventorySoldCountsFromOrders(normalizedOrders);
  const maximumStripeRequests = boundedInteger(options.maximumStripeRequests, 500, 1, 5000);
  const stripeTimeoutMs = boundedInteger(options.stripeTimeoutMs, 10000, 1000, 30000);
  const stripeMode = String(options.stripeMode || 'available').trim().toLowerCase();
  const stripe = await compareStoreOrdersToStripePaymentIntents(normalizedOrders, {
    mode: stripeMode,
    expectedCredentialMode: options.expectedStripeMode,
    secretKey: options.stripeSecretKey,
    maximumRequests: maximumStripeRequests,
    requestTimeoutMs: stripeTimeoutMs,
    concurrency: boundedInteger(options.concurrency, 4, 1, 10),
    fetchImpl: options.fetchImpl
  });
  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    containsCredentials: false,
    containsCustomerData: false,
    containsOrderIds: false,
    containsProviderIds: false,
    providerWritesExecuted: false,
    orders: {
      total: normalizedOrders.length,
      statuses: statusCounts,
      fulfillmentItems: fulfillmentCounts,
      confirmedForInventory: sold.confirmedOrders,
      soldSkus: Object.keys(sold.soldBySku).length,
      soldQuantity: Object.values(sold.soldBySku).reduce((sum, quantity) => sum + Number(quantity || 0), 0)
    },
    stripe
  };
}

export function recoveryReconciliationGate(evidence = {}, stripeMode = 'available') {
  return storeStripeRecoveryComparisonGate(evidence?.stripe, stripeMode);
}

function writeOutput(filePath, value) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/recovery-reconciliation.mjs --snapshot=DIR [--stripe-mode=off|available|required] [--expected-stripe-mode=any|live|test] [--maximum-stripe-requests=500] [--stripe-timeout-ms=10000] [--concurrency=4] [--output=FILE] [--strict]');
    console.log('Set STRIPE_SECRET_KEY for optional read-only PaymentIntent comparisons. Evidence contains counts and reason categories only.');
    return;
  }
  const snapshotPath = valueArg(args, '--snapshot', '');
  if (!snapshotPath) throw new Error('--snapshot is required.');
  const snapshot = readAndVerifySnapshot(snapshotPath);
  const stripeMode = valueArg(args, '--stripe-mode', 'available');
  const result = await reconcileCapturedStoreOrders(readCapturedOrders(snapshot), {
    stripeMode,
    expectedStripeMode: valueArg(args, '--expected-stripe-mode', 'any'),
    stripeSecretKey: process.env.STRIPE_SECRET_KEY_LIVE || process.env.STRIPE_SECRET_KEY || '',
    maximumStripeRequests: valueArg(args, '--maximum-stripe-requests', '500'),
    stripeTimeoutMs: valueArg(args, '--stripe-timeout-ms', '10000'),
    concurrency: valueArg(args, '--concurrency', '4')
  });
  const evidence = {
    ...result,
    snapshot: {
      version: Number(snapshot.manifest.version || 0),
      createdAt: snapshot.manifest.createdAt || '',
      sourceCommit: snapshot.manifest.git?.head || '',
      integrityArtifacts: snapshot.integrity.checked
    }
  };
  writeOutput(valueArg(args, '--output', ''), evidence);
  console.log(JSON.stringify(evidence, null, 2));
  if (args.includes('--strict') && !recoveryReconciliationGate(evidence, stripeMode).passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

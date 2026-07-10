#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { buildChecksumManifest } from './lib/file-integrity.mjs';
import { loadStoreDataInventory } from './lib/store-data-inventory.mjs';
import {
  buildStoreRestorePlan,
  executeStoreRestorePlan,
  readAndVerifySnapshot
} from './store-restore.mjs';

const REPRESENTATIVE_ORDER_TYPES = Object.freeze(['digital', 'physical', 'rsvp', 'ticket']);

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function writeBytes(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, value, { mode: 0o600 });
}

function safePrefix(value) {
  return String(value || 'item').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
}

function orderFixture(type, options = {}) {
  const token = `store-order-restore-${type}`;
  const paid = type !== 'rsvp';
  return {
    orderToken: token,
    status: options.status || 'confirmed',
    createdAt: '2026-07-09T00:00:00.000Z',
    confirmedAt: options.status === 'failed' ? '' : '2026-07-09T00:01:00.000Z',
    payment: {
      status: options.status === 'failed' ? 'failed' : (paid ? 'succeeded' : 'not_required'),
      provider: paid ? 'stripe' : 'none',
      paymentIntentId: paid ? `pi_restore_${type}` : ''
    },
    orderDraft: {
      orderToken: token,
      status: options.status || 'confirmed',
      customer: { email: `${type}-restore@example.invalid`, name: `${type} restore fixture` },
      items: [{
        id: `${type}-fixture`,
        sku: `${type}-fixture`,
        quantity: 1,
        fulfillmentType: type,
        ...(type === 'digital' ? { download: { fileKey: 'downloads/restore-drill.txt' } } : {}),
        ...(type === 'ticket' || type === 'rsvp' ? { eventId: 'restore-event', checkedInQuantity: 0 } : {})
      }],
      totals: { subtotalCents: paid ? 1200 : 0, totalCents: paid ? 1200 : 0, currency: 'USD' }
    }
  };
}

function representativeKvValues() {
  const orders = Object.fromEntries([
    ...REPRESENTATIVE_ORDER_TYPES.map((type) => {
      const order = orderFixture(type);
      return [`orders:${order.orderToken}`, { value: JSON.stringify(order) }];
    }),
    (() => {
      const order = orderFixture('failed-payment', { status: 'failed' });
      return [`orders:${order.orderToken}`, { value: JSON.stringify(order) }];
    })()
  ]);
  return {
    orders,
    'inventory-overrides': {
      'store-inventory-overrides:v1': { value: JSON.stringify({ version: 1, inventory: { 'physical-fixture': 12 } }) }
    },
    'addon-inventory-overrides': {
      'add-on-inventory-overrides': { value: JSON.stringify({ version: 1, inventory: { 'physical-fixture': 8 } }) }
    },
    coupons: {
      'store-coupons:v1': { value: JSON.stringify({ version: 1, coupons: [{ code: 'RESTORE10', percentOff: 10 }] }) }
    },
    'admin-users': {
      'admin-users:v1': { value: JSON.stringify({ users: [{ email: 'recovery-admin@example.invalid', role: 'super_admin', accessScopes: [] }] }) }
    },
    'marketing-referrals': {
      'admin-store-marketing-referrals:v1': { value: JSON.stringify([{ code: 'restore', name: 'Restore fixture' }]) }
    },
    'abandoned-cart-suppressions': {
      'abandoned-cart-suppressed:restore-email-hash': { value: JSON.stringify({ emailHash: 'restore-email-hash', suppressedAt: '2026-07-09T00:00:00.000Z' }) }
    },
    'stripe-events': {
      'stripe-event:evt_restore_fixture': { value: JSON.stringify({ processedAt: '2026-07-09T00:02:00.000Z' }) }
    },
    'customer-email-sent': {
      'store-order-email-sent:store-order-restore-digital': { value: '2026-07-09T00:03:00.000Z' }
    },
    'admin-email-sent': {
      'store-order-admin-email-sent:store-order-restore-digital:admin-hash': { value: '2026-07-09T00:03:00.000Z' }
    },
    'abandoned-cart-sent': {
      'abandoned-cart-sent:restore-cart-hash': { value: '2026-07-09T00:03:00.000Z' }
    },
    'event-reminder-sent': {
      'store-event-reminder-sent:restore-event:store-order-restore-ticket': { value: '2026-07-09T00:03:00.000Z' }
    },
    'admin-audit': {
      'admin-audit:restore-fixture': { value: JSON.stringify({ action: 'restore_fixture', createdAt: '2026-07-09T00:04:00.000Z' }) }
    }
  };
}

export function createSyntheticSnapshot(root) {
  const values = representativeKvValues();
  for (const family of loadStoreDataInventory().families.filter((entry) => entry.type === 'kv' && entry.backupValues)) {
    writeJson(path.join(root, 'kv', `${safePrefix(family.prefix)}.values.json`), values[family.id] || {});
  }

  writeJson(path.join(root, 'kv', 'admin-session.values.json'), {
    'admin-session:must-not-restore': { value: '{"token":"quarantined"}' }
  });
  writeJson(path.join(root, 'kv', 'abandoned-cart.values.json'), {
    'abandoned-cart:must-not-restore': { value: '{"email":"private@example.invalid"}' }
  });
  writeJson(path.join(root, 'kv', 'admin-store-orders_index_v2.values.json'), {
    'admin-store-orders:index:v2': { value: '{"derived":true}' }
  });
  writeBytes(path.join(root, 'r2', 'objects', 'downloads', 'restore-drill.txt'), 'synthetic private download fixture\n');
  writeJson(path.join(root, 'manifest.json'), {
    version: 2,
    createdAt: new Date().toISOString(),
    git: { head: 'synthetic-restore-drill' },
    r2: { bucket: 'store-downloads-preview' }
  });
  const artifacts = buildChecksumManifest(root, { exclude: ['checksums.json'] });
  writeJson(path.join(root, 'checksums.json'), { schemaVersion: 1, artifacts });
}

async function probePodmanWorker(fetchImpl = fetch) {
  const workerUrl = String(process.env.WORKER_URL || 'http://127.0.0.1:8989').replace(/\/+$/, '');
  const response = await fetchImpl(`${workerUrl}/admin/session`, { redirect: 'error' });
  return {
    url: `${workerUrl}/admin/session`,
    status: response.status,
    privateNoStore: String(response.headers.get('cache-control') || '').includes('no-store')
  };
}

export async function runSyntheticRestoreRehearsal(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-restore-drill-'));
  fs.chmodSync(root, 0o700);
  try {
    createSyntheticSnapshot(root);
    const snapshot = readAndVerifySnapshot(root);
    const plan = buildStoreRestorePlan(snapshot, { target: 'local' });
    const restoredRecords = [];
    const commands = [];
    const restoredR2Objects = [];
    const runner = (command, args) => {
      commands.push([command, ...args]);
      const restoreFile = args.find((arg) => String(arg).endsWith('.restore.json'));
      if (restoreFile) restoredRecords.push(...JSON.parse(fs.readFileSync(restoreFile, 'utf8')));
      const r2Target = args.find((arg, index) => args[index - 1] === 'put' && String(arg).includes('/'));
      if (args.includes('r2') && args.includes('put') && r2Target) restoredR2Objects.push(String(r2Target));
      return { status: 0, stdout: '', stderr: '', error: '' };
    };
    const execution = executeStoreRestorePlan(plan, {
      target: 'local',
      conflict: 'overwrite',
      persistTo: path.join(root, 'wrangler-state'),
      runner
    });
    const restoredKeys = restoredRecords.map((record) => String(record.key));
    const restoredOrders = restoredRecords
      .filter((record) => String(record.key).startsWith('orders:'))
      .map((record) => JSON.parse(String(record.value)));
    const representativeTypes = Array.from(new Set(restoredOrders.flatMap((order) => (
      order.orderDraft?.items || []
    )).map((item) => String(item.fulfillmentType || '')))).filter((type) => REPRESENTATIVE_ORDER_TYPES.includes(type)).sort();
    const quarantineRestored = restoredKeys.some((key) => (
      key.startsWith('admin-session:') || key.startsWith('abandoned-cart:')
    ));
    const derivedRestored = restoredKeys.includes('admin-store-orders:index:v2');
    const sideEffectCommands = commands.filter((parts) => !(
      parts[0] === 'npx' && parts[1] === 'wrangler' && ['kv', 'r2'].includes(parts[2])
    ));
    const probe = options.probeWorker === false
      ? { url: '', status: 401, privateNoStore: true, skipped: true }
      : await probePodmanWorker(options.fetchImpl || fetch);
    const result = {
      schemaVersion: 1,
      rehearsedAt: new Date().toISOString(),
      ok: execution.ok &&
        !quarantineRestored &&
        !derivedRestored &&
        representativeTypes.join(',') === REPRESENTATIVE_ORDER_TYPES.join(',') &&
        restoredR2Objects.length === 1 &&
        sideEffectCommands.length === 0 &&
        probe.status === 401 &&
        probe.privateNoStore,
      containsProductionData: false,
      providerWritesExecuted: false,
      integrityArtifacts: snapshot.integrity.checked,
      plannedActions: plan.actions.length,
      restoredRecords: restoredRecords.length,
      restoredOrderRecords: restoredOrders.length,
      representativeOrderTypes: representativeTypes,
      failedPaymentOrderRestored: restoredKeys.includes('orders:store-order-restore-failed-payment'),
      paymentIdempotencyRestored: restoredKeys.includes('stripe-event:evt_restore_fixture'),
      reminderControlsRestored: restoredKeys.some((key) => key.startsWith('store-event-reminder-sent:')) &&
        restoredKeys.some((key) => key.startsWith('abandoned-cart-suppressed:')),
      auditEvidenceRestored: restoredKeys.includes('admin-audit:restore-fixture'),
      inventoryControlsRestored: restoredKeys.includes('store-inventory-overrides:v1') &&
        restoredKeys.includes('add-on-inventory-overrides'),
      restoredR2Objects,
      quarantineRestored,
      derivedRestored,
      sideEffectCommands: sideEffectCommands.length,
      missingValueFamilies: plan.missingValueFamilies.length,
      derivedRepairPlanned: plan.actions.some((action) => action.familyId === 'admin-order-index' && action.type === 'rebuild'),
      podmanWorkerProbe: probe
    };
    return result;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const outputArg = args.find((arg) => arg.startsWith('--output='));
  const output = outputArg ? outputArg.slice('--output='.length) : '';
  const result = await runSyntheticRestoreRehearsal({ probeWorker: !args.includes('--no-worker-probe') });
  if (output) {
    const resolved = path.resolve(output);
    fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
    fs.writeFileSync(resolved, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

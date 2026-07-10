#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCommand } from './lib/command-runner.mjs';
import { verifyChecksumManifest } from './lib/file-integrity.mjs';
import { loadStoreDataInventory } from './lib/store-data-inventory.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = path.join(ROOT, 'worker');
const PRODUCTION_ACKNOWLEDGEMENT = 'STORE_PRODUCTION_RESTORE';

function valueArg(args, name, fallback = '') {
  const exact = args.indexOf(name);
  if (exact >= 0 && args[exact + 1]) return args[exact + 1];
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

export function parseRestoreArgs(args = []) {
  return {
    help: args.includes('--help') || args.includes('-h'),
    snapshot: valueArg(args, '--snapshot', ''),
    target: valueArg(args, '--target', 'plan'),
    execute: args.includes('--execute'),
    conflict: valueArg(args, '--conflict', 'abort'),
    persistTo: valueArg(args, '--persist-to', ''),
    previewR2Bucket: valueArg(args, '--preview-r2-bucket', ''),
    acknowledgeProduction: valueArg(args, '--acknowledge-production', ''),
    maintenanceConfirmed: args.includes('--maintenance-confirmed'),
    stripeWebhooksPaused: args.includes('--stripe-webhooks-paused'),
    inventoryReservationsReviewed: args.includes('--inventory-reservations-reviewed'),
    preRestoreSnapshot: valueArg(args, '--pre-restore-snapshot', ''),
    json: args.includes('--json')
  };
}

function printHelp() {
  console.log(`Usage: node scripts/store-restore.mjs --snapshot=DIR [options]

Default behavior is verification and planning only. No provider writes occur.

Options:
  --target=plan|local|preview|production
  --execute                     Execute the generated local/preview/production plan.
  --conflict=abort|overwrite    Required as overwrite for execution.
  --persist-to=DIR              Isolated Wrangler local-state directory.
  --preview-r2-bucket=NAME      Required distinct R2 bucket for preview object restore.
  --acknowledge-production=${PRODUCTION_ACKNOWLEDGEMENT}
  --maintenance-confirmed
  --stripe-webhooks-paused
  --inventory-reservations-reviewed
  --pre-restore-snapshot=DIR
  --json

Encrypted backup receipts must be decrypted into an isolated 0700 directory
before this command is run. Never restore session, login, rate-limit, one-time
token, cron, or pending reminder records.`);
}

function safeName(value) {
  return String(value || 'item').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readAndVerifySnapshot(snapshotDir) {
  const root = path.resolve(snapshotDir || '');
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Snapshot manifest.json was not found.');
  const manifest = readJson(manifestPath);
  if (manifest.encrypted === true && manifest.archive) {
    throw new Error('Decrypt the encrypted snapshot into an isolated directory before restore planning.');
  }
  if (Number(manifest.version || 0) !== 2) throw new Error('Restore requires a Store snapshot v2 manifest.');
  const checksumsPath = path.join(root, 'checksums.json');
  if (!fs.existsSync(checksumsPath)) throw new Error('Snapshot checksums.json was not found.');
  const checksums = readJson(checksumsPath);
  const integrity = verifyChecksumManifest(root, checksums.artifacts || [], {
    requireComplete: true,
    exclude: ['checksums.json']
  });
  if (!integrity.ok) {
    throw new Error(`Snapshot integrity failed: ${integrity.failures.map((failure) => `${failure.path}:${failure.reason}`).join(', ')}`);
  }
  return { root, manifest, checksums, integrity };
}

export function transformKvValuesToRestoreRecords(values = {}) {
  if (Array.isArray(values)) {
    return values.map((entry) => ({
      key: String(entry.key || ''),
      value: String(entry.value ?? ''),
      ...(entry.metadata ? { metadata: entry.metadata } : {})
    })).filter((entry) => entry.key);
  }
  return Object.entries(values || {}).map(([key, entry]) => ({
    key,
    value: String(entry?.value ?? ''),
    ...(entry?.metadata ? { metadata: entry.metadata } : {})
  }));
}

export function validateKvRestoreRecords(family = {}, records = []) {
  const errors = [];
  for (const record of records) {
    if (!String(record.key || '').startsWith(family.prefix)) {
      errors.push(`${record.key || '<missing>'}: key does not match ${family.prefix}`);
      continue;
    }
    if (family.id === 'orders') {
      try {
        const order = JSON.parse(record.value);
        const token = String(order.orderToken || order.orderDraft?.orderToken || '');
        if (!token || record.key !== `orders:${token}`) errors.push(`${record.key}: order token mismatch`);
        if (!order.orderDraft || !String(order.status || order.orderDraft.status || '')) errors.push(`${record.key}: invalid order shape`);
      } catch {
        errors.push(`${record.key}: invalid order JSON`);
      }
    }
    if (family.id === 'admin-users') {
      try {
        const parsed = JSON.parse(record.value);
        const users = Array.isArray(parsed) ? parsed : parsed.users;
        if (!Array.isArray(users)) errors.push(`${record.key}: invalid admin user list`);
      } catch {
        errors.push(`${record.key}: invalid admin user JSON`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function buildStoreRestorePlan(snapshot, options = {}) {
  const inventory = options.inventory || loadStoreDataInventory();
  const actions = [];
  const warnings = [];
  const missingValueFamilies = [];
  const kvFamilies = inventory.families.filter((family) => family.type === 'kv');
  for (const family of kvFamilies) {
    const valuesFile = path.join(snapshot.root, 'kv', `${safeName(family.prefix)}.values.json`);
    if (family.classification === 'ephemeral-quarantined') {
      actions.push({ type: 'skip', familyId: family.id, prefix: family.prefix, reason: 'quarantined' });
      continue;
    }
    if (family.classification === 'derived-rebuildable') {
      actions.push({
        type: 'rebuild',
        familyId: family.id,
        prefix: family.prefix,
        reason: family.restoreDefault,
        deleteKey: family.id === 'admin-order-index' ? family.prefix : ''
      });
      continue;
    }
    if (!family.backupValues) {
      actions.push({ type: 'skip', familyId: family.id, prefix: family.prefix, reason: family.restoreDefault });
      continue;
    }
    if (!fs.existsSync(valuesFile)) {
      warnings.push(`No value artifact for ${family.id} (${family.prefix}).`);
      missingValueFamilies.push({ familyId: family.id, prefix: family.prefix });
      continue;
    }
    const records = transformKvValuesToRestoreRecords(readJson(valuesFile));
    const validation = validateKvRestoreRecords(family, records);
    actions.push({
      type: 'kv-restore',
      familyId: family.id,
      binding: family.binding,
      prefix: family.prefix,
      valuesFile,
      recordCount: records.length,
      validation
    });
  }

  const objectsDir = path.join(snapshot.root, 'r2', 'objects');
  if (fs.existsSync(objectsDir)) {
    const bucket = String(snapshot.manifest.r2?.bucket || '').trim();
    if (!bucket) {
      actions.push({ type: 'invalid', familyId: 'store-downloads', error: 'R2 objects are present without a recorded bucket.' });
    }
    const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
        throw new Error(`Unsupported R2 snapshot entry: ${path.relative(snapshot.root, absolute)}.`);
      }
      return entry.isDirectory() ? walk(absolute) : [absolute];
    });
    for (const objectPath of walk(objectsDir)) {
      actions.push({
        type: 'r2-restore',
        binding: 'STORE_DOWNLOADS',
        bucket,
        key: path.relative(objectsDir, objectPath).split(path.sep).join('/'),
        objectPath
      });
    }
  }

  actions.push({
    type: 'verify',
    checks: [
      'admin Orders rebuilds admin-store-orders:index:v2',
      'order lookup indexes reference restored orders',
      'inventory counts reconcile with orders and Durable Object reservations',
      'R2 object sizes and hashes match the snapshot',
      'Stripe webhooks resume only after idempotency markers are restored',
      'checkout remains closed until Store health and smoke checks pass'
    ]
  });
  return {
    schemaVersion: 1,
    snapshot: snapshot.root,
    sourceCommit: snapshot.manifest.git?.head || '',
    target: options.target || 'plan',
    integrity: snapshot.integrity,
    actions,
    warnings,
    missingValueFamilies,
    invalidActions: actions.filter((action) => action.type === 'invalid' || (action.validation && !action.validation.ok))
  };
}

export function productionRestoreGate(options = {}) {
  const missing = [];
  if (options.acknowledgeProduction !== PRODUCTION_ACKNOWLEDGEMENT) missing.push('production acknowledgement');
  if (options.maintenanceConfirmed !== true) missing.push('maintenance/traffic freeze confirmation');
  if (options.stripeWebhooksPaused !== true) missing.push('Stripe webhook pause confirmation');
  if (options.inventoryReservationsReviewed !== true) missing.push('inventory reservation review');
  if (!options.preRestoreSnapshot) {
    missing.push('verified pre-restore snapshot');
  } else {
    try {
      readAndVerifySnapshot(options.preRestoreSnapshot);
    } catch {
      missing.push('verified pre-restore snapshot');
    }
  }
  if (options.restoreSnapshot && options.preRestoreSnapshot &&
      path.resolve(options.restoreSnapshot) === path.resolve(options.preRestoreSnapshot)) {
    missing.push('distinct pre-restore snapshot');
  }
  return { ok: missing.length === 0, missing };
}

function targetFlags(options = {}) {
  if (options.target === 'local') {
    return ['--local', '--persist-to', options.persistTo || path.join(os.tmpdir(), 'store-restore-wrangler')];
  }
  if (options.target === 'preview') return ['--remote', '--preview'];
  if (options.target === 'production') return ['--remote'];
  return [];
}

export function executeStoreRestorePlan(plan, options = {}) {
  if (!['local', 'preview', 'production'].includes(options.target)) throw new Error('Execution target must be local, preview, or production.');
  if (options.conflict !== 'overwrite') throw new Error('Execution requires --conflict=overwrite.');
  if (plan.invalidActions.length) throw new Error('Restore plan contains invalid KV records.');
  if (plan.missingValueFamilies?.length) {
    throw new Error(`Restore execution blocked: missing value artifacts for ${plan.missingValueFamilies.map((family) => family.familyId).join(', ')}.`);
  }
  const r2Actions = plan.actions.filter((action) => action.type === 'r2-restore');
  if (options.target === 'preview' && r2Actions.length) {
    const previewR2Bucket = String(options.previewR2Bucket || '').trim();
    if (!previewR2Bucket) throw new Error('Preview R2 restore requires --preview-r2-bucket.');
    if (r2Actions.some((action) => String(action.bucket || '').trim() === previewR2Bucket)) {
      throw new Error('Preview R2 restore bucket must be distinct from the captured source bucket.');
    }
  }
  if (options.target === 'production') {
    const gate = productionRestoreGate({ ...options, restoreSnapshot: plan.snapshot });
    if (!gate.ok) throw new Error(`Production restore blocked: ${gate.missing.join(', ')}.`);
  }

  const runner = options.runner || runCommand;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-restore-'));
  fs.chmodSync(tempDir, 0o700);
  const results = [];
  try {
    actionLoop:
    for (const action of plan.actions) {
      if (action.type === 'kv-restore') {
        const records = transformKvValuesToRestoreRecords(readJson(action.valuesFile));
        const restoreFile = path.join(tempDir, `${safeName(action.prefix)}.restore.json`);
        fs.writeFileSync(restoreFile, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
        const result = runner('npx', [
          'wrangler', 'kv', 'bulk', 'put', restoreFile,
          '--binding', action.binding,
          ...targetFlags(options)
        ], { cwd: WORKER_DIR, timeoutMs: 120_000 });
        results.push(result);
        if (result.status !== 0) break actionLoop;
      }
      if (action.type === 'r2-restore') {
        const targetBucket = options.target === 'preview'
          ? String(options.previewR2Bucket || '').trim()
          : action.bucket;
        const result = runner('npx', [
          'wrangler', 'r2', 'object', 'put', `${targetBucket}/${action.key}`,
          '--file', action.objectPath,
          '--force',
          ...(options.target === 'preview' ? ['--remote'] : targetFlags(options))
        ], { cwd: WORKER_DIR, timeoutMs: 120_000 });
        results.push(result);
        if (result.status !== 0) break actionLoop;
      }
      if (action.type === 'rebuild' && action.deleteKey) {
        const result = runner('npx', [
          'wrangler', 'kv', 'key', 'delete', action.deleteKey,
          '--binding', 'STORE_STATE',
          ...targetFlags(options)
        ], { cwd: WORKER_DIR, timeoutMs: 120_000 });
        results.push(result);
        if (result.status !== 0) break actionLoop;
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  const failed = results.filter((result) => result.status !== 0);
  return { ok: failed.length === 0, results, failed };
}

export async function runStoreRestore(rawOptions = {}) {
  const options = { ...rawOptions, target: rawOptions.target || 'plan' };
  const snapshot = readAndVerifySnapshot(options.snapshot);
  const plan = buildStoreRestorePlan(snapshot, options);
  if (!options.execute) return { plan, execution: null };
  return { plan, execution: executeStoreRestorePlan(plan, options) };
}

async function main() {
  const options = parseRestoreArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  if (!options.snapshot) throw new Error('--snapshot is required.');
  const result = await runStoreRestore(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Restore plan verified ${result.plan.integrity.checked} artifacts and prepared ${result.plan.actions.length} actions.`);
  if (result.plan.missingValueFamilies.length) {
    console.log(`Restore execution remains blocked because ${result.plan.missingValueFamilies.length} value artifacts are missing.`);
  }
  if (result.execution) console.log(`Restore execution ${result.execution.ok ? 'completed' : 'failed'}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

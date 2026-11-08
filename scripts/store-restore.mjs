#!/usr/bin/env node
import fs from 'node:fs';
import { validateSoftwarePreview } from './lib/software-preview.mjs';
import { validateSoftwareBackup, restoreSoftwareBackup, verifySoftwareRestoreDestination, softwareRecoveryClients, reconcileSoftwareMoney } from './lib/software-backup.mjs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { matchingPreviewKvKeys } from './lib/preview-kv-cleanup.mjs';
import { runCommand } from './lib/command-runner.mjs';
import { sha256File, verifyChecksumManifest } from './lib/file-integrity.mjs';
import { transformKvBackupValuesToPutRecords } from './lib/kv-backup-records.mjs';
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
    workerConfig: valueArg(args, '--worker-config', ''),
    previewId: valueArg(args, '--software-preview-id', ''),
    execute: args.includes('--execute'),
    softwareLicensing: args.includes('--software-licensing'),
    verify: args.includes('--verify'),
    cleanupPreview: args.includes('--cleanup-preview'),
    conflict: valueArg(args, '--conflict', 'abort'),
    persistTo: valueArg(args, '--persist-to', ''),
    previewR2Bucket: valueArg(args, '--preview-r2-bucket', ''),
    acknowledgePreviewCleanup: valueArg(args, '--acknowledge-preview-cleanup', ''),
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
  --software-licensing         Enable the isolated local/preview licensing restore adapter.
  --software-preview-id=ID     Unique 16-hex rehearsal resource ID.
  --worker-config=FILE         Dedicated preview Wrangler JSON config.
  --execute                     Execute the generated local/preview/production plan.
  --verify                      Read back restored KV values and R2 objects and compare them to the snapshot.
  --cleanup-preview             Delete only snapshot-owned KV/R2 data from the isolated preview target.
  --conflict=abort|overwrite    Required as overwrite for execution.
  --persist-to=DIR              Isolated Wrangler local-state directory.
  --preview-r2-bucket=NAME      Required distinct R2 bucket for preview object restore.
  --acknowledge-preview-cleanup=STORE_PREVIEW_RESTORE_CLEANUP
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
  return transformKvBackupValuesToPutRecords(values);
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

  if (snapshot.manifest.includesSoftwareLicensing || fs.existsSync(path.join(snapshot.root,'software'))) {
    try {
      const software = validateSoftwareBackup(snapshot.root);
      actions.push({type:'software-restore',owners:software.manifest.owners.length,artifacts:software.manifest.objects.length});
    } catch (error) { actions.push({type:'invalid',familyId:'software-licensing',error:error.message}); }
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

function configFlags(options) { return options.workerConfig ? ['--config', options.workerConfig] : []; }

function targetFlags(options = {}) {
  if (options.target === 'local') {
    return ['--local', '--persist-to', options.persistTo || path.join(os.tmpdir(), 'store-restore-wrangler')];
  }
  if (options.target === 'preview') return ['--remote', '--preview', ...configFlags(options)];
  if (options.target === 'production') return ['--remote'];
  return [];
}

function chunks(values = [], maximum = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += maximum) result.push(values.slice(index, index + maximum));
  return result;
}

function restoredValueMap(values = {}) {
  return new Map(transformKvValuesToRestoreRecords(values).map((record) => [record.key, record.value]));
}

function r2ObjectMissing(result) {
  // Generic 404s, configuration errors and failed commands are not evidence of a missing object.
  return result.status === 1 && !result.error && !result.timedOut &&
    /(?:^|\[ERROR\]\s*)The specified key does not exist\.\s*$/m.test(stripVTControlCharacters(result.stderr || ''));
}

export function verifyStoreRestorePlan(plan, options = {}) {
  if (plan.actions.some(action=>action.type==='software-restore') && !options.softwareAdapterReady) throw new Error('Software verification requires the logical restore readback');
  if (!['local', 'preview', 'production'].includes(options.target)) throw new Error('Verification target must be local, preview, or production.');
  if (plan.invalidActions.length || plan.missingValueFamilies?.length) {
    throw new Error('Restore verification requires a complete valid restore plan.');
  }
  const r2Actions = plan.actions.filter((action) => action.type === 'r2-restore');
  if (options.target === 'preview' && r2Actions.length) {
    const previewR2Bucket = String(options.previewR2Bucket || '').trim();
    if (!previewR2Bucket) throw new Error('Preview R2 verification requires --preview-r2-bucket.');
    if (r2Actions.some((action) => String(action.bucket || '').trim() === previewR2Bucket)) {
      throw new Error('Preview R2 verification bucket must be distinct from the captured source bucket.');
    }
  }

  const runner = options.runner || runCommand;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-restore-verify-'));
  fs.chmodSync(tempDir, 0o700);
  const evidence = {
    schemaVersion: 1,
    target: options.target,
    containsCustomerData: false,
    containsKeys: false,
    providerWritesExecuted: false,
    kvFamilies: 0,
    kvRecords: 0,
    r2Objects: 0,
    commands: 0,
    failures: 0,
    mismatches: 0,
    ok: false
  };
  try {
    for (const action of plan.actions) {
      if (action.type === 'kv-restore') {
        const expectedRecords = transformKvValuesToRestoreRecords(readJson(action.valuesFile));
        if (expectedRecords.length === 0) continue;
        evidence.kvFamilies += 1;
        evidence.kvRecords += expectedRecords.length;
        for (const [index, chunk] of chunks(expectedRecords).entries()) {
          const keysFile = path.join(tempDir, `${safeName(action.prefix)}.${index + 1}.keys.json`);
          fs.writeFileSync(keysFile, `${JSON.stringify(chunk.map((record) => ({ name: record.key })))}\n`, { mode: 0o600 });
          const result = runner('npx', [
            'wrangler', 'kv', 'bulk', 'get', keysFile,
            '--binding', action.binding,
            ...targetFlags(options)
          ], { cwd: WORKER_DIR, timeoutMs: 120_000 });
          evidence.commands += 1;
          if (result.status !== 0) {
            evidence.failures += 1;
            continue;
          }
          let actualValues;
          try {
            actualValues = restoredValueMap(JSON.parse(result.stdout));
          } catch {
            evidence.failures += 1;
            continue;
          }
          const expectedKeys = new Set(chunk.map((expected) => expected.key));
          for (const expected of chunk) {
            if (actualValues.get(expected.key) !== expected.value) evidence.mismatches += 1;
          }
          for (const key of actualValues.keys()) {
            if (!expectedKeys.has(key)) evidence.mismatches += 1;
          }
        }
      }
      if (action.type === 'r2-restore') {
        const targetBucket = options.target === 'preview'
          ? String(options.previewR2Bucket || '').trim()
          : action.bucket;
        const outputFile = path.join(tempDir, `r2-${evidence.r2Objects + 1}.bin`);
        const result = runner('npx', [
          'wrangler', 'r2', 'object', 'get', `${targetBucket}/${action.key}`,
          '--file', outputFile,
          ...(options.target === 'preview' ? ['--remote', ...configFlags(options)] : targetFlags(options))
        ], { cwd: WORKER_DIR, timeoutMs: 120_000 });
        evidence.commands += 1;
        evidence.r2Objects += 1;
        if (result.status !== 0 || !fs.existsSync(outputFile)) {
          evidence.failures += 1;
        } else if (sha256File(outputFile) !== sha256File(action.objectPath)) {
          evidence.mismatches += 1;
        }
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  evidence.ok = evidence.failures === 0 && evidence.mismatches === 0;
  return evidence;
}

export function cleanupStorePreviewRestore(plan, options = {}) {
  if (plan.actions.some(action=>action.type==='software-restore')) throw new Error('Software cleanup requires disposal of the isolated recovery target');
  if (options.target !== 'preview') throw new Error('Captured-data cleanup is available only for the preview target.');
  if (options.acknowledgePreviewCleanup !== 'STORE_PREVIEW_RESTORE_CLEANUP') {
    throw new Error('Preview cleanup requires exact acknowledgement.');
  }
  if (plan.invalidActions.length || plan.missingValueFamilies?.length) {
    throw new Error('Preview cleanup requires a complete valid restore plan.');
  }
  const r2Actions = plan.actions.filter((action) => action.type === 'r2-restore');
  const previewR2Bucket = String(options.previewR2Bucket || '').trim();
  if (r2Actions.length && !previewR2Bucket) throw new Error('Preview cleanup requires --preview-r2-bucket.');
  if (r2Actions.some((action) => String(action.bucket || '').trim() === previewR2Bucket)) {
    throw new Error('Preview cleanup bucket must be distinct from the captured source bucket.');
  }

  const records = plan.actions
    .filter((action) => action.type === 'kv-restore')
    .flatMap((action) => transformKvValuesToRestoreRecords(readJson(action.valuesFile)));
  const expectedKeys = new Set(records.map((record) => record.key));
  const runner = options.runner || runCommand;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-restore-cleanup-'));
  fs.chmodSync(tempDir, 0o700);
  const evidence = {
    schemaVersion: 1,
    target: 'preview',
    containsCustomerData: false,
    containsKeys: false,
    productionDeletesExecuted: false,
    kvRecordsTargeted: records.length,
    r2ObjectsTargeted: r2Actions.length,
    commands: 0,
    failures: 0,
    residualKvRecords: 0,
    residualR2Objects: 0,
    ok: false
  };
  function run(args) {
    evidence.commands += 1;
    return runner('npx', args, { cwd: WORKER_DIR, timeoutMs: 120_000 });
  }
  try {
    let matchedKeys;
    const matchedObjects = [];
    try {
      matchedKeys = matchingPreviewKvKeys(records, 'STORE_STATE', path.join(tempDir, 'read.json'), run);
      for (const [index, action] of r2Actions.entries()) {
        const file = path.join(tempDir, `read-${index}.bin`);
        const result = run(['wrangler', 'r2', 'object', 'get', `${previewR2Bucket}/${action.key}`, '--file', file, '--remote']);
        if (r2ObjectMissing(result)) continue;
        if (result.status !== 0 || sha256File(file) !== sha256File(action.objectPath)) {
          throw new Error('Preview R2 object changed or could not be read.');
        }
        matchedObjects.push(action);
      }
      // Wrangler reports an object GET 404 as a missing key, even if the bucket itself is missing.
      if (r2Actions.length && !matchedObjects.length) {
        const info = run(['wrangler', 'r2', 'bucket', 'info', previewR2Bucket, '--json']);
        if (info.status !== 0 || JSON.parse(info.stdout)?.name !== previewR2Bucket) throw new Error('Preview bucket unavailable.');
      }
    } catch {
      evidence.failures += 1;
      return evidence;
    }

    for (const [index, keys] of chunks(matchedKeys, 1000).entries()) {
      const keysFile = path.join(tempDir, `preview.${index + 1}.delete.json`);
      fs.writeFileSync(keysFile, JSON.stringify(keys), { mode: 0o600 });
      const result = run(['wrangler', 'kv', 'bulk', 'delete', keysFile, '--binding', 'STORE_STATE', '--remote', '--preview']);
      if (result.status !== 0) evidence.failures += 1;
    }
    for (const action of matchedObjects) {
      const result = run(['wrangler', 'r2', 'object', 'delete', `${previewR2Bucket}/${action.key}`, '--remote']);
      if (result.status !== 0 && !r2ObjectMissing(result)) evidence.failures += 1;
    }

    const keyList = run([
      'wrangler', 'kv', 'key', 'list', '--binding', 'STORE_STATE', '--remote', '--preview'
    ]);
    if (keyList.status !== 0) {
      evidence.failures += 1;
    } else {
      try {
        const remaining = JSON.parse(keyList.stdout);
        evidence.residualKvRecords = Array.isArray(remaining)
          ? remaining.filter((entry) => expectedKeys.has(String(entry?.name || entry || ''))).length
          : records.length;
      } catch {
        evidence.failures += 1;
      }
    }
    for (const [index, action] of r2Actions.entries()) {
      const outputFile = path.join(tempDir, `r2-residual-${index + 1}.bin`);
      const result = run([
        'wrangler', 'r2', 'object', 'get', `${previewR2Bucket}/${action.key}`,
        '--file', outputFile, '--remote'
      ]);
      if (result.status === 0) {
        evidence.residualR2Objects += 1;
      } else if (!r2ObjectMissing(result)) {
        evidence.failures += 1;
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  evidence.ok = evidence.failures === 0 && evidence.residualKvRecords === 0 && evidence.residualR2Objects === 0;
  return evidence;
}

export function executeStoreRestorePlan(plan, options = {}) {
  if (plan.actions.some(action=>action.type==='software-restore') && (options.target==='production' || !options.softwareAdapterReady)) throw new Error('Software recovery requires the isolated logical adapter and fresh money comparison');
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
        if (records.length === 0) continue;
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
          ...(options.target === 'preview' ? ['--remote', ...configFlags(options)] : targetFlags(options))
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
  const hasSoftware = plan.actions.some(action=>action.type==='software-restore');
  if (options.execute && hasSoftware) {
    if (!options.softwareLicensing || !['local','preview'].includes(options.target)) throw new Error('Software execution requires the isolated logical adapter');
    if (options.target === 'preview') {
      validateSoftwarePreview({...options,storeBase:process.env.WORKER_BASE,licensingBase:process.env.LICENSING_WORKER_BASE});
      if (!options.verify || options.cleanupPreview) throw new Error('Software preview requires readback and whole-resource cleanup by its rehearsal owner');
    }
    options.softwareRecovery ||= softwareRecoveryClients({target:options.target,previewId:options.previewId});
    if (!options.softwareRecovery.request || !options.softwareRecovery.stripeRead) throw new Error('Software execution requires an isolated adapter and read-only Stripe client');
    if (options.target === 'preview') {
      options.softwareRecovery.previewId = options.previewId;
      const runner = options.runner || runCommand;
      const result = runner('npx',['wrangler','kv','namespace','list',...configFlags(options)],{cwd:WORKER_DIR,timeoutMs:120000});
      const config = readJson(options.workerConfig);
      if (result.status !== 0 || !JSON.parse(result.stdout).some(entry=>entry.id===config.kv_namespaces[0].id && entry.title===`dw-recovery-${options.previewId}-store-STORE_STATE`)) throw new Error('Software preview KV namespace is not owned by this rehearsal');
    }
  }
  if (options.execute && hasSoftware) {
    const comparison=await reconcileSoftwareMoney(snapshot.root,options.softwareRecovery.stripeRead);
    if (!comparison.ok) throw new Error('Software money reconciliation requires review before restore');
    await verifySoftwareRestoreDestination(snapshot.root,options.softwareRecovery);
  }
  const execution = options.execute ? executeStoreRestorePlan(plan, {...options,softwareAdapterReady:hasSoftware}) : null;
  if (hasSoftware && execution?.ok) execution.software = await restoreSoftwareBackup(snapshot.root,options.softwareRecovery);
  const verification = options.verify && (!execution || execution.ok)
    ? verifyStoreRestorePlan(plan, {...options,softwareAdapterReady:execution?.software?.ok===true})
    : null;
  const cleanup = options.cleanupPreview ? cleanupStorePreviewRestore(plan, options) : null;
  return { plan, execution, verification, cleanup };
}

async function main() {
  const options = parseRestoreArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  if (!options.snapshot) throw new Error('--snapshot is required.');
  const result = await runStoreRestore(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    if (result.execution && !result.execution.ok) process.exitCode = 1;
    if (result.verification && !result.verification.ok) process.exitCode = 1;
    if (result.cleanup && !result.cleanup.ok) process.exitCode = 1;
    return;
  }
  console.log(`Restore plan verified ${result.plan.integrity.checked} artifacts and prepared ${result.plan.actions.length} actions.`);
  if (result.plan.missingValueFamilies.length) {
    console.log(`Restore execution remains blocked because ${result.plan.missingValueFamilies.length} value artifacts are missing.`);
  }
  if (result.execution) console.log(`Restore execution ${result.execution.ok ? 'completed' : 'failed'}.`);
  if (result.verification) console.log(`Restore verification ${result.verification.ok ? 'completed' : 'failed'}.`);
  if (result.cleanup) console.log(`Preview cleanup ${result.cleanup.ok ? 'completed' : 'failed'}.`);
  if (result.execution && !result.execution.ok) process.exitCode = 1;
  if (result.verification && !result.verification.ok) process.exitCode = 1;
  if (result.cleanup && !result.cleanup.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

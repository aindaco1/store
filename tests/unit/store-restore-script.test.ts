import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildChecksumManifest } from '../../scripts/lib/file-integrity.mjs';
import {
  buildStoreRestorePlan,
  executeStoreRestorePlan,
  productionRestoreGate,
  readAndVerifySnapshot,
  transformKvValuesToRestoreRecords,
  validateKvRestoreRecords
} from '../../scripts/store-restore.mjs';
import { loadStoreDataInventory } from '../../scripts/lib/store-data-inventory.mjs';

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function fixtureSnapshot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-restore-test-'));
  const inventory = loadStoreDataInventory();
  const order = {
    orderToken: 'store-order-test',
    status: 'confirmed',
    orderDraft: { orderToken: 'store-order-test', status: 'confirmed', items: [] }
  };
  writeJson(path.join(root, 'kv', 'orders.values.json'), {
    'orders:store-order-test': { value: JSON.stringify(order) }
  });
  for (const family of inventory.families.filter((entry: any) => entry.type === 'kv' && entry.backupValues)) {
    if (family.id === 'orders') continue;
    const safePrefix = String(family.prefix || 'item').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
    writeJson(path.join(root, 'kv', `${safePrefix}.values.json`), {});
  }
  writeJson(path.join(root, 'kv', 'admin-session.values.json'), {
    'admin-session:secret': { value: '{}' }
  });
  writeJson(path.join(root, 'manifest.json'), {
    version: 2,
    git: { head: 'fixture' },
    r2: { bucket: 'store-downloads-preview' }
  });
  const artifacts = buildChecksumManifest(root, { exclude: ['checksums.json'] });
  writeJson(path.join(root, 'checksums.json'), { schemaVersion: 1, artifacts });
  return root;
}

describe('Store restore automation', () => {
  it('verifies checksums and plans authoritative restore plus derived rebuilds', () => {
    const root = fixtureSnapshot();
    const snapshot = readAndVerifySnapshot(root);
    const plan = buildStoreRestorePlan(snapshot);
    expect(plan.invalidActions).toEqual([]);
    expect(plan.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'kv-restore', familyId: 'orders', recordCount: 1 }),
      expect.objectContaining({ type: 'rebuild', familyId: 'admin-order-index' }),
      expect.objectContaining({ type: 'skip', familyId: 'admin-sessions', reason: 'quarantined' })
    ]));
    expect(plan.actions.some((action) => action.type === 'kv-restore' && action.familyId === 'admin-sessions')).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('fails closed when an artifact changes after snapshot capture', () => {
    const root = fixtureSnapshot();
    fs.appendFileSync(path.join(root, 'kv', 'orders.values.json'), 'tampered');
    expect(() => readAndVerifySnapshot(root)).toThrow(/integrity failed/i);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('fails closed when restore target metadata changes after snapshot capture', () => {
    const root = fixtureSnapshot();
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.r2.bucket = 'unexpected-production-bucket';
    writeJson(manifestPath, manifest);
    expect(() => readAndVerifySnapshot(root)).toThrow(/integrity failed/i);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('fails closed when an unlisted artifact is added to a snapshot', () => {
    const root = fixtureSnapshot();
    writeJson(path.join(root, 'r2', 'objects', 'unlisted.json'), { unsafe: true });
    expect(() => readAndVerifySnapshot(root)).toThrow(/unlisted/i);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('validates order keys and shapes before a bulk restore', () => {
    const family = loadStoreDataInventory().families.find((entry: any) => entry.id === 'orders');
    expect(validateKvRestoreRecords(family, [{
      key: 'orders:wrong',
      value: JSON.stringify({ orderToken: 'store-order-right', status: 'confirmed', orderDraft: {} })
    }])).toMatchObject({ ok: false });
    expect(transformKvValuesToRestoreRecords({ key: { value: 'value', metadata: { source: 'test' } } })).toEqual([
      { key: 'key', value: 'value', metadata: { source: 'test' } }
    ]);
  });

  it('requires every production restore interlock', () => {
    expect(productionRestoreGate({})).toMatchObject({ ok: false });
    const preRestore = fixtureSnapshot();
    expect(productionRestoreGate({
      acknowledgeProduction: 'STORE_PRODUCTION_RESTORE',
      maintenanceConfirmed: true,
      stripeWebhooksPaused: true,
      inventoryReservationsReviewed: true,
      preRestoreSnapshot: preRestore
    })).toEqual({ ok: true, missing: [] });
    fs.rmSync(preRestore, { recursive: true, force: true });
  });

  it('rejects an unverified or reused pre-restore snapshot', () => {
    const restoreSnapshot = fixtureSnapshot();
    const unverified = fs.mkdtempSync(path.join(os.tmpdir(), 'store-pre-restore-unverified-'));
    writeJson(path.join(unverified, 'manifest.json'), { version: 2 });
    expect(productionRestoreGate({
      acknowledgeProduction: 'STORE_PRODUCTION_RESTORE',
      maintenanceConfirmed: true,
      stripeWebhooksPaused: true,
      inventoryReservationsReviewed: true,
      preRestoreSnapshot: unverified
    })).toMatchObject({ ok: false });
    expect(productionRestoreGate({
      acknowledgeProduction: 'STORE_PRODUCTION_RESTORE',
      maintenanceConfirmed: true,
      stripeWebhooksPaused: true,
      inventoryReservationsReviewed: true,
      preRestoreSnapshot: restoreSnapshot,
      restoreSnapshot
    })).toMatchObject({ ok: false, missing: expect.arrayContaining(['distinct pre-restore snapshot']) });
    fs.rmSync(unverified, { recursive: true, force: true });
    fs.rmSync(restoreSnapshot, { recursive: true, force: true });
  });

  it('executes only reviewed local actions through an injectable runner', () => {
    const root = fixtureSnapshot();
    const plan = buildStoreRestorePlan(readAndVerifySnapshot(root), { target: 'local' });
    const calls: string[][] = [];
    const execution = executeStoreRestorePlan(plan, {
      target: 'local',
      conflict: 'overwrite',
      persistTo: path.join(root, 'state'),
      runner: (_command: string, args: string[]) => {
        calls.push(args);
        return { status: 0, stdout: '', stderr: '', error: '' };
      }
    });
    expect(execution.ok).toBe(true);
    expect(calls.some((args) => args.includes('bulk') && args.includes('put'))).toBe(true);
    expect(calls.some((args) => args.includes('admin-store-orders:index:v2') && args.includes('delete'))).toBe(true);
    expect(calls.some((args) => args.some((arg) => arg.includes('admin-session')) && args.includes('put'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('blocks metadata-only execution and stops after the first command failure', () => {
    const root = fixtureSnapshot();
    fs.rmSync(path.join(root, 'kv', 'orders.values.json'));
    const artifacts = buildChecksumManifest(root, { exclude: ['checksums.json'] });
    writeJson(path.join(root, 'checksums.json'), { schemaVersion: 1, artifacts });
    const incompletePlan = buildStoreRestorePlan(readAndVerifySnapshot(root), { target: 'local' });
    expect(incompletePlan.missingValueFamilies).toEqual(expect.arrayContaining([
      expect.objectContaining({ familyId: 'orders' })
    ]));
    expect(() => executeStoreRestorePlan(incompletePlan, {
      target: 'local',
      conflict: 'overwrite'
    })).toThrow(/missing value artifacts/i);

    writeJson(path.join(root, 'kv', 'orders.values.json'), {
      'orders:store-order-test': { value: JSON.stringify({ orderToken: 'store-order-test', status: 'confirmed', orderDraft: {} }) }
    });
    const repairedArtifacts = buildChecksumManifest(root, { exclude: ['checksums.json'] });
    writeJson(path.join(root, 'checksums.json'), { schemaVersion: 1, artifacts: repairedArtifacts });
    const plan = buildStoreRestorePlan(readAndVerifySnapshot(root), { target: 'local' });
    const calls: string[][] = [];
    const execution = executeStoreRestorePlan(plan, {
      target: 'local',
      conflict: 'overwrite',
      runner: (_command: string, args: string[]) => {
        calls.push(args);
        return { status: 1, stdout: '', stderr: 'synthetic failure', error: '' };
      }
    });
    expect(execution.ok).toBe(false);
    expect(calls).toHaveLength(1);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

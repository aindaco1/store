#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { buildChecksumManifest } from './lib/file-integrity.mjs';
import { loadStoreDataInventory } from './lib/store-data-inventory.mjs';
import {
  buildStoreRestorePlan,
  executeStoreRestorePlan,
  readAndVerifySnapshot
} from './store-restore.mjs';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function createSyntheticSnapshot(root) {
  writeJson(path.join(root, 'kv', 'orders.values.json'), {
    'orders:store-order-restore-drill': {
      value: JSON.stringify({
        orderToken: 'store-order-restore-drill',
        status: 'confirmed',
        createdAt: '2026-07-09T00:00:00.000Z',
        orderDraft: {
          orderToken: 'store-order-restore-drill',
          status: 'confirmed',
          customer: { email: 'restore-drill@example.invalid' },
          items: [{ id: 'fixture', sku: 'fixture', quantity: 1 }]
        }
      })
    }
  });
  writeJson(path.join(root, 'kv', 'admin-session.values.json'), {
    'admin-session:must-not-restore': { value: '{"token":"quarantined"}' }
  });
  for (const family of loadStoreDataInventory().families.filter((entry) => entry.type === 'kv' && entry.backupValues)) {
    if (family.id === 'orders') continue;
    const safePrefix = String(family.prefix || 'item').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
    writeJson(path.join(root, 'kv', `${safePrefix}.values.json`), {});
  }
  writeJson(path.join(root, 'manifest.json'), {
    version: 2,
    createdAt: new Date().toISOString(),
    git: { head: 'synthetic-restore-drill' },
    r2: { bucket: 'store-downloads-preview' }
  });
  const artifacts = buildChecksumManifest(root, { exclude: ['checksums.json'] });
  writeJson(path.join(root, 'checksums.json'), { schemaVersion: 1, artifacts });
}

async function probePodmanWorker() {
  const workerUrl = String(process.env.WORKER_URL || 'http://127.0.0.1:8989').replace(/\/+$/, '');
  const response = await fetch(`${workerUrl}/admin/session`, { redirect: 'error' });
  return {
    url: `${workerUrl}/admin/session`,
    status: response.status,
    privateNoStore: String(response.headers.get('cache-control') || '').includes('no-store')
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-restore-drill-'));
  fs.chmodSync(root, 0o700);
  try {
    createSyntheticSnapshot(root);
    const snapshot = readAndVerifySnapshot(root);
    const plan = buildStoreRestorePlan(snapshot, { target: 'local' });
    const restoredRecords = [];
    const runner = (_command, args) => {
      const restoreFile = args.find((arg) => String(arg).endsWith('.restore.json'));
      if (restoreFile) restoredRecords.push(...JSON.parse(fs.readFileSync(restoreFile, 'utf8')));
      return { status: 0, stdout: '', stderr: '', error: '' };
    };
    const execution = executeStoreRestorePlan(plan, {
      target: 'local',
      conflict: 'overwrite',
      persistTo: path.join(root, 'wrangler-state'),
      runner
    });
    const quarantineRestored = restoredRecords.some((record) => String(record.key).startsWith('admin-session:'));
    const probe = await probePodmanWorker();
    const result = {
      ok: execution.ok && !quarantineRestored && probe.status === 401 && probe.privateNoStore,
      integrityArtifacts: snapshot.integrity.checked,
      plannedActions: plan.actions.length,
      restoredRecords: restoredRecords.length,
      quarantineRestored,
      missingValueFamilies: plan.missingValueFamilies.length,
      derivedRepairPlanned: plan.actions.some((action) => action.familyId === 'admin-order-index' && action.type === 'rebuild'),
      podmanWorkerProbe: probe
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planSnapshotRetention, validatedPruneTargets } from '../shared/dust-wave-platform/packages/release-core/src/backup-planning.js';
import { readRetentionReceipt, retentionRootId } from '../shared/dust-wave-platform/packages/release-core/src/backup-receipts.js';
import { loadStoreDataInventory } from './lib/store-data-inventory.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_ROOT = fs.realpathSync(ROOT);
const PRUNE_ACKNOWLEDGEMENT = 'STORE_BACKUP_RETENTION_PRUNE';

function valueArg(args, name, fallback = '') {
  const exact = args.indexOf(name);
  if (exact >= 0 && args[exact + 1]) return args[exact + 1];
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function pathIsWithin(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function resolveRetentionRoot(value) {
  const root = path.resolve(value || '');
  if (!root || !fs.existsSync(root)) {
    throw new Error('Backup retention root must be an existing directory.');
  }
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error('Backup retention root cannot be a symbolic link.');
  if (!stat.isDirectory()) throw new Error('Backup retention root must be an existing directory.');
  return fs.realpathSync(root);
}

export function planBackupRetention(options = {}) {
  if (!String(options.root || '').trim()) throw new Error('Backup retention root is required.');
  const root = resolveRetentionRoot(options.root);
  const rootId = retentionRootId(root);
  const configured = options.retention || loadStoreDataInventory().retention;
  const snapshots = [];
  const untouched = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      untouched.push({ name: entry.name, reason: entry.isSymbolicLink() ? 'symbolic_link' : 'not_directory' });
      continue;
    }
    const directory = path.join(root, entry.name);
    const read = readRetentionReceipt(directory);
    if (!read.ok) {
      untouched.push({ name: entry.name, reason: read.reason });
      continue;
    }
    snapshots.push({
      name: entry.name,
      createdAt: read.createdAt,
      releaseSnapshot: read.receipt.releaseSnapshot === true,
      archiveBytes: read.archiveBytes,
      archiveSha256: read.archiveSha256
    });
  }
  return planSnapshotRetention({ snapshots, retention: configured, untouched, rootId, rootName: path.basename(root) });
}

export function executeBackupRetention(plan, options = {}) {
  if (!String(options.root || '').trim()) throw new Error('Backup retention root is required.');
  if (options.acknowledge !== PRUNE_ACKNOWLEDGEMENT) {
    throw new Error(`Backup pruning requires --acknowledge=${PRUNE_ACKNOWLEDGEMENT}.`);
  }
  const root = resolveRetentionRoot(options.root);
  if (pathIsWithin(REAL_ROOT, root)) throw new Error('Backup pruning cannot execute inside the repository.');
  const currentPlan = planBackupRetention({ root, retention: options.retention });
  const targets = validatedPruneTargets(plan, currentPlan);
  const deleted = [];
  for (const snapshot of targets) {
    if (retentionRootId(root) !== currentPlan.rootId) throw new Error('Backup retention root changed.');
    const directory = path.join(root, snapshot.name);
    if (!pathIsWithin(root, directory)) throw new Error('Backup prune target escapes the retention root.');
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Backup prune target is unsafe: ${snapshot.name}.`);
    const receipt = readRetentionReceipt(directory);
    if (!receipt.ok) throw new Error(`Backup prune target failed revalidation: ${snapshot.name}:${receipt.reason}.`);
    if (receipt.archiveSha256 !== snapshot.archiveSha256 || receipt.createdAt.toISOString() !== snapshot.createdAt ||
        (currentPlan.retention.releaseSnapshots && receipt.receipt.releaseSnapshot === true)) {
      throw new Error(`Backup prune target changed: ${snapshot.name}.`);
    }
    fs.rmSync(directory, { recursive: true, force: false });
    deleted.push(snapshot.name);
  }
  return { ok: true, deleted };
}

function loadReviewedPlan(file) {
  if (!file) throw new Error('Backup pruning requires --plan=FILE from a saved preview.');
  const preview = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (preview?.execution !== null || !preview.plan) throw new Error('A saved backup retention preview is required.');
  return preview.plan;
}

function writeOutput(output, value) {
  if (!output) return;
  const resolved = path.resolve(output);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node scripts/backup-retention.mjs --root=DIR [--execute --plan=FILE --acknowledge=${PRUNE_ACKNOWLEDGEMENT}] [--output=FILE]`);
    console.log('Planning is the default. Invalid, unencrypted, checksum-mismatched, newest, and release snapshots are never selected for deletion.');
    return;
  }
  const root = valueArg(args, '--root', '');
  const execute = args.includes('--execute');
  if (execute && args.includes('--dry-run')) throw new Error('Choose either --dry-run or --execute.');
  const plan = execute ? loadReviewedPlan(valueArg(args, '--plan')) : planBackupRetention({ root });
  const result = execute
    ? { plan, execution: executeBackupRetention(plan, { root, acknowledge: valueArg(args, '--acknowledge', '') }) }
    : { plan, execution: null };
  writeOutput(valueArg(args, '--output', ''), result);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  }
}

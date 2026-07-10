#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sha256File } from './lib/file-integrity.mjs';
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

function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

function utcMonth(date) {
  return date.toISOString().slice(0, 7);
}

function utcIsoWeek(date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function readReceipt(directory) {
  const manifestPath = path.join(directory, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { ok: false, reason: 'missing_manifest' };
  if (fs.lstatSync(manifestPath).isSymbolicLink()) return { ok: false, reason: 'symbolic_link_manifest' };
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'invalid_manifest' };
  }
  if (receipt.encrypted !== true || !String(receipt.archive || '').trim()) {
    return { ok: false, reason: 'not_encrypted_receipt' };
  }
  const createdAt = new Date(String(receipt.completedAt || receipt.createdAt || ''));
  if (!Number.isFinite(createdAt.getTime())) return { ok: false, reason: 'invalid_created_at' };
  const archiveName = String(receipt.archive).trim();
  if (path.basename(archiveName) !== archiveName) return { ok: false, reason: 'unsafe_archive_name' };
  const archivePath = path.join(directory, archiveName);
  if (!fs.existsSync(archivePath)) return { ok: false, reason: 'missing_archive' };
  const archiveStat = fs.lstatSync(archivePath);
  if (archiveStat.isSymbolicLink()) return { ok: false, reason: 'symbolic_link_archive' };
  if (!archiveStat.isFile()) return { ok: false, reason: 'missing_archive' };
  const expectedSha256 = String(receipt.archiveSha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || sha256File(archivePath) !== expectedSha256) {
    return { ok: false, reason: 'archive_checksum_mismatch' };
  }
  return { ok: true, receipt, createdAt };
}

function retainBuckets(snapshots, count, keyFor, reason, retained) {
  if (count <= 0) return;
  const buckets = new Set();
  for (const snapshot of snapshots) {
    const key = keyFor(snapshot.createdAt);
    if (buckets.has(key)) continue;
    buckets.add(key);
    retained.get(snapshot.name).add(reason);
    if (buckets.size >= count) break;
  }
}

export function planBackupRetention(options = {}) {
  if (!String(options.root || '').trim()) throw new Error('Backup retention root is required.');
  const root = resolveRetentionRoot(options.root);
  const configured = options.retention || loadStoreDataInventory().retention;
  const snapshots = [];
  const untouched = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      untouched.push({ name: entry.name, reason: entry.isSymbolicLink() ? 'symbolic_link' : 'not_directory' });
      continue;
    }
    const directory = path.join(root, entry.name);
    const read = readReceipt(directory);
    if (!read.ok) {
      untouched.push({ name: entry.name, reason: read.reason });
      continue;
    }
    snapshots.push({
      name: entry.name,
      directory,
      createdAt: read.createdAt,
      releaseSnapshot: read.receipt.releaseSnapshot === true,
      archiveBytes: Number(read.receipt.archiveBytes || fs.statSync(path.join(directory, read.receipt.archive)).size)
    });
  }
  snapshots.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const retained = new Map(snapshots.map((snapshot) => [snapshot.name, new Set()]));
  if (snapshots.length) retained.get(snapshots[0].name).add('newest');
  retainBuckets(snapshots, Number(configured.daily || 0), utcDay, 'daily', retained);
  retainBuckets(snapshots, Number(configured.weekly || 0), utcIsoWeek, 'weekly', retained);
  retainBuckets(snapshots, Number(configured.monthly || 0), utcMonth, 'monthly', retained);
  if (configured.releaseSnapshots !== false) {
    for (const snapshot of snapshots.filter((entry) => entry.releaseSnapshot)) {
      retained.get(snapshot.name).add('release');
    }
  }

  const keep = snapshots.filter((snapshot) => retained.get(snapshot.name).size > 0).map((snapshot) => ({
    name: snapshot.name,
    createdAt: snapshot.createdAt.toISOString(),
    archiveBytes: snapshot.archiveBytes,
    reasons: Array.from(retained.get(snapshot.name)).sort()
  }));
  const prune = snapshots.filter((snapshot) => retained.get(snapshot.name).size === 0).map((snapshot) => ({
    name: snapshot.name,
    createdAt: snapshot.createdAt.toISOString(),
    archiveBytes: snapshot.archiveBytes
  }));
  return {
    schemaVersion: 1,
    plannedAt: new Date().toISOString(),
    rootName: path.basename(root),
    retention: {
      daily: Number(configured.daily || 0),
      weekly: Number(configured.weekly || 0),
      monthly: Number(configured.monthly || 0),
      releaseSnapshots: configured.releaseSnapshots !== false
    },
    keep,
    prune,
    untouched: untouched.sort((left, right) => left.name.localeCompare(right.name)),
    bytesEligibleForPrune: prune.reduce((sum, snapshot) => sum + snapshot.archiveBytes, 0),
    containsCustomerData: false,
    executeByDefault: false
  };
}

export function executeBackupRetention(plan, options = {}) {
  if (!String(options.root || '').trim()) throw new Error('Backup retention root is required.');
  if (options.acknowledge !== PRUNE_ACKNOWLEDGEMENT) {
    throw new Error(`Backup pruning requires --acknowledge=${PRUNE_ACKNOWLEDGEMENT}.`);
  }
  const root = resolveRetentionRoot(options.root);
  if (pathIsWithin(REAL_ROOT, root)) throw new Error('Backup pruning cannot execute inside the repository.');
  const currentPlan = planBackupRetention({ root, retention: plan.retention });
  const currentlyEligible = new Set(currentPlan.prune.map((snapshot) => snapshot.name));
  const deleted = [];
  for (const snapshot of plan.prune || []) {
    if (!currentlyEligible.has(snapshot.name)) {
      throw new Error(`Backup prune target is no longer eligible: ${snapshot.name}.`);
    }
    const directory = path.join(root, snapshot.name);
    if (!pathIsWithin(root, directory)) throw new Error('Backup prune target escapes the retention root.');
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Backup prune target is unsafe: ${snapshot.name}.`);
    const receipt = readReceipt(directory);
    if (!receipt.ok) throw new Error(`Backup prune target failed revalidation: ${snapshot.name}:${receipt.reason}.`);
    fs.rmSync(directory, { recursive: true, force: false });
    deleted.push(snapshot.name);
  }
  return { ok: deleted.length === (plan.prune || []).length, deleted };
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
    console.log(`Usage: node scripts/backup-retention.mjs --root=DIR [--execute --acknowledge=${PRUNE_ACKNOWLEDGEMENT}] [--output=FILE]`);
    console.log('Planning is the default. Invalid, unencrypted, checksum-mismatched, newest, and release snapshots are never selected for deletion.');
    return;
  }
  const root = valueArg(args, '--root', '');
  const plan = planBackupRetention({ root });
  const result = args.includes('--execute')
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

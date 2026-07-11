#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { commandAvailable, runCommand } from './lib/command-runner.mjs';
import { sha256File } from './lib/file-integrity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACKNOWLEDGEMENT = 'STORE_BACKUP_OFF_DEVICE_COPY';

function valueArg(args, name, fallback = '') {
  const exact = args.indexOf(name);
  if (exact >= 0 && args[exact + 1]) return args[exact + 1];
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function pathIsWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function requireRealDirectory(value, label) {
  const resolved = path.resolve(String(value || ''));
  if (!value || !fs.existsSync(resolved)) throw new Error(`${label} must be an existing directory.`);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real, non-symlinked directory.`);
  return fs.realpathSync(resolved);
}

function safeSnapshotName(value) {
  const name = String(value || '').trim();
  if (!name || name !== path.basename(name) || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error('Encrypted receipt outputName is not a safe directory name.');
  }
  return name;
}

export function inspectEncryptedSnapshot(snapshot) {
  const source = requireRealDirectory(snapshot, 'Snapshot');
  const manifestPath = path.join(source, 'manifest.json');
  if (!fs.existsSync(manifestPath) || !fs.lstatSync(manifestPath).isFile()) {
    throw new Error('Snapshot manifest.json is missing.');
  }
  const receipt = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (receipt.encrypted !== true || !String(receipt.archive || '').trim()) {
    throw new Error('Snapshot is not an encrypted backup receipt.');
  }
  const archiveName = path.basename(String(receipt.archive));
  if (archiveName !== receipt.archive || !/\.tar\.gz\.(?:age|gpg)$/.test(archiveName)) {
    throw new Error('Encrypted receipt archive path is invalid.');
  }
  const archivePath = path.join(source, archiveName);
  if (!fs.existsSync(archivePath) || !fs.lstatSync(archivePath).isFile()) {
    throw new Error('Encrypted archive is missing.');
  }
  const archiveSha256 = sha256File(archivePath);
  if (archiveSha256 !== String(receipt.archiveSha256 || '').trim().toLowerCase()) {
    throw new Error('Encrypted archive checksum does not match its receipt.');
  }
  return {
    source,
    receipt,
    manifestPath,
    archivePath,
    archiveName,
    archiveSha256,
    archiveBytes: fs.statSync(archivePath).size,
    outputName: safeSnapshotName(receipt.outputName)
  };
}

export function planOffsiteCopy(options = {}) {
  const snapshot = inspectEncryptedSnapshot(options.snapshot);
  const destinationRoot = requireRealDirectory(options.destination, 'Destination');
  if (pathIsWithin(ROOT, destinationRoot)) throw new Error('Off-device destination cannot be inside the repository.');
  if (pathIsWithin(snapshot.source, destinationRoot) || pathIsWithin(destinationRoot, snapshot.source)) {
    throw new Error('Off-device destination and source snapshot cannot contain one another.');
  }
  const sourceDevice = fs.statSync(snapshot.source).dev;
  const destinationDevice = fs.statSync(destinationRoot).dev;
  const deviceSeparated = sourceDevice !== destinationDevice;
  const target = path.join(destinationRoot, snapshot.outputName);
  return {
    schemaVersion: 1,
    source: snapshot.source,
    destinationRoot,
    target,
    outputName: snapshot.outputName,
    archiveName: snapshot.archiveName,
    archiveBytes: snapshot.archiveBytes,
    archiveSha256: snapshot.archiveSha256,
    deviceSeparated,
    targetExists: fs.existsSync(target)
  };
}

export function verifyOffsiteCopy(options = {}) {
  const snapshot = inspectEncryptedSnapshot(options.snapshot);
  let decryptabilityVerified = false;
  if (options.verifyDecrypt === true) {
    if (snapshot.receipt.encryptionBackend !== 'age') {
      throw new Error('Automated second-device decryption verification currently requires an age archive.');
    }
    const identity = path.resolve(String(options.ageIdentity || process.env.STORE_BACKUP_AGE_IDENTITY || ''));
    if (!fs.existsSync(identity) || !fs.lstatSync(identity).isFile()) {
      throw new Error('Set STORE_BACKUP_AGE_IDENTITY to a real identity file for decryption verification.');
    }
    if (!commandAvailable('age')) throw new Error('age is required for decryption verification.');
    const result = runCommand('age', [
      '--decrypt', '--identity', identity, '--output', '/dev/null', snapshot.archivePath
    ], { timeoutMs: 120_000 });
    if (result.status !== 0) throw new Error('Second-device archive decryption verification failed.');
    decryptabilityVerified = true;
  }
  return {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    archiveBytes: snapshot.archiveBytes,
    archiveSha256: snapshot.archiveSha256,
    checksumVerified: true,
    decryptabilityVerified,
    containsCredentials: false,
    containsCustomerData: false
  };
}

export function executeOffsiteCopy(options = {}) {
  const plan = planOffsiteCopy(options);
  if (options.acknowledge !== ACKNOWLEDGEMENT) {
    throw new Error(`Execution requires --acknowledge=${ACKNOWLEDGEMENT}.`);
  }
  if (options.requireSeparateDevice !== false && !plan.deviceSeparated) {
    throw new Error('Off-device execution requires a destination on a different filesystem device.');
  }
  if (plan.targetExists) throw new Error('Off-device target already exists; snapshots are append-only.');

  fs.mkdirSync(plan.target, { mode: 0o700 });
  try {
    for (const filename of ['manifest.json', plan.archiveName]) {
      fs.copyFileSync(path.join(plan.source, filename), path.join(plan.target, filename), fs.constants.COPYFILE_EXCL);
      fs.chmodSync(path.join(plan.target, filename), 0o600);
    }
    const verification = verifyOffsiteCopy({ snapshot: plan.target });
    const receipt = {
      ...verification,
      copiedAt: verification.verifiedAt,
      destinationType: 'off-device-filesystem',
      deviceSeparated: plan.deviceSeparated
    };
    fs.writeFileSync(
      path.join(plan.target, 'offsite-copy-receipt.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { mode: 0o600, flag: 'wx' }
    );
    return { ...plan, execution: { ok: true }, verification: receipt };
  } catch (error) {
    fs.rmSync(plan.target, { recursive: true, force: true });
    throw error;
  }
}

function printHelp() {
  console.log(`Usage: node scripts/backup-offsite-copy.mjs --snapshot=DIR [options]

Options:
  --destination=DIR     Existing mounted external or remote filesystem root.
  --execute             Copy the encrypted receipt and archive.
  --acknowledge=${ACKNOWLEDGEMENT}
                        Required for execution.
  --verify-only         Verify an already copied encrypted snapshot.
  --verify-decrypt      Also decrypt to /dev/null using STORE_BACKUP_AGE_IDENTITY.
  --output=FILE         Write sanitized plan/verification evidence.
  --json                Print sanitized JSON evidence.
  -h, --help            Show this help.

Execution requires a different filesystem device by default. Mount a removable
drive or private remote share; do not expose a public file-sharing or SSH port.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return printHelp();
  const snapshot = valueArg(args, '--snapshot');
  const output = valueArg(args, '--output');
  let result;
  if (args.includes('--verify-only')) {
    result = verifyOffsiteCopy({
      snapshot,
      verifyDecrypt: args.includes('--verify-decrypt'),
      ageIdentity: process.env.STORE_BACKUP_AGE_IDENTITY || ''
    });
  } else if (args.includes('--execute')) {
    result = executeOffsiteCopy({
      snapshot,
      destination: valueArg(args, '--destination'),
      acknowledge: valueArg(args, '--acknowledge')
    });
  } else {
    result = planOffsiteCopy({ snapshot, destination: valueArg(args, '--destination') });
  }
  const sanitized = JSON.parse(JSON.stringify(result));
  delete sanitized.source;
  delete sanitized.destinationRoot;
  delete sanitized.target;
  if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o600 });
  if (args.includes('--json') || !output) console.log(JSON.stringify(sanitized, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}

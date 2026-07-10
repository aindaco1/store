#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { auditStoreDataInventory } from './audit-store-data-inventory.mjs';
import { commandAvailable } from './lib/command-runner.mjs';
import { buildSecretInventory, createBackupSnapshot } from './store-backup.mjs';

const DEFAULT_REQUIRED_CREDENTIALS = Object.freeze([
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN'
]);

function valueArg(args, name, fallback = '') {
  const exact = args.indexOf(name);
  if (exact >= 0 && args[exact + 1]) return args[exact + 1];
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function readJsonIfPresent(filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return null;
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function ageHours(timestamp, now = new Date()) {
  const parsed = Date.parse(String(timestamp || ''));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, (now.getTime() - parsed) / (60 * 60 * 1000));
}

function evidenceAgeCheck({ id, label, evidence, timestampFields, maxAgeHours, required }) {
  if (!evidence) {
    return {
      id,
      status: required ? 'FAIL' : 'WARN',
      detail: `${label} evidence is unavailable`,
      ageHours: null,
      maxAgeHours
    };
  }
  const timestamp = timestampFields.map((field) => evidence[field]).find(Boolean);
  const age = ageHours(timestamp);
  if (age === null) {
    return {
      id,
      status: 'FAIL',
      detail: `${label} evidence has no valid timestamp`,
      ageHours: null,
      maxAgeHours
    };
  }
  return {
    id,
    status: age <= maxAgeHours ? 'PASS' : (required ? 'FAIL' : 'WARN'),
    detail: `${label} evidence age is ${age.toFixed(2)} hours`,
    ageHours: Number(age.toFixed(2)),
    maxAgeHours
  };
}

export async function collectBackupReadiness(options = {}) {
  const checks = [];
  const inventory = auditStoreDataInventory();
  checks.push({
    id: 'data-inventory',
    status: inventory.ok ? 'PASS' : 'FAIL',
    detail: inventory.ok
      ? `${inventory.discovered.length} Worker storage families are classified`
      : `${inventory.missing.length} Worker storage families are unclassified`,
    missing: inventory.missing
  });

  let backupPlan = null;
  try {
    backupPlan = await createBackupSnapshot({
      dryRun: true,
      remote: false,
      skipGitBundle: true,
      skipBuild: true
    });
    checks.push({
      id: 'metadata-backup-plan',
      status: backupPlan.dryRun === true && Number(backupPlan.version || 0) === 2 ? 'PASS' : 'FAIL',
      detail: `snapshot v${backupPlan.version || 0} planned with ${backupPlan.includedDataClasses?.length || 0} data classes`
    });
  } catch (error) {
    checks.push({
      id: 'metadata-backup-plan',
      status: 'FAIL',
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  const requiredCredentials = Array.from(new Set(
    (options.requiredCredentials || DEFAULT_REQUIRED_CREDENTIALS)
      .map((name) => String(name || '').trim())
      .filter(Boolean)
  ));
  const secrets = buildSecretInventory({ env: options.env || process.env, devVarsPath: options.devVarsPath });
  const missingCredentials = requiredCredentials.filter((name) => {
    const entry = secrets.find((secret) => secret.name === name);
    return !entry?.shellPresent && !entry?.localDevPresent;
  });
  checks.push({
    id: 'required-credential-names',
    status: missingCredentials.length ? 'FAIL' : 'PASS',
    detail: missingCredentials.length
      ? `${missingCredentials.length} required credential names are unavailable`
      : `${requiredCredentials.length} required credential names are present`,
    required: requiredCredentials,
    missing: missingCredentials,
    valuesExported: false
  });

  const requiredTools = ['node', 'npm', 'npx', 'git'];
  const optionalTools = ['gh', 'stripe', 'podman', 'age', 'gpg'];
  const commandAvailableImpl = options.commandAvailableImpl || commandAvailable;
  const toolStatus = Object.fromEntries([...requiredTools, ...optionalTools].map((tool) => [tool, commandAvailableImpl(tool)]));
  const missingTools = requiredTools.filter((tool) => !toolStatus[tool]);
  const encryptionAvailable = toolStatus.age || toolStatus.gpg;
  checks.push({
    id: 'required-tools',
    status: missingTools.length || !encryptionAvailable ? 'FAIL' : 'PASS',
    detail: missingTools.length
      ? `missing required tools: ${missingTools.join(', ')}`
      : (encryptionAvailable ? 'required tools and an encryption backend are available' : 'age or GPG is required'),
    tools: toolStatus
  });

  const providerEvidence = readJsonIfPresent(options.providerEvidence);
  if (!providerEvidence) {
    checks.push({ id: 'provider-evidence', status: options.requireCurrentEvidence ? 'FAIL' : 'WARN', detail: 'sanitized provider evidence is unavailable' });
  } else {
    const failures = Number(providerEvidence.summary?.failCount || 0);
    checks.push({
      id: 'provider-evidence',
      status: failures ? 'FAIL' : 'PASS',
      detail: failures ? `${failures} provider evidence checks failed` : 'provider evidence contains no failed checks',
      checkedAt: providerEvidence.checkedAt || ''
    });
  }

  checks.push(evidenceAgeCheck({
    id: 'snapshot-age',
    label: 'encrypted snapshot receipt',
    evidence: readJsonIfPresent(options.snapshotReceipt),
    timestampFields: ['completedAt', 'createdAt'],
    maxAgeHours: boundedNumber(options.maxSnapshotAgeHours, 24, 1, 24 * 31),
    required: options.requireCurrentEvidence === true
  }));
  checks.push(evidenceAgeCheck({
    id: 'rehearsal-age',
    label: 'restore rehearsal',
    evidence: readJsonIfPresent(options.rehearsalEvidence),
    timestampFields: ['rehearsedAt', 'generatedAt', 'measuredAt'],
    maxAgeHours: boundedNumber(options.maxRehearsalAgeHours, 24 * 90, 1, 24 * 366),
    required: options.requireCurrentEvidence === true
  }));

  const failed = checks.filter((check) => check.status === 'FAIL').length;
  const warned = checks.filter((check) => check.status === 'WARN').length;
  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    containsSecretValues: false,
    containsCustomerData: false,
    ok: failed === 0,
    summary: { passed: checks.length - failed - warned, warned, failed },
    checks
  };
}

function writeOutput(output, value) {
  if (!output) return;
  const resolved = path.resolve(output);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/backup-readiness.mjs [--provider-evidence=FILE] [--snapshot-receipt=FILE] [--rehearsal-evidence=FILE] [--max-snapshot-age-hours=24] [--max-rehearsal-age-hours=2160] [--require-current-evidence] [--output=FILE] [--strict]');
    console.log('The report contains credential names and status only, never credential values or customer data.');
    return;
  }
  const requiredCredentials = valueArg(args, '--required-credentials', '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const result = await collectBackupReadiness({
    providerEvidence: valueArg(args, '--provider-evidence', ''),
    snapshotReceipt: valueArg(args, '--snapshot-receipt', ''),
    rehearsalEvidence: valueArg(args, '--rehearsal-evidence', ''),
    maxSnapshotAgeHours: valueArg(args, '--max-snapshot-age-hours', '24'),
    maxRehearsalAgeHours: valueArg(args, '--max-rehearsal-age-hours', String(24 * 90)),
    requireCurrentEvidence: args.includes('--require-current-evidence'),
    ...(requiredCredentials.length ? { requiredCredentials } : {})
  });
  writeOutput(valueArg(args, '--output', ''), result);
  console.log(JSON.stringify(result, null, 2));
  if (args.includes('--strict') && !result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

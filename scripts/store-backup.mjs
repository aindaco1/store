#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchAdminExport, exchangeAdminLoginToken } from './lib/admin-export-client.mjs';
import { commandAvailable, runCommand } from './lib/command-runner.mjs';
import { buildChecksumManifest, enforcePrivatePermissions, sha256File } from './lib/file-integrity.mjs';
import { transformKvBackupValuesToPutRecords } from './lib/kv-backup-records.mjs';
import {
  loadStoreDataInventory,
  storeKvBackupFamilies,
  storeKvValueBackupFamilies,
  storeQuarantinedKvFamilies
} from './lib/store-data-inventory.mjs';
import { normalizeWranglerInventory } from './lib/wrangler-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = path.join(ROOT, 'worker');
const WRANGLER_PATH = path.join(WORKER_DIR, 'wrangler.toml');
const DEV_VARS_PATH = path.join(WORKER_DIR, '.dev.vars');

const STORE_DATA_INVENTORY = loadStoreDataInventory();
export const KV_BACKUP_PREFIXES = storeKvBackupFamilies({ inventory: STORE_DATA_INVENTORY }).map((family) => family.prefix);
export const KV_VALUE_BACKUP_PREFIXES = storeKvValueBackupFamilies({ inventory: STORE_DATA_INVENTORY }).map((family) => family.prefix);
export const KV_QUARANTINE_PREFIXES = storeQuarantinedKvFamilies({ inventory: STORE_DATA_INVENTORY }).map((family) => family.prefix);

export const SECRET_INVENTORY_NAMES = [
  'STRIPE_SECRET_KEY',
  'STRIPE_SECRET_KEY_LIVE',
  'STRIPE_SECRET_KEY_TEST',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_WEBHOOK_SECRET_LIVE',
  'STRIPE_WEBHOOK_SECRET_TEST',
  'FILM_STRIPE_SUMMARY_ADAPTER_SECRET',
  'RESEND_API_KEY',
  'ADMIN_SECRET',
  'ADMIN_SESSION_SECRET',
  'CHECKOUT_INTENT_SECRET',
  'MAGIC_LINK_SECRET',
  'STORE_DOWNLOAD_SECRET',
  'WORKERS_CACHE_PURGE_SECRET',
  'WORKERS_CACHE_EVIDENCE_SECRET',
  'TURNSTILE_SECRET_KEY',
  'ADMIN_TURNSTILE_SECRET_KEY',
  'STORE_ORDER_TURNSTILE_SECRET_KEY',
  'USPS_CLIENT_SECRET',
  'ZIP_TAX_API_KEY',
  'TAX_API_KEY',
  'GITHUB_TOKEN',
  'GITHUB_OWNER',
  'GITHUB_REPO',
  'GITHUB_WORKFLOW',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ANALYTICS_API_TOKEN',
  'CLOUDFLARE_DNS_API_TOKEN'
];

const LOCAL_FILE_SNAPSHOT_PATHS = [
  '_config.yml',
  '_config.local.yml',
  'api/products.json',
  'api/add-ons.json',
  'package.json',
  'package-lock.json',
  'worker/package.json',
  'worker/package-lock.json',
  'worker/wrangler.toml',
  'worker/src/generated/catalog-snapshot.js',
  'docs/BACKUP_RESTORE.md',
  'docs/ROADMAP.md',
  'CHANGELOG.md'
];

function utcTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function printHelp() {
  console.log(`Usage: node scripts/store-backup.mjs [options]

Creates a repeatable Store backup snapshot manifest.

Options:
  --output=DIR          Snapshot directory. Defaults to ~/store-backups/<utc timestamp>
  --remote              Allow read-only remote provider commands.
  --kv-values           With --remote, also export KV values with wrangler kv bulk get.
  --r2-objects          With --remote, download referenced STORE_DOWNLOADS R2 objects.
  --require-complete-r2 Require provider object enumeration before an R2 object snapshot.
  --admin-exports       With --remote, capture protected admin CSV/readiness/download inventory.
  --worker-base=URL     Worker base for --admin-exports. Defaults to WORKER_BASE.
  --acknowledge-sensitive=STORE_SENSITIVE_BACKUP
                        Required for unattended sensitive exports.
  --encryption-recipient=RECIPIENT
                        age or GPG recipient used for sensitive archives.
  --encryption-backend=auto|age|gpg
                        Encryption backend. Defaults to auto.
  --skip-git-bundle     Skip git bundle creation.
  --skip-file-copy      Skip copying selected config/build files into the snapshot.
  --skip-build          Skip isolated Jekyll/minification/Wrangler dry-run build evidence.
  --release-snapshot    Mark the encrypted receipt as retention-protected release evidence.
  --dry-run             Print the plan without creating files or calling provider CLIs.
  --json                Print the final manifest JSON to stdout.
  -h, --help            Show this help.

The helper never exports production secret values. It records secret names and
presence only. KV value and R2 object exports may contain customer or fulfillment
data; store snapshot directories outside the repository in encrypted operator
storage.`);
}

function valueArg(args, name, fallback = '') {
  const exact = args.indexOf(name);
  if (exact >= 0 && args[exact + 1]) return args[exact + 1];
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

export function parseBackupArgs(args = []) {
  return {
    help: args.includes('--help') || args.includes('-h'),
    output: valueArg(args, '--output', ''),
    remote: args.includes('--remote'),
    kvValues: args.includes('--kv-values'),
    r2Objects: args.includes('--r2-objects'),
    requireCompleteR2Inventory: args.includes('--require-complete-r2'),
    adminExports: args.includes('--admin-exports'),
    workerBase: valueArg(args, '--worker-base', process.env.WORKER_BASE || ''),
    acknowledgeSensitive: valueArg(args, '--acknowledge-sensitive', ''),
    encryptionRecipient: valueArg(args, '--encryption-recipient', process.env.STORE_BACKUP_ENCRYPTION_RECIPIENT || ''),
    encryptionBackend: valueArg(args, '--encryption-backend', 'auto'),
    skipGitBundle: args.includes('--skip-git-bundle'),
    skipFileCopy: args.includes('--skip-file-copy'),
    skipBuild: args.includes('--skip-build'),
    releaseSnapshot: args.includes('--release-snapshot'),
    dryRun: args.includes('--dry-run'),
    json: args.includes('--json')
  };
}

function run(command, args = [], options = {}) {
  return runCommand(command, args, { ...options, cwd: options.cwd || ROOT });
}

function ensureDir(dirPath, options = {}) {
  if (options.dryRun) return;
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  fs.chmodSync(dirPath, 0o700);
}

function writeText(filePath, content, options = {}) {
  if (options.dryRun) return;
  ensureDir(path.dirname(filePath), options);
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function writeJson(filePath, data, options = {}) {
  writeText(filePath, `${JSON.stringify(data, null, 2)}\n`, options);
}

function writeBytes(filePath, bytes, options = {}) {
  if (options.dryRun) return;
  ensureDir(path.dirname(filePath), options);
  fs.writeFileSync(filePath, bytes, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function copyIfExists(root, relativePath, outputDir, options = {}) {
  const source = path.join(root, relativePath);
  if (!fs.existsSync(source)) return false;
  const target = path.join(outputDir, relativePath);
  if (!options.dryRun) {
    ensureDir(path.dirname(target), options);
    fs.copyFileSync(source, target);
    fs.chmodSync(target, 0o600);
  }
  return true;
}

function safeName(value) {
  return String(value || 'item').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
}

function resolveThroughExistingAncestor(candidate) {
  const suffix = [];
  let current = path.resolve(candidate);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(candidate);
    suffix.unshift(path.basename(current));
    current = parent;
  }
  return path.resolve(fs.realpathSync(current), ...suffix);
}

function pathIsWithin(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

export function resolveR2BackupObjectPath(objectsDir, key) {
  const text = String(key || '');
  const segments = text.split('/');
  if (!text || text.includes('\0') || text.includes('\\') ||
      segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('R2 object key cannot be represented safely in a snapshot path.');
  }
  const target = path.resolve(objectsDir, ...segments);
  if (!pathIsWithin(objectsDir, target)) {
    throw new Error('R2 object key escapes the snapshot object directory.');
  }
  return target;
}

export function parseWranglerTomlInventory(content = '') {
  return normalizeWranglerInventory(content);
}

export function discoverDownloadKeys(root = ROOT) {
  const productDir = path.join(root, '_products');
  if (!fs.existsSync(productDir)) return [];
  const keys = new Set();
  for (const entry of fs.readdirSync(productDir).sort()) {
    if (!entry.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(productDir, entry), 'utf8');
    const frontMatter = text.match(/^---\n([\s\S]*?)\n---/);
    const source = frontMatter ? frontMatter[1] : text;
    for (const match of source.matchAll(/(?:^|\n)\s*file_key:\s*["']?([^"'\n#]+)["']?/g)) {
      const key = match[1].trim();
      if (key) keys.add(key);
    }
  }
  return Array.from(keys).sort();
}

function readKeyValuePresence(filePath) {
  const names = new Set();
  if (!fs.existsSync(filePath)) return names;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (match) names.add(match[1]);
  }
  return names;
}

export function buildSecretInventory({ env = process.env, devVarsPath = DEV_VARS_PATH } = {}) {
  const localNames = readKeyValuePresence(devVarsPath);
  return SECRET_INVENTORY_NAMES.map((name) => ({
    name,
    shellPresent: Boolean(String(env[name] || '').trim()),
    localDevPresent: localNames.has(name),
    valueExported: false
  }));
}

export function buildKvBackupPlan(prefixes = KV_BACKUP_PREFIXES, {
  binding = 'STORE_STATE',
  includeValues = false,
  valuePrefixes = null
} = {}) {
  const allowedValuePrefixes = valuePrefixes ? new Set(valuePrefixes) : null;
  return prefixes.map((prefix) => {
    const safePrefix = safeName(prefix);
    const keysFile = `kv/${safePrefix}.keys.json`;
    const valuesFile = `kv/${safePrefix}.values.json`;
    const includePrefixValues = includeValues && (!allowedValuePrefixes || allowedValuePrefixes.has(prefix));
    return {
      prefix,
      binding,
      keysFile,
      valuesFile: includePrefixValues ? valuesFile : '',
      commands: [
        ['npx', ['wrangler', 'kv', 'key', 'list', '--remote', '--binding', binding, '--prefix', prefix]],
        ...(includePrefixValues ? [['npx', ['wrangler', 'kv', 'bulk', 'get', keysFile, '--remote', '--binding', binding]]] : [])
      ]
    };
  });
}

export function transformKvBulkGetToPutRecords(values = {}) {
  return transformKvBackupValuesToPutRecords(values);
}

export function chunkKvBackupKeys(keys = [], maximum = 100) {
  const boundedMaximum = Math.max(1, Math.min(100, Number.parseInt(String(maximum || 100), 10) || 100));
  const normalized = Array.isArray(keys) ? keys.filter((entry) => String(entry?.name || entry || '').trim()) : [];
  const chunks = [];
  for (let index = 0; index < normalized.length; index += boundedMaximum) {
    chunks.push(normalized.slice(index, index + boundedMaximum));
  }
  return chunks;
}

export function sanitizeBackupWarningCategories(warnings = []) {
  const categories = new Set();
  for (const warning of warnings || []) {
    const value = String(warning || '').trim().toLowerCase();
    if (!value) continue;
    if (value.startsWith('stripe ')) categories.add('stripe_provider_inventory');
    else if (value.startsWith('kv keys ')) categories.add('kv_key_inventory');
    else if (value.startsWith('kv values ')) categories.add('kv_value_capture');
    else if (value.startsWith('r2 object ')) categories.add('r2_object_capture');
    else if (value.includes('admin export')) categories.add('admin_exports');
    else if (value.includes('github') || value.startsWith('gh ')) categories.add('github_provider_inventory');
    else if (value.includes('wrangler')) categories.add('cloudflare_provider_inventory');
    else categories.add('backup_warning');
  }
  return Array.from(categories).sort();
}

function captureCommand(manifest, label, command, args, options = {}) {
  const planned = { label, command, args, cwd: path.relative(ROOT, options.cwd || ROOT) || '.', status: 'planned' };
  manifest.commands.push(planned);
  if (options.dryRun) return { ok: true, stdout: '', stderr: '', planned: true };
  const result = run(command, args, options);
  planned.status = result.status;
  if (result.status !== 0) {
    manifest.warnings.push(`${label} failed: ${result.stderr.trim() || result.error || `exit ${result.status}`}`);
  }
  if (options.stdoutFile && result.status === 0) writeText(options.stdoutFile, result.stdout, options);
  if (options.stderrFile && result.stderr) writeText(options.stderrFile, result.stderr, options);
  return result;
}

function captureGit(manifest, outputDir, options) {
  const gitDir = path.join(outputDir, 'git');
  ensureDir(gitDir, options);
  const commands = [
    ['head', ['git', ['rev-parse', 'HEAD'], 'store-head.txt']],
    ['branch', ['git', ['branch', '--show-current'], 'branch.txt']],
    ['status', ['git', ['status', '--short'], 'status.txt']],
    ['untracked', ['git', ['ls-files', '--others', '--exclude-standard'], 'untracked.txt']],
    ['diff', ['git', ['diff', '--binary'], 'worktree.patch']]
  ];
  for (const [_id, [command, args, filename]] of commands) {
    captureCommand(manifest, `git ${filename}`, command, args, {
      ...options,
      cwd: ROOT,
      stdoutFile: path.join(gitDir, filename)
    });
  }
  if (!options.skipGitBundle) {
    captureCommand(manifest, 'git bundle', 'git', ['bundle', 'create', path.join(gitDir, 'store.bundle'), '--all'], {
      ...options,
      cwd: ROOT
    });
  }
}

function captureLocalFiles(manifest, outputDir, options) {
  if (options.skipFileCopy) return;
  const copied = [];
  const filesDir = path.join(outputDir, 'files');
  for (const relativePath of LOCAL_FILE_SNAPSHOT_PATHS) {
    if (copyIfExists(ROOT, relativePath, filesDir, options)) copied.push(relativePath);
  }
  manifest.localFiles = copied;
}

function captureBuildEvidence(manifest, outputDir, options) {
  if (options.skipBuild) return;
  const buildDir = path.join(outputDir, 'build');
  const siteDir = path.join(buildDir, 'site');
  const workerDir = path.join(buildDir, 'worker-bundle');
  ensureDir(buildDir, options);
  captureCommand(manifest, 'isolated Jekyll build', 'bundle', [
    'exec', 'jekyll', 'build', '--destination', siteDir
  ], {
    ...options,
    cwd: ROOT,
    stdoutFile: path.join(buildDir, 'jekyll-build.log'),
    stderrFile: path.join(buildDir, 'jekyll-build.stderr.log')
  });
  captureCommand(manifest, 'isolated built-asset minification', 'node', [
    './scripts/minify-site-assets.mjs', '--write', `--site-dir=${siteDir}`
  ], {
    ...options,
    cwd: ROOT,
    stdoutFile: path.join(buildDir, 'asset-minification.log'),
    stderrFile: path.join(buildDir, 'asset-minification.stderr.log')
  });
  captureCommand(manifest, 'Wrangler dry-run bundle', 'npx', [
    'wrangler', 'deploy', '--dry-run', '--outdir', workerDir, '--metafile'
  ], {
    ...options,
    cwd: WORKER_DIR,
    stdoutFile: path.join(buildDir, 'wrangler-dry-run.log'),
    stderrFile: path.join(buildDir, 'wrangler-dry-run.stderr.log')
  });
}

function captureProviderInventory(manifest, outputDir, options, wranglerInventory) {
  const providerDir = path.join(outputDir, 'provider');
  ensureDir(providerDir, options);
  writeJson(path.join(providerDir, 'wrangler-inventory.json'), wranglerInventory, options);
  writeJson(path.join(providerDir, 'secret-inventory.json'), buildSecretInventory(), options);

  if (!options.remote) {
    manifest.warnings.push('Remote provider inventory skipped; rerun with --remote for read-only Wrangler/GitHub/Stripe probes.');
    return;
  }

  captureCommand(manifest, 'wrangler versions list', 'npx', ['wrangler', 'versions', 'list', '--json', '--env='], {
    ...options,
    cwd: WORKER_DIR,
    stdoutFile: path.join(providerDir, 'worker-versions.json')
  });
  captureCommand(manifest, 'wrangler deployments list', 'npx', ['wrangler', 'deployments', 'list', '--json', '--env='], {
    ...options,
    cwd: WORKER_DIR,
    stdoutFile: path.join(providerDir, 'worker-deployments.json')
  });
  captureCommand(manifest, 'wrangler secret list', 'npx', ['wrangler', 'secret', 'list', '--format', 'json', '--env='], {
    ...options,
    cwd: WORKER_DIR,
    stdoutFile: path.join(providerDir, 'worker-secret-names.json')
  });
  captureCommand(manifest, 'shared release provider readiness', 'npm', [
    'run', 'release:providers', '--', `--json-output=${path.join(providerDir, 'provider-readiness.json')}`
  ], {
    ...options,
    cwd: ROOT,
    timeoutMs: 120_000
  });

  if (commandAvailable('gh')) {
    captureCommand(manifest, 'gh repo view', 'gh', ['repo', 'view', '--json', 'nameWithOwner,url,defaultBranchRef,pushedAt'], {
      ...options,
      cwd: ROOT,
      stdoutFile: path.join(providerDir, 'github-repo.json')
    });
  } else {
    manifest.warnings.push('gh not available; GitHub provider inventory skipped.');
  }

  if (commandAvailable('stripe')) {
    captureCommand(manifest, 'stripe webhook_endpoints list', 'stripe', ['webhook_endpoints', 'list', '--limit', '100'], {
      ...options,
      cwd: ROOT,
      stdoutFile: path.join(providerDir, 'stripe-webhook-endpoints.txt')
    });
  } else {
    manifest.warnings.push('stripe CLI not available; Stripe webhook endpoint inventory skipped.');
  }
}

function captureKv(manifest, outputDir, options) {
  const kvDir = path.join(outputDir, 'kv');
  ensureDir(kvDir, options);
  const plan = buildKvBackupPlan(KV_BACKUP_PREFIXES, {
    includeValues: options.kvValues,
    valuePrefixes: KV_VALUE_BACKUP_PREFIXES
  });
  writeJson(path.join(kvDir, 'classification.json'), {
    schemaVersion: STORE_DATA_INVENTORY.schemaVersion,
    families: STORE_DATA_INVENTORY.families.filter((family) => family.type === 'kv'),
    valueBackupPrefixes: KV_VALUE_BACKUP_PREFIXES,
    quarantinePrefixes: KV_QUARANTINE_PREFIXES,
    durableObjectRestore: 'derived_state_only'
  }, options);
  writeJson(path.join(kvDir, 'plan.json'), plan, options);
  manifest.kvValueCapture = [];

  if (!options.remote) return;
  for (const item of plan) {
    const keysFile = path.join(outputDir, item.keysFile);
    const keysResult = captureCommand(manifest, `kv keys ${item.prefix}`, 'npx', item.commands[0][1], {
      ...options,
      cwd: WORKER_DIR,
      stdoutFile: keysFile
    });
    if (options.kvValues && item.valuesFile) {
      if (keysResult.status !== 0) throw new Error(`KV key inventory failed for required value family ${item.prefix}.`);
      let keys;
      try {
        keys = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
      } catch {
        throw new Error(`KV key inventory is invalid for required value family ${item.prefix}.`);
      }
      if (!Array.isArray(keys)) throw new Error(`KV key inventory must be an array for ${item.prefix}.`);
      const chunks = chunkKvBackupKeys(keys);
      const mergedValues = {};
      for (const [index, chunk] of chunks.entries()) {
        const chunkKeysFile = path.join(kvDir, `${safeName(item.prefix)}.keys.${index + 1}.json`);
        const chunkValuesFile = path.join(kvDir, `${safeName(item.prefix)}.values.${index + 1}.json`);
        writeJson(chunkKeysFile, chunk, options);
        const result = captureCommand(manifest, `kv values ${item.prefix} chunk ${index + 1}/${chunks.length}`, 'npx', [
          'wrangler', 'kv', 'bulk', 'get', chunkKeysFile, '--remote', '--binding', item.binding
        ], {
          ...options,
          cwd: WORKER_DIR,
          stdoutFile: chunkValuesFile
        });
        if (result.status !== 0) throw new Error(`KV value capture failed for ${item.prefix} chunk ${index + 1}/${chunks.length}.`);
        let chunkValues;
        try {
          chunkValues = JSON.parse(fs.readFileSync(chunkValuesFile, 'utf8'));
        } catch {
          throw new Error(`KV value capture returned invalid JSON for ${item.prefix} chunk ${index + 1}/${chunks.length}.`);
        }
        Object.assign(mergedValues, chunkValues || {});
        fs.rmSync(chunkKeysFile, { force: true });
        fs.rmSync(chunkValuesFile, { force: true });
      }
      if (Object.keys(mergedValues).length !== keys.length) {
        throw new Error(`KV value capture count mismatch for ${item.prefix}: expected ${keys.length}, captured ${Object.keys(mergedValues).length}.`);
      }
      writeJson(path.join(outputDir, item.valuesFile), mergedValues, options);
      manifest.kvValueCapture.push({
        prefix: item.prefix,
        keys: keys.length,
        chunks: chunks.length,
        complete: true
      });
    }
  }
}

async function captureAdminExports(manifest, outputDir, options) {
  if (!options.adminExports) return;
  if (!options.remote) {
    manifest.warnings.push('--admin-exports requires --remote; protected exports were skipped.');
    return;
  }
  if (options.dryRun) {
    manifest.adminExports = [
      'orders.csv', 'attendees.csv', 'reconciliation.csv', 'audit.csv', 'downloads.json', 'health.json'
    ].map((filename) => ({ filename, status: 'planned' }));
    return;
  }
  const token = String(process.env.STORE_BACKUP_ADMIN_LOGIN_TOKEN || '').trim();
  if (!token || !options.workerBase) {
    manifest.warnings.push('Admin exports skipped; set STORE_BACKUP_ADMIN_LOGIN_TOKEN and --worker-base without placing the token on the command line.');
    return;
  }
  const adminDir = path.join(outputDir, 'admin');
  ensureDir(adminDir, options);
  const session = await exchangeAdminLoginToken({ workerBase: options.workerBase, token });
  if (session.role !== 'super_admin') throw new Error('Admin backup exports require a super-admin one-time login token.');
  const exports = [
    ['orders.csv', '/admin/store/orders.csv', 'text/csv'],
    ['attendees.csv', '/admin/store/attendees.csv', 'text/csv'],
    ['reconciliation.csv', '/admin/store/reconciliation.csv', 'text/csv'],
    ['audit.csv', '/admin/audit.csv', 'text/csv'],
    ['downloads.json', '/admin/store/downloads', 'application/json'],
    ['health.json', '/admin/store/health', 'application/json']
  ];
  manifest.adminExports = [];
  for (const [filename, routePath, accept] of exports) {
    const result = await fetchAdminExport({
      workerBase: options.workerBase,
      session,
      path: routePath,
      accept
    });
    writeBytes(path.join(adminDir, filename), result.bytes, options);
    manifest.adminExports.push({ filename, route: routePath, bytes: result.bytes.byteLength });
    if (filename === 'downloads.json') {
      const parsed = JSON.parse(new TextDecoder().decode(result.bytes));
      manifest.adminDownloadKeys = (Array.isArray(parsed.files) ? parsed.files : [])
        .filter((file) => String(file?.source || '').trim().toLowerCase() === 'r2' && file?.ready === true)
        .map((file) => String(file?.fileKey || '').trim())
        .filter(Boolean)
        .sort();
      manifest.adminDownloadInventoryComplete = parsed.page?.r2ListComplete === true;
    }
  }
}

export async function discoverR2ObjectKeys(options = {}) {
  const accountId = String(options.accountId || '').trim();
  const bucket = String(options.bucket || '').trim();
  const apiToken = String(options.apiToken || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId) || !/^[a-z0-9][a-z0-9.-]{1,62}$/i.test(bucket) || !apiToken) {
    throw new Error('Complete R2 object discovery requires account, bucket, and read token.');
  }
  const fetchImpl = options.fetchImpl || fetch;
  const keys = [];
  let cursor = '';
  const seenCursors = new Set();
  for (let page = 0; page < 100; page += 1) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects`);
    url.searchParams.set('per_page', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
      redirect: 'error'
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) {
      throw new Error(`R2 object inventory query failed with status ${response.status}.`);
    }
    const objects = Array.isArray(body?.result)
      ? body.result
      : (Array.isArray(body?.result?.objects) ? body.result.objects : []);
    for (const object of objects) {
      const key = String(object?.key || '').trim();
      if (key) keys.push(key);
    }
    const nextCursor = String(body?.result_info?.cursor || body?.result?.cursor || '').trim();
    if (!nextCursor) return Array.from(new Set(keys)).sort();
    if (seenCursors.has(nextCursor)) throw new Error('R2 object inventory returned a repeated cursor.');
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new Error('R2 object inventory exceeded the bounded page limit.');
}

async function captureR2(manifest, outputDir, options, wranglerInventory) {
  const r2Dir = path.join(outputDir, 'r2');
  ensureDir(r2Dir, options);
  const catalogKeys = discoverDownloadKeys(ROOT);
  const bucket = String(wranglerInventory.r2Buckets.find((entry) => entry.binding === 'STORE_DOWNLOADS')?.bucket_name || '').trim();
  let providerKeys = [];
  let fullInventory = manifest.adminDownloadInventoryComplete === true;
  let inventorySource = fullInventory ? 'admin_export' : 'known_keys';
  if (options.remote && options.r2Objects && bucket && !fullInventory) {
    const apiToken = String(process.env.CLOUDFLARE_R2_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '').trim();
    const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
    if (apiToken && accountId) {
      try {
        providerKeys = await discoverR2ObjectKeys({ accountId, bucket, apiToken });
        fullInventory = true;
        inventorySource = 'cloudflare_api';
      } catch (error) {
        manifest.warnings.push('R2 complete object inventory failed; only known object keys are available.');
        if (options.requireCompleteR2Inventory) throw error;
      }
    } else if (options.requireCompleteR2Inventory) {
      throw new Error('Complete R2 object inventory requires CLOUDFLARE_R2_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.');
    } else {
      manifest.warnings.push('R2 complete object inventory skipped; configure a read-only R2 API token to include unattached objects.');
    }
  }
  const downloadKeys = Array.from(new Set([
    ...catalogKeys,
    ...(manifest.adminDownloadKeys || []),
    ...providerKeys
  ])).sort();
  writeText(path.join(r2Dir, 'download-keys.txt'), `${downloadKeys.join('\n')}${downloadKeys.length ? '\n' : ''}`, options);
  manifest.r2 = {
    bucket,
    catalogReferencedObjects: catalogKeys.length,
    discoveredLibraryObjects: (manifest.adminDownloadKeys || []).length,
    providerDiscoveredObjects: providerKeys.length,
    completeInventory: fullInventory,
    inventorySource,
    totalDiscoveredObjects: downloadKeys.length,
    objectsRequested: options.remote && options.r2Objects ? downloadKeys.length : 0,
    objectsDownloadedCount: 0,
    objectsDownloaded: false
  };
  if (!options.remote || !options.r2Objects) return;
  if (!bucket) throw new Error('STORE_DOWNLOADS bucket_name is required for R2 object backup.');
  const objectsDir = path.join(r2Dir, 'objects');
  const objectPlan = downloadKeys.map((key) => ({ key, target: resolveR2BackupObjectPath(objectsDir, key) }));
  for (const [index, item] of objectPlan.entries()) {
    ensureDir(path.dirname(item.target), options);
    const result = captureCommand(manifest, `r2 object ${index + 1}`, 'npx', ['wrangler', 'r2', 'object', 'get', `${bucket}/${item.key}`, '--remote', '--file', item.target], {
      ...options,
      cwd: WORKER_DIR
    });
    if (result.status === 0) manifest.r2.objectsDownloadedCount += 1;
  }
  manifest.r2.objectsDownloaded = manifest.r2.objectsDownloadedCount === objectPlan.length;
  if (options.requireCompleteR2Inventory && !manifest.r2.objectsDownloaded) {
    throw new Error(`R2 object capture was incomplete: expected ${objectPlan.length}, captured ${manifest.r2.objectsDownloadedCount}.`);
  }
}

function writeRestorePlan(outputDir, options) {
  writeText(path.join(outputDir, 'RESTORE_PLAN.md'), `# Store Restore Plan

1. Review \`manifest.json\`, \`git/status.txt\`, \`git/untracked.txt\`, and \`kv/classification.json\`.
2. Restore Git catalog/config/media history first, then run \`npm run sync:worker-config\`.
3. Restore admin access only when needed, then \`orders:\` KV records.
4. Rebuild or verify derived indexes/projections before restoring reminders or sent markers.
5. Restore \`STORE_DOWNLOADS\` objects from \`r2/objects\` or through the admin Downloads tab.
6. Do not restore \`admin-session:\`, \`admin-login:\`, \`rl:\`, lookup tokens, or cron markers unless this is an isolated incident rehearsal.
7. Run Jekyll build, content/security/SEO checks, Worker smoke, CSV export previews, R2 download checks, and admin dashboard review before reopening checkout.

KV value files from \`wrangler kv bulk get\` must be transformed with:

\`\`\`bash
jq 'to_entries | map({ key: .key, value: (.value.value // "") } + (if .value.metadata then { metadata: .value.metadata } else {} end))' \\
  kv/orders.values.json > kv/orders.restore.json
\`\`\`
`, options);
}

export function validateBackupSafety(options = {}, outputDir = '') {
  const sensitive = options.remote === true && (
    options.kvValues === true || options.r2Objects === true || options.adminExports === true
  );
  const errors = [];
  if (sensitive && options.acknowledgeSensitive !== 'STORE_SENSITIVE_BACKUP') {
    errors.push('Sensitive exports require --acknowledge-sensitive=STORE_SENSITIVE_BACKUP.');
  }
  if (sensitive && !String(options.encryptionRecipient || '').trim()) {
    errors.push('Sensitive exports require --encryption-recipient.');
  }
  const resolvedOutput = path.resolve(outputDir);
  const resolvedFilesystemOutput = resolveThroughExistingAncestor(resolvedOutput);
  const resolvedFilesystemRoot = fs.realpathSync(ROOT);
  if (sensitive && (
    pathIsWithin(ROOT, resolvedOutput) || pathIsWithin(resolvedFilesystemRoot, resolvedFilesystemOutput)
  )) {
    errors.push('Sensitive snapshots cannot be written inside the repository.');
  }
  const backend = String(options.encryptionBackend || 'auto').trim().toLowerCase();
  if (sensitive && !['auto', 'age', 'gpg'].includes(backend)) {
    errors.push('Encryption backend must be auto, age, or gpg.');
  }
  return { ok: errors.length === 0, sensitive, errors };
}

function selectedEncryptionBackend(options = {}) {
  const requested = String(options.encryptionBackend || 'auto').trim().toLowerCase();
  if (requested === 'age' || (requested === 'auto' && commandAvailable('age'))) return 'age';
  if (requested === 'gpg' || requested === 'auto') {
    if (commandAvailable('gpg')) return 'gpg';
  }
  return '';
}

function archiveSensitiveSnapshot(stagingDir, outputDir, options, manifest) {
  const backend = selectedEncryptionBackend(options);
  if (!backend) throw new Error('No supported encryption backend is available. Install age or GPG.');
  ensureDir(outputDir, options);
  const archiveBase = path.join(path.dirname(stagingDir), `${path.basename(stagingDir)}.tar.gz`);
  const archiveName = backend === 'age' ? 'store-backup.tar.gz.age' : 'store-backup.tar.gz.gpg';
  const encryptedPath = path.join(outputDir, archiveName);
  try {
    let result = run('tar', ['-czf', archiveBase, '-C', stagingDir, '.'], { cwd: path.dirname(stagingDir) });
    if (result.status !== 0) throw new Error(`Unable to archive sensitive snapshot: ${result.stderr || result.error}`);
    fs.chmodSync(archiveBase, 0o600);
    if (backend === 'age') {
      result = run('age', ['--recipient', options.encryptionRecipient, '--output', encryptedPath, archiveBase]);
    } else {
      result = run('gpg', [
        '--batch', '--yes', '--trust-model', 'always', '--encrypt',
        '--recipient', options.encryptionRecipient,
        '--output', encryptedPath,
        archiveBase
      ]);
    }
    if (result.status !== 0) throw new Error(`Unable to encrypt sensitive snapshot: ${result.stderr || result.error}`);
    fs.chmodSync(encryptedPath, 0o600);

    if (backend === 'age') {
      const identity = String(process.env.STORE_BACKUP_AGE_IDENTITY || '').trim();
      if (!identity) throw new Error('Set STORE_BACKUP_AGE_IDENTITY so decryptability can be verified before plaintext deletion.');
      result = run('age', ['--decrypt', '--identity', identity, '--output', '/dev/null', encryptedPath]);
    } else {
      result = run('gpg', ['--batch', '--decrypt', '--output', '/dev/null', encryptedPath]);
    }
    if (result.status !== 0) throw new Error(`Encrypted snapshot decryptability verification failed: ${result.stderr || result.error}`);
  } catch (error) {
    fs.rmSync(encryptedPath, { force: true });
    throw error;
  } finally {
    fs.rmSync(archiveBase, { force: true });
  }

  fs.rmSync(stagingDir, { recursive: true, force: true });
  const receipt = {
    version: 2,
    createdAt: manifest.createdAt,
    completedAt: manifest.completedAt,
    outputName: path.basename(outputDir),
    encrypted: true,
    encryptionBackend: backend,
    archive: archiveName,
    archiveBytes: fs.statSync(encryptedPath).size,
    archiveSha256: sha256File(encryptedPath),
    sourceCommit: manifest.git?.head || '',
    releaseSnapshot: manifest.releaseSnapshot === true,
    includedDataClasses: manifest.includedDataClasses,
    warningCount: manifest.warnings.length,
    warningCategories: sanitizeBackupWarningCategories(manifest.warnings),
    captureSummary: {
      kvValueFamilies: Array.isArray(manifest.kvValueCapture) ? manifest.kvValueCapture.length : 0,
      kvValueKeys: (manifest.kvValueCapture || []).reduce((sum, item) => sum + Number(item.keys || 0), 0),
      r2Objects: Number(manifest.r2?.objectsDownloadedCount || 0),
      r2InventoryComplete: manifest.r2?.completeInventory === true,
      r2InventorySource: String(manifest.r2?.inventorySource || 'not_captured'),
      adminExports: Array.isArray(manifest.adminExports) ? manifest.adminExports.length : 0
    }
  };
  writeJson(path.join(outputDir, 'manifest.json'), receipt, options);
  enforcePrivatePermissions(outputDir);
  return receipt;
}

export async function createBackupSnapshot(rawOptions = {}) {
  const options = {
    output: rawOptions.output || path.join(os.homedir(), 'store-backups', utcTimestamp()),
    remote: rawOptions.remote === true,
    kvValues: rawOptions.kvValues === true,
    r2Objects: rawOptions.r2Objects === true,
    requireCompleteR2Inventory: rawOptions.requireCompleteR2Inventory === true,
    adminExports: rawOptions.adminExports === true,
    workerBase: rawOptions.workerBase || process.env.WORKER_BASE || '',
    acknowledgeSensitive: rawOptions.acknowledgeSensitive || '',
    encryptionRecipient: rawOptions.encryptionRecipient || process.env.STORE_BACKUP_ENCRYPTION_RECIPIENT || '',
    encryptionBackend: rawOptions.encryptionBackend || 'auto',
    skipGitBundle: rawOptions.skipGitBundle === true,
    skipFileCopy: rawOptions.skipFileCopy === true,
    skipBuild: rawOptions.skipBuild === true,
    releaseSnapshot: rawOptions.releaseSnapshot === true,
    dryRun: rawOptions.dryRun === true
  };
  const outputDir = path.resolve(options.output);
  const safety = validateBackupSafety(options, outputDir);
  if (!safety.ok && !options.dryRun) throw new Error(safety.errors.join(' '));
  const captureDir = safety.sensitive && !options.dryRun
    ? `${outputDir}.staging-${process.pid}`
    : outputDir;
  if (!options.dryRun && (fs.existsSync(outputDir) || fs.existsSync(captureDir))) {
    throw new Error(`Backup output already exists: ${fs.existsSync(outputDir) ? outputDir : captureDir}`);
  }
  const wranglerContent = fs.existsSync(WRANGLER_PATH) ? fs.readFileSync(WRANGLER_PATH, 'utf8') : '';
  const wranglerInventory = parseWranglerTomlInventory(wranglerContent);
  const gitHead = run('git', ['rev-parse', 'HEAD'], { cwd: ROOT });
  const gitBranch = run('git', ['branch', '--show-current'], { cwd: ROOT });
  const gitStatus = run('git', ['status', '--porcelain'], { cwd: ROOT });
  const manifest = {
    version: 2,
    createdAt: new Date().toISOString(),
    completedAt: '',
    repoRoot: ROOT,
    outputDir,
    captureDir,
    dryRun: options.dryRun,
    remote: options.remote,
    includesKvValues: options.remote && options.kvValues,
    includesR2Objects: options.remote && options.r2Objects,
    includesAdminExports: options.remote && options.adminExports,
    encrypted: safety.sensitive,
    releaseSnapshot: options.releaseSnapshot,
    includedDataClasses: [
      'git-config-build',
      'provider-metadata',
      'kv-key-inventory',
      ...(options.remote && options.kvValues ? ['authoritative-and-control-kv-values'] : []),
      ...(options.remote && options.r2Objects ? ['r2-objects'] : []),
      ...(options.remote && options.adminExports ? ['admin-exports'] : [])
    ],
    excludedDataClasses: STORE_DATA_INVENTORY.families
      .filter((family) => family.classification === 'ephemeral-quarantined')
      .map((family) => family.id),
    recoveryObjectives: STORE_DATA_INVENTORY.recoveryObjectives,
    retention: STORE_DATA_INVENTORY.retention,
    git: {
      head: gitHead.status === 0 ? gitHead.stdout.trim() : '',
      branch: gitBranch.status === 0 ? gitBranch.stdout.trim() : '',
      dirty: gitStatus.status === 0 ? Boolean(gitStatus.stdout.trim()) : null
    },
    tools: Object.fromEntries(['node', 'npm', 'git', 'npx', 'gh', 'stripe', 'podman', 'gpg', 'age'].map((command) => {
      if (!commandAvailable(command)) return [command, 'unavailable'];
      const version = run(command, ['--version'], { cwd: ROOT, timeoutMs: 5_000 });
      return [command, version.status === 0 ? version.stdout.trim().split(/\r?\n/)[0].slice(0, 200) : 'unavailable'];
    })),
    warnings: [],
    commands: [],
    localFiles: [],
    wrangler: {
      name: wranglerInventory.name,
      compatibilityDate: wranglerInventory.compatibilityDate,
      compatibilityFlags: wranglerInventory.compatibilityFlags,
      cache: wranglerInventory.cache,
      cachedExports: wranglerInventory.cachedExports,
      kvBindings: wranglerInventory.kvNamespaces.map((entry) => ({ binding: entry.binding, id: entry.id, preview_id: entry.preview_id })),
      r2Bindings: wranglerInventory.r2Buckets.map((entry) => ({ binding: entry.binding, bucket_name: entry.bucket_name, preview_bucket_name: entry.preview_bucket_name })),
      durableObjects: wranglerInventory.durableObjects,
      routes: wranglerInventory.routes
    }
  };

  manifest.warnings.push(...safety.errors);

  if (pathIsWithin(ROOT, outputDir)) {
    manifest.warnings.push('Output directory is inside the repository; do not commit backup artifacts.');
  }
  if (options.kvValues && !options.remote) {
    manifest.warnings.push('--kv-values requires --remote; KV values were not exported.');
  }
  if (options.r2Objects && !options.remote) {
    manifest.warnings.push('--r2-objects requires --remote; R2 objects were not downloaded.');
  }
  if (options.adminExports && !options.remote) {
    manifest.warnings.push('--admin-exports requires --remote; admin exports were not captured.');
  }

  try {
    ensureDir(captureDir, options);
    captureGit(manifest, captureDir, options);
    captureLocalFiles(manifest, captureDir, options);
    captureBuildEvidence(manifest, captureDir, options);
    captureProviderInventory(manifest, captureDir, options, wranglerInventory);
    captureKv(manifest, captureDir, options);
    await captureAdminExports(manifest, captureDir, options);
    await captureR2(manifest, captureDir, options, wranglerInventory);
    writeRestorePlan(captureDir, options);
    manifest.completedAt = new Date().toISOString();
    if (!options.dryRun) {
      manifest.artifacts = buildChecksumManifest(captureDir, {
        exclude: ['manifest.json', 'checksums.json']
      });
      writeJson(path.join(captureDir, 'manifest.json'), manifest, options);
      const checksumArtifacts = buildChecksumManifest(captureDir, {
        exclude: ['checksums.json']
      });
      writeJson(path.join(captureDir, 'checksums.json'), {
        schemaVersion: 1,
        generatedAt: manifest.completedAt,
        artifacts: checksumArtifacts
      }, options);
      enforcePrivatePermissions(captureDir);
      if (safety.sensitive) return archiveSensitiveSnapshot(captureDir, outputDir, options, manifest);
    }
    return manifest;
  } catch (error) {
    if (safety.sensitive && !options.dryRun) fs.rmSync(captureDir, { recursive: true, force: true });
    throw error;
  }
}

export function backupCompletionDetails(manifest = {}) {
  return {
    destination: String(manifest.outputDir || manifest.outputName || 'configured destination'),
    warningCount: Array.isArray(manifest.warnings)
      ? manifest.warnings.length
      : Number(manifest.warningCount || 0)
  };
}

async function main() {
  const options = parseBackupArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const manifest = await createBackupSnapshot(options);
  if (options.dryRun) {
    console.log(`Dry-run backup plan for ${manifest.outputDir}`);
    for (const command of manifest.commands) {
      console.log(`[plan] ${command.label}: ${command.command} ${command.args.join(' ')}`);
    }
    for (const warning of manifest.warnings) {
      console.log(`[warn] ${warning}`);
    }
  } else {
    const completion = backupCompletionDetails(manifest);
    console.log(`Store backup snapshot written to ${completion.destination}`);
    if (completion.warningCount) {
      console.log(`Warnings: ${completion.warningCount}`);
    }
  }
  if (options.json) {
    console.log(JSON.stringify(manifest, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

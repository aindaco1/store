#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = path.join(ROOT, 'worker');
const WRANGLER_PATH = path.join(WORKER_DIR, 'wrangler.toml');
const DEV_VARS_PATH = path.join(WORKER_DIR, '.dev.vars');

export const KV_BACKUP_PREFIXES = [
  'orders:',
  'admin-store-orders:index:v1',
  'store-inventory-overrides:v1',
  'store-inventory:v1:',
  'store-coupons:v1',
  'add-on-inventory-overrides',
  'add-on-inventory-sold:v1',
  'admin-users:v1',
  'admin-user:',
  'admin-audit:',
  'store-order-email:',
  'store-order-email-sent:',
  'admin-store-marketing-referrals:v1',
  'abandoned-cart:',
  'abandoned-cart-sent:',
  'abandoned-cart-suppressed:',
  'abandoned-cart-queue:v1',
  'abandoned-cart-health:v1',
  'store-event-reminder:',
  'store-event-reminder-sent:',
  'store-event-reminder-queue:v1'
];

export const KV_QUARANTINE_PREFIXES = [
  'admin-session:',
  'admin-login:',
  'rl:',
  'store-order-lookup:',
  'abandoned-cart-resume:',
  'cron:lastRun',
  'cron:lastError',
  'cron:lastAbandonedCartRun',
  'cron:lastEventReminderRun',
  'observability:'
];

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
  --skip-git-bundle     Skip git bundle creation.
  --skip-file-copy      Skip copying selected config/build files into the snapshot.
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
    skipGitBundle: args.includes('--skip-git-bundle'),
    skipFileCopy: args.includes('--skip-file-copy'),
    dryRun: args.includes('--dry-run'),
    json: args.includes('--json')
  };
}

function commandName(name) {
  return process.platform === 'win32' && ['npm', 'npx'].includes(name) ? `${name}.cmd` : name;
}

function run(command, args = [], options = {}) {
  const result = spawnSync(commandName(command), args, {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    input: options.input || '',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    env: process.env
  });
  return {
    command,
    args,
    cwd: options.cwd || ROOT,
    status: result.status ?? 1,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ? result.error.message : ''
  };
}

function commandAvailable(command) {
  const result = spawnSync(commandName(command), ['--version'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });
  return !result.error && result.status === 0;
}

function ensureDir(dirPath, options = {}) {
  if (options.dryRun) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath, content, options = {}) {
  if (options.dryRun) return;
  ensureDir(path.dirname(filePath), options);
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, data, options = {}) {
  writeText(filePath, `${JSON.stringify(data, null, 2)}\n`, options);
}

function copyIfExists(root, relativePath, outputDir, options = {}) {
  const source = path.join(root, relativePath);
  if (!fs.existsSync(source)) return false;
  const target = path.join(outputDir, relativePath);
  if (!options.dryRun) {
    ensureDir(path.dirname(target), options);
    fs.copyFileSync(source, target);
  }
  return true;
}

function safeName(value) {
  return String(value || 'item').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
}

function parseTomlStringValue(line) {
  const match = String(line || '').match(/^([A-Za-z0-9_]+)\s*=\s*"(.*)"\s*$/);
  return match ? [match[1], match[2].replace(/\\"/g, '"')] : null;
}

export function parseWranglerTomlInventory(content = '') {
  const inventory = {
    name: '',
    compatibilityDate: '',
    compatibilityFlags: [],
    cache: { enabled: false, crossVersionCache: false },
    cachedExports: [],
    vars: {},
    kvNamespaces: [],
    r2Buckets: [],
    durableObjects: []
  };
  let section = '';
  let block = null;
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const arraySection = line.match(/^\[\[([A-Za-z0-9_.-]+)\]\]$/);
    if (arraySection) {
      section = arraySection[1];
      block = {};
      if (section === 'kv_namespaces') inventory.kvNamespaces.push(block);
      if (section === 'r2_buckets') inventory.r2Buckets.push(block);
      if (section === 'durable_objects.bindings') inventory.durableObjects.push(block);
      continue;
    }

    const namedSection = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (namedSection) {
      section = namedSection[1];
      block = null;
      continue;
    }

    const pair = parseTomlStringValue(line);
    if (pair) {
      const [key, value] = pair;
      if (!section) {
        if (key === 'name') inventory.name = value;
        if (key === 'compatibility_date') inventory.compatibilityDate = value;
      } else if (section === 'vars') {
        inventory.vars[key] = value;
      } else if (block) {
        block[key] = value;
      }
      continue;
    }

    if (!section && line.startsWith('compatibility_flags')) {
      inventory.compatibilityFlags = Array.from(line.matchAll(/"([^"]+)"/g)).map((match) => match[1]);
    }
    if (section === 'cache' && /^enabled\s*=/.test(line)) {
      inventory.cache.enabled = /\btrue\b/i.test(line);
    }
    if (section === 'cache' && /^cross_version_cache\s*=/.test(line)) {
      inventory.cache.crossVersionCache = /\btrue\b/i.test(line);
    }
    const exportCache = section.match(/^exports\.([A-Za-z0-9_]+)\.cache$/);
    if (exportCache && /^enabled\s*=\s*true\b/i.test(line)) {
      inventory.cachedExports.push(exportCache[1]);
    }
  }
  return inventory;
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

export function buildKvBackupPlan(prefixes = KV_BACKUP_PREFIXES, { binding = 'STORE_STATE', includeValues = false } = {}) {
  return prefixes.map((prefix) => {
    const safePrefix = safeName(prefix);
    const keysFile = `kv/${safePrefix}.keys.json`;
    const valuesFile = `kv/${safePrefix}.values.json`;
    return {
      prefix,
      binding,
      keysFile,
      valuesFile: includeValues ? valuesFile : '',
      commands: [
        ['npx', ['wrangler', 'kv', 'key', 'list', '--remote', '--binding', binding, '--prefix', prefix]],
        ...(includeValues ? [['npx', ['wrangler', 'kv', 'bulk', 'get', keysFile, '--remote', '--binding', binding]]] : [])
      ]
    };
  });
}

export function transformKvBulkGetToPutRecords(values = {}) {
  return Object.entries(values || {}).map(([key, entry]) => ({
    key,
    value: String(entry?.value ?? ''),
    ...(entry?.metadata ? { metadata: entry.metadata } : {})
  }));
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
  const plan = buildKvBackupPlan(KV_BACKUP_PREFIXES, { includeValues: options.kvValues });
  writeJson(path.join(kvDir, 'classification.json'), {
    authoritativePrefixes: KV_BACKUP_PREFIXES,
    quarantinePrefixes: KV_QUARANTINE_PREFIXES,
    durableObjectRestore: 'derived_state_only'
  }, options);
  writeJson(path.join(kvDir, 'plan.json'), plan, options);

  if (!options.remote) return;
  for (const item of plan) {
    const keysFile = path.join(outputDir, item.keysFile);
    captureCommand(manifest, `kv keys ${item.prefix}`, 'npx', item.commands[0][1], {
      ...options,
      cwd: WORKER_DIR,
      stdoutFile: keysFile
    });
    if (options.kvValues && item.valuesFile) {
      captureCommand(manifest, `kv values ${item.prefix}`, 'npx', ['wrangler', 'kv', 'bulk', 'get', keysFile, '--remote', '--binding', item.binding], {
        ...options,
        cwd: WORKER_DIR,
        stdoutFile: path.join(outputDir, item.valuesFile)
      });
    }
  }
}

function captureR2(manifest, outputDir, options, wranglerInventory) {
  const r2Dir = path.join(outputDir, 'r2');
  ensureDir(r2Dir, options);
  const downloadKeys = discoverDownloadKeys(ROOT);
  writeText(path.join(r2Dir, 'download-keys.txt'), `${downloadKeys.join('\n')}${downloadKeys.length ? '\n' : ''}`, options);
  const bucket = wranglerInventory.r2Buckets.find((entry) => entry.binding === 'STORE_DOWNLOADS')?.bucket_name || 'store-downloads';
  manifest.r2 = { bucket, referencedDownloadObjects: downloadKeys.length, objectsDownloaded: false };
  if (!options.remote || !options.r2Objects) return;
  for (const key of downloadKeys) {
    const target = path.join(r2Dir, 'objects', key);
    captureCommand(manifest, `r2 object ${key}`, 'npx', ['wrangler', 'r2', 'object', 'get', `${bucket}/${key}`, '--remote', '--file', target], {
      ...options,
      cwd: WORKER_DIR
    });
  }
  manifest.r2.objectsDownloaded = true;
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

export async function createBackupSnapshot(rawOptions = {}) {
  const options = {
    output: rawOptions.output || path.join(os.homedir(), 'store-backups', utcTimestamp()),
    remote: rawOptions.remote === true,
    kvValues: rawOptions.kvValues === true,
    r2Objects: rawOptions.r2Objects === true,
    skipGitBundle: rawOptions.skipGitBundle === true,
    skipFileCopy: rawOptions.skipFileCopy === true,
    dryRun: rawOptions.dryRun === true
  };
  const outputDir = path.resolve(options.output);
  const wranglerContent = fs.existsSync(WRANGLER_PATH) ? fs.readFileSync(WRANGLER_PATH, 'utf8') : '';
  const wranglerInventory = parseWranglerTomlInventory(wranglerContent);
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    repoRoot: ROOT,
    outputDir,
    dryRun: options.dryRun,
    remote: options.remote,
    includesKvValues: options.remote && options.kvValues,
    includesR2Objects: options.remote && options.r2Objects,
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
      r2Bindings: wranglerInventory.r2Buckets.map((entry) => ({ binding: entry.binding, bucket_name: entry.bucket_name, preview_bucket_name: entry.preview_bucket_name }))
    }
  };

  if (outputDir.startsWith(`${ROOT}${path.sep}`)) {
    manifest.warnings.push('Output directory is inside the repository; do not commit backup artifacts.');
  }
  if (options.kvValues && !options.remote) {
    manifest.warnings.push('--kv-values requires --remote; KV values were not exported.');
  }
  if (options.r2Objects && !options.remote) {
    manifest.warnings.push('--r2-objects requires --remote; R2 objects were not downloaded.');
  }

  ensureDir(outputDir, options);
  captureGit(manifest, outputDir, options);
  captureLocalFiles(manifest, outputDir, options);
  captureProviderInventory(manifest, outputDir, options, wranglerInventory);
  captureKv(manifest, outputDir, options);
  captureR2(manifest, outputDir, options, wranglerInventory);
  writeRestorePlan(outputDir, options);
  writeJson(path.join(outputDir, 'manifest.json'), manifest, options);
  return manifest;
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
    console.log(`Store backup snapshot written to ${manifest.outputDir}`);
    if (manifest.warnings.length) {
      console.log(`Warnings: ${manifest.warnings.length}`);
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

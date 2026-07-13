#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { commandAvailable, runCommand } from './lib/command-runner.mjs';
import { stripeCliAuthState } from './lib/stripe-cli-auth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = path.join(ROOT, 'worker');
const WRANGLER_PATH = path.join(WORKER_DIR, 'wrangler.toml');
const DEV_VARS_PATH = path.join(WORKER_DIR, '.dev.vars');
const DEV_VARS_EXAMPLE_PATH = path.join(WORKER_DIR, '.dev.vars.example');

const args = process.argv.slice(2);
const hasArg = (name) => args.includes(name);
const valueArg = (name, fallback = '') => {
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const options = {
  mode: valueArg('--mode', 'all'),
  dryRun: hasArg('--dry-run'),
  yes: hasArg('--yes'),
  nonInteractive: hasArg('--non-interactive'),
  skipAuth: hasArg('--skip-auth'),
  skipKv: hasArg('--skip-kv'),
  skipSecrets: hasArg('--skip-secrets'),
  skipGithub: hasArg('--skip-github'),
  skipReadiness: hasArg('--skip-readiness'),
  deploy: hasArg('--deploy'),
  help: hasArg('--help') || hasArg('-h')
};

const MODES = new Set(['local', 'production', 'all']);
const REQUIRED_COMMANDS = ['node', 'npm', 'git', 'npx'];
const PRODUCTION_COMMANDS = ['gh'];
const KV_BINDINGS = ['STORE_STATE', 'RATELIMIT'];
const LOCAL_GENERATED_SECRETS = [
  'ADMIN_SECRET',
  'ADMIN_SESSION_SECRET',
  'CHECKOUT_INTENT_SECRET',
  'MAGIC_LINK_SECRET',
  'STORE_DOWNLOAD_SECRET',
  'WORKERS_CACHE_PURGE_SECRET',
  'WORKERS_CACHE_EVIDENCE_SECRET'
];
const LOCAL_OPTIONAL_SECRETS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_SECRET_KEY_LIVE',
  'STRIPE_SECRET_KEY_TEST',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_WEBHOOK_SECRET_LIVE',
  'STRIPE_WEBHOOK_SECRET_TEST',
  'FILM_STRIPE_SUMMARY_ADAPTER_SECRET',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'TURNSTILE_SECRET_KEY',
  'ADMIN_TURNSTILE_SECRET_KEY',
  'STORE_ORDER_TURNSTILE_SECRET_KEY',
  'USPS_CLIENT_SECRET',
  'ZIP_TAX_API_KEY',
  'TAX_API_KEY',
  'GITHUB_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID'
];
const WORKER_SECRETS = [
  { name: 'STRIPE_SECRET_KEY', label: 'Stripe live or default secret key', required: true },
  { name: 'STRIPE_SECRET_KEY_LIVE', label: 'Stripe live secret key', required: false },
  { name: 'STRIPE_SECRET_KEY_TEST', label: 'Stripe test secret key', required: false },
  { name: 'STRIPE_WEBHOOK_SECRET', label: 'Stripe webhook signing secret', required: true },
  { name: 'STRIPE_WEBHOOK_SECRET_LIVE', label: 'Stripe live webhook signing secret', required: false },
  { name: 'STRIPE_WEBHOOK_SECRET_TEST', label: 'Stripe test webhook signing secret', required: false },
  { name: 'FILM_STRIPE_SUMMARY_ADAPTER_SECRET', label: 'Film Stripe summary adapter bearer secret', required: false },
  { name: 'RESEND_API_KEY', label: 'Resend API key', required: true },
  { name: 'RESEND_WEBHOOK_SECRET', label: 'Resend delivery webhook signing secret', required: false },
  { name: 'ADMIN_SECRET', label: 'Admin automation secret', required: true, generate: true },
  { name: 'ADMIN_SESSION_SECRET', label: 'Browser admin session secret', required: true, generate: true },
  { name: 'CHECKOUT_INTENT_SECRET', label: 'Checkout intent HMAC secret', required: true, generate: true },
  { name: 'MAGIC_LINK_SECRET', label: 'Admin/order magic-link HMAC secret', required: true, generate: true },
  { name: 'STORE_DOWNLOAD_SECRET', label: 'Signed download and fulfillment link secret', required: false, generate: true },
  { name: 'WORKERS_CACHE_PURGE_SECRET', label: 'Workers Cache deploy purge bearer secret', required: false, generate: true },
  { name: 'WORKERS_CACHE_EVIDENCE_SECRET', label: 'Workers Cache read-only scheduled evidence bearer secret', required: false, generate: true },
  { name: 'TURNSTILE_SECRET_KEY', label: 'Cloudflare Turnstile secret key', required: true },
  { name: 'ADMIN_TURNSTILE_SECRET_KEY', label: 'Admin-specific Turnstile secret key', required: false },
  { name: 'STORE_ORDER_TURNSTILE_SECRET_KEY', label: 'Store order lookup Turnstile secret key', required: false },
  { name: 'USPS_CLIENT_SECRET', label: 'USPS OAuth client secret', required: false },
  { name: 'ZIP_TAX_API_KEY', label: 'ZIP.TAX API key', required: false },
  { name: 'TAX_API_KEY', label: 'Alternate tax provider API key', required: false },
  { name: 'GITHUB_TOKEN', label: 'GitHub PAT for Worker-triggered rebuilds/publishing', required: false }
];
const GITHUB_SECRETS = [
  { name: 'CLOUDFLARE_API_TOKEN', label: 'Cloudflare Workers deploy API token', required: true },
  { name: 'CLOUDFLARE_ACCOUNT_ID', label: 'Cloudflare account ID', required: true },
  { name: 'WORKERS_CACHE_PURGE_SECRET', label: 'Workers Cache deploy purge bearer secret (must match Worker secret)', required: false },
  { name: 'WORKERS_CACHE_EVIDENCE_SECRET', label: 'Workers Cache scheduled evidence bearer secret (must match Worker secret)', required: false },
  { name: 'CLOUDFLARE_ANALYTICS_API_TOKEN', label: 'Cloudflare Account Analytics Read token', required: false },
  { name: 'CLOUDFLARE_CACHE_PURGE_TOKEN', label: 'Cloudflare cache purge token (defaults to deploy token if skipped)', required: false }
];

function printHelp() {
  console.log(`Usage: node scripts/setup-deploy.mjs [options]

Modes:
  --mode=local          Configure local dependencies and worker/.dev.vars
  --mode=production     Configure Cloudflare/GitHub deployment surfaces
  --mode=all            Run local then production setup (default)

Options:
  --dry-run             Print planned commands and file changes without applying them
  --yes                 Accept prompts that have a safe default
  --non-interactive     Do not prompt; generate local secrets and skip missing provider secrets
  --skip-auth           Skip gh/wrangler/stripe auth checks
  --skip-kv             Skip Cloudflare KV namespace creation/update
  --skip-secrets        Skip Worker and GitHub secret writes
  --skip-github         Skip GitHub repo-secret setup
  --skip-readiness      Skip read-only provider readiness checks
  --deploy              Run wrangler deploy after production setup
  -h, --help            Show this help

Examples:
  node scripts/setup-deploy.mjs --mode=local
  node scripts/setup-deploy.mjs --mode=production --dry-run
  node scripts/setup-deploy.mjs --mode=all --deploy
`);
}

function logStep(message) {
  console.log(`\n==> ${message}`);
}

function logInfo(message) {
  console.log(`  ${message}`);
}

function mask(value) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= 8) return '********';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function run(command, runArgs = [], { cwd = ROOT, input = '', allowFailure = false, capture = true, secretInput = false, dryRunExec = false } = {}) {
  const printable = [command, ...runArgs].join(' ');
  if (options.dryRun && !dryRunExec) {
    logInfo(`[dry-run] ${printable}${input ? ` < ${secretInput ? '[secret]' : JSON.stringify(input)}` : ''}`);
    return { status: 0, stdout: '', stderr: '' };
  }

  const result = runCommand(command, runArgs, {
    cwd,
    input,
    capture
  });
  if (result.error && !allowFailure) {
    throw new Error(result.error);
  }
  if (result.status !== 0 && !allowFailure) {
    const stderr = String(result.stderr || '').trim();
    throw new Error(`${printable} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return {
    status: result.status || 0,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '')
  };
}

function ensureCommands(commands, { required = true } = {}) {
  for (const command of commands) {
    if (commandAvailable(command)) {
      logInfo(`${command} available`);
      continue;
    }
    const message = `${command} is not installed or not on PATH`;
    if (required) throw new Error(message);
    logInfo(`${message}; skipping related setup`);
  }
}

function randomSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const values = new Map();
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function writeEnvValues(filePath, updates) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').split(/\r?\n/) : [];
  const seen = new Set();
  const next = existing.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !Object.prototype.hasOwnProperty.call(updates, match[1])) return line;
    seen.add(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });

  const missing = Object.entries(updates)
    .filter(([key]) => !seen.has(key))
    .map(([key, value]) => `${key}=${value}`);
  const content = [...next.filter((line, index) => line || index < next.length - 1), ...missing].join('\n').replace(/\n{3,}/g, '\n\n');

  if (options.dryRun) {
    logInfo(`[dry-run] update ${path.relative(ROOT, filePath)}: ${Object.keys(updates).join(', ')}`);
    return;
  }
  fs.writeFileSync(filePath, `${content.trim()}\n`, 'utf8');
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows and some network filesystems may not support chmod; the file is gitignored.
  }
}

function ensureDevVarsFile() {
  if (fs.existsSync(DEV_VARS_PATH)) return;
  if (options.dryRun) {
    logInfo(`[dry-run] create ${path.relative(ROOT, DEV_VARS_PATH)}`);
    return;
  }
  if (fs.existsSync(DEV_VARS_EXAMPLE_PATH)) {
    fs.copyFileSync(DEV_VARS_EXAMPLE_PATH, DEV_VARS_PATH);
  } else {
    fs.writeFileSync(DEV_VARS_PATH, '', 'utf8');
  }
  try {
    fs.chmodSync(DEV_VARS_PATH, 0o600);
  } catch {}
}

function createPrompt() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

async function ask(rl, question, { secret = false, defaultValue = '', required = false, generate = false } = {}) {
  if (options.nonInteractive) {
    if (defaultValue) return defaultValue;
    if (generate) return randomSecret();
    return '';
  }

  if (options.yes && generate) return defaultValue || randomSecret();
  const suffix = defaultValue ? ` [${secret ? mask(defaultValue) : defaultValue}]` : (required ? ' [required]' : ' [skip]');
  const prompt = `${question}${suffix}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      const value = answer.trim() || defaultValue || (generate ? randomSecret() : '');
      resolve(value);
    });
  });
}

async function collectSecretValues(secretSpecs, existing = new Map()) {
  const rl = createPrompt();
  const values = {};
  try {
    for (const spec of secretSpecs) {
      const current = existing.get(spec.name) || '';
      if (current) {
        logInfo(`${spec.name} already configured locally (${mask(current)})`);
        values[spec.name] = current;
        continue;
      }
      const generated = spec.generate ? randomSecret() : '';
      const value = await ask(rl, `${spec.label} (${spec.name})`, {
        secret: true,
        required: spec.required,
        generate: spec.generate,
        defaultValue: generated
      });
      if (!value && spec.required && !options.nonInteractive) {
        throw new Error(`${spec.name} is required`);
      }
      if (value) values[spec.name] = value;
    }
  } finally {
    rl.close();
  }
  return values;
}

function syncWorkerConfig() {
  logStep('Sync Worker config from Jekyll config');
  run('ruby', ['scripts/sync-worker-config.rb'], { cwd: ROOT, capture: false });
}

function configureLocal() {
  logStep('Check local toolchain');
  ensureCommands(REQUIRED_COMMANDS);

  logStep('Install npm dependencies');
  run('npm', ['install'], { cwd: ROOT, capture: false });
  run('npm', ['--prefix', 'worker', 'install'], { cwd: ROOT, capture: false });

  syncWorkerConfig();

  logStep('Configure local Worker secrets');
  ensureDevVarsFile();
  const existing = parseEnvFile(DEV_VARS_PATH);
  const updates = {};
  for (const key of LOCAL_GENERATED_SECRETS) {
    if (!existing.get(key)) updates[key] = randomSecret();
  }
  for (const key of LOCAL_OPTIONAL_SECRETS) {
    if (!existing.get(key)) updates[key] = existing.get(key) || '';
  }
  const filtered = Object.fromEntries(Object.entries(updates).filter(([, value]) => value));
  if (Object.keys(filtered).length) {
    writeEnvValues(DEV_VARS_PATH, filtered);
  } else {
    logInfo('worker/.dev.vars already has local generated secrets');
  }
  logInfo('Local setup preserves provider secrets unless you enter them separately.');
}

function ensureAuth() {
  if (options.skipAuth) {
    logInfo('Auth checks skipped');
    return;
  }

  logStep('Authenticate CLIs');
  ensureCommands(PRODUCTION_COMMANDS);

  const ghStatus = run('gh', ['auth', 'status'], { allowFailure: true });
  if (ghStatus.status !== 0) {
    run('gh', ['auth', 'login'], { capture: false });
  } else {
    logInfo('gh authenticated');
  }

  const wranglerStatus = run('npx', ['wrangler', 'whoami'], { cwd: WORKER_DIR, allowFailure: true });
  if (wranglerStatus.status !== 0) {
    run('npx', ['wrangler', 'login'], { cwd: WORKER_DIR, capture: false });
  } else {
    logInfo('wrangler authenticated');
  }

  if (commandAvailable('stripe')) {
    const stripeStatus = run('stripe', ['whoami'], { allowFailure: true });
    if (stripeStatus.status !== 0) {
      run('stripe', ['login'], { capture: false });
    } else {
      logInfo('stripe authenticated');
    }
  } else {
    logInfo('stripe CLI not found; skipping optional Stripe auth helper');
  }
}

function parseNamespaceId(output) {
  const text = String(output || '');
  try {
    const parsed = JSON.parse(text);
    return parsed?.id || parsed?.result?.id || '';
  } catch {}
  const match = text.match(/id\s*=\s*"([^"]+)"/) || text.match(/"id"\s*:\s*"([^"]+)"/) || text.match(/Created namespace.*?([a-f0-9]{32})/i);
  return match?.[1] || '';
}

function readWranglerKvBindings() {
  if (!fs.existsSync(WRANGLER_PATH)) return new Map();
  const bindings = new Map();
  const lines = fs.readFileSync(WRANGLER_PATH, 'utf8').split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    if (/^\s*\[\[(?:env\.dev\.)?kv_namespaces\]\]\s*$/.test(line)) {
      if (current?.name) bindings.set(current.name, { ...(bindings.get(current.name) || {}), ...current });
      current = {};
      continue;
    }
    if (/^\s*\[\[/.test(line) && !/^\s*\[\[(?:env\.dev\.)?kv_namespaces\]\]\s*$/.test(line)) {
      if (current?.name) bindings.set(current.name, { ...(bindings.get(current.name) || {}), ...current });
      current = null;
      continue;
    }
    if (!current) continue;
    const match = line.match(/^\s*(name|binding|id|preview_id)\s*=\s*"([^"]*)"/);
    if (match) current[match[1] === 'binding' ? 'name' : match[1]] = match[2];
  }
  if (current?.name) bindings.set(current.name, { ...(bindings.get(current.name) || {}), ...current });
  return bindings;
}

function parseJsonArrayOutput(output) {
  const text = String(output || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.result)) return parsed.result;
  } catch {}
  return [];
}

function listCloudflareKvNamespaces() {
  const result = run('npx', ['wrangler', 'kv', 'namespace', 'list', '--json'], {
    cwd: WORKER_DIR,
    allowFailure: true,
    dryRunExec: true
  });
  if (result.status !== 0) {
    const fallback = run('npx', ['wrangler', 'kv:namespace', 'list', '--json'], {
      cwd: WORKER_DIR,
      allowFailure: true,
      dryRunExec: true
    });
    if (fallback.status !== 0) {
      logInfo('Unable to list Cloudflare KV namespaces; creation/reuse will rely on wrangler.toml and explicit create commands.');
      return [];
    }
    return parseJsonArrayOutput(fallback.stdout);
  }
  return parseJsonArrayOutput(result.stdout);
}

function namespaceTitle(namespace) {
  return String(namespace?.title || namespace?.name || namespace?.binding || '').trim();
}

function findExistingNamespace(namespaces, binding, preview = false) {
  const expected = preview
    ? new Set([`${binding}_preview`, `${binding}-preview`, `${binding} preview`].map((value) => value.toLowerCase()))
    : new Set([binding.toLowerCase()]);
  return (namespaces || []).find((namespace) => {
    const title = namespaceTitle(namespace).toLowerCase();
    return expected.has(title);
  }) || null;
}

function updateWranglerKv(binding, ids) {
  if (!fs.existsSync(WRANGLER_PATH)) throw new Error('worker/wrangler.toml not found');
  const original = fs.readFileSync(WRANGLER_PATH, 'utf8');
  const lines = original.split(/\r?\n/);
  let inKvBlock = false;
  let blockBinding = '';
  const next = lines.map((line) => {
    if (/^\s*\[\[(?:env\.dev\.)?kv_namespaces\]\]\s*$/.test(line)) {
      inKvBlock = true;
      blockBinding = '';
      return line;
    }
    if (/^\s*\[\[/.test(line) && !/^\s*\[\[(?:env\.dev\.)?kv_namespaces\]\]\s*$/.test(line)) {
      inKvBlock = false;
      blockBinding = '';
      return line;
    }
    if (!inKvBlock) return line;
    const nameMatch = line.match(/^\s*(?:binding|name)\s*=\s*"([^"]+)"/);
    if (nameMatch) {
      blockBinding = nameMatch[1];
      return line;
    }
    if (blockBinding !== binding) return line;
    if (ids.id && /^\s*id\s*=/.test(line)) return `id = "${ids.id}"`;
    if (ids.preview_id && /^\s*preview_id\s*=/.test(line)) return `preview_id = "${ids.preview_id}"`;
    return line;
  });

  if (options.dryRun) {
    logInfo(`[dry-run] update worker/wrangler.toml KV ${binding}: id=${ids.id || '(unchanged)'} preview_id=${ids.preview_id || '(unchanged)'}`);
    return;
  }
  fs.writeFileSync(WRANGLER_PATH, next.join('\n'), 'utf8');
}

function createKvNamespace(binding, preview = false) {
  const wranglerArgs = ['wrangler', 'kv', 'namespace', 'create', binding, '--json'];
  if (preview) wranglerArgs.push('--preview');
  const result = run('npx', wranglerArgs, { cwd: WORKER_DIR, allowFailure: true });
  if (result.status !== 0) {
    const fallbackArgs = ['wrangler', 'kv:namespace', 'create', binding];
    if (preview) fallbackArgs.push('--preview');
    const fallback = run('npx', fallbackArgs, { cwd: WORKER_DIR, allowFailure: true });
    const fallbackId = parseNamespaceId(`${fallback.stdout}\n${fallback.stderr}`);
    if (fallback.status !== 0 || !fallbackId) {
      throw new Error(`Unable to create ${preview ? 'preview ' : ''}${binding} KV namespace`);
    }
    return fallbackId;
  }
  const id = parseNamespaceId(result.stdout);
  if (!id && !options.dryRun) throw new Error(`Could not parse ${binding} namespace ID from wrangler output`);
  return id || `${binding.toLowerCase()}_${preview ? 'preview_' : ''}id`;
}

function configureKvNamespaces() {
  if (options.skipKv) {
    logInfo('KV setup skipped');
    return;
  }

  logStep('Create/update Cloudflare KV namespaces');
  const configuredBindings = readWranglerKvBindings();
  const discoveredNamespaces = listCloudflareKvNamespaces();
  for (const binding of KV_BINDINGS) {
    const configured = configuredBindings.get(binding) || {};
    const existing = findExistingNamespace(discoveredNamespaces, binding, false);
    const existingPreview = findExistingNamespace(discoveredNamespaces, binding, true);
    let id = String(existing?.id || configured.id || '').trim();
    let previewId = String(existingPreview?.id || configured.preview_id || '').trim();

    if (id) {
      logInfo(`${binding}: reusing existing namespace ${id}`);
    } else {
      id = createKvNamespace(binding, false);
      logInfo(`${binding}: planned/created namespace ${id}`);
    }

    if (previewId) {
      logInfo(`${binding}: reusing existing preview namespace ${previewId}`);
    } else {
      previewId = createKvNamespace(binding, true);
      logInfo(`${binding}: planned/created preview namespace ${previewId}`);
    }

    updateWranglerKv(binding, { id, preview_id: previewId });
    logInfo(`${binding}: ${id} / preview ${previewId}`);
  }
}

function readinessStatus(label, ok, detail = '') {
  logInfo(`${ok ? 'OK' : 'Check'}: ${label}${detail ? ` — ${detail}` : ''}`);
}

async function fetchJsonReadiness(url, { headers = {} } = {}) {
  try {
    const response = await fetch(url, { headers });
    let body = null;
    try {
      body = await response.json();
    } catch {}
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || 'request failed' };
  }
}

function readinessEnv(name) {
  return String(process.env[name] || '').trim();
}

async function runReadinessChecks() {
  if (options.skipReadiness) {
    logInfo('Readiness checks skipped');
    return;
  }

  logStep('Run read-only provider readiness checks');

  const ghRepo = run('gh', ['repo', 'view', '--json', 'nameWithOwner,url'], {
    cwd: ROOT,
    allowFailure: true,
    dryRunExec: true
  });
  readinessStatus('GitHub repository access', ghRepo.status === 0, ghRepo.status === 0 ? 'repo metadata is readable' : 'run gh auth login or check repo access');

  const githubSecrets = run('gh', ['secret', 'list'], {
    cwd: ROOT,
    allowFailure: true,
    dryRunExec: true
  });
  readinessStatus('GitHub repository secrets access', githubSecrets.status === 0, githubSecrets.status === 0 ? 'secret names are listable' : 'manual secret review may be required');

  const wranglerWhoami = run('npx', ['wrangler', 'whoami'], {
    cwd: WORKER_DIR,
    allowFailure: true,
    dryRunExec: true
  });
  readinessStatus('Cloudflare Wrangler account access', wranglerWhoami.status === 0, wranglerWhoami.status === 0 ? 'wrangler can read account identity' : 'run wrangler login');

  const kvNamespaces = listCloudflareKvNamespaces();
  readinessStatus('Cloudflare KV namespace discovery', kvNamespaces.length > 0, kvNamespaces.length ? `${kvNamespaces.length} namespace(s) visible` : 'no namespaces visible yet or listing failed');

  const stripeAuth = stripeCliAuthState({
    cwd: ROOT,
    commandAvailableFn: commandAvailable,
    runCommandFn: (command, commandArgs, commandOptions) => run(command, commandArgs, {
      ...commandOptions,
      allowFailure: true,
      dryRunExec: true
    })
  });
  if (stripeAuth.authenticated) {
    const stripeWebhooks = run('stripe', ['webhook_endpoints', 'list', '--limit', '10'], {
      cwd: ROOT,
      allowFailure: true,
      dryRunExec: true
    });
    readinessStatus('Stripe webhook endpoint access', stripeWebhooks.status === 0, stripeWebhooks.status === 0 ? 'webhook endpoints are readable' : 'run stripe login or configure webhook manually');
  } else {
    readinessStatus('Stripe CLI webhook check', false, `${stripeAuth.reason}; verify webhook endpoint manually`);
  }

  const resendKey = readinessEnv('RESEND_API_KEY');
  if (resendKey) {
    const resend = await fetchJsonReadiness('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${resendKey}` }
    });
    readinessStatus('Resend domain access', resend.ok, resend.ok ? 'domains endpoint is readable' : `status ${resend.status || 'unavailable'}`);
  } else {
    readinessStatus('Resend domain access', false, 'set RESEND_API_KEY in the shell for a live readiness check, or verify sender/domain manually');
  }

  readinessStatus('Turnstile widgets', false, 'Cloudflare Turnstile widget discovery requires dashboard/API-token context; verify site key and Worker secret manually');

  const uspsSecret = readinessEnv('USPS_CLIENT_SECRET');
  readinessStatus('USPS credentials', Boolean(uspsSecret), uspsSecret ? 'secret present in shell for follow-up quote tests' : 'verify USPS client id/secret manually or with npm run test:usps');

  const zipTaxKey = readinessEnv('ZIP_TAX_API_KEY');
  readinessStatus('ZIP.TAX credentials', Boolean(zipTaxKey), zipTaxKey ? 'API key present in shell' : 'required only when tax.provider is zip_tax');
}

function putWorkerSecret(name, value) {
  if (!value) return;
  run('npx', ['wrangler', 'secret', 'put', name], {
    cwd: WORKER_DIR,
    input: `${value}\n`,
    secretInput: true,
    capture: true
  });
  logInfo(`Worker secret ${name} set (${mask(value)})`);
}

function putGithubSecret(name, value) {
  if (!value) return;
  run('gh', ['secret', 'set', name, '--body', value], {
    cwd: ROOT,
    secretInput: true,
    capture: true
  });
  logInfo(`GitHub secret ${name} set (${mask(value)})`);
}

async function configureSecrets() {
  if (options.skipSecrets) {
    logInfo('Secret setup skipped');
    return;
  }

  logStep('Configure Cloudflare Worker secrets');
  const workerValues = await collectSecretValues(WORKER_SECRETS);
  for (const [name, value] of Object.entries(workerValues)) {
    putWorkerSecret(name, value);
  }

  if (options.skipGithub) {
    logInfo('GitHub secret setup skipped');
    return;
  }

  logStep('Configure GitHub repository secrets');
  const githubDefaults = new Map();
  if (workerValues.WORKERS_CACHE_PURGE_SECRET) {
    githubDefaults.set('WORKERS_CACHE_PURGE_SECRET', workerValues.WORKERS_CACHE_PURGE_SECRET);
  }
  if (workerValues.WORKERS_CACHE_EVIDENCE_SECRET) {
    githubDefaults.set('WORKERS_CACHE_EVIDENCE_SECRET', workerValues.WORKERS_CACHE_EVIDENCE_SECRET);
  }
  const githubValues = await collectSecretValues(GITHUB_SECRETS, githubDefaults);
  for (const [name, value] of Object.entries(githubValues)) {
    putGithubSecret(name, value);
  }
}

function deployWorkerIfRequested() {
  if (!options.deploy) {
    logInfo('Deploy skipped; pass --deploy to run wrangler deploy');
    return;
  }
  logStep('Deploy Cloudflare Worker');
  run('npx', ['wrangler', 'deploy', '--env', ''], { cwd: WORKER_DIR, capture: false });
}

async function configureProduction() {
  logStep('Check production toolchain');
  ensureCommands([...REQUIRED_COMMANDS, ...PRODUCTION_COMMANDS]);
  ensureAuth();
  syncWorkerConfig();
  await runReadinessChecks();
  configureKvNamespaces();
  await configureSecrets();
  deployWorkerIfRequested();
}

async function main() {
  if (options.help) {
    printHelp();
    return;
  }
  if (!MODES.has(options.mode)) {
    throw new Error(`Unknown --mode=${options.mode}; expected local, production, or all`);
  }
  if (options.dryRun) {
    logInfo('Dry run: no files, Cloudflare resources, GitHub secrets, Worker secrets, or deploys will be changed. Read-only provider checks may still run.');
  }

  if (options.mode === 'local' || options.mode === 'all') {
    configureLocal();
  }
  if (options.mode === 'production' || options.mode === 'all') {
    await configureProduction();
  }

  logStep('Next checks');
  logInfo('Run npm run test:unit for unit coverage.');
  logInfo('Run npm run test:premerge before merging.');
  logInfo('Review docs/MERGE_SMOKE_CHECKLIST.md for live smoke steps.');
}

main().catch((error) => {
  console.error(`\nSetup failed: ${error.message}`);
  process.exit(1);
});

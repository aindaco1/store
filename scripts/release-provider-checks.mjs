#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = path.join(ROOT, 'worker');
const WRANGLER_PATH = path.join(WORKER_DIR, 'wrangler.toml');
const DEV_VARS_PATH = path.join(WORKER_DIR, '.dev.vars');

const args = process.argv.slice(2);
const hasArg = (name) => args.includes(name);
const strict = hasArg('--strict') || process.env.RELEASE_PROVIDER_STRICT === '1';
const noDevVars = hasArg('--no-dev-vars') ||
  process.env.RELEASE_PROVIDER_USE_DEV_VARS === '0' ||
  process.env.RELEASE_USE_DEV_VARS === '0';
const useDevVars = !noDevVars;
const cloudflareDnsOnly = hasArg('--cloudflare-dns-only') ||
  process.env.RELEASE_PROVIDER_CLOUDFLARE_DNS_ONLY === '1';
const help = hasArg('--help') || hasArg('-h');
const CHECK_TIMEOUT_MS = Number(process.env.RELEASE_PROVIDER_TIMEOUT_MS || 10000);

if (help) {
  console.log(`Usage: npm run release:providers -- [options]

Options:
  --strict   Fail on warnings and skipped credential-backed checks.
  --cloudflare-dns-only
             Run only the read-only Cloudflare DNS evidence path. This is for
             GitHub Actions, where production CLOUDFLARE_* secrets are
             injected but unrelated provider secrets may not be available.
  --no-dev-vars
             Do not read worker/.dev.vars. Use this for clean-shell CI probes.
  --help     Show this help.

The provider probe is read-only. It checks public DNS and, when credentials are
exported in the shell or present in worker/.dev.vars, Cloudflare, Stripe webhook
endpoint, Resend sender domain, KV, and R2 readiness. USPS quote smoke may also
use worker/.dev.vars. It never prints secret values.`);
  process.exit(0);
}

const results = [];

function add(status, label, detail = '') {
  results.push({ status, label, detail });
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`${status.padEnd(5)} ${label}${suffix}`);
}

function failOrWarn(label, detail) {
  add(strict ? 'FAIL' : 'WARN', label, detail);
}

function readKeyValueFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const pivot = trimmed.indexOf('=');
    env[trimmed.slice(0, pivot).trim()] = trimmed.slice(pivot + 1).trim();
  }
  return env;
}

const devVars = readKeyValueFile(DEV_VARS_PATH);
function envValue(name) {
  const shellValue = String(process.env[name] || '').trim();
  if (shellValue) return shellValue;
  if (useDevVars) return String(devVars[name] || '').trim();
  return '';
}

function localEnvValue(name) {
  return envValue(name) || String(devVars[name] || '').trim();
}

function parseTomlVars(content, section = '[vars]') {
  const vars = {};
  let active = false;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      active = trimmed === section;
      continue;
    }
    if (!active || !trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*"(.*)"\s*$/);
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

function parseTomlBlocks(content, blockName) {
  const marker = `[[${blockName}]]`;
  const blocks = [];
  let current = null;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === marker) {
      if (current) blocks.push(current);
      current = {};
      continue;
    }
    if (current && trimmed.startsWith('[')) {
      blocks.push(current);
      current = null;
      continue;
    }
    if (!current || !trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*"(.*)"\s*$/);
    if (match) current[match[1]] = match[2];
  }
  if (current) blocks.push(current);
  return blocks;
}

function hostFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

async function fetchJson(url, { headers = {}, method = 'GET', body = null } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });
    let parsed = null;
    try {
      parsed = await response.json();
    } catch {}
    return { ok: response.ok, status: response.status, body: parsed };
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || 'request failed' };
  } finally {
    clearTimeout(timeout);
  }
}

function run(command, commandArgs = [], options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: process.env
  });
}

function parseJsonOutput(text) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch {
    return null;
  }
}

function commandAvailable(command) {
  const result = run(command, ['--version']);
  return result.status === 0 && !result.error;
}

function expectedEmailDomains(vars) {
  const domains = new Set();
  for (const key of ['ORDERS_EMAIL_FROM', 'UPDATES_EMAIL_FROM']) {
    const value = String(vars[key] || envValue(key));
    const match = value.match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
    if (match) domains.add(match[1].toLowerCase());
  }
  return Array.from(domains);
}

function stripeKeyForReadiness() {
  const testKey = envValue('STRIPE_SECRET_KEY_TEST');
  if (testKey) return { key: testKey, mode: 'test' };
  const defaultKey = envValue('STRIPE_SECRET_KEY');
  if (!defaultKey) return { key: '', mode: '' };
  if (defaultKey.startsWith('sk_live_') && envValue('RELEASE_PROVIDER_ALLOW_LIVE_STRIPE') !== '1') {
    return { key: '', mode: 'live-blocked' };
  }
  return { key: defaultKey, mode: defaultKey.startsWith('sk_live_') ? 'live' : 'test' };
}

function stripeAuthHeader(key) {
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

function hasRequiredStripeWebhook(endpoint, workerBase) {
  const requiredEvents = new Set(['payment_intent.succeeded', 'payment_intent.payment_failed']);
  const url = String(endpoint?.url || '').replace(/\/+$/, '');
  const expectedUrl = `${workerBase.replace(/\/+$/, '')}/webhooks/stripe`;
  if (url !== expectedUrl) return false;
  if (endpoint.status && endpoint.status !== 'enabled') return false;
  const enabledEvents = new Set(endpoint.enabled_events || []);
  if (enabledEvents.has('*')) return true;
  return Array.from(requiredEvents).every((event) => enabledEvents.has(event));
}

function findRequiredStripeWebhook(endpoints, workerBase, { livemode = null } = {}) {
  return (endpoints || []).find((entry) => {
    if (livemode !== null && entry?.livemode !== livemode) return false;
    return hasRequiredStripeWebhook(entry, workerBase);
  });
}

async function listStripeWebhooksWithApi(key) {
  const webhooks = await fetchJson('https://api.stripe.com/v1/webhook_endpoints?limit=100', {
    headers: { Authorization: stripeAuthHeader(key) }
  });
  if (!webhooks.ok) {
    return { ok: false, status: webhooks.status, data: [] };
  }
  return { ok: true, status: webhooks.status, data: webhooks.body?.data || [] };
}

function listStripeWebhooksWithCli({ live = false } = {}) {
  if (!commandAvailable('stripe')) return { ok: false, reason: 'stripe CLI not found', data: [] };
  const args = ['webhook_endpoints', 'list', '--limit', '100'];
  if (live) args.push('--live');
  const result = run('stripe', args, { cwd: ROOT });
  if (result.status !== 0) {
    return { ok: false, reason: String(result.stderr || result.stdout || 'stripe CLI failed').trim(), data: [] };
  }
  const parsed = parseJsonOutput(result.stdout);
  if (!parsed) return { ok: false, reason: 'stripe CLI returned non-JSON output', data: [] };
  return { ok: true, data: parsed.data || [] };
}

function listCloudflareKvWithWrangler() {
  const result = run('npx', ['wrangler', 'kv', 'namespace', 'list'], { cwd: WORKER_DIR });
  if (result.status !== 0) {
    return { ok: false, reason: String(result.stderr || result.stdout || 'wrangler kv namespace list failed').trim(), data: [] };
  }
  const parsed = parseJsonOutput(result.stdout);
  if (!Array.isArray(parsed)) return { ok: false, reason: 'wrangler KV list returned non-JSON output', data: [] };
  return { ok: true, data: parsed };
}

function listCloudflareR2WithWrangler() {
  const result = run('npx', ['wrangler', 'r2', 'bucket', 'list'], { cwd: WORKER_DIR });
  if (result.status !== 0) {
    return { ok: false, reason: String(result.stderr || result.stdout || 'wrangler r2 bucket list failed').trim(), data: [] };
  }
  const names = [];
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    const match = line.match(/^name:\s*(.+?)\s*$/);
    if (match) names.push(match[1].trim());
  }
  return { ok: names.length > 0, reason: names.length ? '' : 'wrangler R2 list returned no bucket names', data: names };
}

function configuredKvIds(kvNamespaces) {
  return kvNamespaces.flatMap((entry) => [
    { binding: entry.binding, id: entry.id, kind: 'id' },
    { binding: entry.binding, id: entry.preview_id, kind: 'preview_id' }
  ]).filter((entry) => entry.id);
}

function checkKvVisibility(kvNamespaces, visibleIds) {
  const missing = configuredKvIds(kvNamespaces).filter((entry) => !visibleIds.has(entry.id));
  if (missing.length) {
    add('FAIL', 'Cloudflare KV namespace discovery', `missing configured namespace IDs: ${missing.map((entry) => `${entry.binding || entry.kind}:${entry.kind}`).join(', ')}`);
  } else {
    add('PASS', 'Cloudflare KV namespace discovery', `${configuredKvIds(kvNamespaces).length} configured namespace ID(s) visible`);
  }
}

function checkR2Visibility(r2Buckets, visibleNames) {
  const missing = r2Buckets.filter((entry) => entry.bucket_name && !visibleNames.has(entry.bucket_name));
  if (missing.length) {
    add('FAIL', 'Cloudflare R2 bucket discovery', `missing configured buckets: ${missing.map((entry) => entry.bucket_name).join(', ')}`);
  } else {
    add('PASS', 'Cloudflare R2 bucket discovery', `${r2Buckets.length} configured bucket(s) visible`);
  }
}

function checkGithubDeploySecrets() {
  const required = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ZONE'];
  if (process.env.GITHUB_ACTIONS === 'true') {
    const missing = required.filter((name) => !envValue(name));
    if (missing.length) add('FAIL', 'GitHub deploy secrets', `missing injected secret(s): ${missing.join(', ')}`);
    else add('PASS', 'GitHub deploy secrets', `${required.length} required deploy secret(s) injected`);
    return;
  }
  if (!commandAvailable('gh')) {
    add('SKIP', 'GitHub deploy secrets', 'gh CLI not found');
    return;
  }
  const auth = run('gh', ['auth', 'status'], { cwd: ROOT });
  if (auth.status !== 0) {
    add('SKIP', 'GitHub deploy secrets', 'gh CLI is not authenticated');
    return;
  }
  const secrets = run('gh', ['secret', 'list', '--json', 'name,updatedAt'], { cwd: ROOT });
  if (secrets.status !== 0) {
    add('FAIL', 'GitHub deploy secrets', 'gh secret list failed');
    return;
  }
  const parsed = parseJsonOutput(secrets.stdout);
  const visible = new Set((Array.isArray(parsed) ? parsed : []).map((entry) => String(entry.name || '')));
  const missing = required.filter((name) => !visible.has(name));
  if (missing.length) add('FAIL', 'GitHub deploy secrets', `missing ${missing.join(', ')}`);
  else add('PASS', 'GitHub deploy secrets', `${required.length} required deploy secret name(s) visible`);
}

async function checkDns(host, label) {
  if (!host) {
    add('SKIP', label, 'host is not configured in worker/wrangler.toml');
    return;
  }
  try {
    const results = await dns.lookup(host, { all: true });
    if (results.length) add('PASS', label, `${host} resolves (${results.map((entry) => entry.address).join(', ')})`);
    else failOrWarn(label, `${host} returned no addresses`);
  } catch (error) {
    failOrWarn(label, `${host} did not resolve: ${error?.message || 'DNS lookup failed'}`);
  }
}

async function main() {
  const wranglerContent = fs.existsSync(WRANGLER_PATH) ? fs.readFileSync(WRANGLER_PATH, 'utf8') : '';
  const vars = wranglerContent ? parseTomlVars(wranglerContent) : {};
  const kvNamespaces = wranglerContent ? parseTomlBlocks(wranglerContent, 'kv_namespaces') : [];
  const r2Buckets = wranglerContent ? parseTomlBlocks(wranglerContent, 'r2_buckets') : [];
  const siteBase = vars.SITE_BASE || 'https://shop.dustwave.xyz';
  const workerBase = vars.WORKER_BASE || 'https://checkout.dustwave.xyz';
  const siteHost = hostFromUrl(siteBase);
  const workerHost = hostFromUrl(workerBase);

  console.log('Store release provider checks');
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Strict: ${strict ? 'yes' : 'no'}`);
  console.log(`Dev vars: ${useDevVars ? 'yes' : 'no'}`);
  console.log(`Cloudflare DNS only: ${cloudflareDnsOnly ? 'yes' : 'no'}`);
  console.log('');

  if (!wranglerContent) {
    add('FAIL', 'Worker configuration', 'worker/wrangler.toml is missing');
  } else {
    add('PASS', 'Worker configuration', 'worker/wrangler.toml is readable');
  }

  await checkDns(siteHost, 'Public storefront DNS');
  await checkDns(workerHost, 'Public Worker DNS');
  checkGithubDeploySecrets();

  const cloudflareApiToken = envValue('CLOUDFLARE_API_TOKEN');
  const cloudflareUsageToken = envValue('CLOUDFLARE_USAGE_API_TOKEN');
  const cloudflareToken = cloudflareApiToken || cloudflareUsageToken;
  const cloudflareAccountId = envValue('CLOUDFLARE_ACCOUNT_ID');
  const cloudflareZoneId = envValue('CLOUDFLARE_ZONE_ID') || envValue('CLOUDFLARE_ZONE');
  if (!cloudflareToken) {
    add('SKIP', 'Cloudflare API token verification', 'set CLOUDFLARE_API_TOKEN for a read-only API probe');
  } else {
    const token = await fetchJson('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { Authorization: `Bearer ${cloudflareToken}` }
    });
    if (token.ok && token.body?.success !== false) add('PASS', 'Cloudflare API token verification', 'token is accepted');
    else add('FAIL', 'Cloudflare API token verification', `status ${token.status || 'unavailable'}`);
  }

  if (!cloudflareDnsOnly && cloudflareApiToken && cloudflareAccountId) {
    const namespaceResponse = await fetchJson(`https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/storage/kv/namespaces?per_page=100`, {
      headers: { Authorization: `Bearer ${cloudflareApiToken}` }
    });
    if (!namespaceResponse.ok) {
      add('FAIL', 'Cloudflare KV namespace discovery', `status ${namespaceResponse.status || 'unavailable'}`);
    } else {
      const visibleIds = new Set((namespaceResponse.body?.result || []).map((entry) => String(entry.id || '')));
      checkKvVisibility(kvNamespaces, visibleIds);
    }

    const bucketResponse = await fetchJson(`https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/r2/buckets`, {
      headers: { Authorization: `Bearer ${cloudflareApiToken}` }
    });
    if (!bucketResponse.ok) {
      add('FAIL', 'Cloudflare R2 bucket discovery', `status ${bucketResponse.status || 'unavailable'}`);
    } else {
      const visibleNames = new Set((bucketResponse.body?.result?.buckets || bucketResponse.body?.result || []).map((entry) => String(entry.name || '')));
      checkR2Visibility(r2Buckets, visibleNames);
    }
  } else if (!cloudflareDnsOnly) {
    const kvCli = listCloudflareKvWithWrangler();
    if (kvCli.ok) {
      checkKvVisibility(kvNamespaces, new Set(kvCli.data.map((entry) => String(entry.id || ''))));
    } else {
      add('SKIP', 'Cloudflare KV namespace discovery', `set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or authenticate wrangler (${kvCli.reason})`);
    }

    const r2Cli = listCloudflareR2WithWrangler();
    if (r2Cli.ok) {
      checkR2Visibility(r2Buckets, new Set(r2Cli.data));
    } else {
      add('SKIP', 'Cloudflare R2 bucket discovery', `set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or authenticate wrangler (${r2Cli.reason})`);
    }
  }

  if (cloudflareApiToken && cloudflareZoneId) {
    for (const host of [siteHost, workerHost].filter(Boolean)) {
      const records = await fetchJson(`https://api.cloudflare.com/client/v4/zones/${cloudflareZoneId}/dns_records?name=${encodeURIComponent(host)}&per_page=20`, {
        headers: { Authorization: `Bearer ${cloudflareApiToken}` }
      });
      if (!records.ok) {
        add('FAIL', `Cloudflare DNS record ${host}`, `status ${records.status || 'unavailable'}`);
      } else if ((records.body?.result || []).length > 0) {
        add('PASS', `Cloudflare DNS record ${host}`, `${records.body.result.length} record(s) visible`);
      } else {
        add('FAIL', `Cloudflare DNS record ${host}`, 'no matching record visible');
      }
    }
  } else {
    add('SKIP', 'Cloudflare DNS API records', 'set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE or CLOUDFLARE_ZONE_ID');
  }

  if (cloudflareDnsOnly) {
    const failCount = results.filter((entry) => entry.status === 'FAIL').length;
    const warnCount = results.filter((entry) => entry.status === 'WARN').length;
    const skipCount = results.filter((entry) => entry.status === 'SKIP').length;
    console.log('');
    console.log(`Summary: ${failCount} fail, ${warnCount} warn, ${skipCount} skip`);

    if (failCount || (strict && (warnCount || skipCount))) process.exit(1);
    return;
  }

  const stripeLiveCli = listStripeWebhooksWithCli({ live: true });
  if (stripeLiveCli.ok) {
    const liveEndpoint = findRequiredStripeWebhook(stripeLiveCli.data, workerBase, { livemode: true });
    if (liveEndpoint) add('PASS', 'Stripe production webhook endpoint', `live endpoint targets ${workerBase}/webhooks/stripe with required events`);
    else add('FAIL', 'Stripe production webhook endpoint', 'live endpoint not found with required payment_intent events');
  } else {
    const stripeReadiness = stripeKeyForReadiness();
    if (stripeReadiness.mode === 'live-blocked') {
      add('SKIP', 'Stripe production webhook endpoint', 'Stripe live API key is blocked; authenticate stripe CLI or set RELEASE_PROVIDER_ALLOW_LIVE_STRIPE=1 for read-only live verification');
    } else if (stripeReadiness.key && stripeReadiness.mode === 'live') {
      const webhooks = await listStripeWebhooksWithApi(stripeReadiness.key);
      if (!webhooks.ok) {
        add('FAIL', 'Stripe production webhook endpoint', `status ${webhooks.status || 'unavailable'} (${stripeReadiness.mode})`);
      } else {
        const endpoint = findRequiredStripeWebhook(webhooks.data, workerBase, { livemode: true });
        if (endpoint) add('PASS', 'Stripe production webhook endpoint', `live endpoint targets ${workerBase}/webhooks/stripe with required events`);
        else add('FAIL', 'Stripe production webhook endpoint', 'live endpoint not found with required payment_intent events');
      }
    } else {
      add('SKIP', 'Stripe production webhook endpoint', `authenticate stripe CLI for live read-only endpoint verification (${stripeLiveCli.reason})`);
    }
  }

  const stripeTestCli = listStripeWebhooksWithCli({ live: false });
  if (stripeTestCli.ok) {
    const testEndpoint = findRequiredStripeWebhook(stripeTestCli.data, workerBase, { livemode: false });
    if (testEndpoint) {
      add('PASS', 'Stripe test webhook endpoint', `test endpoint targets ${workerBase}/webhooks/stripe with required events`);
    } else {
      add('WARN', 'Stripe test webhook endpoint', 'test endpoint not found with required payment_intent events; direct local webhook smoke can still cover settlement');
    }
  } else if (stripeKeyForReadiness().key) {
    const webhooks = await listStripeWebhooksWithApi(stripeKeyForReadiness().key);
    if (!webhooks.ok) add('WARN', 'Stripe test webhook endpoint', `test endpoint API returned ${webhooks.status || 'unavailable'}`);
    else if (findRequiredStripeWebhook(webhooks.data, workerBase, { livemode: false })) add('PASS', 'Stripe test webhook endpoint', `test endpoint targets ${workerBase}/webhooks/stripe with required events`);
    else add('WARN', 'Stripe test webhook endpoint', 'test endpoint not found with required payment_intent events; direct local webhook smoke can still cover settlement');
  } else {
    add('SKIP', 'Stripe test webhook endpoint', 'set STRIPE_SECRET_KEY_TEST or authenticate stripe CLI for test endpoint verification');
  }

  const resendKey = envValue('RESEND_API_KEY');
  const emailDomains = expectedEmailDomains(vars);
  if (!resendKey) {
    add('SKIP', 'Resend domain API', 'set RESEND_API_KEY for a read-only sender-domain probe');
  } else {
    const domains = await fetchJson('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${resendKey}` }
    });
    if (!domains.ok) {
      add('FAIL', 'Resend domain API', `status ${domains.status || 'unavailable'}`);
    } else {
      const entries = domains.body?.data || [];
      const missing = emailDomains.filter((domain) => !entries.some((entry) => String(entry.name || '').toLowerCase() === domain));
      const unverified = entries
        .filter((entry) => emailDomains.includes(String(entry.name || '').toLowerCase()))
        .filter((entry) => !['verified', 'success'].includes(String(entry.status || '').toLowerCase()));
      if (missing.length) add('FAIL', 'Resend domain API', `missing sender domain(s): ${missing.join(', ')}`);
      else if (unverified.length) add('FAIL', 'Resend domain API', `unverified sender domain(s): ${unverified.map((entry) => entry.name).join(', ')}`);
      else add('PASS', 'Resend domain API', `${emailDomains.length || entries.length} sender domain(s) verified/readable`);
    }
  }

  const hasUspsCredentials = Boolean(localEnvValue('USPS_CLIENT_ID') && localEnvValue('USPS_CLIENT_SECRET'));
  if (!hasUspsCredentials) {
    add('SKIP', 'USPS quote smoke', 'set USPS_CLIENT_ID and USPS_CLIENT_SECRET or worker/.dev.vars values');
  } else {
    const result = run('npm', ['run', 'test:usps'], { cwd: ROOT });
    if (result.status === 0) add('PASS', 'USPS quote smoke', 'domestic, signature-required, international, and add-on fixtures quoted');
    else add('FAIL', 'USPS quote smoke', String(result.stderr || result.stdout || 'npm run test:usps failed').split(/\r?\n/).filter(Boolean).slice(-1)[0] || 'npm run test:usps failed');
  }

  const failCount = results.filter((entry) => entry.status === 'FAIL').length;
  const warnCount = results.filter((entry) => entry.status === 'WARN').length;
  const skipCount = results.filter((entry) => entry.status === 'SKIP').length;
  console.log('');
  console.log(`Summary: ${failCount} fail, ${warnCount} warn, ${skipCount} skip`);

  if (failCount || (strict && (warnCount || skipCount))) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeWranglerInventory } from './lib/wrangler-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function valueArg(args, name, fallback = '') {
  const found = args.find((arg) => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

function secretNames(value) {
  const entries = Array.isArray(value) ? value : Array.isArray(value?.result) ? value.result : [];
  return new Set(entries.map((entry) => String(entry?.name || entry || '').trim()).filter(Boolean));
}

function explicitHttpsOrigin(value = '') {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash ? url.origin : '';
  } catch {
    return '';
  }
}

export function auditProductionPosture({ config, inventory, secrets = [], providerEvidence = null }) {
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });
  const names = secretNames(secrets);
  for (const name of config.requiredSecrets || []) {
    add(`secret:${name}`, names.has(name) ? 'ok' : 'action', names.has(name) ? 'Configured' : 'Missing required production secret');
  }
  for (const name of config.recommendedSecrets || []) {
    add(`secret:${name}`, names.has(name) ? 'ok' : 'warning', names.has(name) ? 'Configured' : 'Recommended dedicated production secret is missing');
  }
  const vars = inventory.vars || {};
  add('config:app-mode', String(vars.APP_MODE || '').toLowerCase() === 'live' ? 'ok' : 'action', `APP_MODE=${String(vars.APP_MODE || 'missing')}`);
  const siteOrigin = explicitHttpsOrigin(vars.CANONICAL_SITE_BASE || vars.SITE_BASE);
  const workerOrigin = explicitHttpsOrigin(vars.CANONICAL_WORKER_BASE || vars.WORKER_BASE);
  add('config:site-origin', siteOrigin ? 'ok' : 'action', siteOrigin || 'Canonical site origin must be explicit HTTPS');
  add('config:worker-origin', workerOrigin && workerOrigin !== siteOrigin ? 'ok' : 'action', workerOrigin || 'Canonical Worker origin must be explicit HTTPS and distinct');
  add('config:cors-origin', explicitHttpsOrigin(vars.CORS_ALLOWED_ORIGIN) === siteOrigin ? 'ok' : 'action', String(vars.CORS_ALLOWED_ORIGIN || 'missing'));
  const users = (() => { try { return JSON.parse(String(vars.ADMIN_USERS_JSON || '[]')); } catch { return []; } })();
  const superAdmins = Array.isArray(users) ? users.filter((user) => user?.role === 'super_admin') : [];
  add('config:admin-users', superAdmins.length > 0 ? 'ok' : 'action', `${superAdmins.length} configured super-admins`);
  const kv = new Set((inventory.kvNamespaces || []).map((entry) => entry.binding));
  const r2 = new Set((inventory.r2Buckets || []).map((entry) => entry.binding));
  const durable = new Set((inventory.durableObjects || []).map((entry) => entry.name));
  for (const binding of config.requiredKvBindings || []) add(`binding:${binding}`, kv.has(binding) ? 'ok' : 'action', kv.has(binding) ? 'Configured' : 'Missing KV binding');
  for (const binding of config.requiredR2Bindings || []) add(`binding:${binding}`, r2.has(binding) ? 'ok' : 'action', r2.has(binding) ? 'Configured' : 'Missing R2 binding');
  for (const binding of config.requiredDurableObjectBindings || []) add(`binding:${binding}`, durable.has(binding) ? 'ok' : 'action', durable.has(binding) ? 'Configured' : 'Missing Durable Object binding');
  const webhookUrl = workerOrigin ? `${workerOrigin}${config.expectedStripeWebhookPath || '/webhooks/stripe'}` : '';
  add('stripe:webhook-expected', webhookUrl ? 'manual' : 'action', webhookUrl || 'Unable to derive expected webhook endpoint');
  if (providerEvidence) {
    const providerFailures = Array.isArray(providerEvidence.results)
      ? providerEvidence.results.filter((entry) => String(entry.status || '').toUpperCase() === 'FAIL').length
      : Number(providerEvidence.failCount || providerEvidence.fail_count || 0);
    add('providers:readiness', providerFailures > 0 ? 'action' : 'ok', `${providerFailures} provider evidence failures`);
  } else {
    add('providers:readiness', 'warning', 'Provider evidence was not supplied');
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: checks.some((check) => check.status === 'action') ? 'action' : checks.some((check) => check.status === 'warning') ? 'warning' : 'ok',
    checks,
    containsCredentials: false,
    containsCustomerData: false
  };
}

export function productionPostureIssue(evidence) {
  const lines = [
    'Production configuration posture drift was detected.',
    '',
    `Generated: ${evidence.generatedAt}`,
    '',
    '| Check | Status | Detail |',
    '| --- | --- | --- |'
  ];
  for (const check of evidence.checks.filter((entry) => entry.status !== 'ok')) {
    lines.push(`| ${check.id} | ${check.status} | ${String(check.detail || '').replace(/\|/g, '\\|')} |`);
  }
  lines.push('', 'This report contains secret names and status only, never secret values. Review before changing production state.', '');
  return lines.join('\n');
}

function readJsonIfPresent(filePath) {
  return filePath && fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null;
}

function main() {
  const args = process.argv.slice(2);
  const config = readJsonIfPresent(path.resolve(valueArg(args, '--config', path.join(ROOT, 'config', 'production-posture.json'))));
  const wranglerPath = path.resolve(valueArg(args, '--wrangler', path.join(ROOT, 'worker', 'wrangler.toml')));
  const inventory = normalizeWranglerInventory(fs.readFileSync(wranglerPath, 'utf8'));
  const secretsFile = valueArg(args, '--secrets-file', '');
  const providerEvidenceFile = valueArg(args, '--provider-evidence', '');
  const evidence = auditProductionPosture({
    config,
    inventory,
    secrets: secretsFile ? readJsonIfPresent(path.resolve(secretsFile)) || [] : [],
    providerEvidence: providerEvidenceFile ? readJsonIfPresent(path.resolve(providerEvidenceFile)) : null
  });
  const output = valueArg(args, '--output', '');
  const issueOutput = valueArg(args, '--issue-output', '');
  if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(evidence, null, 2)}\n`);
  if (issueOutput) fs.writeFileSync(path.resolve(issueOutput), productionPostureIssue(evidence));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.status === 'action') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

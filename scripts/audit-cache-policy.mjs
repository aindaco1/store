#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONFIG = path.join(ROOT, 'config', 'performance-budgets.json');

function maxAge(cacheControl) {
  const match = String(cacheControl || '').match(/(?:^|,)\s*(?:s-maxage|max-age)=(\d+)/i);
  return match ? Number(match[1]) : 0;
}

export function evaluateCachePolicyTarget(target = {}, response = {}) {
  const cacheControl = String(response.cacheControl || '').toLowerCase();
  const failures = [];
  if (Number(response.status) !== Number(target.status)) failures.push('unexpected_status');
  if (target.type === 'private') {
    if (!cacheControl.includes('private')) failures.push('missing_private');
    if (!cacheControl.includes('no-store')) failures.push('missing_no_store');
  } else {
    if (cacheControl.includes('private') || cacheControl.includes('no-store')) failures.push('unexpected_private');
    if (maxAge(cacheControl) < Number(target.minimumMaxAge || 0)) failures.push('max_age_below_budget');
  }
  return {
    id: String(target.id || ''),
    status: Number(response.status || 0),
    cacheControl,
    cfCacheStatus: String(response.cfCacheStatus || ''),
    ok: failures.length === 0,
    failures
  };
}

export async function collectCachePolicyEvidence(options = {}) {
  const config = options.config || JSON.parse(fs.readFileSync(options.configPath || DEFAULT_CONFIG, 'utf8'));
  const bases = {
    site: String(options.siteBase || 'https://shop.dustwave.xyz').replace(/\/$/, ''),
    worker: String(options.workerBase || 'https://checkout.dustwave.xyz').replace(/\/$/, '')
  };
  const fetchImpl = options.fetchImpl || fetch;
  const checks = [];
  for (const target of config.cachePolicy || []) {
    const base = bases[target.base];
    if (!base) throw new Error(`Unknown cache policy base: ${target.base}`);
    const response = await fetchImpl(`${base}${target.path}`, {
      method: 'GET',
      headers: { Accept: target.path.endsWith('.json') ? 'application/json' : '*/*' },
      redirect: 'error'
    });
    checks.push(evaluateCachePolicyTarget(target, {
      status: response.status,
      cacheControl: response.headers.get('Cache-Control'),
      cfCacheStatus: response.headers.get('Cf-Cache-Status')
    }));
    await response.body?.cancel().catch(() => undefined);
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: checks.every((check) => check.ok),
    checks,
    containsCredentials: false,
    containsCustomerData: false
  };
}

function valueArg(args, name, fallback = '') {
  const found = args.find((arg) => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

async function main() {
  const args = process.argv.slice(2);
  const evidence = await collectCachePolicyEvidence({
    configPath: valueArg(args, '--config', DEFAULT_CONFIG),
    siteBase: valueArg(args, '--site-base', process.env.SITE_BASE || ''),
    workerBase: valueArg(args, '--worker-base', process.env.WORKER_BASE || '')
  });
  const output = valueArg(args, '--output', '');
  if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}

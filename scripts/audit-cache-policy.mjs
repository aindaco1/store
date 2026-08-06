#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  collectCachePolicyEvidence as collectSharedCachePolicyEvidence,
  evaluateCachePolicyTarget
} from '../shared/dust-wave-platform/packages/release-core/src/cache-policy.js';

export { evaluateCachePolicyTarget };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONFIG = path.join(ROOT, 'config', 'performance-budgets.json');
export const CACHE_POLICY_ORIGINS = Object.freeze({
  site: 'https://shop.dustwave.xyz',
  worker: 'https://checkout.dustwave.xyz'
});

export async function collectCachePolicyEvidence(options = {}) {
  const config = options.config
    || JSON.parse(fs.readFileSync(options.configPath || DEFAULT_CONFIG, 'utf8'));
  return collectSharedCachePolicyEvidence({
    config,
    siteBase: options.siteBase || CACHE_POLICY_ORIGINS.site,
    workerBase: options.workerBase || CACHE_POLICY_ORIGINS.worker,
    fetchImpl: options.fetchImpl,
    now: options.now
  });
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

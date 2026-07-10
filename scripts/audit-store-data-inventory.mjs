#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadStoreDataInventory } from './lib/store-data-inventory.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_SOURCE_DIR = path.join(ROOT, 'worker', 'src');

const REQUIRED_DYNAMIC_STORAGE_PREFIXES = [
  'orders:',
  'admin-user:',
  'admin-login:',
  'admin-session:',
  'rl:',
  'store-order-email-sent:',
  'store-order-admin-email-sent:',
  'admin-audit:',
  'observability:',
  'stripe-event:',
  'workers-cache-purge-failure:recent',
  'cron:'
];

function prefixFromTemplate(value) {
  return String(value || '').split('${')[0];
}

export function discoverWorkerStoragePrefixes(sourceDir = WORKER_SOURCE_DIR) {
  const prefixes = new Set(REQUIRED_DYNAMIC_STORAGE_PREFIXES);
  for (const filename of fs.readdirSync(sourceDir).filter((name) => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(sourceDir, filename), 'utf8');
    for (const match of source.matchAll(/(?:const\s+[A-Z0-9_]*(?:KEY|PREFIX)|kvKeyPrefix\s*)\s*=\s*['`]([^'`]+)['`]/g)) {
      const prefix = prefixFromTemplate(match[1]);
      if (prefix && /(?:admin-|store-|orders:|abandoned-|observability:|cron:|rl:|stripe-event:|add-on-)/.test(prefix)) {
        prefixes.add(prefix === 'store-inventory:v1' ? 'store-inventory:v1:' : prefix);
      }
    }
  }
  return Array.from(prefixes).sort();
}

export function auditStoreDataInventory(options = {}) {
  const inventory = options.inventory || loadStoreDataInventory();
  const documented = new Set(inventory.families
    .filter((family) => family.type === 'kv')
    .map((family) => family.prefix));
  const discovered = options.discovered || discoverWorkerStoragePrefixes(options.sourceDir);
  const missing = discovered.filter((prefix) => !documented.has(prefix));
  return { ok: missing.length === 0, discovered, documented: Array.from(documented).sort(), missing };
}

function main() {
  const result = auditStoreDataInventory();
  if (!result.ok) {
    console.error(`Store data inventory is missing: ${result.missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Store data inventory covers ${result.discovered.length} Worker storage families.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

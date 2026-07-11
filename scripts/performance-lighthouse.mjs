#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONFIG = path.join(ROOT, 'config', 'performance-budgets.json');

function valueArg(args, name, fallback = '') {
  const found = args.find((arg) => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

export function evaluateLighthouseResult(lhr = {}, budgets = {}) {
  const checks = [];
  for (const [id, minimum] of Object.entries(budgets.categories || {})) {
    const actual = Number(lhr.categories?.[id]?.score ?? 0);
    checks.push({ id: `category:${id}`, actual, minimum: Number(minimum), ok: actual >= Number(minimum) });
  }
  for (const [id, maximum] of Object.entries(budgets.audits || {})) {
    const actual = Number(lhr.audits?.[id]?.numericValue ?? Infinity);
    checks.push({ id: `audit:${id}`, actual, maximum: Number(maximum), ok: actual <= Number(maximum) });
  }
  const resourceRows = new Map((lhr.audits?.['resource-summary']?.details?.items || [])
    .map((entry) => [String(entry.resourceType || ''), Number(entry.transferSize || 0)]));
  for (const [resourceType, maximum] of Object.entries(budgets.resourceBytes || {})) {
    const actual = resourceRows.has(resourceType) ? resourceRows.get(resourceType) : Infinity;
    checks.push({
      id: `resource:${resourceType}`,
      actual,
      maximum: Number(maximum),
      ok: actual <= Number(maximum)
    });
  }
  return { ok: checks.every((check) => check.ok), checks };
}

export async function collectLighthouseEvidence(options = {}) {
  const config = options.config || JSON.parse(fs.readFileSync(options.configPath || DEFAULT_CONFIG, 'utf8'));
  const baseUrl = String(options.baseUrl || 'http://127.0.0.1:4002').replace(/\/$/, '');
  const chrome = await launch({
    chromePath: options.chromePath || chromium.executablePath(),
    chromeFlags: ['--headless', '--no-sandbox', '--disable-dev-shm-usage']
  });
  const routes = [];
  try {
    for (const routePath of config.lighthouse.routes || []) {
      const result = await lighthouse(`${baseUrl}${routePath}`, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: Object.keys(config.lighthouse.categories || {})
      });
      if (!result?.lhr) throw new Error(`Lighthouse did not return a result for ${routePath}.`);
      if (options.rawOutputDirectory) {
        fs.mkdirSync(options.rawOutputDirectory, { recursive: true });
        const filename = routePath === '/'
          ? 'home.json'
          : `${routePath.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-')}.json`;
        fs.writeFileSync(path.join(options.rawOutputDirectory, filename), `${JSON.stringify(result.lhr)}\n`);
      }
      const evaluated = evaluateLighthouseResult(result.lhr, config.lighthouse);
      routes.push({ path: routePath, ...evaluated });
    }
  } finally {
    await chrome.kill();
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseOrigin: new URL(baseUrl).origin,
    ok: routes.every((route) => route.ok),
    routes,
    containsCredentials: false,
    containsCustomerData: false
  };
}

async function main() {
  const args = process.argv.slice(2);
  const evidence = await collectLighthouseEvidence({
    configPath: valueArg(args, '--config', DEFAULT_CONFIG),
    baseUrl: valueArg(args, '--base-url', process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4002'),
    rawOutputDirectory: valueArg(args, '--raw-output-dir', '')
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

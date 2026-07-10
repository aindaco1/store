#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { exchangeAdminLoginToken } from './lib/admin-export-client.mjs';

function valueArg(args, name, fallback = '') {
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

export function percentile(values = [], quantile = 0.5) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index];
}

export function summarizeCacheSamples(samples = []) {
  const durations = samples.map((sample) => Number(sample.durationMs || 0));
  const totals = (key) => samples.reduce((sum, sample) => sum + Number(sample[key] || 0), 0);
  const statuses = {};
  for (const sample of samples) {
    const status = String(sample.cacheStatus || 'UNKNOWN').toUpperCase();
    statuses[status] = (statuses[status] || 0) + 1;
  }
  return {
    samples: samples.length,
    latencyMs: {
      p50: Number(percentile(durations, 0.5).toFixed(2)),
      p95: Number(percentile(durations, 0.95).toFixed(2)),
      p99: Number(percentile(durations, 0.99).toFixed(2))
    },
    responseBytes: totals('responseBytes'),
    workersRequestsExpected: totals('workersRequestsExpected'),
    kvReadsExpected: totals('kvReadsExpected'),
    kvListExpected: totals('kvListExpected'),
    r2ReadsExpected: totals('r2ReadsExpected'),
    r2ListExpected: totals('r2ListExpected'),
    providerCallsExpected: totals('providerCallsExpected'),
    cacheStatuses: statuses
  };
}

async function measuredAdminRead({ workerBase, path: routePath, session, fetchImpl = fetch }) {
  const started = performance.now();
  const response = await fetchImpl(`${workerBase}${routePath}`, {
    headers: { Accept: 'application/json', Cookie: session.cookie },
    redirect: 'error'
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const durationMs = performance.now() - started;
  if (!response.ok) throw new Error(`Cache benchmark read failed with status ${response.status}.`);
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  const budget = payload.writeBudget || {};
  return {
    sample: {
      durationMs,
      responseBytes: bytes.byteLength,
      cacheStatus: response.headers.get('x-store-workers-cache') || payload.workersCache?.status || 'unavailable',
      unchanged: payload.unchanged === true,
      workersRequestsExpected: budget.workersRequestsExpected || 0,
      kvReadsExpected: budget.kvReadsExpected || 0,
      kvListExpected: budget.kvListExpected || 0,
      r2ReadsExpected: budget.r2ReadsExpected || 0,
      r2ListExpected: budget.r2ListExpected || 0,
      providerCallsExpected: budget.providerCallsExpected || 0
    },
    state: {
      watermark: String(payload.watermark || payload.page?.watermark || ''),
      latestKnownUpdatedAt: String(payload.latestKnownUpdatedAt || payload.page?.latestKnownUpdatedAt || '')
    }
  };
}

async function purgeCache({ workerBase, siteBase, session, target = 'all_known', fetchImpl = fetch }) {
  const response = await fetchImpl(`${workerBase}/admin/workers-cache/purge`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Cookie: session.cookie,
      Origin: siteBase,
      'x-store-admin-csrf': session.csrfToken
    },
    body: JSON.stringify({ target, source: 'cache-benchmark' }),
    redirect: 'error'
  });
  if (!response.ok) throw new Error(`Workers Cache purge failed with status ${response.status}.`);
}

export async function runWorkersCacheBenchmark(options = {}) {
  const workerBase = String(options.workerBase || '').replace(/\/+$/, '');
  const siteBase = String(options.siteBase || workerBase).replace(/\/+$/, '');
  const samplesPerCase = Math.max(1, Number(options.samples || 30));
  const session = options.session || await exchangeAdminLoginToken({
    workerBase,
    token: options.loginToken,
    fetchImpl: options.fetchImpl
  });
  const fetchImpl = options.fetchImpl || fetch;
  const cases = {};

  await purgeCache({ workerBase, siteBase, session, target: 'admin_orders', fetchImpl });
  const cold = await measuredAdminRead({ workerBase, path: '/admin/store/orders?status=confirmed&limit=25', session, fetchImpl });
  cases.ordersCold = summarizeCacheSamples([cold.sample]);

  const warmSamples = [];
  for (let index = 0; index < samplesPerCase; index += 1) {
    warmSamples.push((await measuredAdminRead({
      workerBase,
      path: '/admin/store/orders?status=confirmed&limit=25',
      session,
      fetchImpl
    })).sample);
  }
  cases.ordersWarm = summarizeCacheSamples(warmSamples);

  const marker = cold.state.watermark;
  const unchangedSamples = [];
  if (marker) {
    for (let index = 0; index < samplesPerCase; index += 1) {
      unchangedSamples.push((await measuredAdminRead({
        workerBase,
        path: `/admin/store/orders?status=confirmed&limit=25&watermark=${encodeURIComponent(marker)}`,
        session,
        fetchImpl
      })).sample);
    }
  }
  cases.ordersNoChange = summarizeCacheSamples(unchangedSamples);

  for (const [caseName, routePath] of [
    ['analyticsWarm', '/admin/store/analytics'],
    ['inventoryWarm', '/admin/store/inventory'],
    ['downloadsWarm', '/admin/store/downloads']
  ]) {
    const samples = [];
    for (let index = 0; index < samplesPerCase; index += 1) {
      samples.push((await measuredAdminRead({ workerBase, path: routePath, session, fetchImpl })).sample);
    }
    cases[caseName] = summarizeCacheSamples(samples);
  }

  const search = await measuredAdminRead({
    workerBase,
    path: '/admin/store/orders?status=confirmed&q=cache-benchmark-no-match',
    session,
    fetchImpl
  });
  cases.searchBypass = summarizeCacheSamples([search.sample]);
  return {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    workerOrigin: new URL(workerBase).origin,
    samplesPerCase,
    containsResponseBodies: false,
    containsCredentials: false,
    cases
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/workers-cache-benchmark.mjs --worker-base=URL --site-base=URL [--samples=30] [--output=FILE]');
    console.log('Set STORE_CACHE_SMOKE_ADMIN_LOGIN_TOKEN to a fresh one-time super-admin login token.');
    return;
  }
  const result = await runWorkersCacheBenchmark({
    workerBase: valueArg(args, '--worker-base', process.env.WORKER_BASE || ''),
    siteBase: valueArg(args, '--site-base', process.env.SITE_BASE || ''),
    samples: valueArg(args, '--samples', '30'),
    loginToken: process.env.STORE_CACHE_SMOKE_ADMIN_LOGIN_TOKEN || ''
  });
  const output = valueArg(args, '--output', '');
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

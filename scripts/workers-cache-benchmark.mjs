#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { exchangeAdminLoginToken } from './lib/admin-export-client.mjs';

const BENCHMARK_ROUTES = Object.freeze({
  orders: Object.freeze({
    path: '/admin/store/orders?status=confirmed&limit=25',
    purgeTarget: 'admin_orders',
    supportsWatermark: true,
    searchPath: '/admin/store/orders?status=confirmed&q=cache-benchmark-no-match'
  }),
  analytics: Object.freeze({
    path: '/admin/store/analytics',
    purgeTarget: 'admin_analytics',
    supportsWatermark: false,
    searchPath: '/admin/store/analytics?q=cache-benchmark-no-match'
  }),
  inventory: Object.freeze({
    path: '/admin/store/inventory',
    purgeTarget: 'admin_inventory',
    supportsWatermark: false,
    searchPath: ''
  }),
  downloads: Object.freeze({
    path: '/admin/store/downloads',
    purgeTarget: 'admin_downloads',
    supportsWatermark: false,
    searchPath: ''
  })
});

function valueArg(args, name, fallback = '') {
  const exact = args.indexOf(name);
  if (exact >= 0 && args[exact + 1]) return args[exact + 1];
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function normalizedMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode !== 'enabled' && mode !== 'disabled') {
    throw new Error('Workers Cache benchmark mode must be enabled or disabled.');
  }
  return mode;
}

function normalizedRoute(value) {
  const route = String(value || 'orders').trim().toLowerCase();
  if (!BENCHMARK_ROUTES[route]) {
    throw new Error(`Unsupported Workers Cache benchmark route: ${route || '<empty>'}.`);
  }
  return route;
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
  const bypasses = {};
  let unchanged = 0;
  for (const sample of samples) {
    const status = String(sample.cacheStatus || 'UNKNOWN').toUpperCase();
    const bypass = String(sample.cacheBypass || '').trim().toLowerCase();
    statuses[status] = (statuses[status] || 0) + 1;
    if (bypass) bypasses[bypass] = (bypasses[bypass] || 0) + 1;
    if (sample.unchanged === true) unchanged += 1;
  }
  return {
    samples: samples.length,
    latencyMs: {
      p50: Number(percentile(durations, 0.5).toFixed(2)),
      p95: Number(percentile(durations, 0.95).toFixed(2)),
      p99: Number(percentile(durations, 0.99).toFixed(2))
    },
    responseBytes: totals('responseBytes'),
    unchanged,
    workersRequestsExpected: totals('workersRequestsExpected'),
    kvReadsExpected: totals('kvReadsExpected'),
    kvListExpected: totals('kvListExpected'),
    r2ReadsExpected: totals('r2ReadsExpected'),
    r2ListExpected: totals('r2ListExpected'),
    providerCallsExpected: totals('providerCallsExpected'),
    cacheStatuses: statuses,
    cacheBypasses: bypasses
  };
}

function evidenceCase(evidence, suffix) {
  return evidence?.cases?.[`${evidence.route}${suffix}`] || null;
}

function improvementPercent(baseline, candidate) {
  const baselineValue = Number(baseline || 0);
  const candidateValue = Number(candidate || 0);
  if (baselineValue <= 0) return 0;
  return Number((((baselineValue - candidateValue) / baselineValue) * 100).toFixed(2));
}

function hasOnlyStatuses(summary, allowed = []) {
  const allowedStatuses = new Set(allowed.map((status) => String(status).toUpperCase()));
  const statuses = Object.keys(summary?.cacheStatuses || {});
  return statuses.length > 0 && statuses.every((status) => allowedStatuses.has(status));
}

export function compareWorkersCacheEvidence(baseline, candidate, options = {}) {
  const minimumSamples = Math.max(1, Number(options.minimumSamples || 30));
  const minimumP95ImprovementPercent = Math.max(0, Number(options.minimumP95ImprovementPercent || 40));
  const checks = [];
  const addCheck = (id, ok, actual, expected) => checks.push({ id, ok: ok === true, actual, expected });

  addCheck('schema-version', baseline?.schemaVersion === 2 && candidate?.schemaVersion === 2,
    `${baseline?.schemaVersion || 0}/${candidate?.schemaVersion || 0}`, '2/2');
  addCheck('baseline-mode', baseline?.mode === 'disabled', baseline?.mode || '', 'disabled');
  addCheck('candidate-mode', candidate?.mode === 'enabled', candidate?.mode || '', 'enabled');
  addCheck('same-route', Boolean(baseline?.route) && baseline?.route === candidate?.route,
    `${baseline?.route || ''}/${candidate?.route || ''}`, 'matching supported route');
  addCheck('sanitized-artifacts', baseline?.containsResponseBodies === false && baseline?.containsCredentials === false &&
    candidate?.containsResponseBodies === false && candidate?.containsCredentials === false,
  'response bodies and credentials excluded', 'response bodies and credentials excluded');

  const route = candidate?.route || baseline?.route || 'orders';
  const baselineWarm = evidenceCase(baseline, 'Warm');
  const candidateWarm = evidenceCase(candidate, 'Warm');
  addCheck('warm-sample-count', Number(baselineWarm?.samples || 0) >= minimumSamples &&
    Number(candidateWarm?.samples || 0) >= minimumSamples,
  `${baselineWarm?.samples || 0}/${candidateWarm?.samples || 0}`, `at least ${minimumSamples} each`);
  addCheck('disabled-baseline-status', hasOnlyStatuses(baselineWarm, ['DISABLED']),
    baselineWarm?.cacheStatuses || {}, 'DISABLED only');
  addCheck('enabled-warm-status', hasOnlyStatuses(candidateWarm, ['HIT', 'UPDATING']),
    candidateWarm?.cacheStatuses || {}, 'HIT or UPDATING only');
  addCheck('warm-zero-backend-order-reads', Number(candidateWarm?.kvReadsExpected || 0) === 0 &&
    Number(candidateWarm?.kvListExpected || 0) === 0,
  { kvReadsExpected: candidateWarm?.kvReadsExpected || 0, kvListExpected: candidateWarm?.kvListExpected || 0 },
  { kvReadsExpected: 0, kvListExpected: 0 });

  const warmImprovement = improvementPercent(baselineWarm?.latencyMs?.p95, candidateWarm?.latencyMs?.p95);
  addCheck('warm-p95-improvement', warmImprovement >= minimumP95ImprovementPercent,
    `${warmImprovement}%`, `at least ${minimumP95ImprovementPercent}%`);

  if (route === 'orders') {
    const baselineNoChange = evidenceCase(baseline, 'NoChange');
    const candidateNoChange = evidenceCase(candidate, 'NoChange');
    addCheck('no-change-sample-count', Number(baselineNoChange?.samples || 0) >= minimumSamples &&
      Number(candidateNoChange?.samples || 0) >= minimumSamples,
    `${baselineNoChange?.samples || 0}/${candidateNoChange?.samples || 0}`, `at least ${minimumSamples} each`);
    addCheck('no-change-responses', Number(candidateNoChange?.unchanged || 0) === Number(candidateNoChange?.samples || 0),
      candidateNoChange?.unchanged || 0, candidateNoChange?.samples || 0);
    addCheck('no-change-zero-backend-order-reads', Number(candidateNoChange?.kvReadsExpected || 0) === 0 &&
      Number(candidateNoChange?.kvListExpected || 0) === 0,
    { kvReadsExpected: candidateNoChange?.kvReadsExpected || 0, kvListExpected: candidateNoChange?.kvListExpected || 0 },
    { kvReadsExpected: 0, kvListExpected: 0 });
    const noChangeImprovement = improvementPercent(
      baselineNoChange?.latencyMs?.p95,
      candidateNoChange?.latencyMs?.p95
    );
    addCheck('no-change-p95-improvement', noChangeImprovement >= minimumP95ImprovementPercent,
      `${noChangeImprovement}%`, `at least ${minimumP95ImprovementPercent}%`);
  }

  const candidateSearch = evidenceCase(candidate, 'SearchBypass');
  if (candidateSearch) {
    addCheck('search-sample-count', Number(candidateSearch.samples || 0) >= minimumSamples,
      candidateSearch.samples || 0, `at least ${minimumSamples}`);
    addCheck('search-bypass', Number(candidateSearch.cacheBypasses?.search_query || 0) === Number(candidateSearch.samples || 0),
      candidateSearch.cacheBypasses || {}, { search_query: candidateSearch.samples || 0 });
  }

  const postPurge = evidenceCase(candidate, 'PostPurge');
  addCheck('bounded-post-purge-evidence', Number(postPurge?.samples || 0) >= 1,
    postPurge?.samples || 0, 'at least 1');
  addCheck('post-purge-refill', hasOnlyStatuses(postPurge, ['MISS', 'EXPIRED', 'REVALIDATED']),
    postPurge?.cacheStatuses || {}, 'MISS, EXPIRED, or REVALIDATED');

  return {
    schemaVersion: 1,
    comparedAt: new Date().toISOString(),
    route,
    minimumSamples,
    minimumP95ImprovementPercent,
    passed: checks.every((check) => check.ok),
    checks
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
  const workersCache = payload.workersCache || payload.page?.cache?.workers || {};
  return {
    sample: {
      durationMs,
      responseBytes: bytes.byteLength,
      cacheStatus: response.headers.get('x-store-workers-cache') || workersCache.status || 'unavailable',
      cacheBypass: workersCache.bypass || '',
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

async function purgeCache({ workerBase, siteBase, session, target, fetchImpl = fetch }) {
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

async function collectSamples(count, reader) {
  const samples = [];
  let last = null;
  for (let index = 0; index < count; index += 1) {
    last = await reader(index);
    samples.push(last.sample);
  }
  return { samples, last };
}

export async function runWorkersCacheBenchmark(options = {}) {
  const workerBase = String(options.workerBase || '').replace(/\/+$/, '');
  const siteBase = String(options.siteBase || workerBase).replace(/\/+$/, '');
  const samplesPerCase = Math.max(1, Number(options.samples || 30));
  const mode = normalizedMode(options.mode || 'enabled');
  const route = normalizedRoute(options.route || 'orders');
  const routeConfig = BENCHMARK_ROUTES[route];
  if (!workerBase) throw new Error('Workers Cache benchmark requires --worker-base.');
  const session = options.session || await exchangeAdminLoginToken({
    workerBase,
    token: options.loginToken,
    fetchImpl: options.fetchImpl
  });
  const fetchImpl = options.fetchImpl || fetch;
  const cases = {};
  const caseName = (suffix) => `${route}${suffix}`;

  if (mode === 'enabled') {
    await purgeCache({ workerBase, siteBase, session, target: routeConfig.purgeTarget, fetchImpl });
  }
  const cold = await measuredAdminRead({ workerBase, path: routeConfig.path, session, fetchImpl });
  cases[caseName('Cold')] = summarizeCacheSamples([cold.sample]);

  const warm = await collectSamples(samplesPerCase, () => measuredAdminRead({
    workerBase,
    path: routeConfig.path,
    session,
    fetchImpl
  }));
  cases[caseName('Warm')] = summarizeCacheSamples(warm.samples);

  const marker = warm.last?.state?.watermark || cold.state.watermark;
  if (routeConfig.supportsWatermark && marker) {
    const separator = routeConfig.path.includes('?') ? '&' : '?';
    const noChange = await collectSamples(samplesPerCase, () => measuredAdminRead({
      workerBase,
      path: `${routeConfig.path}${separator}watermark=${encodeURIComponent(marker)}`,
      session,
      fetchImpl
    }));
    cases[caseName('NoChange')] = summarizeCacheSamples(noChange.samples);
  }

  if (routeConfig.searchPath) {
    const search = await collectSamples(samplesPerCase, () => measuredAdminRead({
      workerBase,
      path: routeConfig.searchPath,
      session,
      fetchImpl
    }));
    cases[caseName('SearchBypass')] = summarizeCacheSamples(search.samples);
  }

  if (mode === 'enabled') {
    await purgeCache({ workerBase, siteBase, session, target: routeConfig.purgeTarget, fetchImpl });
  }
  const postPurge = await measuredAdminRead({ workerBase, path: routeConfig.path, session, fetchImpl });
  cases[caseName('PostPurge')] = summarizeCacheSamples([postPurge.sample]);

  return {
    schemaVersion: 2,
    measuredAt: new Date().toISOString(),
    workerOrigin: new URL(workerBase).origin,
    samplesPerCase,
    route,
    mode,
    purgeRequests: mode === 'enabled' ? 2 : 0,
    containsResponseBodies: false,
    containsCredentials: false,
    cases
  };
}

function writeOutput(output, value) {
  if (!output) return;
  const resolved = path.resolve(output);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Benchmark: node scripts/workers-cache-benchmark.mjs --mode=enabled|disabled --route=orders --worker-base=URL --site-base=URL [--samples=30] [--output=FILE]');
    console.log('Compare:   node scripts/workers-cache-benchmark.mjs --compare --baseline=FILE --candidate=FILE [--output=FILE]');
    console.log('Set STORE_CACHE_SMOKE_ADMIN_LOGIN_TOKEN to a fresh one-time super-admin login token for benchmark runs.');
    return;
  }

  const output = valueArg(args, '--output', '');
  if (args.includes('--compare')) {
    const baselinePath = path.resolve(valueArg(args, '--baseline', ''));
    const candidatePath = path.resolve(valueArg(args, '--candidate', ''));
    if (!fs.existsSync(baselinePath) || !fs.existsSync(candidatePath)) {
      throw new Error('Workers Cache comparison requires existing --baseline and --candidate evidence files.');
    }
    const comparison = compareWorkersCacheEvidence(
      JSON.parse(fs.readFileSync(baselinePath, 'utf8')),
      JSON.parse(fs.readFileSync(candidatePath, 'utf8')),
      {
        minimumSamples: valueArg(args, '--minimum-samples', '30'),
        minimumP95ImprovementPercent: valueArg(args, '--minimum-p95-improvement-percent', '40')
      }
    );
    writeOutput(output, comparison);
    console.log(JSON.stringify(comparison, null, 2));
    if (!comparison.passed) process.exitCode = 1;
    return;
  }

  const result = await runWorkersCacheBenchmark({
    workerBase: valueArg(args, '--worker-base', process.env.WORKER_BASE || ''),
    siteBase: valueArg(args, '--site-base', process.env.SITE_BASE || ''),
    samples: valueArg(args, '--samples', '30'),
    route: valueArg(args, '--route', 'orders'),
    mode: valueArg(args, '--mode', 'enabled'),
    loginToken: process.env.STORE_CACHE_SMOKE_ADMIN_LOGIN_TOKEN || ''
  });
  writeOutput(output, result);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

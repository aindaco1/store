#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_DATASET = 'store_workers_cache_metrics';
const HIT_STATUSES = new Set(['HIT', 'UPDATING']);

function valueArg(args, name, fallback = '') {
  const exact = args.indexOf(name);
  if (exact >= 0 && args[exact + 1]) return args[exact + 1];
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizedDataset(value) {
  const dataset = String(value || DEFAULT_DATASET).trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(dataset)) {
    throw new Error('Workers Cache Analytics Engine dataset name is invalid.');
  }
  return dataset;
}

function normalizedAccountId(value) {
  const accountId = String(value || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error('Workers Cache observability requires a valid Cloudflare account ID.');
  }
  return accountId;
}

function normalizedWorkerBase(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const url = new URL(text);
  if (url.protocol !== 'https:') throw new Error('Scheduled Workers Cache evidence requires an HTTPS Worker base.');
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error('Worker base must be an HTTPS origin without credentials, path, query, or fragment.');
  }
  return url.origin;
}

export function buildWorkersCacheAnalyticsQuery(options = {}) {
  const dataset = normalizedDataset(options.dataset);
  const hours = boundedInteger(options.hours, 24, 1, 168);
  const recentMinutes = boundedInteger(options.recentMinutes, 15, 5, 120);
  return `SELECT
  blob2 AS route,
  blob3 AS status,
  SUM(_sample_interval) AS estimatedRequests,
  SUM(if(timestamp >= NOW() - INTERVAL '${recentMinutes}' MINUTE, _sample_interval, 0)) AS recentEstimatedRequests,
  SUM(_sample_interval * double1) / SUM(_sample_interval) AS averageDurationMs,
  SUM(_sample_interval * double2) AS responseBytes,
  SUM(_sample_interval * double3) AS workersRequestsExpected,
  SUM(_sample_interval * double4) AS kvReadsExpected,
  SUM(_sample_interval * double5) AS kvListExpected,
  SUM(_sample_interval * double6) AS r2ReadsExpected,
  SUM(_sample_interval * double7) AS r2ListExpected,
  SUM(_sample_interval * double8) AS providerCallsExpected
FROM ${dataset}
WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR
  AND blob1 = 'store-workers-cache-v1'
GROUP BY route, status
ORDER BY route, status`;
}

function responseRows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.result?.data)) return value.result.data;
  return [];
}

function numeric(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function summarizeWorkersCacheAnalytics(rows = [], options = {}) {
  const minimumRequests = boundedInteger(options.minimumRequests, 10, 1, 100_000);
  const minimumHitRatioPercent = boundedNumber(options.minimumHitRatioPercent, 50, 0, 100);
  const maxRecentRequests = boundedInteger(options.maxRecentRequests, 25, 0, 100_000);
  const routes = new Map();
  let recentEstimatedRequests = 0;

  for (const rawRow of rows) {
    const route = String(rawRow?.route || '').trim().toLowerCase();
    const status = String(rawRow?.status || 'UNKNOWN').trim().toUpperCase();
    if (!['orders', 'analytics', 'inventory', 'downloads'].includes(route)) continue;
    if (!routes.has(route)) {
      routes.set(route, {
        route,
        estimatedRequests: 0,
        recentEstimatedRequests: 0,
        cacheStatuses: {},
        weightedDuration: 0,
        responseBytes: 0,
        workersRequestsExpected: 0,
        kvReadsExpected: 0,
        kvListExpected: 0,
        r2ReadsExpected: 0,
        r2ListExpected: 0,
        providerCallsExpected: 0
      });
    }
    const summary = routes.get(route);
    const count = numeric(rawRow.estimatedRequests);
    const recent = numeric(rawRow.recentEstimatedRequests);
    summary.estimatedRequests += count;
    summary.recentEstimatedRequests += recent;
    summary.cacheStatuses[status] = (summary.cacheStatuses[status] || 0) + count;
    summary.weightedDuration += numeric(rawRow.averageDurationMs) * count;
    for (const key of [
      'responseBytes',
      'workersRequestsExpected',
      'kvReadsExpected',
      'kvListExpected',
      'r2ReadsExpected',
      'r2ListExpected',
      'providerCallsExpected'
    ]) {
      summary[key] += numeric(rawRow[key]);
    }
    recentEstimatedRequests += recent;
  }

  const routeSummaries = Array.from(routes.values()).map((summary) => {
    const hits = Array.from(HIT_STATUSES).reduce((sum, status) => sum + numeric(summary.cacheStatuses[status]), 0);
    const hitRatioPercent = summary.estimatedRequests > 0
      ? Number(((hits / summary.estimatedRequests) * 100).toFixed(2))
      : 0;
    const enoughData = summary.estimatedRequests >= minimumRequests;
    return {
      route: summary.route,
      estimatedRequests: summary.estimatedRequests,
      recentEstimatedRequests: summary.recentEstimatedRequests,
      cacheStatuses: summary.cacheStatuses,
      hitRatioPercent,
      averageDurationMs: summary.estimatedRequests > 0
        ? Number((summary.weightedDuration / summary.estimatedRequests).toFixed(2))
        : 0,
      responseBytes: summary.responseBytes,
      workersRequestsExpected: summary.workersRequestsExpected,
      kvReadsExpected: summary.kvReadsExpected,
      kvListExpected: summary.kvListExpected,
      r2ReadsExpected: summary.r2ReadsExpected,
      r2ListExpected: summary.r2ListExpected,
      providerCallsExpected: summary.providerCallsExpected,
      evidenceState: enoughData ? 'evaluated' : 'insufficient_data',
      gatePassed: !enoughData || hitRatioPercent >= minimumHitRatioPercent
    };
  }).sort((left, right) => left.route.localeCompare(right.route));

  return {
    minimumRequests,
    minimumHitRatioPercent,
    maxRecentRequests,
    recentEstimatedRequests,
    lowTraffic: recentEstimatedRequests <= maxRecentRequests,
    routes: routeSummaries,
    gatesPassed: routeSummaries.every((route) => route.gatePassed)
  };
}

async function queryAnalyticsEngine({ accountId, apiToken, query, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'text/plain; charset=utf-8',
        Accept: 'application/json'
      },
      body: query,
      redirect: 'error'
    }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Cloudflare Analytics Engine query failed with status ${response.status}.`);
  }
  return responseRows(body);
}

async function requestReadOnlyProbe({ workerBase, evidenceSecret, route, fetchImpl = fetch }) {
  const response = await fetchImpl(`${workerBase}/admin/workers-cache/evidence`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${evidenceSecret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ route }),
    redirect: 'error'
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Workers Cache read-only probe failed with status ${response.status}.`);
  return body;
}

function probeGate(probe = null) {
  if (!probe) return { state: 'skipped', passed: true, checks: [] };
  const repeatStatus = String(probe.repeat?.status || '').toUpperCase();
  const checks = [
    { id: 'sanitized', ok: probe.containsResponseBodies === false && probe.containsCredentials === false && probe.containsCustomerData === false },
    { id: 'repeat-cache-status', ok: HIT_STATUSES.has(repeatStatus) },
    { id: 'repeat-unchanged', ok: probe.route !== 'orders' || probe.repeat?.unchanged === true },
    { id: 'repeat-zero-kv-reads', ok: numeric(probe.repeat?.writeBudget?.kvReadsExpected) === 0 && numeric(probe.repeat?.writeBudget?.kvListExpected) === 0 }
  ];
  return { state: 'evaluated', passed: checks.every((check) => check.ok), checks };
}

export async function collectWorkersCacheObservability(options = {}) {
  const accountId = normalizedAccountId(options.accountId);
  const apiToken = String(options.apiToken || '').trim();
  if (!apiToken) throw new Error('Workers Cache observability requires a Cloudflare Analytics API token.');
  const hours = boundedInteger(options.hours, 24, 1, 168);
  const recentMinutes = boundedInteger(options.recentMinutes, 15, 5, 120);
  const query = buildWorkersCacheAnalyticsQuery({ dataset: options.dataset, hours, recentMinutes });
  const rows = await queryAnalyticsEngine({ accountId, apiToken, query, fetchImpl: options.fetchImpl });
  const analytics = summarizeWorkersCacheAnalytics(rows, options);
  const workerBase = normalizedWorkerBase(options.workerBase);
  const evidenceSecret = String(options.evidenceSecret || '').trim();
  const probeRequested = options.probe !== false;
  let probe = null;
  let probeSkipReason = '';
  if (!probeRequested) {
    probeSkipReason = 'disabled_by_caller';
  } else if (!analytics.lowTraffic) {
    probeSkipReason = 'recent_traffic_above_threshold';
  } else if (!workerBase || !evidenceSecret) {
    probeSkipReason = 'probe_credentials_unavailable';
  } else {
    probe = await requestReadOnlyProbe({
      workerBase,
      evidenceSecret,
      route: options.route || 'orders',
      fetchImpl: options.fetchImpl
    });
  }
  const evaluatedProbe = probeGate(probe);
  const requestedProbeUnavailable = probeRequested && analytics.lowTraffic &&
    (!workerBase || !evidenceSecret);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataset: normalizedDataset(options.dataset),
    hours,
    recentMinutes,
    containsResponseBodies: false,
    containsCredentials: false,
    containsCustomerData: false,
    traffic: {
      recentEstimatedRequests: analytics.recentEstimatedRequests,
      maxRecentRequests: analytics.maxRecentRequests,
      lowTraffic: analytics.lowTraffic
    },
    acceptance: {
      minimumRequests: analytics.minimumRequests,
      minimumHitRatioPercent: analytics.minimumHitRatioPercent,
      passed: analytics.gatesPassed && evaluatedProbe.passed && !requestedProbeUnavailable
    },
    routes: analytics.routes,
    probe: probe ? {
      route: probe.route,
      measuredAt: probe.measuredAt,
      probe: probe.probe,
      repeat: probe.repeat,
      requestBudget: probe.requestBudget
    } : null,
    probeState: evaluatedProbe.state,
    probeSkipReason,
    probeChecks: evaluatedProbe.checks
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
    console.log('Usage: node scripts/workers-cache-observability.mjs [--hours=24] [--recent-minutes=15] [--max-recent-requests=25] [--minimum-requests=10] [--minimum-hit-ratio-percent=50] [--no-probe] [--output=FILE] [--strict]');
    console.log('Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_ANALYTICS_API_TOKEN. A low-traffic probe also requires WORKER_BASE and WORKERS_CACHE_EVIDENCE_SECRET.');
    return;
  }
  const result = await collectWorkersCacheObservability({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_ANALYTICS_API_TOKEN || process.env.CLOUDFLARE_USAGE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN,
    dataset: valueArg(args, '--dataset', process.env.WORKERS_CACHE_ANALYTICS_DATASET || DEFAULT_DATASET),
    workerBase: valueArg(args, '--worker-base', process.env.WORKER_BASE || ''),
    evidenceSecret: process.env.WORKERS_CACHE_EVIDENCE_SECRET || '',
    route: valueArg(args, '--route', 'orders'),
    hours: valueArg(args, '--hours', '24'),
    recentMinutes: valueArg(args, '--recent-minutes', '15'),
    maxRecentRequests: valueArg(args, '--max-recent-requests', '25'),
    minimumRequests: valueArg(args, '--minimum-requests', '10'),
    minimumHitRatioPercent: valueArg(args, '--minimum-hit-ratio-percent', '50'),
    probe: !args.includes('--no-probe')
  });
  writeOutput(valueArg(args, '--output', ''), result);
  console.log(JSON.stringify(result, null, 2));
  if (args.includes('--strict') && !result.acceptance.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

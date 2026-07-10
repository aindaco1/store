#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_DATASET = 'store_workers_cache_metrics';
const HIT_STATUSES = new Set(['HIT', 'UPDATING']);
const CACHE_STATUSES = Object.freeze([
  'HIT',
  'MISS',
  'EXPIRED',
  'REVALIDATED',
  'UPDATING',
  'STALE',
  'BYPASS',
  'DISABLED',
  'UNAVAILABLE',
  'ERROR'
]);

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

function normalizedScriptName(value) {
  const scriptName = String(value || '').trim();
  if (!scriptName) return '';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(scriptName)) {
    throw new Error('Cloudflare Worker script name is invalid.');
  }
  return scriptName;
}

function normalizedQueryStart(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Workers Cache analytics start time is invalid.');
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

function statusColumn(status) {
  const camel = status.toLowerCase().replace(/_([a-z])/g, (_, character) => character.toUpperCase());
  return `${camel}Requests`;
}

export function buildWorkersCacheAnalyticsQuery(options = {}) {
  const dataset = normalizedDataset(options.dataset);
  const hours = boundedInteger(options.hours, 24, 1, 168);
  const recentMinutes = boundedInteger(options.recentMinutes, 15, 5, 120);
  const queryStart = normalizedQueryStart(options.since);
  const timePredicate = queryStart
    ? `timestamp >= toDateTime('${queryStart}')`
    : `timestamp >= NOW() - INTERVAL '${hours}' HOUR`;
  const statusColumns = CACHE_STATUSES.map((status) =>
    `  SUM(if(blob3 = '${status}', _sample_interval, 0)) AS ${statusColumn(status)}`
  ).join(',\n');
  return `SELECT
  blob2 AS route,
  SUM(_sample_interval) AS estimatedRequests,
  SUM(if(timestamp >= NOW() - INTERVAL '${recentMinutes}' MINUTE, _sample_interval, 0)) AS recentEstimatedRequests,
  SUM(_sample_interval * double1) / SUM(_sample_interval) AS averageDurationMs,
  quantileExactWeighted(0.50)(double1, _sample_interval) AS p50DurationMs,
  quantileExactWeighted(0.95)(double1, _sample_interval) AS p95DurationMs,
  quantileExactWeighted(0.99)(double1, _sample_interval) AS p99DurationMs,
  MIN(double1) AS minimumDurationMs,
  MAX(double1) AS maximumDurationMs,
  argMax(blob3, double1) AS maximumDurationStatus,
  argMax(double4, double1) AS maximumDurationKvReadsExpected,
  argMax(double5, double1) AS maximumDurationKvListExpected,
  SUM(_sample_interval * double2) AS responseBytes,
  SUM(_sample_interval * double3) AS workersRequestsExpected,
  SUM(_sample_interval * double4) AS kvReadsExpected,
  SUM(_sample_interval * double5) AS kvListExpected,
  SUM(_sample_interval * double6) AS r2ReadsExpected,
  SUM(_sample_interval * double7) AS r2ListExpected,
  SUM(_sample_interval * double8) AS providerCallsExpected,
${statusColumns}
FROM ${dataset}
WHERE ${timePredicate}
  AND blob1 = 'store-workers-cache-v1'
  AND blob5 = 'enabled'
GROUP BY route
ORDER BY route`;
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
    if (!['orders', 'analytics', 'inventory', 'downloads'].includes(route)) continue;
    if (!routes.has(route)) {
      routes.set(route, {
        route,
        estimatedRequests: 0,
        recentEstimatedRequests: 0,
        cacheStatuses: {},
        weightedDuration: 0,
        latencyMs: { p50: 0, p95: 0, p99: 0, min: 0, max: 0 },
        maximumDurationStatus: 'UNKNOWN',
        maximumDurationKvReadsExpected: 0,
        maximumDurationKvListExpected: 0,
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
    const legacyStatus = String(rawRow?.status || '').trim().toUpperCase();
    if (legacyStatus) {
      summary.cacheStatuses[legacyStatus] = (summary.cacheStatuses[legacyStatus] || 0) + count;
    } else {
      for (const status of CACHE_STATUSES) {
        const statusCount = numeric(rawRow[statusColumn(status)]);
        if (statusCount > 0) summary.cacheStatuses[status] = statusCount;
      }
    }
    summary.weightedDuration += numeric(rawRow.averageDurationMs) * count;
    summary.latencyMs = {
      p50: numeric(rawRow.p50DurationMs),
      p95: numeric(rawRow.p95DurationMs),
      p99: numeric(rawRow.p99DurationMs),
      min: numeric(rawRow.minimumDurationMs),
      max: numeric(rawRow.maximumDurationMs)
    };
    summary.maximumDurationStatus = String(rawRow.maximumDurationStatus || 'UNKNOWN').trim().toUpperCase();
    summary.maximumDurationKvReadsExpected = numeric(rawRow.maximumDurationKvReadsExpected);
    summary.maximumDurationKvListExpected = numeric(rawRow.maximumDurationKvListExpected);
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
      latencyMs: summary.latencyMs,
      maximumDurationSample: {
        status: summary.maximumDurationStatus,
        durationMs: summary.latencyMs.max,
        kvReadsExpected: summary.maximumDurationKvReadsExpected,
        kvListExpected: summary.maximumDurationKvListExpected
      },
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

function deploymentRows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.deployments)) return value.deployments;
  if (Array.isArray(value?.result?.deployments)) return value.result.deployments;
  return [];
}

function readWorkerDeployments(filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Cloudflare Worker deployments evidence must be a regular file.');
  }
  return deploymentRows(JSON.parse(fs.readFileSync(resolved, 'utf8')));
}

async function queryWorkerDeployments({ accountId, apiToken, scriptName, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/deployments`,
    {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
      redirect: 'error'
    }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Cloudflare Worker deployments query failed with status ${response.status}.`);
  return deploymentRows(body);
}

export function summarizeWorkerDeployments(deployments = [], options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const hours = boundedInteger(options.hours, 24, 1, 168);
  const minimumStableHours = boundedNumber(options.minimumStableHours, 4, 0, 168);
  const startMs = now.getTime() - (hours * 60 * 60 * 1000);
  const normalized = deployments.map((deployment) => {
    const createdAt = new Date(String(deployment?.created_on || deployment?.createdAt || ''));
    return {
      createdAt,
      trigger: String(deployment?.annotations?.['workers/triggered_by'] || deployment?.trigger || 'unknown')
        .trim().toLowerCase().slice(0, 48)
    };
  }).filter((deployment) => Number.isFinite(deployment.createdAt.getTime()) && deployment.createdAt <= now)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const latest = normalized[0] || null;
  const latestAgeHours = latest
    ? Math.max(0, (now.getTime() - latest.createdAt.getTime()) / (60 * 60 * 1000))
    : null;
  const deploymentsInWindow = normalized.filter((deployment) => deployment.createdAt.getTime() >= startMs);
  return {
    checked: true,
    deploymentsInWindow: deploymentsInWindow.length,
    latestDeploymentAt: latest?.createdAt.toISOString() || '',
    latestDeploymentTrigger: latest?.trigger || '',
    latestDeploymentAgeHours: latestAgeHours === null ? null : Number(latestAgeHours.toFixed(2)),
    minimumStableHours,
    stable: latestAgeHours === null || latestAgeHours >= minimumStableHours,
    analyticsSince: latest && latest.createdAt.getTime() >= startMs ? latest.createdAt.toISOString() : '',
    containsDeploymentIds: false,
    containsAuthorIdentity: false
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
    { id: 'bounded-probe-reads', ok: numeric(probe.requestBudget?.probeReads) === 3 },
    { id: 'warmup-unchanged', ok: probe.route !== 'orders' || probe.warmup?.unchanged === true },
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
  const scriptName = normalizedScriptName(options.scriptName);
  const deploymentApiToken = String(options.deploymentApiToken || apiToken).trim();
  let deployments = {
    checked: false,
    deploymentsInWindow: 0,
    latestDeploymentAt: '',
    latestDeploymentTrigger: '',
    latestDeploymentAgeHours: null,
    minimumStableHours: boundedNumber(options.minimumStableHours, 4, 0, 168),
    stable: true,
    analyticsSince: '',
    containsDeploymentIds: false,
    containsAuthorIdentity: false
  };
  if (scriptName) {
    const deploymentFileData = readWorkerDeployments(options.deploymentsFile);
    if (!deploymentFileData && !deploymentApiToken) {
      throw new Error('Workers Cache deployment evidence requires a Cloudflare Workers read token or deployments file.');
    }
    const deploymentData = deploymentFileData || await queryWorkerDeployments({
      accountId,
      apiToken: deploymentApiToken,
      scriptName,
      fetchImpl: options.fetchImpl
    });
    deployments = summarizeWorkerDeployments(deploymentData, {
      hours,
      minimumStableHours: options.minimumStableHours,
      now: options.now
    });
  }
  const query = buildWorkersCacheAnalyticsQuery({
    dataset: options.dataset,
    hours,
    recentMinutes,
    since: deployments.analyticsSince
  });
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
  const evaluatedRoutes = analytics.routes.filter((route) => route.evidenceState === 'evaluated');
  let acceptanceState = 'passed';
  if (!evaluatedProbe.passed || requestedProbeUnavailable) {
    acceptanceState = 'failed';
  } else if (!deployments.stable || evaluatedRoutes.length === 0) {
    acceptanceState = 'inconclusive';
  } else if (!analytics.gatesPassed) {
    acceptanceState = 'failed';
  }
  return {
    schemaVersion: 2,
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
    deployments,
    acceptance: {
      minimumRequests: analytics.minimumRequests,
      minimumHitRatioPercent: analytics.minimumHitRatioPercent,
      minimumStableHours: deployments.minimumStableHours,
      evaluatedRoutes: evaluatedRoutes.map((route) => route.route),
      state: acceptanceState,
      conclusive: acceptanceState !== 'inconclusive',
      passed: acceptanceState === 'passed'
    },
    routes: analytics.routes,
    probe: probe ? {
      route: probe.route,
      measuredAt: probe.measuredAt,
      probe: probe.probe,
      warmup: probe.warmup,
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
    console.log('Usage: node scripts/workers-cache-observability.mjs [--hours=24] [--recent-minutes=15] [--max-recent-requests=25] [--minimum-requests=10] [--minimum-hit-ratio-percent=50] [--minimum-stable-hours=4] [--worker-script=NAME] [--deployments-file=FILE] [--no-probe] [--output=FILE] [--strict]');
    console.log('Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_ANALYTICS_API_TOKEN. Deployment-aware evidence also requires CLOUDFLARE_WORKERS_API_TOKEN and a Worker script name. A low-traffic probe requires WORKER_BASE and WORKERS_CACHE_EVIDENCE_SECRET.');
    return;
  }
  const result = await collectWorkersCacheObservability({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_ANALYTICS_API_TOKEN || process.env.CLOUDFLARE_USAGE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN,
    deploymentApiToken: process.env.CLOUDFLARE_WORKERS_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '',
    scriptName: valueArg(args, '--worker-script', process.env.CLOUDFLARE_WORKER_SCRIPT_NAME || ''),
    deploymentsFile: valueArg(args, '--deployments-file', ''),
    dataset: valueArg(args, '--dataset', process.env.WORKERS_CACHE_ANALYTICS_DATASET || DEFAULT_DATASET),
    workerBase: valueArg(args, '--worker-base', process.env.WORKER_BASE || ''),
    evidenceSecret: process.env.WORKERS_CACHE_EVIDENCE_SECRET || '',
    route: valueArg(args, '--route', 'orders'),
    hours: valueArg(args, '--hours', '24'),
    recentMinutes: valueArg(args, '--recent-minutes', '15'),
    maxRecentRequests: valueArg(args, '--max-recent-requests', '25'),
    minimumRequests: valueArg(args, '--minimum-requests', '10'),
    minimumHitRatioPercent: valueArg(args, '--minimum-hit-ratio-percent', '50'),
    minimumStableHours: valueArg(args, '--minimum-stable-hours', '4'),
    probe: !args.includes('--no-probe')
  });
  writeOutput(valueArg(args, '--output', ''), result);
  console.log(JSON.stringify(result, null, 2));
  if (args.includes('--strict') && result.acceptance.state === 'failed') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

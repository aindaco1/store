import { adminStoreReadCachePolicy } from './workers-cache-policy.js';

export const WORKERS_CACHE_METRIC_SCHEMA = 'store-workers-cache-v1';
export const WORKERS_CACHE_METRIC_BLOBS = Object.freeze([
  'schema',
  'route',
  'status',
  'bypass',
  'cacheState'
]);
export const WORKERS_CACHE_METRIC_DOUBLES = Object.freeze([
  'durationMs',
  'responseBytes',
  'workersRequestsExpected',
  'kvReadsExpected',
  'kvListExpected',
  'r2ReadsExpected',
  'r2ListExpected',
  'providerCallsExpected'
]);

const CACHE_STATUSES = new Set([
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

function enabledValue(value, fallback = true) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function boundedNumber(value, maximum) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(number, maximum);
}

function normalizedStatus(value) {
  const status = String(value || 'unavailable').trim().toUpperCase();
  return CACHE_STATUSES.has(status) ? status : 'UNAVAILABLE';
}

function normalizedBypass(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .slice(0, 48);
}

export function workersCacheTelemetryEnabled(env = {}) {
  return enabledValue(env.WORKERS_CACHE_TELEMETRY_ENABLED, true) &&
    typeof env.STORE_CACHE_METRICS?.writeDataPoint === 'function';
}

export function buildWorkersCacheMetric(metric = {}) {
  const routeId = String(metric.routeId || '').trim().toLowerCase();
  const policy = adminStoreReadCachePolicy(routeId);
  if (!policy) return null;
  const status = normalizedStatus(metric.status);
  const budget = metric.writeBudget || {};
  return {
    indexes: [`${WORKERS_CACHE_METRIC_SCHEMA}:${routeId}`],
    blobs: [
      WORKERS_CACHE_METRIC_SCHEMA,
      routeId,
      status,
      normalizedBypass(metric.bypass),
      metric.enabled === false ? 'disabled' : 'enabled'
    ],
    doubles: [
      boundedNumber(metric.durationMs, 300_000),
      boundedNumber(metric.responseBytes, 50 * 1024 * 1024),
      boundedNumber(budget.workersRequestsExpected, 1000),
      boundedNumber(budget.kvReadsExpected, 1000),
      boundedNumber(budget.kvListExpected, 1000),
      boundedNumber(budget.r2ReadsExpected, 1000),
      boundedNumber(budget.r2ListExpected, 1000),
      boundedNumber(budget.providerCallsExpected, 1000)
    ]
  };
}

export function recordWorkersCacheMetric(env = {}, metric = {}) {
  if (!workersCacheTelemetryEnabled(env)) return false;
  const dataPoint = buildWorkersCacheMetric(metric);
  if (!dataPoint) return false;
  try {
    env.STORE_CACHE_METRICS.writeDataPoint(dataPoint);
    return true;
  } catch {
    return false;
  }
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  buildWorkersCacheAnalyticsQuery,
  collectWorkersCacheObservability,
  summarizeWorkerDeployments,
  summarizeWorkersCacheAnalytics
} from '../../scripts/workers-cache-observability.mjs';

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';

function analyticsRows(recentEstimatedRequests = 2) {
  return [
    {
      route: 'orders',
      status: 'HIT',
      estimatedRequests: 80,
      recentEstimatedRequests,
      averageDurationMs: 10,
      responseBytes: 8000,
      workersRequestsExpected: 80,
      kvReadsExpected: 0,
      kvListExpected: 0,
      r2ReadsExpected: 0,
      r2ListExpected: 0,
      providerCallsExpected: 0
    },
    {
      route: 'orders',
      status: 'MISS',
      estimatedRequests: 20,
      recentEstimatedRequests: 0,
      averageDurationMs: 50,
      responseBytes: 4000,
      workersRequestsExpected: 20,
      kvReadsExpected: 20,
      kvListExpected: 20,
      r2ReadsExpected: 0,
      r2ListExpected: 0,
      providerCallsExpected: 0
    }
  ];
}

describe('Workers Cache observability evidence', () => {
  it('builds a bounded dataset query without credentials or customer dimensions', () => {
    const query = buildWorkersCacheAnalyticsQuery({
      dataset: 'store_workers_cache_metrics',
      hours: 24,
      recentMinutes: 15
    });
    expect(query).toContain('FROM store_workers_cache_metrics');
    expect(query).toContain("blob1 = 'store-workers-cache-v1'");
    expect(query).toContain("INTERVAL '15' MINUTE");
    expect(query).toContain("INTERVAL '24' HOUR");
    expect(query).toContain('quantileExactWeighted(0.95)(double1, _sample_interval)');
    expect(query).toContain("SUM(if(blob3 = 'HIT', _sample_interval, 0)) AS hitRequests");
    expect(query).toContain("blob5 = 'enabled'");
    expect(query).not.toMatch(/email|orderToken|query string|cookie|authorization/i);
    expect(() => buildWorkersCacheAnalyticsQuery({ dataset: 'metrics; DROP TABLE orders' })).toThrow(/dataset/i);
  });

  it('summarizes route percentiles, cache statuses, and the worst operation-budget sample', () => {
    const result = summarizeWorkersCacheAnalytics([{
      route: 'orders',
      estimatedRequests: 12,
      recentEstimatedRequests: 1,
      averageDurationMs: 24,
      p50DurationMs: 5,
      p95DurationMs: 90,
      p99DurationMs: 120,
      minimumDurationMs: 3,
      maximumDurationMs: 130,
      maximumDurationStatus: 'MISS',
      maximumDurationKvReadsExpected: 2500,
      maximumDurationKvListExpected: 1,
      hitRequests: 9,
      missRequests: 3,
      responseBytes: 12000,
      workersRequestsExpected: 12,
      kvReadsExpected: 2503,
      kvListExpected: 3
    }], { minimumRequests: 10, minimumHitRatioPercent: 50 });

    expect(result.routes[0]).toMatchObject({
      cacheStatuses: { HIT: 9, MISS: 3 },
      hitRatioPercent: 75,
      latencyMs: { p50: 5, p95: 90, p99: 120, min: 3, max: 130 },
      maximumDurationSample: {
        status: 'MISS',
        durationMs: 130,
        kvReadsExpected: 2500,
        kvListExpected: 1
      }
    });
  });

  it('marks deployment-contaminated windows as unstable without retaining deployment identities', () => {
    const deployments = summarizeWorkerDeployments([{
      id: 'deployment-secret-id',
      author_email: 'operator@example.com',
      created_on: '2026-07-10T10:00:00.000Z',
      annotations: { 'workers/triggered_by': 'deployment' }
    }], {
      now: '2026-07-10T12:00:00.000Z',
      hours: 24,
      minimumStableHours: 4
    });

    expect(deployments).toMatchObject({
      deploymentsInWindow: 1,
      latestDeploymentAt: '2026-07-10T10:00:00.000Z',
      latestDeploymentTrigger: 'deployment',
      latestDeploymentAgeHours: 2,
      minimumStableHours: 4,
      stable: false,
      analyticsSince: '2026-07-10T10:00:00.000Z',
      containsDeploymentIds: false,
      containsAuthorIdentity: false
    });
    expect(JSON.stringify(deployments)).not.toContain('deployment-secret-id');
    expect(JSON.stringify(deployments)).not.toContain('operator@example.com');
  });

  it('calculates weighted hit ratios, usage totals, and the recent-traffic gate', () => {
    const result = summarizeWorkersCacheAnalytics(analyticsRows(), {
      minimumRequests: 30,
      minimumHitRatioPercent: 60,
      maxRecentRequests: 5
    });
    expect(result).toMatchObject({
      recentEstimatedRequests: 2,
      lowTraffic: true,
      gatesPassed: true,
      routes: [{
        route: 'orders',
        estimatedRequests: 100,
        hitRatioPercent: 80,
        averageDurationMs: 18,
        kvReadsExpected: 20,
        kvListExpected: 20,
        evidenceState: 'evaluated',
        gatePassed: true
      }]
    });
  });

  it('queries aggregate telemetry and runs the sanitized probe only under the traffic ceiling', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/analytics_engine/sql')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer analytics-secret' });
        return new Response(JSON.stringify({ data: analyticsRows() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      expect(url).toBe('https://checkout.example.com/admin/workers-cache/evidence');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer evidence-secret' });
      return new Response(JSON.stringify({
        schemaVersion: 1,
        measuredAt: '2026-07-09T00:00:00.000Z',
        route: 'orders',
        containsResponseBodies: false,
        containsCredentials: false,
        containsCustomerData: false,
        probe: { status: 'MISS', unchanged: false, writeBudget: { kvReadsExpected: 1, kvListExpected: 1 } },
        warmup: { status: 'MISS', unchanged: true, writeBudget: { kvReadsExpected: 1, kvListExpected: 1 } },
        repeat: { status: 'HIT', unchanged: true, writeBudget: { kvReadsExpected: 0, kvListExpected: 0 } },
        requestBudget: {
          probeReads: 3,
          fullLookupReads: 1,
          noChangeWarmupReads: 1,
          noChangeRepeatReads: 1,
          rateLimitKvReadsExpected: 1,
          rateLimitKvWritesExpected: 1
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    const result = await collectWorkersCacheObservability({
      accountId: ACCOUNT_ID,
      apiToken: 'analytics-secret',
      workerBase: 'https://checkout.example.com',
      evidenceSecret: 'evidence-secret',
      maxRecentRequests: 5,
      minimumRequests: 30,
      minimumHitRatioPercent: 60,
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      containsResponseBodies: false,
      containsCredentials: false,
      containsCustomerData: false,
      traffic: { lowTraffic: true },
      acceptance: { passed: true },
      probeState: 'evaluated',
      probeChecks: expect.arrayContaining([
        expect.objectContaining({ id: 'bounded-probe-reads', ok: true }),
        expect.objectContaining({ id: 'warmup-unchanged', ok: true }),
        expect.objectContaining({ id: 'repeat-cache-status', ok: true }),
        expect.objectContaining({ id: 'repeat-zero-kv-reads', ok: true })
      ])
    });
    expect(JSON.stringify(result)).not.toContain('analytics-secret');
    expect(JSON.stringify(result)).not.toContain('evidence-secret');
  });

  it('skips the probe at higher traffic without treating insufficient data as a false failure', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: analyticsRows(30) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    const result = await collectWorkersCacheObservability({
      accountId: ACCOUNT_ID,
      apiToken: 'analytics-secret',
      workerBase: 'https://checkout.example.com',
      evidenceSecret: 'evidence-secret',
      maxRecentRequests: 5,
      minimumRequests: 1000,
      fetchImpl
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.traffic.lowTraffic).toBe(false);
    expect(result.probeState).toBe('skipped');
    expect(result.probeSkipReason).toBe('recent_traffic_above_threshold');
    expect(result.routes[0]).toMatchObject({ evidenceState: 'insufficient_data', gatePassed: true });
  });

  it('fails acceptance when a requested low-traffic probe lacks its dedicated credential', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    const result = await collectWorkersCacheObservability({
      accountId: ACCOUNT_ID,
      apiToken: 'analytics-secret',
      workerBase: 'https://checkout.example.com',
      evidenceSecret: '',
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.traffic.lowTraffic).toBe(true);
    expect(result.probeSkipReason).toBe('probe_credentials_unavailable');
    expect(result.acceptance.passed).toBe(false);
  });

  it('passes conclusively as not applicable when every optional route is disabled', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/analytics_engine/sql')) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({
        schemaVersion: 1,
        measuredAt: '2026-07-10T00:00:00.000Z',
        route: 'orders',
        containsResponseBodies: false,
        containsCredentials: false,
        containsCustomerData: false,
        probe: { status: 'DISABLED', unchanged: false, writeBudget: { kvReadsExpected: 1, kvListExpected: 1 } },
        warmup: { status: 'DISABLED', unchanged: true, writeBudget: { kvReadsExpected: 1, kvListExpected: 1 } },
        repeat: { status: 'DISABLED', unchanged: true, writeBudget: { kvReadsExpected: 0, kvListExpected: 0 } },
        requestBudget: { probeReads: 3 }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const result = await collectWorkersCacheObservability({
      accountId: ACCOUNT_ID,
      apiToken: 'analytics-secret',
      workerBase: 'https://checkout.example.com',
      evidenceSecret: 'evidence-secret',
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.acceptance).toMatchObject({
      state: 'not_applicable',
      reason: 'no_enabled_candidates',
      conclusive: true,
      passed: true,
      evaluatedRoutes: []
    });
    expect(result.probeState).toBe('not_applicable');
    expect(result.probeChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sanitized', ok: true }),
      expect.objectContaining({ id: 'bounded-probe-reads', ok: true }),
      expect.objectContaining({ id: 'expected-route', ok: true }),
      expect.objectContaining({ id: 'disabled-route-consistent', ok: true }),
      expect.objectContaining({ id: 'repeat-zero-kv-reads', ok: true })
    ]));
  });

  it('fails closed when a disabled-route probe leaks data or exceeds its budget', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/analytics_engine/sql')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        route: 'orders',
        containsResponseBodies: true,
        containsCredentials: false,
        containsCustomerData: false,
        probe: { status: 'DISABLED' },
        warmup: { status: 'DISABLED', unchanged: true },
        repeat: { status: 'DISABLED', unchanged: true, writeBudget: { kvReadsExpected: 0, kvListExpected: 0 } },
        requestBudget: { probeReads: 4 }
      }), { status: 200 });
    });

    const result = await collectWorkersCacheObservability({
      accountId: ACCOUNT_ID,
      apiToken: 'analytics-secret',
      workerBase: 'https://checkout.example.com',
      evidenceSecret: 'evidence-secret',
      fetchImpl
    });

    expect(result.acceptance).toMatchObject({ state: 'failed', reason: 'probe_failed', passed: false });
    expect(result.probeChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sanitized', ok: false }),
      expect.objectContaining({ id: 'bounded-probe-reads', ok: false })
    ]));
  });

  it('fails when the selected probe route is disabled but aggregate evidence has an enabled candidate', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/analytics_engine/sql')) {
        return new Response(JSON.stringify({ data: [{
          route: 'analytics',
          estimatedRequests: 30,
          recentEstimatedRequests: 0,
          averageDurationMs: 8,
          hitRequests: 30
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        route: 'orders',
        containsResponseBodies: false,
        containsCredentials: false,
        containsCustomerData: false,
        probe: { status: 'DISABLED' },
        warmup: { status: 'DISABLED', unchanged: true },
        repeat: { status: 'DISABLED', unchanged: true, writeBudget: { kvReadsExpected: 0, kvListExpected: 0 } },
        requestBudget: { probeReads: 3 }
      }), { status: 200 });
    });

    const result = await collectWorkersCacheObservability({
      accountId: ACCOUNT_ID,
      apiToken: 'analytics-secret',
      workerBase: 'https://checkout.example.com',
      evidenceSecret: 'evidence-secret',
      minimumRequests: 10,
      fetchImpl
    });

    expect(result.acceptance).toMatchObject({
      state: 'failed',
      reason: 'probe_route_disabled_with_enabled_candidates',
      passed: false,
      evaluatedRoutes: ['analytics']
    });
  });

  it('uses current-deployment telemetry and reports a warming deployment as inconclusive', async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/workers/scripts/store-worker/deployments')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer workers-read-secret' });
        return new Response(JSON.stringify({ result: { deployments: [{
          created_on: '2026-07-10T11:00:00.000Z',
          annotations: { 'workers/triggered_by': 'deployment' }
        }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/analytics_engine/sql')) {
        expect(String(init?.body)).toContain("timestamp >= toDateTime('2026-07-10 11:00:00')");
        return new Response(JSON.stringify({ data: [{
          route: 'orders',
          estimatedRequests: 10,
          recentEstimatedRequests: 0,
          averageDurationMs: 20,
          hitRequests: 2,
          missRequests: 8
        }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        schemaVersion: 1,
        measuredAt: now.toISOString(),
        route: 'orders',
        containsResponseBodies: false,
        containsCredentials: false,
        containsCustomerData: false,
        probe: { status: 'MISS', unchanged: false, writeBudget: { kvReadsExpected: 1, kvListExpected: 0 } },
        warmup: { status: 'MISS', unchanged: true, writeBudget: { kvReadsExpected: 1, kvListExpected: 0 } },
        repeat: { status: 'HIT', unchanged: true, writeBudget: { kvReadsExpected: 0, kvListExpected: 0 } },
        requestBudget: { probeReads: 3 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const result = await collectWorkersCacheObservability({
      accountId: ACCOUNT_ID,
      apiToken: 'analytics-secret',
      deploymentApiToken: 'workers-read-secret',
      scriptName: 'store-worker',
      workerBase: 'https://checkout.example.com',
      evidenceSecret: 'evidence-secret',
      minimumRequests: 10,
      minimumHitRatioPercent: 50,
      minimumStableHours: 4,
      now,
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.deployments).toMatchObject({ stable: false, deploymentsInWindow: 1 });
    expect(result.routes[0]).toMatchObject({ hitRatioPercent: 20, gatePassed: false });
    expect(result.acceptance).toMatchObject({ state: 'inconclusive', conclusive: false, passed: false });
  });

  it('accepts a Wrangler deployment file without sending deployment credentials', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-cache-deployments-'));
    const deploymentsFile = path.join(root, 'deployments.json');
    fs.writeFileSync(deploymentsFile, JSON.stringify([{
      created_on: '2026-07-10T06:00:00.000Z',
      annotations: { 'workers/triggered_by': 'deployment' }
    }]));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/analytics_engine/sql');
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    try {
      const result = await collectWorkersCacheObservability({
        accountId: ACCOUNT_ID,
        apiToken: 'analytics-secret',
        deploymentApiToken: '',
        scriptName: 'store-worker',
        deploymentsFile,
        probe: false,
        now: new Date('2026-07-10T12:00:00.000Z'),
        fetchImpl
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(result.deployments).toMatchObject({ checked: true, stable: true });
      expect(result.acceptance).toMatchObject({ state: 'inconclusive' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

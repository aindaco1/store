import { describe, expect, it, vi } from 'vitest';

import {
  buildWorkersCacheAnalyticsQuery,
  collectWorkersCacheObservability,
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
    expect(query).not.toMatch(/email|orderToken|query string|cookie|authorization/i);
    expect(() => buildWorkersCacheAnalyticsQuery({ dataset: 'metrics; DROP TABLE orders' })).toThrow(/dataset/i);
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
});

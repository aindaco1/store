import { describe, expect, it } from 'vitest';

import {
  compareWorkersCacheEvidence,
  percentile,
  runWorkersCacheBenchmark,
  summarizeCacheSamples
} from '../../scripts/workers-cache-benchmark.mjs';

function evidence(mode: 'enabled' | 'disabled', candidateP95 = 40) {
  const status = mode === 'enabled' ? { HIT: 30 } : { DISABLED: 30 };
  const backendReads = mode === 'enabled' ? 0 : 30;
  const warm = {
    samples: 30,
    latencyMs: { p50: candidateP95, p95: candidateP95, p99: candidateP95 },
    responseBytes: 3000,
    unchanged: 0,
    workersRequestsExpected: mode === 'enabled' ? 30 : 0,
    kvReadsExpected: backendReads,
    kvListExpected: backendReads,
    r2ReadsExpected: 0,
    r2ListExpected: 0,
    providerCallsExpected: 0,
    cacheStatuses: status,
    cacheBypasses: {}
  };
  return {
    schemaVersion: 2,
    route: 'orders',
    mode,
    containsResponseBodies: false,
    containsCredentials: false,
    cases: {
      ordersWarm: warm,
      ordersNoChange: { ...warm, unchanged: 30 },
      ordersSearchBypass: {
        ...warm,
        cacheStatuses: { UNAVAILABLE: 30 },
        cacheBypasses: { search_query: 30 }
      },
      ordersPostPurge: {
        ...warm,
        samples: 1,
        cacheStatuses: mode === 'enabled' ? { MISS: 1 } : { DISABLED: 1 }
      }
    }
  };
}

describe('Workers Cache benchmark evidence', () => {
  it('calculates nearest-rank p50/p95/p99 latency', () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile(values, 0.99)).toBe(99);
    expect(percentile([], 0.95)).toBe(0);
  });

  it('aggregates read budgets and cache statuses without response bodies', () => {
    const summary = summarizeCacheSamples([
      { durationMs: 10, responseBytes: 100, cacheStatus: 'MISS', workersRequestsExpected: 1, kvReadsExpected: 5, kvListExpected: 1 },
      { durationMs: 4, responseBytes: 20, cacheStatus: 'HIT', workersRequestsExpected: 1, kvReadsExpected: 0, kvListExpected: 0 },
      { durationMs: 5, responseBytes: 20, cacheStatus: 'HIT', workersRequestsExpected: 1, kvReadsExpected: 0, kvListExpected: 0 }
    ]);
    expect(summary).toMatchObject({
      samples: 3,
      responseBytes: 140,
      workersRequestsExpected: 3,
      kvReadsExpected: 5,
      kvListExpected: 1,
      cacheStatuses: { MISS: 1, HIT: 2 }
    });
    expect(JSON.stringify(summary)).not.toContain('responseBody');
  });

  it('runs bounded enabled and disabled evidence sequences without persisting credentials', async () => {
    let cacheCold = true;
    let purges = 0;
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === 'POST') {
        purges += 1;
        cacheCold = true;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const search = url.searchParams.has('q');
      const noChange = url.searchParams.has('watermark');
      const cacheStatus = search ? '' : (cacheCold ? 'MISS' : 'HIT');
      cacheCold = false;
      return new Response(JSON.stringify({
        watermark: 'orders-v2-0123456789abcdef',
        unchanged: noChange,
        workersCache: search ? { status: 'unavailable', bypass: 'search_query' } : { status: cacheStatus, bypass: '' },
        writeBudget: {
          workersRequestsExpected: search ? 0 : 1,
          kvReadsExpected: cacheStatus === 'HIT' ? 0 : 1,
          kvListExpected: cacheStatus === 'HIT' ? 0 : 1
        }
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...(cacheStatus ? { 'X-Store-Workers-Cache': cacheStatus } : {})
        }
      });
    };
    const result = await runWorkersCacheBenchmark({
      workerBase: 'https://checkout.example.com',
      siteBase: 'https://shop.example.com',
      samples: 2,
      route: 'orders',
      mode: 'enabled',
      session: { cookie: 'store_admin_session=secret', csrfToken: 'csrf-secret' },
      fetchImpl
    });

    expect(purges).toBe(2);
    expect(result).toMatchObject({
      schemaVersion: 2,
      route: 'orders',
      mode: 'enabled',
      purgeRequests: 2,
      containsResponseBodies: false,
      containsCredentials: false
    });
    expect(result.cases.ordersCold.cacheStatuses).toEqual({ MISS: 1 });
    expect(result.cases.ordersWarm).toMatchObject({ samples: 2, cacheStatuses: { HIT: 2 } });
    expect(result.cases.ordersNoChange).toMatchObject({ samples: 2, unchanged: 2 });
    expect(result.cases.ordersSearchBypass.cacheBypasses).toEqual({ search_query: 2 });
    expect(result.cases.ordersPostPurge.cacheStatuses).toEqual({ MISS: 1 });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('passes only when disabled and enabled evidence satisfy every rollout gate', () => {
    const baseline = evidence('disabled', 100);
    const candidate = evidence('enabled', 40);
    const comparison = compareWorkersCacheEvidence(baseline, candidate);
    expect(comparison.passed).toBe(true);
    expect(comparison.checks.every((check) => check.ok)).toBe(true);

    const staleCandidate = evidence('enabled', 80);
    staleCandidate.cases.ordersWarm.kvReadsExpected = 1;
    staleCandidate.cases.ordersPostPurge.cacheStatuses = { HIT: 1 };
    const rejected = compareWorkersCacheEvidence(baseline, staleCandidate);
    expect(rejected.passed).toBe(false);
    expect(rejected.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'warm-zero-backend-order-reads', ok: false }),
      expect.objectContaining({ id: 'warm-p95-improvement', ok: false }),
      expect.objectContaining({ id: 'post-purge-refill', ok: false })
    ]));
  });
});

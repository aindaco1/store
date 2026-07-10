import { describe, expect, it } from 'vitest';

import {
  percentile,
  summarizeCacheSamples
} from '../../scripts/workers-cache-benchmark.mjs';

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
});

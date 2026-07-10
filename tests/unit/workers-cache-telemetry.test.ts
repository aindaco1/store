import { describe, expect, it, vi } from 'vitest';

import {
  WORKERS_CACHE_METRIC_BLOBS,
  WORKERS_CACHE_METRIC_DOUBLES,
  buildWorkersCacheMetric,
  recordWorkersCacheMetric,
  workersCacheTelemetryEnabled
} from '../../worker/src/workers-cache-telemetry.js';

describe('Workers Cache telemetry', () => {
  it('emits only bounded low-cardinality cache and operation fields', () => {
    const point = buildWorkersCacheMetric({
      routeId: 'orders',
      status: 'hit',
      bypass: '',
      enabled: true,
      durationMs: 12.5,
      responseBytes: 2048,
      writeBudget: {
        workersRequestsExpected: 1,
        kvReadsExpected: 0,
        kvListExpected: 0,
        r2ReadsExpected: 0,
        r2ListExpected: 0,
        providerCallsExpected: 0
      },
      userEmail: 'private@example.com',
      orderToken: 'store-order-private'
    });

    expect(WORKERS_CACHE_METRIC_BLOBS).toEqual(['schema', 'route', 'status', 'bypass', 'cacheState']);
    expect(WORKERS_CACHE_METRIC_DOUBLES).toEqual([
      'durationMs',
      'responseBytes',
      'workersRequestsExpected',
      'kvReadsExpected',
      'kvListExpected',
      'r2ReadsExpected',
      'r2ListExpected',
      'providerCallsExpected'
    ]);
    expect(point).toMatchObject({
      indexes: ['store-workers-cache-v1:orders'],
      blobs: ['store-workers-cache-v1', 'orders', 'HIT', '', 'enabled'],
      doubles: [12.5, 2048, 1, 0, 0, 0, 0, 0]
    });
    expect(JSON.stringify(point)).not.toContain('private@example.com');
    expect(JSON.stringify(point)).not.toContain('store-order-private');
  });

  it('fails closed for unsupported routes, disabled telemetry, and binding failures', () => {
    const writeDataPoint = vi.fn();
    expect(workersCacheTelemetryEnabled({ STORE_CACHE_METRICS: { writeDataPoint } })).toBe(true);
    expect(recordWorkersCacheMetric({
      STORE_CACHE_METRICS: { writeDataPoint },
      WORKERS_CACHE_TELEMETRY_ENABLED: 'false'
    }, { routeId: 'orders' })).toBe(false);
    expect(recordWorkersCacheMetric({ STORE_CACHE_METRICS: { writeDataPoint } }, { routeId: 'checkout' })).toBe(false);
    expect(writeDataPoint).not.toHaveBeenCalled();

    const throwing = vi.fn(() => {
      throw new Error('analytics unavailable');
    });
    expect(recordWorkersCacheMetric({ STORE_CACHE_METRICS: { writeDataPoint: throwing } }, {
      routeId: 'orders',
      status: 'MISS'
    })).toBe(false);
  });
});

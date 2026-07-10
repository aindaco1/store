import { describe, expect, it, vi } from 'vitest';

import {
  buildRecoveryTrafficQuery,
  collectRecoveryTrafficPreflight,
  summarizeRecoveryTraffic
} from '../../scripts/recovery-traffic-preflight.mjs';

describe('recovery traffic preflight', () => {
  it('uses Worker-wide invocation totals without route, identity, or order dimensions', () => {
    const query = buildRecoveryTrafficQuery();
    expect(query).toContain('workersInvocationsAdaptive');
    expect(query).toContain('scriptName: $scriptName');
    expect(query).toContain('sum { requests subrequests errors }');
    expect(query).not.toMatch(/email|orderToken|pathname|cookie/i);
  });

  it('fails the low-traffic gate on request volume or Worker errors', () => {
    expect(summarizeRecoveryTraffic([{ sum: { requests: 20, subrequests: 10, errors: 0 } }], {
      maximumRequests: 25,
      maximumErrors: 0
    })).toMatchObject({ requests: 20, lowTraffic: true });
    expect(summarizeRecoveryTraffic([{ sum: { requests: 26, subrequests: 10, errors: 0 } }], {
      maximumRequests: 25,
      maximumErrors: 0
    }).lowTraffic).toBe(false);
    expect(summarizeRecoveryTraffic([{ sum: { requests: 1, subrequests: 0, errors: 1 } }], {
      maximumRequests: 25,
      maximumErrors: 0
    }).lowTraffic).toBe(false);
  });

  it('collects a sanitized bounded Cloudflare GraphQL window', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body || '{}'));
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer analytics-secret' });
      expect(request.variables).toMatchObject({
        accountTag: '0123456789abcdef0123456789abcdef',
        scriptName: 'store-worker'
      });
      return new Response(JSON.stringify({
        data: {
          viewer: {
            accounts: [{ recent: [{ sum: { requests: 12, subrequests: 4, errors: 0 } }] }]
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const now = new Date('2026-07-09T12:00:00.000Z');
    const result = await collectRecoveryTrafficPreflight({
      accountId: '0123456789abcdef0123456789abcdef',
      apiToken: 'analytics-secret',
      scriptName: 'store-worker',
      recentMinutes: 15,
      maximumRequests: 25,
      maximumErrors: 0,
      now,
      fetchImpl
    });
    expect(result).toMatchObject({
      checkedAt: '2026-07-09T12:00:00.000Z',
      window: {
        start: '2026-07-09T11:45:00.000Z',
        end: '2026-07-09T12:00:00.000Z',
        minutes: 15
      },
      scriptName: 'store-worker',
      containsCredentials: false,
      containsCustomerData: false,
      traffic: { requests: 12, subrequests: 4, errors: 0, lowTraffic: true }
    });
    expect(JSON.stringify(result)).not.toContain('analytics-secret');
  });
});

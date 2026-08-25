import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  CACHE_POLICY_ORIGINS,
  collectCachePolicyEvidence
} from '../../scripts/audit-cache-policy.mjs';
import { ADMIN_RESPONSE_RULE_POLICY } from '../../scripts/configure-cloudflare-admin-response-rule.mjs';
import {
  SCREEN_READER_EVIDENCE_POLICY,
  collectScreenReaderEvidence
} from '../../scripts/release-screen-reader-evidence.mjs';

describe('Release Core consumer adapters', () => {
  it('retains Store production origins while delegating cache evaluation', async () => {
    expect(CACHE_POLICY_ORIGINS).toEqual({
      site: 'https://shop.dustwave.xyz',
      worker: 'https://checkout.dustwave.xyz'
    });
    await expect(collectCachePolicyEvidence({
      config: { cachePolicy: [] },
      now: () => new Date('2026-08-06T00:00:00.000Z')
    })).resolves.toMatchObject({
      generatedAt: '2026-08-06T00:00:00.000Z',
      ok: true,
      checks: [],
      containsCredentials: false,
      containsCustomerData: false
    });
  });

  it('injects only Store-owned Cloudflare and screen-reader policy', () => {
    expect(ADMIN_RESPONSE_RULE_POLICY).toMatchObject({
      ruleRef: 'store_admin_no_transform_v1',
      rulesetName: 'Store cache response rules',
      adminPaths: ['/admin', '/es/admin']
    });
    expect(SCREEN_READER_EVIDENCE_POLICY).toEqual({
      productLabel: 'Store',
      tempPrefix: 'store-screen-reader-evidence-',
      defaultExpectedPhrases: ['Shop'],
      defaultUrl: 'http://127.0.0.1:4002/'
    });
  });

  it('keeps the adapter import-safe and delegates command execution to Platform', () => {
    const output: string[] = [];
    expect(collectScreenReaderEvidence({
      args: ['--help'],
      writeLine: (line: string) => output.push(line)
    })).toMatchObject({ product: 'Store', exitCode: 0, help: true });
    expect(output.join('\n')).toContain('release:screen-reader-evidence');

    const source = readFileSync('scripts/release-screen-reader-evidence.mjs', 'utf8');
    expect(source).toContain('release-core/src/screen-reader-evidence.js');
    expect(source).not.toContain('node:child_process');
  });

  it('keeps release fulfillment event fixtures relative to the evidence run', () => {
    const source = readFileSync('scripts/release-fulfillment-evidence.mjs', 'utf8');

    expect(source).toContain('const EVIDENCE_NOW_MS = Date.now();');
    expect(source).toContain('starts_at: nowIso(10 * DAY_MS)');
    expect(source).not.toMatch(/starts_at:\s*['"]20\d{2}-/);
  });
});

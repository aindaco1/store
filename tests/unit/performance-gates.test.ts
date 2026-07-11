import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectAssetBudgetEvidence } from '../../scripts/audit-performance-budgets.mjs';
import { evaluateCachePolicyTarget } from '../../scripts/audit-cache-policy.mjs';
import { evaluateLighthouseResult } from '../../scripts/performance-lighthouse.mjs';

describe('production performance gates', () => {
  it('enforces generated totals and named file budgets from one config', () => {
    const siteDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'store-performance-assets-'));
    fs.mkdirSync(path.join(siteDirectory, 'assets', 'js'), { recursive: true });
    fs.writeFileSync(path.join(siteDirectory, 'assets', 'js', 'app.js'), '12345');
    fs.writeFileSync(path.join(siteDirectory, 'assets', 'main.css'), '1234');
    const config = {
      assets: {
        javascriptTotalBytes: 5,
        cssTotalBytes: 4,
        files: { 'assets/js/app.js': 5 }
      }
    };

    expect(collectAssetBudgetEvidence({ config, siteDirectory })).toMatchObject({
      ok: true,
      totals: { javascriptTotalBytes: 5, cssTotalBytes: 4 }
    });
    expect(collectAssetBudgetEvidence({
      config: { ...config, assets: { ...config.assets, javascriptTotalBytes: 4 } },
      siteDirectory
    })).toMatchObject({ ok: false });
  });

  it('fails private-route cache leakage and public max-age regressions', () => {
    expect(evaluateCachePolicyTarget(
      { id: 'admin', status: 200, type: 'private' },
      { status: 200, cacheControl: 'private, no-store, max-age=0' }
    )).toMatchObject({ ok: true });
    expect(evaluateCachePolicyTarget(
      { id: 'admin', status: 200, type: 'private' },
      { status: 200, cacheControl: 'public, max-age=600' }
    )).toMatchObject({ ok: false, failures: ['missing_private', 'missing_no_store'] });
    expect(evaluateCachePolicyTarget(
      { id: 'asset', status: 200, type: 'public', minimumMaxAge: 14400 },
      { status: 200, cacheControl: 'public, max-age=600' }
    )).toMatchObject({ ok: false, failures: ['max_age_below_budget'] });
  });

  it('evaluates Lighthouse categories and numeric web-vital budgets', () => {
    const budgets = {
      categories: { performance: 0.8, accessibility: 0.95 },
      audits: { 'largest-contentful-paint': 3000, 'cumulative-layout-shift': 0.1 },
      resourceBytes: { total: 1000, image: 500 }
    };
    const passing = {
      categories: { performance: { score: 0.9 }, accessibility: { score: 1 } },
      audits: {
        'largest-contentful-paint': { numericValue: 2000 },
        'cumulative-layout-shift': { numericValue: 0.05 },
        'resource-summary': { details: { items: [
          { resourceType: 'total', transferSize: 900 },
          { resourceType: 'image', transferSize: 400 }
        ] } }
      }
    };
    expect(evaluateLighthouseResult(passing, budgets)).toMatchObject({ ok: true });
    expect(evaluateLighthouseResult({
      ...passing,
      categories: { ...passing.categories, performance: { score: 0.7 } }
    }, budgets)).toMatchObject({ ok: false });
    expect(evaluateLighthouseResult({
      ...passing,
      audits: {
        ...passing.audits,
        'resource-summary': { details: { items: [
          { resourceType: 'total', transferSize: 1200 },
          { resourceType: 'image', transferSize: 400 }
        ] } }
      }
    }, budgets)).toMatchObject({ ok: false });
  });
});

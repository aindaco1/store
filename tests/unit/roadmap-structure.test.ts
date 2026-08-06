import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const roadmap = readFileSync(resolve(process.cwd(), 'docs/ROADMAP.md'), 'utf8');
const completed = roadmap.split(/^## Future Features$/m)[0] || '';

describe('Store roadmap structure', () => {
  it('keeps completed work organized as a current capability inventory', () => {
    const buckets = Array.from(completed.matchAll(/^### (.+)$/gm), (match) => match[1]);

    expect(buckets).toEqual([
      'Storefront, catalog, and merchandising',
      'Checkout, payments, pricing, shipping, tax, and inventory',
      'Orders, fulfillment, and customer communication',
      'Admin, publishing, and operations',
      'Localization, accessibility, policy, and discovery',
      'Performance, security, and runtime reliability',
      'Backup, recovery, and operational continuity',
      'Development, testing, deployment, and shared foundations'
    ]);
  });

  it('keeps versioned and dated release history out of the roadmap', () => {
    expect(roadmap).not.toMatch(/^## v\d+/m);
    expect(completed).not.toMatch(/\bv\d+\.\d+(?:\.\d+)?\b/i);
    expect(completed).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
    expect(roadmap).toContain('[CHANGELOG.md](../CHANGELOG.md)');
    expect(roadmap).toContain('[release evidence](release-evidence/)');
  });
});

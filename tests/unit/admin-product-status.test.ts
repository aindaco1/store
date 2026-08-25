import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  applyAdminStoreProductPatchToMarkdown,
  normalizeAdminStoreProductPublishBody
} from '../../worker/src/index.js';

describe('admin product status publishing', () => {
  it.each(['active', 'draft', 'archived', 'sold_out'])(
    'persists %s through the canonical product patch',
    (status) => {
      const previousStatus = status === 'active' ? 'archived' : 'active';
      const normalized = normalizeAdminStoreProductPublishBody({
        intent: 'publish',
        productId: 'film-fatale-at-the-guild-cinema',
        fields: { status }
      });

      expect(normalized.ok).toBe(true);
      if (!normalized.ok) return;

      const source = [
        '---',
        'identifier: "film-fatale-at-the-guild-cinema"',
        'name: "FILM FATALE at the Guild Cinema"',
        `status: "${previousStatus}"`,
        '---',
        'Film Fatale details.',
        ''
      ].join('\n');
      const applied = applyAdminStoreProductPatchToMarkdown(source, normalized.patch);

      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.content).toContain(`status: "${status}"`);
      expect(applied.content).not.toContain(`status: "${previousStatus}"`);
    }
  );

  it('returns exact-commit deployment metadata for product order saves', () => {
    const source = readFileSync('worker/src/index.js', 'utf8');
    const start = source.indexOf('async function handleAdminStoreProductOrderPublish');
    const end = source.indexOf('async function buildAdminStoreInventorySnapshot', start);
    const handler = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(handler).toContain(
      'deployment: adminRepoDeployment(env, rebuild, committedProducts[0]?.commitSha)'
    );
  });
});

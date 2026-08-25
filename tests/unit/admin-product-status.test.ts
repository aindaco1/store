import { describe, expect, it } from 'vitest';

import {
  applyAdminStoreProductPatchToMarkdown,
  normalizeAdminStoreProductPublishBody
} from '../../worker/src/index.js';

describe('admin product status publishing', () => {
  it('persists an archived status through the canonical product patch', () => {
    const normalized = normalizeAdminStoreProductPublishBody({
      intent: 'publish',
      productId: 'film-fatale-at-the-guild-cinema',
      fields: { status: 'archived' }
    });

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const source = [
      '---',
      'identifier: "film-fatale-at-the-guild-cinema"',
      'name: "FILM FATALE at the Guild Cinema"',
      'status: "active"',
      '---',
      'Film Fatale details.',
      ''
    ].join('\n');
    const applied = applyAdminStoreProductPatchToMarkdown(source, normalized.patch);

    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.content).toContain('status: "archived"');
    expect(applied.content).not.toContain('status: "active"');
  });
});

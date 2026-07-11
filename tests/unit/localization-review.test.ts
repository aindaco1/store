import { describe, expect, it } from 'vitest';
import { buildLocalizationReview, localizationReviewMarkdown } from '../../scripts/localization-review.mjs';

describe('localization review workflow', () => {
  it('builds a source-hashed packet without claiming professional review', () => {
    const evidence = buildLocalizationReview({
      defaultLocale: 'en',
      reviewLocales: ['es'],
      requiredReviewAreas: [{
        id: 'catalogs',
        label: 'Catalogs',
        paths: ['_data/i18n/en.yml', '_data/i18n/es.yml']
      }]
    });
    expect(evidence.status).toBe('workflow_ready');
    expect(evidence.professionalReviewClaimed).toBe(false);
    expect(evidence.areas[0].sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(localizationReviewMarkdown(evidence)).toContain('does not claim professional or native-speaker approval');
  });

  it('fails closed when a configured review source is missing', () => {
    const evidence = buildLocalizationReview({
      defaultLocale: 'en',
      reviewLocales: ['es'],
      requiredReviewAreas: [{ id: 'missing', label: 'Missing', paths: ['does-not-exist'] }]
    });
    expect(evidence.status).toBe('blocked');
    expect(evidence.areas[0].missing).toEqual(['does-not-exist']);
  });
});

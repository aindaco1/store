import { describe, it, expect } from 'vitest';
import { storePublicAuditValues } from '../../scripts/audit-secrets.mjs';
import { scanTextForTrackedSecrets } from '../../shared/dust-wave-platform/scripts/scan-tracked-secrets.mjs';

describe('Store public Stripe configuration audit', () => {
  it('allows only named publishable settings with a publishable value', () => {
    expect(storePublicAuditValues('STRIPE_PUBLISHABLE_KEY_TEST=pk_test_fixture\nSTRIPE_PUBLISHABLE_KEY_LIVE=pk_live_fixture'))
      .toEqual(['pk_test_fixture', 'pk_live_fixture']);
    const secret = ['sk', 'test', 'A'.repeat(32)].join('_');
    const webhook = ['whsec', 'B'.repeat(32)].join('_');
    expect(storePublicAuditValues(`STRIPE_PUBLISHABLE_KEY_TEST=${secret}\nSTRIPE_PUBLISHABLE_KEY=${webhook}\nSOME_KEY=pk_test_fixture\nSTRIPE_SECRET_KEY=pk_test_fixture`)).toEqual([]);
    expect(scanTextForTrackedSecrets(secret)).toHaveLength(1);
    expect(scanTextForTrackedSecrets(webhook)).toHaveLength(1);
  });
});

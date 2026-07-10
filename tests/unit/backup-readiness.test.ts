import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectBackupReadiness } from '../../scripts/backup-readiness.mjs';

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

describe('backup and recovery readiness evidence', () => {
  it('reports only names/status and accepts current sanitized evidence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-backup-readiness-'));
    const providerEvidence = path.join(root, 'providers.json');
    const snapshotReceipt = path.join(root, 'snapshot.json');
    const rehearsalEvidence = path.join(root, 'rehearsal.json');
    writeJson(providerEvidence, { checkedAt: new Date().toISOString(), summary: { failCount: 0 } });
    writeJson(snapshotReceipt, { createdAt: new Date().toISOString(), encrypted: true, archiveSha256: 'safe-hash' });
    writeJson(rehearsalEvidence, { rehearsedAt: new Date().toISOString(), ok: true });

    const result = await collectBackupReadiness({
      providerEvidence,
      snapshotReceipt,
      rehearsalEvidence,
      requireCurrentEvidence: true,
      requiredCredentials: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
      env: {
        CLOUDFLARE_ACCOUNT_ID: 'account-secret-value',
        CLOUDFLARE_API_TOKEN: 'cloudflare-secret-value'
      },
      devVarsPath: path.join(root, 'missing.dev.vars'),
      commandAvailableImpl: () => true
    });

    expect(result.ok).toBe(true);
    expect(result.summary.failed).toBe(0);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'data-inventory', status: 'PASS' }),
      expect.objectContaining({ id: 'metadata-backup-plan', status: 'PASS' }),
      expect.objectContaining({ id: 'required-credential-names', status: 'PASS', valuesExported: false }),
      expect.objectContaining({ id: 'snapshot-age', status: 'PASS' }),
      expect.objectContaining({ id: 'rehearsal-age', status: 'PASS' })
    ]));
    expect(JSON.stringify(result)).not.toContain('account-secret-value');
    expect(JSON.stringify(result)).not.toContain('cloudflare-secret-value');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('fails required missing credentials and stale required evidence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-backup-readiness-stale-'));
    const stale = new Date(Date.now() - (48 * 60 * 60 * 1000)).toISOString();
    const snapshotReceipt = path.join(root, 'snapshot.json');
    const rehearsalEvidence = path.join(root, 'rehearsal.json');
    writeJson(snapshotReceipt, { createdAt: stale, encrypted: true });
    writeJson(rehearsalEvidence, { rehearsedAt: stale, ok: true });

    const result = await collectBackupReadiness({
      snapshotReceipt,
      rehearsalEvidence,
      requireCurrentEvidence: true,
      maxSnapshotAgeHours: 24,
      maxRehearsalAgeHours: 24,
      requiredCredentials: ['CLOUDFLARE_API_TOKEN'],
      env: {},
      devVarsPath: path.join(root, 'missing.dev.vars'),
      commandAvailableImpl: () => true
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'required-credential-names', status: 'FAIL', missing: ['CLOUDFLARE_API_TOKEN'] }),
      expect.objectContaining({ id: 'provider-evidence', status: 'FAIL' }),
      expect.objectContaining({ id: 'snapshot-age', status: 'FAIL' }),
      expect.objectContaining({ id: 'rehearsal-age', status: 'FAIL' })
    ]));
    fs.rmSync(root, { recursive: true, force: true });
  });
});

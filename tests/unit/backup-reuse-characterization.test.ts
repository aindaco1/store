import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planBackupRetention } from '../../scripts/backup-retention.mjs';
import { collectBackupReadiness } from '../../scripts/backup-readiness.mjs';
import { inspectEncryptedSnapshot } from '../../scripts/backup-offsite-copy.mjs';

const roots: string[] = [];
function temporary() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-characterization-')); roots.push(root); return root; }
function snapshot(root: string, name: string, date: string, overrides: Record<string, unknown> = {}) {
  const dir = path.join(root, name); fs.mkdirSync(dir);
  const archive = 'backup.tar.gz.age'; const contents = Buffer.from(name);
  fs.writeFileSync(path.join(dir, archive), contents);
  const receipt = { encrypted: true, outputName: name, archive, archiveSha256: crypto.createHash('sha256').update(contents).digest('hex'), completedAt: date, archiveBytes: contents.length, ...overrides };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(receipt)); return dir;
}
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('backup extraction characterization', () => {
  it('selects distinct UTC/ISO week buckets across a year and keeps stable date ties', () => {
    const root = temporary();
    snapshot(root, 'a-latest', '2027-01-04T01:00:00Z');
    snapshot(root, 'b-tie', '2027-01-04T01:00:00Z');
    snapshot(root, 'previous-week', '2027-01-03T23:00:00Z');
    snapshot(root, 'same-iso-week', '2026-12-31T23:00:00Z');
    snapshot(root, 'release', '2020-01-01T00:00:00Z', { releaseSnapshot: true });
    const plan = planBackupRetention({ root, retention: { daily: 1, weekly: 2, monthly: 2 } });
    expect(plan.keep.map(({ name, reasons }: any) => ({ name, reasons }))).toEqual([
      { name: 'a-latest', reasons: ['daily', 'monthly', 'newest', 'weekly'] },
      { name: 'previous-week', reasons: ['weekly'] },
      { name: 'same-iso-week', reasons: ['monthly'] },
      { name: 'release', reasons: ['release'] },
    ]);
    expect(plan.prune.map(({ name }: any) => name)).toEqual(['b-tie']);
    expect(plan.bytesEligibleForPrune).toBe(5);
    const minimal = planBackupRetention({ root, retention: { daily: 0, weekly: 0, monthly: 0, releaseSnapshots: false } });
    expect(minimal.keep).toHaveLength(1); expect(minimal.keep[0].name).toBe('a-latest');
    expect(fs.existsSync(path.join(root, 'b-tie'))).toBe(true);
  });

  it('leaves malformed, unsafe, unencrypted and symlinked receipts untouched', () => {
    const root = temporary(); const outside = temporary();
    snapshot(root, 'bad-date', 'nonsense'); snapshot(root, 'plaintext', '2026-01-01', { encrypted: false });
    snapshot(root, 'unsafe', '2026-01-01', { archive: '../escape.age' });
    snapshot(root, 'bad-hash', '2026-01-01', { archiveSha256: 'f'.repeat(64) });
    const broken = snapshot(root, 'broken-json', '2026-01-01'); fs.writeFileSync(path.join(broken, 'manifest.json'), '{');
    const manifestLink = snapshot(root, 'manifest-link', '2026-01-01'); fs.renameSync(path.join(manifestLink, 'manifest.json'), path.join(outside, 'receipt')); fs.symlinkSync(path.join(outside, 'receipt'), path.join(manifestLink, 'manifest.json'));
    const archiveLink = snapshot(root, 'archive-link', '2026-01-01'); fs.renameSync(path.join(archiveLink, 'backup.tar.gz.age'), path.join(outside, 'archive')); fs.symlinkSync(path.join(outside, 'archive'), path.join(archiveLink, 'backup.tar.gz.age'));
    fs.symlinkSync(outside, path.join(root, 'directory-link'), 'dir');
    const result = planBackupRetention({ root, retention: {} });
    expect(result.keep).toEqual([]); expect(result.prune).toEqual([]);
    expect(Object.fromEntries(result.untouched.map(({ name, reason }: any) => [name, reason]))).toEqual({
      'bad-date': 'invalid_created_at', plaintext: 'not_encrypted_receipt', unsafe: 'unsafe_archive_name',
      'bad-hash': 'archive_checksum_mismatch', 'broken-json': 'invalid_manifest',
      'manifest-link': 'symbolic_link_manifest', 'archive-link': 'symbolic_link_archive', 'directory-link': 'symbolic_link',
    });
  });

  it('keeps offsite inspection stricter on filenames while accepting receipts without dates', () => {
    const root = temporary(); const dir = snapshot(root, 'snapshot', '', { completedAt: undefined });
    expect(inspectEncryptedSnapshot(dir)).toMatchObject({ archiveBytes: 8, outputName: 'snapshot' });
    expect(planBackupRetention({ root, retention: {} }).untouched).toEqual([{ name: 'snapshot', reason: 'invalid_created_at' }]);
    const f = path.join(dir, 'manifest.json'); const receipt = JSON.parse(fs.readFileSync(f, 'utf8'));
    receipt.archive = 'backup.zip'; fs.renameSync(path.join(dir, 'backup.tar.gz.age'), path.join(dir, 'backup.zip')); fs.writeFileSync(f, JSON.stringify(receipt));
    expect(() => inspectEncryptedSnapshot(dir)).toThrow('Encrypted receipt archive path is invalid.');
    receipt.archive = 'backup.zip'; receipt.completedAt = '2026-01-01'; fs.writeFileSync(f, JSON.stringify(receipt));
    expect(planBackupRetention({ root, retention: {} }).keep).toHaveLength(1);
  });

  it('distinguishes absent, invalid, stale and future-dated readiness evidence', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-14T12:00:00Z'));
    const root = temporary(); const file = path.join(root, 'evidence.json');
    const options = { requiredCredentials: [], env: {}, devVarsPath: path.join(root, 'missing'), commandAvailableImpl: () => true, maxSnapshotAgeHours: 24 };
    for (const [evidence, required, status, age] of [
      [undefined, false, 'WARN', null], [undefined, true, 'FAIL', null],
      [{ completedAt: 'invalid', createdAt: '2026-09-14T12:00:00Z' }, false, 'FAIL', null],
      [{ createdAt: '2026-09-13T12:00:00Z' }, true, 'PASS', 24],
      [{ createdAt: '2026-09-13T11:00:00Z' }, false, 'WARN', 25],
      [{ createdAt: '2026-09-15T12:00:00Z' }, true, 'PASS', 0],
    ] as const) {
      if (evidence) fs.writeFileSync(file, JSON.stringify(evidence));
      const result = await collectBackupReadiness({ ...options, snapshotReceipt: evidence ? file : undefined, requireCurrentEvidence: required });
      expect(result.checks.find((check: any) => check.id === 'snapshot-age')).toMatchObject({ status, ageHours: age, maxAgeHours: 24 });
    }
  });
});

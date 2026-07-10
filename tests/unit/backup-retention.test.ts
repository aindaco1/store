import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { executeBackupRetention, planBackupRetention } from '../../scripts/backup-retention.mjs';

function writeSnapshot(root: string, name: string, createdAt: string, options: { release?: boolean; valid?: boolean } = {}) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const archive = Buffer.from(`encrypted-${name}`);
  fs.writeFileSync(path.join(directory, 'store-backup.tar.gz.age'), archive, { mode: 0o600 });
  fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify({
    version: 2,
    createdAt,
    completedAt: createdAt,
    encrypted: true,
    archive: 'store-backup.tar.gz.age',
    archiveBytes: archive.byteLength,
    archiveSha256: options.valid === false
      ? '0'.repeat(64)
      : crypto.createHash('sha256').update(archive).digest('hex'),
    releaseSnapshot: options.release === true
  }, null, 2)}\n`, { mode: 0o600 });
  return directory;
}

describe('backup retention safeguards', () => {
  it('plans by retention buckets while preserving newest, release, and invalid snapshots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-backup-retention-'));
    writeSnapshot(root, 'latest', '2026-07-09T04:00:00.000Z');
    writeSnapshot(root, 'release', '2026-07-01T04:00:00.000Z', { release: true });
    writeSnapshot(root, 'old', '2026-06-01T04:00:00.000Z');
    writeSnapshot(root, 'invalid', '2026-05-01T04:00:00.000Z', { valid: false });

    const plan = planBackupRetention({
      root,
      retention: { daily: 1, weekly: 0, monthly: 0, releaseSnapshots: true }
    });
    expect(plan.executeByDefault).toBe(false);
    expect(plan.keep).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'latest', reasons: expect.arrayContaining(['newest', 'daily']) }),
      expect.objectContaining({ name: 'release', reasons: ['release'] })
    ]));
    expect(plan.prune).toEqual([expect.objectContaining({ name: 'old' })]);
    expect(plan.untouched).toContainEqual({ name: 'invalid', reason: 'archive_checksum_mismatch' });
    expect(() => executeBackupRetention(plan, { root, acknowledge: 'wrong' })).toThrow(/acknowledge/i);

    const execution = executeBackupRetention(plan, { root, acknowledge: 'STORE_BACKUP_RETENTION_PRUNE' });
    expect(execution).toEqual({ ok: true, deleted: ['old'] });
    expect(fs.existsSync(path.join(root, 'old'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'latest'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'release'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'invalid'))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('requires an explicit existing retention root', () => {
    expect(() => planBackupRetention({ root: '' })).toThrow(/required/i);
    expect(() => planBackupRetention({ root: path.join(os.tmpdir(), 'missing-store-backups') })).toThrow(/existing directory/i);
  });

  it('revalidates protection rules immediately before deletion', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-backup-retention-revalidate-'));
    writeSnapshot(root, 'latest', '2026-07-09T04:00:00.000Z');
    const old = writeSnapshot(root, 'old', '2026-06-01T04:00:00.000Z');
    const plan = planBackupRetention({
      root,
      retention: { daily: 1, weekly: 0, monthly: 0, releaseSnapshots: true }
    });
    const receiptPath = path.join(old, 'manifest.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    receipt.releaseSnapshot = true;
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });

    expect(() => executeBackupRetention(plan, {
      root,
      acknowledge: 'STORE_BACKUP_RETENTION_PRUNE'
    })).toThrow(/no longer eligible/i);
    expect(fs.existsSync(old)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects a symlinked retention root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-backup-retention-link-'));
    const target = path.join(root, 'target');
    const link = path.join(root, 'link');
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, 'dir');

    expect(() => planBackupRetention({ root: link })).toThrow(/symbolic link/i);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

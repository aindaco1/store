import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { executeBackupRetention, planBackupRetention } from '../../scripts/backup-retention.mjs';

function writeSnapshot(root: string, name: string, createdAt: string, options: { release?: boolean; valid?: boolean; contents?: string } = {}) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const archive = Buffer.from(options.contents ?? `encrypted-${name}`);
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

    const execution = executeBackupRetention(plan, { root, retention: plan.retention, acknowledge: 'STORE_BACKUP_RETENTION_PRUNE' });
    expect(execution).toEqual({ ok: true, deleted: ['old'] });
    expect(fs.existsSync(path.join(root, 'old'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'latest'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'release'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'invalid'))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(['unchanged', 'changed archive', 'different root', 'new release'] as const)(
    'applies only the reviewed batch: %s', (change) => {
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'store-prune-batch-'));
      try {
        const root = path.join(scratch, 'a', 'backups');
        const other = path.join(scratch, 'b', 'backups');
        function populate(directory: string) {
          writeSnapshot(directory, 'newest', '2026-07-09T12:00:00Z');
          writeSnapshot(directory, 'first', '2026-07-09T11:00:00Z');
          writeSnapshot(directory, 'second', '2026-07-09T10:00:00Z', { contents: 'alpha' });
        }
        populate(root);
        const plan = JSON.parse(JSON.stringify(planBackupRetention({ root })));
        expect(plan.prune.map((row: { name: string }) => row.name)).toEqual(['first', 'second']);
        const target = change === 'different root' ? other : root;
        if (change === 'different root') populate(other); // Same basename, names and hashes.
        if (change === 'changed archive') {
          writeSnapshot(root, 'second', '2026-07-09T10:00:00Z', { contents: 'bravo' });
        }
        if (change === 'new release') {
          writeSnapshot(root, 'second', '2026-07-09T10:00:00Z', { contents: 'alpha', release: true });
        }
        writeSnapshot(target, 'unlisted', '2026-07-09T09:00:00Z');
        const execute = () => executeBackupRetention(plan, { root: target, acknowledge: 'STORE_BACKUP_RETENTION_PRUNE' });
        if (change === 'unchanged') {
          expect(execute().deleted).toEqual(['first', 'second']);
          expect(fs.readdirSync(target).sort()).toEqual(['newest', 'unlisted']);
        } else {
          expect(execute).toThrow();
          expect(fs.readdirSync(target).sort()).toEqual(['first', 'newest', 'second', 'unlisted']);
          if (change === 'different root') expect(fs.readdirSync(root).sort()).toEqual(['first', 'newest', 'second']);
        }
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    }
  );

  it('executes a saved CLI preview and requires a fresh preview after an archive changes', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'store-prune-cli-'));
    try {
      const root = path.join(scratch, 'backups');
      const file = path.join(scratch, 'review.json');
      const script = path.resolve('scripts/backup-retention.mjs');
      const run = (...args: string[]) => spawnSync(process.execPath, [script, `--root=${root}`, ...args], { encoding: 'utf8' });
      const executeArgs = ['--execute', '--acknowledge=STORE_BACKUP_RETENTION_PRUNE'];
      writeSnapshot(root, 'latest', '2026-07-09T12:00:00Z');
      writeSnapshot(root, 'old', '2026-07-09T11:00:00Z');
      expect(run(`--output=${file}`).status).toBe(0);
      const missing = run(...executeArgs);
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('--plan=FILE');
      writeSnapshot(root, 'old', '2026-07-09T11:00:00Z', { contents: 'replacement' });
      const stale = run(...executeArgs, `--plan=${file}`);
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain('snapshot changed');
      expect(fs.readdirSync(root).sort()).toEqual(['latest', 'old']);

      expect(run(`--output=${file}`).status).toBe(0);
      writeSnapshot(root, 'unlisted', '2026-07-09T10:00:00Z');
      const result = run(...executeArgs, `--plan=${file}`);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).execution).toEqual({ ok: true, deleted: ['old'] });
      expect(fs.readdirSync(root).sort()).toEqual(['latest', 'unlisted']);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
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
      root, retention: plan.retention,
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

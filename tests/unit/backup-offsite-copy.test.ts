import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  executeOffsiteCopy,
  inspectEncryptedSnapshot,
  planOffsiteCopy,
  verifyOffsiteCopy
} from '../../scripts/backup-offsite-copy.mjs';
import { sha256File } from '../../scripts/lib/file-integrity.mjs';

const temporaryRoots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(label: string) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), label)));
  temporaryRoots.push(root);
  return root;
}

function encryptedFixture(root: string, name = '20260710T220000Z', contents = 'encrypted-fixture') {
  const snapshot = path.join(root, 'source', name);
  fs.mkdirSync(snapshot, { recursive: true });
  const archivePath = path.join(snapshot, 'store-backup.tar.gz.age');
  fs.writeFileSync(archivePath, contents, { mode: 0o600 });
  fs.writeFileSync(path.join(snapshot, 'manifest.json'), `${JSON.stringify({
    version: 2,
    outputName: name,
    encrypted: true,
    encryptionBackend: 'age',
    archive: 'store-backup.tar.gz.age',
    archiveSha256: sha256File(archivePath)
  })}\n`, { mode: 0o600 });
  return snapshot;
}

describe('off-device encrypted backup copies', () => {
  it('plans and verifies only checksum-covered encrypted snapshots', () => {
    const root = temporaryRoot('store-offsite-plan-');
    const snapshot = encryptedFixture(root);
    const destination = path.join(root, 'destination');
    fs.mkdirSync(destination);

    expect(inspectEncryptedSnapshot(snapshot)).toMatchObject({
      outputName: '20260710T220000Z',
      archiveBytes: 17
    });
    expect(planOffsiteCopy({ snapshot, destination })).toMatchObject({
      outputName: '20260710T220000Z',
      targetExists: false
    });
    expect(verifyOffsiteCopy({ snapshot })).toMatchObject({
      checksumVerified: true,
      decryptabilityVerified: false,
      containsCustomerData: false
    });
  });

  it('copies append-only with exact acknowledgement and verifies readback', () => {
    const root = temporaryRoot('store-offsite-copy-');
    const snapshot = encryptedFixture(root);
    const destination = path.join(root, 'destination');
    fs.mkdirSync(destination);

    expect(() => executeOffsiteCopy({
      snapshot,
      destination,
      requireSeparateDevice: false
    })).toThrow(/acknowledge/i);

    const plan = planOffsiteCopy({ snapshot, destination });
    const result = executeOffsiteCopy({
      snapshot,
      destination,
      acknowledge: 'STORE_BACKUP_OFF_DEVICE_COPY',
      requireSeparateDevice: false
    });
    expect(result.verification).toMatchObject({ checksumVerified: true, destinationType: 'off-device-filesystem' });
    expect(result.archiveSha256).toBe(plan.archiveSha256);
    expect(result.verification.archiveSha256).toBe(plan.archiveSha256);
    expect(sha256File(path.join(result.target, plan.archiveName))).toBe(plan.archiveSha256);
    const receiptPath = path.join(result.target, 'offsite-copy-receipt.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    expect(receipt).toEqual(result.verification);
    expect(receipt.archiveSha256).toBe(plan.archiveSha256);

    // A second copy must leave every existing file byte-for-byte unchanged.
    fs.writeFileSync(path.join(result.target, 'unrelated.txt'), 'keep me');
    const files = fs.readdirSync(result.target).sort();
    const before = files.map(name => fs.readFileSync(path.join(result.target, name)));
    encryptedFixture(root, plan.outputName, 'alternate-fixture');
    expect(() => executeOffsiteCopy({
      snapshot,
      destination,
      acknowledge: 'STORE_BACKUP_OFF_DEVICE_COPY',
      requireSeparateDevice: false
    })).toThrow(/already exists/i);
    expect(fs.readdirSync(result.target).sort()).toEqual(files);
    expect(files.map(name => fs.readFileSync(path.join(result.target, name)))).toEqual(before);
  });

  it.each(['before manifest', 'before archive'] as const)(
    'removes the failed copy and leaves no success receipt after a source swap %s', (boundary) => {
      const root = temporaryRoot('store-offsite-swap-');
      const snapshot = encryptedFixture(root);
      const destination = path.join(root, 'destination');
      fs.mkdirSync(destination);
      const plan = planOffsiteCopy({ snapshot, destination });
      const copyFile = fs.copyFileSync;
      let swapped = false;
      vi.spyOn(fs, 'copyFileSync').mockImplementation((source, target, flags) => {
        const swapFile = boundary === 'before manifest' ? 'manifest.json' : plan.archiveName;
        if (!swapped && source === path.join(snapshot, swapFile)) {
          encryptedFixture(root, plan.outputName, 'alternate-fixture');
          swapped = true;
        }
        copyFile(source, target, flags);
      });

      expect(() => executeOffsiteCopy({
        snapshot,
        destination,
        acknowledge: 'STORE_BACKUP_OFF_DEVICE_COPY',
        requireSeparateDevice: false
      })).toThrow(boundary === 'before manifest' ? /planned SHA-256/i : /checksum/i);
      expect(swapped).toBe(true);
      // Replacement is independently valid and equal-size, with a fresh matching manifest.
      const replacement = inspectEncryptedSnapshot(snapshot);
      expect(replacement.archiveBytes).toBe(plan.archiveBytes);
      expect(replacement.archiveSha256).not.toBe(plan.archiveSha256);
      expect(fs.existsSync(plan.target)).toBe(false);
      expect(fs.existsSync(path.join(plan.target, 'offsite-copy-receipt.json'))).toBe(false);
      expect(fs.readdirSync(destination)).toEqual([]);
    }
  );

  it('preserves a destination created by another copy after planning', () => {
    const root = temporaryRoot('store-offsite-existing-');
    const snapshot = encryptedFixture(root);
    const destination = path.join(root, 'destination');
    fs.mkdirSync(destination);
    const plan = planOffsiteCopy({ snapshot, destination });
    const mkdir = fs.mkdirSync;
    const existing = {
      'manifest.json': 'existing manifest',
      [plan.archiveName]: 'existing archive',
      'offsite-copy-receipt.json': 'existing success receipt'
    };
    vi.spyOn(fs, 'mkdirSync').mockImplementation((directory, options) => {
      if (directory === plan.target) {
        mkdir(directory);
        for (const [name, contents] of Object.entries(existing)) {
          fs.writeFileSync(path.join(directory, name), contents);
        }
      }
      return mkdir(directory, options);
    });
    expect(() => executeOffsiteCopy({
      snapshot, destination, acknowledge: 'STORE_BACKUP_OFF_DEVICE_COPY', requireSeparateDevice: false
    })).toThrow(/EEXIST/i);
    expect(fs.readdirSync(plan.target).sort()).toEqual(Object.keys(existing).sort());
    for (const [name, contents] of Object.entries(existing)) {
      expect(fs.readFileSync(path.join(plan.target, name), 'utf8')).toBe(contents);
    }
  });

  it('rejects tampered archives and unsafe receipt paths', () => {
    const root = temporaryRoot('store-offsite-tamper-');
    const snapshot = encryptedFixture(root);
    fs.appendFileSync(path.join(snapshot, 'store-backup.tar.gz.age'), 'tampered');
    expect(() => inspectEncryptedSnapshot(snapshot)).toThrow(/checksum/i);

    const unsafe = encryptedFixture(root, 'safe-name');
    const receiptPath = path.join(unsafe, 'manifest.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    receipt.outputName = '../escape';
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    expect(() => inspectEncryptedSnapshot(unsafe)).toThrow(/safe directory name/i);
  });
});

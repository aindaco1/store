import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  executeOffsiteCopy,
  inspectEncryptedSnapshot,
  planOffsiteCopy,
  verifyOffsiteCopy
} from '../../scripts/backup-offsite-copy.mjs';
import { sha256File } from '../../scripts/lib/file-integrity.mjs';

function encryptedFixture(root: string, name = '20260710T220000Z') {
  const snapshot = path.join(root, 'source', name);
  fs.mkdirSync(snapshot, { recursive: true });
  const archivePath = path.join(snapshot, 'store-backup.tar.gz.age');
  fs.writeFileSync(archivePath, 'encrypted-fixture', { mode: 0o600 });
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-offsite-plan-'));
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-offsite-copy-'));
    const snapshot = encryptedFixture(root);
    const destination = path.join(root, 'destination');
    fs.mkdirSync(destination);

    expect(() => executeOffsiteCopy({
      snapshot,
      destination,
      requireSeparateDevice: false
    })).toThrow(/acknowledge/i);

    const result = executeOffsiteCopy({
      snapshot,
      destination,
      acknowledge: 'STORE_BACKUP_OFF_DEVICE_COPY',
      requireSeparateDevice: false
    });
    expect(result.verification).toMatchObject({ checksumVerified: true, destinationType: 'off-device-filesystem' });
    expect(fs.existsSync(path.join(result.target, 'offsite-copy-receipt.json'))).toBe(true);
    expect(() => executeOffsiteCopy({
      snapshot,
      destination,
      acknowledge: 'STORE_BACKUP_OFF_DEVICE_COPY',
      requireSeparateDevice: false
    })).toThrow(/already exists/i);
  });

  it('rejects tampered archives and unsafe receipt paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-offsite-tamper-'));
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

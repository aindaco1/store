import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { validateSoftwarePreview } from '../../scripts/lib/software-preview.mjs';
import { softwareArchiveConfiguration, softwareArchiveRoundTrip } from '../../scripts/lib/software-recovery-archive.mjs';

describe('isolated software preview recovery', () => {
  const previewId = '0123456789abcdef';
  const prefix = `dw-recovery-${previewId}`;
  it('rejects ordinary origins, paid checkout and non-preview bindings before writes', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'software-preview-test-'));
    const workerConfig = path.join(temp, 'wrangler.json');
    const config = { name: `${prefix}-store`, vars: { APP_MODE: 'test', SOFTWARE_CHECKOUT_ENABLED: 'false', SOFTWARE_RECOVERY_PREVIEW_ID: previewId, SOFTWARE_RECOVERY_TARGET: 'empty' },
      kv_namespaces: ['STORE_STATE','RATELIMIT'].map(binding=>({binding,id:'a'.repeat(32),preview_id:'a'.repeat(32)})), r2_buckets: [{ bucket_name: `${prefix}-downloads` }] };
    const options = { previewId, workerConfig, storeBase: `https://${prefix}-store.test.workers.dev`, licensingBase: `https://${prefix}-licensing.test.workers.dev`, previewR2Bucket: `${prefix}-downloads` };
    try {
      fs.writeFileSync(workerConfig, JSON.stringify(config));
      expect(validateSoftwarePreview(options).previewId).toBe(previewId);
      for (const storeBase of ['https://store.example.com', `https://${prefix}-store.test.workers.dev/other`, `http://${prefix}-store.test.workers.dev`, `https://${prefix}-store.test.workers.dev@other.test`, `https://${prefix}-store.test.workers.dev/?x=1`]) {
        expect(() => validateSoftwarePreview({ ...options, storeBase })).toThrow();
      }
      for (const mutation of [{ vars: { ...config.vars, SOFTWARE_CHECKOUT_ENABLED: 'true' } }, { vars: { ...config.vars, APP_MODE: 'live' } }, { kv_namespaces: [{ ...config.kv_namespaces[0], preview_id: 'b'.repeat(32) }] }, { routes: ['store.example.com/*'] }, { r2_buckets: [{ bucket_name: 'production' }] }]) {
        fs.writeFileSync(workerConfig, JSON.stringify({ ...config, ...mutation }));
        expect(() => validateSoftwarePreview(options)).toThrow();
      }
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
  it('requires the existing off-account archive boundary and never accepts credentials in the URI', () => {
    const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), STORE_RECOVERY_ARCHIVE_ACCOUNT_ID: 'b'.repeat(32), STORE_RECOVERY_ARCHIVE_S3_ENDPOINT: `https://${'b'.repeat(32)}.r2.cloudflarestorage.com`, STORE_RECOVERY_ARCHIVE_S3_URI: 's3://existing-backup/store', AWS_ACCESS_KEY_ID: 'synthetic', AWS_SECRET_ACCESS_KEY: 'synthetic', STORE_BACKUP_AGE_IDENTITY: 'synthetic' };
    expect(softwareArchiveConfiguration(env).uri).toBe(env.STORE_RECOVERY_ARCHIVE_S3_URI);
    for (const mutation of [{ STORE_RECOVERY_ARCHIVE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID }, { STORE_RECOVERY_ARCHIVE_S3_URI: 's3://user:secret@bucket/store' }, { STORE_RECOVERY_ARCHIVE_S3_URI: 's3://bucket/store/../production' }, { AWS_SECRET_ACCESS_KEY: '' }]) {
      expect(() => softwareArchiveConfiguration({ ...env, ...mutation })).toThrow();
    }
  });
  it('restores the downloaded ciphertext and refuses corrupt remote bytes or receipts', () => {
    const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), STORE_RECOVERY_ARCHIVE_ACCOUNT_ID: 'b'.repeat(32), STORE_RECOVERY_ARCHIVE_S3_ENDPOINT: `https://${'b'.repeat(32)}.r2.cloudflarestorage.com`, STORE_RECOVERY_ARCHIVE_S3_URI: 's3://existing-backup/store', AWS_ACCESS_KEY_ID: 'synthetic', AWS_SECRET_ACCESS_KEY: 'synthetic', STORE_BACKUP_AGE_IDENTITY: 'synthetic' };
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'software-archive-test-'));
    const archive = path.join(temp, 'archive'); fs.mkdirSync(archive);
    const body = Buffer.from('synthetic ciphertext'), name = 'store-backup.tar.gz.age';
    fs.writeFileSync(path.join(archive, name), body);
    fs.writeFileSync(path.join(archive, 'manifest.json'), JSON.stringify({ encrypted: true, archive: name, archiveSha256: createHash('sha256').update(body).digest('hex'), outputName: 'synthetic' }));
    try {
      for (const corrupt of ['none', 'bytes', 'receipt']) {
        const remote = new Map(), calls: string[][] = [];
        const run = (_command: string, args: string[]) => {
          calls.push(args); const from = args[4], to = args[5];
          if (from.startsWith('s3://')) {
            let bytes = remote.get(from);
            if(corrupt==='bytes' && from.endsWith('.age')) bytes=Buffer.from('changed');
            if(corrupt==='receipt' && from.endsWith('manifest.json')) bytes=Buffer.from(JSON.stringify({...JSON.parse(bytes.toString()),outputName:'changed'}));
            fs.writeFileSync(to,bytes);
          }
          else remote.set(to, fs.readFileSync(from));
        };
        const action = () => softwareArchiveRoundTrip({ archive, temp }, { env, run });
        if (corrupt !== 'none') expect(action).toThrow(/checksum|receipt differs/);
        else { const restored = action(); expect(fs.readFileSync(path.join(restored, name))).toEqual(body); }
        expect(calls.every(args => args[2] === 's3' && args[3] === 'cp')).toBe(true);
        expect(calls[0][5]).toMatch(/^s3:\/\/existing-backup\/software-rehearsal\//);
        expect(calls[0][5]).not.toContain('/store/');
        expect(calls[1][5]).toMatch(/manifest.json$/); // receipt published after ciphertext
        fs.rmSync(path.join(temp, 'remote-archive'), { recursive: true, force: true });
      }
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });

});

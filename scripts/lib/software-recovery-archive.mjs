import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { inspectEncryptedSnapshot, assertCopiedArchiveDigest } from '../../shared/dust-wave-platform/packages/release-core/src/backup-receipts.js';

export function softwareArchiveConfiguration(env = process.env) {
  const account = env.STORE_RECOVERY_ARCHIVE_ACCOUNT_ID;
  const uri = env.STORE_RECOVERY_ARCHIVE_S3_URI || '';
  if (!/^[a-f0-9]{32}$/.test(account || '') || !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || '') || account === env.CLOUDFLARE_ACCOUNT_ID ||
      env.STORE_RECOVERY_ARCHIVE_S3_ENDPOINT !== `https://${account}.r2.cloudflarestorage.com` ||
      !/^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/store(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(uri) ||
      !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.STORE_BACKUP_AGE_IDENTITY) {
    throw new Error('Protected separate-account archive configuration is required');
  }
  return { endpoint: env.STORE_RECOVERY_ARCHIVE_S3_ENDPOINT, uri: uri.replace(/\/$/, '') };
}

// Same ciphertext/receipt, S3 transport, digest check and retention destination as
// the existing protected drill. Never remove retained archives or export keys.
export function softwareArchiveRoundTrip({ archive, temp }, { env = process.env, run = execFileSync } = {}) {
  const config = softwareArchiveConfiguration(env);
  const original = inspectEncryptedSnapshot(archive);
  // A sibling prefix prevents a synthetic receipt becoming the newest production backup.
  const destination = `s3://${new URL(config.uri).hostname}/software-rehearsal/${randomBytes(16).toString('hex')}`;
  const downloaded = path.join(temp, 'remote-archive');
  fs.mkdirSync(downloaded, { mode: 0o700 });
  const copy = (from, to) => run('aws', ['--endpoint-url', config.endpoint, 's3', 'cp', from, to, '--only-show-errors'],
    { env, stdio: 'pipe', timeout: 120000 });
  copy(original.archivePath, `${destination}/${original.archiveName}`);
  copy(path.join(archive, 'manifest.json'), `${destination}/manifest.json`);
  copy(`${destination}/manifest.json`, path.join(downloaded, 'manifest.json'));
  copy(`${destination}/${original.archiveName}`, path.join(downloaded, original.archiveName));
  const restored = inspectEncryptedSnapshot(downloaded);
  assertCopiedArchiveDigest(original.archiveSha256, restored.archiveSha256);
  if (!fs.readFileSync(path.join(archive, 'manifest.json')).equals(fs.readFileSync(path.join(downloaded, 'manifest.json')))) throw new Error('Remote archive receipt differs');
  return downloaded;
}

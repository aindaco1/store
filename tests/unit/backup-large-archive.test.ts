import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as { command: string; timeout?: number; version: boolean }[]);
vi.mock('../../scripts/lib/command-runner.mjs', () => ({
  commandAvailable: (name: string) => name === 'age',
  runCommand: (command: string, args: string[], options: { timeoutMs?: number } = {}) => {
    calls.push({ command, timeout: options.timeoutMs, version: args.includes('--version') });
    const result = { status: 0, stdout: '[]', stderr: '', error: '' };
    if (command === 'git') {
      result.stdout = args[0] === 'rev-parse' ? 'a'.repeat(40) : '';
      if (args[0] === 'bundle') fs.writeFileSync(args[2], 'synthetic git bundle');
    }
    if (command === 'tar' || command === 'age' || command === 'gpg') {
      if (args.includes('--version')) return result;
      // Model a production-sized operation that needs more than the short provider-command budget.
      if ((options.timeoutMs || 30_000) < 60_000) return { ...result, status: 1, error: 'ETIMEDOUT' };
      if (command === 'tar') fs.writeFileSync(args[1], 'synthetic tar');
      if (command === 'age' && args.includes('--recipient')) {
        fs.writeFileSync(args[args.indexOf('--output') + 1], 'synthetic ciphertext');
      }
    }
    return result;
  }
}));
import { createBackupSnapshot } from '../../scripts/store-backup.mjs';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
  vi.unstubAllEnvs();
  calls.length = 0;
});

it('allows larger archive/encryption operations without widening provider-read timeouts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-large-backup-'));
  folders.push(root);
  const output = path.join(root, 'encrypted');
  vi.stubEnv('STORE_BACKUP_AGE_IDENTITY', path.join(root, 'synthetic-identity'));
  const result = await createBackupSnapshot({ output, remote: true, kvValues: true, skipBuild: true,
    acknowledgeSensitive: 'STORE_SENSITIVE_BACKUP', encryptionBackend: 'age', encryptionRecipient: 'synthetic-recipient' });
  expect(result.encrypted).toBe(true);
  expect(fs.existsSync(path.join(output, 'store-backup.tar.gz.age'))).toBe(true);
  expect(fs.readdirSync(root)).toEqual(['encrypted']);
  const fileCalls = calls.filter(({ command, version }) => !version && ['tar', 'age', 'gpg'].includes(command));
  expect(fileCalls).toHaveLength(3);
  expect(fileCalls.every(({ timeout }) => timeout === 300_000)).toBe(true);
  expect(calls.filter(({ command }) => command === 'npx').every(({ timeout }) => !timeout || timeout <= 30_000)).toBe(true);
});

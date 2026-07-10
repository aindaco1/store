import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  KV_BACKUP_PREFIXES,
  KV_QUARANTINE_PREFIXES,
  KV_VALUE_BACKUP_PREFIXES,
  buildKvBackupPlan,
  backupCompletionDetails,
  chunkKvBackupKeys,
  buildSecretInventory,
  createBackupSnapshot,
  discoverDownloadKeys,
  discoverR2ObjectKeys,
  parseWranglerTomlInventory,
  resolveR2BackupObjectPath,
  sanitizeBackupWarningCategories,
  transformKvBulkGetToPutRecords,
  validateBackupSafety
} from '../../scripts/store-backup.mjs';
import { verifyChecksumManifest } from '../../scripts/lib/file-integrity.mjs';
import { loadStoreDataInventory } from '../../scripts/lib/store-data-inventory.mjs';

describe('store backup script', () => {
  it('classifies authoritative and quarantine KV prefixes explicitly', () => {
    expect(KV_BACKUP_PREFIXES).toContain('orders:');
    expect(KV_BACKUP_PREFIXES).toContain('admin-store-orders:index:v2');
    expect(KV_BACKUP_PREFIXES).toContain('store-coupons:v1');
    expect(KV_BACKUP_PREFIXES).toContain('abandoned-cart-suppressed:');
    expect(KV_BACKUP_PREFIXES).toContain('stripe-event:');
    expect(KV_BACKUP_PREFIXES).toContain('store-order-admin-email-sent:');
    expect(KV_VALUE_BACKUP_PREFIXES).toContain('orders:');
    expect(KV_VALUE_BACKUP_PREFIXES).not.toContain('admin-store-orders:index:v2');
    expect(KV_QUARANTINE_PREFIXES).toContain('admin-session:');
    expect(KV_QUARANTINE_PREFIXES).toContain('rl:');
    expect(KV_QUARANTINE_PREFIXES).toContain('store-order-lookup:');
    expect(KV_BACKUP_PREFIXES).not.toContain('admin-session:');
    expect(KV_BACKUP_PREFIXES).not.toContain('rl:');
  });

  it('parses Worker cache, KV, R2, and compatibility inventory from wrangler.toml', () => {
    const inventory = parseWranglerTomlInventory(`name = "store-worker"
compatibility_date = "2026-07-09"
compatibility_flags = ["nodejs_compat"]

[cache]
enabled = false

[exports.CachedAdminStoreReads]
type = "worker"

  [exports.CachedAdminStoreReads.cache]
  enabled = true

[[kv_namespaces]]
binding = "STORE_STATE"
id = "state-id"
preview_id = "state-preview"

[[r2_buckets]]
binding = "STORE_DOWNLOADS"
bucket_name = "store-downloads"
preview_bucket_name = "store-downloads-preview"
`);

    expect(inventory.name).toBe('store-worker');
    expect(inventory.compatibilityDate).toBe('2026-07-09');
    expect(inventory.compatibilityFlags).toEqual(['nodejs_compat']);
    expect(inventory.cache).toMatchObject({ enabled: false, crossVersionCache: false });
    expect(inventory.cachedExports).toEqual(['CachedAdminStoreReads']);
    expect(inventory.kvNamespaces[0]).toMatchObject({ binding: 'STORE_STATE', id: 'state-id' });
    expect(inventory.r2Buckets[0]).toMatchObject({ binding: 'STORE_DOWNLOADS', bucket_name: 'store-downloads' });
  });

  it('builds read-only Wrangler KV commands and optional value export commands', () => {
    const plan = buildKvBackupPlan(['orders:', 'store-coupons:v1'], { includeValues: true });

    expect(plan[0]).toMatchObject({
      prefix: 'orders:',
      binding: 'STORE_STATE',
      keysFile: 'kv/orders.keys.json',
      valuesFile: 'kv/orders.values.json'
    });
    expect(plan[0].commands[0]).toEqual([
      'npx',
      ['wrangler', 'kv', 'key', 'list', '--remote', '--binding', 'STORE_STATE', '--prefix', 'orders:']
    ]);
    expect(plan[0].commands[1]).toEqual([
      'npx',
      ['wrangler', 'kv', 'bulk', 'get', 'kv/orders.keys.json', '--remote', '--binding', 'STORE_STATE']
    ]);
  });

  it('does not export derived KV values when a value allowlist is supplied', () => {
    const plan = buildKvBackupPlan(['orders:', 'admin-store-orders:index:v2'], {
      includeValues: true,
      valuePrefixes: ['orders:']
    });
    expect(plan[0].valuesFile).toBe('kv/orders.values.json');
    expect(plan[1].valuesFile).toBe('');
    expect(plan[1].commands).toHaveLength(1);
  });

  it('transforms Wrangler KV bulk get output to bulk put records', () => {
    expect(transformKvBulkGetToPutRecords({
      'orders:one': { value: '{"ok":true}', metadata: { type: 'order' } },
      'store-coupons:v1': { value: '[]' },
      'admin-users:v1': '{"users":[]}'
    })).toEqual([
      { key: 'orders:one', value: '{"ok":true}', metadata: { type: 'order' } },
      { key: 'store-coupons:v1', value: '[]' },
      { key: 'admin-users:v1', value: '{"users":[]}' }
    ]);
  });

  it('chunks KV value reads at Cloudflare current limits and skips empty families', () => {
    const keys = Array.from({ length: 205 }, (_, index) => ({ name: `orders:${index}` }));
    expect(chunkKvBackupKeys(keys).map((chunk) => chunk.length)).toEqual([100, 100, 5]);
    expect(chunkKvBackupKeys([])).toEqual([]);
    expect(chunkKvBackupKeys(keys, 500).map((chunk) => chunk.length)).toEqual([100, 100, 5]);
  });

  it('reduces encrypted receipt warnings to non-sensitive categories', () => {
    const categories = sanitizeBackupWarningCategories([
      'kv values orders: failed: /Users/private/path and provider output',
      'stripe webhook_endpoints list failed: expired secret detail',
      'unclassified local warning /private/path'
    ]);
    expect(categories).toEqual(['backup_warning', 'kv_value_capture', 'stripe_provider_inventory']);
    expect(JSON.stringify(categories)).not.toContain('/Users/private');
    expect(JSON.stringify(categories)).not.toContain('expired secret');
  });

  it('formats plaintext manifests and encrypted receipts without assuming raw warnings exist', () => {
    expect(backupCompletionDetails({ outputDir: '/private/snapshot', warnings: ['one'] })).toEqual({
      destination: '/private/snapshot',
      warningCount: 1
    });
    expect(backupCompletionDetails({ outputName: 'encrypted-snapshot', warningCount: 2 })).toEqual({
      destination: 'encrypted-snapshot',
      warningCount: 2
    });
  });

  it('discovers configured product download object keys', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-backup-products-'));
    fs.mkdirSync(path.join(root, '_products'), { recursive: true });
    fs.writeFileSync(path.join(root, '_products', 'download.md'), `---
identifier: digital
download:
  file_key: downloads/file-one.pdf
variants:
  - id: deluxe
    download:
      file_key: "downloads/file-two.zip"
---
Body.
`, 'utf8');

    expect(discoverDownloadKeys(root)).toEqual(['downloads/file-one.pdf', 'downloads/file-two.zip']);
  });

  it('keeps R2 object paths inside the private snapshot directory', () => {
    const objectsDir = path.join(os.tmpdir(), 'store-r2-object-paths');
    expect(resolveR2BackupObjectPath(objectsDir, 'downloads/releases/file.pdf')).toBe(
      path.join(objectsDir, 'downloads', 'releases', 'file.pdf')
    );
    expect(() => resolveR2BackupObjectPath(objectsDir, '../outside.pdf')).toThrow(/safely/i);
    expect(() => resolveR2BackupObjectPath(objectsDir, 'downloads//file.pdf')).toThrow(/safely/i);
    expect(() => resolveR2BackupObjectPath(objectsDir, 'downloads\\file.pdf')).toThrow(/safely/i);
  });

  it('discovers every R2 object through bounded read-only API pagination', async () => {
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer r2-read-secret' });
      const cursor = url.searchParams.get('cursor') || '';
      return new Response(JSON.stringify(cursor ? {
        success: true,
        result: [{ key: 'unattached/private.bin' }],
        result_info: { cursor: '' }
      } : {
        success: true,
        result: [{ key: 'downloads/catalog.pdf' }],
        result_info: { cursor: 'next-page' }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    await expect(discoverR2ObjectKeys({
      accountId: '0123456789abcdef0123456789abcdef',
      bucket: 'store-downloads',
      apiToken: 'r2-read-secret',
      fetchImpl
    })).resolves.toEqual(['downloads/catalog.pdf', 'unattached/private.bin']);
  });

  it('records secret presence without exporting values', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-backup-secrets-'));
    const devVars = path.join(root, '.dev.vars');
    fs.writeFileSync(devVars, 'STRIPE_SECRET_KEY=sk_test_secret\nRESEND_API_KEY=re_secret\nWORKERS_CACHE_PURGE_SECRET=cache_secret\n', 'utf8');

    const inventory = buildSecretInventory({
      devVarsPath: devVars,
      env: { STRIPE_SECRET_KEY: 'sk_live_shell_secret' }
    });
    const stripe = inventory.find((entry) => entry.name === 'STRIPE_SECRET_KEY');
    const resend = inventory.find((entry) => entry.name === 'RESEND_API_KEY');
    const workersCache = inventory.find((entry) => entry.name === 'WORKERS_CACHE_PURGE_SECRET');

    expect(stripe).toMatchObject({ shellPresent: true, localDevPresent: true, valueExported: false });
    expect(resend).toMatchObject({ shellPresent: false, localDevPresent: true, valueExported: false });
    expect(workersCache).toMatchObject({ shellPresent: false, localDevPresent: true, valueExported: false });
    expect(JSON.stringify(inventory)).not.toContain('sk_live_shell_secret');
    expect(JSON.stringify(inventory)).not.toContain('re_secret');
    expect(JSON.stringify(inventory)).not.toContain('cache_secret');
  });

  it('dry-runs a snapshot without writing backup artifacts', async () => {
    const output = path.join(os.tmpdir(), `store-backup-dry-run-${Date.now()}`);
    const manifest = await createBackupSnapshot({
      output,
      dryRun: true,
      remote: false,
      skipGitBundle: true,
      skipBuild: true
    });

    expect(manifest.dryRun).toBe(true);
    expect(manifest.version).toBe(2);
    expect(manifest.remote).toBe(false);
    expect(manifest.commands.some((command) => command.label === 'git status.txt')).toBe(true);
    expect(manifest.warnings).toContain('Remote provider inventory skipped; rerun with --remote for read-only Wrangler/GitHub/Stripe probes.');
    expect(fs.existsSync(output)).toBe(false);
  });

  it('requires explicit acknowledgement, encryption, and an external path for sensitive snapshots', () => {
    const unsafe = validateBackupSafety({ remote: true, kvValues: true }, path.join(process.cwd(), 'backup-output'));
    expect(unsafe.ok).toBe(false);
    expect(unsafe.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('acknowledge-sensitive'),
      expect.stringContaining('encryption-recipient'),
      expect.stringContaining('inside the repository')
    ]));
    expect(validateBackupSafety({
      remote: true,
      kvValues: true,
      acknowledgeSensitive: 'STORE_SENSITIVE_BACKUP',
      encryptionRecipient: 'operator@example.com',
      encryptionBackend: 'gpg'
    }, process.cwd())).toMatchObject({ ok: false });
    expect(validateBackupSafety({
      remote: true,
      adminExports: true,
      acknowledgeSensitive: 'STORE_SENSITIVE_BACKUP',
      encryptionRecipient: 'operator@example.com',
      encryptionBackend: 'gpg'
    }, path.join(os.homedir(), 'store-backups', 'safe'))).toMatchObject({ ok: true, sensitive: true });
  });

  it('writes private checksum-verified metadata snapshots', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-backup-checksum-'));
    const output = path.join(root, 'snapshot');
    const manifest = await createBackupSnapshot({
      output,
      remote: false,
      skipGitBundle: true,
      skipFileCopy: true,
      skipBuild: true
    });
    const checksumFile = JSON.parse(fs.readFileSync(path.join(output, 'checksums.json'), 'utf8'));

    expect(manifest.version).toBe(2);
    expect(manifest.artifacts.length).toBeGreaterThan(0);
    expect(verifyChecksumManifest(output, checksumFile.artifacts)).toMatchObject({ ok: true });
    expect(fs.statSync(output).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(output, 'manifest.json')).mode & 0o777).toBe(0o600);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('loads a complete canonical data inventory', () => {
    const inventory = loadStoreDataInventory();
    expect(inventory.families.find((family: any) => family.id === 'store-downloads')).toMatchObject({
      binding: 'STORE_DOWNLOADS',
      classification: 'authoritative'
    });
    expect(inventory.families.find((family: any) => family.id === 'marketing-draft')).toMatchObject({
      classification: 'ephemeral-quarantined',
      restoreDefault: 'quarantine'
    });
    expect(inventory.families.find((family: any) => family.id === 'workers-cache-metrics')).toMatchObject({
      binding: 'STORE_CACHE_METRICS',
      type: 'analytics-engine',
      classification: 'incident-evidence',
      restoreDefault: 'do-not-restore'
    });
  });
});

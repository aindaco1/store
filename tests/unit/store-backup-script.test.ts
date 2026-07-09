import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  KV_BACKUP_PREFIXES,
  KV_QUARANTINE_PREFIXES,
  buildKvBackupPlan,
  buildSecretInventory,
  createBackupSnapshot,
  discoverDownloadKeys,
  parseWranglerTomlInventory,
  transformKvBulkGetToPutRecords
} from '../../scripts/store-backup.mjs';

describe('store backup script', () => {
  it('classifies authoritative and quarantine KV prefixes explicitly', () => {
    expect(KV_BACKUP_PREFIXES).toContain('orders:');
    expect(KV_BACKUP_PREFIXES).toContain('admin-store-orders:index:v1');
    expect(KV_BACKUP_PREFIXES).toContain('store-coupons:v1');
    expect(KV_BACKUP_PREFIXES).toContain('abandoned-cart-suppressed:');
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

[exports.CachedAdminStoreOrders]
type = "worker"

  [exports.CachedAdminStoreOrders.cache]
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
    expect(inventory.cachedExports).toEqual(['CachedAdminStoreOrders']);
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

  it('transforms Wrangler KV bulk get output to bulk put records', () => {
    expect(transformKvBulkGetToPutRecords({
      'orders:one': { value: '{"ok":true}', metadata: { type: 'order' } },
      'store-coupons:v1': { value: '[]' }
    })).toEqual([
      { key: 'orders:one', value: '{"ok":true}', metadata: { type: 'order' } },
      { key: 'store-coupons:v1', value: '[]' }
    ]);
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
      skipGitBundle: true
    });

    expect(manifest.dryRun).toBe(true);
    expect(manifest.remote).toBe(false);
    expect(manifest.commands.some((command) => command.label === 'git status.txt')).toBe(true);
    expect(manifest.warnings).toContain('Remote provider inventory skipped; rerun with --remote for read-only Wrangler/GitHub/Stripe probes.');
    expect(fs.existsSync(output)).toBe(false);
  });
});

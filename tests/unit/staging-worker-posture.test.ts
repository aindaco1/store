import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWranglerConfig } from '../../scripts/lib/wrangler-config.mjs';

const root = path.resolve(__dirname, '..', '..');
const config = parseWranglerConfig(fs.readFileSync(path.join(root, 'worker', 'wrangler.toml'), 'utf8'));
const production = config;
const staging = config.env?.staging;

describe('Store staging Worker posture', () => {
  it('uses a test-only workers.dev boundary with no production route or cron', () => {
    expect(staging?.name).toBe('store-worker-staging');
    expect(staging?.workers_dev).toBe(true);
    expect(staging?.routes || []).toEqual([]);
    expect(staging?.triggers?.crons || []).toEqual([]);
    expect(staging?.vars?.APP_MODE).toBe('test');
    expect(staging?.vars?.WORKER_BASE).toBe('https://store-worker-staging.jogo.workers.dev');
    expect(staging?.vars?.WORKER_BASE).not.toBe(production.vars?.WORKER_BASE);
  });

  it('isolates all mutable storage from production', () => {
    const productionKv = new Map((production.kv_namespaces || []).map((entry: any) => [entry.binding, entry.id]));
    const stagingKv = new Map((staging?.kv_namespaces || []).map((entry: any) => [entry.binding, entry.id]));
    expect(stagingKv.get('STORE_STATE')).toBeTruthy();
    expect(stagingKv.get('RATELIMIT')).toBeTruthy();
    expect(stagingKv.get('STORE_STATE')).not.toBe(productionKv.get('STORE_STATE'));
    expect(stagingKv.get('RATELIMIT')).not.toBe(productionKv.get('RATELIMIT'));

    const productionBucket = production.r2_buckets?.find((entry: any) => entry.binding === 'STORE_DOWNLOADS');
    const stagingBucket = staging?.r2_buckets?.find((entry: any) => entry.binding === 'STORE_DOWNLOADS');
    expect(stagingBucket?.bucket_name).toBe('store-downloads-staging');
    expect(stagingBucket?.bucket_name).not.toBe(productionBucket?.bucket_name);
  });

  it('disables provider and background side effects while preserving rendered-email evidence', () => {
    expect(staging?.vars).toMatchObject({
      STORE_EMAIL_DRY_RUN: 'true',
      RESEND_EMAIL_DRY_RUN: 'true',
      EMAIL_OUTBOX_ENABLED: 'false',
      PAYMENT_RECONCILIATION_ENABLED: 'false',
      USPS_ENABLED: 'false',
      ANALYTICS_PROVIDER: 'none',
      ADMIN_LOCAL_REPO_WRITES_ENABLED: 'false'
    });
  });

  it('keeps Stripe credentials out of committed configuration', () => {
    expect(staging?.vars?.STRIPE_SECRET_KEY).toBeUndefined();
    expect(staging?.vars?.STRIPE_SECRET_KEY_TEST).toBeUndefined();
    expect(staging?.vars?.STRIPE_WEBHOOK_SECRET).toBeUndefined();
    expect(staging?.vars?.STRIPE_WEBHOOK_SECRET_TEST).toBeUndefined();
    expect(staging?.vars?.STRIPE_PUBLISHABLE_KEY).toBe('');
    expect(staging?.vars?.STRIPE_PUBLISHABLE_KEY_TEST).toBeUndefined();
  });

  it('does not spoof Cloudflare-owned client headers during remote smoke checks', () => {
    const paymentSmoke = fs.readFileSync(path.join(root, 'scripts', 'release-payment-smoke.mjs'), 'utf8');
    const workerSmoke = fs.readFileSync(path.join(root, 'scripts', 'test-worker.sh'), 'utf8');
    expect(paymentSmoke).toContain('...localSyntheticClientHeaders(workerUrl)');
    expect(paymentSmoke).not.toContain("Origin: siteUrl,\n      'CF-Connecting-IP'");
    expect(workerSmoke).toContain('case "$WORKER_URL" in');
    expect(workerSmoke).toContain('http://127.0.0.1:*');
    expect(workerSmoke).toContain('https://localhost:*)\n    ruby ./scripts/sync-worker-config.rb');
  });
});

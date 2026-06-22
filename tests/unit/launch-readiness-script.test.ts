import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'check-launch-readiness.rb');

const users = [
  { name: 'Alonso', email: 'alonso@dustwave.xyz', role: 'super_admin', accessScopes: [] },
  { name: 'Backup', email: 'backup@dustwave.xyz', role: 'super_admin', accessScopes: [] },
];

function writeFile(root: string, relPath: string, content: string) {
  const target = path.join(root, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function tomlString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function baseConfig(options: { uspsClientId?: string; adminUsers?: typeof users } = {}) {
  const adminUsers = options.adminUsers || users;
  const userYaml = adminUsers.map((user) => `    - name: ${user.name}
      email: ${user.email}
      role: ${user.role}`).join('\n');

  return `title: Store
url: https://shop.dustwave.xyz
platform:
  site_url: "https://shop.dustwave.xyz"
  worker_url: "https://checkout.dustwave.xyz"
admin:
  production_site_url: "https://shop.dustwave.xyz"
  production_worker_url: "https://checkout.dustwave.xyz"
  users:
${userYaml}
admin_production_site_url: "https://shop.dustwave.xyz"
admin_production_worker_url: "https://checkout.dustwave.xyz"
tax:
  provider: "nm_grt"
shipping:
  origin_zip: "87120"
  origin_country: "US"
  usps:
    enabled: true
    client_id: "${options.uspsClientId ?? 'usps-client'}"
checkout:
  stripe_publishable_key: "pk_live_fixture"
`;
}

function localConfig() {
  return `url: http://127.0.0.1:4002
platform:
  site_url: "http://127.0.0.1:4002"
  worker_url: "http://127.0.0.1:8989"
`;
}

function wranglerToml(options: { uspsClientId?: string; adminUsers?: typeof users } = {}) {
  const adminUsers = options.adminUsers || users;
  return `name = "store-worker"

[vars]
SITE_BASE = "https://shop.dustwave.xyz"
WORKER_BASE = "https://checkout.dustwave.xyz"
CANONICAL_SITE_BASE = "https://shop.dustwave.xyz"
CANONICAL_WORKER_BASE = "https://checkout.dustwave.xyz"
CORS_ALLOWED_ORIGIN = "https://shop.dustwave.xyz"
APP_MODE = "live"
ADMIN_USERS_JSON = "${tomlString(JSON.stringify(adminUsers))}"
TAX_PROVIDER = "nm_grt"
SHIPPING_ORIGIN_ZIP = "87120"
SHIPPING_ORIGIN_COUNTRY = "US"
USPS_ENABLED = "true"
USPS_CLIENT_ID = "${options.uspsClientId ?? 'usps-client'}"
STRIPE_PUBLISHABLE_KEY = "pk_live_fixture"

[[durable_objects.bindings]]
name = "STORE_INVENTORY_COORDINATOR"
class_name = "StoreInventoryCoordinator"

[[r2_buckets]]
binding = "STORE_DOWNLOADS"
bucket_name = "store-downloads"

[[kv_namespaces]]
binding = "STORE_STATE"
id = "store-state"

[[kv_namespaces]]
binding = "RATELIMIT"
id = "ratelimit"
`;
}

function physicalProduct(inventory: number) {
  return `---
identifier: poster-1
sku: poster-1
name: Poster
price: 35
type: poster
fulfillment_type: physical
status: active
inventory_tracking: true
inventory: ${inventory}
---
Poster.
`;
}

function digitalProduct(fileKey = 'download-file') {
  return `---
identifier: download-1
sku: download-1
name: Download
price: 5
type: digital
fulfillment_type: digital
status: active
inventory_tracking: false
download:
  file_key: ${fileKey}
---
Download.
`;
}

function writeFixture(callback: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-launch-readiness-'));
  try {
    fs.mkdirSync(path.join(root, '_products'), { recursive: true });
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runReadiness(root: string) {
  const result = spawnSync('ruby', [scriptPath, '--root', root, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const report = JSON.parse(result.stdout);
  return { result, report };
}

describe('launch readiness script', () => {
  it('passes repo-visible checks when launch inputs are configured', () => {
    writeFixture((root) => {
      writeFile(root, '_config.yml', baseConfig());
      writeFile(root, '_config.local.yml', localConfig());
      writeFile(root, 'worker/wrangler.toml', wranglerToml());
      writeFile(root, '_products/poster.md', physicalProduct(12));
      writeFile(root, '_products/download.md', digitalProduct());

      const { result, report } = runReadiness(root);

      expect(result.status).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.action_count).toBe(0);
      const digitalCheck = report.checks.find((check: { id: string }) => check.id === 'digital-download-fulfillment');
      expect(digitalCheck?.status).toBe('manual');
      expect(digitalCheck?.details.url_env_keys[0].env).toBe('STORE_DOWNLOAD_URL_DOWNLOAD_FILE');
    });
  });

  it('flags local launch blockers without requiring external accounts', () => {
    writeFixture((root) => {
      const oneAdmin = [users[0]];
      writeFile(root, '_config.yml', baseConfig({ uspsClientId: '', adminUsers: oneAdmin }));
      writeFile(root, '_config.local.yml', localConfig());
      writeFile(root, 'worker/wrangler.toml', wranglerToml({ uspsClientId: '', adminUsers: oneAdmin }));
      writeFile(root, '_products/poster.md', physicalProduct(0));
      writeFile(root, '_products/download.md', digitalProduct(''));

      const { result, report } = runReadiness(root);
      const actionIds = report.checks
        .filter((check: { status: string }) => check.status === 'action')
        .map((check: { id: string }) => check.id);
      const warningIds = report.checks
        .filter((check: { status: string }) => check.status === 'warning')
        .map((check: { id: string }) => check.id);

      expect(result.status).toBe(1);
      expect(report.ok).toBe(false);
      expect(actionIds).toEqual(expect.arrayContaining([
        'usps-nm-grt-config',
        'active-inventory-baselines',
        'digital-download-keys',
      ]));
      expect(warningIds).toContain('admin-bootstrap-users');
    });
  });
});

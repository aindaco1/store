import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditProductionPosture, productionPostureIssue } from '../../scripts/audit-production-posture.mjs';
import { normalizeWranglerInventory, parseWranglerConfig } from '../../scripts/lib/wrangler-config.mjs';

const root = path.resolve(__dirname, '..', '..');

function productionConfig() {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'production-posture.json'), 'utf8'));
  const wranglerSource = fs.readFileSync(path.join(root, 'worker', 'wrangler.toml'), 'utf8');
  return {
    config,
    inventory: normalizeWranglerInventory(wranglerSource),
    wranglerConfig: parseWranglerConfig(wranglerSource)
  };
}

describe('Store production posture audit', () => {
  it('reports names and statuses without secret values', () => {
    const { config, inventory, wranglerConfig } = productionConfig();
    const allSecrets = [...config.requiredSecrets, ...config.recommendedSecrets].map((name: string) => ({ name, type: 'secret_text' }));
    const evidence = auditProductionPosture({ config, inventory, wranglerConfig, secrets: allSecrets, providerEvidence: { failCount: 0 } });
    expect(evidence.status).not.toBe('action');
    expect(evidence.containsCredentials).toBe(false);
    expect(productionPostureIssue(evidence)).not.toContain('secret_text');
  });

  it('fails closed when required production secrets are absent', () => {
    const { config, inventory, wranglerConfig } = productionConfig();
    const evidence = auditProductionPosture({ config, inventory, wranglerConfig, secrets: [] });
    expect(evidence.status).toBe('action');
    expect(evidence.checks.some((check: any) => check.id === 'secret:STRIPE_WEBHOOK_SECRET' && check.status === 'action')).toBe(true);
  });

  it('fails closed unless Wrangler preview URLs are explicitly disabled', () => {
    const { config, inventory, wranglerConfig } = productionConfig();

    for (const previewUrls of [undefined, true]) {
      const evidence = auditProductionPosture({
        config,
        inventory,
        wranglerConfig: { ...wranglerConfig, preview_urls: previewUrls }
      });
      expect(evidence.checks).toContainEqual({
        id: 'config:preview-urls',
        status: 'action',
        detail: 'preview_urls must be explicitly false'
      });
    }
  });
});

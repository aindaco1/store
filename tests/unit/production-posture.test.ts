import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditProductionPosture, productionPostureIssue } from '../../scripts/audit-production-posture.mjs';
import { normalizeWranglerInventory } from '../../scripts/lib/wrangler-config.mjs';

const root = path.resolve(__dirname, '..', '..');

describe('production posture audit', () => {
  it('reports names and statuses without secret values', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'production-posture.json'), 'utf8'));
    const inventory = normalizeWranglerInventory(fs.readFileSync(path.join(root, 'worker', 'wrangler.toml'), 'utf8'));
    const allSecrets = [...config.requiredSecrets, ...config.recommendedSecrets].map((name: string) => ({ name, type: 'secret_text' }));
    const evidence = auditProductionPosture({ config, inventory, secrets: allSecrets, providerEvidence: { failCount: 0 } });
    expect(evidence.status).not.toBe('action');
    expect(evidence.containsCredentials).toBe(false);
    expect(productionPostureIssue(evidence)).not.toContain('secret_text');
  });

  it('fails closed when required production secrets are absent', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'production-posture.json'), 'utf8'));
    const inventory = normalizeWranglerInventory(fs.readFileSync(path.join(root, 'worker', 'wrangler.toml'), 'utf8'));
    const evidence = auditProductionPosture({ config, inventory, secrets: [] });
    expect(evidence.status).toBe('action');
    expect(evidence.checks.some((check: any) => check.id === 'secret:STRIPE_WEBHOOK_SECRET' && check.status === 'action')).toBe(true);
  });
});

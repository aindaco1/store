import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');

function readWorkflow(name: string) {
  return fs.readFileSync(path.join(repoRoot, '.github', 'workflows', name), 'utf8');
}

describe('workflow security posture', () => {
  it('pins cache purging to the Cloudflare API instead of an unpinned third-party action', () => {
    const deploy = readWorkflow('deploy.yml');

    expect(deploy).not.toContain('jakejarvis/cloudflare-purge-action@master');
    expect(deploy).toContain('https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE}/purge_cache');
    expect(deploy).toContain('CLOUDFLARE_CACHE_PURGE_TOKEN');
    expect(deploy).toContain('/admin/workers-cache/purge');
    expect(deploy).toContain('WORKERS_CACHE_PURGE_SECRET');
    expect(deploy).toContain('for attempt in 1 2 3 4 5 6');
    expect(deploy).toContain('waiting for Worker propagation');
    expect(deploy).toContain('sleep "$((attempt * 5))"');
    expect(deploy).not.toContain('CLOUDFLARE_EMAIL:');
    expect(deploy).not.toContain('CLOUDFLARE_KEY:');
  });

  it('keeps production deploy manual-only so release merges do not deploy', () => {
    const deploy = readWorkflow('deploy.yml');

    expect(deploy).toContain('workflow_dispatch:');
    expect(deploy).not.toMatch(/\n\s+push:\s*\n/);
    expect(deploy).not.toContain("github.event_name == 'push'");
    expect(deploy).toContain('npx wrangler deploy -c wrangler.toml --env=""');
    expect(deploy).toContain('actions/deploy-pages@v5');
    expect(deploy).toContain('group: "production-operations"');
  });

  it('sends media optimization changes through a pull request', () => {
    const workflow = readWorkflow('media-optimization.yml');

    expect(workflow).toContain('pull-requests: write');
    expect(workflow).toContain('gh pr create');
    expect(workflow).toContain('bot/media-optimization-${GITHUB_RUN_ID}');
    expect(workflow).not.toMatch(/git push\s+origin\s+main/);
    expect(workflow).not.toMatch(/git push\s+origin\s+HEAD:main/);
  });

  it('keeps scheduled Podman E2E read-only and local', () => {
    const workflow = readWorkflow('podman-e2e.yml');

    expect(workflow).toContain('schedule:');
    expect(workflow).toContain("cron: '17 9 * * 1'");
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('npm run podman:doctor');
    expect(workflow).toContain('npm run test:e2e:headless:podman');
    expect(workflow).toContain('SKIP_STRIPE: "true"');
    expect(workflow).not.toContain('contents: write');
    expect(workflow).not.toContain('pull-requests: write');
    expect(workflow).not.toMatch(/git push|gh pr create|wrangler deploy|deploy:worker|npm run deploy/);
    expect(workflow).not.toMatch(/CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|STRIPE_LIVE_SECRET_KEY/);
  });

  it('keeps release provider evidence read-only and DNS-scoped', () => {
    const workflow = readWorkflow('release-provider-evidence.yml');

    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('CLOUDFLARE_DNS_API_TOKEN');
    expect(workflow).toContain('CLOUDFLARE_ZONE_ID');
    expect(workflow).toContain('npm run release:providers -- --cloudflare-dns-only --strict --no-dev-vars');
    expect(workflow).not.toMatch(/wrangler deploy|deploy:worker|purge_cache|contents: write|pull-requests: write/);
  });

  it('collects scheduled Workers Cache evidence without purge or configuration mutations', () => {
    const workflow = readWorkflow('workers-cache-evidence.yml');

    expect(workflow).toContain("cron: '17 3 * * *'");
    expect(workflow).toContain("timezone: 'America/Denver'");
    expect(workflow).toContain('environment: production-observability');
    expect(workflow).toContain('group: production-operations');
    expect(workflow).toContain('CLOUDFLARE_ANALYTICS_API_TOKEN');
    expect(workflow).toContain('WORKERS_CACHE_EVIDENCE_SECRET');
    expect(workflow).toContain('npm run cache:observability');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).not.toMatch(/workers-cache\/purge|wrangler deploy|deploy:worker|contents: write|pull-requests: write/);
  });

  it('runs weekly recovery readiness with synthetic data and read-only provider evidence', () => {
    const workflow = readWorkflow('recovery-readiness.yml');

    expect(workflow).toContain("cron: '43 3 * * 0'");
    expect(workflow).toContain("timezone: 'America/Denver'");
    expect(workflow).toContain('npm run restore:rehearse');
    expect(workflow).toContain('npm run backup:readiness');
    expect(workflow).toContain('--cloudflare-dns-only --strict --no-dev-vars');
    expect(workflow).toContain('SKIP_STRIPE: "true"');
    expect(workflow).not.toMatch(/backup:snapshot|--kv-values|--r2-objects|wrangler deploy|contents: write|pull-requests: write/);
  });

  it('keeps quarterly captured-data recovery approval-gated and preview-only', () => {
    const workflow = readWorkflow('recovery-operations.yml');
    const drill = fs.readFileSync(path.join(repoRoot, 'scripts', 'protected-recovery-drill.sh'), 'utf8');

    expect(workflow).toContain("cron: '17 4 1 1,4,7,10 *'");
    expect(workflow).toContain("timezone: 'America/Denver'");
    expect(workflow).toContain("vars.RECOVERY_DRILL_ENABLED == 'true'");
    expect(workflow).toContain('environment: production-recovery');
    expect(workflow).toContain('group: production-operations');
    expect(workflow).toContain('STORE_BACKUP_AGE_IDENTITY');
    expect(workflow).toContain('STORE_BACKUP_ADMIN_LOGIN_TOKEN');
    expect(workflow).toContain('npm run recovery:traffic-preflight');
    expect(workflow).toContain('CLOUDFLARE_WORKER_SCRIPT_NAME');
    expect(workflow).toContain('protected-recovery-drill.sh');
    const protectedJob = workflow.split('  protected-preview-restore:')[1];
    const protectedJobHeader = protectedJob.split('    steps:')[0];
    expect(protectedJobHeader).not.toContain('${{ runner.temp }}');
    expect(workflow).toContain('STORE_RECOVERY_TRAFFIC_EVIDENCE: ${{ runner.temp }}/recovery-preflight/recovery-traffic-preflight.json');
    expect(drill).toContain('--target=preview');
    expect(drill).toContain('--preview-r2-bucket=');
    expect(drill).toContain('--acknowledge-sensitive=STORE_SENSITIVE_BACKUP');
    expect(drill).toContain('RESTORE_RESULT="${WORK_DIR}/restore-result.json"');
    expect(drill).not.toContain('${EVIDENCE_DIR}/restore-result.json');
    expect(drill).not.toContain('--target=production');
    expect(drill).not.toContain('STORE_PRODUCTION_RESTORE');
    expect(workflow).not.toMatch(/contents: write|pull-requests: write|wrangler deploy|deploy:worker/);
  });
});

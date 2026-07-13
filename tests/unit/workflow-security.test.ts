import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');

function readWorkflow(name: string) {
  return fs.readFileSync(path.join(repoRoot, '.github', 'workflows', name), 'utf8');
}

function workflowFiles() {
  const workflowDir = path.join(repoRoot, '.github', 'workflows');
  return fs.readdirSync(workflowDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => ({ name, content: readWorkflow(name) }));
}

describe('workflow security posture', () => {
  it('keeps immutable action and npm dependency updates automated', () => {
    const dependabot = fs.readFileSync(path.join(repoRoot, '.github', 'dependabot.yml'), 'utf8');

    expect(dependabot).toContain('package-ecosystem: github-actions');
    expect(dependabot).toContain('package-ecosystem: npm');
    expect(dependabot).toContain('directory: /worker');
  });

  it('pins every external action to an immutable commit and declares token permissions', () => {
    for (const { name, content } of workflowFiles()) {
      expect(content, `${name} must declare least-privilege token permissions`).toMatch(/^permissions:\n/m);
      for (const line of content.split(/\r?\n/)) {
        const action = line.match(/^\s*uses:\s*([^\s#]+)/)?.[1] || '';
        if (!action || action.startsWith('./')) continue;
        const ref = action.split('@').pop() || '';
        expect(ref, `${name} has a mutable action reference: ${action}`).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });

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
    expect(deploy).toContain('npm run cloudflare:admin-response-rule -- --verify-public --require-current');
    expect(deploy).not.toContain('CLOUDFLARE_CACHE_RULES_API_TOKEN');
    expect(deploy).not.toContain('CLOUDFLARE_EMAIL:');
    expect(deploy).not.toContain('CLOUDFLARE_KEY:');
  });

  it('keeps production deploy manual-only so release merges do not deploy', () => {
    const deploy = readWorkflow('deploy.yml');
    const workflowHeader = deploy.split('\njobs:')[0];
    const deployJob = deploy.split('  deploy:')[1];

    expect(deploy).toContain('workflow_dispatch:');
    expect(deploy).not.toMatch(/\n\s+push:\s*\n/);
    expect(deploy).not.toContain("github.event_name == 'push'");
    expect(deploy).toContain('npx wrangler deploy -c wrangler.toml --env=""');
    expect(deploy).toContain('actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5');
    expect(deploy).toContain('group: "production-operations"');
    expect(workflowHeader).toContain('permissions:\n  contents: read');
    expect(workflowHeader).not.toContain('pages: write');
    expect(workflowHeader).not.toContain('id-token: write');
    expect(deployJob).toContain('permissions:\n      contents: read\n      pages: write\n      id-token: write');
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

  it('keeps release provider evidence read-only and provider-scoped', () => {
    const workflow = readWorkflow('release-provider-evidence.yml');

    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('CLOUDFLARE_DNS_API_TOKEN');
    expect(workflow).toContain('CLOUDFLARE_ZONE_ID');
    expect(workflow).toContain('npm run release:providers -- --cloudflare-dns-only --strict --no-dev-vars');
    expect(workflow).toContain('npm run cloudflare:admin-response-rule -- --verify-public --require-current');
    expect(workflow).not.toContain('CLOUDFLARE_CACHE_RULES_API_TOKEN');
    expect(workflow).not.toContain('--apply');
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
    expect(workflow).toContain('WORKERS_CACHE_EVIDENCE_ROUTE');
    expect(workflow).toContain('--route="${WORKERS_CACHE_EVIDENCE_ROUTE}"');
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

  it('pins the localization review runtime and keeps the workflow read-only', () => {
    const workflow = readWorkflow('localization-review.yml');

    expect(workflow).toContain("ruby-version: '3.2'");
    expect(workflow).toContain('npm run test:i18n');
    expect(workflow).toContain('npm run release:i18n-seo-evidence');
    expect(workflow).toContain('npm run localization:review');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).not.toMatch(/contents: write|pull-requests: write|wrangler deploy|deploy:worker/);
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
    expect(workflow).toContain('STORE_RECOVERY_ARCHIVE_ACCOUNT_ID');
    expect(workflow).toContain('STORE_RECOVERY_ARCHIVE_S3_URI');
    expect(workflow).toContain('STORE_RECOVERY_ARCHIVE_AWS_ACCESS_KEY_ID');
    expect(workflow).toContain('STORE_RECOVERY_ARCHIVE_AWS_SECRET_ACCESS_KEY');
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
    expect(drill).toContain('--stripe-mode=required');
    expect(drill).toContain('--expected-stripe-mode=live');
    expect(drill).toContain('--verify');
    expect(drill).toContain('restoreReadbackVerified');
    expect(drill).toContain('--cleanup-preview');
    expect(drill).toContain('STORE_PREVIEW_RESTORE_CLEANUP');
    expect(drill).toContain('previewCleanupVerified');
    expect(drill).toContain('STRIPE_SECRET_KEY');
    expect(workflow).toContain('STRIPE_RECOVERY_READ_KEY');
    expect(workflow).toContain('sudo apt-get install -y age');
    expect(workflow).toContain('aws --version');
    expect(drill).toContain('RESTORE_RESULT="${WORK_DIR}/restore-result.json"');
    expect(workflow).toContain('STORE_RECOVERY_ARCHIVE_ACCESS_KEY_ID');
    expect(workflow).toContain('STORE_RECOVERY_ARCHIVE_S3_ENDPOINT');
    expect(workflow).toContain("STORE_RECOVERY_ARCHIVE_LOCK_DAYS: ${{ vars.STORE_RECOVERY_ARCHIVE_LOCK_DAYS || '400' }}");
    expect(workflow).toContain("STORE_RECOVERY_ARCHIVE_PROVIDER: ${{ vars.STORE_RECOVERY_ARCHIVE_PROVIDER || 'cloudflare-r2' }}");
    expect(drill).toContain('The recovery archive account must be separate from production.');
    expect(drill).toContain('STORE_RECOVERY_ARCHIVE_S3_URI must include a bounded Store-only prefix.');
    expect(drill).toContain('archive-lock-probe');
    expect(drill).toContain('s3 rm "$lock_probe_uri"');
    expect(drill).toContain('archiveLockDeleteRejected: true');
    expect(drill).toContain('aws "${archive_cli_args[@]}" s3 cp');
    expect(drill).toContain('--endpoint-url "$ARCHIVE_ENDPOINT"');
    expect(drill).toContain('cmp -s');
    expect(drill).toContain('offAccountArchiveVerified');
    expect(drill).not.toContain('${EVIDENCE_DIR}/restore-result.json');
    expect(drill).not.toContain('--target=production');
    expect(drill).not.toContain('STORE_PRODUCTION_RESTORE');
    expect(workflow).not.toMatch(/contents: write|pull-requests: write|wrangler deploy|deploy:worker/);
  });
});

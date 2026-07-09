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
    expect(deploy).not.toContain('CLOUDFLARE_EMAIL:');
    expect(deploy).not.toContain('CLOUDFLARE_KEY:');
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
});

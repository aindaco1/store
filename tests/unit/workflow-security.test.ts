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
});

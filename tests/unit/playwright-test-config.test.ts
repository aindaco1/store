import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('Playwright test server config', () => {
  it('generates an isolated Jekyll config overlay for local E2E servers', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'store-jekyll-test-config-'));
    const outputPath = join(tempDir, 'config.yml');

    try {
      const stdout = execFileSync('bash', ['scripts/jekyll-test-config-files.sh', outputPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          SITE_BASE: 'http://127.0.0.1:4002',
          WORKER_BASE: 'http://127.0.0.1:8989'
        }
      });

      expect(stdout.trim()).toBe(`_config.yml,${outputPath}`);
      const generatedConfig = readFileSync(outputPath, 'utf8');
      expect(generatedConfig).toContain('url: "http://127.0.0.1:4002"');
      expect(generatedConfig).toContain('site_url: "http://127.0.0.1:4002"');
      expect(generatedConfig).toContain('worker_url: "http://127.0.0.1:8989"');
      expect(generatedConfig).toContain('turnstile_site_key: ""');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps Playwright on the disposable config path instead of local dev config', () => {
    const playwrightConfig = readFileSync(join(repoRoot, 'playwright.config.js'), 'utf8');
    const webServerScript = readFileSync(join(repoRoot, 'scripts/playwright-web-server.sh'), 'utf8');

    expect(playwrightConfig).toContain("command: './scripts/playwright-web-server.sh'");
    expect(playwrightConfig).not.toContain('_config.local.yml');
    expect(webServerScript).toContain('TEMP_JEKYLL_CONFIG_DIR="$(mktemp -d /tmp/store-playwright-jekyll.XXXXXX)"');
    expect(webServerScript).toContain('TEMP_JEKYLL_CONFIG="${TEMP_JEKYLL_CONFIG_DIR}/config.yml"');
    expect(webServerScript).toContain('./scripts/jekyll-test-config-files.sh "${TEMP_JEKYLL_CONFIG}"');
    expect(webServerScript).toContain('rm -rf "${TEMP_JEKYLL_CONFIG_DIR}"');
    expect(webServerScript).not.toContain('_config.local.yml');
  });

  it('keeps pre-merge build checks from auditing stale generated output', () => {
    const preMergeScript = readFileSync(join(repoRoot, 'scripts/pre-merge-regression.sh'), 'utf8');

    expect(preMergeScript).toContain('rm -rf _site .jekyll-cache');
    expect(preMergeScript).toContain('SKIP_TESTS=1 bundle exec jekyll build --config "${jekyll_config_files}" --quiet || return 1');
    expect(preMergeScript).toContain('/workspace/scripts/podman-jekyll-command.sh env SKIP_TESTS=1 bundle exec jekyll build --config "${jekyll_config_files}" --quiet || return 1');
    expect(preMergeScript).toContain('minify_site_assets || return 1');
  });

  it('keeps Podman site builds local when _config.local.yml is absent', () => {
    const podmanSiteEntrypoint = readFileSync(join(repoRoot, 'scripts/podman-site-entrypoint.sh'), 'utf8');

    expect(podmanSiteEntrypoint).toContain('if [[ -f /workspace/_config.local.yml ]]; then');
    expect(podmanSiteEntrypoint).toContain('/workspace/scripts/jekyll-config-files.sh /workspace');
    expect(podmanSiteEntrypoint).toContain('/workspace/scripts/jekyll-test-config-files.sh "${TEMP_JEKYLL_CONFIG}"');
    expect(podmanSiteEntrypoint).toContain('SITE_BASE="${SITE_BASE:-http://127.0.0.1:4002}"');
    expect(podmanSiteEntrypoint).toContain('WORKER_BASE="${WORKER_BASE:-http://127.0.0.1:8989}"');
  });
});

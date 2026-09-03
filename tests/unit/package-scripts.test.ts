import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('package test scripts', () => {
  it('regenerates the catalog before both local development startup paths', () => {
    for (const file of ['scripts/dev.sh', 'scripts/dev-podman.sh']) {
      const source = readFileSync(join(repoRoot, file), 'utf8');
      expect(source).toContain('ruby ./scripts/generate-catalog-snapshot.rb');
      expect(source.indexOf('ruby ./scripts/generate-catalog-snapshot.rb')).toBeLessThan(source.indexOf('configure-dev-secrets.sh'));
    }
    expect(readFileSync(join(repoRoot, 'worker/Containerfile.dev'), 'utf8')).toContain('    ruby \\');
  });
  it('pins explicit Jekyll template check and write commands', () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    const command = 'node ./shared/dust-wave-jekyll-template/bin/sync-consumer.mjs --consumer-root .';

    expect(packageJson.scripts['jekyll-template:check']).toBe(`${command} --check`);
    expect(packageJson.scripts['jekyll-template:sync']).toBe(`${command} --write`);
  });

  it('minifies only explicitly selected generated site roots', () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    const command = 'node ./shared/dust-wave-platform/packages/build-core/bin/minify-site-assets.mjs --asset-dir assets --asset-dir shared/dust-wave-platform/packages/site-shell/src';

    expect(packageJson.scripts['assets:minify']).toBe(`${command} --write`);
    expect(packageJson.scripts['assets:minify:check']).toBe(`${command} --check`);
  });

  it('keeps the coverage command reproducible from declared dependencies', () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

    expect(packageJson.scripts['test:unit:coverage']).toBe('vitest run --coverage');
    expect(packageJson.devDependencies['@vitest/coverage-v8']).toBeTruthy();
  });

  it('keeps runtime-dependent default tests on the Podman stack', () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    const scripts = packageJson.scripts || {};

    expect(scripts.test).toBe('npm run test:unit && npm run test:e2e');
    expect(scripts['test:e2e']).toBe('./scripts/test-e2e.sh');
    expect(scripts['test:e2e:headless']).toBe('npm run test:e2e:headless:podman');
    expect(scripts['test:e2e:headless:podman']).toContain('./scripts/podman-playwright-run.sh');
    expect(scripts['test:security']).toBe('npm run test:security:podman');
    expect(scripts['test:security:podman']).toContain('./scripts/podman-stack-run.sh');
  });

  it('keeps explicit host aliases for focused local debugging', () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    const scripts = packageJson.scripts || {};

    expect(scripts['test:e2e:host']).toBe('./scripts/test-e2e.sh --host');
    expect(scripts['test:e2e:headless:host']).toBe('CI=1 playwright test');
    expect(scripts['test:security:host']).toBe('vitest run --config vitest.security.config.mts');
  });

  it('keeps the E2E shell helper Podman-first with an explicit host opt-out', () => {
    const e2eScript = readFileSync(join(repoRoot, 'scripts/test-e2e.sh'), 'utf8');

    expect(e2eScript).toContain('USE_PODMAN=true');
    expect(e2eScript).toContain('--host|--no-podman)');
    expect(e2eScript).toContain('CI=1 ./scripts/podman-playwright-run.sh npx playwright test');
  });

  it('keeps pre-merge runtime gates on Podman-backed defaults', () => {
    const preMergeScript = readFileSync(join(repoRoot, 'scripts/pre-merge-regression.sh'), 'utf8');

    expect(preMergeScript).toContain('run_phase "8. Security suite" npm run test:security');
    expect(preMergeScript).toContain('run_phase "7b. Podman release resource check" env PODMAN_REQUIRE_RELEASE_RESOURCES=true npm run podman:doctor');
    expect(preMergeScript).toContain('run_phase "9. Podman Store Worker smoke" ./scripts/test-worker.sh --podman');
    expect(preMergeScript).toContain('run_phase "10. Podman E2E suite" npm run test:e2e:headless');
    expect(preMergeScript).not.toContain('run_phase "9a. Host Store Worker smoke"');
    expect(preMergeScript).not.toContain('run_phase "10. Headless E2E suite"');
  });

  it('atomically restores the checked-in Worker config after pre-merge synchronization', () => {
    const workerConfigPath = join(repoRoot, 'worker/wrangler.toml');
    const before = readFileSync(workerConfigPath, 'utf8');
    const syncWorkerConfig = readFileSync(join(repoRoot, 'scripts/sync-worker-config.rb'), 'utf8');
    const preMergeScript = readFileSync(join(repoRoot, 'scripts/pre-merge-regression.sh'), 'utf8');

    execFileSync(
      'bash',
      ['scripts/pre-merge-regression.sh', '__sync_worker_config_restore_check'],
      { cwd: repoRoot, stdio: 'pipe' }
    );

    expect(readFileSync(workerConfigPath, 'utf8')).toBe(before);
    expect(syncWorkerConfig).toContain('Tempfile.create([".#{File.basename(path)}.", \'.tmp\'], File.dirname(path))');
    expect(syncWorkerConfig).toContain('File.rename(file.path, path)');
    expect(preMergeScript).toContain('mktemp worker/.wrangler.toml.restore.XXXXXX');
    expect(preMergeScript).toContain('mv -f "${worker_config_restore}" worker/wrangler.toml');
  });

  it('keeps local order email delivery immediate while production uses the durable outbox', () => {
    const syncWorkerConfig = readFileSync(join(repoRoot, 'scripts/sync-worker-config.rb'), 'utf8');
    const devOverride = syncWorkerConfig.slice(syncWorkerConfig.indexOf('dev_values ='));

    expect(devOverride).toContain("'APP_MODE' => 'test'");
    expect(devOverride).toContain("'EMAIL_OUTBOX_ENABLED' => 'false'");
    expect(devOverride).toContain("'PAYMENT_RECONCILIATION_ENABLED' => 'false'");
  });

  it('fails closed before generated-asset checks when either Jekyll build path fails', () => {
    const preMergeScript = readFileSync(join(repoRoot, 'scripts/pre-merge-regression.sh'), 'utf8');

    expect(preMergeScript).toContain('bundle exec jekyll build --config "${jekyll_config_files}" --quiet || return 1');
    expect(preMergeScript).toContain('minify_site_assets || return 1');
    expect(preMergeScript).toContain('run_phase "7. Store build artifact checks" scripts/pre-merge-regression.sh __host_or_podman_build_check');
    expect(preMergeScript).not.toContain("bash -lc 'scripts/pre-merge-regression.sh __host_or_podman_build_check'");
    expect(preMergeScript).toContain('sitemap.txt is missing from the built site');
  });

  it('keeps Podman wrappers alive until runtime checks finish', () => {
    const stackRun = readFileSync(join(repoRoot, 'scripts/podman-stack-run.sh'), 'utf8');
    const playwrightRun = readFileSync(join(repoRoot, 'scripts/podman-playwright-run.sh'), 'utf8');
    const workerSmoke = readFileSync(join(repoRoot, 'scripts/test-worker.sh'), 'utf8');

    for (const script of [stackRun, playwrightRun, workerSmoke]) {
      expect(script).toContain('STOP_FILE="$(mktemp ');
      expect(script).toContain('PODMAN_STOP_FILE="$STOP_FILE" PODMAN_RESET_WRANGLER_STATE=true SKIP_STRIPE=true ./scripts/dev.sh --podman >');
      expect(script).toContain('DEV_PID=$!');
      expect(script).toContain('touch "$STOP_FILE"');
      expect(script).toContain('wait "$DEV_PID"');
      expect(script).toContain('/api/cart/validate');
      expect(script).not.toContain('nohup env PODMAN_RESET_WRANGLER_STATE=true');
      expect(script).not.toContain('disown "$DEV_PID"');
      expect(script).not.toContain('kill "$DEV_PID"');
      expect(script).not.toContain('PODMAN_DETACH=true SKIP_STRIPE=true ./scripts/dev.sh --podman');
    }
  });

  it('keeps container dependency refreshes lockfile-preserving', () => {
    const playwrightEntrypoint = readFileSync(join(repoRoot, 'scripts/podman-playwright-entrypoint.sh'), 'utf8');

    expect(playwrightEntrypoint).toContain('npm ci');
    expect(playwrightEntrypoint).not.toContain('npm install');
  });

  it('keeps the Podman browser image aligned with the locked Playwright version', () => {
    const playwrightContainer = readFileSync(join(repoRoot, 'Containerfile.playwright.dev'), 'utf8');
    const playwrightRun = readFileSync(join(repoRoot, 'scripts/podman-playwright-run.sh'), 'utf8');

    expect(playwrightContainer).toContain('ARG PLAYWRIGHT_VERSION');
    expect(playwrightContainer).toContain('FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble');
    expect(playwrightContainer).not.toMatch(/playwright:v\d/);
    expect(playwrightRun).toContain('lock.packages?.["node_modules/@playwright/test"]?.version');
    expect(playwrightRun).toContain('PLAYWRIGHT_IMAGE="localhost/store-dev-playwright:${PLAYWRIGHT_VERSION}"');
    expect(playwrightRun).toContain('--build-arg "PLAYWRIGHT_VERSION=$PLAYWRIGHT_VERSION"');
  });

  it('does not terminate the Podman wrapper process group when Stripe forwarding is skipped', () => {
    const podmanDev = readFileSync(join(repoRoot, 'scripts/dev-podman.sh'), 'utf8');

    expect(podmanDev).toContain('if [ -n "${STRIPE_LISTEN_PID:-}" ]; then');
    expect(podmanDev).toContain('kill "$STRIPE_LISTEN_PID"');
    expect(podmanDev).not.toContain('kill "${STRIPE_LISTEN_PID:-0}"');
  });

  it('preserves an explicitly selected Podman connection across local wrappers', () => {
    const paths = [
      'scripts/dev-podman.sh',
      'scripts/podman-doctor.sh',
      'scripts/pre-merge-regression.sh'
    ];

    for (const path of paths) {
      const script = readFileSync(join(repoRoot, path), 'utf8');
      expect(script, path).toContain('CONTAINER_CONNECTION');
      expect(script, path).toContain('unset CONTAINER_HOST');
      expect(script, path).not.toContain('unset CONTAINER_CONNECTION');
    }
  });

  it('lets host test harnesses disable Stripe forwarding without provider access', () => {
    const hostDev = readFileSync(join(repoRoot, 'scripts/dev.sh'), 'utf8');

    expect(hostDev).toContain('SKIP_STRIPE="${SKIP_STRIPE:-false}"');
    expect(hostDev).not.toContain('SKIP_STRIPE=false');
  });
});

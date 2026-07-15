import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('package test scripts', () => {
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

  it('fails closed before generated-asset checks when either Jekyll build path fails', () => {
    const preMergeScript = readFileSync(join(repoRoot, 'scripts/pre-merge-regression.sh'), 'utf8');

    expect(preMergeScript).toContain('bundle exec jekyll build --config "${jekyll_config_files}" --quiet || return 1');
    expect(preMergeScript).toContain('minify_site_assets || return 1');
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

  it('does not terminate the Podman wrapper process group when Stripe forwarding is skipped', () => {
    const podmanDev = readFileSync(join(repoRoot, 'scripts/dev-podman.sh'), 'utf8');

    expect(podmanDev).toContain('if [ -n "${STRIPE_LISTEN_PID:-}" ]; then');
    expect(podmanDev).toContain('kill "$STRIPE_LISTEN_PID"');
    expect(podmanDev).not.toContain('kill "${STRIPE_LISTEN_PID:-0}"');
  });
});

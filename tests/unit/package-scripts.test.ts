import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('package test scripts', () => {
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
    expect(preMergeScript).toContain('run_phase "9. Podman Store Worker smoke" ./scripts/test-worker.sh --podman');
    expect(preMergeScript).toContain('run_phase "10. Podman E2E suite" npm run test:e2e:headless');
    expect(preMergeScript).not.toContain('run_phase "9a. Host Store Worker smoke"');
    expect(preMergeScript).not.toContain('run_phase "10. Headless E2E suite"');
  });
});

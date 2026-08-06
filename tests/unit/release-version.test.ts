import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { WORKER_USER_AGENT, WORKER_VERSION } from '../../worker/src/version.js';

const repositoryRoot = process.cwd();

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(`${repositoryRoot}/${relativePath}`, 'utf8'));
}

function readPlatformValue(key: string) {
  const config = readFileSync(`${repositoryRoot}/_config.yml`, 'utf8');
  const platformBlock = config.split(/^platform:\s*$/m)[1]?.split(/^\S/m)[0] || '';
  const match = platformBlock.match(
    new RegExp(`^\\s+${key}:\\s*["']?([^"'\\s]+)["']?\\s*$`, 'm')
  );
  return match?.[1];
}

describe('release version contract', () => {
  it('keeps packages, locks, canonical config, and provider identity aligned', () => {
    const versions = [
      readJson('package.json').version,
      readJson('package-lock.json').version,
      readJson('package-lock.json').packages[''].version,
      readJson('worker/package.json').version,
      readJson('worker/package-lock.json').version,
      readJson('worker/package-lock.json').packages[''].version,
      readPlatformValue('version')
    ];

    expect(versions).toEqual(versions.map(() => WORKER_VERSION));
    expect(readPlatformValue('release_label')).toBe(`v${WORKER_VERSION}`);
    expect(WORKER_USER_AGENT).toBe(`store-worker/${WORKER_VERSION}`);
    for (const providerSource of ['worker/src/email.js', 'worker/src/stripe.js']) {
      const source = readFileSync(`${repositoryRoot}/${providerSource}`, 'utf8');
      expect(source).toMatch(/['"]User-Agent['"]:\s*WORKER_USER_AGENT/);
      expect(source).not.toMatch(/store-worker\/\d/);
    }
  });

  it('keeps the current release documentation aligned with the runtime version', () => {
    const changelog = readFileSync(`${repositoryRoot}/CHANGELOG.md`, 'utf8');
    const readme = readFileSync(`${repositoryRoot}/README.md`, 'utf8');
    const overview = readFileSync(
      `${repositoryRoot}/docs/PROJECT_OVERVIEW.md`,
      'utf8'
    );

    expect(changelog).toMatch(
      new RegExp(`^## v${WORKER_VERSION} - \\d{4}-\\d{2}-\\d{2}$`, 'm')
    );
    expect(changelog).not.toContain(`## v${WORKER_VERSION} - Unreleased`);
    expect(readme).toContain(`Current release: \`v${WORKER_VERSION}\``);
    expect(overview).toContain(`Current release: \`v${WORKER_VERSION}\``);
  });
});

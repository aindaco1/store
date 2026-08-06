import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const platformRoot = `${repositoryRoot}/shared/dust-wave-platform`;
const expectedCommit = '7c5d4e8b44b25b9a649920c5a56d120ca29fc06f';
const expectedVersions = {
  '@dustwave/platform-workspace': '0.11.5',
  '@dustwave/admin-shell': '0.10.2',
  '@dustwave/media-core': '0.3.0',
  '@dustwave/tax-core': '0.1.0',
  '@dustwave/timed-text': '0.5.0',
  '@dustwave/worker-core': '0.3.6'
};

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(`${repositoryRoot}/${relativePath}`, 'utf8'));
}

describe('shared platform pin', () => {
  it('checks out the reviewed immutable commit from the canonical remote', () => {
    const checkedOutCommit = execFileSync(
      'git',
      ['-C', platformRoot, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' }
    ).trim();
    const gitmodules = readFileSync(`${repositoryRoot}/.gitmodules`, 'utf8');

    expect(checkedOutCommit).toBe(expectedCommit);
    expect(gitmodules).toContain('url = https://github.com/aindaco1/dust-wave-platform.git');
    expect(gitmodules).not.toMatch(/^\s*branch\s*=/m);
  });

  it('keeps every package at the reviewed release version', () => {
    const manifests = [
      'shared/dust-wave-platform/package.json',
      'shared/dust-wave-platform/packages/admin-shell/package.json',
      'shared/dust-wave-platform/packages/media-core/package.json',
      'shared/dust-wave-platform/packages/tax-core/package.json',
      'shared/dust-wave-platform/packages/timed-text/package.json',
      'shared/dust-wave-platform/packages/worker-core/package.json'
    ].map(readJson);

    expect(Object.fromEntries(manifests.map(({ name, version }) => [name, version])))
      .toEqual(expectedVersions);
  });

  it('retains every shared browser and Worker source consumed by Store', () => {
    const consumedPaths = [
      'packages/admin-shell/src/tabs-browser.js',
      'packages/admin-shell/src/dirty-controls-browser.js',
      'packages/admin-shell/src/turnstile-browser.js',
      'packages/admin-shell/src/vendor/qrcode-generator.js',
      'packages/admin-shell/src/credentialed-download.js',
      'packages/tax-core/src/index.js',
      'packages/worker-core/src/turnstile.js',
      'scripts/scan-tracked-secrets.mjs'
    ];

    expect(consumedPaths.filter((path) => !existsSync(`${platformRoot}/${path}`)))
      .toEqual([]);
  });
});

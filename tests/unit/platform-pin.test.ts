import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const platformRoot = `${repositoryRoot}/shared/dust-wave-platform`;
const expectedCommit = '5836ced5129ce3eddb09a035601de23ec58a5737';
const expectedVersions = {
  '@dustwave/platform-workspace': '0.28.0',
  '@dustwave/admin-shell': '0.10.2',
  '@dustwave/build-core': '0.1.0',
  '@dustwave/design-core': '0.1.0',
  '@dustwave/inventory-core': '0.1.0',
  '@dustwave/media-core': '0.4.0',
  '@dustwave/release-core': '0.2.0',
  '@dustwave/shipping-core': '0.2.0',
  '@dustwave/site-shell': '0.1.0',
  '@dustwave/tax-core': '0.3.0',
  '@dustwave/test-core': '0.1.0',
  '@dustwave/timed-text': '0.5.0',
  '@dustwave/worker-core': '0.12.0'
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
      'shared/dust-wave-platform/packages/build-core/package.json',
      'shared/dust-wave-platform/packages/design-core/package.json',
      'shared/dust-wave-platform/packages/inventory-core/package.json',
      'shared/dust-wave-platform/packages/media-core/package.json',
      'shared/dust-wave-platform/packages/release-core/package.json',
      'shared/dust-wave-platform/packages/shipping-core/package.json',
      'shared/dust-wave-platform/packages/site-shell/package.json',
      'shared/dust-wave-platform/packages/tax-core/package.json',
      'shared/dust-wave-platform/packages/test-core/package.json',
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
      'packages/build-core/bin/minify-site-assets.mjs',
      'packages/build-core/src/site-assets.js',
      'packages/design-core/styles/_base.scss',
      'packages/design-core/styles/_buttons.scss',
      'packages/design-core/styles/_content-blocks.scss',
      'packages/design-core/styles/_modal.scss',
      'packages/design-core/styles/_utilities.scss',
      'packages/inventory-core/src/index.js',
      'packages/media-core/src/site-catalog.js',
      'packages/site-shell/src/a11y-live-browser.js',
      'packages/site-shell/src/header-nav-browser.js',
      'packages/tax-core/src/index.js',
      'packages/tax-core/src/nm-grt-starter.js',
      'packages/tax-core/src/provider.js',
      'packages/test-core/src/index.js',
      'packages/worker-core/src/date-time.js',
      'packages/worker-core/src/http.js',
      'packages/worker-core/src/github.js',
      'packages/worker-core/src/logger.js',
      'packages/worker-core/src/outbox.js',
      'packages/worker-core/src/resend.js',
      'packages/worker-core/src/session-security.js',
      'packages/worker-core/src/stripe.js',
      'packages/worker-core/src/turnstile.js',
      'packages/worker-core/src/timezones.js',
      'packages/release-core/src/command-result.js',
      'packages/release-core/src/cache-policy.js',
      'packages/release-core/src/cloudflare-admin-response-rule.js',
      'packages/release-core/src/file-integrity.js',
      'packages/release-core/src/kv-backup-records.js',
      'packages/release-core/src/provider-evidence.js',
      'packages/release-core/src/screen-reader-evidence.js',
      'packages/release-core/src/wrangler-config.js',
      'packages/shipping-core/src/index.js',
      'packages/shipping-core/src/usps.js',
      'packages/shipping-core/data/shipping-countries.yml',
      'scripts/scan-tracked-secrets.mjs'
    ];

    expect(consumedPaths.filter((path) => !existsSync(`${platformRoot}/${path}`)))
      .toEqual([]);
  });

  it('resolves shared Sass without retaining local duplicate partials', () => {
    const config = readFileSync(`${repositoryRoot}/_config.yml`, 'utf8');
    const localDuplicates = [
      '_base.scss',
      '_buttons.scss',
      '_content-blocks.scss',
      '_modal.scss',
      '_utilities.scss'
    ];

    expect(config).toContain(
      'shared/dust-wave-platform/packages/design-core/styles'
    );
    expect(localDuplicates.filter((name) =>
      existsSync(`${repositoryRoot}/assets/partials/${name}`)
    )).toEqual([]);
  });

  it('keeps the Jekyll shipping-country snapshot byte-identical to Platform', () => {
    expect(readFileSync(`${repositoryRoot}/_data/shipping_countries.yml`, 'utf8'))
      .toBe(readFileSync(
        `${platformRoot}/packages/shipping-core/data/shipping-countries.yml`,
        'utf8'
      ));
  });

  it('runs shared Node tooling with its exact reviewed dependencies', () => {
    const rootLock = readJson('package-lock.json');
    const buildCore = readJson(
      'shared/dust-wave-platform/packages/build-core/package.json'
    );
    const releaseCore = readJson(
      'shared/dust-wave-platform/packages/release-core/package.json'
    );

    expect(rootLock.packages['node_modules/esbuild'].version)
      .toBe(buildCore.dependencies.esbuild);
    expect(rootLock.packages['node_modules/smol-toml'].version)
      .toBe(releaseCore.dependencies['smol-toml']);
  });
});

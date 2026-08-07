// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const templateRoot = join(repositoryRoot, 'shared/dust-wave-jekyll-template');
const expectedCommit = '351281a5aec60fa85653a3d23391e66fb860aae6';

describe('Jekyll golden-project template pin', () => {
  it('checks out one immutable canonical release without following a branch', () => {
    const checkedOutCommit = execFileSync(
      'git',
      ['-C', templateRoot, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' }
    ).trim();
    const gitmodules = readFileSync(join(repositoryRoot, '.gitmodules'), 'utf8');

    expect(checkedOutCommit).toBe(expectedCommit);
    expect(gitmodules).toContain(
      'url = https://github.com/aindaco1/dust-wave-jekyll-template.git'
    );
    expect(gitmodules).not.toMatch(/^\s*branch\s*=/m);
  });

  it('keeps every local Jekyll integration copy byte-identical to v0.1.0', () => {
    const manifest = JSON.parse(
      readFileSync(join(templateRoot, 'template-manifest.json'), 'utf8')
    );

    expect(manifest.templateVersion).toBe('0.1.0');
    expect(manifest.files).toHaveLength(17);
    for (const entry of manifest.files) {
      const templateSource = readFileSync(join(templateRoot, 'template', entry.path));
      const consumerSource = readFileSync(join(repositoryRoot, entry.path));
      expect(consumerSource.equals(templateSource), entry.path).toBe(true);
      expect(consumerSource.length, entry.path).toBe(entry.bytes);
      expect(createHash('sha256').update(consumerSource).digest('hex'), entry.path)
        .toBe(entry.sha256);
    }
  });

  it('checks drift in pre-merge and excludes the upgrade source from Jekyll output', () => {
    const config = readFileSync(join(repositoryRoot, '_config.yml'), 'utf8');
    const premerge = readFileSync(
      join(repositoryRoot, 'scripts/pre-merge-regression.sh'),
      'utf8'
    );

    expect(config).toContain('- shared/dust-wave-jekyll-template');
    expect(premerge).toContain(
      'run_phase "1b. Jekyll template drift" npm run jekyll-template:check'
    );
    expect(premerge).toContain('if [[ -e _site/shared/dust-wave-jekyll-template ]]');
  });
});

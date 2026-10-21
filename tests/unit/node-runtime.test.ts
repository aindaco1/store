// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function fixture(current: string, fallback: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'node trust '));
  roots.push(root);
  const makeNode = (directory: string, version: string) => {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'node'), '#!/bin/bash\nprintf "%s\\n" ' + JSON.stringify(version) + '\n', { mode: 0o755 });
  };
  const currentDir = join(root, 'current');
  makeNode(currentDir, current);
  for (const version of fallback) makeNode(join(root, '.nvm/versions/node', version, 'bin'), version);
  const result = spawnSync('/bin/bash', ['-c', 'source "$1"; prefer_current_node_path && command -v node', 'test', resolve('scripts/node-runtime.sh')], {
    env: { HOME: root, PATH: currentDir + ':/usr/bin:/bin' }, encoding: 'utf8'
  });
  return { ...result, root, currentDir };
}

describe('developer Node trust baseline', () => {
  it('keeps a patched PATH runtime even when older NVM versions exist', () => {
    const result = fixture('v26.12.1', ['v24.15.0']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(join(result.currentDir, 'node'));
  });
  it('skips vulnerable NVM candidates and handles paths with spaces', () => {
    const result = fixture('v20.19.6', ['v24.15.0', 'v24.22.1']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(join(result.root, '.nvm/versions/node/v24.22.1/bin/node'));
  });
  it.each(['v22.23.4', 'v24.22.1', 'v26.12.1', 'v24.23.0'])('accepts fixed version %s', version => {
    expect(fixture(version).status).toBe(0);
  });
  it.each(['v18.18.0', 'v20.19.6', 'v22.23.3', 'v24.22.0', 'v26.12.0', 'v25.0.0', 'v24.22.1-rc.1', 'unknown'])('fails closed for %s', version => {
    const result = fixture(version, ['v24.15.0']);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('patched Node');
  });
});

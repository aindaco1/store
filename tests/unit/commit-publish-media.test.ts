// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitPublishMedia } from '../../scripts/commit-publish-media.mjs';

let root: string;
let cwd: string;
let expectedCommit: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'store-publish-media-'));
  cwd = path.join(root, 'checkout');
  mkdirSync(cwd);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  mkdirSync(path.join(cwd, 'assets/images/products'), { recursive: true });
  writeFileSync(path.join(cwd, 'assets/images/products/poster.png'), 'original upload');
  git('add', '.');
  git('commit', '-m', 'Saved product');
  expectedCommit = git('rev-parse', 'HEAD');
  git('init', '--bare', path.join(root, 'origin.git'));
  git('remote', 'add', 'origin', path.join(root, 'origin.git'));
  git('push', 'origin', 'HEAD:main');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('automatic publication of prepared media', () => {
  it('includes new derivatives, preserves source bytes, and returns the exact deployed revision', () => {
    writeFileSync(path.join(cwd, 'assets/images/products/poster-320.webp'), 'small');
    const ref = commitPublishMedia({ cwd, expectedCommit });
    expect(ref).not.toBe(expectedCommit);
    expect(git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0]).toBe(ref);
    expect(git('show', `${ref}:assets/images/products/poster-320.webp`)).toBe('small');
    expect(readFileSync(path.join(cwd, 'assets/images/products/poster.png'), 'utf8')).toBe('original upload');
    expect(git('rev-parse', 'HEAD^')).toBe(expectedCommit);
    expect(commitPublishMedia({ cwd, expectedCommit: ref })).toBe(ref);
  });

  it('stops when another publish advances the branch instead of overwriting it', () => {
    const other = path.join(root, 'other');
    git('clone', '--branch', 'main', path.join(root, 'origin.git'), other);
    const otherGit = (...args: string[]) => execFileSync('git', args, { cwd: other, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    writeFileSync(path.join(other, 'other.txt'), 'concurrent product');
    otherGit('add', '.');
    otherGit('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Other publish');
    otherGit('push', 'origin', 'HEAD:main');
    writeFileSync(path.join(cwd, 'assets/images/products/poster-320.webp'), 'small');
    expect(() => commitPublishMedia({ cwd, expectedCommit })).toThrow('repository changed');
    expect(git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0]).toBe(otherGit('rev-parse', 'HEAD'));
    expect(git('rev-parse', 'HEAD')).toBe(expectedCommit);
  });

  it('rejects unrelated edits and a checkout that differs from the reviewed source', () => {
    writeFileSync(path.join(cwd, 'unrelated.js'), 'unrelated code');
    expect(() => commitPublishMedia({ cwd, expectedCommit })).toThrow('outside the product media boundary');
    expect(() => commitPublishMedia({ cwd, expectedCommit: 'a'.repeat(40) })).toThrow('checkout does not match');
    expect(git('rev-parse', 'HEAD')).toBe(expectedCommit);
  });
});

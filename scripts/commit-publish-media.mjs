#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const allowedPath = (file) => /^(?:assets\/(?:images|videos|audio)\/|_products\/)/.test(file) || file === '_data/media-optimization-manifest.json';

// Publish only the optimizer's bounded output, using a normal fast-forward push.
// A concurrent repository edit must stop this publication rather than be overwritten.
export function commitPublishMedia({ expectedCommit, branch = 'main', cwd = process.cwd() }) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || '')) throw new Error('Publishing requires a full source commit SHA.');
  git('check-ref-format', `refs/heads/${branch}`);
  if (git('rev-parse', 'HEAD') !== expectedCommit) throw new Error('The checkout does not match the saved product commit.');
  const current = git('ls-remote', 'origin', `refs/heads/${branch}`).split(/\s/)[0];
  if (current !== expectedCommit) throw new Error('The repository changed while preparing media. Refresh the product and publish again.');
  const paths = [...new Set([
    ...git('diff', '--name-only', '-z', 'HEAD').split('\0'),
    ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0')
  ].filter(Boolean))];
  if (paths.some((file) => !allowedPath(file) || file.split('/').includes('..'))) {
    throw new Error('Media preparation changed files outside the product media boundary.');
  }
  if (!paths.length) return expectedCommit;
  git('add', '--', ...paths);
  git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '-m', `Prepare product media for ${expectedCommit}`);
  git('push', 'origin', `HEAD:refs/heads/${branch}`);
  return git('rev-parse', 'HEAD');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ref = commitPublishMedia({ expectedCommit: process.env.PUBLISH_SOURCE_SHA, branch: process.env.PUBLISH_BRANCH || 'main' });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ref=${ref}\n`);
  console.log(`Prepared product media commit: ${ref}`);
}

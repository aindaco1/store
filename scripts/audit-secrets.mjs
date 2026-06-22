#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const localSecretFiles = [
  'worker/.dev.vars'
];

const allowlistedTestValues = new Set([
  'whsec_smoke',
  'sk_test_smoke',
  'test-admin-secret',
  'test-magic-link-secret',
  're_test_smoke'
]);

function runGit(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim();
}

function fileExists(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function mask(value) {
  if (!value) return '[empty]';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseSecrets(relPath) {
  const content = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
  const secrets = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    const value = rest.join('=').trim();
    if (!value) continue;
    if (!/(SECRET|KEY|TOKEN)/.test(key)) continue;
    if (allowlistedTestValues.has(value)) continue;
    secrets.push({ key, value, source: relPath });
  }
  return secrets;
}

function listRepoFiles() {
  const output = runGit(['ls-files', '-co', '--exclude-standard']);
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(file => !localSecretFiles.includes(file))
    .filter(file => !file.startsWith('.git/'));
}

function searchWorktree(files, secrets) {
  const hits = [];
  for (const file of files) {
    let data;
    try {
      data = fs.readFileSync(path.join(repoRoot, file));
    } catch {
      continue;
    }
    for (const secret of secrets) {
      if (data.includes(Buffer.from(secret.value))) {
        hits.push({ file, key: secret.key, source: secret.source });
      }
    }
  }
  return hits;
}

function searchHistory(secrets) {
  const hits = [];
  for (const secret of secrets) {
    const output = runGit(['log', '--all', '--format=%H', `-S${secret.value}`, '--', '.']);
    const commits = output.split('\n').map(line => line.trim()).filter(Boolean);
    if (commits.length > 0) {
      hits.push({
        key: secret.key,
        source: secret.source,
        commits
      });
    }
  }
  return hits;
}

function main() {
  const missing = localSecretFiles.filter(relPath => !fileExists(relPath));
  const trackedFiles = runGit(['ls-files']).split('\n').filter(Boolean);

  const failures = [];
  const notices = [];

  for (const relPath of localSecretFiles) {
    try {
      const ignoreLine = runGit(['check-ignore', '-v', relPath]);
      if (!ignoreLine) {
        failures.push(`${relPath} is not ignored by git.`);
      }
    } catch {
      failures.push(`${relPath} is not ignored by git.`);
    }
    if (trackedFiles.includes(relPath)) {
      failures.push(`${relPath} is tracked in git.`);
    }
  }

  const availableFiles = localSecretFiles.filter(relPath => !missing.includes(relPath));
  if (availableFiles.length === 0) {
    notices.push('No local secret file found; skipped value scan.');
  }

  const secrets = availableFiles.flatMap(parseSecrets);
  if (secrets.length === 0) {
    notices.push('No non-allowlisted local secret values found to scan.');
  }

  if (secrets.length > 0) {
    const files = listRepoFiles();
    const worktreeHits = searchWorktree(files, secrets);
    for (const hit of worktreeHits) {
      const secret = secrets.find(item => item.key === hit.key && item.source === hit.source);
      failures.push(
        `Secret ${hit.key} from ${hit.source} appears in ${hit.file} (${mask(secret ? secret.value : '')}).`
      );
    }

    const historyHits = searchHistory(secrets);
    for (const hit of historyHits) {
      failures.push(
        `Secret ${hit.key} from ${hit.source} appears in git history (${hit.commits.length} commit${hit.commits.length === 1 ? '' : 's'}).`
      );
    }
  }

  if (failures.length > 0) {
    console.error('Secret audit failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Secret audit passed.');
  for (const notice of notices) {
    console.log(`- ${notice}`);
  }
}

main();

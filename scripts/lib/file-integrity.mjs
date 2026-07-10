import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function listFilesRecursive(root, options = {}) {
  if (!fs.existsSync(root)) return [];
  const excluded = new Set(options.exclude || []);
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (excluded.has(relative)) continue;
      if (entry.isDirectory()) visit(absolute);
      if (entry.isFile()) files.push(relative);
    }
  }
  visit(root);
  return files.sort();
}

function listUnsupportedEntries(root) {
  const entries = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        entries.push(relative);
      } else if (entry.isDirectory()) {
        visit(absolute);
      } else if (!entry.isFile()) {
        entries.push(relative);
      }
    }
  }
  if (fs.existsSync(root)) visit(root);
  return entries.sort();
}

export function buildChecksumManifest(root, options = {}) {
  return listFilesRecursive(root, options).map((relativePath) => {
    const absolute = path.join(root, relativePath);
    const stat = fs.statSync(absolute);
    return {
      path: relativePath,
      bytes: stat.size,
      sha256: sha256File(absolute),
      mode: (stat.mode & 0o777).toString(8).padStart(4, '0')
    };
  });
}

export function verifyChecksumManifest(root, entries = [], options = {}) {
  const failures = [];
  const listedPaths = new Set();
  for (const entry of entries) {
    const entryPath = String(entry.path || '').split('\\').join('/');
    if (listedPaths.has(entryPath)) {
      failures.push({ path: entry.path, reason: 'duplicate' });
      continue;
    }
    listedPaths.add(entryPath);
    const absolute = path.resolve(root, entryPath);
    if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) {
      failures.push({ path: entry.path, reason: 'path_escape' });
      continue;
    }
    if (!fs.existsSync(absolute)) {
      failures.push({ path: entry.path, reason: 'missing' });
      continue;
    }
    if (!fs.lstatSync(absolute).isFile()) {
      failures.push({ path: entry.path, reason: 'unsupported_type' });
      continue;
    }
    const actual = sha256File(absolute);
    if (actual !== entry.sha256) failures.push({ path: entry.path, reason: 'checksum_mismatch', actual });
  }
  if (options.requireComplete === true) {
    const excluded = new Set(options.exclude || []);
    for (const relativePath of listFilesRecursive(root, { exclude: excluded })) {
      if (!listedPaths.has(relativePath)) failures.push({ path: relativePath, reason: 'unlisted' });
    }
    for (const relativePath of listUnsupportedEntries(root)) {
      if (!excluded.has(relativePath)) failures.push({ path: relativePath, reason: 'unsupported_type' });
    }
  }
  return { ok: failures.length === 0, checked: entries.length, failures };
}

export function enforcePrivatePermissions(root) {
  if (!fs.existsSync(root)) return;
  fs.chmodSync(root, 0o700);
  for (const relativePath of listFilesRecursive(root)) {
    fs.chmodSync(path.join(root, relativePath), 0o600);
  }
}

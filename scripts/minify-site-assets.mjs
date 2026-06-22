#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const DEFAULT_SITE_DIR = '_site';
const DEFAULT_ASSET_DIR = 'assets';
const MINIFIABLE_EXTENSIONS = new Set(['.css', '.js']);

export function normalizeRepoPath(repoPath) {
  return String(repoPath || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
}

export function isMinifiableAssetPath(repoPath, siteDir = DEFAULT_SITE_DIR) {
  const normalized = normalizeRepoPath(repoPath);
  const normalizedSiteDir = normalizeRepoPath(siteDir).replace(/\/+$/, '');
  const relativePath = normalized.startsWith(`${normalizedSiteDir}/`)
    ? normalized.slice(normalizedSiteDir.length + 1)
    : normalized;
  const extension = path.posix.extname(relativePath).toLowerCase();
  return relativePath.startsWith(`${DEFAULT_ASSET_DIR}/`) &&
    MINIFIABLE_EXTENSIONS.has(extension) &&
    !relativePath.endsWith('.map') &&
    !relativePath.includes('/vendor/');
}

function parseArgs(argv = []) {
  const args = {
    siteDir: DEFAULT_SITE_DIR,
    write: false,
    check: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') args.write = true;
    else if (arg === '--check') args.check = true;
    else if (arg === '--site-dir') {
      args.siteDir = argv[index + 1] || DEFAULT_SITE_DIR;
      index += 1;
    } else if (arg.startsWith('--site-dir=')) {
      args.siteDir = arg.slice('--site-dir='.length) || DEFAULT_SITE_DIR;
    }
  }

  return args;
}

async function walkFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function fileSize(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

async function directoryExists(dirPath) {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function minifyAssetSourceOnce(source, repoPath) {
  const extension = path.posix.extname(normalizeRepoPath(repoPath)).toLowerCase();
  if (extension === '.css') {
    const result = await transform(String(source || ''), {
      loader: 'css',
      minify: true,
      legalComments: 'none'
    });
    return result.code.trimEnd();
  }

  if (extension === '.js') {
    const result = await transform(String(source || ''), {
      loader: 'js',
      target: 'es2018',
      minifySyntax: true,
      minifyWhitespace: true,
      minifyIdentifiers: false,
      legalComments: 'none'
    });
    return result.code.trimEnd();
  }

  return String(source || '');
}

export async function minifyAssetSource(source, repoPath, options = {}) {
  const maxPasses = Number.isFinite(options.maxPasses) ? Math.max(1, options.maxPasses) : 4;
  let current = String(source || '');

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const next = await minifyAssetSourceOnce(current, repoPath);
    if (Buffer.byteLength(next) >= Buffer.byteLength(current)) {
      return current;
    }
    current = next;
  }

  return current;
}

export async function minifySiteAssets(options = {}) {
  const siteDir = options.siteDir || DEFAULT_SITE_DIR;
  const write = Boolean(options.write);
  const assetRoot = path.join(siteDir, DEFAULT_ASSET_DIR);
  if (!await directoryExists(assetRoot)) {
    throw new Error(`Generated asset directory not found at ${assetRoot}. Run Jekyll build first.`);
  }

  const allFiles = await walkFiles(assetRoot);
  const files = allFiles
    .map((filePath) => normalizeRepoPath(filePath))
    .filter((filePath) => isMinifiableAssetPath(filePath, siteDir))
    .sort();

  const results = [];
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (const filePath of files) {
    const source = await fs.readFile(filePath, 'utf8');
    const before = await fileSize(filePath);
    const minified = await minifyAssetSource(source, filePath);
    const minifiedBytes = Buffer.byteLength(minified);
    const changed = minifiedBytes > 0 && minifiedBytes < before;

    bytesBefore += before;
    bytesAfter += changed ? minifiedBytes : before;

    if (changed && write) {
      await fs.writeFile(filePath, minified);
    }

    results.push({
      file: filePath,
      changed,
      bytesBefore: before,
      bytesAfter: changed ? minifiedBytes : before,
      bytesSaved: changed ? before - minifiedBytes : 0
    });
  }

  return {
    siteDir,
    mode: write ? 'write' : 'check',
    filesChecked: files.length,
    minifiedCount: results.filter((result) => result.changed).length,
    bytesBefore,
    bytesAfter,
    bytesSaved: bytesBefore - bytesAfter,
    results
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const write = args.write && !args.check;
  const summary = await minifySiteAssets({ siteDir: args.siteDir, write });
  console.log(JSON.stringify(summary, null, 2));

  if (args.check && summary.minifiedCount > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

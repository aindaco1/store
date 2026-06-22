#!/usr/bin/env node
import fs from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const IMAGE_EXTENSIONS = new Set(['.gif', '.jpg', '.jpeg', '.png', '.webp']);
const RESPONSIVE_IMAGE_EXTENSIONS = new Set(['.gif', '.jpg', '.jpeg', '.png']);
const VIDEO_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v']);
const RESPONSIVE_WEBP_WIDTHS = [320, 480, 640, 960, 1600];
const RESPONSIVE_WEBP_QUALITY = '86';
const MEDIA_ROOTS = ['assets/images', 'assets/videos'];
const REFERENCE_ROOTS = ['_products', '_data'];
const REFERENCE_FILES = ['_config.yml'];

export function normalizeRepoPath(repoPath) {
  return String(repoPath || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
}

export function publicAssetPathForRepoPath(repoPath) {
  const normalized = normalizeRepoPath(repoPath);
  return normalized.startsWith('assets/') ? `/${normalized}` : '';
}

export function webmDerivativePathForVideo(repoPath) {
  const normalized = normalizeRepoPath(repoPath);
  const extension = path.posix.extname(normalized).toLowerCase();
  return VIDEO_EXTENSIONS.has(extension)
    ? normalized.slice(0, -extension.length) + '.webm'
    : '';
}

function isResponsiveWebpDerivative(repoPath) {
  return /-\d+\.webp$/i.test(normalizeRepoPath(repoPath));
}

export function responsiveWebpDerivativePathForImage(repoPath, width) {
  const normalized = normalizeRepoPath(repoPath);
  const extension = path.posix.extname(normalized).toLowerCase();
  const numericWidth = Number(width);
  if (
    !RESPONSIVE_IMAGE_EXTENSIONS.has(extension) ||
    !Number.isInteger(numericWidth) ||
    numericWidth <= 0 ||
    isResponsiveWebpDerivative(normalized)
  ) {
    return '';
  }
  return `${normalized.slice(0, -extension.length)}-${numericWidth}.webp`;
}

export function responsiveWebpDerivativePathsForImage(repoPath, widths = RESPONSIVE_WEBP_WIDTHS) {
  return widths
    .map((width) => responsiveWebpDerivativePathForImage(repoPath, width))
    .filter(Boolean);
}

export function rewriteMediaReferences(source, replacements = new Map()) {
  let output = String(source || '');
  const ordered = Array.from(replacements.entries())
    .filter(([from, to]) => from && to && from !== to)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of ordered) {
    output = output.split(from).join(to);
  }
  return output;
}

function parseArgs(argv = []) {
  const args = {
    write: false,
    check: false,
    changed: false,
    files: []
  };
  for (const arg of argv) {
    if (arg === '--write') args.write = true;
    else if (arg === '--check') args.check = true;
    else if (arg === '--changed') args.changed = true;
    else args.files.push(arg);
  }
  return args;
}

async function commandExists(command) {
  const probes = [['--version'], ['-version'], ['-h']];
  try {
    for (const args of probes) {
      try {
        await execFileAsync(command, args);
        return true;
      } catch (error) {
        if (error?.code === 'ENOENT') throw error;
      }
    }
  } catch {
    // Fall through to the final false value.
  }
  return false;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

export function hasAnimatedWebpChunks(buffer) {
  const bytes = Buffer.from(buffer || []);
  if (
    bytes.length < 12 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return false;
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = bytes.toString('ascii', offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    if (chunkType === 'ANIM' || chunkType === 'ANMF') return true;
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return false;
}

async function isAnimatedWebpFile(filePath) {
  try {
    return hasAnimatedWebpChunks(await fs.readFile(filePath));
  } catch {
    return false;
  }
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

async function changedFiles() {
  try {
    const { stdout } = await execFileAsync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']);
    return stdout.split(/\r?\n/).filter(Boolean);
  } catch {
    return null;
  }
}

function isImageFile(repoPath) {
  return IMAGE_EXTENSIONS.has(path.posix.extname(normalizeRepoPath(repoPath)).toLowerCase());
}

function isVideoSourceFile(repoPath) {
  return VIDEO_EXTENSIONS.has(path.posix.extname(normalizeRepoPath(repoPath)).toLowerCase());
}

function isDashboardMediaFile(repoPath) {
  const normalized = normalizeRepoPath(repoPath);
  return MEDIA_ROOTS.some((root) => normalized.startsWith(`${root}/`)) &&
    (isImageFile(normalized) || isVideoSourceFile(normalized));
}

async function resolveMediaFiles(args) {
  if (args.files.length) {
    return args.files.map(normalizeRepoPath).filter(isDashboardMediaFile);
  }
  if (args.changed) {
    const changed = await changedFiles();
    if (changed) return changed.map(normalizeRepoPath).filter(isDashboardMediaFile);
  }
  const roots = await Promise.all(MEDIA_ROOTS.map((root) => walkFiles(root)));
  return roots.flat()
    .map((filePath) => normalizeRepoPath(path.relative(process.cwd(), filePath)))
    .filter(isDashboardMediaFile);
}

async function replaceIfSmaller(sourcePath, candidatePath, write) {
  const sourceSize = await fileSize(sourcePath);
  const candidateSize = await fileSize(candidatePath);
  if (!candidateSize || candidateSize >= sourceSize) {
    await fs.rm(candidatePath, { force: true });
    return { changed: false, bytesSaved: 0 };
  }
  if (write) {
    await fs.rename(candidatePath, sourcePath);
  } else {
    await fs.rm(candidatePath, { force: true });
  }
  return { changed: true, bytesSaved: sourceSize - candidateSize };
}

async function imageDimensions(repoPath, tools) {
  if (!tools.ffprobe) return null;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=s=x:p=0',
      path.resolve(repoPath)
    ]);
    const match = stdout.trim().match(/^(\d+)x(\d+)/);
    if (!match) return null;
    return {
      width: Number(match[1]),
      height: Number(match[2])
    };
  } catch {
    return null;
  }
}

async function optimizeImage(repoPath, args, tools) {
  const extension = path.posix.extname(repoPath).toLowerCase();
  const filePath = path.resolve(repoPath);
  const before = await fileSize(filePath);
  if (!before) return { repoPath, changed: false, skipped: 'missing' };

  if (extension === '.png' && tools.oxipng) {
    const candidatePath = `${filePath}.optimized.png`;
    await fs.copyFile(filePath, candidatePath);
    await execFileAsync('oxipng', ['-o', 'max', '--strip', 'safe', candidatePath]);
    return { repoPath, ...await replaceIfSmaller(filePath, candidatePath, args.write) };
  } else if (extension === '.png' && tools.optipng) {
    const candidatePath = `${filePath}.optimized.png`;
    await fs.copyFile(filePath, candidatePath);
    await execFileAsync('optipng', ['-o7', '-quiet', candidatePath]);
    return { repoPath, ...await replaceIfSmaller(filePath, candidatePath, args.write) };
  } else if ((extension === '.jpg' || extension === '.jpeg') && tools.jpegtran) {
    const candidatePath = `${filePath}.optimized`;
    await execFileAsync('jpegtran', ['-copy', 'none', '-optimize', '-progressive', '-outfile', candidatePath, filePath]);
    return { repoPath, ...await replaceIfSmaller(filePath, candidatePath, args.write) };
  } else if (extension === '.gif' && tools.gifsicle) {
    const candidatePath = `${filePath}.optimized.gif`;
    await execFileAsync('gifsicle', ['-O3', filePath, '-o', candidatePath]);
    return { repoPath, ...await replaceIfSmaller(filePath, candidatePath, args.write) };
  } else if (extension === '.webp') {
    if (isResponsiveWebpDerivative(repoPath)) {
      return { repoPath, changed: false, skipped: 'generated responsive webp derivative' };
    }
    if (await isAnimatedWebpFile(filePath)) {
      return { repoPath, changed: false, skipped: 'animated webp unsupported by cwebp' };
    }
    if (!tools.cwebp) {
      return { repoPath, changed: false, skipped: `missing optimizer for ${extension}` };
    }
    const candidatePath = `${filePath}.optimized`;
    await execFileAsync('cwebp', ['-quiet', '-lossless', '-z', '9', filePath, '-o', candidatePath]);
    return { repoPath, ...await replaceIfSmaller(filePath, candidatePath, args.write) };
  } else {
    return { repoPath, changed: false, skipped: `missing optimizer for ${extension}` };
  }

  const after = await fileSize(filePath);
  return { repoPath, changed: after < before, bytesSaved: Math.max(0, before - after) };
}

async function replaceDerivativeIfSmaller(sourcePath, derivativePath, candidatePath, write) {
  const sourceSize = await fileSize(sourcePath);
  const candidateSize = await fileSize(candidatePath);
  const derivativeExists = await fileExists(derivativePath);
  if (!candidateSize || candidateSize >= sourceSize) {
    await fs.rm(candidatePath, { force: true });
    if (write && derivativeExists) {
      await fs.rm(derivativePath, { force: true });
    }
    return { changed: derivativeExists, bytesSaved: 0, skipped: 'candidate not smaller than source' };
  }
  if (write) {
    await fs.mkdir(path.dirname(derivativePath), { recursive: true });
    await fs.rename(candidatePath, derivativePath);
  } else {
    await fs.rm(candidatePath, { force: true });
  }
  return { changed: true, bytesSaved: sourceSize - candidateSize };
}

async function generateResponsiveWebpDerivative(repoPath, width, dimensions, args, tools) {
  const extension = path.posix.extname(repoPath).toLowerCase();
  const derivativeRepoPath = responsiveWebpDerivativePathForImage(repoPath, width);
  if (!derivativeRepoPath) return { repoPath, changed: false, skipped: 'not a responsive image source' };
  if (dimensions.width <= width) {
    return { repoPath, changed: false, derivativeRepoPath, width, skipped: 'source not wider than variant' };
  }

  const sourcePath = path.resolve(repoPath);
  const derivativePath = path.resolve(derivativeRepoPath);
  const sourceStat = await fs.stat(sourcePath).catch(() => null);
  const derivativeStat = await fs.stat(derivativePath).catch(() => null);
  if (derivativeStat && sourceStat && derivativeStat.mtimeMs >= sourceStat.mtimeMs) {
    return { repoPath, changed: false, derivativeRepoPath, width, skipped: 'up to date' };
  }

  if (!args.write && !args.check) {
    return { repoPath, changed: Boolean(!derivativeStat), derivativeRepoPath, width };
  }

  const targetHeight = Math.max(1, Math.round((dimensions.height * width) / dimensions.width));
  const candidatePath = `${derivativePath}.candidate`;
  if (extension === '.gif') {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', sourcePath,
      '-vf', `scale=${width}:${targetHeight}:flags=lanczos`,
      '-loop', '0',
      '-c:v', 'libwebp',
      '-quality', RESPONSIVE_WEBP_QUALITY,
      '-preset', 'picture',
      '-an',
      '-fps_mode', 'passthrough',
      '-f', 'webp',
      candidatePath
    ], { maxBuffer: 1024 * 1024 * 20 });
  } else {
    await execFileAsync('cwebp', [
      '-quiet',
      '-q', RESPONSIVE_WEBP_QUALITY,
      '-metadata', 'none',
      '-resize', String(width), String(targetHeight),
      sourcePath,
      '-o', candidatePath
    ], { maxBuffer: 1024 * 1024 * 20 });
  }
  return {
    repoPath,
    derivativeRepoPath,
    width,
    ...await replaceDerivativeIfSmaller(sourcePath, derivativePath, candidatePath, args.write)
  };
}

async function generateResponsiveWebpDerivatives(repoPath, args, tools) {
  const derivativeRepoPaths = responsiveWebpDerivativePathsForImage(repoPath);
  if (!derivativeRepoPaths.length) return [];
  const extension = path.posix.extname(repoPath).toLowerCase();
  if (!tools.ffprobe) {
    return [{ repoPath, changed: false, skipped: 'missing ffprobe for responsive image variants' }];
  }
  if (extension === '.gif' && !tools.ffmpeg) {
    return [{ repoPath, changed: false, skipped: 'missing ffmpeg for animated responsive image variants' }];
  }
  if (extension !== '.gif' && !tools.cwebp) {
    return [{ repoPath, changed: false, skipped: 'missing cwebp for responsive image variants' }];
  }
  const dimensions = await imageDimensions(repoPath, tools);
  if (!dimensions?.width || !dimensions?.height) {
    return [{ repoPath, changed: false, skipped: 'unable to read image dimensions' }];
  }
  const results = [];
  for (const derivativeRepoPath of derivativeRepoPaths) {
    const width = Number(derivativeRepoPath.match(/-(\d+)\.webp$/i)?.[1] || 0);
    results.push(await generateResponsiveWebpDerivative(repoPath, width, dimensions, args, tools));
  }
  return results;
}

async function generateWebmDerivative(repoPath, args, tools) {
  if (!tools.ffmpeg) return { repoPath, changed: false, skipped: 'missing ffmpeg' };
  const derivativeRepoPath = webmDerivativePathForVideo(repoPath);
  if (!derivativeRepoPath) return { repoPath, changed: false, skipped: 'not a video source' };
  const sourcePath = path.resolve(repoPath);
  const derivativePath = path.resolve(derivativeRepoPath);
  const sourceStat = await fs.stat(sourcePath).catch(() => null);
  const derivativeStat = await fs.stat(derivativePath).catch(() => null);
  if (derivativeStat && sourceStat && derivativeStat.mtimeMs >= sourceStat.mtimeMs) {
    return { repoPath, changed: false, derivativeRepoPath, skipped: 'up to date' };
  }
  if (args.write) {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', sourcePath,
      '-c:v', 'libvpx-vp9',
      '-crf', '18',
      '-b:v', '0',
      '-row-mt', '1',
      '-c:a', 'libopus',
      '-b:a', '160k',
      derivativePath
    ], { maxBuffer: 1024 * 1024 * 20 });
  }
  return {
    repoPath,
    changed: !derivativeStat || Boolean(sourceStat && derivativeStat && derivativeStat.mtimeMs < sourceStat.mtimeMs),
    derivativeRepoPath,
    replacement: [publicAssetPathForRepoPath(repoPath), publicAssetPathForRepoPath(derivativeRepoPath)]
  };
}

async function referenceFiles() {
  const files = [];
  for (const root of REFERENCE_ROOTS) {
    files.push(...await walkFiles(root));
  }
  for (const file of REFERENCE_FILES) {
    if (await fileExists(file)) files.push(file);
  }
  return files.filter((file) => /\.(md|ya?ml|json)$/i.test(file));
}

async function rewriteRepositoryReferences(replacements, write) {
  if (!replacements.size) return [];
  const changed = [];
  for (const filePath of await referenceFiles()) {
    const source = await fs.readFile(filePath, 'utf8');
    const rewritten = rewriteMediaReferences(source, replacements);
    if (rewritten === source) continue;
    changed.push(normalizeRepoPath(filePath));
    if (write) await fs.writeFile(filePath, rewritten);
  }
  return changed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const write = args.write && !args.check;
  const mediaFiles = await resolveMediaFiles(args);
  const tools = {
    oxipng: await commandExists('oxipng'),
    optipng: await commandExists('optipng'),
    jpegtran: await commandExists('jpegtran'),
    gifsicle: await commandExists('gifsicle'),
    cwebp: await commandExists('cwebp'),
    ffprobe: await commandExists('ffprobe'),
    ffmpeg: await commandExists('ffmpeg')
  };
  const replacements = new Map();
  const results = [];

  for (const repoPath of mediaFiles) {
    if (isImageFile(repoPath)) {
      results.push(await optimizeImage(repoPath, { ...args, write }, tools));
      results.push(...await generateResponsiveWebpDerivatives(repoPath, { ...args, write }, tools));
    } else if (isVideoSourceFile(repoPath)) {
      const result = await generateWebmDerivative(repoPath, { ...args, write }, tools);
      results.push(result);
      if (result.replacement && (!args.check || result.derivativeRepoPath)) {
        replacements.set(result.replacement[0], result.replacement[1]);
      }
    }
  }

  const referenceChanges = write ? await rewriteRepositoryReferences(replacements, true) : [];
  const changedCount = results.filter((result) => result.changed).length + referenceChanges.length;
  console.log(JSON.stringify({
    mode: write ? 'write' : 'check',
    filesChecked: mediaFiles.length,
    changedCount,
    referenceChanges,
    tools,
    results
  }, null, 2));

  if (args.check && changedCount > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

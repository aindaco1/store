// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, utimesSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = path.resolve('scripts/optimize-media.mjs');
let root: string;
let toolEnv: NodeJS.ProcessEnv;
const source = 'assets/images/products/poster.png';
const manifestPath = '_data/media-optimization-manifest.json';
const run = (args: string[], extra = {}) => execFileSync(process.execPath, [script, ...args], { cwd: root, env: { ...toolEnv, ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const manifest = () => JSON.parse(readFileSync(path.join(root, manifestPath), 'utf8'));
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'store-media-preparation-'));
  for (const dir of ['bin', '_products', '_data', 'assets/images/products']) mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(path.join(root, source), Buffer.alloc(1024, 'A'));
  writeFileSync(path.join(root, '_products/poster.md'), `---\nimage: /${source}\n---\nPoster\n`);
  writeFileSync(path.join(root, manifestPath), '{}');
  // Deterministic encoders isolate preparation/provenance behavior from installed codecs.
  const fakeTool = `#!${process.execPath}\nconst fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-version') || args.includes('-h')) process.exit(0);
if (process.argv[1].endsWith('ffprobe')) {
  const width = Number(process.env.STORE_TEST_WIDTH || 800);
  console.log(args.includes('csv=s=x:p=0') ? width+'x1000' : JSON.stringify({streams:[{codec_type:'video',width,height:1000}],format:{duration:1}}));
} else {
  if (process.env.STORE_TEST_FAIL_ENCODING === '1') process.exit(23);
  const video = process.argv[1].endsWith('ffmpeg');
  const input = fs.readFileSync(video ? args[args.indexOf('-i')+1] : args[args.indexOf('-o')-1]);
  fs.writeFileSync(video ? args.at(-1) : args[args.indexOf('-o')+1], Buffer.alloc(process.env.STORE_TEST_LARGE === '1' ? 2048 : 48, input[0]));
}\n`;
  for (const name of ['ffprobe', 'cwebp', 'ffmpeg']) {
    const file = path.join(root, 'bin', name);
    writeFileSync(file, fakeTool); chmodSync(file, 0o755);
  }
  toolEnv = { ...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}` };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('product media preparation gate', () => {
  it('prepares missing derivatives and regenerates replaced sources even after manifest refresh and equal mtimes', () => {
    expect(() => run(['--publish-check'])).toThrow();
    run(['--write', '--publish']);
    const before = manifest().assets[0];
    expect(before.missingDerivatives).toEqual([]);
    expect(before.derivatives).toHaveLength(3);
    expect(readFileSync(path.join(root, source))).toEqual(Buffer.alloc(1024, 'A'));
    expect(run(['--publish-check'])).toContain('ready for deployment');
    writeFileSync(path.join(root, source), Buffer.alloc(1024, 'B'));
    for (const file of [source, ...before.derivatives.map((item: any) => item.path)]) utimesSync(path.join(root, file), 1000, 1000);
    run(['--write', '--manifest-only']);
    expect(manifest().assets[0].optimizationStatus).toBe('stale_derivatives');
    expect(() => run(['--publish-check'])).toThrow();
    run(['--write', '--publish']);
    const after = manifest().assets[0];
    expect(after.optimizationStatus).toBe('ready');
    expect(after.derivatives.every((item: any) => item.sourceSha256 === after.sha256)).toBe(true);
    expect(after.derivatives[0].sha256).not.toBe(before.derivatives[0].sha256);
    expect(readFileSync(path.join(root, source))).toEqual(Buffer.alloc(1024, 'B'));
    expect(JSON.parse(run(['--write', '--publish'])).filesChecked).toBe(0);
  });

  it('fails closed on an encoder failure or broken product reference', () => {
    expect(() => run(['--write', '--publish'], { STORE_TEST_FAIL_ENCODING: '1' })).toThrow();
    expect(readFileSync(path.join(root, source))).toEqual(Buffer.alloc(1024, 'A'));
    writeFileSync(path.join(root, '_products/poster.md'), 'image: /assets/images/products/missing.png\n');
    expect(() => run(['--write', '--publish'])).toThrow();
  });

  it('removes obsolete responsive widths when a replacement shrinks, even after a manifest-only refresh', () => {
    run(['--write', '--publish']);
    const oldPaths = manifest().assets[0].derivatives.map((item: any) => item.path);
    writeFileSync(path.join(root, source), Buffer.alloc(1024, 'B'));
    writeFileSync(path.join(root, '_products/poster.md'), `image: /${source}\n<img src="/${oldPaths[0]}">\n`);
    const smaller = { STORE_TEST_WIDTH: '200' };
    run(['--write', '--manifest-only'], smaller);
    expect(manifest().assets[0].staleDerivatives).toEqual(oldPaths);
    expect(() => run(['--publish-check'], smaller)).toThrow();
    run(['--write', '--publish'], smaller);
    expect(manifest().assets[0].derivatives).toEqual([]);
    for (const file of oldPaths) expect(() => readFileSync(path.join(root, file))).toThrow();
    expect(readFileSync(path.join(root, '_products/poster.md'), 'utf8')).not.toContain('.webp');
    expect(run(['--publish-check'], smaller)).toContain('ready for deployment');
  });

  it('prepares video and restores its source reference if a replacement derivative would be larger', () => {
    const video = 'assets/videos/products/trailer.mp4';
    mkdirSync(path.join(root, 'assets/videos/products'), { recursive: true });
    writeFileSync(path.join(root, video), Buffer.alloc(1024, 'V'));
    writeFileSync(path.join(root, '_products/poster.md'), `video: /${video}\n`);
    run(['--write', '--publish']);
    expect(readFileSync(path.join(root, '_products/poster.md'), 'utf8')).toContain('/assets/videos/products/trailer.webm');
    expect(run(['--publish-check'])).toContain('ready for deployment');
    writeFileSync(path.join(root, video), Buffer.alloc(1024, 'W'));
    run(['--write', '--publish'], { STORE_TEST_LARGE: '1' });
    expect(readFileSync(path.join(root, '_products/poster.md'), 'utf8')).toContain('/assets/videos/products/trailer.mp4');
    expect(readFileSync(path.join(root, video))).toEqual(Buffer.alloc(1024, 'W'));
    expect(run(['--publish-check'])).toContain('ready for deployment');
  });

  it('retains intentional larger-output skips and ignores unattached uploads', () => {
    writeFileSync(path.join(root, 'assets/images/products/unattached.png'), Buffer.alloc(1024, 'C'));
    run(['--write', '--publish'], { STORE_TEST_LARGE: '1' });
    const poster = manifest().assets.find((asset: any) => asset.path === source);
    expect(poster.skippedDerivatives).toHaveLength(3);
    expect(poster.missingDerivatives).toEqual([]);
    expect(run(['--publish-check'])).toContain('ready for deployment');
    expect(JSON.parse(run(['--write', '--publish'])).filesChecked).toBe(0);
  });
});

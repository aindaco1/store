// @vitest-environment node
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const decoder = vi.hoisted(() => ({ outputs: new Map<string, string | Error>() }));
vi.mock('node:child_process', () => ({
  execFile: (command: string, args: string[], options: unknown, callback: Function) => {
    const output = decoder.outputs.get(args[args.indexOf('-i') + 1]);
    callback(output instanceof Error ? output : null, { stdout: output, stderr: '' });
  }
}));
import { replaceIfSmaller } from '../../scripts/optimize-media.mjs';

let root: string;
let source: string;
let candidate: string;
const original = Buffer.alloc(100, 's');
const smaller = Buffer.alloc(50, 'c');
const frames = '#tb 0: 1/25\n#dimensions 0: 32x32\n#sar 0: 11811/11811\n0, 0, 0, 1, 4096, abc123\n';
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'store-lossless-'));
  source = path.join(root, 'source.png');
  candidate = path.join(root, 'candidate.png');
  await writeFile(source, original);
  await writeFile(candidate, smaller);
  decoder.outputs.clear();
  decoder.outputs.set(source, frames);
  decoder.outputs.set(candidate, frames.replace('11811/11811', '1/1'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('lossless image replacement', () => {
  it('accepts equivalent density ratios before replacing a smaller image', async () => {
    expect(await replaceIfSmaller(source, candidate, true)).toEqual({ changed: true, bytesSaved: 50 });
    expect(await readFile(source)).toEqual(smaller);
    await expect(access(candidate)).rejects.toThrow();
  });

  it('validates dry runs without changing the source', async () => {
    expect(await replaceIfSmaller(source, candidate, false)).toMatchObject({ changed: true });
    expect(await readFile(source)).toEqual(original);
    await expect(access(candidate)).rejects.toThrow();
  });

  for (const [label, output] of [
    ['pixels', frames.replace('abc123', 'def456')],
    ['dimensions', frames.replace('32x32', '16x64')],
    ['timing', frames.replace('1/25', '1/24')],
    ['aspect ratio', frames.replace('11811/11811', '2/1')],
    ['missing ratio evidence', frames.replace(/#sar[^\n]*\n/, '')],
    ['decoder failure', new Error('decode failed')]
  ] as const) {
    it(`preserves the source and removes the candidate on ${label}`, async () => {
      decoder.outputs.set(candidate, output);
      await expect(replaceIfSmaller(source, candidate, true)).rejects.toThrow();
      expect(await readFile(source)).toEqual(original);
      await expect(access(candidate)).rejects.toThrow();
    });
  }
});

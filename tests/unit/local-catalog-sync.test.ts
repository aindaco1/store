// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalCatalogSync } from '../../worker/src/local-catalog-sync.mjs';

let root: string;
let sync: ReturnType<typeof createLocalCatalogSync>;
const product = (price = 20) => `---\nidentifier: local-product\nname: Local product\nprice: ${price}\nstatus: draft\nfulfillment_type: service\n---\nProduct copy.\n`;
const outputPath = () => path.join(root, 'worker/src/generated/catalog-snapshot.js');

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'store-catalog-sync-'));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, '_products'));
  await copyFile('scripts/generate-catalog-snapshot.rb', path.join(root, 'scripts/generate-catalog-snapshot.rb'));
  await writeFile(path.join(root, '_config.yml'), 'url: http://127.0.0.1:4002\n');
  await writeFile(path.join(root, '_products/local-product.md'), product());
  sync = createLocalCatalogSync({ repoRoot: root, intervalMs: 25 });
});

afterEach(async () => {
  sync.stop();
  await sync.sync(); // Drain any queued watcher before removing its fixture.
  await rm(root, { recursive: true, force: true });
});

describe('local catalog synchronization', () => {
  it('deduplicates concurrent regeneration and leaves unchanged output untouched', async () => {
    const generate = vi.fn(async () => execFileSync('ruby', [path.join(root, 'scripts/generate-catalog-snapshot.rb')]));
    sync = createLocalCatalogSync({ repoRoot: root, generate });
    const [first, second] = await Promise.all([sync.sync(), sync.sync()]);
    expect(first).toMatchObject({ ok: true, sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(second).toEqual(first);
    expect(generate).toHaveBeenCalledTimes(1);
    const before = await stat(outputPath());
    await generate();
    expect((await stat(outputPath())).mtimeMs).toBe(before.mtimeMs);
  });

  it('watches editor saves, renames, additions, removals, and canonical configuration', async () => {
    await sync.sync();
    sync.start();
    await writeFile(path.join(root, '_products/local-product.md'), product(35));
    await expect.poll(async () => (await readFile(outputPath(), 'utf8')).includes('"price_cents": 3500')).toBe(true);
    await rename(path.join(root, '_products/local-product.md'), path.join(root, '_products/renamed.md'));
    await expect.poll(async () => (await readFile(outputPath(), 'utf8')).includes('"slug": "renamed"')).toBe(true);
    await writeFile(path.join(root, '_products/second.md'), product().replace('identifier: local-product', 'identifier: second'));
    await expect.poll(async () => (await readFile(outputPath(), 'utf8')).includes('"id": "second"')).toBe(true);
    await rm(path.join(root, '_products/second.md'));
    await expect.poll(async () => (await readFile(outputPath(), 'utf8')).includes('"id": "second"')).toBe(false);
    await writeFile(path.join(root, '_config.yml'), 'url: http://127.0.0.1:4999\n');
    await expect.poll(async () => (await readFile(outputPath(), 'utf8')).includes('http://127.0.0.1:4999/products/renamed/')).toBe(true);
  });

  it('preserves the last valid output on malformed YAML and recovers after correction', async () => {
    const first = await sync.sync();
    const goodOutput = await readFile(outputPath(), 'utf8');
    await writeFile(path.join(root, '_products/local-product.md'), '---\nvariants: [\n---\n');
    expect(await sync.sync()).toMatchObject({ ok: false, code: 'local_catalog_rebuild_failed' });
    expect(await readFile(outputPath(), 'utf8')).toBe(goodOutput);
    await writeFile(path.join(root, '_products/local-product.md'), product(40));
    const recovered = await sync.sync();
    expect(recovered.ok).toBe(true);
    expect(recovered.sourceHash).not.toBe(first.sourceHash);
  });
});

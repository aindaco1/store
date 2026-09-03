import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

// Only repository sources feed the existing generated catalog. No KV catalog or
// browser override: Wrangler reloads the same module used in production builds.
export function createLocalCatalogSync({ repoRoot, intervalMs = 1000, generate } = {}) {
  const root = path.resolve(repoRoot);
  const generateCatalog = generate || (() => runFile('ruby', [path.join(root, 'scripts/generate-catalog-snapshot.rb')], {
    cwd: root, timeout: 20000, maxBuffer: 128 * 1024
  }));
  let completedInput = '';
  let failedInput = '';
  let result = null;
  let queue = Promise.resolve();
  let timer = null;
  let checking = false;

  async function inputHash() {
    const names = (await fs.readdir(path.join(root, '_products'))).filter((name) => name.endsWith('.md')).sort();
    const hash = createHash('sha256');
    for (const file of ['_config.yml', ...names.map((name) => `_products/${name}`)]) {
      hash.update(file).update('\0').update(await fs.readFile(path.join(root, file))).update('\0');
    }
    return hash.digest('hex');
  }

  function sync({ retry = true } = {}) {
    const operation = queue.then(async () => {
      let before = '';
      try {
        before = await inputHash();
        if (before === completedInput && result?.ok) return result;
        if (!retry && before === failedInput) return result;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await generateCatalog();
          const after = await inputHash();
          if (after !== before) {
            before = after;
            continue;
          }
          const output = await fs.readFile(path.join(root, 'worker/src/generated/catalog-snapshot.js'), 'utf8');
          const sourceHash = output.match(/"source_hash":\s*"([a-f0-9]{64})"/)?.[1];
          if (!sourceHash) throw new Error('Catalog source hash is missing.');
          completedInput = before;
          failedInput = '';
          result = { ok: true, mode: 'local', sourceHash };
          return result;
        }
        throw new Error('Catalog sources kept changing during regeneration.');
      } catch (_error) {
        failedInput = before;
        result = {
          ok: false, status: 503, mode: 'local', code: 'local_catalog_rebuild_failed',
          error: 'Local file saved, but catalog regeneration failed. Check product YAML and run npm run catalog:generate.'
        };
        return result;
      }
    });
    queue = operation.catch(() => {});
    return operation;
  }

  async function check() {
    if (checking) return;
    checking = true;
    try {
      const previous = result;
      const next = await sync({ retry: false });
      if (!next.ok && next !== previous) console.error(next.error);
    } finally {
      checking = false;
    }
  }

  return {
    sync,
    start() {
      if (timer) return;
      void check();
      // Poll a small source set: reliable across editor atomic renames, iCloud,
      // and container bind mounts; never watch generated output recursively.
      timer = setInterval(check, intervalMs);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    }
  };
}

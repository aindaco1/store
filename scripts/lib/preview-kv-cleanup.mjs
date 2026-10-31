import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

// Wrangler bulk get reads values. Its key list supplies presence, metadata and expiration.
export function matchingPreviewKvKeys(records, binding, keysFile, run) {
  if (!records.length) return [];
  const flags = ['--binding', binding, '--remote', '--preview'];
  const list = run(['wrangler', 'kv', 'key', 'list', ...flags]);
  if (list.status !== 0) throw new Error('Preview KV listing failed.');
  const entries = JSON.parse(list.stdout);
  if (!Array.isArray(entries)) throw new Error('Invalid preview KV listing.');
  const listed = new Map();
  for (const entry of entries) {
    if (typeof entry?.name !== 'string' || listed.has(entry.name)) throw new Error('Invalid preview KV listing.');
    listed.set(entry.name, entry);
  }

  const present = records.filter(record => listed.has(record.key));
  for (let start = 0; start < present.length; start += 100) {
    const batch = present.slice(start, start + 100);
    fs.writeFileSync(keysFile, JSON.stringify(batch.map(record => record.key)), { mode: 0o600 });
    const read = run(['wrangler', 'kv', 'bulk', 'get', keysFile, ...flags]);
    if (read.status !== 0) throw new Error('Preview KV read failed.');
    const values = JSON.parse(read.stdout);
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length !== batch.length) {
      throw new Error('Incomplete preview KV read.');
    }
    for (const record of batch) {
      const entry = listed.get(record.key);
      const live = values[record.key];
      const value = typeof live === 'string' ? live : live?.value;
      if (!Object.hasOwn(values, record.key) || value !== record.value || entry.expiration != null ||
          !isDeepStrictEqual(entry.metadata ?? null, record.metadata ?? null)) {
        throw new Error('Preview KV record changed or could not be read.');
      }
    }
  }
  return present.map(record => record.key);
}

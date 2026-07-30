import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const productsDir = path.join(root, '_products');

describe('product description copy', () => {
  it('does not repeat the card action or product name with a Shop prefix', () => {
    const offenders = fs
      .readdirSync(productsDir)
      .filter((fileName) => fileName.endsWith('.md'))
      .flatMap((fileName) => {
        const source = fs.readFileSync(path.join(productsDir, fileName), 'utf8');
        return /^description:\s*["']?Shop\b/im.test(source) ? [fileName] : [];
      });

    expect(offenders).toEqual([]);
  });
});

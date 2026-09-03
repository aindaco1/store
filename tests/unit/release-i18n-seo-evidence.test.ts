import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { firstRenderedProductRoute } from '../../scripts/release-i18n-seo-evidence.mjs';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function fixture(products: Array<{ slug: string; status: string }>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-seo-evidence-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'api'));
  fs.mkdirSync(path.join(root, 'products/a-private-draft'), { recursive: true });
  fs.writeFileSync(path.join(root, 'products/a-private-draft/index.html'), '<meta name="robots" content="noindex,nofollow,noarchive">');
  fs.writeFileSync(path.join(root, 'api/products.json'), JSON.stringify({ products }));
  return root;
}

describe('release product metadata selection', () => {
  it('probes the public catalog even when a draft sorts first on disk', () => {
    const root = fixture([{ slug: 'public-ticket', status: 'active' }]);
    expect(firstRenderedProductRoute('products', root)).toBe('/products/public-ticket/');
    expect(firstRenderedProductRoute('es/products', root)).toBe('/es/products/public-ticket/');
  });

  it('retains sold-out products and does not hide missing public rendered routes', () => {
    const root = fixture([{ slug: 'sold-out-ticket', status: 'sold_out' }]);
    expect(firstRenderedProductRoute('products', root)).toBe('/products/sold-out-ticket/');
  });

  it('returns no sample when the public catalog is empty', () => {
    expect(firstRenderedProductRoute('products', fixture([]))).toBe('');
  });
});

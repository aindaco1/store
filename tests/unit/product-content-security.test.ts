import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  allowedFulfillmentTypes,
  allowedProductStatuses,
  allowedShippingPresets,
  allowedTaxCategories,
  auditProductContent,
  listProductFiles,
  rawHtmlTagPattern,
} from '../../scripts/audit-product-content.mjs';

const repoRoot = path.resolve(__dirname, '..', '..');

function writeProduct(root: string, fileName: string, content: string) {
  const productsDir = path.join(root, '_products');
  fs.mkdirSync(productsDir, { recursive: true });
  fs.writeFileSync(path.join(productsDir, fileName), content, 'utf8');
}

function withTempProductRoot(callback: (root: string) => void) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'store-product-audit-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'assets', 'images'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'assets', 'images', 'sample.png'), '');
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('product content security audit', () => {
  it('accepts the current Store product content set', () => {
    expect(listProductFiles(repoRoot).length).toBeGreaterThan(0);
    expect(auditProductContent(repoRoot)).toEqual([]);
  });

  it('keeps Store product text rendered through escaped or sanitized paths', () => {
    const cardTemplate = fs.readFileSync(path.join(repoRoot, '_includes', 'product-card.html'), 'utf8');
    const productLayout = fs.readFileSync(path.join(repoRoot, '_layouts', 'product-preview.html'), 'utf8');

    expect(cardTemplate).toContain('{{ desc_text | truncate: 170 | escape }}');
    expect(cardTemplate).toContain('data-item-description="{{ desc_text | escape }}"');
    expect(productLayout).toContain('{{ content | sanitize_markdown_links: site.url }}');
  });

  it('keeps the product metadata allowlists narrow', () => {
    expect(Array.from(allowedFulfillmentTypes).sort()).toEqual(['digital', 'physical', 'rsvp', 'ticket']);
    expect(Array.from(allowedProductStatuses).sort()).toEqual(['active', 'archived', 'draft', 'sold_out']);
    expect(Array.from(allowedShippingPresets).sort()).toEqual(['mug', 'parcel', 'poster', 'sticker', 'ticket', 'tshirt']);
    expect(Array.from(allowedTaxCategories).sort()).toEqual(['admission', 'digital', 'exempt', 'standard']);
    expect(rawHtmlTagPattern).toBeInstanceOf(RegExp);
  });

  it('rejects raw html and inline script surfaces in product content', () => {
    withTempProductRoot((tempRoot) => {
      writeProduct(
        tempRoot,
        'bad-html.md',
        `---
identifier: bad-html
sku: bad-html
name: Bad HTML
price: 10
image: "/assets/images/sample.png"
type: physical
fulfillment_type: physical
status: active
shipping_preset: parcel
tax_category: standard
---
Safe line
<img src=x onerror="alert(1)" style="width:100%">
<script>alert(1)</script>
`
      );

      expect(auditProductContent(tempRoot)).toEqual(
        expect.arrayContaining([
          '_products/bad-html.md: inline style attributes are not allowed in product content.',
          '_products/bad-html.md: raw <script> tags are not allowed in product content.',
          '_products/bad-html.md: inline event handler found (onerror=").',
          '_products/bad-html.md: raw <img> HTML is not allowed in product content; use Markdown instead.',
          '_products/bad-html.md: raw <script> HTML is not allowed in product content; use Markdown instead.',
        ])
      );
    });
  });

  it('rejects unsafe product references and malformed money fields', () => {
    withTempProductRoot((tempRoot) => {
      writeProduct(
        tempRoot,
        'bad-reference.md',
        `---
identifier: bad-reference
sku: bad-reference
name: Bad Reference
price: free
image: "javascript:alert(1)"
type: physical
fulfillment_type: physical
status: active
collection: fronteras
category: "bad category"
slug: "Bad Slug"
shipping_preset: parcel
tax_category: standard
---
[Bad link](javascript:alert(1))
`
      );

      expect(auditProductContent(tempRoot)).toEqual(
        expect.arrayContaining([
          '_products/bad-reference.md: product price must be a non-negative number.',
          '_products/bad-reference.md: product category must be lowercase letters, numbers, dashes, or underscores.',
          '_products/bad-reference.md: use store_collection for storefront grouping; collection is reserved by Jekyll.',
          '_products/bad-reference.md: price values must be non-negative numbers.',
          '_products/bad-reference.md: slug values must be lowercase letters, numbers, dashes, or underscores.',
          '_products/bad-reference.md: image must use a local path or an approved HTTP(S) URL.',
          '_products/bad-reference.md: markdown link "javascript:alert(1" uses an unsafe URL.',
        ])
      );
    });
  });

  it('rejects duplicate identifiers and variant metadata drift', () => {
    withTempProductRoot((tempRoot) => {
      writeProduct(
        tempRoot,
        'one.md',
        `---
identifier: duplicate
sku: duplicate-one
name: One
price: 10
image: "/assets/images/sample.png"
type: shirt
fulfillment_type: physical
status: active
shipping_preset: tshirt
tax_category: standard
variants:
- id: xs
  label: XS
  sku: one-xs
  price: 10
- id: xs
  label: Duplicate
  sku: bad sku
  price: nope
---
One.
`
      );
      writeProduct(
        tempRoot,
        'two.md',
        `---
identifier: duplicate
sku: duplicate-two
name: Two
price: 12
image: "/assets/images/sample.png"
type: sticker
fulfillment_type: physical
status: active
shipping_preset: sticker
tax_category: standard
---
Two.
`
      );

      expect(auditProductContent(tempRoot)).toEqual(
        expect.arrayContaining([
          '_products/one.md: price values must be non-negative numbers.',
          '_products/one.md: duplicate variant id "xs".',
          '_products/one.md: variant sku "bad sku" must be lowercase letters, numbers, dashes, or underscores.',
          '_products/one.md: variant "xs" price must be a non-negative number.',
          '_products/two.md: product identifier "duplicate" is already used by _products/one.md.',
        ])
      );
    });
  });

  it('requires digital products to declare a signed download file key', () => {
    withTempProductRoot((tempRoot) => {
      writeProduct(
        tempRoot,
        'download.md',
        `---
identifier: download
sku: download
name: Download
price: 5
image: "/assets/images/sample.png"
type: digital
fulfillment_type: digital
status: active
shipping_preset: ticket
tax_category: digital
---
Digital product.
`
      );

      expect(auditProductContent(tempRoot)).toContain(
        '_products/download.md: digital products must define download.file_key.'
      );
    });
  });

  it('accepts a safe product with variants and markdown links', () => {
    withTempProductRoot((tempRoot) => {
      writeProduct(
        tempRoot,
        'good.md',
        `---
identifier: good-product
sku: good-product
name: Good Product
price: 10
image: "/assets/images/sample.png"
type: ticket
fulfillment_type: ticket
status: active
shipping_preset: ticket
tax_category: admission
inventory_tracking: true
inventory: 10
variants:
- id: general
  label: General
  sku: good-product-general
  price: 10
  inventory: 8
- id: supporter
  label: Supporter
  sku: good-product-supporter
  price: 20
  inventory: 2
---
[Terms](/terms/) and [Dust Wave](https://dustwave.xyz).
`
      );

      expect(auditProductContent(tempRoot)).toEqual([]);
    });
  });
});

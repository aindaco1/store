#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const allowedFulfillmentTypes = new Set(['digital', 'physical', 'rsvp', 'ticket']);
export const allowedProductStatuses = new Set(['active', 'archived', 'draft', 'sold_out']);
export const allowedShippingPresets = new Set(['mug', 'parcel', 'poster', 'sticker', 'ticket', 'tshirt']);
export const allowedTaxCategories = new Set(['admission', 'digital', 'exempt', 'standard']);
export const rawHtmlTagPattern = /<\s*\/?\s*([a-z0-9]+)(?:\s[^>]*)?>/ig;

const REQUIRED_FIELDS = ['identifier', 'sku', 'name', 'price', 'image', 'type', 'fulfillment_type', 'status'];
const OPTIONAL_TOKEN_FIELDS = ['category', 'store_collection'];
const SAFE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

function splitFrontMatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontMatter: '', body: content };
  }

  return { frontMatter: match[1], body: match[2] };
}

function normalizeScalar(value) {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function readTopLevelScalar(frontMatter, key) {
  const pattern = new RegExp(`^${key}:\\s*(.*)$`, 'm');
  const match = frontMatter.match(pattern);
  return match ? normalizeScalar(match[1]) : '';
}

function readAllScalars(frontMatter, key) {
  const pattern = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'gm');
  const values = [];
  for (const match of frontMatter.matchAll(pattern)) {
    values.push(normalizeScalar(match[1]));
  }
  return values;
}

function parseBoolean(value) {
  if (value === '') return null;
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  return null;
}

function parseNonNegativeNumber(value) {
  if (!/^\d+(?:\.\d+)?$/.test(String(value || '').trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseNonNegativeInteger(value) {
  if (!/^\d+$/.test(String(value || '').trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseVariantBlocks(frontMatter) {
  const lines = frontMatter.split(/\r?\n/);
  const variants = [];
  let inVariants = false;
  let current = null;

  for (const line of lines) {
    if (!inVariants) {
      if (/^variants:\s*$/.test(line)) {
        inVariants = true;
      }
      continue;
    }

    if (/^[A-Za-z_][\w-]*:\s*/.test(line)) {
      break;
    }

    const itemMatch = line.match(/^\s*-\s+([A-Za-z_][\w-]*):\s*(.*)$/);
    if (itemMatch) {
      current = {};
      variants.push(current);
      current[itemMatch[1]] = normalizeScalar(itemMatch[2]);
      continue;
    }

    const fieldMatch = line.match(/^\s+([A-Za-z_][\w-]*):\s*(.*)$/);
    if (fieldMatch && current) {
      current[fieldMatch[1]] = normalizeScalar(fieldMatch[2]);
    }
  }

  return variants;
}

function isSafeReference(value, { allowExternal = true } = {}) {
  const raw = normalizeScalar(value);
  if (!raw) return false;
  if (raw.startsWith('#') || raw.startsWith('?') || raw.startsWith('./') || raw.startsWith('../')) {
    return true;
  }
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return true;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return allowExternal;
    }
    return parsed.protocol === 'mailto:';
  } catch (_err) {
    return !/^[a-z][a-z0-9+.-]*:/i.test(raw);
  }
}

function listMarkdownLinks(markdown) {
  const links = [];
  const pattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g;
  for (const match of markdown.matchAll(pattern)) {
    links.push(normalizeScalar(match[1]));
  }
  return links;
}

export function listProductFiles(repoRoot) {
  const productsDir = path.join(repoRoot, '_products');
  if (!fs.existsSync(productsDir)) {
    return [];
  }

  return fs.readdirSync(productsDir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => path.join(productsDir, file));
}

export function auditProductContent(repoRoot) {
  const failures = [];
  const productFiles = listProductFiles(repoRoot);
  const seenIdentifiers = new Map();
  const seenSkus = new Map();

  if (productFiles.length === 0) {
    failures.push('_products: at least one product markdown file is required.');
    return failures;
  }

  for (const productFile of productFiles) {
    const relPath = path.relative(repoRoot, productFile);
    const content = fs.readFileSync(productFile, 'utf8');
    const { frontMatter, body } = splitFrontMatter(content);

    if (!frontMatter) {
      failures.push(`${relPath}: product files must use YAML front matter.`);
      continue;
    }

    const fields = Object.fromEntries(REQUIRED_FIELDS.map((key) => [key, readTopLevelScalar(frontMatter, key)]));
    for (const key of REQUIRED_FIELDS) {
      if (!fields[key]) {
        failures.push(`${relPath}: missing required product field "${key}".`);
      }
    }

    if (fields.identifier && !SAFE_TOKEN_PATTERN.test(fields.identifier)) {
      failures.push(`${relPath}: product identifier must be lowercase letters, numbers, dashes, or underscores.`);
    }

    if (fields.sku && !SAFE_TOKEN_PATTERN.test(fields.sku)) {
      failures.push(`${relPath}: product sku must be lowercase letters, numbers, dashes, or underscores.`);
    }

    for (const key of OPTIONAL_TOKEN_FIELDS) {
      const value = readTopLevelScalar(frontMatter, key);
      if (value && !SAFE_TOKEN_PATTERN.test(value)) {
        failures.push(`${relPath}: product ${key} must be lowercase letters, numbers, dashes, or underscores.`);
      }
    }

    if (readTopLevelScalar(frontMatter, 'collection')) {
      failures.push(`${relPath}: use store_collection for storefront grouping; collection is reserved by Jekyll.`);
    }

    if (fields.identifier) {
      const existing = seenIdentifiers.get(fields.identifier);
      if (existing) {
        failures.push(`${relPath}: product identifier "${fields.identifier}" is already used by ${existing}.`);
      }
      seenIdentifiers.set(fields.identifier, relPath);
    }

    if (fields.sku) {
      const existing = seenSkus.get(fields.sku);
      if (existing) {
        failures.push(`${relPath}: product sku "${fields.sku}" is already used by ${existing}.`);
      }
      seenSkus.set(fields.sku, relPath);
    }

    if (fields.price && parseNonNegativeNumber(fields.price) === null) {
      failures.push(`${relPath}: product price must be a non-negative number.`);
    }

    if (fields.fulfillment_type && !allowedFulfillmentTypes.has(fields.fulfillment_type)) {
      failures.push(`${relPath}: fulfillment_type "${fields.fulfillment_type}" is not supported.`);
    }

    if (fields.status && !allowedProductStatuses.has(fields.status)) {
      failures.push(`${relPath}: status "${fields.status}" is not supported.`);
    }

    const shippingPreset = readTopLevelScalar(frontMatter, 'shipping_preset');
    if (shippingPreset && !allowedShippingPresets.has(shippingPreset)) {
      failures.push(`${relPath}: shipping_preset "${shippingPreset}" is not supported.`);
    }

    const taxCategory = readTopLevelScalar(frontMatter, 'tax_category');
    if (taxCategory && !allowedTaxCategories.has(taxCategory)) {
      failures.push(`${relPath}: tax_category "${taxCategory}" is not supported.`);
    }

    const inventoryTracking = parseBoolean(readTopLevelScalar(frontMatter, 'inventory_tracking'));
    if (readTopLevelScalar(frontMatter, 'inventory_tracking') && inventoryTracking === null) {
      failures.push(`${relPath}: inventory_tracking must be true or false.`);
    }

    for (const inventoryValue of readAllScalars(frontMatter, 'inventory')) {
      if (parseNonNegativeInteger(inventoryValue) === null) {
        failures.push(`${relPath}: inventory values must be non-negative integers.`);
      }
    }

    for (const priceValue of readAllScalars(frontMatter, 'price')) {
      if (parseNonNegativeNumber(priceValue) === null) {
        failures.push(`${relPath}: price values must be non-negative numbers.`);
      }
    }

    for (const slugValue of readAllScalars(frontMatter, 'slug')) {
      if (slugValue && !SAFE_TOKEN_PATTERN.test(slugValue)) {
        failures.push(`${relPath}: slug values must be lowercase letters, numbers, dashes, or underscores.`);
      }
    }

    if (fields.image) {
      if (!isSafeReference(fields.image, { allowExternal: true })) {
        failures.push(`${relPath}: image must use a local path or an approved HTTP(S) URL.`);
      } else if (fields.image.startsWith('/')) {
        const imagePath = path.join(repoRoot, fields.image);
        if (!fs.existsSync(imagePath)) {
          failures.push(`${relPath}: image "${fields.image}" does not exist.`);
        }
      }
    }

    const variants = parseVariantBlocks(frontMatter);
    const seenVariantIds = new Set();
    for (const variant of variants) {
      if (!variant.id) {
        failures.push(`${relPath}: every variant must define an id.`);
      } else if (!SAFE_TOKEN_PATTERN.test(variant.id)) {
        failures.push(`${relPath}: variant id "${variant.id}" must be lowercase letters, numbers, dashes, or underscores.`);
      } else if (seenVariantIds.has(variant.id)) {
        failures.push(`${relPath}: duplicate variant id "${variant.id}".`);
      }
      seenVariantIds.add(variant.id);

      if (!variant.label) {
        failures.push(`${relPath}: variant "${variant.id || '(missing id)'}" must define a label.`);
      }

      if (variant.sku && !SAFE_TOKEN_PATTERN.test(variant.sku)) {
        failures.push(`${relPath}: variant sku "${variant.sku}" must be lowercase letters, numbers, dashes, or underscores.`);
      }

      if (variant.price && parseNonNegativeNumber(variant.price) === null) {
        failures.push(`${relPath}: variant "${variant.id || '(missing id)'}" price must be a non-negative number.`);
      }
    }

    if (fields.fulfillment_type === 'digital') {
      const fileKey = readAllScalars(frontMatter, 'file_key')[0] || '';
      if (!fileKey) {
        failures.push(`${relPath}: digital products must define download.file_key.`);
      } else if (!SAFE_TOKEN_PATTERN.test(fileKey)) {
        failures.push(`${relPath}: download.file_key must be lowercase letters, numbers, dashes, or underscores.`);
      }
    }

    if (/\bstyle\s*=\s*["']/i.test(content)) {
      failures.push(`${relPath}: inline style attributes are not allowed in product content.`);
    }

    if (/<script\b/i.test(content)) {
      failures.push(`${relPath}: raw <script> tags are not allowed in product content.`);
    }

    if (/<iframe\b/i.test(content)) {
      failures.push(`${relPath}: raw <iframe> HTML is not allowed in product content.`);
    }

    const inlineEventMatches = content.match(/\son[a-z]+\s*=\s*["']/ig) || [];
    for (const match of inlineEventMatches) {
      failures.push(`${relPath}: inline event handler found (${match.trim()}).`);
    }

    for (const match of content.matchAll(rawHtmlTagPattern)) {
      const tag = match[1]?.toLowerCase();
      if (tag) {
        failures.push(`${relPath}: raw <${tag}> HTML is not allowed in product content; use Markdown instead.`);
      }
    }

    for (const link of listMarkdownLinks(body)) {
      if (!isSafeReference(link, { allowExternal: true })) {
        failures.push(`${relPath}: markdown link "${link}" uses an unsafe URL.`);
      }
    }
  }

  return failures;
}

export function main() {
  const repoRoot = process.cwd();
  const failures = auditProductContent(repoRoot);

  if (failures.length > 0) {
    console.error('Product content audit failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Product content audit passed.');
}

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentPath = fileURLToPath(import.meta.url);

if (executedPath === currentPath) {
  main();
}

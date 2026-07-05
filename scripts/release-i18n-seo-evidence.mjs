#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_DIR = path.join(ROOT, '_site');
const results = [];

function add(status, label, detail = '') {
  results.push({ status, label, detail });
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`${status.padEnd(5)} ${label}${suffix}`);
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: process.env
  });
  if (result.status === 0) {
    add('PASS', label, 'completed');
    return true;
  }
  const detail = String(result.stderr || result.stdout || `${command} failed`)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-3)
    .join(' | ');
  add('FAIL', label, detail || `${command} failed`);
  return false;
}

function fail(label, detail) {
  add('FAIL', label, detail);
  return false;
}

function pass(label, detail) {
  add('PASS', label, detail);
  return true;
}

function routeFile(route) {
  const normalized = String(route || '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return path.join(SITE_DIR, normalized, 'index.html');
}

function readRoute(route) {
  const file = routeFile(route);
  if (!fs.existsSync(file)) throw new Error(`${route}: rendered file missing at ${path.relative(ROOT, file)}`);
  const html = fs.readFileSync(file, 'utf8');
  return {
    route,
    file,
    html,
    dom: new JSDOM(html),
    document: new JSDOM(html).window.document
  };
}

function attr(document, selector, name) {
  return document.querySelector(selector)?.getAttribute(name) || '';
}

function text(document, selector) {
  return document.querySelector(selector)?.textContent?.trim() || '';
}

function jsonLdObjects(document) {
  const nodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  const values = [];
  for (const node of nodes) {
    try {
      const parsed = JSON.parse(node.textContent || 'null');
      if (Array.isArray(parsed)) values.push(...parsed);
      else if (parsed && typeof parsed === 'object') values.push(parsed);
    } catch (error) {
      values.push({ parseError: error?.message || 'invalid json' });
    }
  }
  return values;
}

function flattenJsonLdTypes(values) {
  const types = [];
  const seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    if (value['@type']) types.push(value['@type']);
    if (Array.isArray(value['@graph'])) value['@graph'].forEach(visit);
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') visit(child);
    }
  };
  values.forEach(visit);
  return types.flatMap((type) => Array.isArray(type) ? type : [type]).map(String);
}

function assertPublicRoute(route, lang, expectedDescriptionFragment = '') {
  const { document } = readRoute(route);
  const label = `Rendered public route ${route}`;
  const problems = [];
  if (attr(document, 'html', 'lang') !== lang) problems.push(`html lang is ${attr(document, 'html', 'lang') || 'missing'}`);
  const robots = attr(document, 'meta[name="robots"]', 'content');
  if (!/^index,follow/i.test(robots)) problems.push(`robots is ${robots || 'missing'}`);
  if (!attr(document, 'link[rel="canonical"]', 'href')) problems.push('canonical missing');
  for (const alternate of ['en', 'es', 'x-default']) {
    if (!document.querySelector(`link[rel="alternate"][hreflang="${alternate}"]`)) {
      problems.push(`hreflang ${alternate} missing`);
    }
  }
  if (!attr(document, 'meta[property="og:title"]', 'content')) problems.push('og:title missing');
  if (!attr(document, 'meta[name="twitter:card"]', 'content')) problems.push('twitter card missing');
  const description = attr(document, 'meta[name="description"]', 'content');
  if (expectedDescriptionFragment && !description.includes(expectedDescriptionFragment)) {
    problems.push(`description did not include ${expectedDescriptionFragment}`);
  }
  return problems.length ? fail(label, problems.join('; ')) : pass(label, `${lang} metadata, alternates, and social tags present`);
}

function assertPrivateRoute(route, lang) {
  const { document } = readRoute(route);
  const label = `Rendered private route ${route}`;
  const problems = [];
  if (attr(document, 'html', 'lang') !== lang) problems.push(`html lang is ${attr(document, 'html', 'lang') || 'missing'}`);
  const robots = attr(document, 'meta[name="robots"]', 'content');
  if (robots !== 'noindex,nofollow,noarchive') problems.push(`robots is ${robots || 'missing'}`);
  if (document.querySelector('script[type="application/ld+json"]')) problems.push('structured data should not render');
  return problems.length ? fail(label, problems.join('; ')) : pass(label, `${lang} noindex/private metadata present`);
}

function firstRenderedProductRoute(prefix = 'products') {
  const productsRoot = path.join(SITE_DIR, prefix);
  if (!fs.existsSync(productsRoot)) return '';
  const entries = fs.readdirSync(productsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(productsRoot, entry.name, 'index.html')))
    .map((entry) => entry.name)
    .sort();
  return entries.length ? `/${prefix}/${entries[0]}/` : '';
}

function assertProductRoute(route, lang) {
  if (!route) return fail('Rendered product metadata', 'no product route was rendered');
  const { document } = readRoute(route);
  const label = `Rendered product metadata ${route}`;
  const problems = [];
  if (attr(document, 'html', 'lang') !== lang) problems.push(`html lang is ${attr(document, 'html', 'lang') || 'missing'}`);
  const types = flattenJsonLdTypes(jsonLdObjects(document));
  if (!types.includes('Product')) problems.push('Product JSON-LD missing');
  if (!types.includes('Offer')) problems.push('Offer JSON-LD missing');
  if (!types.includes('BreadcrumbList')) problems.push('BreadcrumbList JSON-LD missing');
  if (!attr(document, 'meta[property="og:image"]', 'content')) problems.push('og:image missing');
  if (!attr(document, 'link[rel="canonical"]', 'href').includes(route)) problems.push('canonical does not match route');
  return problems.length ? fail(label, problems.join('; ')) : pass(label, `${lang} Product/Offer/Breadcrumb metadata present`);
}

function assertSitemapAndRobots() {
  const sitemapPath = path.join(SITE_DIR, 'sitemap.xml');
  const robotsPath = path.join(SITE_DIR, 'robots.txt');
  const problems = [];
  if (!fs.existsSync(sitemapPath)) problems.push('sitemap.xml missing');
  if (!fs.existsSync(robotsPath)) problems.push('robots.txt missing');
  const sitemap = fs.existsSync(sitemapPath) ? fs.readFileSync(sitemapPath, 'utf8') : '';
  const robots = fs.existsSync(robotsPath) ? fs.readFileSync(robotsPath, 'utf8') : '';
  for (const privateRoute of ['/admin/', '/es/admin/', '/orders/', '/order-success/']) {
    if (sitemap.includes(privateRoute)) problems.push(`sitemap includes ${privateRoute}`);
  }
  if (!sitemap.includes('xhtml:link rel="alternate"')) problems.push('sitemap hreflang alternates missing');
  if (!robots.includes('Disallow: /admin/')) problems.push('robots does not disallow /admin/');
  if (!robots.includes('Disallow: /es/admin/')) problems.push('robots does not disallow /es/admin/');
  if (robots.includes('Disallow: /orders/')) problems.push('robots blocks /orders/');
  if (robots.includes('Disallow: /order-success/')) problems.push('robots blocks /order-success/');
  if (!/^Sitemap:\s+https?:\/\/.+\/sitemap\.xml/m.test(robots)) problems.push('robots sitemap directive missing');
  return problems.length ? fail('Sitemap and robots release evidence', problems.join('; ')) : pass('Sitemap and robots release evidence', 'public/private crawl boundaries are correct');
}

function assertRouteCopy() {
  const checks = [
    ['/', 'Store home copy', 'Shop'],
    ['/es/', 'Spanish Store home copy', 'Categor'],
    ['/orders/', 'Order lookup copy', 'Find your order'],
    ['/es/orders/', 'Spanish order lookup copy', 'Busca tu pedido'],
    ['/order-success/', 'Order success copy', 'Order received'],
    ['/es/order-success/', 'Spanish order success copy', 'Pedido recibido']
  ];
  const problems = [];
  for (const [route, label, expected] of checks) {
    try {
      const routeText = text(readRoute(route).document, 'body');
      if (!routeText.includes(expected)) problems.push(`${label}: missing ${expected}`);
    } catch (error) {
      problems.push(error?.message || `${route} failed`);
    }
  }
  return problems.length ? fail('Rendered i18n route copy', problems.join('; ')) : pass('Rendered i18n route copy', 'English and Spanish route shells contain expected copy');
}

console.log('Store release i18n/SEO evidence');
console.log(`Generated: ${new Date().toISOString()}`);
console.log('');

run('npm', ['run', 'test:i18n'], 'I18N catalog completeness');
run('bundle', ['exec', 'jekyll', 'build', '--quiet'], 'Rendered Jekyll build');
run('npm', ['run', 'test:seo'], 'SEO audit');

try {
  assertPublicRoute('/', 'en', 'Dust Wave');
  assertPublicRoute('/es/', 'es', 'Dust Wave');
  assertPublicRoute('/terms/', 'en');
  assertPublicRoute('/es/terms/', 'es');
  assertPrivateRoute('/orders/', 'en');
  assertPrivateRoute('/es/orders/', 'es');
  assertPrivateRoute('/order-success/', 'en');
  assertPrivateRoute('/es/order-success/', 'es');
  assertPrivateRoute('/admin/', 'en');
  assertPrivateRoute('/es/admin/', 'es');
  assertProductRoute(firstRenderedProductRoute('products'), 'en');
  assertProductRoute(firstRenderedProductRoute('es/products'), 'es');
  assertRouteCopy();
  assertSitemapAndRobots();
} catch (error) {
  fail('Rendered i18n/SEO evidence', error?.message || String(error));
}

const failCount = results.filter((entry) => entry.status === 'FAIL').length;
const warnCount = results.filter((entry) => entry.status === 'WARN').length;
const skipCount = results.filter((entry) => entry.status === 'SKIP').length;
console.log('');
console.log(`Summary: ${failCount} fail, ${warnCount} warn, ${skipCount} skip`);
if (failCount) process.exit(1);

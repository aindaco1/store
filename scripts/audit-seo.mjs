#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const siteDir = process.env.SEO_SITE_DIR || path.join(repoRoot, '_site');
const configPath = path.join(repoRoot, '_config.yml');

function fail(message) {
  throw new Error(message);
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function siteBaseFromConfig() {
  const config = readFile(configPath);
  const platformSiteUrl = config.match(/^\s{2}site_url:\s*("?)(https?:\/\/[^\s"]+)\1\s*$/m);
  if (platformSiteUrl) return platformSiteUrl[2].replace(/\/+$/, '');
  const rootUrl = config.match(/^url:\s*("?)(https?:\/\/[^\s"]+)\1\s*$/m);
  if (rootUrl) return rootUrl[2].replace(/\/+$/, '');
  return 'https://shop.dustwave.xyz';
}

function walkFiles(dir, suffix, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, suffix, files);
    } else if (entry.isFile() && fullPath.endsWith(suffix)) {
      files.push(fullPath);
    }
  }
  return files;
}

function routeForHtml(filePath) {
  let route = `/${path.relative(siteDir, filePath).split(path.sep).join('/')}`;
  route = route.replace(/\/index\.html$/, '/').replace(/\.html$/, '/');
  return route === '/index.html' ? '/' : route;
}

function isAdminRoute(route) {
  return route === '/admin/' || route.startsWith('/admin/') || route === '/es/admin/' || route.startsWith('/es/admin/');
}

function isNoindex(document) {
  const robots = document.querySelector('meta[name="robots"]')?.getAttribute('content') || '';
  return /(^|,)\s*noindex\b/i.test(robots);
}

function parseJsonLd(document, route, errors) {
  const nodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  return nodes.flatMap((node) => {
    const payload = node.textContent.trim();
    if (!payload) return [];
    try {
      const parsed = JSON.parse(payload);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      errors.push(`${route}: invalid JSON-LD (${error.message})`);
      return [];
    }
  });
}

function flattenGraph(jsonLd) {
  return jsonLd.flatMap((item) => Array.isArray(item['@graph']) ? item['@graph'] : [item]);
}

function hasType(node, typeName) {
  const type = node && node['@type'];
  return Array.isArray(type) ? type.includes(typeName) : type === typeName;
}

function assertAbsoluteSiteUrl(value, siteBase, label, route, errors) {
  if (!value) {
    errors.push(`${route}: missing ${label}`);
    return null;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(`${route}: ${label} is not an absolute URL`);
    return null;
  }
  if (`${parsed.origin}` !== siteBase) {
    errors.push(`${route}: ${label} points outside ${siteBase}`);
  }
  if (parsed.search || parsed.hash) {
    errors.push(`${route}: ${label} should not include query strings or fragments`);
  }
  return parsed;
}

function parseProductFrontMatter() {
  const productDir = path.join(repoRoot, '_products');
  return fs.readdirSync(productDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const raw = readFile(path.join(productDir, name));
      const frontMatter = raw.match(/^---\n([\s\S]*?)\n---/);
      const status = frontMatter?.[1].match(/^status:\s*("?)([^"\n]+)\1\s*$/m)?.[2]?.trim() || 'active';
      const publicMatch = frontMatter?.[1].match(/^public:\s*(false|true)\s*$/m)?.[1];
      const isPublic = publicMatch === 'false' ? false : true;
      return {
        slug: name.replace(/\.md$/, ''),
        status,
        public: isPublic
      };
    });
}

if (!fs.existsSync(siteDir)) {
  fail(`Built site not found at ${siteDir}. Run bundle exec jekyll build first.`);
}

const htmlFiles = walkFiles(siteDir, '.html');
const sitemapPath = path.join(siteDir, 'sitemap.xml');
const robotsPath = path.join(siteDir, 'robots.txt');
const errors = [];
const sitemapLocs = new Set();
const seenCanonicals = new Map();

let siteBase = process.env.SEO_SITE_BASE || siteBaseFromConfig();
if (!process.env.SEO_SITE_BASE && fs.existsSync(robotsPath)) {
  const robotsSitemap = readFile(robotsPath).match(/^Sitemap:\s*(https?:\/\/[^\s]+)\/sitemap\.xml\s*$/m);
  if (robotsSitemap) siteBase = new URL(robotsSitemap[1]).origin;
}
if (!process.env.SEO_SITE_BASE && fs.existsSync(sitemapPath)) {
  const firstLoc = readFile(sitemapPath).match(/<loc>(https?:\/\/[^<]+)<\/loc>/);
  if (firstLoc) siteBase = new URL(firstLoc[1]).origin;
}

if (!fs.existsSync(sitemapPath)) errors.push('missing /sitemap.xml');
if (!fs.existsSync(robotsPath)) errors.push('missing /robots.txt');

let sitemapText = '';
if (fs.existsSync(sitemapPath)) {
  sitemapText = readFile(sitemapPath);
  if (!sitemapText.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"')) {
    errors.push('sitemap.xml: missing xhtml namespace for hreflang alternates');
  }
  const sitemapDocument = new JSDOM(sitemapText, { contentType: 'text/xml' }).window.document;
  for (const loc of Array.from(sitemapDocument.querySelectorAll('loc')).map((node) => node.textContent.trim())) {
    sitemapLocs.add(loc);
    assertAbsoluteSiteUrl(loc, siteBase, 'sitemap loc', '/sitemap.xml', errors);
    const url = new URL(loc);
    if (/^\/(?:admin|es\/admin|api|orders|es\/orders|order-success|es\/order-success)(?:\/|$)/.test(url.pathname)) {
      errors.push(`sitemap.xml: private route included (${url.pathname})`);
    }
  }
  if (!sitemapText.includes('xhtml:link rel="alternate"')) {
    errors.push('sitemap.xml: missing hreflang alternate links');
  }
}

if (fs.existsSync(robotsPath)) {
  const robotsText = readFile(robotsPath);
  for (const required of ['Disallow: /admin/', 'Disallow: /es/admin/', 'Disallow: /api/']) {
    if (!robotsText.includes(required)) errors.push(`robots.txt: missing ${required}`);
  }
  for (const removed of ['Disallow: /orders/', 'Disallow: /es/orders/', 'Disallow: /order-success/', 'Disallow: /es/order-success/']) {
    if (robotsText.includes(removed)) errors.push(`robots.txt: ${removed} blocks crawlers from seeing noindex`);
  }
  if (!robotsText.includes(`Sitemap: ${siteBase}/sitemap.xml`)) {
    errors.push('robots.txt: sitemap directive is missing or not canonical');
  }
}

for (const filePath of htmlFiles) {
  const route = routeForHtml(filePath);
  if (isAdminRoute(route)) continue;

  const dom = new JSDOM(readFile(filePath));
  const { document } = dom.window;
  const robotsMeta = document.querySelector('meta[name="robots"]');
  if (!robotsMeta) errors.push(`${route}: missing robots meta tag`);

  const noindex = isNoindex(document);
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';

  if (noindex) {
    if (canonical && sitemapLocs.has(canonical)) {
      errors.push(`${route}: noindex page appears in sitemap`);
    }
    continue;
  }

  const title = document.querySelector('title')?.textContent.trim() || '';
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || '';
  const lang = document.documentElement.getAttribute('lang') || '';
  const h1Count = document.querySelectorAll('h1').length;

  if (!title) errors.push(`${route}: missing title`);
  if (!description || description.length < 40) errors.push(`${route}: missing or thin meta description`);
  if (!lang) errors.push(`${route}: missing html lang`);
  if (h1Count < 1) errors.push(`${route}: missing h1`);

  const canonicalUrl = assertAbsoluteSiteUrl(canonical, siteBase, 'canonical', route, errors);
  if (canonicalUrl) {
    const previous = seenCanonicals.get(canonical);
    if (previous && previous !== route) {
      errors.push(`${route}: duplicate canonical also used by ${previous}`);
    } else {
      seenCanonicals.set(canonical, route);
    }
    if (!sitemapLocs.has(canonical)) {
      errors.push(`${route}: indexable canonical is missing from sitemap`);
    }
  }

  for (const [selector, label] of [
    ['meta[property="og:title"]', 'og:title'],
    ['meta[property="og:url"]', 'og:url'],
    ['meta[property="og:image"]', 'og:image'],
    ['meta[name="twitter:card"]', 'twitter:card'],
    ['meta[name="twitter:title"]', 'twitter:title']
  ]) {
    if (!document.querySelector(selector)?.getAttribute('content')) {
      errors.push(`${route}: missing ${label}`);
    }
  }

  const alternates = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]'));
  if (alternates.length > 0) {
    const alternateLangs = new Set(alternates.map((node) => node.getAttribute('hreflang')));
    if (!alternateLangs.has(lang)) errors.push(`${route}: hreflang alternates missing self language`);
    if (!alternateLangs.has('x-default')) errors.push(`${route}: hreflang alternates missing x-default`);
    for (const node of alternates) {
      assertAbsoluteSiteUrl(node.getAttribute('href'), siteBase, `hreflang ${node.getAttribute('hreflang')}`, route, errors);
    }
  }

  const graph = flattenGraph(parseJsonLd(document, route, errors));
  const organization = graph.find((node) => hasType(node, 'Organization'));
  if (!organization) {
    errors.push(`${route}: JSON-LD missing Organization`);
  } else {
    const returnPolicy = organization.hasMerchantReturnPolicy;
    if (!returnPolicy || typeof returnPolicy !== 'object') {
      errors.push(`${route}: Organization JSON-LD missing merchant return policy`);
    } else {
      for (const field of ['applicableCountry', 'returnPolicyCategory']) {
        if (!returnPolicy[field]) errors.push(`${route}: MerchantReturnPolicy missing ${field}`);
      }
      if (returnPolicy.returnPolicyCategory === 'https://schema.org/MerchantReturnFiniteReturnWindow' && !returnPolicy.merchantReturnDays) {
        errors.push(`${route}: finite MerchantReturnPolicy missing merchantReturnDays`);
      }
    }
  }

  const isProductRoute = /^\/(?:es\/)?products\//.test(route);
  if (isProductRoute) {
    const product = graph.find((node) => hasType(node, 'Product'));
    if (!product) {
      errors.push(`${route}: JSON-LD missing Product`);
    } else {
      for (const field of ['name', 'description', 'image', 'sku', 'brand', 'offers']) {
        if (!product[field]) errors.push(`${route}: Product JSON-LD missing ${field}`);
      }
      const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
      if (offers.length < 1) errors.push(`${route}: Product JSON-LD has no offers`);
      for (const offer of offers) {
        for (const field of ['price', 'priceCurrency', 'availability', 'itemCondition', 'seller']) {
          if (!offer?.[field]) errors.push(`${route}: Offer JSON-LD missing ${field}`);
        }
      }
    }
  } else if (!graph.some((node) => hasType(node, 'WebSite'))) {
    errors.push(`${route}: JSON-LD missing WebSite`);
  }
}

for (const product of parseProductFrontMatter()) {
  const productUrl = `${siteBase}/products/${product.slug}/`;
  const shouldIndex = product.public && ['active', 'sold_out'].includes(product.status);
  if (!shouldIndex && sitemapLocs.has(productUrl)) {
    errors.push(`sitemap.xml: archived/private product included (${product.slug})`);
  }
  if (shouldIndex && !sitemapLocs.has(productUrl)) {
    errors.push(`sitemap.xml: active public product missing (${product.slug})`);
  }
}

if (errors.length > 0) {
  console.error('SEO audit failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`SEO audit passed for ${htmlFiles.filter((file) => !isAdminRoute(routeForHtml(file))).length} non-admin HTML pages and ${sitemapLocs.size} sitemap URLs.`);

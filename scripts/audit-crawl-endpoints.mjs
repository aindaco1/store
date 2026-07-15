#!/usr/bin/env node

import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'https://shop.dustwave.xyz';
const INSPECTION_USER_AGENT = 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)';
const PRIVATE_PATH_PATTERNS = [
  /^\/(?:es\/)?admin(?:\/|$)/,
  /^\/(?:es\/)?api(?:\/|$)/,
  /^\/(?:es\/)?orders(?:\/|$)/,
  /^\/(?:es\/)?order-success(?:\/|$)/
];

function normalizeBaseUrl(value) {
  const parsed = new URL(String(value || DEFAULT_BASE_URL));
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Crawl audit base must be an HTTPS origin without a path, query, or fragment.');
  }
  return parsed.origin;
}

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function responseType(response) {
  return String(response.headers.get('content-type') || '').toLowerCase();
}

function looksLikeChallenge(body) {
  return /just a moment|challenge-platform|__cf_chl/i.test(String(body || ''));
}

function looksLikeHtml(body) {
  return /<html|<!doctype html/i.test(String(body || ''));
}

function isPrivatePath(pathname) {
  return PRIVATE_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

function validateSitemapUrls(values, { baseUrl, label = 'sitemap', entryLabel = 'loc' }) {
  const errors = [];
  const urls = [];
  const seen = new Set();
  for (const rawValue of values) {
    const value = String(rawValue || '').trim();
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      errors.push(`${label} ${entryLabel} is not an absolute URL: ${value || 'empty'}`);
      continue;
    }
    if (parsed.origin !== baseUrl) errors.push(`${label} ${entryLabel} points outside ${baseUrl}: ${value}`);
    if (parsed.search || parsed.hash) errors.push(`${label} ${entryLabel} has a query or fragment: ${value}`);
    if (isPrivatePath(parsed.pathname)) errors.push(`${label} contains a private route: ${parsed.pathname}`);
    if (seen.has(value)) errors.push(`${label} contains duplicate ${entryLabel}: ${value}`);
    seen.add(value);
    urls.push(value);
  }
  return { errors, urls };
}

export function validateSitemapResponse({ response, body, baseUrl }) {
  const errors = [];
  const urls = [];
  if (response.status !== 200) errors.push(`sitemap returned HTTP ${response.status}`);
  if (!/^application\/(?:[a-z0-9.+-]+\+)?xml(?:;|$)|^text\/xml(?:;|$)/i.test(responseType(response))) {
    errors.push(`sitemap content type is ${responseType(response) || 'missing'}`);
  }
  if (String(body || '').charCodeAt(0) === 0xfeff) errors.push('sitemap starts with a UTF-8 BOM');
  if (!String(body || '').startsWith('<?xml')) errors.push('sitemap does not start with its XML declaration');
  if (looksLikeHtml(body) || looksLikeChallenge(body)) errors.push('sitemap response looks like HTML or a bot challenge');
  if (!/<urlset\b[^>]*xmlns=["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["'][^>]*>/i.test(body)) {
    errors.push('sitemap is missing the canonical urlset namespace');
  }
  if (!/<\/urlset>\s*$/i.test(body)) errors.push('sitemap does not end with a closing urlset element');

  const locMatches = Array.from(String(body || '').matchAll(/<loc>([\s\S]*?)<\/loc>/gi));
  if (locMatches.length === 0) errors.push('sitemap contains no loc entries');
  const validatedUrls = validateSitemapUrls(
    locMatches.map((match) => decodeXmlText(match[1])),
    { baseUrl }
  );
  errors.push(...validatedUrls.errors);
  urls.push(...validatedUrls.urls);

  const lastmods = Array.from(String(body || '').matchAll(/<lastmod>([\s\S]*?)<\/lastmod>/gi));
  for (const match of lastmods) {
    const value = decodeXmlText(match[1]).trim();
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) errors.push(`sitemap contains invalid lastmod: ${value || 'empty'}`);
    if (Number.isFinite(timestamp) && timestamp > Date.now() + 5 * 60 * 1000) {
      errors.push(`sitemap contains future lastmod: ${value}`);
    }
  }
  return { errors, urls };
}

export function validateTextSitemapResponse({ response, body, baseUrl }) {
  const errors = [];
  const rawBody = String(body || '').replace(/\r\n/g, '\n');
  if (response.status !== 200) errors.push(`text sitemap returned HTTP ${response.status}`);
  if (!responseType(response).startsWith('text/plain')) {
    errors.push(`text sitemap content type is ${responseType(response) || 'missing'}`);
  }
  if (rawBody.charCodeAt(0) === 0xfeff) errors.push('text sitemap starts with a UTF-8 BOM');
  if (looksLikeHtml(rawBody) || looksLikeChallenge(rawBody)) {
    errors.push('text sitemap response looks like HTML or a bot challenge');
  }

  const lines = rawBody.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0 || lines.every((line) => line.trim() === '')) {
    errors.push('text sitemap contains no URLs');
  }
  if (lines.some((line) => line === '' || line !== line.trim())) {
    errors.push('text sitemap must contain exactly one unpadded URL per non-empty line');
  }
  const validatedUrls = validateSitemapUrls(lines, {
    baseUrl,
    label: 'text sitemap',
    entryLabel: 'URL'
  });
  errors.push(...validatedUrls.errors);
  return { errors, urls: validatedUrls.urls };
}

export function validateRobotsResponse({ response, body, baseUrl }) {
  const errors = [];
  if (response.status !== 200) errors.push(`robots.txt returned HTTP ${response.status}`);
  if (!responseType(response).startsWith('text/plain')) {
    errors.push(`robots.txt content type is ${responseType(response) || 'missing'}`);
  }
  if (looksLikeHtml(body) || looksLikeChallenge(body)) errors.push('robots.txt response looks like HTML or a bot challenge');
  if (!String(body || '').split(/\r?\n/).some((line) => line.trim() === `Sitemap: ${baseUrl}/sitemap.xml`)) {
    errors.push('robots.txt does not advertise the canonical sitemap URL');
  }
  return errors;
}

async function fetchText(fetchFn, url, userAgent) {
  const response = await fetchFn(url, {
    redirect: 'manual',
    headers: {
      accept: '*/*',
      'user-agent': userAgent
    }
  });
  return { response, body: await response.text() };
}

async function auditOnce({ baseUrl, fetchFn }) {
  const errors = [];
  const ordinary = await fetchText(fetchFn, `${baseUrl}/sitemap.xml`, 'Store crawl endpoint audit/1.1');
  const inspection = await fetchText(fetchFn, `${baseUrl}/sitemap.xml`, INSPECTION_USER_AGENT);
  const sitemap = validateSitemapResponse({ ...ordinary, baseUrl });
  errors.push(...sitemap.errors);
  const inspectionValidation = validateSitemapResponse({ ...inspection, baseUrl });
  errors.push(...inspectionValidation.errors.map((error) => `inspection user agent: ${error}`));
  if (ordinary.body !== inspection.body) errors.push('sitemap body differs for the Inspection Tool user agent');

  const textOrdinary = await fetchText(fetchFn, `${baseUrl}/sitemap.txt`, 'Store crawl endpoint audit/1.1');
  const textInspection = await fetchText(fetchFn, `${baseUrl}/sitemap.txt`, INSPECTION_USER_AGENT);
  const textSitemap = validateTextSitemapResponse({ ...textOrdinary, baseUrl });
  errors.push(...textSitemap.errors);
  const textInspectionValidation = validateTextSitemapResponse({ ...textInspection, baseUrl });
  errors.push(...textInspectionValidation.errors.map((error) => `inspection user agent: ${error}`));
  if (textOrdinary.body !== textInspection.body) {
    errors.push('text sitemap body differs for the Inspection Tool user agent');
  }
  if (JSON.stringify(sitemap.urls) !== JSON.stringify(textSitemap.urls)) {
    errors.push('XML and text sitemap URL lists differ');
  }

  const robots = await fetchText(fetchFn, `${baseUrl}/robots.txt`, INSPECTION_USER_AGENT);
  errors.push(...validateRobotsResponse({ ...robots, baseUrl }));

  const publicResults = await Promise.all(sitemap.urls.map(async (url) => {
    try {
      const { response, body } = await fetchText(fetchFn, url, INSPECTION_USER_AGENT);
      const routeErrors = [];
      if (response.status !== 200) routeErrors.push(`HTTP ${response.status}`);
      if (!responseType(response).startsWith('text/html')) routeErrors.push(`content type ${responseType(response) || 'missing'}`);
      if (looksLikeChallenge(body) && (!/<main\b/i.test(body) || !/<link\b[^>]*rel=["']canonical["']/i.test(body))) {
        routeErrors.push('blocking HTML challenge response');
      }
      return routeErrors.map((error) => `${url}: ${error}`);
    } catch (error) {
      return [`${url}: ${error?.message || String(error)}`];
    }
  }));
  errors.push(...publicResults.flat());
  return { errors, urlCount: sitemap.urls.length };
}

export async function auditCrawlEndpoints(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.SITE_BASE || DEFAULT_BASE_URL);
  const fetchFn = options.fetchFn || globalThis.fetch;
  const attempts = Math.max(1, Number(options.attempts || 1));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs || 5_000));
  let result = { errors: ['crawl audit did not run'], urlCount: 0 };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      result = await auditOnce({ baseUrl, fetchFn });
    } catch (error) {
      result = { errors: [error?.message || String(error)], urlCount: 0 };
    }
    if (result.errors.length === 0 || attempt === attempts) break;
    if (typeof options.onRetry === 'function') options.onRetry({ attempt, attempts, errors: result.errors });
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return { baseUrl, ...result };
}

function argValue(name, fallback = '') {
  const exact = process.argv.indexOf(name);
  if (exact >= 0 && process.argv[exact + 1]) return process.argv[exact + 1];
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

async function main() {
  const result = await auditCrawlEndpoints({
    baseUrl: argValue('--base', process.env.SITE_BASE || DEFAULT_BASE_URL),
    attempts: Number(argValue('--attempts', '1')),
    retryDelayMs: Number(argValue('--retry-delay-ms', '5000')),
    onRetry: ({ attempt, attempts, errors }) => {
      console.warn(`Crawl endpoint audit attempt ${attempt}/${attempts} failed: ${errors.join('; ')}`);
    }
  });
  if (result.errors.length > 0) {
    console.error(`Crawl endpoint audit failed for ${result.baseUrl}:`);
    result.errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  console.log(`Crawl endpoint audit passed for ${result.baseUrl} (${result.urlCount} sitemap URLs).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main();
}

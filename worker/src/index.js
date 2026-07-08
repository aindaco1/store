/**
 * Store Worker
 *
 * Routes:
 *   POST /api/cart/validate      - Validate a first-party Store cart
 *   POST /api/checkout/intent    - Create a Store Stripe Checkout intent
 *   GET  /api/orders/:token      - Read Store order details
 *   POST /api/orders/lookup      - Send a customer Store order lookup link
 *   GET  /api/orders/lookup      - Consume a one-time Store order lookup link
 *   POST /shipping/quote         - Quote Store shipping
 *   POST /tax/quote              - Quote Store tax
 *   GET  /abandoned-cart/unsubscribe - Suppress Store checkout reminder emails
 *   GET  /abandoned-cart/resume  - Restore a signed Store checkout reminder snapshot
 *   POST /webhooks/stripe        - Handle Stripe webhooks
 *   GET  /admin/session          - Read current browser admin session
 *   GET  /admin/dashboard/summary - Read Store admin summary
 *   GET  /admin/audit.csv        - Download recent admin mutation audit CSV
 *   GET  /admin/settings         - Read Store settings/config snapshot
 *   POST /admin/settings/preview - Validate admin settings changes
 *   POST /admin/settings/publish - Publish admin settings changes
 *   GET  /admin/store/health     - Read Store launch readiness checks
 *   GET  /admin/plan-usage       - Read provider quota and plan usage
 *   GET  /admin/store/analytics  - Read Store order analytics
 *   GET  /admin/store/marketing/abandoned-checkout/health - Read checkout reminder health
 *   POST /admin/store/marketing/abandoned-checkout/suppression - Suppress checkout reminders
 *   GET  /admin/store/orders     - Read Store order fulfillment rows
 *   GET  /admin/store/orders.csv - Download Store order fulfillment CSV
 *   GET  /admin/store/attendees.csv - Download Store ticket/RSVP attendee CSV
 *   GET  /admin/store/reconciliation.csv - Download Store order reconciliation CSV
 *   POST /admin/store/orders/import-snipcart - Import legacy Snipcart orders into production
 *   POST /admin/store/orders/download-access - Revoke or refresh Store digital download access
 *   POST /admin/store/orders/check-in - Mark Store ticket/RSVP check-in state
 *   GET  /admin/store/products   - Read Store catalog products and variants
 *   GET  /admin/store/products/media - Read reusable Store product media references
 *   GET  /admin/store/products/address-lookup - Look up a public event address
 *   POST /admin/store/products/preview - Render a Store product editor preview
 *   POST /admin/store/products/publish - Publish Store product catalog edits
 *   POST /admin/store/products/bulk-publish - Publish bulk Store product catalog edits
 *   POST /admin/store/products/order - Publish Store product display order
 *   GET  /admin/store/coupons   - Read Store coupon codes
 *   POST /admin/store/coupons   - Create or update Store coupon codes
 *   POST /admin/store/coupons/delete - Delete Store coupon codes
 *   GET  /admin/store/downloads  - Verify Store digital download readiness
 *   POST /admin/store/downloads/upload - Upload or replace Store download R2 objects
 *   POST /admin/store/downloads/create - Upload a Store download library file
 *   POST /admin/store/downloads/delete - Delete a Store download library file
 *   GET  /admin/store/inventory  - Read Store catalog inventory
 *   POST /admin/store/inventory  - Override or reset Store inventory baselines
 *   GET  /admin/add-ons/inventory - Read platform add-on inventory
 *   POST /admin/add-ons/inventory - Override or reset platform add-on inventory
 *   POST /admin/rebuild          - Trigger GitHub Pages rebuild
 *   GET  /admin/cron/status      - Check cron heartbeat status
 */

import { sendAdminUserCreatedEmail, sendStoreAbandonedCartEmail, sendStoreEventReminderEmail, sendStoreOrderAdminNotificationEmail, sendStoreOrderEmail, sendStoreOrderLookupEmail } from './email.js';
import { verifyStripeSignature, createStripeClient } from './stripe.js';
import { getAddOns, getAddOnInventorySnapshot, mutateAddOnInventoryOverride } from './add-ons.js';
import { getStoreCatalogSnapshot, normalizeStoreCatalogSnapshot, validateStoreOrderDraft } from './catalog.js';
import { applyStoreCouponCode, getValidationTaxableSubtotalCents, loadStoreCoupons, saveStoreCoupons, upsertStoreCoupon } from './coupons.js';
import { buildStoreOrderDraft, getStoreOrderStorageKey, hashStoreOrderDraft, STORE_ORDER_DRAFT_TTL_SECONDS, STORE_ORDER_DRAFT_VERSION, STORE_ORDER_STATUS_CONFIRMED, STORE_ORDER_STATUS_DRAFT, STORE_ORDER_STATUS_PAYMENT_FAILED, STORE_ORDER_STATUS_PAYMENT_PENDING } from './orders.js';
import { getGitHubTextFile, putGitHubBase64File, putGitHubTextFile, putGitHubTextFiles, triggerMediaOptimization, triggerSiteRebuild } from './github.js';
import { getScopedConsole } from './logger.js';
import { isValidSlug, isValidEmail, SECURITY_HEADERS, getAllowedOrigin } from './validation.js';
import { verifyTurnstile } from './turnstile.js';
import {
  DEFAULT_SITE_BASE,
  getCheckoutProvider,
  getCheckoutUiMode,
  getSiteBase,
  getWorkerBase,
} from './provider-config.js';
import { normalizeShippingDestination, quoteStoreShipment } from './shipping.js';
import { normalizeTaxDestination, quoteTax } from './tax.js';
import { parseSnipcartOrdersCsv, SNIPCART_IMPORT_MAX_CSV_BYTES } from './snipcart-import.js';
import {
  getPlatformDateKey,
  getPlatformTimeZone,
  getTimeZoneOptions,
  isSupportedTimeZone,
} from './timezone.js';
import {
  adminCorsResponse,
  createAdminLoginUrl,
  getEffectiveAdminUsers,
  handleAdminAuthExchange,
  handleAdminAuthStart,
  handleAdminLogout,
  handleAdminSession,
  requireAdminSession,
  saveStoredAdminUsers,
  verifyAdminAuthStartChallenge
} from './admin-auth.js';
import QRCode from 'qrcode';
export { StoreInventoryCoordinator } from './tier-inventory-do.js';

let console = globalThis.console;

function configureWorkerLogging(env) {
  console = getScopedConsole(env, 'index');
}

function isTruthyWorkerEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isLocalAdminRepoWritesEnabled(env = {}) {
  return String(env.APP_MODE || '').trim().toLowerCase() === 'test' &&
    isTruthyWorkerEnv(env.ADMIN_LOCAL_REPO_WRITES_ENABLED);
}

function adminRepoMode(env = {}) {
  return isLocalAdminRepoWritesEnabled(env) ? 'local' : 'github';
}

function localAdminRepoServiceBase(env = {}) {
  if (!isLocalAdminRepoWritesEnabled(env)) return '';
  const raw = String(env.ADMIN_LOCAL_REPO_SERVICE || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(hostname)) return '';
    return url.toString().replace(/\/$/, '');
  } catch (_error) {
    return '';
  }
}

async function callLocalAdminRepoService(env, pathname, body = {}) {
  const base = localAdminRepoServiceBase(env);
  if (!base) {
    return {
      ok: false,
      status: 503,
      error: 'Local repository service is not configured. Start dev with ./scripts/dev.sh so local admin edits can write to this checkout.',
      code: 'local_repo_service_not_configured'
    };
  }
  const token = String(env.ADMIN_LOCAL_REPO_TOKEN || env.ADMIN_SECRET || '').trim();
  if (!token) {
    return { ok: false, status: 503, error: 'Local repository token is not configured.', code: 'local_repo_token_missing' };
  }
  let response = null;
  try {
    response = await fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: error?.message || 'Local repository service is unreachable.',
      code: 'local_repo_service_unreachable'
    };
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    return {
      ok: false,
      status: response.status,
      error: data?.error || `Local repository service error: ${response.status}`,
      code: data?.code || 'local_repo_service_failed'
    };
  }
  return { ok: true, ...data };
}

async function readAdminRepoTextFile(env, filePath) {
  if (isLocalAdminRepoWritesEnabled(env)) {
    return callLocalAdminRepoService(env, '/read', { path: filePath });
  }
  return getGitHubTextFile(env, filePath);
}

async function putAdminRepoTextFile(env, filePath, content, message, sha, options = {}) {
  if (isLocalAdminRepoWritesEnabled(env)) {
    return callLocalAdminRepoService(env, '/write', {
      path: filePath,
      content,
      message,
      overwrite: options.overwrite === true || Boolean(sha)
    });
  }
  return putGitHubTextFile(env, filePath, content, message, sha);
}

async function putAdminRepoTextFiles(env, files, message, options = {}) {
  const normalizedFiles = (Array.isArray(files) ? files : [])
    .map((file) => ({
      path: String(file?.path || file?.filePath || '').trim(),
      content: String(file?.content || ''),
      expectedSha: String(file?.expectedSha || file?.sha || '').trim()
    }))
    .filter((file) => file.path);

  if (normalizedFiles.length === 0) {
    return { ok: true, skipped: true, reason: 'No files to update', paths: [] };
  }

  if (isLocalAdminRepoWritesEnabled(env)) {
    const results = [];
    for (const file of normalizedFiles) {
      const result = await callLocalAdminRepoService(env, '/write', {
        path: file.path,
        content: file.content,
        message,
        overwrite: options.overwrite === true || Boolean(file.expectedSha)
      });
      if (!result.ok) {
        return {
          ok: false,
          status: result.status || 502,
          path: file.path,
          error: result.error || `Unable to write ${file.path}`,
          code: result.code || 'local_repo_batch_write_failed',
          results
        };
      }
      results.push({ path: file.path, ...result });
    }
    return {
      ok: true,
      mode: 'local',
      paths: normalizedFiles.map((file) => file.path),
      results,
      updated: results.length
    };
  }

  return putGitHubTextFiles(env, normalizedFiles, message);
}

async function putAdminRepoBase64File(env, filePath, base64Content, message, sha = undefined, options = {}) {
  if (isLocalAdminRepoWritesEnabled(env)) {
    return callLocalAdminRepoService(env, '/write-base64', {
      path: filePath,
      content: base64Content,
      message,
      overwrite: options.overwrite === true || Boolean(sha)
    });
  }
  return putGitHubBase64File(env, filePath, base64Content, message, sha);
}

async function triggerAdminRepoRebuild(env, reason = 'manual') {
  if (isLocalAdminRepoWritesEnabled(env)) {
    return { triggered: false, mode: 'local', reason: 'Local repository write saved. Jekyll will rebuild in local dev.' };
  }
  return triggerSiteRebuild(env, reason);
}

async function triggerAdminMediaOptimization(env, options = {}) {
  if (isLocalAdminRepoWritesEnabled(env)) {
    return { triggered: false, mode: 'local', reason: 'Local media upload saved. Media optimization runs in the repository workflow.' };
  }
  return triggerMediaOptimization(env, options);
}

function adminRepoDeployNotice(env, githubNotice, localNotice) {
  return isLocalAdminRepoWritesEnabled(env) ? localNotice : githubNotice;
}

const STRIPE_CUSTOM_UI_MODE_API_VERSION = '2026-02-25.clover';
const PRIVATE_NO_STORE_CACHE_CONTROL = 'private, no-store, max-age=0';
const DEFAULT_I18N_LANG = 'en';
const STORE_ADMIN_SCOPE = 'store';
const STORE_INVENTORY_OVERRIDES_KEY = 'store-inventory-overrides:v1';
const ADMIN_STORE_MARKETING_REFERRALS_KEY = 'admin-store-marketing-referrals:v1';
const ADMIN_STORE_MARKETING_DRAFT_KEY = 'admin-store-marketing-draft:builder';
const ADMIN_STORE_MARKETING_DRAFT_TTL_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_STORE_ORDER_SCAN_CACHE_TTL_MS = 20 * 1000;
const ABANDONED_CART_PREFIX = 'abandoned-cart:';
const ABANDONED_CART_RESUME_PREFIX = 'abandoned-cart-resume:';
const ABANDONED_CART_SENT_PREFIX = 'abandoned-cart-sent:';
const ABANDONED_CART_SUPPRESSED_PREFIX = 'abandoned-cart-suppressed:';
const ABANDONED_CART_QUEUE_STATE_KEY = 'abandoned-cart-queue:v1';
const ABANDONED_CART_HEALTH_KEY = 'abandoned-cart-health:v1';
const ABANDONED_CART_TOKEN_SCOPE_UNSUBSCRIBE = 'abandoned-cart-unsubscribe';
const ABANDONED_CART_TOKEN_SCOPE_RESUME = 'abandoned-cart-resume';
const ABANDONED_CART_TTL_SECONDS = 14 * 24 * 60 * 60;
const ABANDONED_CART_SENT_TTL_SECONDS = 400 * 24 * 60 * 60;
const ABANDONED_CART_SUPPRESSION_TTL_SECONDS = 400 * 24 * 60 * 60;
const ABANDONED_CART_DEFAULT_DELAY_MS = 6 * 60 * 60 * 1000;
const ABANDONED_CART_DEFAULT_BATCH_SIZE = 10;
const STORE_EVENT_REMINDER_PREFIX = 'store-event-reminder:';
const STORE_EVENT_REMINDER_SENT_PREFIX = 'store-event-reminder-sent:';
const STORE_EVENT_REMINDER_QUEUE_STATE_KEY = 'store-event-reminder-queue:v1';
const STORE_EVENT_REMINDER_TTL_SECONDS = 400 * 24 * 60 * 60;
const STORE_EVENT_REMINDER_DEFAULT_BATCH_SIZE = 20;
const STORE_EVENT_REMINDER_OFFSETS = [
  { key: '1w', label: '1 week before', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '1d', label: '1 day before', ms: 24 * 60 * 60 * 1000 },
  { key: '6h', label: '6 hours before', ms: 6 * 60 * 60 * 1000 },
  { key: '1h', label: '1 hour before', ms: 60 * 60 * 1000 }
];
const IDLE_QUEUE_RECHECK_TTL_SECONDS = 60 * 60;
const ADMIN_STORE_PRODUCT_STATUSES = new Set(['active', 'draft', 'archived', 'sold_out']);
const ADMIN_STORE_TAX_CATEGORIES = new Set(['admission', 'digital', 'exempt', 'standard']);
const ADMIN_STORE_CONTENT_ALLOWED_BLOCK_TYPES = new Set([
  'text',
  'video',
  'image',
  'gallery',
  'audio',
  'embed',
  'divider',
  'quote'
]);
const ADMIN_STORE_CONTENT_ALLOWED_EMBED_PROVIDERS = new Set(['spotify', 'youtube', 'vimeo']);
const ADMIN_STORE_CONTENT_ALLOWED_VIDEO_PROVIDERS = new Set(['youtube', 'vimeo', 'local']);
const ADMIN_STORE_CONTENT_ALLOWED_ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);
const ADMIN_STORE_CONTENT_ALLOWED_GALLERY_LAYOUTS = new Set(['grid', 'carousel']);
const ADMIN_STORE_CONTENT_ALLOWED_GALLERY_CAPTION_STYLES = new Set(['inline', 'overlay']);
const ADMIN_STORE_CONTENT_MAX_TEXT_LENGTH = 8000;
const ADMIN_STORE_CONTENT_MAX_BLOCKS = 40;
const ADMIN_STORE_CONTENT_MAX_GALLERY_IMAGES = 12;
const PLATFORM_SCHEDULER_CRON = '* * * * *';
const PLATFORM_SCHEDULER_HEARTBEAT_INTERVAL_MINUTES = 60;
const MAX_STANDARD_JSON_BODY_BYTES = 64 * 1024;
const MAX_ADMIN_LOGO_UPLOAD_BODY_BYTES = 1024 * 1024;
const MAX_ADMIN_IMAGE_UPLOAD_BODY_BYTES = 12 * 1024 * 1024;
const MAX_ADMIN_AUDIO_UPLOAD_BODY_BYTES = 36 * 1024 * 1024;
const MAX_ADMIN_VIDEO_UPLOAD_BODY_BYTES = 140 * 1024 * 1024;
const MAX_ADMIN_STORE_DOWNLOAD_UPLOAD_BODY_BYTES = 140 * 1024 * 1024;
const MAX_ADMIN_STORE_DOWNLOAD_FILE_BYTES = 100 * 1024 * 1024;
const MAX_ADMIN_SNIPCART_IMPORT_BODY_BYTES = 2 * 1024 * 1024;
const MAX_STRIPE_WEBHOOK_BODY_BYTES = 256 * 1024;
const RATELIMIT_REQUIRED_ERROR = 'Rate limit storage not configured';
const OBSERVABILITY_RETENTION_SECONDS = 14 * 24 * 60 * 60;
const OBSERVABILITY_RECENT_EVENT_LIMIT = 25;
const OBSERVABILITY_MAX_DAYS = 7;
const DEFAULT_OBSERVABILITY_SAMPLE_RATE = 0.1;
const ADMIN_AUDIT_EVENT_TTL_SECONDS = 400 * 24 * 60 * 60;
const MAX_ADMIN_AUDIT_EXPORT_EVENTS = 2000;
const ADMIN_STORE_ORDER_INDEX_KEY = 'admin-store-orders:index:v1';
const ADMIN_STORE_ORDER_INDEX_VERSION = 1;
const ADMIN_STORE_ORDER_INDEX_TTL_SECONDS = 10 * 60;
const ADMIN_STORE_ORDER_INDEX_MAX_AGE_MS = ADMIN_STORE_ORDER_INDEX_TTL_SECONDS * 1000;

let adminStoreOrderScanCache = null;
let adminStoreOrderIndexCache = null;

function invalidateAdminStoreOrderScanCache(env = null, ctx = null) {
  adminStoreOrderScanCache = null;
  adminStoreOrderIndexCache = null;
  if (env?.STORE_STATE?.delete) {
    queueBackgroundTask(
      ctx,
      env.STORE_STATE.delete(ADMIN_STORE_ORDER_INDEX_KEY),
      'admin Store order index invalidation'
    );
  }
}





function normalizeSvgText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function estimateSvgTextWidth(value, fontSize = 16, fontWeight = 400) {
  const weightScale = Number(fontWeight) >= 800 ? 1.08 : Number(fontWeight) >= 600 ? 1.04 : 1;
  let units = 0;
  for (const char of Array.from(normalizeSvgText(value))) {
    if (char === ' ') {
      units += 0.33;
    } else if (/["'.,:;!|()[\]{}]/.test(char)) {
      units += 0.28;
    } else if (/[ijlrtf]/.test(char)) {
      units += 0.34;
    } else if (/[MW@#%&]/.test(char)) {
      units += 0.9;
    } else if (/[A-Z0-9]/.test(char)) {
      units += 0.66;
    } else {
      units += 0.56;
    }
  }
  return units * Number(fontSize || 16) * weightScale;
}

function splitSvgLongWord(word, maxWidth, fontSize, fontWeight) {
  const chunks = [];
  let current = '';
  for (const char of Array.from(word)) {
    const candidate = `${current}${char}`;
    if (current && estimateSvgTextWidth(candidate, fontSize, fontWeight) > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapSvgTextLines(value, { maxWidth = 500, fontSize = 16, fontWeight = 400 } = {}) {
  const text = normalizeSvgText(value);
  if (!text) return [];
  const lines = [];
  let current = '';
  const words = text.split(' ');

  for (const word of words) {
    const chunks = estimateSvgTextWidth(word, fontSize, fontWeight) > maxWidth
      ? splitSvgLongWord(word, maxWidth, fontSize, fontWeight)
      : [word];

    for (const chunk of chunks) {
      const candidate = current ? `${current} ${chunk}` : chunk;
      if (current && estimateSvgTextWidth(candidate, fontSize, fontWeight) > maxWidth) {
        lines.push(current);
        current = chunk;
      } else {
        current = candidate;
      }
    }
  }

  if (current) lines.push(current);
  return lines;
}

function truncateSvgTextToWidth(value, maxWidth, fontSize, fontWeight) {
  const text = normalizeSvgText(value);
  if (!text || estimateSvgTextWidth(text, fontSize, fontWeight) <= maxWidth) return text;
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  let best = '…';
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${chars.slice(0, mid).join('').trimEnd()}…`;
    if (estimateSvgTextWidth(candidate, fontSize, fontWeight) <= maxWidth) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function fitSvgTextLines(value, {
  maxWidth = 500,
  maxLines = 2,
  fontSizes = [32],
  fontWeight = 400
} = {}) {
  const sizes = fontSizes.length ? fontSizes : [32];
  for (const fontSize of sizes) {
    const lines = wrapSvgTextLines(value, { maxWidth, fontSize, fontWeight });
    if (lines.length <= maxLines) {
      return { lines, fontSize, truncated: false };
    }
  }

  const fontSize = sizes[sizes.length - 1];
  const lines = wrapSvgTextLines(value, { maxWidth, fontSize, fontWeight });
  if (lines.length <= maxLines) return { lines, fontSize, truncated: false };
  const visibleLines = lines.slice(0, maxLines);
  const overflow = lines.slice(maxLines).join(' ');
  const lastIndex = Math.max(0, visibleLines.length - 1);
  visibleLines[lastIndex] = truncateSvgTextToWidth(
    `${visibleLines[lastIndex] || ''} ${overflow}`.trim(),
    maxWidth,
    fontSize,
    fontWeight
  );
  return { lines: visibleLines, fontSize, truncated: true };
}

function renderSvgTextBlock(value, {
  x = 0,
  y = 0,
  maxWidth = 500,
  maxLines = 2,
  fontSizes = [24],
  fontWeight = 400,
  fill = '#101215',
  lineHeightFactor = 1.18,
  letterSpacing = ''
} = {}) {
  const fit = fitSvgTextLines(value, { maxWidth, maxLines, fontSizes, fontWeight });
  if (!fit.lines.length) {
    return { markup: '', bottomY: y, lines: [], fontSize: fontSizes[fontSizes.length - 1] || 24 };
  }
  const lineHeight = Math.round(fit.fontSize * lineHeightFactor);
  const letterSpacingAttr = letterSpacing ? ` letter-spacing="${escapeXml(letterSpacing)}"` : '';
  const tspans = fit.lines.map((line, index) => (
    `<tspan x="${x}" y="${y + (index * lineHeight)}">${escapeXml(line)}</tspan>`
  )).join('\n    ');
  return {
    markup: `<text font-family="Inter, Arial, sans-serif" font-size="${fit.fontSize}" font-weight="${fontWeight}" fill="${fill}"${letterSpacingAttr}>\n    ${tspans}\n  </text>`,
    bottomY: y + ((fit.lines.length - 1) * lineHeight),
    lines: fit.lines,
    fontSize: fit.fontSize,
    truncated: fit.truncated
  };
}

















// SEC-006: Timing-safe string comparison to prevent timing attacks
function timingSafeEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
  }

function getSiteOrigin(env) {
  try {
    return new URL(String(env?.SITE_BASE || '')).origin;
  } catch {
    return '';
  }
}

function normalizePreferredLang(value, fallback = DEFAULT_I18N_LANG) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized) ? normalized : fallback;
}

function getLocalizedPath(path, preferredLang = DEFAULT_I18N_LANG) {
  const lang = normalizePreferredLang(preferredLang);
  const normalizedPath = String(path || '/').startsWith('/') ? String(path || '/') : `/${String(path || '')}`;
  return lang === DEFAULT_I18N_LANG ? normalizedPath : `/${lang}${normalizedPath}`;
}

function getLocalizedSiteUrl(env, path, preferredLang = DEFAULT_I18N_LANG) {
  return `${String(env.SITE_BASE || '').replace(/\/+$/, '')}${getLocalizedPath(path, preferredLang)}`;
}

function isTrustedSiteOriginRequest(request, env) {
  const expectedOrigin = getSiteOrigin(env);
  if (!expectedOrigin) return true;

  const secFetchSite = String(request.headers.get('Sec-Fetch-Site') || '').trim().toLowerCase();
  if (secFetchSite === 'cross-site') {
    return false;
  }

  const origin = String(request.headers.get('Origin') || '').trim();
  if (origin) {
    return timingSafeEqual(origin, expectedOrigin);
  }

  const referer = String(request.headers.get('Referer') || '').trim();
  if (!referer) {
    return true;
  }

  try {
    return timingSafeEqual(new URL(referer).origin, expectedOrigin);
  } catch {
    return false;
  }
}

function requireTrustedSiteOrigin(request, env) {
  if (isTrustedSiteOriginRequest(request, env)) {
    return { ok: true };
  }

  return {
    ok: false,
    response: privateJsonResponse({ error: 'Origin not allowed' }, 403, env)
  };
}

function getAppMode(env = {}) {
  return String(env.APP_MODE || 'live').trim().toLowerCase() === 'test'
    ? 'test'
    : 'live';
}

function isProductionWorkerRequest(request, env = {}) {
  if (getAppMode(env) !== 'live') return false;
  let requestHost = '';
  try {
    requestHost = new URL(request.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!requestHost || requestHost === 'localhost' || requestHost === '127.0.0.1' || requestHost === '::1') {
    return false;
  }
  const configuredBase = String(env.WORKER_BASE || env.CANONICAL_WORKER_BASE || '').trim();
  if (!configuredBase) return true;
  try {
    const configuredHost = new URL(configuredBase).hostname.toLowerCase();
    return configuredHost ? requestHost === configuredHost : true;
  } catch {
    return true;
  }
}

  // SEC-005: Rate limiting helper
// Returns { allowed: true } or { allowed: false, response: Response }
async function checkRateLimit(request, env, options = {}) {
  const {
    prefix = 'ratelimit',
    limit = 60,
    windowSeconds = 60,
    keyFn = null,
    privateResponse: usePrivateResponse = false
  } = options;

  const rateLimitResponse = (data, status = 429, headers = {}) => {
    const responseHeaders = {
      ...headers
    };
    return usePrivateResponse
      ? privateJsonResponse(data, status, env, responseHeaders)
      : jsonResponse(data, status, env, false, responseHeaders);
  };
  
  if (!env.RATELIMIT) {
    return {
      allowed: false,
      response: rateLimitResponse({ error: RATELIMIT_REQUIRED_ERROR }, 503)
    };
  }
  
  const ip = request.headers.get('CF-Connecting-IP') || 
             request.headers.get('X-Forwarded-For')?.split(',')[0] || 
             'unknown';
  const key = keyFn ? `${prefix}:${keyFn(request)}` : `${prefix}:${ip}`;
  
  try {
    const now = Math.floor(Date.now() / 1000);
    const record = await env.RATELIMIT.get(key, { type: 'json' }) || { count: 0, reset: now + windowSeconds };
    
    // Reset window if expired
    if (now > record.reset) {
      record.count = 0;
      record.reset = now + windowSeconds;
    }

    // Once a client is already over limit inside the current window,
    // fail closed without rewriting the same counter on every blocked hit.
    if (record.count >= limit) {
      const retryAfter = Math.max(0, record.reset - now);
      return {
        allowed: false,
        response: rateLimitResponse({
          error: 'Too many requests',
          retryAfter
        }, 429, {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(record.reset)
        })
      };
    }
    
    record.count++;
    
    // Store updated count
    await env.RATELIMIT.put(key, JSON.stringify(record), { 
      expirationTtl: windowSeconds + 10 
    });
    
    if (record.count > limit) {
      const retryAfter = record.reset - now;
      return {
        allowed: false,
        response: rateLimitResponse({
          error: 'Too many requests',
          retryAfter 
        }, 429, {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(record.reset)
        })
      };
    }
    
    return { 
      allowed: true,
      remaining: limit - record.count,
      reset: record.reset
    };
  } catch (err) {
    console.error('Rate limit check failed:', err);
    return {
      allowed: false,
      response: rateLimitResponse({ error: 'Rate limiting unavailable' }, 503)
    };
  }
}

function getRequestContentLength(request) {
  const raw = request.headers.get('Content-Length');
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function requestHasJsonContentType(request) {
  const contentType = String(request.headers.get('Content-Type') || '').trim().toLowerCase();
  return contentType === 'application/json' || contentType.startsWith('application/json;');
}

function requireBodySizeWithinLimit(request, env, maxBytes, { privateResponse: usePrivateResponse = false } = {}) {
  const contentLength = getRequestContentLength(request);
  if (contentLength === null || contentLength <= maxBytes) {
    return { ok: true };
  }

  const response = usePrivateResponse
    ? privateJsonResponse({ error: 'Request body too large' }, 413, env)
    : jsonResponse({ error: 'Request body too large' }, 413, env);

  return {
    ok: false,
    response
  };
}

async function readRequestTextWithinLimit(request, env, maxBytes, { privateResponse: usePrivateResponse = false } = {}) {
  const contentLengthCheck = requireBodySizeWithinLimit(request, env, maxBytes, { privateResponse: usePrivateResponse });
  if (!contentLengthCheck.ok) {
    return contentLengthCheck;
  }

  if (!request.body) {
    return { ok: true, text: '' };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      const response = usePrivateResponse
        ? privateJsonResponse({ error: 'Request body too large' }, 413, env)
        : jsonResponse({ error: 'Request body too large' }, 413, env);
      return { ok: false, response };
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return { ok: true, text };
}

async function parseJsonRequestBody(request, env, {
  maxBytes = MAX_STANDARD_JSON_BODY_BYTES,
  privateResponse: usePrivateResponse = false,
  emptyValue = null
} = {}) {
  if (!requestHasJsonContentType(request)) {
    const response = usePrivateResponse
      ? privateJsonResponse({ error: 'Expected application/json request body' }, 415, env)
      : jsonResponse({ error: 'Expected application/json request body' }, 415, env);
    return { ok: false, response };
  }

  const textResult = await readRequestTextWithinLimit(request, env, maxBytes, { privateResponse: usePrivateResponse });
  if (!textResult.ok) {
    return textResult;
  }

  const text = String(textResult.text || '');
  if (text.trim() === '') {
    return { ok: true, body: emptyValue };
  }

  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    const response = usePrivateResponse
      ? privateJsonResponse({ error: 'Invalid JSON' }, 400, env)
      : jsonResponse({ error: 'Invalid JSON' }, 400, env);
    return { ok: false, response };
  }
}

async function parseOptionalJsonRequestBody(request, env, {
  maxBytes = MAX_STANDARD_JSON_BODY_BYTES,
  privateResponse: usePrivateResponse = false,
  emptyValue = null
} = {}) {
  const textResult = await readRequestTextWithinLimit(request, env, maxBytes, { privateResponse: usePrivateResponse });
  if (!textResult.ok) {
    return textResult;
  }

  const text = String(textResult.text || '');
  if (text.trim() === '') {
    return { ok: true, body: emptyValue };
  }

  if (!requestHasJsonContentType(request)) {
    const response = usePrivateResponse
      ? privateJsonResponse({ error: 'Expected application/json request body' }, 415, env)
      : jsonResponse({ error: 'Expected application/json request body' }, 415, env);
    return { ok: false, response };
  }

  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    const response = usePrivateResponse
      ? privateJsonResponse({ error: 'Invalid JSON' }, 400, env)
      : jsonResponse({ error: 'Invalid JSON' }, 400, env);
    return { ok: false, response };
  }
}

function getObservabilityDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getObservabilitySummaryKey(kind, dateKey = getObservabilityDateKey()) {
  return `observability:${kind}:${dateKey}`;
}

function getObservabilityRecentKey(kind) {
  return `observability:${kind}:recent`;
}

function clampObservabilityDays(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 2;
  return Math.min(OBSERVABILITY_MAX_DAYS, parsed);
}

function getObservabilityDateKeys(days = 2) {
  const clampedDays = clampObservabilityDays(days);
  const keys = [];
  const now = new Date();
  for (let i = 0; i < clampedDays; i++) {
    const date = new Date(now);
    date.setUTCDate(now.getUTCDate() - i);
    keys.push(getObservabilityDateKey(date));
  }
  return keys;
}

function bucketStatusCode(status) {
  const numericStatus = Number.parseInt(String(status || ''), 10);
  if (!Number.isFinite(numericStatus) || numericStatus <= 0) return 'unknown';
  return `${Math.floor(numericStatus / 100)}xx`;
}

function updateDurationStats(target, durationMs) {
  const safeDuration = Math.max(0, Number(durationMs) || 0);
  target.count = (target.count || 0) + 1;
  target.totalMs = (target.totalMs || 0) + safeDuration;
  target.maxMs = Math.max(target.maxMs || 0, safeDuration);
  target.minMs = target.count === 1
    ? safeDuration
    : Math.min(Number(target.minMs ?? safeDuration), safeDuration);
  target.lastMs = safeDuration;
}

function finalizeDurationStats(target = {}) {
  const count = Number(target.count || 0);
  const totalMs = Number(target.totalMs || 0);
  return {
    count,
    totalMs,
    avgMs: count > 0 ? Number((totalMs / count).toFixed(2)) : 0,
    minMs: count > 0 ? Number(target.minMs || 0) : 0,
    maxMs: Number(target.maxMs || 0),
    lastMs: Number(target.lastMs || 0)
  };
}

function getObservabilitySampleRate(env = {}) {
  const raw = env.OBSERVABILITY_SAMPLE_RATE ?? env.PERFORMANCE_SAMPLE_RATE ?? DEFAULT_OBSERVABILITY_SAMPLE_RATE;
  const parsed = Number.parseFloat(String(raw));
  if (!Number.isFinite(parsed)) return DEFAULT_OBSERVABILITY_SAMPLE_RATE;
  return Math.min(1, Math.max(0, parsed));
}

function truncateObservabilityValue(value, maxLength = 120) {
  const stringValue = String(value ?? '').trim();
  if (!stringValue) return '';
  return stringValue.length > maxLength
    ? `${stringValue.slice(0, maxLength - 1)}…`
    : stringValue;
}

function queueBackgroundTask(ctx, task, label = 'background task') {
  const guardedTask = Promise.resolve(task).catch((err) => {
    console.error(`${label} failed:`, err?.message || err);
  });
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(guardedTask);
    return;
  }
  guardedTask.catch(() => {});
}

async function updateObservabilitySummary(env, kind, updateFn) {
  if (!env.STORE_STATE) return null;
  const dateKey = getObservabilityDateKey();
  const key = getObservabilitySummaryKey(kind, dateKey);
  const summary = await env.STORE_STATE.get(key, { type: 'json' }) || {
    kind,
    date: dateKey,
    createdAt: new Date().toISOString(),
    updatedAt: null
  };
  const next = updateFn(summary) || summary;
  next.kind = kind;
  next.date = dateKey;
  next.updatedAt = new Date().toISOString();
  await env.STORE_STATE.put(key, JSON.stringify(next), {
    expirationTtl: OBSERVABILITY_RETENTION_SECONDS
  });
  return next;
}

async function appendObservabilityRecentEvent(env, kind, entry) {
  if (!env.STORE_STATE) return;
  const key = getObservabilityRecentKey(kind);
  const recent = await env.STORE_STATE.get(key, { type: 'json' }) || [];
  const normalizedEntry = {
    recordedAt: new Date().toISOString(),
    ...entry
  };
  const next = [normalizedEntry, ...recent].slice(0, OBSERVABILITY_RECENT_EVENT_LIMIT);
  await env.STORE_STATE.put(key, JSON.stringify(next), {
    expirationTtl: OBSERVABILITY_RETENTION_SECONDS
  });
}

async function recordWebhookObservation(env, observation = {}) {
  if (!env.STORE_STATE) return;
  const {
    outcome = 'unknown',
    eventId = '',
    eventType = 'unknown',
    orderId = '',
    status = 0,
    durationMs = 0
  } = observation;

  await updateObservabilitySummary(env, 'webhook', (summary) => {
    summary.received = Number(summary.received || 0) + 1;
    summary.outcomes = summary.outcomes || {};
    summary.outcomes[outcome] = Number(summary.outcomes[outcome] || 0) + 1;
    summary.statusCounts = summary.statusCounts || {};
    const statusBucket = bucketStatusCode(status);
    summary.statusCounts[statusBucket] = Number(summary.statusCounts[statusBucket] || 0) + 1;
    summary.eventTypes = summary.eventTypes || {};
    const normalizedEventType = truncateObservabilityValue(eventType || 'unknown', 80) || 'unknown';
    const eventTypeSummary = summary.eventTypes[normalizedEventType] || {
      received: 0,
      outcomes: {}
    };
    eventTypeSummary.received += 1;
    eventTypeSummary.outcomes[outcome] = Number(eventTypeSummary.outcomes[outcome] || 0) + 1;
    summary.eventTypes[normalizedEventType] = eventTypeSummary;
    summary.durations = summary.durations || {};
    updateDurationStats(summary.durations, durationMs);
    return summary;
  });

  await appendObservabilityRecentEvent(env, 'webhook', {
    outcome,
    eventId: truncateObservabilityValue(eventId, 80),
    eventType: truncateObservabilityValue(eventType || 'unknown', 80) || 'unknown',
    orderId: truncateObservabilityValue(orderId, 80),
    status: Number(status || 0),
    durationMs: Math.max(0, Number(durationMs) || 0)
  });
}

async function recordPerformanceObservation(env, observation = {}) {
  if (!env.STORE_STATE) return;
  const {
    operation = 'unknown',
    status = 0,
    durationMs = 0
  } = observation;

  await updateObservabilitySummary(env, 'performance', (summary) => {
    summary.sampleRate = getObservabilitySampleRate(env);
    summary.operations = summary.operations || {};
    const normalizedOperation = truncateObservabilityValue(operation || 'unknown', 80) || 'unknown';
    const operationSummary = summary.operations[normalizedOperation] || {
      count: 0,
      totalMs: 0,
      minMs: 0,
      maxMs: 0,
      lastMs: 0,
      statusCounts: {}
    };
    updateDurationStats(operationSummary, durationMs);
    const statusBucket = bucketStatusCode(status);
    operationSummary.statusCounts[statusBucket] = Number(operationSummary.statusCounts[statusBucket] || 0) + 1;
    summary.operations[normalizedOperation] = operationSummary;
    return summary;
  });
}

function maybeRecordPerformanceObservation(env, ctx, operation, startedAt, response) {
  const sampleRate = getObservabilitySampleRate(env);
  if (sampleRate <= 0 || Math.random() > sampleRate) {
    return response;
  }

  queueBackgroundTask(
    ctx,
    recordPerformanceObservation(env, {
      operation,
      status: response?.status || 0,
      durationMs: Date.now() - startedAt
    }),
    `performance observation (${operation})`
  );
  return response;
}

async function withObservedOperation(env, ctx, operation, fn) {
  const startedAt = Date.now();
  const response = await fn();
  return maybeRecordPerformanceObservation(env, ctx, operation, startedAt, response);
}

async function listObservabilitySummaries(env, kind, days = 2) {
  if (!env.STORE_STATE) return [];

  const summaries = [];
  for (const dateKey of getObservabilityDateKeys(days)) {
    const summary = await env.STORE_STATE.get(getObservabilitySummaryKey(kind, dateKey), { type: 'json' });
    if (!summary) continue;

    if (kind === 'performance') {
      const operations = {};
      for (const [operation, entry] of Object.entries(summary.operations || {})) {
        operations[operation] = {
          ...finalizeDurationStats(entry),
          statusCounts: entry?.statusCounts || {}
        };
      }
      summaries.push({
        date: summary.date,
        updatedAt: summary.updatedAt,
        sampleRate: summary.sampleRate ?? getObservabilitySampleRate(env),
        operations
      });
      continue;
    }

    summaries.push({
      date: summary.date,
      updatedAt: summary.updatedAt,
      received: Number(summary.received || 0),
      outcomes: summary.outcomes || {},
      statusCounts: summary.statusCounts || {},
      eventTypes: summary.eventTypes || {},
      durations: finalizeDurationStats(summary.durations || {})
    });
  }

  return summaries;
}

async function getObservabilityRecentEvents(env, kind) {
  if (!env.STORE_STATE) return [];
  return await env.STORE_STATE.get(getObservabilityRecentKey(kind), { type: 'json' }) || [];
}

// Rate limit configurations for different endpoint types
const RATE_LIMITS = {
  start: { prefix: 'rl:start', limit: 40, windowSeconds: 60 },          // 40 checkout starts/min/IP
  cartValidate: { prefix: 'rl:cart-validate', limit: 120, windowSeconds: 60 }, // 120 cart validations/min/IP
  shipping: { prefix: 'rl:shipping', limit: 90, windowSeconds: 60 },    // 90 quote refreshes/min/IP
  tax: { prefix: 'rl:tax', limit: 90, windowSeconds: 60 },              // 90 tax quote refreshes/min/IP
  complete: { prefix: 'rl:complete', limit: 12, windowSeconds: 60 },    // 12 recovery attempts/min/order
  abandon: { prefix: 'rl:abandon', limit: 12, windowSeconds: 60 },      // 12 abandon attempts/min/order
  admin: { prefix: 'rl:admin', limit: 5, windowSeconds: 60 },       // 5 high-risk admin calls/min
  adminProductPreview: { prefix: 'rl:admin-product-preview', limit: 90, windowSeconds: 60 },
  adminProductPublish: { prefix: 'rl:admin-product-publish', limit: 12, windowSeconds: 60 },
  adminAddressLookup: { prefix: 'rl:admin-address-lookup', limit: 30, windowSeconds: 60 },
  orderRead: { prefix: 'rl:order-read', limit: 120, windowSeconds: 60 },   // 120 order reads/min/IP
  orderLookup: { prefix: 'rl:order-lookup', limit: 8, windowSeconds: 60 }   // 8 order lookup requests/min/IP
};

const ADMIN_RATE_LIMIT_OPTIONS = {
  ...RATE_LIMITS.admin,
  privateResponse: true
};

const ADMIN_PRODUCT_PREVIEW_RATE_LIMIT_OPTIONS = {
  ...RATE_LIMITS.adminProductPreview,
  privateResponse: true
};

const ADMIN_PRODUCT_PUBLISH_RATE_LIMIT_OPTIONS = {
  ...RATE_LIMITS.adminProductPublish,
  privateResponse: true
};

const ADMIN_SECRET_SCOPES = {
  maintenance: ['ADMIN_MAINTENANCE_SECRET', 'MAINTENANCE_ADMIN_SECRET']
};

function configuredSecret(value) {
  const secret = String(value || '').trim();
  return secret || '';
}

function getAdminSecretForScope(env, scope = 'default') {
  const scopedKeys = ADMIN_SECRET_SCOPES[scope] || [];
  for (const key of scopedKeys) {
    const secret = configuredSecret(env?.[key]);
    if (secret) {
      return { secret, key, scoped: true };
    }
  }

  const fallbackSecret = configuredSecret(env?.ADMIN_SECRET);
  return fallbackSecret
    ? { secret: fallbackSecret, key: 'ADMIN_SECRET', scoped: false }
    : null;
}

// SEC-006: Admin authentication helper with timing-safe comparison
function requireAdmin(request, env, scope = 'default') {
  const authHeader = request.headers.get('Authorization') || '';
  const adminKey = request.headers.get('x-admin-key') || '';
  const credential = getAdminSecretForScope(env, scope);
  
  if (!credential) {
    console.error(`CRITICAL: admin secret not configured for ${scope} scope`);
    return { ok: false, response: jsonResponse({ error: 'Admin not configured' }, 500) };
  }
  
  // Check Bearer token in Authorization header
  const bearerPrefix = 'Bearer ';
  const bearerToken = authHeader.startsWith(bearerPrefix)
    ? authHeader.slice(bearerPrefix.length)
    : '';
  if (bearerToken && timingSafeEqual(bearerToken, credential.secret)) {
    return { ok: true };
  }
  
  // Check x-admin-key header
  if (adminKey && timingSafeEqual(adminKey, credential.secret)) {
    return { ok: true };
  }
  
  return { ok: false, response: jsonResponse({ error: 'Unauthorized' }, 401) };
}


function formatUsdCents(cents = 0) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format((Number(cents || 0) || 0) / 100);
}



function shouldRecordCronHeartbeat(cronExpression = '', date = new Date()) {
  if (cronExpression === PLATFORM_SCHEDULER_CRON) {
    return date.getUTCMinutes() % PLATFORM_SCHEDULER_HEARTBEAT_INTERVAL_MINUTES === 0;
  }
  return true;
}



function sanitizeStoredTaxDetails(taxDetails, fallback = {}) {
  if (!taxDetails || typeof taxDetails !== 'object') {
    return {
      provider: String(fallback.provider || 'flat'),
      source: String(fallback.source || 'flat_rate'),
      effectiveRate: Number(fallback.effectiveRate || 0) || 0,
      locationCode: typeof fallback.locationCode === 'string' && fallback.locationCode.trim() ? fallback.locationCode.trim() : null,
      destination: fallback.destination || null,
      jurisdiction: fallback.jurisdiction || null,
      taxableSubtotalCents: Math.max(0, Number(fallback.taxableSubtotalCents || 0) || 0),
      taxableShippingCents: Math.max(0, Number(fallback.taxableShippingCents || 0) || 0),
      shippingTaxed: fallback.shippingTaxed === true,
      shippingCents: Math.max(0, Number(fallback.shippingCents || 0) || 0),
      breakdown: Array.isArray(fallback.breakdown) ? fallback.breakdown : []
    };
  }

  return {
    provider: String(taxDetails.provider || fallback.provider || 'flat'),
    source: String(taxDetails.source || fallback.source || 'flat_rate'),
    effectiveRate: Number(taxDetails.effectiveRate ?? fallback.effectiveRate ?? 0) || 0,
    locationCode: typeof (taxDetails.locationCode ?? fallback.locationCode) === 'string' && String(taxDetails.locationCode ?? fallback.locationCode).trim()
      ? String(taxDetails.locationCode ?? fallback.locationCode).trim()
      : null,
    destination: taxDetails.destination || fallback.destination || null,
    jurisdiction: taxDetails.jurisdiction || fallback.jurisdiction || null,
    taxableSubtotalCents: Math.max(0, Number(taxDetails.taxableSubtotalCents ?? fallback.taxableSubtotalCents ?? 0) || 0),
    taxableShippingCents: Math.max(0, Number(taxDetails.taxableShippingCents ?? fallback.taxableShippingCents ?? 0) || 0),
    shippingTaxed: taxDetails.shippingTaxed === true,
    shippingCents: Math.max(0, Number(taxDetails.shippingCents ?? fallback.shippingCents ?? 0) || 0),
    breakdown: Array.isArray(taxDetails.breakdown) ? taxDetails.breakdown : (Array.isArray(fallback.breakdown) ? fallback.breakdown : [])
  };
}





const STRIPE_FINANCIAL_EXPAND = Object.freeze(['latest_charge.balance_transaction']);

function withStripeFinancialExpansion(data = {}) {
  return { ...data, expand: STRIPE_FINANCIAL_EXPAND };
}

function stripeSessionLogContext(session = {}) {
  return {
    id: session?.id || null,
    status: session?.status || null,
    mode: session?.mode || null,
    paymentStatus: session?.payment_status || null
  };
}

function stripeErrorLogContext(err = {}) {
  return {
    type: err?.type || err?.name || 'Error',
    code: err?.code || null,
    statusCode: err?.statusCode || err?.status || null,
    requestId: err?.requestId || err?.request_id || null
  };
}

function stripeObjectId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return String(value.id || '');
  return '';
}

function getStripePaymentIntentCharge(paymentIntent = {}) {
  const latestCharge = paymentIntent?.latest_charge;
  if (latestCharge && typeof latestCharge === 'object') return latestCharge;
  const chargeData = paymentIntent?.charges?.data;
  if (Array.isArray(chargeData) && chargeData.length > 0) return chargeData[0];
  return latestCharge ? { id: String(latestCharge) } : null;
}

function getStripeBalanceTransaction(charge = {}) {
  const balanceTransaction = charge?.balance_transaction;
  return balanceTransaction && typeof balanceTransaction === 'object' ? balanceTransaction : null;
}

function normalizeStripeCheckResult(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['pass', 'fail', 'unavailable', 'unchecked'].includes(normalized) ? normalized : '';
}

function extractStripePaymentIntentCardChecks(paymentIntent = {}) {
  const charge = getStripePaymentIntentCharge(paymentIntent);
  const card = charge?.payment_method_details?.card;
  if (!card || typeof card !== 'object') return null;

  const checks = card.checks && typeof card.checks === 'object' ? card.checks : {};
  const outcome = charge.outcome && typeof charge.outcome === 'object' ? charge.outcome : {};
  const result = {
    addressLine1Check: normalizeStripeCheckResult(checks.address_line1_check),
    addressPostalCodeCheck: normalizeStripeCheckResult(checks.address_postal_code_check),
    cvcCheck: normalizeStripeCheckResult(checks.cvc_check),
    networkStatus: String(outcome.network_status || '').trim(),
    riskLevel: String(outcome.risk_level || '').trim(),
    outcomeType: String(outcome.type || '').trim()
  };

  return Object.values(result).some(Boolean) ? result : null;
}

function extractStripePaymentIntentFinancials(paymentIntent = {}) {
  const paymentIntentId = stripeObjectId(paymentIntent);
  const charge = getStripePaymentIntentCharge(paymentIntent);
  const chargeId = stripeObjectId(charge);
  const balanceTransaction = getStripeBalanceTransaction(charge);

  if (!balanceTransaction) {
    if (!paymentIntentId && !chargeId) return null;
    return {
      source: 'pending',
      paymentIntentId,
      chargeId,
      balanceTransactionId: stripeObjectId(charge?.balance_transaction)
    };
  }

  return {
    source: 'actual',
    paymentIntentId,
    chargeId,
    balanceTransactionId: stripeObjectId(balanceTransaction),
    grossAmount: Math.trunc(Number(balanceTransaction.amount || 0) || 0),
    feeAmount: Math.trunc(Number(balanceTransaction.fee || 0) || 0),
    netAmount: Math.trunc(Number(balanceTransaction.net || 0) || 0),
    currency: String(balanceTransaction.currency || paymentIntent?.currency || '').toLowerCase() || 'usd',
    status: String(balanceTransaction.status || ''),
    availableOn: balanceTransaction.available_on || null,
    reportingCategory: balanceTransaction.reporting_category || null
  };
}

async function retrieveStripePaymentIntentFinancials(stripe, paymentIntentId) {
  if (!stripe?.paymentIntents?.retrieve || !paymentIntentId) return null;
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: STRIPE_FINANCIAL_EXPAND
  });
  return extractStripePaymentIntentFinancials(paymentIntent);
}

async function retrieveStripePaymentIntentForSettlement(stripe, paymentIntentId) {
  if (!stripe?.paymentIntents?.retrieve || !paymentIntentId) return null;
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: STRIPE_FINANCIAL_EXPAND
  });
  if (paymentIntent?.error || stripeObjectId(paymentIntent) !== paymentIntentId) return null;
  return paymentIntent;
}

async function enrichStripePaymentIntentForSettlement(paymentIntent = {}, env = {}) {
  const paymentIntentId = stripeObjectId(paymentIntent);
  if (!paymentIntentId) return paymentIntent;

  const existingFinancials = extractStripePaymentIntentFinancials(paymentIntent);
  const existingChecks = extractStripePaymentIntentCardChecks(paymentIntent);
  if (existingFinancials?.source === 'actual' && existingChecks) return paymentIntent;

  const stripeSecretKey = getStripeKey(env);
  if (!stripeSecretKey) return paymentIntent;

  try {
    const enriched = await retrieveStripePaymentIntentForSettlement(createStripeClient(stripeSecretKey), paymentIntentId);
    return enriched || paymentIntent;
  } catch (error) {
    console.error('Stripe Store PaymentIntent enrichment failed:', stripeErrorLogContext(error));
    return paymentIntent;
  }
}

function allocateIntegerTotal(totalCents, items = []) {
  const total = Math.trunc(Number(totalCents || 0) || 0);
  const count = Array.isArray(items) ? items.length : 0;
  if (count <= 0) return [];
  if (total === 0) return new Array(count).fill(0);

  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);
  const weights = items.map((item) => Math.max(0, Number(item?.amount || 0) || 0));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) {
    const allocations = new Array(count).fill(0);
    allocations[0] = total;
    return allocations;
  }

  const rows = weights.map((weight, index) => {
    const exact = (absTotal * weight) / weightTotal;
    const base = Math.floor(exact);
    return { index, base, remainder: exact - base };
  });
  let allocated = rows.reduce((sum, row) => sum + row.base, 0);
  rows.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; allocated < absTotal; index += 1, allocated += 1) {
    rows[index % rows.length].base += 1;
  }
  rows.sort((a, b) => a.index - b.index);
  return rows.map((row) => row.base * sign);
}

function normalizeTierId(rawTierId) {
  if (typeof rawTierId !== 'string' || rawTierId.length === 0) return null;
  return rawTierId.split('__').pop();
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

















async function handleGetAddOnInventory(env) {
  const snapshot = await getAddOnInventorySnapshot(env);
  return jsonResponse(snapshot, 200, env, true, {
    'Cache-Control': PRIVATE_NO_STORE_CACHE_CONTROL
  });
}

const STORE_INVENTORY_SCOPE = 'store';

function hasStoreInventoryCoordinator(env) {
  return !!env?.STORE_INVENTORY_COORDINATOR;
}

function getStoreInventoryCoordinatorStub(env) {
  const id = env.STORE_INVENTORY_COORDINATOR.idFromName(STORE_INVENTORY_SCOPE);
  return env.STORE_INVENTORY_COORDINATOR.get(id);
}

async function callStoreInventoryCoordinator(env, path, payload = {}) {
  if (!hasStoreInventoryCoordinator(env)) {
    throw new Error('Store inventory coordinator unavailable');
  }

  const response = await getStoreInventoryCoordinatorStub(env).fetch(
    `https://store-inventory-coordinator${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: STORE_INVENTORY_SCOPE,
        ...payload
      })
    }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || 'Store inventory coordinator request failed');
  }
  return body;
}

function getStoreSkuReservationCounts(items = []) {
  const counts = {};
  for (const item of items || []) {
    if (item?.inventory?.tracking !== true) continue;
    const availableQuantity = Math.trunc(Number(item?.inventory?.quantity || 0) || 0);
    if (availableQuantity <= 0) continue;
    const sku = String(item?.sku || '').trim();
    const quantity = Math.trunc(Number(item?.quantity || 0) || 0);
    if (!sku || quantity <= 0) continue;
    counts[sku] = (counts[sku] || 0) + quantity;
  }
  return counts;
}

function hasStoreSkuReservationCounts(counts = {}) {
  return Object.values(counts || {}).some((qty) => Number(qty || 0) > 0);
}

function getConfiguredStoreInventory(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function normalizeStoreInventoryOverrides(value = {}) {
  const products = {};
  const sourceProducts = value?.products && typeof value.products === 'object'
    ? value.products
    : {};

  for (const [productId, productOverride] of Object.entries(sourceProducts)) {
    const normalizedProductId = String(productId || '').trim();
    if (!normalizedProductId || !productOverride || typeof productOverride !== 'object') continue;

    const entry = { variants: {} };
    const productInventory = getConfiguredStoreInventory(productOverride.inventory);
    if (productInventory !== null) {
      entry.inventory = productInventory;
    }

    const variantOverrides = productOverride.variants && typeof productOverride.variants === 'object'
      ? productOverride.variants
      : {};
    for (const [variantId, variantOverride] of Object.entries(variantOverrides)) {
      const normalizedVariantId = String(variantId || '').trim();
      const variantInventory = getConfiguredStoreInventory(variantOverride?.inventory);
      if (!normalizedVariantId || variantInventory === null) continue;
      entry.variants[normalizedVariantId] = { inventory: variantInventory };
    }

    if (entry.inventory !== undefined || Object.keys(entry.variants).length > 0) {
      products[normalizedProductId] = entry;
    }
  }

  return {
    products,
    updatedAt: value?.updatedAt || null
  };
}

function hasStoreInventoryOverrides(overrides = {}) {
  return Object.values(overrides.products || {}).some((entry) => (
    entry?.inventory !== undefined ||
    Object.keys(entry?.variants || {}).length > 0
  ));
}

async function getStoreInventoryOverrides(env) {
  if (!env?.STORE_STATE) return normalizeStoreInventoryOverrides({});
  const stored = await env.STORE_STATE.get(STORE_INVENTORY_OVERRIDES_KEY, { type: 'json' });
  return normalizeStoreInventoryOverrides(stored || {});
}

async function persistStoreInventoryOverrides(env, overrides) {
  if (!env?.STORE_STATE) {
    throw new Error('STORE_STATE KV not configured');
  }

  const normalized = normalizeStoreInventoryOverrides({
    ...overrides,
    updatedAt: new Date().toISOString()
  });

  if (!hasStoreInventoryOverrides(normalized)) {
    await env.STORE_STATE.delete(STORE_INVENTORY_OVERRIDES_KEY);
    return { storageWrite: true, overrides: normalizeStoreInventoryOverrides({}) };
  }

  await env.STORE_STATE.put(STORE_INVENTORY_OVERRIDES_KEY, JSON.stringify(normalized));
  return { storageWrite: true, overrides: normalized };
}

function setStoreOverrideInventory(overrides, productId, variantId, inventory) {
  const next = normalizeStoreInventoryOverrides(overrides);
  const productOverride = next.products[productId] || { variants: {} };
  productOverride.variants = productOverride.variants || {};

  if (variantId) {
    productOverride.variants[variantId] = { inventory };
  } else {
    productOverride.inventory = inventory;
  }

  next.products[productId] = productOverride;
  return next;
}

function resetStoreOverrideInventory(overrides, productId, variantId) {
  const next = normalizeStoreInventoryOverrides(overrides);
  const productOverride = next.products[productId];
  if (!productOverride) return next;

  if (variantId) {
    delete productOverride.variants?.[variantId];
  } else {
    delete productOverride.inventory;
  }

  if (productOverride.inventory === undefined && Object.keys(productOverride.variants || {}).length === 0) {
    delete next.products[productId];
  } else {
    next.products[productId] = productOverride;
  }

  return next;
}

function applyStoreInventoryOverridesToSnapshot(snapshot = {}, overrides = {}) {
  const next = JSON.parse(JSON.stringify(snapshot || {}));
  const overrideProducts = normalizeStoreInventoryOverrides(overrides).products || {};

  for (const product of next.products || []) {
    const productId = String(product?.id || '').trim();
    const productOverride = overrideProducts[productId];
    if (!productId || !productOverride) continue;

    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length > 0) {
      for (const variant of variants) {
        const variantId = String(variant?.id || '').trim();
        const overrideInventory = productOverride.variants?.[variantId]?.inventory;
        if (variantId && overrideInventory !== undefined) {
          variant.inventory = Number(overrideInventory);
        }
      }
    } else if (productOverride.inventory !== undefined) {
      product.inventory = Number(productOverride.inventory);
    }
  }

  return next;
}

async function getEffectiveStoreCatalogSnapshot(env) {
  const overrides = await getStoreInventoryOverrides(env);
  return applyStoreInventoryOverridesToSnapshot(getStoreCatalogSnapshot(env), overrides);
}

async function buildStoreCatalogInventorySnapshot(env) {
  const catalog = normalizeStoreCatalogSnapshot(await getEffectiveStoreCatalogSnapshot(env));
  const inventory = {};

  for (const product of catalog.products || []) {
    if (product?.inventory_tracking !== true) continue;

    const variants = Array.isArray(product?.variants) ? product.variants : [];
    if (variants.length > 0) {
      for (const variant of variants) {
        const entry = buildStoreCatalogInventoryEntry(product, variant);
        if (entry) inventory[entry.sku] = entry.inventory;
      }
      continue;
    }

    const entry = buildStoreCatalogInventoryEntry(product, null);
    if (entry) inventory[entry.sku] = entry.inventory;
  }

  return inventory;
}

function buildStoreCatalogInventoryEntry(product = {}, variant = null) {
  const quantity = Math.trunc(Number(variant?.inventory ?? product.inventory ?? 0) || 0);
  if (quantity <= 0) return null;

  const sku = String(variant?.sku || product.sku || product.id || '').trim();
  if (!sku) return null;

  return {
    sku,
    inventory: {
      limit: quantity,
      claimed: 0,
      productId: String(product.id || '').trim(),
      variantId: String(variant?.id || '').trim(),
      name: String(product.name || product.id || sku).trim(),
      variantLabel: String(variant?.label || '').trim()
    }
  };
}

function buildStoreInventoryReservation(orderToken, counts = {}, status = 'reserved', timestamp = new Date().toISOString()) {
  if (!orderToken || !hasStoreSkuReservationCounts(counts)) return null;
  const reservation = {
    id: orderToken,
    scope: STORE_INVENTORY_SCOPE,
    status,
    counts: { ...counts }
  };
  if (status === 'reserved') reservation.reservedAt = timestamp;
  if (status === 'confirmed') reservation.confirmedAt = timestamp;
  if (status === 'released') reservation.releasedAt = timestamp;
  if (status === 'release_failed') reservation.releaseFailedAt = timestamp;
  return reservation;
}

async function saveStoreInventoryReservation(env, orderToken, items = []) {
  if (getAppMode(env) === 'test') {
    return { success: true, reserved: false, counts: {} };
  }

  const counts = getStoreSkuReservationCounts(items);
  if (!hasStoreSkuReservationCounts(counts)) {
    await releaseStoreInventoryReservationQuietly(env, orderToken, 'empty store inventory reservation');
    return { success: true, reserved: false, counts };
  }

  if (!hasStoreInventoryCoordinator(env)) {
    return { success: false, error: 'Store inventory coordinator unavailable' };
  }

  try {
    const result = await callStoreInventoryCoordinator(env, '/reserve-selection', {
      reservationId: orderToken,
      nextCounts: counts,
      inventory: await buildStoreCatalogInventorySnapshot(env),
      ttlSeconds: STORE_ORDER_DRAFT_TTL_SECONDS
    });
    if (!result?.success) return result;

    return {
      success: true,
      reserved: true,
      counts,
      reservation: buildStoreInventoryReservation(orderToken, counts, 'reserved')
    };
  } catch (err) {
    await releaseStoreInventoryReservationQuietly(env, orderToken, 'failed store inventory reservation');
    throw err;
  }
}

async function confirmOrClaimStoreInventoryReservation(env, orderToken, reservation = null) {
  const counts = reservation?.counts || {};
  if (!hasStoreSkuReservationCounts(counts)) {
    return { success: true, reservation: null };
  }

  if (!hasStoreInventoryCoordinator(env)) {
    return { success: false, error: 'Store inventory coordinator unavailable' };
  }

  const timestamp = new Date().toISOString();
  const inventory = await buildStoreCatalogInventorySnapshot(env);
  const confirmed = await callStoreInventoryCoordinator(env, '/confirm-reservation', {
    reservationId: orderToken,
    inventory
  });
  if (!confirmed?.success) return confirmed;

  if (!confirmed.confirmed) {
    const claimed = await callStoreInventoryCoordinator(env, '/claim-selection', {
      nextCounts: counts,
      inventory
    });
    if (!claimed?.success) return claimed;
  }

  return {
    success: true,
    reservation: buildStoreInventoryReservation(orderToken, counts, 'confirmed', timestamp)
  };
}

async function releaseStoreInventoryReservation(env, orderToken, reservation = null) {
  const counts = reservation?.counts || {};
  if (!hasStoreSkuReservationCounts(counts) || !hasStoreInventoryCoordinator(env)) {
    return {
      success: true,
      reservation: hasStoreSkuReservationCounts(counts)
        ? buildStoreInventoryReservation(orderToken, counts, 'release_failed')
        : null
    };
  }

  const result = await callStoreInventoryCoordinator(env, '/release-reservation', {
    reservationId: orderToken
  });
  if (!result?.success) return result;

  return {
    success: true,
    reservation: buildStoreInventoryReservation(orderToken, counts, 'released')
  };
}

async function releaseStoreInventoryReservationQuietly(env, orderToken, context = 'store inventory reservation', reservation = null) {
  try {
    return await releaseStoreInventoryReservation(env, orderToken, reservation);
  } catch (err) {
    console.error(`Failed to release ${context}:`, err.message);
    return {
      success: false,
      error: err.message,
      reservation: reservation?.counts
        ? buildStoreInventoryReservation(orderToken, reservation.counts, 'release_failed')
        : null
    };
  }
}


function getStripeKey(env) {
  if (getAppMode(env) === 'test' && env.STRIPE_SECRET_KEY_TEST) {
    return env.STRIPE_SECRET_KEY_TEST;
  }
  if (getAppMode(env) === 'live' && env.STRIPE_SECRET_KEY_LIVE) {
    return env.STRIPE_SECRET_KEY_LIVE;
  }
  return env.STRIPE_SECRET_KEY;
}

function getStripeWebhookSecret(env) {
  if (getAppMode(env) === 'test' && env.STRIPE_WEBHOOK_SECRET_TEST) {
    return env.STRIPE_WEBHOOK_SECRET_TEST;
  }
  if (getAppMode(env) === 'live' && env.STRIPE_WEBHOOK_SECRET_LIVE) {
    return env.STRIPE_WEBHOOK_SECRET_LIVE;
  }
  return env.STRIPE_WEBHOOK_SECRET;
}

function getStripePublishableKey(env) {
  if (getAppMode(env) === 'test' && env.STRIPE_PUBLISHABLE_KEY_TEST) {
    return env.STRIPE_PUBLISHABLE_KEY_TEST;
  }
  if (getAppMode(env) === 'live' && env.STRIPE_PUBLISHABLE_KEY_LIVE) {
    return env.STRIPE_PUBLISHABLE_KEY_LIVE;
  }
  return env.STRIPE_PUBLISHABLE_KEY || '';
}

function getStripeSecretKeyMode(key) {
  const value = String(key || '').trim();
  if (/^(?:sk|rk)_live_/i.test(value)) return 'live';
  if (/^(?:sk|rk)_test_/i.test(value)) return 'test';
  return value ? 'unknown' : '';
}

function getStripePublishableKeyMode(key) {
  const value = String(key || '').trim();
  if (/^pk_live_/i.test(value)) return 'live';
  if (/^pk_test_/i.test(value)) return 'test';
  return value ? 'unknown' : '';
}

function validateStripeCheckoutKeyPair(env, secretKey, publishableKey) {
  if (!secretKey || !publishableKey) {
    return {
      ok: false,
      status: 503,
      error: 'Stripe checkout is not configured',
      log: 'Stripe checkout is missing a secret key or publishable key.'
    };
  }

  const secretMode = getStripeSecretKeyMode(secretKey);
  const publishableMode = getStripePublishableKeyMode(publishableKey);
  const appMode = getAppMode(env);
  const publicError = 'Stripe checkout is misconfigured. Contact the shop if you need help completing the order.';

  if (secretMode === 'unknown' || publishableMode === 'unknown') {
    return {
      ok: false,
      status: 503,
      error: publicError,
      log: `Stripe checkout key mode could not be detected for app mode ${appMode}.`
    };
  }

  if (secretMode && publishableMode && secretMode !== publishableMode) {
    return {
      ok: false,
      status: 503,
      error: publicError,
      log: `Stripe checkout key mode mismatch: ${secretMode} secret key with ${publishableMode} publishable key.`
    };
  }

  if (secretMode && secretMode !== appMode) {
    return {
      ok: false,
      status: 503,
      error: publicError,
      log: `Stripe checkout app mode mismatch: ${appMode} Worker mode with ${secretMode} Stripe keys.`
    };
  }

  return { ok: true };
}

function resolveCheckoutUiRuntime(env) {
  const requestedMode = getCheckoutUiMode(env);
  const stripePublishableKey = getStripePublishableKey(env);
  const usingCustomCheckoutUi = requestedMode === 'custom' && Boolean(stripePublishableKey);

  return {
    usingCustomCheckoutUi,
    stripePublishableKey: usingCustomCheckoutUi ? stripePublishableKey : ''
  };
}

export default {
  async fetch(request, env, ctx) {
    configureWorkerLogging(env);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS' && path.startsWith('/admin/')) {
      return adminCorsResponse(env);
    }

    if (method === 'OPTIONS') {
      return corsResponse(env);
    }

    if (!env.RATELIMIT) {
      return jsonResponse({ error: RATELIMIT_REQUIRED_ERROR }, 503, env);
    }

    try {
      // SEC-003: Block test endpoints in production mode (unless admin-authenticated)
      if (path.startsWith('/test/') && getAppMode(env) !== 'test') {
        const auth = requireAdmin(request, env);
        if (!auth.ok) {
          return jsonResponse({ error: 'Not found' }, 404);
        }
      }

      if (path === '/admin/auth/start' && method === 'POST') {
        const parsedBody = await parseJsonRequestBody(request, env, {
          maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
          privateResponse: true
        });
        if (!parsedBody.ok) return parsedBody.response;
        const challengeResponse = await verifyAdminAuthStartChallenge(request, env, parsedBody.body || {});
        if (challengeResponse) return challengeResponse;
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminAuthStart(request, env, parsedBody.body || {});
      }

      if (path === '/admin/auth/exchange' && method === 'POST') {
        const parsedBody = await parseJsonRequestBody(request, env, {
          maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
          privateResponse: true
        });
        if (!parsedBody.ok) return parsedBody.response;
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminAuthExchange(request, env, parsedBody.body || {});
      }

      if (path === '/admin/session' && method === 'GET') {
        return handleAdminSession(request, env);
      }

      if (path === '/admin/logout' && method === 'POST') {
        const bodyLimit = requireBodySizeWithinLimit(request, env, MAX_STANDARD_JSON_BODY_BYTES, { privateResponse: true });
        if (!bodyLimit.ok) return bodyLimit.response;
        return handleAdminLogout(request, env);
      }

      if (path === '/admin/dashboard/summary' && method === 'GET') {
        return handleAdminDashboardSummary(request, env);
      }

      if (path === '/admin/audit.csv' && method === 'GET') {
        return handleAdminAuditCsv(request, env);
      }

      if (path === '/admin/store/health' && method === 'GET') {
        return handleAdminStoreHealth(request, env);
      }

      if (path === '/admin/plan-usage' && method === 'GET') {
        return handleAdminPlanUsage(request, env);
      }

      if (path === '/admin/settings' && method === 'GET') {
        return handleAdminSettings(request, env);
      }

      if (path === '/admin/settings/preview' && method === 'POST') {
        const parsedBody = await parseJsonRequestBody(request, env, {
          maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
          privateResponse: true,
          emptyValue: {}
        });
        if (!parsedBody.ok) return parsedBody.response;
        return handleAdminSettingsPreview(request, env, parsedBody.body || {});
      }

      if (path === '/admin/settings/logo-upload' && method === 'POST') {
        return handleAdminLogoUpload(request, env);
      }

      if (path === '/admin/settings/image-upload' && method === 'POST') {
        return handleAdminImageUpload(request, env);
      }

      if (path === '/admin/settings/audio-upload' && method === 'POST') {
        return handleAdminAudioUpload(request, env);
      }

      if (path === '/admin/settings/video-upload' && method === 'POST') {
        return handleAdminVideoUpload(request, env);
      }

      if (path === '/admin/settings/publish' && method === 'POST') {
        return handleAdminSettingsPublish(request, env);
      }

      if (path === '/admin/users' && method === 'POST') {
        const parsedBody = await parseJsonRequestBody(request, env, {
          maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
          privateResponse: true,
          emptyValue: {}
        });
        if (!parsedBody.ok) return parsedBody.response;
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminUsersSave(request, env, parsedBody.body || {});
      }

      if (path === '/admin/store/orders' && method === 'GET') {
        return handleAdminStoreOrders(request, env, ctx);
      }

      if (path === '/admin/store/orders.csv' && method === 'GET') {
        return handleAdminStoreOrdersCsv(request, env, ctx);
      }

      if (path === '/admin/store/orders/import-snipcart' && method === 'POST') {
        const parsedBody = await parseJsonRequestBody(request, env, {
          maxBytes: MAX_ADMIN_SNIPCART_IMPORT_BODY_BYTES,
          privateResponse: true,
          emptyValue: {}
        });
        if (!parsedBody.ok) return parsedBody.response;
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreSnipcartOrderImport(request, env, parsedBody.body || {}, ctx);
      }

      if (path === '/admin/store/attendees.csv' && method === 'GET') {
        return handleAdminStoreAttendeesCsv(request, env, ctx);
      }

      if (path === '/admin/store/reconciliation.csv' && method === 'GET') {
        return handleAdminStoreReconciliationCsv(request, env);
      }

      if (path === '/admin/store/analytics' && method === 'GET') {
        return handleAdminStoreAnalytics(request, env);
      }

      if (path === '/admin/store/marketing/referrals' && method === 'GET') {
        return handleAdminStoreMarketingReferrals(request, env);
      }

      if (path === '/admin/store/marketing/abandoned-checkout/health' && method === 'GET') {
        return handleAdminStoreAbandonedCheckoutHealth(request, env);
      }

      if (path === '/admin/store/marketing/abandoned-checkout/suppression' && method === 'POST') {
        const parsedBody = await parseJsonRequestBody(request, env, {
          maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
          privateResponse: true,
          emptyValue: {}
        });
        if (!parsedBody.ok) return parsedBody.response;
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreAbandonedCheckoutSuppression(request, env, parsedBody.body || {}, true);
      }

      if (path === '/admin/store/marketing/abandoned-checkout/suppression' && method === 'DELETE') {
        const parsedBody = await parseJsonRequestBody(request, env, {
          maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
          privateResponse: true,
          emptyValue: {}
        });
        if (!parsedBody.ok) return parsedBody.response;
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreAbandonedCheckoutSuppression(request, env, parsedBody.body || {}, false);
      }

      if (path === '/admin/store/marketing/referrals' && method === 'POST') {
        const parsedBody = await parseJsonRequestBody(request, env, {
          maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
          privateResponse: true,
          emptyValue: {}
        });
        if (!parsedBody.ok) return parsedBody.response;
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreMarketingReferralSave(request, env, parsedBody.body || {});
      }

      if (path === '/admin/store/marketing/referrals' && method === 'DELETE') {
        const parsedBody = await parseJsonRequestBody(request, env, {
          maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
          privateResponse: true,
          emptyValue: {}
        });
        if (!parsedBody.ok) return parsedBody.response;
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreMarketingReferralDelete(request, env, parsedBody.body || {});
      }

      if (path === '/admin/store/marketing/draft' && method === 'GET') {
        return handleAdminStoreMarketingDraftRead(request, env);
      }

      if (path === '/admin/store/marketing/draft' && method === 'POST') {
        const parsedBody = await parseJsonRequestBody(request, env, {
          maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
          privateResponse: true,
          emptyValue: {}
        });
        if (!parsedBody.ok) return parsedBody.response;
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreMarketingDraftSave(request, env, parsedBody.body || {});
      }

      if (path === '/admin/store/marketing/draft' && method === 'DELETE') {
        const parsedBody = await parseJsonRequestBody(request, env, {
          maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
          privateResponse: true,
          emptyValue: {}
        });
        if (!parsedBody.ok) return parsedBody.response;
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreMarketingDraftDelete(request, env, parsedBody.body || {});
      }

      if (path === '/admin/store/products' && method === 'GET') {
        return handleAdminStoreProducts(request, env);
      }

      if (path === '/admin/store/products/media' && method === 'GET') {
        return handleAdminStoreProductMedia(request, env);
      }

      if (path === '/admin/store/products/address-lookup' && method === 'GET') {
        const rl = await checkRateLimit(request, env, {
          ...RATE_LIMITS.adminAddressLookup,
          privateResponse: true
        });
        if (!rl.allowed) return rl.response;
        return handleAdminStoreProductAddressLookup(request, env);
      }

      if (path === '/admin/store/products/preview' && method === 'POST') {
        const rl = await checkRateLimit(request, env, ADMIN_PRODUCT_PREVIEW_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreProductPreview(request, env);
      }

      if (path === '/admin/store/products/publish' && method === 'POST') {
        const rl = await checkRateLimit(request, env, ADMIN_PRODUCT_PUBLISH_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreProductPublish(request, env);
      }

      if (path === '/admin/store/products/bulk-publish' && method === 'POST') {
        const rl = await checkRateLimit(request, env, ADMIN_PRODUCT_PUBLISH_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreProductBulkPublish(request, env);
      }

      if (path === '/admin/store/products/order' && method === 'POST') {
        const rl = await checkRateLimit(request, env, ADMIN_PRODUCT_PUBLISH_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreProductOrderPublish(request, env);
      }

      if (path === '/admin/store/coupons' && method === 'GET') {
        return handleAdminStoreCoupons(request, env);
      }

      if (path === '/admin/store/coupons' && method === 'POST') {
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreCouponSave(request, env);
      }

      if (path === '/admin/store/coupons/delete' && method === 'POST') {
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreCouponDelete(request, env);
      }

      if (path === '/admin/store/downloads' && method === 'GET') {
        return handleAdminStoreDownloads(request, env);
      }

      if (path === '/admin/store/downloads/upload' && method === 'POST') {
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreDownloadUpload(request, env);
      }

      if (path === '/admin/store/downloads/create' && method === 'POST') {
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreDownloadCreate(request, env);
      }

      if (path === '/admin/store/downloads/delete' && method === 'POST') {
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreDownloadDelete(request, env);
      }

      if (path === '/admin/store/inventory' && method === 'GET') {
        return handleAdminStoreInventory(request, env);
      }

      if (path === '/admin/store/inventory' && method === 'POST') {
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreInventoryMutation(request, env);
      }

      if (path === '/admin/store/orders/download-access' && method === 'POST') {
        const parsedBody = await parseJsonRequestBody(request, env, {
          maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
          privateResponse: true,
          emptyValue: {}
        });
        if (!parsedBody.ok) return parsedBody.response;
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreOrderDownloadAccess(request, env, parsedBody.body || {}, ctx);
      }

      if (path === '/admin/store/orders/check-in' && method === 'POST') {
        const parsedBody = await parseJsonRequestBody(request, env, {
          maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
          privateResponse: true,
          emptyValue: {}
        });
        if (!parsedBody.ok) return parsedBody.response;
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminStoreOrderCheckIn(request, env, parsedBody.body || {}, ctx);
      }

      if (path === '/admin/add-ons/inventory' && method === 'GET') {
        return handleAdminAddOnInventory(request, env);
      }

      if (path === '/admin/add-ons/inventory' && method === 'POST') {
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminAddOnInventoryMutation(request, env);
      }

      if ((path === '/api/cart/validate' || path === '/cart/validate') && method === 'POST') {
        const bodyLimit = requireBodySizeWithinLimit(request, env, MAX_STANDARD_JSON_BODY_BYTES, { privateResponse: true });
        if (!bodyLimit.ok) return bodyLimit.response;
        const rl = await checkRateLimit(request, env, {
          ...RATE_LIMITS.cartValidate,
          privateResponse: true
        });
        if (!rl.allowed) return rl.response;
        return withObservedOperation(env, ctx, 'store_cart_validate', () => handleStoreCartValidate(request, env));
      }

      if ((path === '/api/checkout/intent' || path === '/checkout/intent') && method === 'POST') {
        const bodyLimit = requireBodySizeWithinLimit(request, env, MAX_STANDARD_JSON_BODY_BYTES, { privateResponse: true });
        if (!bodyLimit.ok) return bodyLimit.response;
        return withObservedOperation(env, ctx, 'store_checkout_intent', () => handleStoreCheckoutIntent(request, env, ctx));
      }

      if (path === '/abandoned-cart/unsubscribe' && method === 'GET') {
        return handleAbandonedCartUnsubscribe(request, env);
      }

      if (path === '/abandoned-cart/resume' && method === 'GET') {
        const rl = await checkRateLimit(request, env, {
          ...RATE_LIMITS.orderRead,
          privateResponse: true
        });
        if (!rl.allowed) return rl.response;
        return handleAbandonedCartResume(request, env);
      }

      if (path === '/api/orders/lookup' && method === 'POST') {
        const bodyLimit = requireBodySizeWithinLimit(request, env, MAX_STANDARD_JSON_BODY_BYTES, { privateResponse: true });
        if (!bodyLimit.ok) return bodyLimit.response;
        const rl = await checkRateLimit(request, env, {
          ...RATE_LIMITS.orderLookup,
          privateResponse: true
        });
        if (!rl.allowed) return rl.response;
        return withObservedOperation(env, ctx, 'store_order_lookup_request', () => handleStoreOrderLookupRequest(request, env, ctx));
      }

      if (path === '/api/orders/lookup' && method === 'GET') {
        const rl = await checkRateLimit(request, env, {
          ...RATE_LIMITS.orderLookup,
          privateResponse: true
        });
        if (!rl.allowed) return rl.response;
        return withObservedOperation(env, ctx, 'store_order_lookup_consume', () => handleStoreOrderLookupConsume(request, env));
      }

      const storeOrderRoute = matchStoreOrderRoute(path);
      if (storeOrderRoute && method === 'GET') {
        const rl = await checkRateLimit(request, env, {
          ...RATE_LIMITS.orderRead,
          privateResponse: true
        });
        if (!rl.allowed) return rl.response;
        return withObservedOperation(env, ctx, 'store_order_fulfillment', () => handleStoreOrderRoute(request, env, storeOrderRoute));
      }

      if (path === '/shipping/quote' && method === 'POST') {
        const bodyLimit = requireBodySizeWithinLimit(request, env, MAX_STANDARD_JSON_BODY_BYTES, { privateResponse: true });
        if (!bodyLimit.ok) return bodyLimit.response;
        return withObservedOperation(env, ctx, 'shipping_quote', () => handleShippingQuote(request, env));
      }

      if (path === '/tax/quote' && method === 'POST') {
        const bodyLimit = requireBodySizeWithinLimit(request, env, MAX_STANDARD_JSON_BODY_BYTES, { privateResponse: true });
        if (!bodyLimit.ok) return bodyLimit.response;
        return withObservedOperation(env, ctx, 'tax_quote', () => handleTaxQuote(request, env));
      }

      if (path === '/webhooks/stripe' && method === 'POST') {
        const bodyLimit = requireBodySizeWithinLimit(request, env, MAX_STRIPE_WEBHOOK_BODY_BYTES);
        if (!bodyLimit.ok) return bodyLimit.response;
        return handleStripeWebhook(request, env, ctx);
      }

      if (path === '/admin/rebuild' && method === 'POST') {
        const bodyLimit = requireBodySizeWithinLimit(request, env, MAX_STANDARD_JSON_BODY_BYTES);
        if (!bodyLimit.ok) return bodyLimit.response;
        // SEC-005: Rate limit admin endpoints aggressively
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleAdminRebuild(request, env);
      }

      if (path === '/add-ons/inventory' && method === 'GET') {
        return handleGetAddOnInventory(env);
      }

      // Admin: Check cron heartbeat status
      if (path === '/admin/cron/status' && method === 'GET') {
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleCronStatus(request, env);
      }

      if (path === '/admin/observability/webhooks' && method === 'GET') {
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handleWebhookObservability(request, env);
      }

      if (path === '/admin/observability/performance' && method === 'GET') {
        const rl = await checkRateLimit(request, env, ADMIN_RATE_LIMIT_OPTIONS);
        if (!rl.allowed) return rl.response;
        return handlePerformanceObservability(request, env);
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  },

  // Cron trigger:
  // - `* * * * *`: Store background maintenance.
  async scheduled(event, env) {
    configureWorkerLogging(env);
    const now = new Date();
    const cronExpression = String(event?.cron || '');
    console.log('Scheduled Store task triggered:', now.toISOString());

    if (env.STORE_STATE && shouldRecordCronHeartbeat(cronExpression, now)) {
      await env.STORE_STATE.put('cron:lastRun', now.toISOString(), { expirationTtl: 172800 });
    }

    try {
      const abandonedCartResults = await processAbandonedCartFollowups(env, now);
      if (env.STORE_STATE && abandonedCartResults.attempted) {
        await env.STORE_STATE.put('cron:lastAbandonedCartRun', now.toISOString(), { expirationTtl: 172800 });
      }
      console.log('Store abandoned checkout reminder cron complete:', abandonedCartResults);
    } catch (err) {
      console.error('Store abandoned checkout reminder cron failed:', err);
      if (env.STORE_STATE) {
        await env.STORE_STATE.put('cron:lastError', JSON.stringify({
          at: new Date().toISOString(),
          error: err?.message || String(err)
        }), { expirationTtl: 604800 });
      }
    }

    try {
      const eventReminderResults = await processStoreEventReminders(env, now);
      if (env.STORE_STATE && eventReminderResults.attempted) {
        await env.STORE_STATE.put('cron:lastEventReminderRun', now.toISOString(), { expirationTtl: 172800 });
      }
      console.log('Store event reminder cron complete:', eventReminderResults);
    } catch (err) {
      console.error('Store event reminder cron failed:', err);
      if (env.STORE_STATE) {
        await env.STORE_STATE.put('cron:lastError', JSON.stringify({
          at: new Date().toISOString(),
          error: err?.message || String(err)
        }), { expirationTtl: 604800 });
      }
    }
  }
};

function parseTimestampMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function getStoreOrderEmailSentKey(orderToken) {
  return `store-order-email-sent:${String(orderToken || '').trim()}`;
}

async function buildStoreOrderEmailPayload(env, storedOrder = {}) {
  const orderDraft = storedOrder.orderDraft || {};
  const email = String(orderDraft.customer?.email || '').trim().toLowerCase();
  if (!email || !isValidEmail(email)) return null;
  const attachments = isStoreOrderFulfillmentReady(storedOrder)
    ? await buildStoreOrderEventEmailAttachments(env, storedOrder, { calendarMethod: 'REQUEST' })
    : [];

  return {
    email,
    orderToken: storedOrder.orderToken || orderDraft.orderToken || '',
    orderDraft,
    payment: storedOrder.payment || {},
    preferredLang: orderDraft.preferredLang || storedOrder.preferredLang || DEFAULT_I18N_LANG,
    attachments
  };
}

async function updateStoreOrderEmailDeliveryState(env, orderToken, updates = {}) {
  const normalizedOrderToken = String(orderToken || '').trim();
  if (!env.STORE_STATE || !normalizedOrderToken || !updates || typeof updates !== 'object') return;

  const storageKey = getStoreOrderStorageKey(normalizedOrderToken);
  if (!storageKey) return;

  const storedOrder = await env.STORE_STATE.get(storageKey, { type: 'json' });
  if (!storedOrder) return;

  await env.STORE_STATE.put(storageKey, JSON.stringify({
    ...storedOrder,
    ...updates,
    updatedAt: updates.updatedAt || storedOrder.updatedAt || new Date().toISOString()
  }));
}

async function attemptStoreOrderEmailDelivery(env, storedOrder = {}) {
  const orderToken = String(storedOrder.orderToken || storedOrder.orderDraft?.orderToken || '').trim();
  if (!env?.RESEND_API_KEY && !storeEmailDryRunEnabled(env)) {
    return { ok: true, skipped: 'email_not_configured' };
  }

  const payload = await buildStoreOrderEmailPayload(env, storedOrder);
  if (!orderToken || !payload) {
    return { ok: true, skipped: 'missing_email' };
  }

  const sentKey = getStoreOrderEmailSentKey(orderToken);
  if (env.STORE_STATE && await env.STORE_STATE.get(sentKey)) {
    return { ok: true, skipped: 'already_sent' };
  }

  try {
    const result = await sendStoreOrderEmail(env, payload);
    if (result?.sent === false) {
      throw new Error(result.reason || 'Store order email was not sent');
    }

    const sentAt = new Date().toISOString();
    if (env.STORE_STATE) {
      await env.STORE_STATE.put(sentKey, 'sent', { expirationTtl: 30 * 24 * 60 * 60 });
    }
    await updateStoreOrderEmailDeliveryState(env, orderToken, {
      emailSent: true,
      emailDryRun: result?.dryRun === true,
      emailError: null,
      emailSentAt: sentAt,
      updatedAt: sentAt
    });

    return { ok: true };
  } catch (err) {
    const failedAt = new Date().toISOString();
    const message = err?.message || 'Unknown Store order email error';
    await updateStoreOrderEmailDeliveryState(env, orderToken, {
      emailSent: false,
      emailError: message,
      emailAttemptedAt: failedAt,
      updatedAt: failedAt
    });

    return { ok: false, error: message };
  }
}

function queueStoreOrderEmailDelivery(ctx, env, storedOrder = {}) {
  const orderToken = String(storedOrder.orderToken || storedOrder.orderDraft?.orderToken || '').trim();
  queueBackgroundTask(
    ctx,
    attemptStoreOrderEmailDelivery(env, storedOrder).then((result) => {
      if (result && result.ok === false) {
        console.error('Store order email failed:', {
          orderToken,
          error: result.error
        });
      }
    }),
    `store order email (${orderToken || 'unknown'})`
  );
}

function logStoreOrderEmailDeliveryFailure(label, orderToken, result) {
  if (result && result.ok === false) {
    console.error(`${label} failed:`, {
      orderToken,
      error: result.error
    });
  }
}

function queueStoreOrderEmailDeliveries(ctx, env, storedOrder = {}) {
  const orderToken = String(storedOrder.orderToken || storedOrder.orderDraft?.orderToken || '').trim();
  queueBackgroundTask(
    ctx,
    (async () => {
      const customerResult = await attemptStoreOrderEmailDelivery(env, storedOrder).catch((err) => ({
        ok: false,
        error: err?.message || 'Unknown Store order email error'
      }));
      logStoreOrderEmailDeliveryFailure('Store order email', orderToken, customerResult);

      const adminResult = await attemptStoreOrderAdminNotificationDelivery(env, storedOrder).catch((err) => ({
        ok: false,
        error: err?.message || 'Unknown Store order admin notification error'
      }));
      logStoreOrderEmailDeliveryFailure('Store order admin notification', orderToken, adminResult);
    })(),
    `store order email deliveries (${orderToken || 'unknown'})`
  );
}

function getStoreOrderAdminEmailSentKey(orderToken, emailHash) {
  return `store-order-admin-email-sent:${String(orderToken || '').trim()}:${String(emailHash || '').trim().toLowerCase()}`;
}

async function getStoreOrderSuperAdminRecipients(env) {
  const users = await getEffectiveAdminUsers(env);
  return Array.from(new Set((Array.isArray(users) ? users : [])
    .filter((user) => user?.role === 'super_admin')
    .map((user) => normalizeStoreOrderLookupEmail(user.email))
    .filter(Boolean)));
}

async function buildStoreOrderAdminNotificationPayloads(env, storedOrder = {}) {
  const recipients = await getStoreOrderSuperAdminRecipients(env);
  const orderDraft = storedOrder.orderDraft || {};
  return recipients.map((email) => ({
    email,
    orderToken: storedOrder.orderToken || orderDraft.orderToken || '',
    orderDraft,
    payment: storedOrder.payment || {},
    preferredLang: orderDraft.preferredLang || storedOrder.preferredLang || DEFAULT_I18N_LANG
  }));
}

async function buildAuthenticatedStoreOrderAdminNotificationPayload(env, payload = {}) {
  const adminUrl = await createAdminLoginUrl(env, {
    email: payload.email,
    preferredLang: payload.preferredLang || DEFAULT_I18N_LANG,
    params: { tab: 'store-orders' },
    source: 'store_order_admin_notification'
  });
  if (!adminUrl) {
    throw new Error('Authenticated admin order link could not be created');
  }
  return { ...payload, adminUrl };
}

async function attemptStoreOrderAdminNotificationDelivery(env, storedOrder = {}) {
  const orderToken = String(storedOrder.orderToken || storedOrder.orderDraft?.orderToken || '').trim();
  if (!env?.RESEND_API_KEY && !storeEmailDryRunEnabled(env)) {
    return { ok: true, skipped: 'email_not_configured' };
  }
  if (!orderToken) {
    return { ok: true, skipped: 'missing_order_token' };
  }

  const payloads = await buildStoreOrderAdminNotificationPayloads(env, storedOrder);
  if (!payloads.length) {
    return { ok: true, skipped: 'missing_super_admin_recipients' };
  }

  const sent = [];
  const skipped = [];
  const failed = [];

  for (const payload of payloads) {
    const emailHash = await sha256HexString(payload.email);
    const sentKey = getStoreOrderAdminEmailSentKey(orderToken, emailHash);
    if (env.STORE_STATE && await env.STORE_STATE.get(sentKey)) {
      skipped.push(payload.email);
      continue;
    }

    try {
      const authenticatedPayload = await buildAuthenticatedStoreOrderAdminNotificationPayload(env, payload);
      const result = await sendStoreOrderAdminNotificationEmail(env, authenticatedPayload);
      if (result?.sent === false) {
        throw new Error(result.reason || 'Store order admin notification was not sent');
      }
      if (env.STORE_STATE) {
        await env.STORE_STATE.put(sentKey, 'sent', { expirationTtl: 30 * 24 * 60 * 60 });
      }
      sent.push({
        email: payload.email,
        dryRun: result?.dryRun === true
      });
    } catch (err) {
      failed.push({
        email: payload.email,
        error: err?.message || 'Unknown Store order admin notification error'
      });
    }
  }

  const sentEmails = sent.map((entry) => entry.email);
  const notified = Array.from(new Set([...sentEmails, ...skipped]));
  const now = new Date().toISOString();
  await updateStoreOrderEmailDeliveryState(env, orderToken, {
    adminNotificationEmailSent: notified.length > 0 && failed.length === 0,
    adminNotificationEmailRecipients: notified,
    adminNotificationEmailSkippedRecipients: skipped,
    adminNotificationEmailErrors: failed,
    adminNotificationEmailAttemptedAt: now,
    ...(sent.length ? { adminNotificationEmailDryRun: sent.every((entry) => entry.dryRun === true) } : {}),
    ...(sent.length ? { adminNotificationEmailSentAt: now } : {}),
    updatedAt: now
  });

  if (failed.length) {
    return {
      ok: false,
      error: failed.map((failure) => `${failure.email}: ${failure.error}`).join('; '),
      sent,
      failed
    };
  }

  return { ok: true, sent: sentEmails, skipped };
}

function queueStoreOrderAdminNotificationDelivery(ctx, env, storedOrder = {}) {
  const orderToken = String(storedOrder.orderToken || storedOrder.orderDraft?.orderToken || '').trim();
  queueBackgroundTask(
    ctx,
    attemptStoreOrderAdminNotificationDelivery(env, storedOrder).then((result) => {
      if (result && result.ok === false) {
        console.error('Store order admin notification failed:', {
          orderToken,
          error: result.error
        });
      }
    }),
    `store order admin notification (${orderToken || 'unknown'})`
  );
}

const STORE_ORDER_TOKEN_PATTERN = /^store-order-[a-z0-9_-]+$/i;
const STORE_ORDER_EMAIL_INDEX_TTL_SECONDS = 400 * 24 * 60 * 60;
const STORE_ORDER_EMAIL_INDEX_LIMIT = 50;
const STORE_ORDER_EMAIL_INDEX_PREFIX = 'store-order-email:';
const STORE_ORDER_LOOKUP_TOKEN_PREFIX = 'store-order-lookup:';
const STORE_ORDER_LOOKUP_TOKEN_TTL_SECONDS = 15 * 60;
const STORE_ORDER_LOOKUP_SCOPE = 'store_order_lookup';
const STORE_FULFILLMENT_TOKEN_TTL_SECONDS = 72 * 60 * 60;
const STORE_EVENT_ADDRESS_LOOKUP_CACHE_PREFIX = 'store-event-address-lookup:';
const STORE_EVENT_ADDRESS_LOOKUP_CACHE_TTL_SECONDS = 24 * 60 * 60;

function normalizeStoreOrderLookupEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email && isValidEmail(email) ? email : '';
}

async function sha256HexString(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getStoreOrderEmailIndexKey(emailHash) {
  const normalizedHash = String(emailHash || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalizedHash) ? `${STORE_ORDER_EMAIL_INDEX_PREFIX}${normalizedHash}` : '';
}

async function getStoreOrderEmailHash(email) {
  const normalizedEmail = normalizeStoreOrderLookupEmail(email);
  return normalizedEmail ? sha256HexString(normalizedEmail) : '';
}

function getStoreOrderLookupTokenKey(jti) {
  const normalizedJti = String(jti || '').trim().toLowerCase();
  return /^[a-z0-9_-]{8,96}$/.test(normalizedJti) ? `${STORE_ORDER_LOOKUP_TOKEN_PREFIX}${normalizedJti}` : '';
}

function createStoreOrderLookupJti() {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID().toLowerCase();
  }

  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64urlEncodeBytes(bytes).toLowerCase();
}

function getStoreOrderLookupSecret(env = {}) {
  return String(
    env.STORE_ORDER_LOOKUP_SECRET ||
    env.STORE_FULFILLMENT_SECRET ||
    env.MAGIC_LINK_SECRET ||
    env.STORE_DOWNLOAD_SECRET ||
    ''
  ).trim();
}

function getAbandonedCartKey(orderToken) {
  return `${ABANDONED_CART_PREFIX}${String(orderToken || '').trim()}`;
}

function getAbandonedCartResumeKey(orderToken) {
  return `${ABANDONED_CART_RESUME_PREFIX}${String(orderToken || '').trim()}`;
}

function getAbandonedCartSentKey(emailHash, cartHash) {
  return `${ABANDONED_CART_SENT_PREFIX}${String(emailHash || '').trim()}:${String(cartHash || '').trim()}`;
}

function getAbandonedCartSuppressionKey(emailHash) {
  return `${ABANDONED_CART_SUPPRESSED_PREFIX}${String(emailHash || '').trim()}`;
}

function getAbandonedCartTokenSecret(env = {}) {
  return String(
    env.ABANDONED_CART_TOKEN_SECRET ||
    env.CHECKOUT_INTENT_SECRET ||
    env.MAGIC_LINK_SECRET ||
    ''
  ).trim();
}

function getAbandonedCartDelayMs(env = {}) {
  const raw = Number.parseInt(String(env.ABANDONED_CART_DELAY_MS || ''), 10);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(raw, 7 * 24 * 60 * 60 * 1000);
  return ABANDONED_CART_DEFAULT_DELAY_MS;
}

function getAbandonedCartBatchSize(env = {}) {
  const raw = Number.parseInt(String(env.ABANDONED_CART_BATCH_SIZE || ''), 10);
  return Math.max(1, Math.min(100, Number.isFinite(raw) ? raw : ABANDONED_CART_DEFAULT_BATCH_SIZE));
}

function stableJsonStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(',')}}`;
}

function normalizeAbandonedCartEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email && isValidEmail(email) ? email : '';
}

function emptyAbandonedCartHealth() {
  return {
    version: 1,
    updatedAt: '',
    queue: {
      hasPending: false,
      nextDueAt: '',
      updatedAt: ''
    },
    totals: {
      queued: 0,
      pending: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      suppressed: 0,
      completed: 0,
      alreadySent: 0,
      invalid: 0
    },
    recentOutcomes: []
  };
}

function publicAbandonedCartOutcome(outcome = {}) {
  if (!outcome || typeof outcome !== 'object') return null;
  const type = String(outcome.type || '').trim();
  const reason = String(outcome.reason || '').trim();
  if (!type) return null;
  const publicOutcome = {
    at: String(outcome.at || ''),
    type,
    reason,
    itemCount: Math.max(0, Number(outcome.itemCount || 0) || 0),
    totalCents: Math.max(0, Number(outcome.totalCents || 0) || 0)
  };
  const email = normalizeAbandonedCartEmail(outcome.email);
  const emailHash = String(outcome.emailHash || '').trim().toLowerCase();
  if (type === 'suppressed' && reason === 'admin_suppression' && email) publicOutcome.email = email;
  if (type === 'suppressed' && reason === 'admin_suppression' && /^[a-f0-9]{64}$/.test(emailHash)) {
    publicOutcome.emailHash = emailHash;
  }
  return publicOutcome;
}

function normalizeAbandonedCartHealth(value) {
  const base = emptyAbandonedCartHealth();
  if (!value || typeof value !== 'object') return base;
  const totals = { ...base.totals };
  for (const key of Object.keys(totals)) {
    totals[key] = Math.max(0, Number(value?.totals?.[key] || 0) || 0);
  }
  return {
    version: 1,
    updatedAt: String(value.updatedAt || ''),
    queue: {
      hasPending: value?.queue?.hasPending === true,
      nextDueAt: String(value?.queue?.nextDueAt || ''),
      updatedAt: String(value?.queue?.updatedAt || '')
    },
    totals,
    recentOutcomes: Array.isArray(value.recentOutcomes)
      ? value.recentOutcomes.slice(0, 20).map(publicAbandonedCartOutcome).filter(Boolean)
      : []
  };
}

function incrementAbandonedCartCounter(target, key, delta = 1) {
  if (!target || !Object.prototype.hasOwnProperty.call(target, key)) return;
  target[key] = Math.max(0, Number(target[key] || 0) + delta);
}

function applyAbandonedCartHealthEvent(summary, event = {}) {
  const now = String(event.at || new Date().toISOString());
  const type = String(event.type || '').trim();
  const reason = String(event.reason || '').trim();
  const counter = String(event.counter || '').trim();
  const pendingDelta = Number(event.pendingDelta || 0) || 0;

  summary.updatedAt = now;
  if (event.queue) {
    summary.queue = {
      hasPending: event.queue.hasPending === true,
      nextDueAt: String(event.queue.nextDueAt || ''),
      updatedAt: now
    };
  }
  if (counter) incrementAbandonedCartCounter(summary.totals, counter, 1);
  if (pendingDelta) incrementAbandonedCartCounter(summary.totals, 'pending', pendingDelta);
  if (type) {
    const record = event.record || {};
    const outcome = publicAbandonedCartOutcome({
      at: now,
      type,
      reason,
      email: event.email || record.email || '',
      emailHash: event.emailHash || record.emailHash || '',
      itemCount: event.itemCount ?? record.itemCount,
      totalCents: event.totalCents ?? record.amountCents
    });
    if (outcome) summary.recentOutcomes = [outcome, ...(summary.recentOutcomes || [])].slice(0, 20);
  }
}

async function updateAbandonedCartHealth(env, event = {}) {
  if (!env?.STORE_STATE) return null;
  const summary = normalizeAbandonedCartHealth(
    await env.STORE_STATE.get(ABANDONED_CART_HEALTH_KEY, { type: 'json' })
  );
  for (const item of Array.isArray(event) ? event : [event]) {
    applyAbandonedCartHealthEvent(summary, item || {});
  }
  await env.STORE_STATE.put(ABANDONED_CART_HEALTH_KEY, JSON.stringify(summary), {
    expirationTtl: ABANDONED_CART_SENT_TTL_SECONDS
  });
  return summary;
}

function normalizeAbandonedCartQueueState(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    hasPending: value.hasPending === true,
    nextDueAt: String(value.nextDueAt || '')
  };
}

async function writeAbandonedCartQueueState(env, hasPending, nextDueAt = '') {
  if (!env?.STORE_STATE) return;
  await env.STORE_STATE.put(ABANDONED_CART_QUEUE_STATE_KEY, JSON.stringify({
    version: 1,
    hasPending: hasPending === true,
    nextDueAt: hasPending === true ? String(nextDueAt || '') : '',
    updatedAt: new Date().toISOString()
  }), {
    expirationTtl: hasPending === true ? ABANDONED_CART_TTL_SECONDS : IDLE_QUEUE_RECHECK_TTL_SECONDS
  });
}

function normalizeStoreEventReminderQueueState(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    hasPending: value.hasPending === true,
    nextDueAt: String(value.nextDueAt || '')
  };
}

async function writeStoreEventReminderQueueState(env, hasPending, nextDueAt = '') {
  if (!env?.STORE_STATE) return;
  await env.STORE_STATE.put(STORE_EVENT_REMINDER_QUEUE_STATE_KEY, JSON.stringify({
    version: 1,
    hasPending: hasPending === true,
    nextDueAt: hasPending === true ? String(nextDueAt || '') : '',
    updatedAt: new Date().toISOString()
  }), {
    expirationTtl: hasPending === true ? STORE_EVENT_REMINDER_TTL_SECONDS : IDLE_QUEUE_RECHECK_TTL_SECONDS
  });
}

function getStoreEventReminderBatchSize(env = {}) {
  const raw = Number.parseInt(String(env.STORE_EVENT_REMINDER_BATCH_SIZE || ''), 10);
  return Math.max(1, Math.min(100, Number.isFinite(raw) ? raw : STORE_EVENT_REMINDER_DEFAULT_BATCH_SIZE));
}

function getStoreEventReminderKey(record = {}) {
  const dueMs = parseTimestampMs(record.sendAfter) || 0;
  return `${STORE_EVENT_REMINDER_PREFIX}${String(dueMs).padStart(13, '0')}:${normalizeStoreFulfillmentId(record.orderToken)}:${normalizeStoreFulfillmentId(record.itemId)}:${normalizeStoreFulfillmentId(record.offsetKey)}`;
}

function getStoreEventReminderSentKey(orderToken, itemId, offsetKey) {
  return `${STORE_EVENT_REMINDER_SENT_PREFIX}${normalizeStoreFulfillmentId(orderToken)}:${normalizeStoreFulfillmentId(itemId)}:${normalizeStoreFulfillmentId(offsetKey)}`;
}

function buildStoreOrderSuccessUrl(env = {}, orderToken = '') {
  const siteBase = getSiteBase(env) || getWorkerBase(env) || DEFAULT_SITE_BASE;
  try {
    const url = new URL('/order-success/', siteBase);
    if (orderToken) url.searchParams.set('orderToken', orderToken);
    return url.href;
  } catch {
    return '';
  }
}

function getStoreEventReminderRetryDelayMs(attempts) {
  return Math.min(
    24 * 60 * 60 * 1000,
    Math.max(15 * 60 * 1000, (2 ** Math.min(Number(attempts || 0) || 0, 6)) * 15 * 60 * 1000)
  );
}

async function buildStoreEventReminderRecords(storedOrder = {}, now = new Date()) {
  const orderDraft = storedOrder.orderDraft || {};
  const orderToken = String(storedOrder.orderToken || orderDraft.orderToken || '').trim();
  const email = normalizeAbandonedCartEmail(orderDraft.customer?.email);
  const items = Array.isArray(orderDraft.items) ? orderDraft.items : [];
  const nowMs = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  if (!orderToken || !email || !isStoreOrderFulfillmentReady(storedOrder)) return [];

  const emailHash = await sha256HexString(email);
  const records = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index] || {};
    if (!isStoreTicketLikeItem(item)) continue;

    const event = summarizeStoreEventDetails(item.eventDetails);
    const startsAtMs = parseTimestampMs(event?.startsAt);
    if (!Number.isFinite(startsAtMs) || startsAtMs <= nowMs) continue;

    const itemId = getStoreFulfillmentId(item, index);
    for (const offset of STORE_EVENT_REMINDER_OFFSETS) {
      const sendAfterMs = startsAtMs - offset.ms;
      if (sendAfterMs <= nowMs) continue;
      records.push({
        version: 1,
        status: 'pending',
        orderToken,
        itemId,
        email,
        emailHash,
        preferredLang: orderDraft.preferredLang || storedOrder.preferredLang || DEFAULT_I18N_LANG,
        productId: item.productId || '',
        variantId: item.variantId || '',
        sku: item.sku || '',
        eventTitle: item.name || item.sku || 'Store event',
        startsAt: event?.startsAt || '',
        endsAt: event?.endsAt || '',
        venue: event?.venue || '',
        address: event?.address || '',
        quantity: Math.max(1, Number(item.quantity || 1) || 1),
        offsetKey: offset.key,
        offsetLabel: offset.label,
        sendAfter: new Date(sendAfterMs).toISOString(),
        createdAt: new Date(nowMs).toISOString(),
        attempts: 0,
        lastError: ''
      });
    }
  }
  return records;
}

async function queueStoreEventReminders(env, storedOrder = {}, now = new Date()) {
  if (!env?.STORE_STATE) return { queued: 0, skipped: 0 };
  const records = await buildStoreEventReminderRecords(storedOrder, now);
  let queued = 0;
  let skipped = 0;
  let nextDueAt = '';

  for (const record of records) {
    const sentKey = getStoreEventReminderSentKey(record.orderToken, record.itemId, record.offsetKey);
    if (await env.STORE_STATE.get(sentKey)) {
      skipped += 1;
      continue;
    }
    const key = getStoreEventReminderKey(record);
    await env.STORE_STATE.put(key, JSON.stringify(record), { expirationTtl: STORE_EVENT_REMINDER_TTL_SECONDS });
    queued += 1;
    if (!nextDueAt || Date.parse(record.sendAfter) < Date.parse(nextDueAt)) nextDueAt = record.sendAfter;
  }

  if (queued > 0) await writeStoreEventReminderQueueState(env, true, nextDueAt);
  return { queued, skipped, nextDueAt };
}

function queueStoreEventRemindersQuietly(ctx, env, storedOrder = {}) {
  const orderToken = String(storedOrder.orderToken || storedOrder.orderDraft?.orderToken || '').trim();
  queueBackgroundTask(
    ctx,
    queueStoreEventReminders(env, storedOrder).catch((error) => {
      console.error('Store event reminder queue failed:', {
        orderToken,
        error: error?.message || String(error)
      });
    }),
    `store event reminders (${orderToken || 'unknown'})`
  );
}

async function processStoreEventReminders(env, now = new Date()) {
  if (!env?.STORE_STATE) {
    return { attempted: false, sent: 0, skipped: 0, failed: 0, checked: 0, skippedReason: 'storage_not_configured' };
  }
  const queueState = normalizeStoreEventReminderQueueState(
    await env.STORE_STATE.get(STORE_EVENT_REMINDER_QUEUE_STATE_KEY, { type: 'json' })
  );
  if (queueState && !queueState.hasPending) {
    return { attempted: false, sent: 0, skipped: 0, failed: 0, checked: 0, skippedReason: 'idle' };
  }
  const nextDueMs = queueState?.nextDueAt ? Date.parse(queueState.nextDueAt) : 0;
  if (Number.isFinite(nextDueMs) && nextDueMs > now.getTime()) {
    return { attempted: false, sent: 0, skipped: 0, failed: 0, checked: 0, skippedReason: 'not_due', nextDueAt: queueState.nextDueAt };
  }

  const listing = await env.STORE_STATE.list({
    prefix: STORE_EVENT_REMINDER_PREFIX,
    limit: getStoreEventReminderBatchSize(env)
  });
  const keys = Array.isArray(listing?.keys) ? listing.keys : [];
  const results = { attempted: keys.length > 0, sent: 0, skipped: 0, failed: 0, checked: 0 };
  let hasPending = listing?.list_complete === false;
  let nextDueAt = '';

  for (const keyInfo of keys) {
    const key = String(keyInfo?.name || '').trim();
    if (!key) continue;
    const record = await env.STORE_STATE.get(key, { type: 'json' });
    results.checked += 1;

    if (!record?.orderToken || !record?.itemId || !record?.offsetKey || !normalizeAbandonedCartEmail(record.email)) {
      await env.STORE_STATE.delete(key);
      results.skipped += 1;
      continue;
    }

    const sendAfterMs = Date.parse(record.sendAfter || '');
    if (Number.isFinite(sendAfterMs) && sendAfterMs > now.getTime()) {
      hasPending = true;
      if (!nextDueAt || sendAfterMs < Date.parse(nextDueAt)) nextDueAt = new Date(sendAfterMs).toISOString();
      continue;
    }

    const sentKey = getStoreEventReminderSentKey(record.orderToken, record.itemId, record.offsetKey);
    if (await env.STORE_STATE.get(sentKey)) {
      await env.STORE_STATE.delete(key);
      results.skipped += 1;
      continue;
    }

    const storedOrder = await env.STORE_STATE.get(getStoreOrderStorageKey(record.orderToken), { type: 'json' });
    const match = storedOrder ? findStoreFulfillmentItem(storedOrder, record.itemId) : null;
    const item = match?.item || null;
    const event = item ? summarizeStoreEventDetails(item.eventDetails) : null;
    const eventStartMs = parseTimestampMs(event?.startsAt);
    if (!storedOrder || !isStoreOrderFulfillmentReady(storedOrder) || !item || !isStoreTicketLikeItem(item) || !Number.isFinite(eventStartMs) || eventStartMs <= now.getTime()) {
      await env.STORE_STATE.delete(key);
      results.skipped += 1;
      continue;
    }

    try {
      const attachments = await buildStoreEventEmailAttachments(env, storedOrder, item, match.itemId, { calendarMethod: 'REQUEST' });
      const result = await sendStoreEventReminderEmail(env, {
        email: record.email,
        orderToken: record.orderToken,
        orderUrl: buildStoreOrderSuccessUrl(env, record.orderToken),
        eventTitle: item.name || record.eventTitle || 'Store event',
        eventTime: formatStoreEventDisplay(event, env),
        venue: event?.venue || record.venue || '',
        address: event?.address || record.address || '',
        reminderLabel: record.offsetLabel || '',
        preferredLang: record.preferredLang || DEFAULT_I18N_LANG,
        attachments
      });

      if (!result?.sent) throw new Error(result?.reason || 'Event reminder email was not sent');

      await env.STORE_STATE.put(sentKey, now.toISOString(), { expirationTtl: STORE_EVENT_REMINDER_TTL_SECONDS });
      await env.STORE_STATE.delete(key);
      results.sent += 1;
    } catch (error) {
      const attempts = Number(record.attempts || 0) + 1;
      const retryDelayMs = getStoreEventReminderRetryDelayMs(attempts);
      record.attempts = attempts;
      record.lastError = String(error?.message || 'Event reminder send failed').slice(0, 300);
      record.sendAfter = new Date(now.getTime() + retryDelayMs).toISOString();
      await env.STORE_STATE.delete(key);
      await env.STORE_STATE.put(getStoreEventReminderKey(record), JSON.stringify(record), { expirationTtl: STORE_EVENT_REMINDER_TTL_SECONDS });
      hasPending = true;
      nextDueAt = nextDueAt && Date.parse(nextDueAt) < Date.parse(record.sendAfter) ? nextDueAt : record.sendAfter;
      results.failed += 1;
    }
  }

  if (keys.length === 0 && listing?.list_complete !== false) {
    await writeStoreEventReminderQueueState(env, false);
  } else {
    await writeStoreEventReminderQueueState(env, hasPending, nextDueAt);
  }
  return results;
}

async function signAbandonedCartToken(env, payload = {}, ttlDays = 14) {
  const secret = getAbandonedCartTokenSecret(env);
  if (!secret) return '';
  const ttlSeconds = Math.max(60, Math.floor(Number(ttlDays || 14) * 24 * 60 * 60));
  const body = {
    v: 1,
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  };
  const payloadB64 = base64urlEncodeString(JSON.stringify(body));
  const signature = await hmacSha256Bytes(secret, payloadB64);
  return `${payloadB64}.${base64urlEncodeBytes(signature)}`;
}

async function verifyAbandonedCartToken(env, token) {
  const secret = getAbandonedCartTokenSecret(env);
  if (!secret) return { ok: false, status: 503, error: 'Reminder link signing is not configured.' };
  const [payloadB64, signatureB64] = String(token || '').split('.');
  if (!payloadB64 || !signatureB64) return { ok: false, status: 400, error: 'Reminder link is invalid or expired.' };
  const expectedSignature = base64urlEncodeBytes(await hmacSha256Bytes(secret, payloadB64));
  if (!timingSafeEqual(signatureB64, expectedSignature)) {
    return { ok: false, status: 400, error: 'Reminder link is invalid or expired.' };
  }
  let payload;
  try {
    payload = JSON.parse(base64urlDecodeToString(payloadB64));
  } catch {
    return { ok: false, status: 400, error: 'Reminder link is invalid or expired.' };
  }
  if (Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) {
    return { ok: false, status: 410, error: 'Reminder link expired.' };
  }
  return { ok: true, payload };
}

function getAbandonedCartUnsubscribeUrl(env, token) {
  const base = String(getWorkerBase(env) || env.WORKER_BASE || env.SITE_BASE || '').trim() || 'https://checkout.dustwave.xyz';
  const url = new URL('/abandoned-cart/unsubscribe', base);
  url.searchParams.set('t', token);
  return url.toString();
}

function getAbandonedCartResumeUrl(env, token) {
  const base = String(getSiteBase(env) || env.SITE_BASE || '').trim() || 'https://shop.dustwave.xyz';
  const url = new URL('/', base);
  url.searchParams.set('checkoutResume', token);
  return url.toString();
}

function abandonedCartHtmlResponse(title, body, status = 200) {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeXml(title)}</title>
</head>
	<body class="admin-store-product-preview-body">
  <main>
    <h1>${escapeXml(title)}</h1>
    <p>${escapeXml(body)}</p>
  </main>
</body>
</html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': PRIVATE_NO_STORE_CACHE_CONTROL,
      ...SECURITY_HEADERS
    }
  });
}

function buildAbandonedCartResumeItem(item = {}) {
  const productId = String(item.productId || item.sku || '').trim();
  if (!productId) return null;
  const variantId = String(item.variantId || '').trim();
  const customFields = [
    { name: '_product_id', value: productId },
    { name: '_sku', value: String(item.sku || productId) },
    { name: '_product_type', value: String(item.fulfillmentType || item.category || 'physical') }
  ];
  if (variantId) customFields.push({ name: '_variant_id', value: variantId });
  if (item.variantLabel) customFields.push({ name: '_variant_label', value: String(item.variantLabel || '') });
  if (item.category) customFields.push({ name: '_category', value: String(item.category || '') });
  return {
    id: variantId ? `${productId}__${variantId}` : productId,
    name: String(item.name || productId),
    price: Math.max(0, Number(item.unitPriceCents || 0) || 0) / 100,
    quantity: Math.max(1, Number(item.quantity || 1) || 1),
    url: String(item.url || '/'),
    description: '',
    imageUrl: String(item.image || ''),
    stackable: true,
    shippable: item.shippable === true,
    maxQuantity: Number.isFinite(Number(item.inventory?.quantity)) && Number(item.inventory?.quantity) > 0
      ? Number(item.inventory.quantity)
      : undefined,
    customFields
  };
}

function buildAbandonedCartResumeSnapshot(orderDraft = {}) {
  const items = Array.isArray(orderDraft.items)
    ? orderDraft.items.map(buildAbandonedCartResumeItem).filter(Boolean)
    : [];
  if (!items.length) return null;
  return {
    cart: {
      tipPercent: Math.max(0, Number(orderDraft.totals?.tipPercent || 0) || 0),
      tipTouched: Math.max(0, Number(orderDraft.totals?.tipPercent || 0) || 0) > 0,
      items
    },
    savedAt: Date.now()
  };
}

function normalizeResumeAddress(address = {}) {
  const source = address && typeof address === 'object' ? address : {};
  return {
    name: String(source.name || '').trim(),
    line1: String(source.line1 || source.address1 || '').trim(),
    line2: String(source.line2 || source.address2 || '').trim(),
    city: String(source.city || '').trim(),
    state: String(source.state || source.province || '').trim(),
    postalCode: String(source.postalCode || source.postal_code || '').trim(),
    country: String(source.country || '').trim().toUpperCase()
  };
}

function buildAbandonedCartResumeDraft(record = {}) {
  const email = normalizeAbandonedCartEmail(record.email);
  const billingAddress = normalizeResumeAddress(record.billingAddress || {});
  const shippingAddress = normalizeResumeAddress(record.shippingAddress || {});
  const shippingDraft = shippingAddress.country || shippingAddress.postalCode || shippingAddress.line1
    ? {
        name: shippingAddress.name || '',
        address: {
          line1: shippingAddress.line1,
          line2: shippingAddress.line2,
          city: shippingAddress.city,
          state: shippingAddress.state,
          postal_code: shippingAddress.postalCode,
          country: shippingAddress.country || 'US'
        }
      }
    : null;
  return {
    email,
    abandonedCartConsent: true,
    billingAddress,
    customer: email ? { email, name: record.customerName || '' } : {},
    shippingDraft
  };
}

async function getAbandonedCartCartHash(orderDraft = {}) {
  const items = Array.isArray(orderDraft.items) ? orderDraft.items : [];
  const input = items.map((item) => ({
    productId: String(item.productId || ''),
    variantId: String(item.variantId || ''),
    sku: String(item.sku || ''),
    quantity: Math.max(1, Number(item.quantity || 1) || 1),
    unitPriceCents: Math.max(0, Number(item.unitPriceCents || 0) || 0)
  }));
  return sha256HexString(stableJsonStringify(input));
}

async function buildAbandonedCartRecord(env, storedOrder = {}) {
  const orderToken = String(storedOrder.orderToken || storedOrder.orderDraft?.orderToken || '').trim();
  const orderDraft = storedOrder.orderDraft || {};
  const consent = storedOrder.abandonedCart || {};
  const email = normalizeAbandonedCartEmail(consent.email || orderDraft.customer?.email);
  if (!STORE_ORDER_TOKEN_PATTERN.test(orderToken) || consent.consent !== true || !email) return null;
  const resumeSnapshot = buildAbandonedCartResumeSnapshot(orderDraft);
  if (!resumeSnapshot) return null;
  const nowMs = Date.now();
  const emailHash = await sha256HexString(email);
  const cartHash = await getAbandonedCartCartHash(orderDraft);
  const itemCount = Math.max(0, Number(orderDraft.totals?.itemCount || orderDraft.items?.length || 0) || 0);
  return {
    version: 1,
    status: 'pending',
    orderToken,
    email,
    emailHash,
    cartHash,
    preferredLang: orderDraft.preferredLang || DEFAULT_I18N_LANG,
    amountCents: Math.max(0, Number(orderDraft.totals?.totalCents || 0) || 0),
    itemCount,
    customerName: String(orderDraft.customer?.name || ''),
    billingAddress: orderDraft.billingAddress || null,
    shippingAddress: orderDraft.shippingAddress || null,
    resumeSnapshot,
    createdAt: new Date(nowMs).toISOString(),
    sendAfter: new Date(nowMs + getAbandonedCartDelayMs(env)).toISOString(),
    attempts: 0,
    lastError: ''
  };
}

async function queueAbandonedCheckoutFollowup(env, storedOrder = {}) {
  if (!env?.STORE_STATE) return { queued: false, reason: 'storage_not_configured' };
  if (!getAbandonedCartTokenSecret(env)) return { queued: false, reason: 'token_secret_not_configured' };
  const record = await buildAbandonedCartRecord(env, storedOrder);
  if (!record) return { queued: false, reason: 'not_consented' };

  const [suppressed, alreadySent] = await Promise.all([
    env.STORE_STATE.get(getAbandonedCartSuppressionKey(record.emailHash)),
    env.STORE_STATE.get(getAbandonedCartSentKey(record.emailHash, record.cartHash))
  ]);
  if (suppressed || alreadySent) {
    const reason = alreadySent ? 'already_sent' : 'suppressed';
    await updateAbandonedCartHealth(env, {
      type: reason === 'already_sent' ? 'skipped' : 'suppressed',
      reason,
      record,
      counter: reason === 'already_sent' ? 'alreadySent' : 'suppressed'
    });
    return { queued: false, reason };
  }

  await env.STORE_STATE.put(getAbandonedCartKey(record.orderToken), JSON.stringify(record), {
    expirationTtl: ABANDONED_CART_TTL_SECONDS
  });
  await writeAbandonedCartQueueState(env, true, record.sendAfter);
  await updateAbandonedCartHealth(env, {
    type: 'queued',
    reason: 'consented',
    record,
    counter: 'queued',
    pendingDelta: 1,
    queue: { hasPending: true, nextDueAt: record.sendAfter }
  });
  return { queued: true, orderToken: record.orderToken, sendAfter: record.sendAfter };
}

function queueAbandonedCheckoutFollowupQuietly(ctx, env, storedOrder = {}) {
  const orderToken = String(storedOrder.orderToken || storedOrder.orderDraft?.orderToken || '').trim();
  queueBackgroundTask(
    ctx,
    queueAbandonedCheckoutFollowup(env, storedOrder).then((result) => {
      if (result && result.queued === false && !['not_consented', 'suppressed', 'already_sent'].includes(result.reason)) {
        console.warn('Store abandoned checkout reminder was not queued:', {
          orderToken,
          reason: result.reason
        });
      }
    }).catch((err) => {
      console.error('Store abandoned checkout queue failed:', {
        orderToken,
        error: err?.message || String(err)
      });
    }),
    `store abandoned checkout reminder (${orderToken || 'unknown'})`
  );
}

async function deleteAbandonedCheckoutFollowup(env, orderToken, options = {}) {
  if (!env?.STORE_STATE || !orderToken) return;
  const key = getAbandonedCartKey(orderToken);
  const record = await env.STORE_STATE.get(key, { type: 'json' });
  await env.STORE_STATE.delete(key);
  if (options.deleteResume !== false) await env.STORE_STATE.delete(getAbandonedCartResumeKey(orderToken));
  if (record?.orderToken) {
    const reason = String(options.reason || 'completed').trim();
    await updateAbandonedCartHealth(env, {
      type: reason === 'unsubscribed' ? 'suppressed' : 'completed',
      reason,
      record,
      counter: reason === 'unsubscribed' ? 'suppressed' : 'completed',
      pendingDelta: -1
    });
  }
}

async function readAbandonedCartHealthSummary(env) {
  const summary = normalizeAbandonedCartHealth(
    await env.STORE_STATE?.get(ABANDONED_CART_HEALTH_KEY, { type: 'json' })
  );
  const queueState = normalizeAbandonedCartQueueState(
    await env.STORE_STATE?.get(ABANDONED_CART_QUEUE_STATE_KEY, { type: 'json' })
  );
  if (queueState) {
    summary.queue = {
      hasPending: queueState.hasPending === true,
      nextDueAt: queueState.nextDueAt || '',
      updatedAt: summary.queue.updatedAt || ''
    };
  }
  return summary;
}

async function handleAdminStoreAbandonedCheckoutHealth(request, env) {
  const auth = await requireAdminSession(request, env, 'store:read', { accessScope: STORE_ADMIN_SCOPE });
  if (!auth.ok) return auth.response;
  if (!env?.STORE_STATE) return privateJsonResponse({ error: 'Store reminder storage unavailable' }, 503, env);
  const summary = await readAbandonedCartHealthSummary(env);
  return privateJsonResponse({
    user: auth.user,
    scope: STORE_ADMIN_SCOPE,
    queue: summary.queue,
    totals: summary.totals,
    recentOutcomes: summary.recentOutcomes,
    writeBudget: adminReadBudget({ kvListExpected: 0 }),
    generatedAt: new Date().toISOString()
  }, 200, env);
}

async function clearAbandonedCartAdminSuppressionHealth(env, emailHash) {
  if (!env?.STORE_STATE) return null;
  const summary = normalizeAbandonedCartHealth(
    await env.STORE_STATE.get(ABANDONED_CART_HEALTH_KEY, { type: 'json' })
  );
  const before = Array.isArray(summary.recentOutcomes) ? summary.recentOutcomes.length : 0;
  summary.recentOutcomes = (summary.recentOutcomes || []).filter((outcome) => {
    return !(outcome.type === 'suppressed' &&
      outcome.reason === 'admin_suppression' &&
      String(outcome.emailHash || '').trim().toLowerCase() === emailHash);
  });
  if (summary.recentOutcomes.length === before) return summary;
  summary.updatedAt = new Date().toISOString();
  await env.STORE_STATE.put(ABANDONED_CART_HEALTH_KEY, JSON.stringify(summary), {
    expirationTtl: ABANDONED_CART_SENT_TTL_SECONDS
  });
  return summary;
}

async function handleAdminStoreAbandonedCheckoutSuppression(request, env, body = {}, suppress = true) {
  const auth = await requireAdminSession(request, env, 'settings:publish', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;
  if (!env?.STORE_STATE) return privateJsonResponse({ error: 'Store reminder storage unavailable' }, 503, env);

  const bodyEmailHash = String(body.emailHash || '').trim().toLowerCase();
  const canClearByHash = suppress !== true && /^[a-f0-9]{64}$/.test(bodyEmailHash);
  const email = normalizeAbandonedCartEmail(body.email);
  if (!canClearByHash && !email) {
    return privateJsonResponse({ error: 'A valid email is required.' }, 400, env);
  }
  const emailHash = canClearByHash ? bodyEmailHash : await sha256HexString(email);
  const key = getAbandonedCartSuppressionKey(emailHash);
  const now = new Date().toISOString();
  if (suppress) {
    await env.STORE_STATE.put(key, JSON.stringify({
      version: 1,
      email,
      emailHash,
      source: 'admin',
      suppressedAt: now,
      suppressedBy: auth.user.email
    }), { expirationTtl: ABANDONED_CART_SUPPRESSION_TTL_SECONDS });
  } else {
    await env.STORE_STATE.delete(key);
  }

  const auditKey = await recordAdminAuditEvent(env, {
    action: suppress ? 'store_abandoned_checkout:suppression_set' : 'store_abandoned_checkout:suppression_cleared',
    adminEmail: auth.user.email,
    adminRole: auth.user.role,
    emailHash
  });

  if (suppress) {
    await updateAbandonedCartHealth(env, {
      type: 'suppressed',
      reason: 'admin_suppression',
      email,
      emailHash,
      counter: 'suppressed',
      at: now
    });
  } else {
    await clearAbandonedCartAdminSuppressionHealth(env, emailHash);
  }

  return privateJsonResponse({
    success: true,
    suppressed: suppress === true,
    emailHash,
    auditKey,
    writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: auditKey ? 3 : 2, kvListExpected: 0 })
  }, 200, env);
}

async function hasCompletedStoreOrderForAbandonedCart(env, record = {}) {
  if (!env?.STORE_STATE || !STORE_ORDER_TOKEN_PATTERN.test(String(record.orderToken || ''))) return false;
  const storedOrder = await env.STORE_STATE.get(getStoreOrderStorageKey(record.orderToken), { type: 'json' });
  return storedOrder?.status === STORE_ORDER_STATUS_CONFIRMED ||
    storedOrder?.orderDraft?.status === STORE_ORDER_STATUS_CONFIRMED ||
    storedOrder?.payment?.status === 'succeeded';
}

async function processAbandonedCartFollowups(env, now = new Date()) {
  if (!env?.STORE_STATE) {
    return { attempted: false, sent: 0, skipped: 0, failed: 0, checked: 0, skippedReason: 'storage_not_configured' };
  }
  const queueState = normalizeAbandonedCartQueueState(
    await env.STORE_STATE.get(ABANDONED_CART_QUEUE_STATE_KEY, { type: 'json' })
  );
  if (queueState && !queueState.hasPending) {
    return { attempted: false, sent: 0, skipped: 0, failed: 0, checked: 0, skippedReason: 'idle' };
  }
  const nextDueMs = queueState?.nextDueAt ? Date.parse(queueState.nextDueAt) : 0;
  if (Number.isFinite(nextDueMs) && nextDueMs > now.getTime()) {
    return { attempted: false, sent: 0, skipped: 0, failed: 0, checked: 0, skippedReason: 'not_due', nextDueAt: queueState.nextDueAt };
  }

  const listing = await env.STORE_STATE.list({
    prefix: ABANDONED_CART_PREFIX,
    limit: getAbandonedCartBatchSize(env)
  });
  const keys = Array.isArray(listing?.keys) ? listing.keys : [];
  const results = { attempted: keys.length > 0, sent: 0, skipped: 0, failed: 0, checked: 0 };
  let hasPending = listing?.list_complete === false;
  let nextDueAt = '';
  const healthEvents = [];

  for (const keyInfo of keys) {
    const key = String(keyInfo?.name || '').trim();
    if (!key) continue;
    const record = await env.STORE_STATE.get(key, { type: 'json' });
    results.checked += 1;

    if (!record?.orderToken || !record.email || !record.emailHash || !record.cartHash) {
      await env.STORE_STATE.delete(key);
      results.skipped += 1;
      healthEvents.push({ type: 'skipped', reason: 'invalid_record', record, counter: 'invalid', pendingDelta: -1 });
      continue;
    }

    const sendAfterMs = Date.parse(record.sendAfter || '');
    if (Number.isFinite(sendAfterMs) && sendAfterMs > now.getTime()) {
      hasPending = true;
      if (!nextDueAt || sendAfterMs < Date.parse(nextDueAt)) nextDueAt = new Date(sendAfterMs).toISOString();
      continue;
    }

    const [suppressed, alreadySent] = await Promise.all([
      env.STORE_STATE.get(getAbandonedCartSuppressionKey(record.emailHash)),
      env.STORE_STATE.get(getAbandonedCartSentKey(record.emailHash, record.cartHash))
    ]);
    const completed = suppressed || alreadySent ? false : await hasCompletedStoreOrderForAbandonedCart(env, record);
    if (suppressed || alreadySent || completed) {
      await env.STORE_STATE.delete(key);
      results.skipped += 1;
      const reason = suppressed ? 'suppressed' : (alreadySent ? 'already_sent' : 'completed');
      healthEvents.push({
        type: reason === 'suppressed' ? 'suppressed' : 'skipped',
        reason,
        record,
        counter: reason === 'suppressed' ? 'suppressed' : (reason === 'already_sent' ? 'alreadySent' : 'completed'),
        pendingDelta: -1
      });
      continue;
    }

    const unsubscribeToken = await signAbandonedCartToken(env, {
      scope: ABANDONED_CART_TOKEN_SCOPE_UNSUBSCRIBE,
      orderToken: record.orderToken,
      emailHash: record.emailHash,
      email: record.email
    }, 30);
    const resumeToken = await signAbandonedCartToken(env, {
      scope: ABANDONED_CART_TOKEN_SCOPE_RESUME,
      orderToken: record.orderToken,
      emailHash: record.emailHash,
      cartHash: record.cartHash
    }, 14);
    if (!unsubscribeToken || !resumeToken) {
      record.attempts = Number(record.attempts || 0) + 1;
      record.lastError = 'Reminder link signing is not configured';
      record.sendAfter = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      await env.STORE_STATE.put(key, JSON.stringify(record), { expirationTtl: ABANDONED_CART_TTL_SECONDS });
      hasPending = true;
      nextDueAt = nextDueAt && Date.parse(nextDueAt) < Date.parse(record.sendAfter) ? nextDueAt : record.sendAfter;
      results.failed += 1;
      healthEvents.push({ type: 'failed', reason: 'token_secret_not_configured', record, counter: 'failed', nextDueAt: record.sendAfter });
      continue;
    }

    const result = await sendStoreAbandonedCartEmail(env, {
      email: record.email,
      resumeUrl: getAbandonedCartResumeUrl(env, resumeToken),
      amountCents: Number(record.amountCents || 0) || 0,
      itemCount: Number(record.itemCount || 0) || 0,
      unsubscribeUrl: getAbandonedCartUnsubscribeUrl(env, unsubscribeToken),
      preferredLang: record.preferredLang || DEFAULT_I18N_LANG
    });

    if (!result?.sent) {
      const attempts = Number(record.attempts || 0) + 1;
      const retryDelayMs = Math.min(24 * 60 * 60 * 1000, Math.max(15 * 60 * 1000, (2 ** Math.min(attempts, 6)) * 15 * 60 * 1000));
      record.attempts = attempts;
      record.lastError = String(result?.reason || 'Email send failed').slice(0, 300);
      record.sendAfter = new Date(now.getTime() + retryDelayMs).toISOString();
      await env.STORE_STATE.put(key, JSON.stringify(record), { expirationTtl: ABANDONED_CART_TTL_SECONDS });
      hasPending = true;
      nextDueAt = nextDueAt && Date.parse(nextDueAt) < Date.parse(record.sendAfter) ? nextDueAt : record.sendAfter;
      results.failed += 1;
      healthEvents.push({ type: 'failed', reason: 'send_failed', record, counter: 'failed', nextDueAt: record.sendAfter });
      continue;
    }

    await env.STORE_STATE.put(getAbandonedCartSentKey(record.emailHash, record.cartHash), now.toISOString(), {
      expirationTtl: ABANDONED_CART_SENT_TTL_SECONDS
    });
    await env.STORE_STATE.put(getAbandonedCartResumeKey(record.orderToken), JSON.stringify({
      version: 1,
      orderToken: record.orderToken,
      email: record.email,
      emailHash: record.emailHash,
      cartHash: record.cartHash,
      amountCents: record.amountCents || 0,
      itemCount: record.itemCount || 0,
      customerName: record.customerName || '',
      billingAddress: record.billingAddress || null,
      shippingAddress: record.shippingAddress || null,
      resumeSnapshot: record.resumeSnapshot,
      createdAt: record.createdAt || '',
      sentAt: now.toISOString()
    }), {
      expirationTtl: ABANDONED_CART_TTL_SECONDS
    });
    await env.STORE_STATE.delete(key);
    results.sent += 1;
    healthEvents.push({ type: 'sent', reason: 'sent', record, counter: 'sent', pendingDelta: -1 });
  }

  await writeAbandonedCartQueueState(env, hasPending, nextDueAt);
  healthEvents.push({ queue: { hasPending, nextDueAt } });
  await updateAbandonedCartHealth(env, healthEvents);
  return results;
}

async function handleAbandonedCartUnsubscribe(request, env) {
  if (!env?.STORE_STATE) {
    return abandonedCartHtmlResponse('Reminder unavailable', 'Reminder unsubscribe storage is not configured.', 503);
  }
  const url = new URL(request.url);
  const token = String(url.searchParams.get('t') || '').trim();
  const verified = token ? await verifyAbandonedCartToken(env, token) : null;
  if (!verified?.ok || verified.payload?.scope !== ABANDONED_CART_TOKEN_SCOPE_UNSUBSCRIBE || !verified.payload?.emailHash) {
    return abandonedCartHtmlResponse('Reminder link expired', verified?.error || 'This reminder link is invalid or expired.', verified?.status || 400);
  }

  const emailHash = String(verified.payload.emailHash || '').trim().toLowerCase();
  const now = new Date().toISOString();
  await env.STORE_STATE.put(getAbandonedCartSuppressionKey(emailHash), JSON.stringify({
    emailHash,
    suppressedAt: now,
    source: 'unsubscribe'
  }), { expirationTtl: ABANDONED_CART_SUPPRESSION_TTL_SECONDS });

  if (STORE_ORDER_TOKEN_PATTERN.test(String(verified.payload.orderToken || ''))) {
    await deleteAbandonedCheckoutFollowup(env, verified.payload.orderToken, { reason: 'unsubscribed' });
  }

  return abandonedCartHtmlResponse('Reminder unsubscribed', 'You will not receive this checkout reminder.');
}

async function handleAbandonedCartResume(request, env) {
  if (!env?.STORE_STATE) {
    return privateJsonResponse({ error: 'Reminder resume storage is not configured.' }, 503, env);
  }
  const url = new URL(request.url);
  const token = String(url.searchParams.get('t') || '').trim();
  const verified = token ? await verifyAbandonedCartToken(env, token) : null;
  const payload = verified?.payload || {};
  const orderToken = String(payload.orderToken || '').trim();
  const emailHash = String(payload.emailHash || '').trim().toLowerCase();
  const cartHash = String(payload.cartHash || '').trim().toLowerCase();
  if (
    !verified?.ok ||
    payload.scope !== ABANDONED_CART_TOKEN_SCOPE_RESUME ||
    !STORE_ORDER_TOKEN_PATTERN.test(orderToken) ||
    !/^[a-f0-9]{64}$/.test(emailHash)
  ) {
    return privateJsonResponse({ error: verified?.error || 'Reminder link is invalid or expired.' }, verified?.status || 400, env);
  }

  const record = await env.STORE_STATE.get(getAbandonedCartResumeKey(orderToken), { type: 'json' }) ||
    await env.STORE_STATE.get(getAbandonedCartKey(orderToken), { type: 'json' });
  const snapshot = record?.resumeSnapshot;
  if (
    !record ||
    String(record.emailHash || '').trim().toLowerCase() !== emailHash ||
    (cartHash && String(record.cartHash || '').trim().toLowerCase() !== cartHash) ||
    !Array.isArray(snapshot?.cart?.items) ||
    snapshot.cart.items.length === 0
  ) {
    return privateJsonResponse({ error: 'Reminder checkout is no longer available.' }, 404, env);
  }

  return privateJsonResponse({
    success: true,
    orderToken,
    snapshot: {
      ...snapshot,
      savedAt: Date.now()
    },
    draft: buildAbandonedCartResumeDraft(record)
  }, 200, env);
}

function buildCompactStoreOrderItems(items = []) {
  return (Array.isArray(items) ? items : []).slice(0, 8).map((item) => ({
    name: String(item?.name || item?.productId || item?.sku || 'Store item').trim(),
    variantLabel: String(item?.variantLabel || '').trim(),
    quantity: Math.max(1, Number(item?.quantity || 1) || 1),
    subtotalCents: Math.max(0, Number(item?.subtotalCents || 0) || 0),
    fulfillmentType: String(item?.fulfillmentType || '').trim().toLowerCase()
  }));
}

function extractStorePaymentIntentCustomer(paymentIntent = {}) {
  const charge = getStripePaymentIntentCharge(paymentIntent) || {};
  const billingDetails = charge?.billing_details && typeof charge.billing_details === 'object'
    ? charge.billing_details
    : {};
  return {
    email: normalizeStoreOrderLookupEmail(
      paymentIntent.receipt_email ||
      billingDetails.email ||
      paymentIntent.metadata?.email ||
      ''
    ),
    name: String(
      billingDetails.name ||
      paymentIntent.shipping?.name ||
      ''
    ).trim()
  };
}

function mergeStoreOrderCustomer(storedOrder = {}, customer = {}) {
  const orderDraft = storedOrder.orderDraft || {};
  const existingCustomer = orderDraft.customer && typeof orderDraft.customer === 'object'
    ? orderDraft.customer
    : {};
  const email = normalizeStoreOrderLookupEmail(existingCustomer.email) ||
    normalizeStoreOrderLookupEmail(customer.email);
  const name = String(existingCustomer.name || customer.name || '').trim();
  const phone = String(existingCustomer.phone || customer.phone || '').trim();
  return {
    ...existingCustomer,
    email,
    name,
    phone
  };
}

async function backfillStoreOrderCustomerFromStripe(env, storedOrder = {}, expectedEmailHash = '', storageKey = '') {
  if (!env?.STORE_STATE || !isStoreOrderFulfillmentReady(storedOrder)) return null;
  if (normalizeStoreOrderLookupEmail(storedOrder.orderDraft?.customer?.email)) return storedOrder;

  const paymentIntentId = String(
    storedOrder.payment?.paymentIntentId ||
    storedOrder.stripePaymentIntentId ||
    ''
  ).trim();
  const stripeSecretKey = getStripeKey(env);
  if (!paymentIntentId || !stripeSecretKey) return null;

  try {
    const stripe = createStripeClient(stripeSecretKey);
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge']
    });
    if (!paymentIntent || paymentIntent.error) return null;

    const customer = extractStorePaymentIntentCustomer(paymentIntent);
    if (!customer.email) return null;
    if (expectedEmailHash) {
      const paymentEmailHash = await getStoreOrderEmailHash(customer.email);
      if (paymentEmailHash !== expectedEmailHash) return null;
    }

    const updatedAt = new Date().toISOString();
    const updatedOrder = {
      ...storedOrder,
      updatedAt,
      customerBackfilledAt: updatedAt,
      orderDraft: {
        ...(storedOrder.orderDraft || {}),
        customer: mergeStoreOrderCustomer(storedOrder, customer)
      },
      payment: {
        ...(storedOrder.payment || {}),
        receiptEmail: customer.email
      }
    };
    const key = storageKey || getStoreOrderStorageKey(updatedOrder.orderToken || updatedOrder.orderDraft?.orderToken);
    if (key) {
      await env.STORE_STATE.put(key, JSON.stringify(updatedOrder));
      invalidateAdminStoreOrderScanCache(env);
    }
    return updatedOrder;
  } catch (error) {
    console.warn('Store order customer Stripe backfill failed:', {
      orderToken: storedOrder.orderToken || storedOrder.orderDraft?.orderToken || '',
      error: error?.message || String(error)
    });
    return null;
  }
}

function buildStoreOrderLookupIndexEntry(storedOrder = {}) {
  const orderDraft = storedOrder.orderDraft || {};
  const orderToken = String(storedOrder.orderToken || orderDraft.orderToken || '').trim();
  if (!STORE_ORDER_TOKEN_PATTERN.test(orderToken)) return null;
  if (!isStoreOrderFulfillmentReady(storedOrder)) return null;

  const totals = orderDraft.totals || {};
  const items = Array.isArray(orderDraft.items) ? orderDraft.items : [];
  const createdAt = storedOrder.createdAt || orderDraft.createdAt || '';
  const confirmedAt = storedOrder.confirmedAt || orderDraft.confirmedAt || '';

  return {
    orderToken,
    status: storedOrder.status || orderDraft.status || STORE_ORDER_STATUS_DRAFT,
    fulfillmentReady: isStoreOrderFulfillmentReady(storedOrder),
    createdAt,
    confirmedAt,
    updatedAt: storedOrder.updatedAt || confirmedAt || createdAt,
    preferredLang: orderDraft.preferredLang || storedOrder.preferredLang || DEFAULT_I18N_LANG,
    totalCents: Math.max(0, Number(totals.totalCents || storedOrder.payment?.amountCents || 0) || 0),
    currency: orderDraft.currency || storedOrder.payment?.currency || 'USD',
    itemCount: Math.max(0, Number(totals.itemCount || items.length || 0) || 0),
    items: buildCompactStoreOrderItems(items)
  };
}

async function collectStoreOrderLookupEntriesForEmailHash(env, emailHash) {
  if (!env?.STORE_STATE || !getStoreOrderEmailIndexKey(emailHash)) return [];
  const listed = await listAdminStoreOrderKeys(env);
  if (!listed.ok) return [];

  const entries = [];
  let stripeBackfillAttempts = 0;
  for (const key of listed.keys || []) {
    const keyName = String(key?.name || '').trim();
    if (!keyName) continue;

    let storedOrder = await env.STORE_STATE.get(keyName, { type: 'json' });
    if (!storedOrder || typeof storedOrder !== 'object') continue;

    let email = normalizeStoreOrderLookupEmail(storedOrder.orderDraft?.customer?.email);
    const paymentIntentId = String(
      storedOrder.payment?.paymentIntentId ||
      storedOrder.stripePaymentIntentId ||
      ''
    ).trim();
    if (!email && isStoreOrderFulfillmentReady(storedOrder) && paymentIntentId && stripeBackfillAttempts < 25) {
      stripeBackfillAttempts += 1;
      const backfilledOrder = await backfillStoreOrderCustomerFromStripe(env, storedOrder, emailHash, keyName);
      if (backfilledOrder) {
        storedOrder = backfilledOrder;
        email = normalizeStoreOrderLookupEmail(storedOrder.orderDraft?.customer?.email);
      }
    }
    if (!email) continue;

    const storedEmailHash = await getStoreOrderEmailHash(email);
    if (storedEmailHash !== emailHash) continue;

    const entry = buildStoreOrderLookupIndexEntry(storedOrder);
    if (entry) entries.push(entry);
  }

  const ordersByToken = new Map();
  for (const entry of entries) {
    ordersByToken.set(entry.orderToken, entry);
  }

  return Array.from(ordersByToken.values())
    .sort(compareStoreLookupEntries)
    .slice(0, STORE_ORDER_EMAIL_INDEX_LIMIT);
}

async function readStoreOrderEmailIndexOrders(env, emailHash, options = {}) {
  const indexKey = getStoreOrderEmailIndexKey(emailHash);
  if (!env?.STORE_STATE || !indexKey) return [];

  const index = await env.STORE_STATE.get(indexKey, { type: 'json' });
  const indexedOrders = (Array.isArray(index?.orders) ? index.orders : [])
    .filter((order) => {
      if (!STORE_ORDER_TOKEN_PATTERN.test(String(order?.orderToken || ''))) return false;
      if (order?.fulfillmentReady === false) return false;
      const status = String(order?.status || '').trim().toLowerCase();
      return !['draft', 'payment_pending', 'payment_failed'].includes(status);
    });
  if (indexedOrders.length > 0 && options.rebuild !== true) {
    return indexedOrders
      .sort(compareStoreLookupEntries)
      .slice(0, STORE_ORDER_EMAIL_INDEX_LIMIT);
  }

  const rebuiltOrders = await collectStoreOrderLookupEntriesForEmailHash(env, emailHash);
  const ordersByToken = new Map();
  for (const order of indexedOrders) ordersByToken.set(order.orderToken, order);
  for (const order of rebuiltOrders) ordersByToken.set(order.orderToken, order);
  const mergedOrders = Array.from(ordersByToken.values())
    .sort(compareStoreLookupEntries)
    .slice(0, STORE_ORDER_EMAIL_INDEX_LIMIT);

  if (rebuiltOrders.length > 0) {
    const now = new Date().toISOString();
    await env.STORE_STATE.put(indexKey, JSON.stringify({
      version: 1,
      emailHash,
      createdAt: index?.createdAt || now,
      updatedAt: now,
      orders: mergedOrders
    }), {
      expirationTtl: STORE_ORDER_EMAIL_INDEX_TTL_SECONDS
    });
  }

  return mergedOrders;
}

function compareStoreLookupEntries(a = {}, b = {}) {
  const aTime = parseTimestampMs(a.confirmedAt || a.createdAt) || 0;
  const bTime = parseTimestampMs(b.confirmedAt || b.createdAt) || 0;
  return bTime - aTime;
}

async function upsertStoreOrderEmailIndex(env, storedOrder = {}) {
  if (!env.STORE_STATE) return { ok: false, skipped: 'store_state_unavailable' };

  const orderDraft = storedOrder.orderDraft || {};
  const email = normalizeStoreOrderLookupEmail(orderDraft.customer?.email);
  if (!email) return { ok: true, skipped: 'missing_email' };

  const emailHash = await getStoreOrderEmailHash(email);
  const indexKey = getStoreOrderEmailIndexKey(emailHash);
  const entry = buildStoreOrderLookupIndexEntry(storedOrder);
  if (!indexKey || !entry) return { ok: true, skipped: 'invalid_index_entry' };

  const now = new Date().toISOString();
  const existingIndex = await env.STORE_STATE.get(indexKey, { type: 'json' }) || {};
  const existingOrders = Array.isArray(existingIndex.orders) ? existingIndex.orders : [];
  const ordersByToken = new Map();
  for (const existingEntry of existingOrders) {
    const token = String(existingEntry?.orderToken || '').trim();
    if (STORE_ORDER_TOKEN_PATTERN.test(token)) {
      ordersByToken.set(token, existingEntry);
    }
  }
  ordersByToken.set(entry.orderToken, entry);

  const nextIndex = {
    version: 1,
    emailHash,
    createdAt: existingIndex.createdAt || now,
    updatedAt: now,
    orders: Array.from(ordersByToken.values())
      .sort(compareStoreLookupEntries)
      .slice(0, STORE_ORDER_EMAIL_INDEX_LIMIT)
  };

  await env.STORE_STATE.put(indexKey, JSON.stringify(nextIndex), {
    expirationTtl: STORE_ORDER_EMAIL_INDEX_TTL_SECONDS
  });

  return { ok: true, orderCount: nextIndex.orders.length };
}

function queueStoreOrderEmailIndexUpsert(ctx, env, storedOrder = {}) {
  const orderToken = String(storedOrder.orderToken || storedOrder.orderDraft?.orderToken || '').trim();
  queueBackgroundTask(
    ctx,
    upsertStoreOrderEmailIndex(env, storedOrder).then((result) => {
      if (result && result.ok === false) {
        console.error('Store order email index update failed:', {
          orderToken,
          skipped: result.skipped
        });
      }
    }),
    `store order email index (${orderToken || 'unknown'})`
  );
}

async function signStoreOrderLookupToken(env, payload = {}, ttlSeconds = STORE_ORDER_LOOKUP_TOKEN_TTL_SECONDS) {
  const secret = getStoreOrderLookupSecret(env);
  if (!secret) return '';
  const expiresInSeconds = Math.max(60, Math.floor(Number(ttlSeconds) || STORE_ORDER_LOOKUP_TOKEN_TTL_SECONDS));
  const body = {
    v: 1,
    scope: STORE_ORDER_LOOKUP_SCOPE,
    ...payload,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  };
  const payloadB64 = base64urlEncodeString(JSON.stringify(body));
  const signature = await hmacSha256Bytes(secret, payloadB64);
  return `${payloadB64}.${base64urlEncodeBytes(signature)}`;
}

async function verifyStoreOrderLookupToken(env, token) {
  const secret = getStoreOrderLookupSecret(env);
  if (!secret) {
    return { ok: false, status: 503, error: 'Store order lookup signing is not configured' };
  }

  const [payloadB64, signatureB64] = String(token || '').split('.');
  if (!payloadB64 || !signatureB64) {
    return { ok: false, status: 403, error: 'Invalid order lookup link' };
  }

  const expectedSignature = base64urlEncodeBytes(await hmacSha256Bytes(secret, payloadB64));
  if (!timingSafeEqual(signatureB64, expectedSignature)) {
    return { ok: false, status: 403, error: 'Invalid order lookup link' };
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecodeToString(payloadB64));
  } catch {
    return { ok: false, status: 403, error: 'Invalid order lookup link' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Number(payload.exp || 0) < nowSeconds) {
    return { ok: false, status: 410, error: 'Order lookup link expired' };
  }
  if (payload.scope !== STORE_ORDER_LOOKUP_SCOPE) {
    return { ok: false, status: 403, error: 'Invalid order lookup link' };
  }
  if (!/^[a-f0-9]{64}$/.test(String(payload.emailHash || ''))) {
    return { ok: false, status: 403, error: 'Invalid order lookup link' };
  }
  if (!getStoreOrderLookupTokenKey(payload.jti)) {
    return { ok: false, status: 403, error: 'Invalid order lookup link' };
  }

  return { ok: true, payload };
}

async function createStoreOrderLookupToken(env, emailHash) {
  if (!env.STORE_STATE) return { ok: false, error: 'Order storage unavailable' };
  if (!getStoreOrderEmailIndexKey(emailHash)) return { ok: false, error: 'Invalid lookup email' };

  const jti = createStoreOrderLookupJti();
  const token = await signStoreOrderLookupToken(env, { emailHash, jti });
  if (!token) return { ok: false, error: 'Order lookup signing is not configured' };

  const now = new Date();
  await env.STORE_STATE.put(getStoreOrderLookupTokenKey(jti), JSON.stringify({
    version: 1,
    scope: STORE_ORDER_LOOKUP_SCOPE,
    emailHash,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + STORE_ORDER_LOOKUP_TOKEN_TTL_SECONDS * 1000).toISOString()
  }), {
    expirationTtl: STORE_ORDER_LOOKUP_TOKEN_TTL_SECONDS
  });

  return { ok: true, token, jti };
}

async function consumeStoreOrderLookupToken(env, token) {
  if (!env.STORE_STATE) {
    return { ok: false, status: 503, error: 'Order storage unavailable' };
  }

  const verified = await verifyStoreOrderLookupToken(env, token);
  if (!verified.ok) return verified;

  const recordKey = getStoreOrderLookupTokenKey(verified.payload.jti);
  const record = await env.STORE_STATE.get(recordKey, { type: 'json' });
  if (!record) {
    return { ok: false, status: 410, error: 'Order lookup link expired' };
  }
  if (record.emailHash !== verified.payload.emailHash) {
    return { ok: false, status: 403, error: 'Invalid order lookup link' };
  }

  const orders = (await readStoreOrderEmailIndexOrders(env, verified.payload.emailHash))
    .sort(compareStoreLookupEntries)
    .slice(0, STORE_ORDER_EMAIL_INDEX_LIMIT)
    .map((order) => {
      const preferredLang = normalizePreferredLang(order.preferredLang);
      return {
        ...order,
        orderUrl: `${getLocalizedPath('/order-success/', preferredLang)}?orderToken=${encodeURIComponent(order.orderToken)}`
      };
    });

  return {
    ok: true,
    emailHash: verified.payload.emailHash,
    orders,
    consumedAt: new Date().toISOString()
  };
}

function getStoreOrderLookupGenericMessage(env = {}) {
  const platformName = normalizeAdminPlainText(env.PLATFORM_NAME || 'Store', 'Platform name', { maxLength: 80 }).value || 'Store';
  return `If that email has ${platformName} orders, a secure lookup link has been sent.`;
}

function queueStoreOrderLookupEmailDelivery(ctx, env, payload = {}) {
  const email = normalizeStoreOrderLookupEmail(payload.email);
  queueBackgroundTask(
    ctx,
    deliverStoreOrderLookupEmail(env, {
      ...payload,
      email
    }).then((result) => {
      if (result?.sent === false) {
        console.error('Store order lookup email skipped:', {
          emailHash: payload.emailHash || '',
          reason: result.reason || 'not sent'
        });
      }
    }),
    `store order lookup email (${email || 'unknown'})`
  );
}

async function deliverStoreOrderLookupEmail(env, payload = {}) {
  const email = normalizeStoreOrderLookupEmail(payload.email);
  return sendStoreOrderLookupEmail(env, {
    ...payload,
    email
  });
}

function shouldDeliverStoreOrderLookupInline(request, env = {}) {
  return getAppMode(env) === 'test' || !isProductionWorkerRequest(request, env);
}

async function handleStoreOrderLookupRequest(request, env, ctx = null) {
  const trustedOrigin = requireTrustedSiteOrigin(request, env);
  if (!trustedOrigin.ok) return trustedOrigin.response;

  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const email = normalizeStoreOrderLookupEmail(parsedBody.body?.email);
  if (!email) {
    return privateJsonResponse({ error: 'Invalid email format' }, 400, env);
  }

  if (!env.STORE_STATE) {
    return privateJsonResponse({ error: 'Order storage unavailable' }, 503, env);
  }

  const emailHash = await getStoreOrderEmailHash(email);
  let orders = await readStoreOrderEmailIndexOrders(env, emailHash);
  if (orders.length === 0) {
    orders = await readStoreOrderEmailIndexOrders(env, emailHash, { rebuild: true });
  }
  const inlineDelivery = shouldDeliverStoreOrderLookupInline(request, env);
  let debug = inlineDelivery
    ? {
        orderLookup: {
          matchedOrders: orders.length,
          deliverySent: null,
          deliveryReason: '',
          deliveryError: '',
          lookupUrl: ''
        }
      }
    : null;

  if (orders.length > 0) {
    const tokenResult = await createStoreOrderLookupToken(env, emailHash);
    if (tokenResult.ok) {
      const preferredLang = normalizePreferredLang(orders[0]?.preferredLang);
      const deliveryPayload = {
        email,
        emailHash,
        lookupUrl: getLocalizedSiteUrl(env, `/orders/?token=${encodeURIComponent(tokenResult.token)}`, preferredLang),
        orderCount: orders.length,
        preferredLang
      };
      if (inlineDelivery) {
        debug.orderLookup.lookupUrl = deliveryPayload.lookupUrl;
        try {
          const deliveryResult = await deliverStoreOrderLookupEmail(env, deliveryPayload);
          debug.orderLookup.deliverySent = deliveryResult?.sent !== false;
          debug.orderLookup.deliveryReason = deliveryResult?.reason || '';
        } catch (error) {
          debug.orderLookup.deliverySent = false;
          debug.orderLookup.deliveryError = error?.message || 'Email delivery failed.';
        }
      } else {
        queueStoreOrderLookupEmailDelivery(ctx, env, deliveryPayload);
      }
    } else {
      if (debug) {
        debug.orderLookup.deliverySent = false;
        debug.orderLookup.deliveryError = tokenResult.error || 'Lookup token was not created.';
      }
      console.error('Store order lookup token not created:', {
        emailHash,
        error: tokenResult.error
      });
    }
  }

  const responseBody = {
    ok: true,
    message: getStoreOrderLookupGenericMessage(env)
  };
  if (debug) responseBody.debug = debug;
  return privateJsonResponse(responseBody, 200, env);
}

async function handleStoreOrderLookupConsume(request, env) {
  const trustedOrigin = requireTrustedSiteOrigin(request, env);
  if (!trustedOrigin.ok) return trustedOrigin.response;

  const token = String(new URL(request.url).searchParams.get('token') || '').trim();
  if (!token) {
    return privateJsonResponse({ error: 'Missing order lookup token' }, 400, env);
  }

  const consumed = await consumeStoreOrderLookupToken(env, token);
  if (!consumed.ok) {
    return privateJsonResponse({ error: consumed.error || 'Unable to load orders' }, consumed.status || 403, env);
  }

  return privateJsonResponse({
    ok: true,
    orders: consumed.orders,
    consumedAt: consumed.consumedAt
  }, 200, env);
}

function matchStoreOrderRoute(path) {
  const parts = String(path || '')
    .split('/')
    .filter(Boolean)
    .map((part) => safeDecodePathSegment(part));
  if (parts[0] !== 'api' || parts[1] !== 'orders') return null;

  const orderToken = String(parts[2] || '').trim();
  if (!orderToken) {
    return { kind: 'invalid', orderToken: '', error: 'Missing Store order token' };
  }
  if (!STORE_ORDER_TOKEN_PATTERN.test(orderToken)) {
    return { kind: 'invalid', orderToken, error: 'Invalid Store order token' };
  }

  if (parts.length === 3 || parts[3] === 'summary') {
    return { kind: 'summary', orderToken };
  }

  const section = String(parts[3] || '').trim();
  const rawItemId = String(parts[4] || '').trim();
  if (!rawItemId) {
    return { kind: 'invalid', orderToken, error: 'Missing Store fulfillment item' };
  }

  if (section === 'downloads') {
    return { kind: 'download', orderToken, itemId: normalizeStoreFulfillmentId(rawItemId) };
  }

  if (section === 'tickets' && rawItemId.endsWith('.svg')) {
    return { kind: 'ticket', orderToken, itemId: normalizeStoreFulfillmentId(rawItemId.replace(/\.svg$/i, '')) };
  }

  if (section === 'calendar' && rawItemId.endsWith('.ics')) {
    return { kind: 'calendar', orderToken, itemId: normalizeStoreFulfillmentId(rawItemId.replace(/\.ics$/i, '')) };
  }

  if (section === 'check-in') {
    return { kind: 'check_in', orderToken, itemId: normalizeStoreFulfillmentId(rawItemId) };
  }

  return null;
}

function safeDecodePathSegment(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

function normalizeStoreFulfillmentId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function getStoreFulfillmentId(item = {}, index = 0) {
  return normalizeStoreFulfillmentId(
    item.sku ||
    [item.productId, item.variantId].filter(Boolean).join('-') ||
    `item-${index + 1}`
  ) || `item-${index + 1}`;
}

function getStoreFulfillmentType(item = {}) {
  return String(item.fulfillmentType || '').trim().toLowerCase();
}

function isStoreTicketLikeItem(item = {}) {
  const type = getStoreFulfillmentType(item);
  return type === 'ticket' || type === 'rsvp';
}

function isStoreDownloadItem(item = {}) {
  return getStoreFulfillmentType(item) === 'digital';
}

function isStoreOrderFulfillmentReady(storedOrder = {}) {
  if (storedOrder.status !== STORE_ORDER_STATUS_CONFIRMED) return false;
  const paymentStatus = String(storedOrder.payment?.status || '').trim().toLowerCase();
  if (storedOrder.payment?.required === true) {
    return paymentStatus === 'succeeded';
  }
  return paymentStatus === 'not_required' || storedOrder.payment?.required === false;
}

async function loadStoreOrderForRead(env, orderToken) {
  if (!env.STORE_STATE) {
    return { ok: false, status: 503, error: 'Order storage unavailable' };
  }
  const storageKey = getStoreOrderStorageKey(orderToken);
  if (!storageKey) {
    return { ok: false, status: 400, error: 'Missing Store order token' };
  }
  const storedOrder = await env.STORE_STATE.get(storageKey, { type: 'json' });
  if (!storedOrder) {
    return { ok: false, status: 404, error: 'Store order not found' };
  }
  return { ok: true, storedOrder };
}

function findStoreFulfillmentItem(storedOrder = {}, itemId = '') {
  const normalizedItemId = normalizeStoreFulfillmentId(itemId);
  const items = Array.isArray(storedOrder.orderDraft?.items) ? storedOrder.orderDraft.items : [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index] || {};
    const candidates = [
      getStoreFulfillmentId(item, index),
      item.sku,
      item.productId,
      [item.productId, item.variantId].filter(Boolean).join('-'),
      `item-${index + 1}`
    ].map(normalizeStoreFulfillmentId);
    if (candidates.includes(normalizedItemId)) {
      return { item, index, itemId: getStoreFulfillmentId(item, index) };
    }
  }
  return null;
}

function getStoreFulfillmentSecret(env = {}) {
  return String(
    env.STORE_FULFILLMENT_SECRET ||
    env.STORE_DOWNLOAD_SECRET ||
    env.MAGIC_LINK_SECRET ||
    ''
  ).trim();
}

async function signStoreFulfillmentToken(env, payload = {}, ttlSeconds = STORE_FULFILLMENT_TOKEN_TTL_SECONDS) {
  const secret = getStoreFulfillmentSecret(env);
  if (!secret) return '';
  const body = {
    v: 1,
    ...payload,
    exp: Math.floor(Date.now() / 1000) + Math.max(60, Math.floor(Number(ttlSeconds) || STORE_FULFILLMENT_TOKEN_TTL_SECONDS))
  };
  const payloadB64 = base64urlEncodeString(JSON.stringify(body));
  const signature = await hmacSha256Bytes(secret, payloadB64);
  return `${payloadB64}.${base64urlEncodeBytes(signature)}`;
}

async function verifyStoreFulfillmentToken(env, token, expected = {}) {
  const secret = getStoreFulfillmentSecret(env);
  if (!secret) {
    return { ok: false, status: 503, error: 'Store fulfillment signing is not configured' };
  }

  const [payloadB64, signatureB64] = String(token || '').split('.');
  if (!payloadB64 || !signatureB64) {
    return { ok: false, status: 403, error: 'Invalid fulfillment link' };
  }

  const expectedSignature = base64urlEncodeBytes(await hmacSha256Bytes(secret, payloadB64));
  if (!timingSafeEqual(signatureB64, expectedSignature)) {
    return { ok: false, status: 403, error: 'Invalid fulfillment link' };
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecodeToString(payloadB64));
  } catch {
    return { ok: false, status: 403, error: 'Invalid fulfillment link' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Number(payload.exp || 0) < nowSeconds) {
    return { ok: false, status: 410, error: 'Fulfillment link expired' };
  }

  for (const key of ['orderToken', 'itemId', 'action']) {
    if (String(payload[key] || '') !== String(expected[key] || '')) {
      return { ok: false, status: 403, error: 'Invalid fulfillment link' };
    }
  }

  return { ok: true, payload };
}

async function hmacSha256Bytes(secret, data) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(String(data || '')));
  return new Uint8Array(signature);
}

function base64urlEncodeString(value) {
  return base64urlEncodeBytes(new TextEncoder().encode(String(value || '')));
}

function base64EncodeString(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64urlEncodeBytes(bytes) {
  let binary = '';
  for (const byte of bytes || []) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecodeToString(value) {
  let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function getStoreOrderRouteBaseUrl(request, env) {
  const configured = String(env.WORKER_BASE || env.CANONICAL_WORKER_BASE || '').replace(/\/+$/, '');
  if (configured) return configured;
  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

function buildStoreFulfillmentUrl(request, env, orderToken, section, itemId, suffix = '', token = '') {
  const path = `/api/orders/${encodeURIComponent(orderToken)}/${section}/${encodeURIComponent(itemId)}${suffix}`;
  const base = getStoreOrderRouteBaseUrl(request, env);
  const url = new URL(path, base || request.url);
  if (token) url.searchParams.set('token', token);
  return url.href;
}

function getStoreFulfillmentPublicBaseUrl(env = {}) {
  const configured = String(getWorkerBase(env) || env.WORKER_BASE || env.CANONICAL_WORKER_BASE || '').replace(/\/+$/, '');
  if (configured) return configured;
  return String(getSiteBase(env) || DEFAULT_SITE_BASE || '').replace(/\/+$/, '');
}

function buildStoreFulfillmentPublicUrl(env, orderToken, section, itemId, suffix = '', token = '') {
  const path = `/api/orders/${encodeURIComponent(orderToken)}/${section}/${encodeURIComponent(itemId)}${suffix}`;
  const base = getStoreFulfillmentPublicBaseUrl(env);
  try {
    const url = new URL(path, base || DEFAULT_SITE_BASE);
    if (token) url.searchParams.set('token', token);
    return url.href;
  } catch {
    return '';
  }
}

function getStoreEventFulfillmentTokenTtlSeconds(event = null) {
  const startsAtMs = parseTimestampMs(event?.startsAt);
  if (!Number.isFinite(startsAtMs)) return STORE_FULFILLMENT_TOKEN_TTL_SECONDS;
  const endsAtMs = parseTimestampMs(event?.endsAt);
  const safeEndsAtMs = Number.isFinite(endsAtMs) && endsAtMs > startsAtMs
    ? endsAtMs
    : startsAtMs + (2 * 60 * 60 * 1000);
  const expiresAtMs = safeEndsAtMs + (24 * 60 * 60 * 1000);
  const ttlSeconds = Math.ceil((expiresAtMs - Date.now()) / 1000);
  return Math.max(60, Math.min(STORE_EVENT_REMINDER_TTL_SECONDS, ttlSeconds));
}

async function buildStoreCheckInQrSvg(checkInUrl = '') {
  if (!checkInUrl) return '';
  return QRCode.toString(checkInUrl, {
    type: 'svg',
    margin: 1,
    color: {
      dark: '#101215',
      light: '#ffffff'
    }
  });
}

async function buildStoreTicketEmailArtifacts(env, storedOrder = {}, item = {}, itemId = '', options = {}) {
  if (!isStoreTicketLikeItem(item)) return null;
  const orderToken = String(storedOrder.orderToken || storedOrder.orderDraft?.orderToken || '').trim();
  const event = summarizeStoreEventDetails(item.eventDetails);
  const tokenTtlSeconds = Math.max(
    STORE_FULFILLMENT_TOKEN_TTL_SECONDS,
    Number(options.tokenTtlSeconds || getStoreEventFulfillmentTokenTtlSeconds(event)) || STORE_FULFILLMENT_TOKEN_TTL_SECONDS
  );
  const checkInToken = await signStoreFulfillmentToken(env, { orderToken, itemId, action: 'check_in' }, tokenTtlSeconds);
  if (!orderToken || !checkInToken) return null;

  const checkInUrl = buildStoreFulfillmentPublicUrl(env, orderToken, 'check-in', itemId, '', checkInToken);
  const qrSvg = await buildStoreCheckInQrSvg(checkInUrl);
  const ticketSvg = buildStoreTicketSvg(env, storedOrder, item, itemId, checkInUrl, qrSvg);
  return { checkInUrl, qrSvg, ticketSvg, tokenTtlSeconds };
}

function getStoreDownloadFileKey(item = {}) {
  return String(item.download?.file_key || item.download?.fileKey || item.download?.key || item.sku || '').trim();
}

function getStoreDownloadFilename(item = {}) {
  return sanitizeDownloadFilename(
    item.download?.filename ||
    item.download?.file_name ||
    `${item.name || item.sku || 'store-download'}`
  );
}

function sanitizeDownloadFilename(value) {
  return String(value || 'store-download')
    .trim()
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'store-download';
}

function downloadFilenameToFileKey(value) {
  return sanitizeDownloadFilename(value)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'store-download';
}

function getStoreDownloadUrlMap(env = {}) {
  const raw = String(env.STORE_DOWNLOAD_URLS_JSON || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function resolveStoreDownloadUrl(env, item = {}) {
  const direct = String(item.download?.url || item.download?.href || '').trim();
  if (isSafeRedirectUrl(direct)) return direct;

  const fileKey = getStoreDownloadFileKey(item);
  const urlMap = getStoreDownloadUrlMap(env);
  const mapped = String(urlMap[fileKey] || '').trim();
  if (isSafeRedirectUrl(mapped)) return mapped;

  const envKey = `STORE_DOWNLOAD_URL_${fileKey.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  const envMapped = String(env?.[envKey] || '').trim();
  return isSafeRedirectUrl(envMapped) ? envMapped : '';
}

function isSafeRedirectUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function hasStoreDownloadHandler(env, item = {}) {
  return Boolean(
    resolveStoreDownloadUrl(env, item) ||
    (env.STORE_DOWNLOADS && getStoreDownloadFileKey(item))
  );
}

function getStoreDownloadAccessRecords(storedOrder = {}) {
  const records = storedOrder.downloadAccess;
  return records && typeof records === 'object' && !Array.isArray(records) ? records : {};
}

function getStoreDownloadAccessIssueTime(storedOrder = {}, nowIso = '') {
  return String(
    storedOrder.confirmedAt ||
    storedOrder.orderDraft?.confirmedAt ||
    storedOrder.createdAt ||
    storedOrder.orderDraft?.createdAt ||
    nowIso ||
    new Date().toISOString()
  );
}

function getStoreDownloadAccessState(storedOrder = {}, itemId = '', item = {}, now = new Date()) {
  const normalizedItemId = normalizeStoreFulfillmentId(itemId);
  const nowDate = now instanceof Date ? now : new Date(String(now || ''));
  const nowIso = Number.isFinite(nowDate.getTime()) ? nowDate.toISOString() : new Date().toISOString();
  const records = getStoreDownloadAccessRecords(storedOrder);
  const record = records[normalizedItemId] && typeof records[normalizedItemId] === 'object'
    ? records[normalizedItemId]
    : {};
  const issuedAt = String(record.issuedAt || record.reissuedAt || getStoreDownloadAccessIssueTime(storedOrder, nowIso));
  const statusValue = String(record.status || '').trim().toLowerCase();
  const revoked = statusValue === 'revoked' || statusValue === 'expired';
  const revokedAt = String(record.revokedAt || record.expiredAt || (revoked ? record.updatedAt : '') || '');

  return {
    itemId: normalizedItemId,
    status: revoked ? 'revoked' : 'active',
    available: isStoreOrderFulfillmentReady(storedOrder) && !revoked,
    issuedAt,
    expiresAt: '',
    expiresInSeconds: 0,
    expiresHours: 0,
    updatedAt: String(record.updatedAt || ''),
    updatedBy: String(record.updatedBy || ''),
    reissuedAt: String(record.reissuedAt || ''),
    revokedAt,
    expiredAt: revokedAt
  };
}

function summarizeStoreDownloadAccessForBuyer(access = {}) {
  return {
    status: access.status || '',
    available: access.available === true,
    expiresAt: '',
    expiresInSeconds: 0,
    expiresHours: 0,
    revokedAt: access.revokedAt || access.expiredAt || ''
  };
}

function buildStoreDownloadAccessRecord(action, previousRecord = {}, _item = {}, auth = {}, nowIso = new Date().toISOString()) {
  const requestedAction = String(action || '').trim().toLowerCase();
  const normalizedAction = requestedAction === 'expire' ? 'revoke' : requestedAction;
  const previousHistory = Array.isArray(previousRecord.history) ? previousRecord.history : [];
  const updatedBy = String(auth.user?.email || auth.email || '').trim();
  const next = {
    ...previousRecord,
    status: normalizedAction === 'revoke' ? 'revoked' : 'active',
    expiresAt: '',
    expiresHours: 0,
    updatedAt: nowIso,
    updatedBy
  };

  if (normalizedAction === 'revoke') {
    next.revokedAt = nowIso;
    next.expiredAt = nowIso;
  } else {
    next.issuedAt = next.issuedAt || nowIso;
    next.reissuedAt = nowIso;
    next.revokedAt = '';
    next.expiredAt = '';
  }

  next.history = previousHistory.slice(-9).concat([{
    action: normalizedAction,
    at: nowIso,
    by: updatedBy
  }]);
  return next;
}

async function buildStoreSummaryItem(request, env, storedOrder, item = {}, index = 0, fulfillmentReady = false) {
  const orderToken = String(storedOrder.orderToken || storedOrder.orderDraft?.orderToken || '').trim();
  const itemId = getStoreFulfillmentId(item, index);
  const type = getStoreFulfillmentType(item);
  const summary = {
    id: itemId,
    productId: item.productId || '',
    variantId: item.variantId || '',
    sku: item.sku || '',
    name: item.name || '',
    variantLabel: item.variantLabel || '',
    quantity: Math.max(1, Number(item.quantity || 1) || 1),
    unitPriceCents: Math.max(0, Number(item.unitPriceCents || 0) || 0),
    subtotalCents: Math.max(0, Number(item.subtotalCents || 0) || 0),
    currency: item.currency || storedOrder.orderDraft?.currency || 'USD',
    fulfillmentType: type,
    event: summarizeStoreEventDetails(item.eventDetails),
    actions: {}
  };

  if (!fulfillmentReady) return summary;

  if (isStoreDownloadItem(item)) {
    const access = getStoreDownloadAccessState(storedOrder, itemId, item);
    const fileReady = hasStoreDownloadHandler(env, item);
    if (!access.available || !fileReady) {
      summary.actions.download = {
        label: 'Download',
        available: false,
        reason: access.available ? 'not_configured' : 'revoked',
        message: access.available
          ? 'Download is not available yet.'
          : 'Download access has been revoked. Contact support if this looks wrong.',
        access: summarizeStoreDownloadAccessForBuyer(access)
      };
      return summary;
    }

    const tokenTtlSeconds = STORE_FULFILLMENT_TOKEN_TTL_SECONDS;
    const token = await signStoreFulfillmentToken(env, { orderToken, itemId, action: 'download' }, tokenTtlSeconds);
    if (token) {
      summary.actions.download = {
        href: buildStoreFulfillmentUrl(request, env, orderToken, 'downloads', itemId, '', token),
        label: 'Download',
        available: true,
        expiresInSeconds: tokenTtlSeconds,
        access: summarizeStoreDownloadAccessForBuyer(access)
      };
    }
  }

  if (isStoreTicketLikeItem(item)) {
    const ticketToken = await signStoreFulfillmentToken(env, { orderToken, itemId, action: 'ticket' });
    const checkInToken = await signStoreFulfillmentToken(env, { orderToken, itemId, action: 'check_in' });
    if (ticketToken) {
      summary.actions.ticket = {
        href: buildStoreFulfillmentUrl(request, env, orderToken, 'tickets', itemId, '.svg', ticketToken),
        label: type === 'rsvp' ? 'Open RSVP' : 'Open ticket',
        expiresInSeconds: STORE_FULFILLMENT_TOKEN_TTL_SECONDS
      };
    }
    if (checkInToken) {
      summary.actions.checkIn = {
        href: buildStoreFulfillmentUrl(request, env, orderToken, 'check-in', itemId, '', checkInToken),
        label: 'Check-in',
        expiresInSeconds: STORE_FULFILLMENT_TOKEN_TTL_SECONDS
      };
    }
    if (item.eventDetails?.ics !== false && item.eventDetails?.starts_at) {
      const calendarToken = await signStoreFulfillmentToken(env, { orderToken, itemId, action: 'calendar' });
      if (calendarToken) {
        summary.actions.calendar = {
          href: buildStoreFulfillmentUrl(request, env, orderToken, 'calendar', itemId, '.ics', calendarToken),
          label: 'Add to calendar',
          expiresInSeconds: STORE_FULFILLMENT_TOKEN_TTL_SECONDS
        };
      }
    }
  }

  return summary;
}

function summarizeStoreEventDetails(eventDetails = null) {
  if (!eventDetails || typeof eventDetails !== 'object') return null;
  return {
    startsAt: eventDetails.starts_at || eventDetails.startsAt || '',
    endsAt: eventDetails.ends_at || eventDetails.endsAt || '',
    venue: eventDetails.venue || '',
    address: eventDetails.address || '',
    ticketDelivery: eventDetails.ticket_delivery || eventDetails.ticketDelivery || '',
    calendar: eventDetails.ics !== false && Boolean(eventDetails.starts_at || eventDetails.startsAt)
  };
}

function storeEmailDryRunEnabled(env = {}) {
  const storeRaw = String(env.STORE_EMAIL_DRY_RUN || '').trim().toLowerCase();
  const resendRaw = String(env.RESEND_EMAIL_DRY_RUN || '').trim().toLowerCase();
  return storeRaw === '1' || storeRaw === 'true' || resendRaw === '1' || resendRaw === 'true';
}

async function buildStoreOrderSummary(request, env, storedOrder = {}) {
  const orderDraft = storedOrder.orderDraft || {};
  const fulfillmentReady = isStoreOrderFulfillmentReady(storedOrder);
  const items = await Promise.all((Array.isArray(orderDraft.items) ? orderDraft.items : []).map(
    (item, index) => buildStoreSummaryItem(request, env, storedOrder, item, index, fulfillmentReady)
  ));

  const summary = {
    ok: true,
    orderToken: storedOrder.orderToken || orderDraft.orderToken || '',
    status: storedOrder.status || orderDraft.status || STORE_ORDER_STATUS_DRAFT,
    fulfillmentReady,
    createdAt: storedOrder.createdAt || orderDraft.createdAt || '',
    confirmedAt: storedOrder.confirmedAt || orderDraft.confirmedAt || '',
    failedAt: storedOrder.failedAt || orderDraft.failedAt || '',
    expiresAt: storedOrder.expiresAt || orderDraft.expiresAt || '',
    preferredLang: orderDraft.preferredLang || storedOrder.preferredLang || DEFAULT_I18N_LANG,
    customer: {
      email: orderDraft.customer?.email || '',
      name: orderDraft.customer?.name || ''
    },
    totals: {
      ...(orderDraft.totals || {}),
      currency: orderDraft.currency || storedOrder.payment?.currency || 'USD'
    },
    payment: {
      required: storedOrder.payment?.required === true,
      provider: storedOrder.payment?.provider || null,
      status: storedOrder.payment?.status || (orderDraft.totals?.requiresPayment ? 'pending' : 'not_required'),
      amountCents: Math.max(0, Number(storedOrder.payment?.amountCents ?? orderDraft.totals?.totalCents ?? 0) || 0),
      currency: storedOrder.payment?.currency || orderDraft.currency || 'USD'
    },
    items,
    shipping: orderDraft.fulfillment?.requiresShipping || orderDraft.totals?.requiresShipping
      ? {
          required: true,
          option: orderDraft.shippingOption || 'standard',
          address: orderDraft.shippingAddress || null
        }
      : { required: false }
  };

  if (storeEmailDryRunEnabled(env)) {
    summary.emailDelivery = {
      customer: {
        sent: storedOrder.emailSent === true,
        dryRun: storedOrder.emailDryRun === true,
        attempted: Boolean(storedOrder.emailSentAt || storedOrder.emailAttemptedAt),
        error: storedOrder.emailError || ''
      },
      admin: {
        sent: storedOrder.adminNotificationEmailSent === true,
        dryRun: storedOrder.adminNotificationEmailDryRun === true,
        attempted: Boolean(storedOrder.adminNotificationEmailSentAt || storedOrder.adminNotificationEmailAttemptedAt),
        recipientCount: Array.isArray(storedOrder.adminNotificationEmailRecipients)
          ? storedOrder.adminNotificationEmailRecipients.length
          : 0,
        errorCount: Array.isArray(storedOrder.adminNotificationEmailErrors)
          ? storedOrder.adminNotificationEmailErrors.length
          : 0
      }
    };
  }

  return summary;
}

async function handleStoreOrderRoute(request, env, route) {
  if (route.kind === 'invalid') {
    return privateJsonResponse({ error: route.error || 'Invalid Store order route' }, 400, env);
  }

  const trustedOrigin = requireTrustedSiteOrigin(request, env);
  if (!trustedOrigin.ok) return trustedOrigin.response;

  const loaded = await loadStoreOrderForRead(env, route.orderToken);
  if (!loaded.ok) {
    return privateJsonResponse({ error: loaded.error }, loaded.status || 404, env);
  }

  if (route.kind === 'summary') {
    return privateJsonResponse(await buildStoreOrderSummary(request, env, loaded.storedOrder), 200, env);
  }

  if (!isStoreOrderFulfillmentReady(loaded.storedOrder)) {
    return privateJsonResponse({ error: 'Store order is not ready for fulfillment' }, 409, env);
  }

  const match = findStoreFulfillmentItem(loaded.storedOrder, route.itemId);
  if (!match) {
    return privateJsonResponse({ error: 'Store fulfillment item not found' }, 404, env);
  }

  const tokenCheck = await verifyStoreFulfillmentToken(env, new URL(request.url).searchParams.get('token'), {
    orderToken: route.orderToken,
    itemId: match.itemId,
    action: route.kind
  });
  if (!tokenCheck.ok) {
    return privateJsonResponse({ error: tokenCheck.error }, tokenCheck.status || 403, env);
  }

  if (route.kind === 'download') {
    const access = getStoreDownloadAccessState(loaded.storedOrder, match.itemId, match.item);
    if (!access.available) {
      return privateJsonResponse({ error: 'Store download access revoked' }, 410, env);
    }
    return handleStoreDownload(request, env, loaded.storedOrder, match.item, match.itemId);
  }
  if (route.kind === 'ticket') {
    return handleStoreTicketSvg(request, env, loaded.storedOrder, match.item, match.itemId);
  }
  if (route.kind === 'calendar') {
    return handleStoreCalendar(request, env, loaded.storedOrder, match.item, match.itemId);
  }
  if (route.kind === 'check_in') {
    return handleStoreCheckIn(request, env, loaded.storedOrder, match.item, match.itemId);
  }

  return privateJsonResponse({ error: 'Store fulfillment route not found' }, 404, env);
}

function privateArtifactHeaders(env, contentType, extraHeaders = {}) {
  const origin = getAllowedOrigin(env, false);
  const credentialHeaders = origin && origin !== '*'
    ? { 'Access-Control-Allow-Credentials': 'true' }
    : {};
  return {
    'Content-Type': contentType,
    'Cache-Control': PRIVATE_NO_STORE_CACHE_CONTROL,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key, x-store-admin-csrf',
    'Access-Control-Expose-Headers': 'Content-Disposition',
    ...credentialHeaders,
    ...extraHeaders,
    ...SECURITY_HEADERS
  };
}

function isStoreCatalogDownloadProduct(product = {}) {
  const fulfillmentType = String(product.fulfillment_type || product.type || '').trim().toLowerCase();
  if (fulfillmentType === 'digital') return true;
  if (product.download && typeof product.download === 'object') return true;
  return (Array.isArray(product.variants) ? product.variants : []).some((variant) => (
    variant?.download && typeof variant.download === 'object'
  ));
}

function buildStoreCatalogDownloadItem(product = {}, variant = null) {
  const variantId = String(variant?.id || '').trim();
  const download = variant?.download && typeof variant.download === 'object'
    ? variant.download
    : (product.download && typeof product.download === 'object' ? product.download : {});
  return {
    ...product,
    variantId,
    variantLabel: String(variant?.label || ''),
    sku: String(variant?.sku || product.sku || product.id || '').trim(),
    name: String(product.name || product.id || ''),
    download
  };
}

function readR2ObjectContentType(object = null) {
  if (!object) return '';
  const direct = String(object.httpMetadata?.contentType || '').trim();
  if (direct) return direct;

  if (typeof object.writeHttpMetadata === 'function') {
    try {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      return String(headers.get('Content-Type') || '').trim();
    } catch {
      return '';
    }
  }

  return '';
}

async function inspectStoreDownloadObject(env, fileKey = '') {
  const normalizedFileKey = String(fileKey || '').trim();
  const result = {
    bucketConfigured: Boolean(env.STORE_DOWNLOADS),
    checked: false,
    exists: null,
    contentType: '',
    size: null,
    uploaded: '',
    error: ''
  };

  if (!result.bucketConfigured || !normalizedFileKey) return result;

  result.checked = true;
  try {
    const object = typeof env.STORE_DOWNLOADS.head === 'function'
      ? await env.STORE_DOWNLOADS.head(normalizedFileKey)
      : await env.STORE_DOWNLOADS.get(normalizedFileKey);
    if (!object) {
      result.exists = false;
      return result;
    }

    result.exists = true;
    result.contentType = readR2ObjectContentType(object);
    const size = Number(object.size ?? object.httpMetadata?.contentLength);
    result.size = Number.isFinite(size) && size >= 0 ? Math.round(size) : null;
    result.uploaded = object.uploaded instanceof Date
      ? object.uploaded.toISOString()
      : String(object.uploaded || '');
    return result;
  } catch (error) {
    result.exists = false;
    result.error = error instanceof Error ? error.message : String(error || 'R2 object check failed');
    return result;
  }
}

async function buildAdminStoreDownloadRow(env, product = {}, variant = null) {
  const item = buildStoreCatalogDownloadItem(product, variant);
  const productId = String(product.id || '').trim();
  const variantId = String(item.variantId || '').trim();
  const fileKey = getStoreDownloadFileKey(item);
  const filename = getStoreDownloadFilename(item);
  const directUrl = resolveStoreDownloadUrl(env, item);
  const object = await inspectStoreDownloadObject(env, fileKey);
  const ready = object.exists === true || Boolean(directUrl);
  let status = 'not_configured';
  if (ready) {
    status = object.exists === true ? 'r2_ready' : 'url_ready';
  } else if (fileKey) {
    status = object.bucketConfigured ? 'missing' : 'bucket_missing';
  }

  return {
    productId,
    variantId,
    sku: item.sku,
    label: variantId
      ? `${String(product.name || productId)} (${String(item.variantLabel || variantId)})`
      : String(product.name || productId),
    productName: String(product.name || productId),
    variantLabel: String(item.variantLabel || ''),
    fileKey,
    filename,
    delivery: String(item.download?.delivery || 'signed_link'),
    expiresHours: Number.isFinite(Number(item.download?.expires_hours ?? item.download?.expiresHours))
      ? Math.max(0, Number(item.download?.expires_hours ?? item.download?.expiresHours))
      : null,
    status,
    ready,
    r2: object,
    fallbackUrlConfigured: Boolean(directUrl),
    source: object.exists === true ? 'r2' : (directUrl ? 'url' : '')
  };
}

async function listAdminStoreDownloadLibraryFiles(env) {
  if (!env.STORE_DOWNLOADS || typeof env.STORE_DOWNLOADS.list !== 'function') return [];
  const files = [];
  let cursor = undefined;
  let truncated = true;
  while (truncated && files.length < 500) {
    const page = await env.STORE_DOWNLOADS.list({
      cursor,
      limit: Math.min(100, 500 - files.length)
    });
    for (const object of page.objects || []) {
      const key = String(object.key || '').trim();
      if (!key) continue;
      files.push({
        fileKey: key,
        filename: sanitizeDownloadFilename(object.customMetadata?.filename || key),
        contentType: readR2ObjectContentType(object),
        size: Number.isFinite(Number(object.size)) ? Number(object.size) : null,
        uploadedAt: object.uploaded instanceof Date
          ? object.uploaded.toISOString()
          : String(object.uploaded || object.customMetadata?.uploaded_at || ''),
        uploadedBy: String(object.customMetadata?.uploaded_by || '').trim(),
        source: 'r2',
        ready: true,
        status: 'r2_ready'
      });
    }
    truncated = page.truncated === true;
    cursor = page.cursor;
  }
  files.sort((a, b) => a.filename.localeCompare(b.filename) || a.fileKey.localeCompare(b.fileKey));
  return files;
}

async function buildAdminStoreDownloadsSnapshot(env) {
  const catalog = normalizeStoreCatalogSnapshot(getStoreCatalogSnapshot(env));
  const rows = [];

  for (const product of catalog.products || []) {
    if (!isStoreCatalogDownloadProduct(product)) continue;
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length > 0) {
      for (const variant of variants) {
        rows.push(await buildAdminStoreDownloadRow(env, product, variant));
      }
      continue;
    }
    rows.push(await buildAdminStoreDownloadRow(env, product));
  }

  const libraryFiles = await listAdminStoreDownloadLibraryFiles(env);
  const attachedByFileKey = new Map();
  for (const row of rows) {
    if (!row.fileKey) continue;
    const attached = attachedByFileKey.get(row.fileKey) || [];
    attached.push({
      productId: row.productId,
      variantId: row.variantId,
      label: row.label,
      sku: row.sku
    });
    attachedByFileKey.set(row.fileKey, attached);
  }
  const libraryByFileKey = new Map(libraryFiles.map((file) => [file.fileKey, file]));
  for (const row of rows) {
    if (!row.fileKey || libraryByFileKey.has(row.fileKey)) continue;
    libraryFiles.push({
      fileKey: row.fileKey,
      filename: row.filename || row.fileKey,
      contentType: row.r2?.contentType || '',
      size: row.r2?.size ?? null,
      uploadedAt: row.r2?.uploaded || '',
      uploadedBy: '',
      source: row.source || 'catalog',
      ready: row.ready,
      status: row.status
    });
    libraryByFileKey.set(row.fileKey, libraryFiles[libraryFiles.length - 1]);
  }
  const files = libraryFiles.map((file) => ({
    ...file,
    attachedTo: attachedByFileKey.get(file.fileKey) || []
  })).sort((a, b) => a.filename.localeCompare(b.filename) || a.fileKey.localeCompare(b.fileKey));

  return {
    rows,
    files,
    bucketConfigured: Boolean(env.STORE_DOWNLOADS),
    r2Checks: rows.filter((row) => row.r2?.checked).length,
    totals: {
      count: rows.length,
      ready: rows.filter((row) => row.ready).length,
      missing: rows.filter((row) => !row.ready).length,
      r2Ready: rows.filter((row) => row.status === 'r2_ready').length,
      urlReady: rows.filter((row) => row.status === 'url_ready').length,
      files: files.length
    },
    updatedAt: new Date().toISOString()
  };
}

const BLOCKED_ADMIN_STORE_DOWNLOAD_CONTENT_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-javascript',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/ecmascript',
  'text/html',
  'text/javascript'
]);

function isBlockedAdminStoreDownloadContentType(contentType = '') {
  const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!normalized) return false;
  if (BLOCKED_ADMIN_STORE_DOWNLOAD_CONTENT_TYPES.has(normalized)) return true;
  return normalized.endsWith('/javascript');
}

function adminStoreDownloadBase64ByteLength(base64 = '') {
  const normalized = String(base64 || '').replace(/\s+/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function decodeAdminStoreDownloadBase64(base64 = '') {
  let normalized = String(base64 || '').replace(/\s+/g, '');
  while (normalized.length % 4) normalized += '=';
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizeAdminStoreDownloadFileKey(value, label = 'Store download file key') {
  const fileKey = String(value || '').trim();
  if (!fileKey) {
    return { ok: false, status: 400, error: `${label} is required.` };
  }
  if (fileKey.length > 512 || /[\x00-\x1F\x7F]/.test(fileKey)) {
    return { ok: false, status: 400, error: `${label} is invalid.` };
  }
  return { ok: true, value: fileKey };
}

function findAdminStoreDownloadUploadTarget(env, body = {}) {
  const productId = String(body.productId || body.product_id || '').trim();
  const variantId = String(body.variantId || body.variant_id || '').trim();
  if (!productId) {
    return { ok: false, status: 400, error: 'Store download upload requires a product ID.' };
  }

  const catalog = normalizeStoreCatalogSnapshot(getStoreCatalogSnapshot(env));
  const product = catalog.productById.get(productId);
  if (!product) {
    return { ok: false, status: 404, error: 'Store download upload references an unknown product.' };
  }

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const variantDownloads = variants.some((variant) => variant?.download && typeof variant.download === 'object');
  if (!variantId && variantDownloads && !(product.download && typeof product.download === 'object')) {
    return { ok: false, status: 400, error: 'Store download upload requires a variant ID for this product.' };
  }

  let variant = null;
  if (variantId) {
    variant = variants.find((candidate) => String(candidate?.id || '').trim() === variantId) || null;
    if (!variant) {
      return { ok: false, status: 404, error: 'Store download upload references an unknown variant.' };
    }
  }

  const item = buildStoreCatalogDownloadItem(product, variant);
  if (!isStoreCatalogDownloadProduct(product)) {
    return { ok: false, status: 400, error: 'Store download upload target is not a digital download product.' };
  }

  const fileKey = getStoreDownloadFileKey(item);
  if (!fileKey) {
    return { ok: false, status: 400, error: 'Store download upload target has no file key.' };
  }
  const normalizedFileKey = normalizeAdminStoreDownloadFileKey(fileKey, 'Store download upload target file key');
  if (!normalizedFileKey.ok) return normalizedFileKey;

  return {
    ok: true,
    product,
    variant,
    item,
    productId,
    variantId,
    sku: item.sku,
    fileKey,
    configuredFilename: getStoreDownloadFilename(item)
  };
}

function normalizeAdminStoreDownloadFilePayload(body = {}, fallbackFilename = 'store-download') {
  const content = String(body.content || body.dataBase64 || '').trim();
  const dataUrlMatch = content.match(/^data:([^;]*);base64,/i);
  const dataUrlContentType = dataUrlMatch ? dataUrlMatch[1].trim().toLowerCase() : '';
  const suppliedContentType = String(body.contentType || body.content_type || '').split(';')[0].trim().toLowerCase();
  if (dataUrlContentType && suppliedContentType && dataUrlContentType !== suppliedContentType) {
    return { ok: false, status: 400, error: 'Store download content type does not match the uploaded file.' };
  }

  const contentType = suppliedContentType || dataUrlContentType || 'application/octet-stream';
  if (isBlockedAdminStoreDownloadContentType(contentType)) {
    return { ok: false, status: 400, error: 'Store download upload type is not allowed.' };
  }

  const base64 = content.replace(/^data:[^;]*;base64,/i, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 === 1) {
    return { ok: false, status: 400, error: 'Store download content must be base64 encoded.' };
  }

  const estimatedBytes = adminStoreDownloadBase64ByteLength(base64);
  if (estimatedBytes <= 0) {
    return { ok: false, status: 400, error: 'Store download upload is empty.' };
  }
  if (estimatedBytes > MAX_ADMIN_STORE_DOWNLOAD_FILE_BYTES) {
    return { ok: false, status: 413, error: 'Store download upload must be 100 MB or smaller.' };
  }

  const filename = sanitizeDownloadFilename(body.filename || fallbackFilename);
  return {
    ok: true,
    base64,
    estimatedBytes,
    filename,
    contentType
  };
}

function normalizeAdminStoreDownloadUploadBody(body = {}, env) {
  const target = findAdminStoreDownloadUploadTarget(env, body);
  if (!target.ok) return target;

  const payload = normalizeAdminStoreDownloadFilePayload(
    body,
    target.configuredFilename || target.fileKey
  );
  if (!payload.ok) return payload;

  return {
    ok: true,
    ...target,
    ...payload
  };
}

function normalizeAdminStoreDownloadCreateBody(body = {}) {
  const payloadResult = normalizeAdminStoreDownloadFilePayload(
    body,
    body.filename || 'store-download'
  );
  if (!payloadResult.ok) {
    return { ok: false, status: payloadResult.status || 422, errors: [payloadResult.error] };
  }
  const fileKeyResult = normalizeAdminStoreDownloadFileKey(
    body.fileKey || body.file_key || downloadFilenameToFileKey(payloadResult.filename),
    'Download file key'
  );
  if (fileKeyResult.ok && !isValidSlug(fileKeyResult.value)) {
    return { ok: false, status: 422, errors: ['Download file key must be a URL-safe lowercase slug.'] };
  }
  if (!fileKeyResult.ok) {
    return { ok: false, status: fileKeyResult.status || 422, errors: [fileKeyResult.error] };
  }

  return {
    ok: true,
    fileKey: fileKeyResult.value,
    filename: payloadResult.filename,
    contentType: payloadResult.contentType,
    base64: payloadResult.base64,
    estimatedBytes: payloadResult.estimatedBytes
  };
}

async function handleAdminStoreDownloads(request, env) {
  const auth = await requireAdminSession(request, env, 'fulfillment:manage', { accessScope: STORE_ADMIN_SCOPE });
  if (!auth.ok) return auth.response;

  const snapshot = await buildAdminStoreDownloadsSnapshot(env);
  return privateJsonResponse({
    scope: STORE_ADMIN_SCOPE,
    bucketConfigured: snapshot.bucketConfigured,
    rows: snapshot.rows,
    files: snapshot.files,
    totals: snapshot.totals,
    updatedAt: snapshot.updatedAt,
    page: {
      r2Checks: snapshot.r2Checks
    },
    writeBudget: adminReadBudget({ kvListExpected: 0 })
  }, 200, env);
}

async function handleAdminStoreDownloadUpload(request, env) {
  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_ADMIN_STORE_DOWNLOAD_UPLOAD_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const auth = await requireAdminSession(request, env, 'fulfillment:manage', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;

  if (!env.STORE_DOWNLOADS || typeof env.STORE_DOWNLOADS.put !== 'function') {
    return privateJsonResponse({
      error: 'Store downloads bucket is not configured for uploads.',
      code: 'store_downloads_bucket_missing',
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0, r2WritesExpected: 0 })
    }, 503, env);
  }

  const normalized = normalizeAdminStoreDownloadUploadBody(parsedBody.body || {}, env);
  if (!normalized.ok) {
    return privateJsonResponse({
      error: normalized.error || 'Invalid Store download upload.',
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0, r2WritesExpected: 0 })
    }, normalized.status || 400, env);
  }

  let bytes;
  try {
    bytes = decodeAdminStoreDownloadBase64(normalized.base64);
  } catch {
    return privateJsonResponse({
      error: 'Store download content must be base64 encoded.',
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0, r2WritesExpected: 0 })
    }, 400, env);
  }

  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_ADMIN_STORE_DOWNLOAD_FILE_BYTES) {
    return privateJsonResponse({
      error: bytes.byteLength > MAX_ADMIN_STORE_DOWNLOAD_FILE_BYTES
        ? 'Store download upload must be 100 MB or smaller.'
        : 'Store download upload is empty.',
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0, r2WritesExpected: 0 })
    }, bytes.byteLength > MAX_ADMIN_STORE_DOWNLOAD_FILE_BYTES ? 413 : 400, env);
  }

  const uploadedAt = new Date().toISOString();
  const contentDisposition = `attachment; filename="${normalized.filename}"`;
  await env.STORE_DOWNLOADS.put(normalized.fileKey, bytes, {
    httpMetadata: {
      contentType: normalized.contentType,
      contentDisposition
    },
    customMetadata: {
      filename: normalized.filename,
      product_id: normalized.productId,
      variant_id: normalized.variantId,
      uploaded_by: String(auth.user.email || ''),
      uploaded_at: uploadedAt
    }
  });

  const auditKey = await recordAdminAuditEvent(env, {
    action: 'store_download:upload',
    adminEmail: auth.user.email,
    adminRole: auth.user.role,
    productId: normalized.productId,
    variantId: normalized.variantId,
    sku: normalized.sku,
    fileKey: normalized.fileKey,
    filename: normalized.filename,
    contentType: normalized.contentType,
    bytes: bytes.byteLength
  });

  return privateJsonResponse({
    success: true,
    scope: STORE_ADMIN_SCOPE,
    productId: normalized.productId,
    variantId: normalized.variantId,
    sku: normalized.sku,
    fileKey: normalized.fileKey,
    filename: normalized.filename,
    contentType: normalized.contentType,
    bytes: bytes.byteLength,
    uploadedAt,
    auditKey,
    writeBudget: adminWriteBudget({
      readOnly: false,
      kvWritesExpected: 1,
      kvListExpected: 0,
      r2WritesExpected: 1
    })
  }, 200, env);
}

async function handleAdminStoreDownloadCreate(request, env) {
  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_ADMIN_STORE_DOWNLOAD_UPLOAD_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const auth = await requireAdminSession(request, env, 'fulfillment:manage', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;

  if (!env.STORE_DOWNLOADS || typeof env.STORE_DOWNLOADS.put !== 'function') {
    return privateJsonResponse({
      error: 'Store downloads bucket is not configured for uploads.',
      code: 'store_downloads_bucket_missing',
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0, r2WritesExpected: 0 })
    }, 503, env);
  }

  const normalized = normalizeAdminStoreDownloadCreateBody(parsedBody.body || {});
  if (!normalized.ok) {
    return privateJsonResponse({
      success: false,
      errors: normalized.errors || ['Invalid Store download.'],
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0, r2WritesExpected: 0 })
    }, normalized.status || 422, env);
  }

  let bytes;
  try {
    bytes = decodeAdminStoreDownloadBase64(normalized.base64);
  } catch {
    return privateJsonResponse({
      error: 'Store download content must be base64 encoded.',
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0, r2WritesExpected: 0 })
    }, 400, env);
  }

  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_ADMIN_STORE_DOWNLOAD_FILE_BYTES) {
    return privateJsonResponse({
      error: bytes.byteLength > MAX_ADMIN_STORE_DOWNLOAD_FILE_BYTES
        ? 'Store download upload must be 100 MB or smaller.'
        : 'Store download upload is empty.',
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0, r2WritesExpected: 0 })
    }, bytes.byteLength > MAX_ADMIN_STORE_DOWNLOAD_FILE_BYTES ? 413 : 400, env);
  }

  const uploadedAt = new Date().toISOString();
  await env.STORE_DOWNLOADS.put(normalized.fileKey, bytes, {
    httpMetadata: {
      contentType: normalized.contentType,
      contentDisposition: `attachment; filename="${normalized.filename}"`
    },
    customMetadata: {
      file_key: normalized.fileKey,
      filename: normalized.filename,
      uploaded_by: String(auth.user.email || ''),
      uploaded_at: uploadedAt
    }
  });

  const auditKey = await recordAdminAuditEvent(env, {
    action: 'store_download:create',
    adminEmail: auth.user.email,
    adminRole: auth.user.role,
    fileKey: normalized.fileKey,
    filename: normalized.filename,
    contentType: normalized.contentType,
    bytes: bytes.byteLength
  });

  return privateJsonResponse({
    success: true,
    scope: STORE_ADMIN_SCOPE,
    uploaded: true,
    fileKey: normalized.fileKey,
    filename: normalized.filename,
    contentType: normalized.contentType,
    bytes: bytes.byteLength,
    uploadedAt,
    auditKey,
    writeBudget: adminWriteBudget({
      readOnly: false,
      kvWritesExpected: 1,
      kvListExpected: 0,
      r2WritesExpected: 1
    })
  }, 200, env);
}

async function handleAdminStoreDownloadDelete(request, env) {
  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: 4096,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const auth = await requireAdminSession(request, env, 'fulfillment:manage', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;

  if (!env.STORE_DOWNLOADS || typeof env.STORE_DOWNLOADS.delete !== 'function') {
    return privateJsonResponse({
      error: 'Store downloads bucket is not configured for deletes.',
      code: 'store_downloads_bucket_missing',
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0, r2WritesExpected: 0 })
    }, 503, env);
  }

  const fileKeyResult = normalizeAdminStoreDownloadFileKey(
    parsedBody.body?.fileKey || parsedBody.body?.file_key,
    'Download file key'
  );
  if (!fileKeyResult.ok) {
    return privateJsonResponse({
      error: fileKeyResult.error || 'Download file key is invalid.',
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0, r2WritesExpected: 0 })
    }, fileKeyResult.status || 400, env);
  }

  const fileKey = fileKeyResult.value;
  const filename = sanitizeDownloadFilename(parsedBody.body?.filename || fileKey);
  const existing = await inspectStoreDownloadObject(env, fileKey);
  if (existing.checked && existing.exists === false) {
    return privateJsonResponse({
      error: 'Store download file was not found.',
      fileKey,
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0, r2WritesExpected: 0 })
    }, 404, env);
  }

  await env.STORE_DOWNLOADS.delete(fileKey);
  const auditKey = await recordAdminAuditEvent(env, {
    action: 'store_download:delete',
    adminEmail: auth.user.email,
    adminRole: auth.user.role,
    fileKey,
    filename,
    contentType: existing.contentType || '',
    bytes: existing.size ?? null
  });

  return privateJsonResponse({
    success: true,
    scope: STORE_ADMIN_SCOPE,
    deleted: true,
    fileKey,
    filename,
    auditKey,
    writeBudget: adminWriteBudget({
      readOnly: false,
      kvWritesExpected: 1,
      kvListExpected: 0,
      r2WritesExpected: 1
    })
  }, 200, env);
}

async function handleStoreDownload(_request, env, _storedOrder, item = {}, itemId = '') {
  if (!isStoreDownloadItem(item)) {
    return privateJsonResponse({ error: 'Store item is not a digital download' }, 404, env);
  }

  const fileKey = getStoreDownloadFileKey(item);
  const filename = getStoreDownloadFilename(item);
  if (env.STORE_DOWNLOADS && fileKey) {
    const object = await env.STORE_DOWNLOADS.get(fileKey);
    if (object) {
      const headers = privateArtifactHeaders(env, object.httpMetadata?.contentType || 'application/octet-stream', {
        'Content-Disposition': `attachment; filename="${filename}"`
      });
      if (typeof object.writeHttpMetadata === 'function') {
        const metadataHeaders = new Headers();
        object.writeHttpMetadata(metadataHeaders);
        const contentType = metadataHeaders.get('Content-Type');
        if (contentType) headers['Content-Type'] = contentType;
      }
      return new Response(object.body, { status: 200, headers });
    }
  }

  const targetUrl = resolveStoreDownloadUrl(env, item);
  if (targetUrl) {
    return new Response(null, {
      status: 302,
      headers: privateArtifactHeaders(env, 'text/plain; charset=utf-8', {
        Location: targetUrl
      })
    });
  }

  return privateJsonResponse({
    error: 'Store download is not configured yet',
    itemId
  }, 404, env);
}

async function handleStoreTicketSvg(request, env, storedOrder = {}, item = {}, itemId = '') {
  if (!isStoreTicketLikeItem(item)) {
    return privateJsonResponse({ error: 'Store item is not a ticket or RSVP' }, 404, env);
  }

  const orderToken = String(storedOrder.orderToken || storedOrder.orderDraft?.orderToken || '').trim();
  const checkInToken = await signStoreFulfillmentToken(env, { orderToken, itemId, action: 'check_in' });
  const checkInUrl = buildStoreFulfillmentUrl(request, env, orderToken, 'check-in', itemId, '', checkInToken);
  const qrSvg = await buildStoreCheckInQrSvg(checkInUrl);
  const ticketSvg = buildStoreTicketSvg(env, storedOrder, item, itemId, checkInUrl, qrSvg);
  return new Response(ticketSvg, {
    status: 200,
    headers: privateArtifactHeaders(env, 'image/svg+xml; charset=utf-8', {
      'Content-Disposition': `inline; filename="${sanitizeDownloadFilename(`${itemId || 'store-ticket'}.svg`)}"`
    })
  });
}

function buildStoreTicketSvg(env, storedOrder = {}, item = {}, itemId = '', checkInUrl = '', qrSvg = '') {
  const type = getStoreFulfillmentType(item);
  const heading = type === 'rsvp' ? 'RSVP' : 'Ticket';
  const title = item.name || heading;
  const variant = item.variantLabel ? ` (${item.variantLabel})` : '';
  const ticketTitle = `${title}${variant}`;
  const quantity = Math.max(1, Number(item.quantity || 1) || 1);
  const event = summarizeStoreEventDetails(item.eventDetails);
  const eventTime = formatStoreEventDisplay(event, env);
  const holder = storedOrder.orderDraft?.customer?.name || storedOrder.orderDraft?.customer?.email || '';
  const qrDataUri = `data:image/svg+xml;base64,${base64EncodeString(qrSvg)}`;
  const contentX = 88;
  const contentWidth = 544;
  const titleBlock = renderSvgTextBlock(ticketTitle, {
    x: contentX,
    y: 210,
    maxWidth: contentWidth,
    maxLines: 3,
    fontSizes: [48, 44, 40, 36],
    fontWeight: 900,
    fill: '#101215',
    lineHeightFactor: 1.12
  });
  const eventTimeY = titleBlock.bottomY + 56;
  const venueY = eventTimeY + 50;
  const addressBlock = renderSvgTextBlock(event?.address || '', {
    x: contentX,
    y: venueY + 38,
    maxWidth: contentWidth,
    maxLines: 2,
    fontSizes: [20, 18],
    fontWeight: 400,
    fill: '#5d6573',
    lineHeightFactor: 1.24
  });
  const maxQrBottom = 872;
  let qrY = Math.max(430, addressBlock.bottomY + 64);
  let qrSize = Math.min(360, maxQrBottom - qrY);
  if (qrSize < 280) {
    qrSize = 280;
    qrY = Math.min(qrY, maxQrBottom - qrSize);
  }
  const qrX = Math.round((720 - qrSize) / 2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1040" viewBox="0 0 720 1040" role="img" aria-label="${escapeXml(`${heading} ${ticketTitle}`)}">
  <rect width="720" height="1040" fill="#f0f1ed"/>
  <rect x="44" y="44" width="632" height="952" rx="18" fill="#ffffff" stroke="#101215" stroke-width="4"/>
  <text x="88" y="132" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="800" fill="#252930" letter-spacing="3">${escapeXml(heading.toUpperCase())}</text>
  ${titleBlock.markup}
  <text x="${contentX}" y="${eventTimeY}" font-family="Inter, Arial, sans-serif" font-size="25" fill="#252930">${escapeXml(eventTime || 'Event details pending')}</text>
  <text x="${contentX}" y="${venueY}" font-family="Inter, Arial, sans-serif" font-size="24" fill="#252930">${escapeXml(event?.venue || '')}</text>
  ${addressBlock.markup}
  <image href="${qrDataUri}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}"/>
  <text x="88" y="908" font-family="Inter, Arial, sans-serif" font-size="22" fill="#252930">Order: ${escapeXml(storedOrder.orderToken || '')}</text>
  <text x="88" y="944" font-family="Inter, Arial, sans-serif" font-size="22" fill="#252930">Qty: ${quantity}${holder ? ` · ${escapeXml(holder)}` : ''}</text>
</svg>`;
}

function formatStoreEventDisplay(event = null, env = {}) {
  if (!event?.startsAt) return '';
  const start = new Date(event.startsAt);
  if (Number.isNaN(start.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: getPlatformTimeZone(env),
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    }).format(start);
  } catch {
    return start.toISOString();
  }
}

function handleStoreCheckIn(_request, env, storedOrder = {}, item = {}, itemId = '') {
  if (!isStoreTicketLikeItem(item)) {
    return privateJsonResponse({ error: 'Store item is not a ticket or RSVP' }, 404, env);
  }

  const checkIn = getStoreItemCheckInState(storedOrder, itemId, item);
  return privateJsonResponse({
    ok: true,
    valid: true,
    orderToken: storedOrder.orderToken || '',
    itemId,
    status: storedOrder.status || '',
    checkedIn: checkIn.checkedIn,
    checkIn,
    item: {
      sku: item.sku || '',
      name: item.name || '',
      variantLabel: item.variantLabel || '',
      quantity: Math.max(1, Number(item.quantity || 1) || 1),
      fulfillmentType: getStoreFulfillmentType(item)
    },
    customer: {
      email: storedOrder.orderDraft?.customer?.email || '',
      name: storedOrder.orderDraft?.customer?.name || ''
    },
    event: summarizeStoreEventDetails(item.eventDetails),
    generatedAt: new Date().toISOString()
  }, 200, env);
}

function buildStoreCalendarIcs(env, storedOrder = {}, item = {}, itemId = '', options = {}) {
  if (!isStoreTicketLikeItem(item) || item.eventDetails?.ics === false) {
    return '';
  }

  const event = summarizeStoreEventDetails(item.eventDetails);
  const starts = new Date(event?.startsAt || '');
  if (Number.isNaN(starts.getTime())) {
    return '';
  }
  const ends = event?.endsAt ? new Date(event.endsAt) : new Date(starts.getTime() + (2 * 60 * 60 * 1000));
  const safeEnds = Number.isNaN(ends.getTime()) ? new Date(starts.getTime() + (2 * 60 * 60 * 1000)) : ends;
  const summary = item.name || 'Store event';
  const description = [
    `Order: ${storedOrder.orderToken || ''}`,
    `Item: ${item.name || itemId}`,
    `Quantity: ${Math.max(1, Number(item.quantity || 1) || 1)}`
  ].join('\n');
  const location = [event?.venue, event?.address].filter(Boolean).join(', ');
  const uidHost = getSiteOrigin(env).replace(/^https?:\/\//, '') || 'store.local';
  const method = String(options.method || 'PUBLISH').trim().toUpperCase() === 'REQUEST' ? 'REQUEST' : 'PUBLISH';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dust Wave//Store//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(`${storedOrder.orderToken || 'store'}-${itemId}@${uidHost}`)}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(starts)}`,
    `DTEND:${formatIcsDate(safeEnds)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    location ? `LOCATION:${escapeIcsText(location)}` : '',
    `DESCRIPTION:${escapeIcsText(description)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');
}

function handleStoreCalendar(_request, env, storedOrder = {}, item = {}, itemId = '') {
  if (!isStoreTicketLikeItem(item) || item.eventDetails?.ics === false) {
    return privateJsonResponse({ error: 'Store item does not have calendar fulfillment' }, 404, env);
  }

  const ics = buildStoreCalendarIcs(env, storedOrder, item, itemId, { method: 'PUBLISH' });
  if (!ics) {
    return privateJsonResponse({ error: 'Store event start time is not configured' }, 404, env);
  }

  return new Response(ics, {
    status: 200,
    headers: privateArtifactHeaders(env, 'text/calendar; charset=utf-8', {
      'Content-Disposition': `attachment; filename="${sanitizeDownloadFilename(`${itemId || 'store-event'}.ics`)}"`
    })
  });
}

async function buildStoreEventEmailAttachments(env, storedOrder = {}, item = {}, itemId = '', options = {}) {
  const attachments = [];
  if (!isStoreTicketLikeItem(item)) return attachments;

  const safeItemId = sanitizeDownloadFilename(itemId || item.sku || item.name || 'store-event');
  const calendarMethod = String(options.calendarMethod || 'REQUEST').trim().toUpperCase() === 'PUBLISH' ? 'PUBLISH' : 'REQUEST';
  const ics = buildStoreCalendarIcs(env, storedOrder, item, itemId, { method: calendarMethod });
  if (ics) {
    attachments.push({
      filename: sanitizeDownloadFilename(`${safeItemId}.ics`),
      content: base64EncodeString(ics)
    });
  }

  return attachments;
}

async function buildStoreOrderEventEmailAttachments(env, storedOrder = {}, options = {}) {
  const items = Array.isArray(storedOrder.orderDraft?.items) ? storedOrder.orderDraft.items : [];
  const attachments = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index] || {};
    if (!isStoreTicketLikeItem(item)) continue;
    const itemId = getStoreFulfillmentId(item, index);
    const itemAttachments = await buildStoreEventEmailAttachments(env, storedOrder, item, itemId, options);
    attachments.push(...itemAttachments);
    if (attachments.length >= 24) break;
  }
  return attachments.slice(0, 24);
}

function getStoreFulfillmentCheckIns(storedOrder = {}) {
  const checkIns = storedOrder.fulfillmentCheckIns;
  return checkIns && typeof checkIns === 'object' && !Array.isArray(checkIns) ? checkIns : {};
}

function getStoreItemQuantity(item = {}) {
  return Math.max(1, Number(item.quantity || 1) || 1);
}

function getStoreItemCheckInState(storedOrder = {}, itemId = '', item = {}) {
  const normalizedItemId = normalizeStoreFulfillmentId(itemId);
  const checkIns = getStoreFulfillmentCheckIns(storedOrder);
  const record = checkIns[normalizedItemId] && typeof checkIns[normalizedItemId] === 'object'
    ? checkIns[normalizedItemId]
    : {};
  const itemQuantity = getStoreItemQuantity(item);
  const rawQuantity = Number(record.quantity ?? record.count);
  const checkedIn = record.checkedIn === true;
  const checkedQuantity = checkedIn
    ? Math.max(1, Math.min(itemQuantity, Number.isFinite(rawQuantity) && rawQuantity > 0 ? Math.floor(rawQuantity) : itemQuantity))
    : 0;

  return {
    checkedIn,
    quantity: checkedQuantity,
    checkedInAt: checkedIn ? String(record.checkedInAt || '') : '',
    checkedInBy: checkedIn ? String(record.checkedInBy || '') : '',
    updatedAt: String(record.updatedAt || ''),
    updatedBy: String(record.updatedBy || ''),
    note: String(record.note || '')
  };
}

function buildAdminStoreFulfillmentItem(storedOrder = {}, item = {}, index = 0) {
  const itemId = getStoreFulfillmentId(item, index);
  const checkIn = getStoreItemCheckInState(storedOrder, itemId, item);
  const fulfillmentType = getStoreFulfillmentType(item) || (item.shippable ? 'physical' : 'digital');
  const downloadAccess = fulfillmentType === 'digital' || isStoreDownloadItem(item)
    ? getStoreDownloadAccessState(storedOrder, itemId, item)
    : null;
  const event = summarizeStoreEventDetails(item.eventDetails);
  return {
    id: itemId,
    productId: item.productId || '',
    variantId: item.variantId || '',
    sku: item.sku || '',
    name: item.name || '',
    variantLabel: item.variantLabel || '',
    quantity: getStoreItemQuantity(item),
    unitPriceCents: Math.max(0, Number(item.unitPriceCents || 0) || 0),
    subtotalCents: Math.max(0, Number(item.subtotalCents || 0) || 0),
    currency: item.currency || storedOrder.orderDraft?.currency || storedOrder.payment?.currency || 'USD',
    taxCategory: item.taxCategory || '',
    fulfillmentType,
    shippable: item.shippable === true || fulfillmentType === 'physical',
    event,
    checkIn,
    checkInAvailable: isStoreTicketLikeItem(item),
    downloadAccess,
    downloadAccessAvailable: downloadAccess?.available === true
  };
}

function normalizeAdminStoreMarketingCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeAdminStoreOrderAttribution(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ref: normalizeAdminStoreMarketingCode(source.ref),
    utmSource: String(source.utmSource || source.utm_source || '').trim().slice(0, 80),
    utmMedium: String(source.utmMedium || source.utm_medium || '').trim().slice(0, 80),
    utmCampaign: String(source.utmCampaign || source.utm_campaign || '').trim().slice(0, 120),
    utmContent: String(source.utmContent || source.utm_content || '').trim().slice(0, 120),
    landingPath: String(source.landingPath || source.landing_path || '').trim().slice(0, 2048),
    capturedAt: String(source.capturedAt || source.captured_at || '').trim().slice(0, 40)
  };
}

function normalizeAdminStorePaymentCardChecks(payment = {}) {
  const source = payment.cardChecks && typeof payment.cardChecks === 'object'
    ? payment.cardChecks
    : {};
  return {
    addressLine1Check: String(source.addressLine1Check || source.address_line1_check || '').trim(),
    addressPostalCodeCheck: String(source.addressPostalCodeCheck || source.address_postal_code_check || '').trim(),
    cvcCheck: String(source.cvcCheck || source.cvc_check || '').trim(),
    networkStatus: String(source.networkStatus || source.network_status || '').trim(),
    riskLevel: String(source.riskLevel || source.risk_level || '').trim(),
    outcomeType: String(source.outcomeType || source.outcome_type || '').trim()
  };
}

function buildAdminStoreOrderRecord(storedOrder = {}) {
  const orderDraft = storedOrder.orderDraft || {};
  const attribution = normalizeAdminStoreOrderAttribution(orderDraft.attribution || storedOrder.attribution || {});
  const items = (Array.isArray(orderDraft.items) ? orderDraft.items : [])
    .map((item, index) => buildAdminStoreFulfillmentItem(storedOrder, item, index));
  const fulfillmentReady = isStoreOrderFulfillmentReady(storedOrder);
  const ticketItems = items.filter((item) => item.checkInAvailable);
  const checkedInQuantity = ticketItems.reduce((sum, item) => sum + Number(item.checkIn?.quantity || 0), 0);
  const ticketQuantity = ticketItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const currency = orderDraft.currency || storedOrder.payment?.currency || 'USD';

  return {
    orderToken: storedOrder.orderToken || orderDraft.orderToken || '',
    status: storedOrder.status || orderDraft.status || STORE_ORDER_STATUS_DRAFT,
    fulfillmentReady,
    createdAt: storedOrder.createdAt || orderDraft.createdAt || '',
    confirmedAt: storedOrder.confirmedAt || orderDraft.confirmedAt || '',
    failedAt: storedOrder.failedAt || orderDraft.failedAt || '',
    updatedAt: storedOrder.updatedAt || '',
    emailSent: storedOrder.emailSent === true,
    customer: {
      email: orderDraft.customer?.email || '',
      name: orderDraft.customer?.name || ''
    },
    totals: {
      subtotalCents: Math.max(0, Number(orderDraft.totals?.subtotalCents || 0) || 0),
      tipPercent: Math.max(0, Number(orderDraft.totals?.tipPercent || 0) || 0),
      tipAmountCents: Math.max(0, Number(orderDraft.totals?.tipAmountCents || 0) || 0),
      shippingCents: Math.max(0, Number(orderDraft.totals?.shippingCents || 0) || 0),
      taxCents: Math.max(0, Number(orderDraft.totals?.taxCents || 0) || 0),
      totalCents: Math.max(0, Number(orderDraft.totals?.totalCents ?? storedOrder.payment?.amountCents ?? 0) || 0),
      itemCount: Math.max(0, Number(orderDraft.totals?.itemCount || 0) || 0),
      currency
    },
    payment: {
      required: storedOrder.payment?.required === true,
      provider: storedOrder.payment?.provider || null,
      status: storedOrder.payment?.status || (orderDraft.totals?.requiresPayment ? 'pending' : 'not_required'),
      amountCents: Math.max(0, Number(storedOrder.payment?.amountCents ?? orderDraft.totals?.totalCents ?? 0) || 0),
      currency: storedOrder.payment?.currency || currency,
      paymentIntentId: storedOrder.payment?.paymentIntentId || storedOrder.stripePaymentIntentId || '',
      chargeId: storedOrder.payment?.chargeId || storedOrder.stripeChargeId || '',
      balanceTransactionId: storedOrder.payment?.balanceTransactionId || storedOrder.stripeBalanceTransactionId || '',
      cardChecks: normalizeAdminStorePaymentCardChecks(storedOrder.payment || {})
    },
    shipping: {
      required: orderDraft.fulfillment?.requiresShipping === true || orderDraft.totals?.requiresShipping === true,
      address: orderDraft.shippingAddress || null
    },
    attribution,
    counts: {
      fulfillmentRows: items.length,
      physicalItems: items.filter((item) => item.shippable || item.fulfillmentType === 'physical').reduce((sum, item) => sum + item.quantity, 0),
      digitalItems: items.filter((item) => item.fulfillmentType === 'digital').reduce((sum, item) => sum + item.quantity, 0),
      ticketItems: ticketQuantity,
      checkedInItems: checkedInQuantity
    },
    fulfillmentTypes: Array.from(new Set(items.map((item) => item.fulfillmentType).filter(Boolean))).sort(),
    items
  };
}

function adminStoreOrderSearchText(order = {}) {
  return [
    order.orderToken,
    order.status,
    order.customer?.email,
    order.customer?.name,
    order.payment?.status,
    ...(Array.isArray(order.items) ? order.items.flatMap((item) => [
      item.id,
      item.productId,
      item.variantId,
      item.sku,
      item.name,
      item.variantLabel,
      item.fulfillmentType,
      item.event?.startsAt,
      item.event?.venue,
      item.event?.address,
      item.checkIn?.checkedIn ? 'checked in' : 'not checked in',
      item.checkIn?.checkedInBy,
      item.checkIn?.updatedBy,
      item.checkIn?.note
    ]) : [])
  ].filter(Boolean).join(' ').toLowerCase();
}

function adminStoreOrderMatchesFilters(order = {}, filters = {}) {
  if (filters.status && filters.status !== 'all' && String(order.status || '').toLowerCase() !== filters.status) {
    return false;
  }
  if (filters.query && !adminStoreOrderSearchText(order).includes(filters.query)) {
    return false;
  }
  return true;
}

function adminStoreFulfillmentMatchesFilter(item = {}, filters = {}) {
  const filter = String(filters.fulfillment || 'all').toLowerCase();
  if (!filter || filter === 'all') return true;
  const type = String(item.fulfillmentType || '').toLowerCase();
  if (filter === 'physical') return type === 'physical' || item.shippable === true;
  if (filter === 'digital') return type === 'digital';
  if (filter === 'ticket') return type === 'ticket';
  if (filter === 'rsvp') return type === 'rsvp';
  if (filter === 'event') return type === 'ticket' || type === 'rsvp';
  if (filter === 'shipping') return item.shippable === true;
  if (filter === 'checked_in') return item.checkInAvailable === true && item.checkIn?.checkedIn === true;
  if (filter === 'unchecked') return item.checkInAvailable === true && item.checkIn?.checkedIn !== true;
  return true;
}

function adminStoreOrderSortTime(order = {}) {
  const timestamp = Date.parse(order.confirmedAt || order.createdAt || order.updatedAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareAdminStoreOrders(a = {}, b = {}) {
  return adminStoreOrderSortTime(b) - adminStoreOrderSortTime(a) ||
    String(b.orderToken || '').localeCompare(String(a.orderToken || ''));
}

function buildAdminStoreFulfillmentRow(order = {}, item = {}) {
  return {
    orderToken: order.orderToken || '',
    status: order.status || '',
    fulfillmentReady: order.fulfillmentReady === true,
    createdAt: order.createdAt || '',
    confirmedAt: order.confirmedAt || '',
    customerEmail: order.customer?.email || '',
    customerName: order.customer?.name || '',
    totalCents: order.totals?.totalCents || 0,
    discountCents: order.totals?.discountCents || 0,
    couponCode: order.totals?.couponCode || order.totals?.coupon?.code || '',
    currency: order.totals?.currency || order.payment?.currency || 'USD',
    paymentStatus: order.payment?.status || '',
    emailSent: order.emailSent === true,
    shippingRequired: order.shipping?.required === true,
    itemId: item.id || '',
    productId: item.productId || '',
    variantId: item.variantId || '',
    sku: item.sku || '',
    itemName: item.name || '',
    variantLabel: item.variantLabel || '',
    quantity: item.quantity || 0,
    subtotalCents: item.subtotalCents || 0,
    taxCategory: item.taxCategory || '',
    fulfillmentType: item.fulfillmentType || '',
    shippable: item.shippable === true,
    eventStartsAt: item.event?.startsAt || '',
    eventVenue: item.event?.venue || '',
    eventAddress: item.event?.address || '',
    checkInAvailable: order.fulfillmentReady === true && item.checkInAvailable === true,
    checkedIn: item.checkIn?.checkedIn === true,
    checkedInQuantity: item.checkIn?.quantity || 0,
    checkedInAt: item.checkIn?.checkedInAt || '',
    checkedInBy: item.checkIn?.checkedInBy || '',
    checkInUpdatedAt: item.checkIn?.updatedAt || '',
    checkInUpdatedBy: item.checkIn?.updatedBy || '',
    checkInNote: item.checkIn?.note || '',
    downloadAccessManageable: order.fulfillmentReady === true && item.fulfillmentType === 'digital',
    downloadAccess: item.downloadAccess || null,
    downloadAccessStatus: item.downloadAccess?.status || '',
    downloadAccessExpiresAt: item.downloadAccess?.expiresAt || '',
    downloadAccessExpiresHours: item.downloadAccess?.expiresHours || 0,
    downloadAccessRevokedAt: item.downloadAccess?.revokedAt || item.downloadAccess?.expiredAt || '',
    downloadAccessUpdatedAt: item.downloadAccess?.updatedAt || '',
    downloadAccessUpdatedBy: item.downloadAccess?.updatedBy || ''
  };
}

function isAdminStoreAnalyticsTicketRow(row = {}) {
  const fulfillmentType = String(row.fulfillmentType || '').trim().toLowerCase();
  if (fulfillmentType === 'ticket' || fulfillmentType === 'rsvp') return true;
  return fulfillmentType === 'legacy' &&
    String(row.taxCategory || '').trim().toLowerCase() === 'admission' &&
    row.shippable !== true;
}

function isAdminStoreAnalyticsSettledOrder(order = {}) {
  if (String(order.status || '').trim().toLowerCase() !== STORE_ORDER_STATUS_CONFIRMED) return false;
  const payment = order.payment || {};
  const paymentStatus = String(payment.status || '').trim().toLowerCase();
  if (payment.required === true) return paymentStatus === 'succeeded';
  return !paymentStatus || paymentStatus === 'not_required' || paymentStatus === 'succeeded';
}

function adminStoreAttendanceGroupKey(row = {}) {
  return [
    row.productId || row.sku || row.itemId,
    row.variantId || row.variantLabel,
    row.fulfillmentType,
    row.eventStartsAt,
    row.eventVenue,
    row.eventAddress,
    row.itemName
  ].map((part) => String(part || '').trim().toLowerCase()).join('|');
}

function compareAdminStoreAttendanceEvents(a = {}, b = {}) {
  const aTime = Date.parse(a.eventStartsAt || '');
  const bTime = Date.parse(b.eventStartsAt || '');
  const safeATime = Number.isFinite(aTime) ? aTime : Number.MAX_SAFE_INTEGER;
  const safeBTime = Number.isFinite(bTime) ? bTime : Number.MAX_SAFE_INTEGER;
  return safeATime - safeBTime ||
    String(a.eventVenue || '').localeCompare(String(b.eventVenue || '')) ||
    String(a.itemName || '').localeCompare(String(b.itemName || '')) ||
    String(a.variantLabel || '').localeCompare(String(b.variantLabel || ''));
}

function buildAdminStoreAttendanceReport(rows = []) {
  const groups = new Map();
  const orderTokens = new Set();
  for (const row of rows) {
    if (row.checkInAvailable !== true) continue;
    const key = adminStoreAttendanceGroupKey(row);
    const quantity = Math.max(0, Number(row.quantity || 0) || 0);
    const checkedInQuantity = Math.max(0, Number(row.checkedInQuantity || 0) || 0);
    const existing = groups.get(key) || {
      key,
      productId: row.productId || '',
      variantId: row.variantId || '',
      sku: row.sku || '',
      itemName: row.itemName || '',
      variantLabel: row.variantLabel || '',
      fulfillmentType: row.fulfillmentType || '',
      eventStartsAt: row.eventStartsAt || '',
      eventVenue: row.eventVenue || '',
      eventAddress: row.eventAddress || '',
      quantity: 0,
      checkedInQuantity: 0,
      uncheckedQuantity: 0,
      rowCount: 0,
      orderCount: 0,
      orderTokens: new Set()
    };
    existing.quantity += quantity;
    existing.checkedInQuantity += Math.min(quantity, checkedInQuantity);
    existing.rowCount += 1;
    if (row.orderToken) {
      existing.orderTokens.add(row.orderToken);
      orderTokens.add(row.orderToken);
    }
    groups.set(key, existing);
  }

  const events = Array.from(groups.values()).map((group) => {
    const orderCount = group.orderTokens.size;
    const uncheckedQuantity = Math.max(0, group.quantity - group.checkedInQuantity);
    const checkedInRate = group.quantity > 0
      ? Math.round((group.checkedInQuantity / group.quantity) * 100)
      : 0;
    const { orderTokens: _orderTokens, ...summary } = group;
    return {
      ...summary,
      orderCount,
      uncheckedQuantity,
      checkedInRate
    };
  }).sort(compareAdminStoreAttendanceEvents);

  return {
    totals: {
      eventCount: events.length,
      orderCount: orderTokens.size,
      quantity: events.reduce((sum, event) => sum + Number(event.quantity || 0), 0),
      checkedInQuantity: events.reduce((sum, event) => sum + Number(event.checkedInQuantity || 0), 0),
      uncheckedQuantity: events.reduce((sum, event) => sum + Number(event.uncheckedQuantity || 0), 0)
    },
    events
  };
}

async function listAdminStoreOrderKeys(env) {
  if (!env?.STORE_STATE?.list) {
    return { ok: false, status: 503, error: 'Order storage unavailable' };
  }

  const keys = [];
  let cursor = undefined;
  let listCalls = 0;
  let truncated = false;
  do {
    const listing = await env.STORE_STATE.list({
      prefix: 'orders:',
      cursor,
      limit: 1000
    });
    listCalls += 1;
    keys.push(...(Array.isArray(listing?.keys) ? listing.keys : []));
    cursor = listing?.cursor;
    truncated = keys.length >= 5000 || listCalls >= 20;
    if (listing?.list_complete !== false || !cursor || truncated) break;
  } while (true);

  return { ok: true, keys: keys.slice(0, 5000), listCalls, truncated };
}

function normalizeAdminStoreOrderIndex(index = {}) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) return null;
  if (Number(index.version || 0) !== ADMIN_STORE_ORDER_INDEX_VERSION) return null;
  const generatedAtMs = parseTimestampMs(index.generatedAt || index.createdAt || '');
  if (!Number.isFinite(generatedAtMs)) return null;
  if (Date.now() - generatedAtMs > ADMIN_STORE_ORDER_INDEX_MAX_AGE_MS) return null;
  const orders = Array.isArray(index.orders)
    ? index.orders.filter((order) => STORE_ORDER_TOKEN_PATTERN.test(String(order?.orderToken || '')))
    : [];
  if (!orders.length && Number(index.indexed || 0) > 0) return null;
  return {
    orders: orders.sort(compareAdminStoreOrders),
    scanned: Math.max(0, Number(index.scanned || 0) || 0),
    indexed: Math.max(orders.length, Number(index.indexed || orders.length) || orders.length),
    listCalls: Math.max(0, Number(index.listCalls || 0) || 0),
    truncated: index.truncated === true,
    generatedAt: new Date(generatedAtMs).toISOString(),
    ageMs: Math.max(0, Date.now() - generatedAtMs)
  };
}

async function readAdminStoreOrderIndex(env) {
  const memoryIndex = normalizeAdminStoreOrderIndex(adminStoreOrderIndexCache);
  if (memoryIndex) {
    return {
      ok: true,
      ...memoryIndex,
      source: 'memory_index'
    };
  }

  if (!env?.STORE_STATE?.get) return { ok: false, skipped: 'store_state_unavailable' };
  const storedIndex = await env.STORE_STATE.get(ADMIN_STORE_ORDER_INDEX_KEY, { type: 'json' });
  const normalized = normalizeAdminStoreOrderIndex(storedIndex);
  if (!normalized) return { ok: false, skipped: 'missing_or_stale_index' };
  adminStoreOrderIndexCache = storedIndex;
  return {
    ok: true,
    ...normalized,
    source: 'kv_index'
  };
}

async function writeAdminStoreOrderIndex(env, data = {}) {
  if (!env?.STORE_STATE?.put || !Array.isArray(data.orders)) return;
  const generatedAt = data.generatedAt || new Date().toISOString();
  const index = {
    version: ADMIN_STORE_ORDER_INDEX_VERSION,
    generatedAt,
    scanned: Math.max(0, Number(data.scanned || 0) || 0),
    indexed: Math.max(0, Number(data.indexed || data.orders.length) || data.orders.length),
    listCalls: Math.max(0, Number(data.listCalls || 0) || 0),
    truncated: data.truncated === true,
    orders: data.orders
  };
  adminStoreOrderIndexCache = index;
  await env.STORE_STATE.put(ADMIN_STORE_ORDER_INDEX_KEY, JSON.stringify(index), {
    expirationTtl: ADMIN_STORE_ORDER_INDEX_TTL_SECONDS
  });
}

async function readAdminStoreOrderScan(env, options = {}) {
  const nowMs = Date.now();
  if (
    options.force !== true &&
    adminStoreOrderScanCache?.expiresAtMs > nowMs &&
    adminStoreOrderScanCache?.data
  ) {
    return {
      ok: true,
      ...adminStoreOrderScanCache.data,
      cache: {
        hit: true,
        ageMs: Math.max(0, nowMs - Number(adminStoreOrderScanCache.createdAtMs || nowMs)),
        ttlMs: ADMIN_STORE_ORDER_SCAN_CACHE_TTL_MS
      }
    };
  }

  if (options.force !== true) {
    const indexed = await readAdminStoreOrderIndex(env);
    if (indexed.ok) {
      return {
        ok: true,
        orders: indexed.orders,
        scanned: indexed.scanned,
        indexed: indexed.indexed,
        listCalls: indexed.listCalls,
        truncated: indexed.truncated,
        generatedAt: indexed.generatedAt,
        cache: {
          hit: true,
          source: indexed.source,
          ageMs: indexed.ageMs,
          ttlMs: ADMIN_STORE_ORDER_INDEX_MAX_AGE_MS
        }
      };
    }
  }

  const listed = await listAdminStoreOrderKeys(env);
  if (!listed.ok) return listed;

  const orders = [];
  let scanned = 0;
  for (const key of listed.keys) {
    const keyName = String(key?.name || '').trim();
    if (!keyName) continue;
    const storedOrder = await env.STORE_STATE.get(keyName, { type: 'json' });
    scanned += 1;
    if (!storedOrder || typeof storedOrder !== 'object') continue;
    const order = buildAdminStoreOrderRecord(storedOrder);
    if (order.orderToken) orders.push(order);
  }
  orders.sort(compareAdminStoreOrders);

  const data = {
    orders,
    scanned,
    indexed: listed.keys.length,
    listCalls: listed.listCalls || 1,
    truncated: listed.truncated === true,
    generatedAt: new Date().toISOString()
  };
  adminStoreOrderScanCache = {
    createdAtMs: nowMs,
    expiresAtMs: Date.now() + ADMIN_STORE_ORDER_SCAN_CACHE_TTL_MS,
    data
  };
  queueBackgroundTask(
    options.ctx,
    writeAdminStoreOrderIndex(env, data),
    'admin Store order index write'
  );

  return {
    ok: true,
    ...data,
    cache: {
      hit: false,
      ageMs: 0,
      ttlMs: ADMIN_STORE_ORDER_SCAN_CACHE_TTL_MS
    }
  };
}

async function buildStoreInventorySoldCounts(env) {
  const listed = await listAdminStoreOrderKeys(env);
  if (!listed.ok) {
    return { ok: false, status: listed.status || 503, error: listed.error };
  }

  const soldBySku = {};
  let scanned = 0;
  for (const key of listed.keys) {
    const keyName = String(key?.name || '').trim();
    if (!keyName) continue;
    const storedOrder = await env.STORE_STATE.get(keyName, { type: 'json' });
    scanned += 1;
    if (!storedOrder || typeof storedOrder !== 'object') continue;
    const orderDraft = storedOrder.orderDraft || {};
    const status = String(storedOrder.status || orderDraft.status || '').trim();
    if (status !== STORE_ORDER_STATUS_CONFIRMED) continue;

    for (const item of Array.isArray(orderDraft.items) ? orderDraft.items : []) {
      const sku = String(item?.sku || '').trim();
      const quantity = Math.max(0, Number(item?.quantity || 0) || 0);
      if (!sku || quantity <= 0) continue;
      soldBySku[sku] = (soldBySku[sku] || 0) + quantity;
    }
  }

  return {
    ok: true,
    soldBySku,
    scanned,
    listCalls: listed.listCalls || 1,
    indexed: listed.keys.length,
    truncated: listed.truncated === true
  };
}

function getStoreInventoryOverrideValue(overrides = {}, productId = '', variantId = '') {
  const productOverride = overrides.products?.[productId] || {};
  if (variantId) return productOverride.variants?.[variantId]?.inventory ?? null;
  return productOverride.inventory ?? null;
}

function buildAdminStoreInventoryRow({
  product = {},
  variant = null,
  effectiveProduct = {},
  effectiveVariant = null,
  overrides = {},
  soldBySku = {}
} = {}) {
  const productId = String(product.id || '').trim();
  const variantId = String(variant?.id || '').trim();
  const sku = String(variant?.sku || product.sku || product.id || '').trim();
  const configuredInventory = getConfiguredStoreInventory(variant?.inventory ?? product.inventory);
  const inventory = getConfiguredStoreInventory(effectiveVariant?.inventory ?? effectiveProduct.inventory);
  const overrideInventory = getStoreInventoryOverrideValue(overrides, productId, variantId);
  const sold = Math.max(0, Number(soldBySku[sku] || 0) || 0);
  const remaining = inventory === null ? null : Math.max(0, inventory - sold);
  return {
    productId,
    variantId,
    sku,
    label: variantId
      ? `${String(product.name || productId)} (${String(variant?.label || variantId)})`
      : String(product.name || productId),
    productName: String(product.name || productId),
    variantLabel: String(variant?.label || ''),
    fulfillmentType: String(product.fulfillment_type || product.type || ''),
    configuredInventory,
    inventory,
    overrideInventory,
    hasOverride: overrideInventory !== null,
    sold,
    remaining,
    soldOut: remaining === null ? false : remaining <= 0
  };
}

function buildAdminStoreProductRow({
  product = {},
  effectiveProduct = {},
  overrides = {}
} = {}) {
  const productId = String(product.id || '').trim();
  const sku = String(product.sku || product.id || '').trim();
  const fulfillmentType = String(product.fulfillment_type || product.type || 'physical').trim() || 'physical';
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const effectiveVariants = Array.isArray(effectiveProduct.variants) ? effectiveProduct.variants : [];
  const effectiveVariantsById = new Map(effectiveVariants.map((variant) => [String(variant?.id || ''), variant]));
  const variantCount = variants.length;
  const configuredInventoryValues = variantCount
    ? variants.map((variant) => getConfiguredStoreInventory(variant?.inventory))
    : [getConfiguredStoreInventory(product.inventory)];
  const inventoryValues = variantCount
    ? variants.map((variant) => {
      const effectiveVariant = effectiveVariantsById.get(String(variant?.id || '')) || variant;
      return getConfiguredStoreInventory(effectiveVariant?.inventory);
    })
    : [getConfiguredStoreInventory(effectiveProduct.inventory)];
  const configuredInventory = configuredInventoryValues.every((value) => value !== null)
    ? configuredInventoryValues.reduce((sum, value) => sum + value, 0)
    : null;
  const inventory = inventoryValues.every((value) => value !== null)
    ? inventoryValues.reduce((sum, value) => sum + value, 0)
    : null;
  const overrideInventory = getStoreInventoryOverrideValue(overrides, productId, '');
  const variantOverrideCount = variants.filter((variant) => (
    getStoreInventoryOverrideValue(overrides, productId, String(variant?.id || '').trim()) !== null
  )).length;
  const variantPrices = variants
    .map((variant) => Math.max(0, Number(variant?.price_cents ?? product.price_cents ?? 0) || 0))
    .filter((price) => Number.isFinite(price));
  const priceCents = variantPrices.length
    ? Math.min(...variantPrices)
    : Math.max(0, Number(product.price_cents ?? 0) || 0);
  const priceMaxCents = variantPrices.length ? Math.max(...variantPrices) : priceCents;
  const status = String(product.status || 'active').trim() || 'active';
  const image = String(product.image || '').trim();
  const url = String(product.url || '').trim();
  const slug = String(product.slug || '').trim();

  return {
    productId,
    variantId: '',
    sku,
    label: String(product.name || productId),
    productName: String(product.name || productId),
    description: String(product.description || '').trim(),
    bodyDescription: String(product.body_description || product.bodyDescription || '').trim(),
    longContent: Array.isArray(product.long_content)
      ? product.long_content
      : Array.isArray(product.longContent)
        ? product.longContent
        : [],
    variantLabel: '',
    slug,
    sourcePath: slug && isValidSlug(slug) ? `_products/${slug}.md` : '',
    status,
    public: product.public !== false,
    launchTest: product.launch_test === true,
    fulfillmentType,
    order: Number.isFinite(Number(product.order)) ? Number(product.order) : null,
    collection: String(product.collection || product.event || '').trim(),
    storefrontCategory: String(product.category || '').trim(),
    priceCents,
    priceMinCents: priceCents,
    priceMaxCents,
    currency: String(product.currency || 'USD').trim() || 'USD',
    inventoryTracking: product.inventory_tracking === true,
    configuredInventory,
    inventory,
    overrideInventory,
    hasOverride: overrideInventory !== null || variantOverrideCount > 0,
    variantOverrideCount,
    variantCount,
    shippingPreset: fulfillmentType === 'physical' ? String(product.shipping_preset || '').trim() : '',
    taxCategory: String(product.tax_category || '').trim(),
    variantOptionName: String(product.variant_option_name || '').trim(),
    image,
    url,
    hasImage: Boolean(image),
    hasUrl: Boolean(url),
    hasDownload: Boolean(product.download || variants.some((variant) => Boolean(variant?.download))),
    hasEventDetails: Boolean(product.event_details),
    turnstileRequired: product.turnstile_required === true
  };
}

function getAdminStoreProductMarkdownPath(product = {}) {
  const slug = String(product?.slug || '').trim();
  if (!slug || !isValidSlug(slug)) return '';
  return `_products/${slug}.md`;
}

function adminStoreProductPriceCents(value = {}) {
  if (value?.price_cents !== undefined) {
    return Math.max(0, Math.round(Number(value.price_cents) || 0));
  }
  if (value?.price !== undefined) {
    return Math.max(0, Math.round((Number(value.price) || 0) * 100));
  }
  return 0;
}

function adminStoreDownloadSummary(source = {}) {
  const download = source?.download && typeof source.download === 'object' ? source.download : {};
  const fileKey = String(download.file_key || download.fileKey || download.key || '').trim();
  return {
    fileKey,
    filename: fileKey ? getStoreDownloadFilename({ ...source, download }) : '',
    delivery: String(download.delivery || 'signed_link').trim() || 'signed_link',
    expiresHours: Number.isFinite(Number(download.expires_hours ?? download.expiresHours))
      ? Math.max(0, Number(download.expires_hours ?? download.expiresHours))
      : 72
  };
}

function adminStoreEventDetailsSummary(source = {}) {
  const event = source?.event_details && typeof source.event_details === 'object'
    ? source.event_details
    : source?.eventDetails && typeof source.eventDetails === 'object'
      ? source.eventDetails
      : {};
  return {
    startsAt: String(event.starts_at || event.startsAt || '').trim(),
    endsAt: String(event.ends_at || event.endsAt || '').trim(),
    venue: String(event.venue || '').trim(),
    address: compactAdminStoreEventAddress(event.address || ''),
    ticketDelivery: String(event.ticket_delivery || event.ticketDelivery || '').trim(),
    ics: event.ics !== false
  };
}

function buildAdminStoreEditableVariant(variant = {}, overrides = {}, productId = '') {
  const variantId = String(variant?.id || '').trim();
  const download = adminStoreDownloadSummary(variant);
  return {
    id: variantId,
    label: String(variant?.label || variantId).trim(),
    sku: String(variant?.sku || '').trim(),
    priceCents: adminStoreProductPriceCents(variant),
    inventory: getConfiguredStoreInventory(variant?.inventory),
    overrideInventory: getStoreInventoryOverrideValue(overrides, productId, variantId),
    status: String(variant?.status || '').trim(),
    downloadFileKey: download.fileKey,
    downloadFilename: download.filename
  };
}

function buildAdminStoreEditableProduct(product = {}, overrides = {}) {
  const productId = String(product?.id || '').trim();
  const slug = String(product?.slug || '').trim();
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const download = adminStoreDownloadSummary(product);
  const eventDetails = adminStoreEventDetailsSummary(product);
  return {
    productId,
    slug,
    sourcePath: getAdminStoreProductMarkdownPath(product),
    sku: String(product?.sku || '').trim(),
    name: String(product?.name || productId).trim(),
    description: String(product?.description || '').trim(),
    bodyDescription: String(product?.body_description || product?.bodyDescription || '').trim(),
    longContent: Array.isArray(product?.long_content)
      ? product.long_content
      : Array.isArray(product?.longContent)
        ? product.longContent
        : [],
    priceCents: adminStoreProductPriceCents(product),
    currency: String(product?.currency || 'USD').trim() || 'USD',
    image: String(product?.image || '').trim(),
    url: String(product?.url || '').trim(),
    type: String(product?.type || '').trim(),
    fulfillmentType: String(product?.fulfillment_type || product?.type || 'physical').trim() || 'physical',
    status: String(product?.status || 'active').trim() || 'active',
    public: product?.public !== false,
    launchTest: product?.launch_test === true,
    order: Number.isFinite(Number(product?.order)) ? Number(product.order) : null,
    collection: String(product?.collection || product?.event || '').trim(),
    storefrontCategory: String(product?.category || '').trim(),
    shippingPreset: String(product?.shipping_preset || '').trim(),
    taxCategory: String(product?.tax_category || '').trim(),
    inventoryTracking: product?.inventory_tracking === true,
    inventory: getConfiguredStoreInventory(product?.inventory),
    overrideInventory: getStoreInventoryOverrideValue(overrides, productId, ''),
    variantOptionName: String(product?.variant_option_name || '').trim(),
    variants: variants.map((variant) => buildAdminStoreEditableVariant(variant, overrides, productId)),
    hasDownload: Boolean(product?.download),
    downloadFileKey: download.fileKey,
    downloadFilename: download.filename,
    eventDetails,
    eventStartsAt: eventDetails.startsAt,
    eventEndsAt: eventDetails.endsAt,
    eventVenue: eventDetails.venue,
    eventAddress: eventDetails.address,
    eventIcs: eventDetails.ics,
    hasEventDetails: Boolean(product?.event_details),
    turnstileRequired: product?.turnstile_required === true
  };
}

function adminStoreProductSortOrder(product = {}) {
  const order = Number(product?.order);
  return Number.isFinite(order) ? order : 1_000_000;
}

function compareAdminStoreProducts(a = {}, b = {}) {
  const orderDelta = adminStoreProductSortOrder(a) - adminStoreProductSortOrder(b);
  if (orderDelta !== 0) return orderDelta;
  return String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || ''));
}

function hasAdminStoreProductPatchField(fields, key) {
  return Object.prototype.hasOwnProperty.call(fields || {}, key);
}

function normalizeAdminStoreStringField(value, label, { required = false, max = 240 } = {}) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (required && !text) return { ok: false, error: `${label} is required.` };
  if (text.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer.` };
  return { ok: true, value: text };
}

function normalizeAdminStoreTokenField(value, label, { required = false, max = 80 } = {}) {
  const normalized = normalizeAdminStoreStringField(value, label, { required, max });
  if (!normalized.ok || !normalized.value) return normalized;
  const text = normalized.value.toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(text)) {
    return { ok: false, error: `${label} must use lowercase letters, numbers, hyphens, or underscores.` };
  }
  return { ok: true, value: text };
}

function normalizeAdminStoreStatusField(value, label, { required = true } = {}) {
  const normalized = normalizeAdminStoreTokenField(value, label, { required, max: 40 });
  if (!normalized.ok) return normalized;
  if (!normalized.value && !required) return normalized;
  if (!ADMIN_STORE_PRODUCT_STATUSES.has(normalized.value)) {
    return {
      ok: false,
      error: `${label} must be one of ${Array.from(ADMIN_STORE_PRODUCT_STATUSES).join(', ')}.`
    };
  }
  return normalized;
}

function normalizeAdminStoreTaxCategoryField(value, label, { required = false } = {}) {
  const normalized = normalizeAdminStoreTokenField(value, label, { required, max: 40 });
  if (!normalized.ok) return normalized;
  if (!normalized.value && !required) return normalized;
  if (!ADMIN_STORE_TAX_CATEGORIES.has(normalized.value)) {
    return {
      ok: false,
      error: `${label} must be one of ${Array.from(ADMIN_STORE_TAX_CATEGORIES).join(', ')}.`
    };
  }
  return normalized;
}

function normalizeAdminStoreBooleanField(value, label) {
  if (value === true || value === false) return { ok: true, value };
  const text = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return { ok: true, value: true };
  if (['false', '0', 'no', 'off'].includes(text)) return { ok: true, value: false };
  return { ok: false, error: `${label} must be true or false.` };
}

function normalizeAdminStoreIntegerField(value, label) {
  const number = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(number) || number < 0 || String(value ?? '').trim() === '') {
    return { ok: false, error: `${label} must be 0 or greater.` };
  }
  return { ok: true, value: number };
}

function normalizeAdminStorePriceField(value, label) {
  const text = String(value ?? '').replace(/[$,]/g, '').trim();
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || text === '') {
    return { ok: false, error: `${label} must be 0 or greater.` };
  }
  return { ok: true, value: Math.round(number * 100) };
}

function normalizeAdminStorePriceCentsField(value, label) {
  const number = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(number) || number < 0 || String(value ?? '').trim() === '') {
    return { ok: false, error: `${label} must be 0 or greater.` };
  }
  return { ok: true, value: number };
}

function formatAdminStorePriceYaml(cents) {
  const amount = Math.max(0, Math.round(Number(cents) || 0)) / 100;
  if (Number.isInteger(amount)) return String(amount);
  return amount.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function adminStoreProductScalarLine(key, value, type = 'string') {
  if (key === 'price') return `${key}: ${formatAdminStorePriceYaml(value)}`;
  return `${key}: ${yamlAdminValue(value, type)}`;
}

function defaultAdminStoreProductType(fulfillmentType = 'physical') {
  const type = String(fulfillmentType || '').trim().toLowerCase();
  if (type === 'digital' || type === 'ticket' || type === 'rsvp') return type;
  return 'product';
}

function isAdminStoreEventFulfillmentType(fulfillmentType = '') {
  const type = String(fulfillmentType || '').trim().toLowerCase();
  return type === 'ticket' || type === 'rsvp';
}

function yamlBlockAdminString(value, indent = '  ') {
  const text = String(value ?? '');
  if (!text) return '""';
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  return `|\n${lines.map((line) => `${indent}${line}`).join('\n')}`;
}

function yamlAdminOptionalScalar(lines, key, value, indent) {
  const text = String(value ?? '');
  if (text) lines.push(`${indent}${key}: ${yamlQuoteAdminString(text)}`);
}

function yamlAdminOptionalStoreContentAlignment(lines, block, indent) {
  const align = normalizeAdminStoreContentAlignment(block?.align);
  if (align !== 'left') lines.push(`${indent}align: ${yamlQuoteAdminString(align)}`);
}

function serializeAdminStoreContentBlockToYaml(block = {}) {
  const lines = [`  - type: ${yamlQuoteAdminString(block.type || '')}`];
  yamlAdminOptionalStoreContentAlignment(lines, block, '    ');
  if (block.type === 'text') {
    lines.push(`    body: ${yamlBlockAdminString(block.body, '      ')}`);
  } else if (block.type === 'video') {
    lines.push(`    provider: ${yamlQuoteAdminString(block.provider || '')}`);
    if (normalizeAdminStoreContentVideoProvider(block.provider) === 'local') {
      lines.push(`    src: ${yamlQuoteAdminString(block.src || '')}`);
      yamlAdminOptionalScalar(lines, 'poster', block.poster, '    ');
    } else {
      lines.push(`    video_id: ${yamlQuoteAdminString(block.video_id || '')}`);
    }
    yamlAdminOptionalScalar(lines, 'caption', block.caption, '    ');
  } else if (block.type === 'image') {
    lines.push(`    src: ${yamlQuoteAdminString(block.src || '')}`);
    lines.push(`    alt: ${yamlQuoteAdminString(block.alt || '')}`);
    yamlAdminOptionalScalar(lines, 'caption', block.caption, '    ');
  } else if (block.type === 'gallery') {
    const layout = normalizeAdminStoreContentGalleryLayout(block.layout);
    const captionStyle = normalizeAdminStoreContentGalleryCaptionStyle(block.caption_style);
    yamlAdminOptionalScalar(lines, 'layout', layout, '    ');
    if (captionStyle !== 'inline') yamlAdminOptionalScalar(lines, 'caption_style', captionStyle, '    ');
    lines.push('    images:');
    for (const image of block.images || []) {
      lines.push(`      - src: ${yamlQuoteAdminString(image.src || '')}`);
      lines.push(`        alt: ${yamlQuoteAdminString(image.alt || '')}`);
      yamlAdminOptionalScalar(lines, 'caption', image.caption, '        ');
    }
    yamlAdminOptionalScalar(lines, 'caption', block.caption, '    ');
  } else if (block.type === 'audio') {
    lines.push(`    src: ${yamlQuoteAdminString(block.src || '')}`);
    yamlAdminOptionalScalar(lines, 'title', block.title, '    ');
    yamlAdminOptionalScalar(lines, 'caption', block.caption, '    ');
  } else if (block.type === 'embed') {
    lines.push(`    provider: ${yamlQuoteAdminString(block.provider || '')}`);
    lines.push(`    src: ${yamlQuoteAdminString(block.src || '')}`);
    yamlAdminOptionalScalar(lines, 'title', block.title, '    ');
    yamlAdminOptionalScalar(lines, 'caption', block.caption, '    ');
  } else if (block.type === 'quote') {
    lines.push(`    text: ${yamlBlockAdminString(block.text, '      ')}`);
    yamlAdminOptionalScalar(lines, 'author', block.author, '    ');
  }
  return lines.join('\n');
}

function serializeAdminStoreLongContentYaml(blocks = []) {
  if (!blocks.length) return 'long_content: []';
  return `long_content:\n${blocks.map(serializeAdminStoreContentBlockToYaml).join('\n')}`;
}

function serializeAdminStoreProductVariantsYaml(variants = []) {
  if (!Array.isArray(variants) || variants.length === 0) return 'variants: []';
  const lines = ['variants:'];
  for (const variant of variants) {
    lines.push(`- id: ${yamlAdminValue(variant.id || '', 'string')}`);
    yamlAdminMaybeLine(lines, 'label', variant.label || '', '  ');
    yamlAdminMaybeLine(lines, 'sku', variant.sku || '', '  ');
    lines.push(`  price: ${formatAdminStorePriceYaml(variant.priceCents)}`);
    yamlAdminMaybeLine(lines, 'inventory', variant.inventory, '  ');
    yamlAdminMaybeLine(lines, 'status', variant.status || '', '  ');
    if (variant.downloadFileKey) {
      lines.push('  download:');
      lines.push(`    file_key: ${yamlAdminValue(variant.downloadFileKey, 'string')}`);
      lines.push(`    filename: ${yamlAdminValue(variant.downloadFilename || variant.downloadFileKey, 'string')}`);
      lines.push('    delivery: "signed_link"');
    }
  }
  return lines.join('\n');
}

function serializeAdminStoreDownloadYaml(fileKey = '', filename = '') {
  const normalizedFileKey = String(fileKey || '').trim();
  if (!normalizedFileKey) return 'download: {}';
  return [
    'download:',
    `  file_key: ${yamlAdminValue(normalizedFileKey, 'string')}`,
    `  filename: ${yamlAdminValue(filename || normalizedFileKey, 'string')}`,
    '  delivery: "signed_link"'
  ].join('\n');
}

function serializeAdminStoreEventDetailsYaml(eventDetails = {}) {
  const event = adminStoreEventDetailsSummary({ eventDetails });
  const lines = ['event_details:'];
  yamlAdminMaybeLine(lines, 'starts_at', event.startsAt, '  ');
  yamlAdminMaybeLine(lines, 'ends_at', event.endsAt, '  ');
  yamlAdminMaybeLine(lines, 'venue', event.venue, '  ');
  yamlAdminMaybeLine(lines, 'address', event.address, '  ');
  yamlAdminMaybeLine(lines, 'ticket_delivery', event.ticketDelivery, '  ');
  yamlAdminMaybeLine(lines, 'ics', event.ics, '  ');
  return lines.length > 1 ? lines.join('\n') : 'event_details: {}';
}

function normalizeAdminStoreDownloadSelection(fileKey, filename, label, { required = false } = {}) {
  const rawFileKey = String(fileKey || '').trim();
  if (!rawFileKey) {
    return required
      ? { ok: false, error: `${label} file is required.` }
      : { ok: true, value: '', filename: '' };
  }
  const normalizedFileKey = normalizeAdminStoreDownloadFileKey(rawFileKey, `${label} file`);
  if (!normalizedFileKey.ok) return { ok: false, error: normalizedFileKey.error };
  const normalizedFilename = sanitizeDownloadFilename(filename || rawFileKey);
  return {
    ok: true,
    value: normalizedFileKey.value,
    filename: normalizedFilename
  };
}

function normalizeAdminStoreSubmittedVariant(baseVariant = {}, submitted = {}, errors = [], index = 0) {
  const baseDownload = adminStoreDownloadSummary(baseVariant);
  const variant = {
    id: String(baseVariant?.id || '').trim(),
    label: String(baseVariant?.label || baseVariant?.id || '').trim(),
    sku: String(baseVariant?.sku || '').trim(),
    priceCents: adminStoreProductPriceCents(baseVariant),
    inventory: getConfiguredStoreInventory(baseVariant?.inventory),
    status: String(baseVariant?.status || '').trim(),
    downloadFileKey: baseDownload.fileKey,
    downloadFilename: baseDownload.filename
  };
  const labelPrefix = `Variant ${index + 1}`;

  if (hasAdminStoreProductPatchField(submitted, 'label')) {
    const normalized = normalizeAdminStoreStringField(submitted.label, `${labelPrefix} label`, { required: true, max: 120 });
    if (normalized.ok) variant.label = normalized.value;
    else errors.push(normalized.error);
  }
  if (hasAdminStoreProductPatchField(submitted, 'sku')) {
    const normalized = normalizeAdminStoreStringField(submitted.sku, `${labelPrefix} SKU`, { required: false, max: 120 });
    if (normalized.ok) variant.sku = normalized.value;
    else errors.push(normalized.error);
  }
  if (hasAdminStoreProductPatchField(submitted, 'priceCents')) {
    const normalized = normalizeAdminStorePriceCentsField(submitted.priceCents, `${labelPrefix} price`);
    if (normalized.ok) variant.priceCents = normalized.value;
    else errors.push(normalized.error);
  } else if (hasAdminStoreProductPatchField(submitted, 'price')) {
    const normalized = normalizeAdminStorePriceField(submitted.price, `${labelPrefix} price`);
    if (normalized.ok) variant.priceCents = normalized.value;
    else errors.push(normalized.error);
  }
  if (hasAdminStoreProductPatchField(submitted, 'inventory')) {
    const normalized = normalizeAdminStoreIntegerField(submitted.inventory, `${labelPrefix} inventory`);
    if (normalized.ok) variant.inventory = normalized.value;
    else errors.push(normalized.error);
  }
  if (hasAdminStoreProductPatchField(submitted, 'status')) {
    const normalized = normalizeAdminStoreStatusField(submitted.status, `${labelPrefix} status`, { required: false });
    if (normalized.ok) variant.status = normalized.value;
    else errors.push(normalized.error);
  }
  if (hasAdminStoreProductPatchField(submitted, 'downloadFileKey') || hasAdminStoreProductPatchField(submitted, 'download_file_key')) {
    const normalized = normalizeAdminStoreDownloadSelection(
      hasAdminStoreProductPatchField(submitted, 'downloadFileKey') ? submitted.downloadFileKey : submitted.download_file_key,
      submitted.downloadFilename || submitted.download_filename,
      labelPrefix,
      { required: false }
    );
    if (normalized.ok) {
      variant.downloadFileKey = normalized.value;
      variant.downloadFilename = normalized.filename;
    } else {
      errors.push(normalized.error);
    }
  }

  return variant;
}

function normalizeAdminStoreProductPublishBody(body = {}, env = {}, options = {}) {
  const errors = [];
  const intent = options.intent || 'publish';
  if (body?.intent !== intent) errors.push(`Missing ${intent} intent.`);
  const createProduct = body?.createProduct === true || body?.create_product === true;
  const productId = String(body?.productId || body?.product_id || '').trim();
  if (!productId) errors.push('Product ID is required.');
  const normalizedProductId = normalizeAdminStoreTokenField(productId, 'Product SKU', { required: true, max: 100 });
  if (productId && (!normalizedProductId.ok || !isValidSlug(normalizedProductId.value))) {
    errors.push('Product SKU must be a URL-safe lowercase slug.');
  }

  const catalog = normalizeStoreCatalogSnapshot(getStoreCatalogSnapshot(env));
  let product = productId ? catalog.productById.get(productId) : null;
  if (productId && !product && !createProduct) {
    return { ok: false, status: 404, errors: ['Store product not found.'] };
  }
  if (createProduct && productId && (catalog.productById.has(productId) || catalog.productBySku.has(productId))) {
    return { ok: false, status: 409, errors: ['Store product SKU already exists.'] };
  }
  if (createProduct && normalizedProductId.ok && isValidSlug(normalizedProductId.value)) {
    product = {
      id: normalizedProductId.value,
      slug: normalizedProductId.value,
      sku: normalizedProductId.value,
      name: '',
      description: '',
      long_content: [],
      price_cents: 0,
      currency: 'USD',
      image: '',
      fulfillment_type: 'physical',
      type: 'product',
      status: 'draft',
      shipping_preset: '',
      tax_category: 'standard',
      inventory_tracking: false,
      inventory: 0,
      variants: []
    };
  }

  const sourcePath = createProduct && normalizedProductId.ok
    ? `_products/${normalizedProductId.value}.md`
    : getAdminStoreProductMarkdownPath(product || {});
  if (product && !sourcePath) errors.push('Store product source path is invalid.');

  const fields = body?.fields && typeof body.fields === 'object' ? body.fields : {};
  if (createProduct && !hasAdminStoreProductPatchField(fields, 'name')) {
    errors.push('Product name is required.');
  }
  const frontMatter = [];
  const changedFields = [];
  let descriptionChanged = false;
  let description = '';

  function addScalarField(fieldKey, yamlKey, label, options = {}) {
    if (!hasAdminStoreProductPatchField(fields, fieldKey)) return;
    const normalized = options.token
      ? normalizeAdminStoreTokenField(fields[fieldKey], label, { required: options.required === true, max: options.max || 80 })
      : normalizeAdminStoreStringField(fields[fieldKey], label, { required: options.required === true, max: options.max || 240 });
    if (!normalized.ok) {
      errors.push(normalized.error);
      return;
    }
    frontMatter.push({
      key: yamlKey,
      replacement: adminStoreProductScalarLine(yamlKey, normalized.value, 'string')
    });
    changedFields.push(fieldKey);
  }

  function addTaxCategoryField(fieldKey) {
    if (!hasAdminStoreProductPatchField(fields, fieldKey)) return;
    const normalized = normalizeAdminStoreTaxCategoryField(fields[fieldKey], 'Tax category', { required: false });
    if (!normalized.ok) {
      errors.push(normalized.error);
      return;
    }
    frontMatter.push({
      key: 'tax_category',
      replacement: adminStoreProductScalarLine('tax_category', normalized.value, 'string')
    });
    changedFields.push(fieldKey);
  }

  addScalarField('name', 'name', 'Product name', { required: true, max: 160 });
  addScalarField('image', 'image', 'Product image', { required: false, max: 320 });
  addScalarField('fulfillmentType', 'fulfillment_type', 'Fulfillment type', { required: true, token: true, max: 40 });
  addScalarField('fulfillment_type', 'fulfillment_type', 'Fulfillment type', { required: true, token: true, max: 40 });
  if (hasAdminStoreProductPatchField(fields, 'status')) {
    const normalized = normalizeAdminStoreStatusField(fields.status, 'Product status');
    if (normalized.ok) {
      frontMatter.push({
        key: 'status',
        replacement: adminStoreProductScalarLine('status', normalized.value, 'string')
      });
      changedFields.push('status');
    } else {
      errors.push(normalized.error);
    }
  }
  addScalarField('event', 'event', 'Event', { required: false, token: true, max: 80 });
  addScalarField('shippingPreset', 'shipping_preset', 'Shipping preset', { required: false, token: true, max: 80 });
  addScalarField('shipping_preset', 'shipping_preset', 'Shipping preset', { required: false, token: true, max: 80 });
  addTaxCategoryField('taxCategory');
  addTaxCategoryField('tax_category');
  addScalarField('variantOptionName', 'variant_option_name', 'Variant option name', { required: false, max: 80 });
  addScalarField('variant_option_name', 'variant_option_name', 'Variant option name', { required: false, max: 80 });
  if (createProduct) {
    const fulfillmentType = hasAdminStoreProductPatchField(fields, 'fulfillmentType')
      ? fields.fulfillmentType
      : hasAdminStoreProductPatchField(fields, 'fulfillment_type')
        ? fields.fulfillment_type
        : 'physical';
    const normalizedType = normalizeAdminStoreTokenField(defaultAdminStoreProductType(fulfillmentType), 'Product type', { required: true, max: 40 });
    if (normalizedType.ok) {
      frontMatter.push({
        key: 'type',
        replacement: adminStoreProductScalarLine('type', normalizedType.value, 'string')
      });
      changedFields.push('type');
    }
  }

  const seoDescriptionField = hasAdminStoreProductPatchField(fields, 'seoDescription')
    ? 'seoDescription'
    : hasAdminStoreProductPatchField(fields, 'seo_description')
      ? 'seo_description'
      : '';
  if (seoDescriptionField) {
    const normalized = normalizeAdminStoreStringField(fields[seoDescriptionField], 'SEO description', { required: false, max: 320 });
    if (normalized.ok) {
      frontMatter.push({
        key: 'description',
        replacement: adminStoreProductScalarLine('description', normalized.value, 'string')
      });
      changedFields.push('seoDescription');
    } else {
      errors.push(normalized.error);
    }
  }

  const bodyDescriptionField = hasAdminStoreProductPatchField(fields, 'bodyDescription')
    ? 'bodyDescription'
    : hasAdminStoreProductPatchField(fields, 'body_description')
      ? 'body_description'
      : hasAdminStoreProductPatchField(fields, 'description')
        ? 'description'
        : '';
  if (bodyDescriptionField) {
    const normalized = normalizeAdminStoreStringField(fields[bodyDescriptionField], 'Product page content', { required: false, max: 8000 });
    if (normalized.ok) {
      descriptionChanged = true;
      description = normalized.value;
      changedFields.push('bodyDescription');
    } else {
      errors.push(normalized.error);
    }
  }

  if (hasAdminStoreProductPatchField(fields, 'longContent') || hasAdminStoreProductPatchField(fields, 'long_content')) {
    const normalized = normalizeAdminStoreLongContent(
      hasAdminStoreProductPatchField(fields, 'longContent') ? fields.longContent : fields.long_content
    );
    if (normalized.ok) {
      frontMatter.push({
        key: 'long_content',
        replacement: serializeAdminStoreLongContentYaml(normalized.value)
      });
      changedFields.push('longContent');
    } else {
      errors.push(...normalized.errors);
    }
  }

  if (hasAdminStoreProductPatchField(fields, 'priceCents')) {
    const normalized = normalizeAdminStorePriceCentsField(fields.priceCents, 'Product price');
    if (normalized.ok) {
      frontMatter.push({ key: 'price', replacement: adminStoreProductScalarLine('price', normalized.value, 'number') });
      changedFields.push('price');
    } else {
      errors.push(normalized.error);
    }
  } else if (hasAdminStoreProductPatchField(fields, 'price')) {
    const normalized = normalizeAdminStorePriceField(fields.price, 'Product price');
    if (normalized.ok) {
      frontMatter.push({ key: 'price', replacement: adminStoreProductScalarLine('price', normalized.value, 'number') });
      changedFields.push('price');
    } else {
      errors.push(normalized.error);
    }
  }

  if (hasAdminStoreProductPatchField(fields, 'inventoryTracking')) {
    const normalized = normalizeAdminStoreBooleanField(fields.inventoryTracking, 'Inventory tracking');
    if (normalized.ok) {
      frontMatter.push({ key: 'inventory_tracking', replacement: adminStoreProductScalarLine('inventory_tracking', normalized.value, 'boolean') });
      changedFields.push('inventoryTracking');
    } else {
      errors.push(normalized.error);
    }
  } else if (hasAdminStoreProductPatchField(fields, 'inventory_tracking')) {
    const normalized = normalizeAdminStoreBooleanField(fields.inventory_tracking, 'Inventory tracking');
    if (normalized.ok) {
      frontMatter.push({ key: 'inventory_tracking', replacement: adminStoreProductScalarLine('inventory_tracking', normalized.value, 'boolean') });
      changedFields.push('inventory_tracking');
    } else {
      errors.push(normalized.error);
    }
  }

  if (hasAdminStoreProductPatchField(fields, 'inventory')) {
    const normalized = normalizeAdminStoreIntegerField(fields.inventory, 'Product inventory');
    if (normalized.ok) {
      frontMatter.push({ key: 'inventory', replacement: adminStoreProductScalarLine('inventory', normalized.value, 'number') });
      changedFields.push('inventory');
    } else {
      errors.push(normalized.error);
    }
  }

  const submittedVariants = Array.isArray(body?.variants)
    ? body.variants
    : Array.isArray(fields?.variants)
      ? fields.variants
      : null;
  const nextFulfillmentType = String(
    hasAdminStoreProductPatchField(fields, 'fulfillmentType')
      ? fields.fulfillmentType
      : hasAdminStoreProductPatchField(fields, 'fulfillment_type')
        ? fields.fulfillment_type
        : product?.fulfillment_type || product?.type || 'physical'
  ).trim().toLowerCase();
  const digitalProduct = nextFulfillmentType === 'digital';
  const eventProduct = isAdminStoreEventFulfillmentType(nextFulfillmentType);
  const eventFieldKeys = ['eventStartsAt', 'eventEndsAt', 'eventVenue', 'eventAddress', 'eventIcs'];
  const eventFieldsSubmitted = eventFieldKeys.some((fieldKey) => hasAdminStoreProductPatchField(fields, fieldKey));
  if (!eventProduct) {
    if (product?.event_details || eventFieldsSubmitted) {
      frontMatter.push({ key: 'event_details', remove: true });
      changedFields.push('eventDetails');
    }
  } else if (eventFieldsSubmitted || product?.event_details) {
    const eventDetails = adminStoreEventDetailsSummary(product);
    const updateEventString = (fieldKey, prop, label, max = 240) => {
      if (!hasAdminStoreProductPatchField(fields, fieldKey)) return;
      const normalized = normalizeAdminStoreStringField(fields[fieldKey], label, { required: false, max });
      if (normalized.ok) eventDetails[prop] = normalized.value;
      else errors.push(normalized.error);
    };
    updateEventString('eventStartsAt', 'startsAt', 'Event start', 80);
    updateEventString('eventEndsAt', 'endsAt', 'Event end', 80);
    updateEventString('eventVenue', 'venue', 'Event venue', 160);
    updateEventString('eventAddress', 'address', 'Event address', 320);
    if (hasAdminStoreProductPatchField(fields, 'eventIcs')) {
      const normalized = normalizeAdminStoreBooleanField(fields.eventIcs, 'Calendar file');
      if (normalized.ok) eventDetails.ics = normalized.value;
      else errors.push(normalized.error);
    }
    if (eventDetails.ticketDelivery === '') eventDetails.ticketDelivery = 'qr';
    frontMatter.push({
      key: 'event_details',
      replacement: serializeAdminStoreEventDetailsYaml(eventDetails)
    });
    changedFields.push('eventDetails');
  }
  const variantBased = hasAdminStoreProductPatchField(fields, 'variantBased')
    ? fields.variantBased === true || String(fields.variantBased || '').trim().toLowerCase() === 'true'
    : submittedVariants
      ? submittedVariants.length > 0
      : (Array.isArray(product?.variants) && product.variants.length > 0);
  const productDownloadSubmitted = hasAdminStoreProductPatchField(fields, 'downloadFileKey')
    || hasAdminStoreProductPatchField(fields, 'download_file_key');

  if (!digitalProduct) {
    if (product?.download) {
      frontMatter.push({ key: 'download', remove: true });
      changedFields.push('download');
    }
  } else if (variantBased) {
    if (product?.download || productDownloadSubmitted) {
      frontMatter.push({ key: 'download', remove: true });
      changedFields.push('download');
    }
  } else if (productDownloadSubmitted) {
    const normalized = normalizeAdminStoreDownloadSelection(
      hasAdminStoreProductPatchField(fields, 'downloadFileKey') ? fields.downloadFileKey : fields.download_file_key,
      fields.downloadFilename || fields.download_filename,
      'Product',
      { required: intent !== 'preview' }
    );
    if (normalized.ok) {
      frontMatter.push({
        key: 'download',
        replacement: serializeAdminStoreDownloadYaml(normalized.value, normalized.filename)
      });
      changedFields.push('download');
    } else {
      errors.push(normalized.error);
    }
  } else if (digitalProduct && !variantBased && intent !== 'preview' && !adminStoreDownloadSummary(product).fileKey) {
    errors.push('Product file is required for digital products.');
  }

  if (submittedVariants) {
    const baseVariants = Array.isArray(product?.variants) ? product.variants : [];
    const baseById = new Map(baseVariants.map((variant) => [String(variant?.id || '').trim(), variant]));
    const seenIds = new Set();
    const normalizedVariants = [];
    if (variantBased) {
      submittedVariants.forEach((submitted, index) => {
        const idResult = normalizeAdminStoreTokenField(submitted?.id, `Variant ${index + 1} ID`, { required: true, max: 80 });
        if (!idResult.ok) {
          errors.push(idResult.error);
          return;
        }
        if (seenIds.has(idResult.value)) {
          errors.push(`Variant ${idResult.value} is duplicated.`);
          return;
        }
        seenIds.add(idResult.value);
        const baseVariant = baseById.get(idResult.value) || { id: idResult.value };
        const normalizedVariant = normalizeAdminStoreSubmittedVariant(baseVariant, { ...(submitted || {}), id: idResult.value }, errors, index);
        if (!digitalProduct) {
          normalizedVariant.downloadFileKey = '';
          normalizedVariant.downloadFilename = '';
        } else if (submittedVariants.length > 0 && intent !== 'preview' && !normalizedVariant.downloadFileKey) {
          errors.push(`Variant ${index + 1} file is required for digital products.`);
        }
        normalizedVariants.push(normalizedVariant);
      });
      if (digitalProduct && !submittedVariants.length && intent !== 'preview') {
        errors.push('Add at least one variant file for digital variant-based products.');
      }
      frontMatter.push({
        key: 'variants',
        replacement: serializeAdminStoreProductVariantsYaml(normalizedVariants)
      });
    } else {
      frontMatter.push({ key: 'variants', remove: true });
    }
    changedFields.push('variants');
  }

  if (!changedFields.length && !errors.length && options.requireChanges !== false) {
    errors.push('No product fields were submitted.');
  }

  if (errors.length) {
    return { ok: false, status: 422, errors };
  }

  if (createProduct && normalizedProductId.ok) {
    frontMatter.unshift({
      key: 'sku',
      replacement: adminStoreProductScalarLine('sku', normalizedProductId.value, 'string')
    });
    frontMatter.unshift({
      key: 'identifier',
      replacement: adminStoreProductScalarLine('identifier', normalizedProductId.value, 'string')
    });
    changedFields.push('identifier', 'sku');
  }

  return {
    ok: true,
    product,
    sourcePath,
    createProduct,
    patch: {
      frontMatter,
      descriptionChanged,
      description,
      changedFields: Array.from(new Set(changedFields))
    }
  };
}

function normalizeAdminStoreProductBulkPublishBody(body = {}, env = {}) {
  const errors = [];
  if (body?.intent !== 'bulk_publish') errors.push('Missing bulk publish intent.');

  const rawProductIds = Array.isArray(body?.productIds)
    ? body.productIds
    : Array.isArray(body?.product_ids)
      ? body.product_ids
      : [];
  const seen = new Set();
  const productIds = [];
  for (const rawId of rawProductIds) {
    const productId = String(rawId || '').trim();
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    productIds.push(productId);
  }

  if (!productIds.length) errors.push('Select at least one Store product.');
  if (productIds.length > 50) errors.push('Bulk product edits can include at most 50 products.');

  const fields = body?.fields && typeof body.fields === 'object' ? body.fields : {};
  const frontMatter = [];
  const changedFields = [];
  const submittedStatus = hasAdminStoreProductPatchField(fields, 'status') ? fields.status : body?.status;
  if (submittedStatus !== undefined) {
    const normalized = normalizeAdminStoreStatusField(submittedStatus, 'Product status');
    if (normalized.ok) {
      frontMatter.push({
        key: 'status',
        replacement: adminStoreProductScalarLine('status', normalized.value, 'string')
      });
      changedFields.push('status');
    } else {
      errors.push(normalized.error);
    }
  }

  if (!changedFields.length && !errors.length) {
    errors.push('No supported bulk product fields were submitted.');
  }

  const catalog = normalizeStoreCatalogSnapshot(getStoreCatalogSnapshot(env));
  const targets = [];
  for (const productId of productIds) {
    const product = catalog.productById.get(productId);
    if (!product) {
      errors.push(`Store product ${productId} was not found.`);
      continue;
    }
    const sourcePath = getAdminStoreProductMarkdownPath(product);
    if (!sourcePath) {
      errors.push(`Store product ${productId} source path is invalid.`);
      continue;
    }
    targets.push({ product, productId, sourcePath });
  }

  if (errors.length) {
    return { ok: false, status: errors.some((error) => /was not found/.test(error)) ? 404 : 422, errors };
  }

  return {
    ok: true,
    targets,
    patch: {
      frontMatter,
      descriptionChanged: false,
      description: '',
      changedFields: Array.from(new Set(changedFields))
    }
  };
}

function normalizeAdminStoreProductOrderBody(body = {}, env = {}) {
  const errors = [];
  if (body?.intent !== 'order_publish') errors.push('Missing order publish intent.');

  const rawProductIds = Array.isArray(body?.productIds)
    ? body.productIds
    : Array.isArray(body?.product_ids)
      ? body.product_ids
      : [];
  const seen = new Set();
  const productIds = [];
  for (const rawId of rawProductIds) {
    const productId = String(rawId || '').trim();
    if (!productId) continue;
    if (seen.has(productId)) {
      errors.push(`Store product ${productId} was submitted more than once.`);
      continue;
    }
    seen.add(productId);
    productIds.push(productId);
  }

  if (!productIds.length) errors.push('Product order must include at least one Store product.');
  if (productIds.length > 200) errors.push('Product order can include at most 200 products.');

  const catalog = normalizeStoreCatalogSnapshot(getStoreCatalogSnapshot(env));
  const catalogProducts = [...(catalog.products || [])].sort(compareAdminStoreProducts);
  const catalogIds = catalogProducts.map((product) => String(product?.id || '').trim()).filter(Boolean);
  const submitted = new Set(productIds);
  const missing = catalogIds.filter((productId) => !submitted.has(productId));
  const unknown = productIds.filter((productId) => !catalog.productById.has(productId));
  if (missing.length) errors.push(`Product order is missing ${missing.length} Store product${missing.length === 1 ? '' : 's'}.`);
  if (unknown.length) errors.push(`Product order includes unknown Store product${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);

  const targets = productIds.map((productId, index) => {
    const product = catalog.productById.get(productId);
    const sourcePath = getAdminStoreProductMarkdownPath(product);
    if (product && !sourcePath) errors.push(`Store product ${productId} source path is invalid.`);
    return {
      product,
      productId,
      sourcePath,
      order: (index + 1) * 10
    };
  }).filter((target) => target.product && target.sourcePath);

  if (errors.length) {
    return { ok: false, status: unknown.length ? 404 : 422, errors };
  }

  return {
    ok: true,
    targets,
    patchForTarget(target) {
      return {
        frontMatter: [{
          key: 'order',
          replacement: adminStoreProductScalarLine('order', target.order, 'number')
        }],
        descriptionChanged: false,
        description: '',
        changedFields: ['order']
      };
    }
  };
}

function applyAdminStoreProductPatchToMarkdown(source, patch = {}) {
  const match = String(source || '').match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)?$/);
  if (!match) {
    return { ok: false, error: 'Product Markdown must contain YAML front matter.' };
  }

  let frontMatter = match[1];
  for (const change of patch.frontMatter || []) {
    frontMatter = change.remove === true
      ? removeAdminFrontMatterBlock(frontMatter, change.key)
      : replaceAdminFrontMatterBlock(frontMatter, change.key, change.replacement);
  }

  const body = patch.descriptionChanged
    ? `\n${String(patch.description || '').replace(/\s+$/, '')}\n`
    : (match[2] || '\n');

  return {
    ok: true,
    content: `---\n${frontMatter.replace(/\s*$/, '')}\n---${body}`
  };
}

function buildAdminStoreNewProductMarkdown(productId, patch = {}) {
  const source = `---
identifier: ${yamlAdminValue(productId, 'string')}
sku: ${yamlAdminValue(productId, 'string')}
name: ""
description: ""
price: 0
image: ""
type: "product"
fulfillment_type: "physical"
status: "draft"
category: "dustwave"
order: 1000
shipping_preset: ""
tax_category: "standard"
inventory_tracking: false
inventory: 0
---
`;
  return applyAdminStoreProductPatchToMarkdown(source, patch);
}

function escapeAdminStorePreviewHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAdminStorePreviewAttribute(value) {
  return escapeAdminStorePreviewHtml(value).replace(/"/g, '&quot;');
}

function adminStorePreviewSiteBase(env = {}) {
  const raw = String(env?.CANONICAL_SITE_BASE || env?.SITE_BASE || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : '';
  } catch {
    return '';
  }
}

function adminStorePreviewUrl(value, env = {}) {
  const normalized = normalizeAdminUrlReference(value, 'Preview URL', { allowRelative: true });
  if (!normalized.ok || !normalized.value) return '';
  if (normalized.value.startsWith('/')) {
    const base = adminStorePreviewSiteBase(env);
    return base ? `${base}${normalized.value}` : normalized.value;
  }
  return normalized.value;
}

function renderAdminStoreProductInlineMarkdownHtml(value) {
  let html = escapeAdminStorePreviewHtml(value);
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*_([^_\n]+)_\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/___([^_\n]+)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  return html;
}

function renderAdminStoreProductInlineMarkdown(value, env = {}) {
  const placeholders = [];
  const placeholder = (html) => {
    placeholders.push(html);
    return `\u0000${placeholders.length - 1}\u0000`;
  };
  let text = String(value ?? '');
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, alt, href) => {
    const src = adminStorePreviewUrl(href, env);
    if (!src) return match;
    return placeholder(`<img src="${escapeAdminStorePreviewAttribute(src)}" alt="${escapeAdminStorePreviewAttribute(alt)}">`);
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, label, href) => {
    const url = adminStorePreviewUrl(href, env);
    if (!url) return match;
    const external = /^https?:\/\//i.test(url) && !url.startsWith(`${adminStorePreviewSiteBase(env)}/`);
    const rel = external ? ' rel="noopener noreferrer" target="_blank"' : '';
    return placeholder(`<a href="${escapeAdminStorePreviewAttribute(url)}"${rel}>${renderAdminStoreProductInlineMarkdownHtml(label)}</a>`);
  });

  let html = renderAdminStoreProductInlineMarkdownHtml(text);
  html = html.replace(/\u0000(\d+)\u0000/g, (_match, index) => placeholders[Number(index)] || '');
  return html;
}

function renderAdminStoreProductMarkdown(value, env = {}) {
  const source = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!source) return '<p class="admin-store-product-preview__empty">No description yet.</p>';
  const lines = source.split('\n');
  const html = [];
  let paragraph = [];
  let listType = '';
  let listItems = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${renderAdminStoreProductInlineMarkdown(paragraph.join(' '), env)}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!listType || !listItems.length) return;
    html.push(`<${listType}>${listItems.map((item) => `<li>${renderAdminStoreProductInlineMarkdown(item, env)}</li>`).join('')}</${listType}>`);
    listType = '';
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(4, heading[1].length + 1);
      html.push(`<h${level}>${renderAdminStoreProductInlineMarkdown(heading[2], env)}</h${level}>`);
      continue;
    }

    if (/^---+$/.test(line)) {
      flushParagraph();
      flushList();
      html.push('<hr>');
      continue;
    }

    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote><p>${renderAdminStoreProductInlineMarkdown(quote[1], env)}</p></blockquote>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (listType && listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(unordered[1]);
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(ordered[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return html.join('\n');
}

function formatAdminStorePreviewPrice(cents, currency = 'USD') {
  const amount = Math.max(0, Math.round(Number(cents) || 0)) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(currency || 'USD').trim() || 'USD',
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2
    }).format(amount);
  } catch {
    return `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
  }
}

function adminStorePreviewFontHead() {
  return `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preconnect" href="https://use.typekit.net" crossorigin>
  <link rel="dns-prefetch" href="https://p.typekit.net">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Inter:400,700">
  <link rel="stylesheet" href="https://use.typekit.net/hoj2yet.css">`;
}

function adminStorePreviewSlug(value, fallback = 'preview-product') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function adminStorePreviewPlainText(value) {
  return String(value ?? '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function adminStorePreviewTruncate(value, maxLength = 170) {
  const text = adminStorePreviewPlainText(value);
  const max = Math.max(20, Number(maxLength) || 170);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trimEnd()}...`;
}

function adminStorePreviewSelectedVariant(product = {}) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants.find((variant) => !variant?.status || variant.status === 'active') || variants[0] || null;
}

function adminStorePreviewSelectedPriceCents(product = {}, selectedVariant = null) {
  const basePrice = adminStoreProductPriceCents(product);
  if (!selectedVariant) return basePrice;
  if (selectedVariant.price_cents !== undefined || selectedVariant.price !== undefined) {
    return adminStoreProductPriceCents(selectedVariant);
  }
  return basePrice;
}

function adminStorePreviewButtonLabel(product = {}, priceCents = 0) {
  const type = String(product.fulfillment_type || product.type || 'physical').trim().toLowerCase();
  if (type === 'rsvp') return 'RSVP';
  if (type === 'ticket' && priceCents <= 0) return 'RSVP';
  if (type === 'ticket') return 'Add ticket';
  if (type === 'digital') return 'Add download';
  return 'Add to cart';
}

function buildAdminStoreProductPreviewEventHtml(product = {}, env = {}) {
  const type = String(product.fulfillment_type || product.type || '').trim().toLowerCase();
  if (!isAdminStoreEventFulfillmentType(type)) return '';
  const event = summarizeStoreEventDetails(product.event_details || product.eventDetails);
  if (!event?.startsAt && !event?.venue && !event?.address) return '';
  const lines = [];
  const eventTime = formatStoreEventDisplay(event, env);
  if (eventTime) {
    lines.push(`<p class="store-product-card__event-line store-product-card__event-line--date">${escapeAdminStorePreviewHtml(eventTime)}</p>`);
  }
  if (event?.venue) {
    lines.push(`<p class="store-product-card__event-line store-product-card__event-line--venue">${escapeAdminStorePreviewHtml(event.venue)}</p>`);
  }
  if (event?.address) {
    lines.push(`<p class="store-product-card__event-line store-product-card__event-line--address">${escapeAdminStorePreviewHtml(event.address)}</p>`);
  }
  return lines.length
    ? `<div class="store-product-card__event">${lines.join('')}</div>`
    : '';
}

function buildAdminStoreProductPreviewVariantOptions(product = {}, selectedVariant = null) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const basePrice = adminStoreProductPriceCents(product);
  return variants.map((variant, index) => {
    const id = String(variant?.id || variant?.sku || variant?.label || `variant-${index + 1}`).trim();
    const label = String(variant?.label || variant?.name || id).trim();
    const variantPrice = variant?.price_cents !== undefined || variant?.price !== undefined
      ? adminStoreProductPriceCents(variant)
      : basePrice;
    const priceLabel = variantPrice !== basePrice
      ? ` - ${formatAdminStorePreviewPrice(variantPrice, product.currency || 'USD')}`
      : '';
    const disabled = variant?.status && variant.status !== 'active' ? ' disabled' : '';
    const selected = selectedVariant && String(selectedVariant.id || selectedVariant.sku || selectedVariant.label || '') === id
      ? ' selected'
      : '';
    return `<option value="${escapeAdminStorePreviewAttribute(id)}"${selected}${disabled}>${escapeAdminStorePreviewHtml(label)}${escapeAdminStorePreviewHtml(priceLabel)}</option>`;
  }).join('');
}

function buildAdminStoreProductPreviewProduct(product = {}, body = {}) {
  const fields = body?.fields && typeof body.fields === 'object' ? body.fields : {};
  const preview = { ...product };
  if (hasAdminStoreProductPatchField(fields, 'name')) preview.name = String(fields.name || '').trim();
  if (hasAdminStoreProductPatchField(fields, 'seoDescription')) preview.description = String(fields.seoDescription || '').trim();
  else if (hasAdminStoreProductPatchField(fields, 'seo_description')) preview.description = String(fields.seo_description || '').trim();
  if (hasAdminStoreProductPatchField(fields, 'bodyDescription')) preview.body_description = String(fields.bodyDescription || '').trim();
  else if (hasAdminStoreProductPatchField(fields, 'body_description')) preview.body_description = String(fields.body_description || '').trim();
  else if (hasAdminStoreProductPatchField(fields, 'description')) preview.body_description = String(fields.description || '').trim();
  if (hasAdminStoreProductPatchField(fields, 'longContent') || hasAdminStoreProductPatchField(fields, 'long_content')) {
    const normalized = normalizeAdminStoreLongContent(
      hasAdminStoreProductPatchField(fields, 'longContent') ? fields.longContent : fields.long_content
    );
    if (normalized.ok) preview.long_content = normalized.value;
  }
  if (hasAdminStoreProductPatchField(fields, 'image')) preview.image = String(fields.image || '').trim();
  if (hasAdminStoreProductPatchField(fields, 'status')) preview.status = String(fields.status || '').trim();
  if (hasAdminStoreProductPatchField(fields, 'fulfillmentType')) preview.fulfillment_type = String(fields.fulfillmentType || '').trim();
  else if (hasAdminStoreProductPatchField(fields, 'fulfillment_type')) preview.fulfillment_type = String(fields.fulfillment_type || '').trim();
  if (hasAdminStoreProductPatchField(fields, 'variantOptionName')) preview.variant_option_name = String(fields.variantOptionName || '').trim();
  else if (hasAdminStoreProductPatchField(fields, 'variant_option_name')) preview.variant_option_name = String(fields.variant_option_name || '').trim();
  if (hasAdminStoreProductPatchField(fields, 'priceCents')) preview.price_cents = normalizeAdminStorePriceCentsField(fields.priceCents, 'Product price').value;
  else if (hasAdminStoreProductPatchField(fields, 'price')) preview.price_cents = normalizeAdminStorePriceField(fields.price, 'Product price').value;
  if (
    hasAdminStoreProductPatchField(fields, 'eventStartsAt') ||
    hasAdminStoreProductPatchField(fields, 'eventEndsAt') ||
    hasAdminStoreProductPatchField(fields, 'eventVenue') ||
    hasAdminStoreProductPatchField(fields, 'eventAddress') ||
    hasAdminStoreProductPatchField(fields, 'eventIcs')
  ) {
    const eventDetails = adminStoreEventDetailsSummary(preview);
    if (hasAdminStoreProductPatchField(fields, 'eventStartsAt')) eventDetails.startsAt = String(fields.eventStartsAt || '').trim();
    if (hasAdminStoreProductPatchField(fields, 'eventEndsAt')) eventDetails.endsAt = String(fields.eventEndsAt || '').trim();
    if (hasAdminStoreProductPatchField(fields, 'eventVenue')) eventDetails.venue = String(fields.eventVenue || '').trim();
    if (hasAdminStoreProductPatchField(fields, 'eventAddress')) eventDetails.address = String(fields.eventAddress || '').trim();
    if (hasAdminStoreProductPatchField(fields, 'eventIcs')) {
      eventDetails.ics = fields.eventIcs === true || String(fields.eventIcs || '').trim().toLowerCase() === 'true';
    }
    if (eventDetails.ticketDelivery === '') eventDetails.ticketDelivery = 'qr';
    preview.event_details = {
      starts_at: eventDetails.startsAt,
      ends_at: eventDetails.endsAt,
      venue: eventDetails.venue,
      address: eventDetails.address,
      ticket_delivery: eventDetails.ticketDelivery,
      ics: eventDetails.ics
    };
  }

  const submittedVariants = Array.isArray(body?.variants)
    ? body.variants
    : Array.isArray(fields?.variants)
      ? fields.variants
      : null;
  if (submittedVariants) {
    preview.variants = submittedVariants.map((variant, index) => {
      const id = String(variant?.id || `variant-${index + 1}`).trim();
      const next = {
        id,
        label: String(variant?.label || id).trim(),
        sku: String(variant?.sku || '').trim(),
        inventory: getConfiguredStoreInventory(variant?.inventory),
        status: String(variant?.status || 'active').trim() || 'active'
      };
      if (hasAdminStoreProductPatchField(variant, 'priceCents')) {
        next.price_cents = normalizeAdminStorePriceCentsField(variant.priceCents, 'Variant price').value;
      } else if (hasAdminStoreProductPatchField(variant, 'price')) {
        next.price_cents = normalizeAdminStorePriceField(variant.price, 'Variant price').value;
      }
      return next;
    }).filter((variant) => variant.id);
  }
  return preview;
}

function adminStoreProductPreviewDescriptionSource(product = {}) {
  if (hasAdminStoreProductPatchField(product, 'body_description')) return String(product.body_description || '');
  if (hasAdminStoreProductPatchField(product, 'bodyDescription')) return String(product.bodyDescription || '');
  return String(product.description || '');
}

function buildAdminStoreProductPreviewHtml(product = {}, env = {}) {
  const siteBase = adminStorePreviewSiteBase(env);
  const stylesheet = siteBase ? `${siteBase}/assets/main.css` : '/assets/main.css';
  const name = String(product.name || product.id || 'Untitled product').trim();
  const image = adminStorePreviewUrl(product.image || '', env);
  const productId = adminStorePreviewSlug(product.id || product.slug || name);
  const selectedVariant = adminStorePreviewSelectedVariant(product);
  const selectedVariantLabel = selectedVariant ? String(selectedVariant.label || selectedVariant.name || selectedVariant.id || '').trim() : '';
  const selectedPriceCents = adminStorePreviewSelectedPriceCents(product, selectedVariant);
  const price = formatAdminStorePreviewPrice(selectedPriceCents, product.currency || 'USD');
  const isFree = selectedPriceCents <= 0;
  const descriptionSource = adminStoreProductPreviewDescriptionSource(product);
  const description = renderAdminStoreProductMarkdown(descriptionSource, env);
  const buttonLabel = adminStorePreviewButtonLabel(product, selectedPriceCents);
  const buttonText = isFree ? buttonLabel : `${buttonLabel} - ${price}`;
  const eventHtml = buildAdminStoreProductPreviewEventHtml(product, env);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const hasVariants = variants.length > 0;
  const controlsClass = hasVariants ? 'store-product-card__controls--with-option' : 'store-product-card__controls--simple';
  const optionLabel = String(product.variant_option_name || 'Option').trim();
  const imageHtml = image
    ? `<img class="store-product-card__image" src="${escapeAdminStorePreviewAttribute(image)}" alt="${escapeAdminStorePreviewAttribute(name)}" loading="eager" decoding="async" fetchpriority="high">`
    : '<div class="admin-store-product-preview__image-placeholder">No image selected</div>';
  const optionHtml = hasVariants
    ? `<div class="store-product-card__field store-product-card__field--option">
          <label class="store-product-card__label" for="${escapeAdminStorePreviewAttribute(productId)}-variant">${escapeAdminStorePreviewHtml(optionLabel)}</label>
          <select class="store-product-card__select" id="${escapeAdminStorePreviewAttribute(productId)}-variant" disabled aria-disabled="true">
            ${buildAdminStoreProductPreviewVariantOptions(product, selectedVariant)}
          </select>
        </div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${siteBase ? `<base href="${escapeAdminStorePreviewAttribute(`${siteBase}/`)}">` : ''}
  ${adminStorePreviewFontHead()}
  <link rel="stylesheet" href="${escapeAdminStorePreviewAttribute(stylesheet)}">
</head>
<body class="admin-store-product-preview-body">
  <section class="storefront storefront--product admin-store-product-preview" data-admin-store-product-preview>
    <div class="storefront__header storefront__header--compact">
      <h1>${escapeAdminStorePreviewHtml(name)}</h1>
    </div>
    <div class="storefront__product-detail">
      <article class="store-product-card store-product-card--purchase-only" id="${escapeAdminStorePreviewAttribute(productId)}" data-store-product-card>
        <a class="store-product-card__media" href="#" tabindex="-1" aria-disabled="true">${imageHtml}</a>
        <div class="store-product-card__body">
          ${eventHtml}
          <div class="store-product-card__purchase">
            <p class="store-product-card__price" data-store-price>${isFree ? 'Free' : escapeAdminStorePreviewHtml(price)}</p>
            <p class="store-product-card__availability" data-store-availability data-store-inventory-state="none"></p>
            <div class="store-product-card__controls ${controlsClass}" data-store-product-controls>
              ${optionHtml}
              <div class="store-product-card__field store-product-card__field--quantity">
                <label class="store-product-card__label" for="${escapeAdminStorePreviewAttribute(productId)}-qty">Quantity</label>
                <div class="store-product-card__stepper">
                  <button class="store-product-card__stepper-button" type="button" disabled aria-disabled="true" aria-label="Decrease quantity">-</button>
                  <input class="store-product-card__qty" id="${escapeAdminStorePreviewAttribute(productId)}-qty" type="number" min="1" value="1" disabled aria-disabled="true">
                  <button class="store-product-card__stepper-button" type="button" disabled aria-disabled="true" aria-label="Increase quantity">+</button>
                </div>
              </div>
              <button class="store-add-item store-product-card__button" type="button" disabled aria-disabled="true" data-store-button-label="${escapeAdminStorePreviewAttribute(buttonLabel)}">${escapeAdminStorePreviewHtml(buttonText)}</button>
            </div>
          </div>
        </div>
      </article>
      <div class="storefront__product-copy">
        ${description}
        ${selectedVariantLabel ? `<p><strong>Selected option:</strong> ${escapeAdminStorePreviewHtml(selectedVariantLabel)}</p>` : ''}
      </div>
    </div>
  </section>
</body>
</html>`;
}

function collectAdminStoreProductMedia(env = {}, currentProductId = '') {
  const catalog = normalizeStoreCatalogSnapshot(getStoreCatalogSnapshot(env));
  const seen = new Set();
  const media = [];
  const current = String(currentProductId || '').trim();

  function add(path, label, productId) {
    const normalized = normalizeAdminAssetReference(path, 'Media path');
    if (!normalized.ok || !normalized.value) return;
    const key = normalized.value;
    if (seen.has(key)) return;
    seen.add(key);
    media.push({
      path: key,
      label: String(label || key).trim(),
      productId: String(productId || '').trim(),
      currentProduct: current && String(productId || '').trim() === current
    });
  }

  for (const product of catalog.products || []) {
    add(product.image, product.name || product.id, product.id);
  }

  media.sort((a, b) => {
    if (a.currentProduct !== b.currentProduct) return a.currentProduct ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  return media;
}

async function buildAdminStoreProductsSnapshot(env) {
  const baseSnapshot = getStoreCatalogSnapshot(env);
  const [overrides, downloads] = await Promise.all([
    getStoreInventoryOverrides(env),
    buildAdminStoreDownloadsSnapshot(env)
  ]);
  const effectiveSnapshot = applyStoreInventoryOverridesToSnapshot(baseSnapshot, overrides);
  const baseCatalog = normalizeStoreCatalogSnapshot(baseSnapshot);
  const effectiveCatalog = normalizeStoreCatalogSnapshot(effectiveSnapshot);
  const catalogProducts = [...(baseCatalog.products || [])].sort(compareAdminStoreProducts);
  const rows = [];
  const products = catalogProducts.map((product) => buildAdminStoreEditableProduct(product, overrides));
  const productCount = catalogProducts.length;
  let variantRowCount = 0;

  for (const product of catalogProducts) {
    const productId = String(product.id || '').trim();
    const effectiveProduct = effectiveCatalog.productById.get(productId) || {};
    const variants = Array.isArray(product.variants) ? product.variants : [];
    variantRowCount += variants.length;
    rows.push(buildAdminStoreProductRow({
      product,
      effectiveProduct,
      overrides
    }));
  }

  const fulfillmentCounts = {};
  const statusCounts = {};
  for (const row of rows) {
    const fulfillmentType = row.fulfillmentType || 'physical';
    const status = row.status || 'active';
    fulfillmentCounts[fulfillmentType] = (fulfillmentCounts[fulfillmentType] || 0) + 1;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  return {
    ok: true,
    products,
    rows,
    totals: {
      products: productCount,
      rows: rows.length,
      variants: variantRowCount,
      trackingInventory: rows.filter((row) => row.inventoryTracking).length,
      active: rows.filter((row) => row.status === 'active').length,
      withOverrides: rows.filter((row) => row.hasOverride).length
    },
    counts: {
      fulfillment: fulfillmentCounts,
      status: statusCounts
    },
    downloads: {
      files: downloads.files || [],
      totals: downloads.totals || null,
      updatedAt: downloads.updatedAt || null
    },
    catalog: {
      version: baseCatalog.version,
      source: baseCatalog.source,
      sourceHash: baseCatalog.sourceHash,
      shippingPresets: Object.keys(baseCatalog.shipping?.presets || {})
    },
    overridesUpdatedAt: overrides.updatedAt || null,
    updatedAt: new Date().toISOString()
  };
}

async function handleAdminStoreProducts(request, env) {
  const auth = await requireAdminSession(request, env, 'fulfillment:manage', { accessScope: STORE_ADMIN_SCOPE });
  if (!auth.ok) return auth.response;

  const snapshot = await buildAdminStoreProductsSnapshot(env);
  return privateJsonResponse({
    scope: STORE_ADMIN_SCOPE,
    products: snapshot.products,
    rows: snapshot.rows,
    totals: snapshot.totals,
    counts: snapshot.counts,
    downloads: snapshot.downloads,
    catalog: snapshot.catalog,
    overridesUpdatedAt: snapshot.overridesUpdatedAt,
    updatedAt: snapshot.updatedAt,
    writeBudget: adminReadBudget({ kvListExpected: 0 })
  }, 200, env);
}

const ADMIN_STORE_STATE_ABBREVIATIONS = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'district of columbia': 'DC'
};

function compactAdminStoreStreetName(value = '') {
  return String(value || '')
    .replace(/\bAvenue\b/gi, 'Ave')
    .replace(/\bStreet\b/gi, 'St')
    .replace(/\bRoad\b/gi, 'Rd')
    .replace(/\bBoulevard\b/gi, 'Blvd')
    .replace(/\bDrive\b/gi, 'Dr')
    .replace(/\bLane\b/gi, 'Ln')
    .replace(/\bCourt\b/gi, 'Ct')
    .replace(/\bNortheast\b/gi, 'NE')
    .replace(/\bNorthwest\b/gi, 'NW')
    .replace(/\bSoutheast\b/gi, 'SE')
    .replace(/\bSouthwest\b/gi, 'SW')
    .replace(/\bNorth\b/gi, 'N')
    .replace(/\bSouth\b/gi, 'S')
    .replace(/\bEast\b/gi, 'E')
    .replace(/\bWest\b/gi, 'W')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactAdminStoreState(value = '') {
  const raw = String(value || '').replace(/\./g, '').trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return ADMIN_STORE_STATE_ABBREVIATIONS[raw.toLowerCase()] || raw;
}

function compactAdminStorePostalCode(value = '') {
  return String(value || '').trim().match(/\b\d{5}(?:-\d{4})?\b/)?.[0] || String(value || '').trim();
}

function formatAdminStoreCompactAddress({ houseNumber = '', road = '', city = '', state = '', postcode = '' } = {}) {
  const streetName = compactAdminStoreStreetName(road);
  const street = [String(houseNumber || '').trim(), streetName].filter(Boolean).join(' ').trim();
  const region = compactAdminStoreState(state);
  const postal = compactAdminStorePostalCode(postcode);
  const locality = String(city || '').trim();
  const cityRegion = [locality, region].filter(Boolean).join(', ');
  const secondLine = [cityRegion, postal].filter(Boolean).join(' ').trim();
  return [street, secondLine].filter(Boolean).join('\n').trim();
}

function formatAdminStoreCompactAddressFromDisplayName(value = '') {
  const raw = String(value || '').trim();
  if (raw.includes('\n')) return '';
  const compactMatch = raw.match(/^(.+?\d[^,]*),\s*([^,]+),\s*([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);
  if (compactMatch) {
    return formatAdminStoreCompactAddress({
      road: compactMatch[1],
      city: compactMatch[2],
      state: compactMatch[3],
      postcode: compactMatch[4] || ''
    });
  }
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  const houseIndex = parts.findIndex((part) => /^\d+[A-Za-z]?$/.test(part) || /^\d+\s+/.test(part));
  if (houseIndex < 0) return '';
  const houseNumber = parts[houseIndex].match(/^\d+[A-Za-z]?/)?.[0] || '';
  const road = parts[houseIndex].replace(/^\d+[A-Za-z]?\s*/, '').trim() || parts[houseIndex + 1] || '';
  const stateIndex = parts.findIndex((part) => Boolean(compactAdminStoreState(part).match(/^[A-Z]{2}$/)));
  const statePostalIndex = parts.findIndex((part) => /^[A-Za-z]{2}\s+\d{5}(?:-\d{4})?$/.test(part));
  const postcodeIndex = parts.findIndex((part) => /\b\d{5}(?:-\d{4})?\b/.test(part));
  const cityCandidates = parts
    .slice(
      Math.min(houseIndex + 2, parts.length),
      stateIndex >= 0 ? stateIndex : statePostalIndex >= 0 ? statePostalIndex : postcodeIndex >= 0 ? postcodeIndex : parts.length
    )
    .filter((part) => !/\bcounty\b/i.test(part));
  const statePostal = statePostalIndex >= 0 ? parts[statePostalIndex].split(/\s+/) : [];
  return formatAdminStoreCompactAddress({
    houseNumber,
    road,
    city: cityCandidates[cityCandidates.length - 1] || '',
    state: stateIndex >= 0 ? parts[stateIndex] : statePostal[0] || '',
    postcode: postcodeIndex >= 0 ? parts[postcodeIndex] : statePostal[1] || ''
  });
}

function compactAdminStoreEventAddress(value = '') {
  const raw = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!raw) return '';
  return formatAdminStoreCompactAddressFromDisplayName(raw) || raw;
}

function formatNominatimAddressResult(result = {}) {
  const address = result?.address && typeof result.address === 'object' ? result.address : {};
  return formatAdminStoreCompactAddress({
    houseNumber: address.house_number || address.housenumber || '',
    road: address.road || address.pedestrian || address.footway || address.street || '',
    city: address.city || address.town || address.village || address.municipality || '',
    state: address.state || '',
    postcode: address.postcode || ''
  }) || formatAdminStoreCompactAddressFromDisplayName(result?.display_name || '');
}

function formatPhotonAddressFeature(feature = {}) {
  const props = feature?.properties && typeof feature.properties === 'object' ? feature.properties : {};
  return formatAdminStoreCompactAddress({
    houseNumber: props.housenumber,
    road: props.street,
    city: props.city || props.locality,
    state: props.state,
    postcode: props.postcode
  });
}

function normalizeAdminStoreAddressLookupQuery(query = '') {
  return String(query || '').replace(/\s+/g, ' ').trim();
}

async function getAdminStoreAddressLookupCacheKey(query = '') {
  const normalized = normalizeAdminStoreAddressLookupQuery(query).toLowerCase();
  if (!normalized) return '';
  return `${STORE_EVENT_ADDRESS_LOOKUP_CACHE_PREFIX}${await sha256HexString(normalized)}`;
}

async function lookupAdminStoreEventAddress(query, env) {
  const cacheKey = env?.STORE_STATE ? await getAdminStoreAddressLookupCacheKey(query) : '';
  if (cacheKey) {
    const cached = await env.STORE_STATE.get(cacheKey, { type: 'json' }).catch(() => null);
    if (cached?.address) {
      const cachedAddress = String(cached.address || '').trim();
      return {
        ok: true,
        address: formatAdminStoreCompactAddressFromDisplayName(cachedAddress) || cachedAddress,
        source: String(cached.source || 'cache').trim() || 'cache',
        latitude: String(cached.latitude || '').trim(),
        longitude: String(cached.longitude || '').trim(),
        cached: true
      };
    }
  }
  const siteHost = (() => {
    try {
      return new URL(String(env?.SITE_BASE || 'https://shop.dustwave.xyz')).hostname;
    } catch {
      return 'shop.dustwave.xyz';
    }
  })();
  const headers = {
    Accept: 'application/json',
    Referer: getSiteOrigin(env) || 'https://shop.dustwave.xyz',
    'User-Agent': `DustWaveStore/1.0 (${siteHost})`
  };
  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`;
    const response = await fetch(nominatimUrl, { headers });
    const results = await response.json().catch(() => []);
    const first = Array.isArray(results) ? results[0] : null;
    const address = formatNominatimAddressResult(first);
    if (response.ok && address) {
      const result = {
        ok: true,
        address,
        source: 'nominatim',
        latitude: String(first?.lat || '').trim(),
        longitude: String(first?.lon || '').trim()
      };
      if (cacheKey) {
        await env.STORE_STATE.put(cacheKey, JSON.stringify({
          address: result.address,
          source: result.source,
          latitude: result.latitude,
          longitude: result.longitude,
          cachedAt: new Date().toISOString()
        }), { expirationTtl: STORE_EVENT_ADDRESS_LOOKUP_CACHE_TTL_SECONDS }).catch(() => {});
      }
      return result;
    }
  } catch (error) {
    console.warn('Store event address lookup failed with Nominatim:', error?.message || error);
  }

  const photonUrl = `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(query)}`;
  const response = await fetch(photonUrl, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  const feature = Array.isArray(data?.features) ? data.features[0] : null;
  const address = formatPhotonAddressFeature(feature);
  if (!response.ok || !address) {
    return { ok: false, error: 'No matching address found.' };
  }
  const coordinates = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
  const result = {
    ok: true,
    address,
    source: 'photon',
    latitude: coordinates[1] !== undefined ? String(coordinates[1]) : '',
    longitude: coordinates[0] !== undefined ? String(coordinates[0]) : ''
  };
  if (cacheKey) {
    await env.STORE_STATE.put(cacheKey, JSON.stringify({
      address: result.address,
      source: result.source,
      latitude: result.latitude,
      longitude: result.longitude,
      cachedAt: new Date().toISOString()
    }), { expirationTtl: STORE_EVENT_ADDRESS_LOOKUP_CACHE_TTL_SECONDS }).catch(() => {});
  }
  return result;
}

async function handleAdminStoreProductAddressLookup(request, env) {
  const auth = await requireAdminSession(request, env, 'fulfillment:manage', { accessScope: STORE_ADMIN_SCOPE });
  if (!auth.ok) return auth.response;

  const query = normalizeAdminStoreAddressLookupQuery(new URL(request.url).searchParams.get('q') || '');
  if (query.length < 3) {
    return privateJsonResponse({ error: 'Enter at least 3 characters to find an address.' }, 400, env);
  }
  if (query.length > 240) {
    return privateJsonResponse({ error: 'Address search must be 240 characters or fewer.' }, 400, env);
  }
  const result = await lookupAdminStoreEventAddress(query, env);
  if (!result.ok) return privateJsonResponse({ error: result.error || 'No matching address found.' }, 404, env);
  return privateJsonResponse({
    ok: true,
    query,
    address: result.address,
    source: result.source,
    latitude: result.latitude,
    longitude: result.longitude,
    cached: result.cached === true
  }, 200, env);
}

function buildAdminStoreCouponProductChoices(env) {
  const catalog = normalizeStoreCatalogSnapshot(getStoreCatalogSnapshot(env));
  return (catalog.products || [])
    .filter((product) => String(product?.id || '').trim())
    .sort(compareAdminStoreProducts)
    .map((product) => ({
      productId: String(product.id || '').trim(),
      name: String(product.name || product.id || '').trim(),
      status: String(product.status || 'active').trim() || 'active',
      fulfillmentType: String(product.fulfillment_type || product.type || 'physical').trim() || 'physical',
      collection: String(product.collection || product.event || '').trim(),
      category: String(product.category || '').trim()
    }));
}

async function handleAdminStoreCoupons(request, env) {
  const auth = await requireAdminSession(request, env, 'fulfillment:manage', { accessScope: STORE_ADMIN_SCOPE });
  if (!auth.ok) return auth.response;

  const loaded = await loadStoreCoupons(env);
  if (!loaded.ok) {
    return privateJsonResponse({
      error: loaded.error || 'Coupon storage unavailable.',
      writeBudget: adminReadBudget({ kvListExpected: 0 })
    }, loaded.status || 503, env);
  }

  return privateJsonResponse({
    scope: STORE_ADMIN_SCOPE,
    coupons: loaded.coupons,
    products: buildAdminStoreCouponProductChoices(env),
    totals: {
      coupons: loaded.coupons.length,
      active: loaded.coupons.filter((coupon) => coupon.status === 'active').length,
      draft: loaded.coupons.filter((coupon) => coupon.status === 'draft').length
    },
    updatedAt: loaded.updatedAt || '',
    writeBudget: adminReadBudget({ kvListExpected: 0 })
  }, 200, env);
}

async function handleAdminStoreCouponSave(request, env) {
  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const auth = await requireAdminSession(request, env, 'fulfillment:manage', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;

  const loaded = await loadStoreCoupons(env);
  if (!loaded.ok) {
    return privateJsonResponse({
      error: loaded.error || 'Coupon storage unavailable.',
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0 })
    }, loaded.status || 503, env);
  }

  const incoming = parsedBody.body?.coupon || parsedBody.body || {};
  const originalCode = String(parsedBody.body?.originalCode || parsedBody.body?.original_code || '').trim();
  const upserted = upsertStoreCoupon(loaded.coupons, incoming, { originalCode });
  if (!upserted.ok) {
    return privateJsonResponse({
      error: upserted.error || 'Coupon is invalid.',
      errors: upserted.errors || [upserted.error || 'Coupon is invalid.'],
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0 })
    }, upserted.status || 422, env);
  }

  const saved = await saveStoreCoupons(env, upserted.coupons);
  if (!saved.ok) {
    return privateJsonResponse({
      error: saved.error || 'Coupon could not be saved.',
      errors: saved.errors || [],
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0 })
    }, saved.status || 422, env);
  }

  const auditKey = await recordAdminAuditEvent(env, {
    action: upserted.existing ? 'store_coupon:update' : 'store_coupon:create',
    adminEmail: auth.user.email,
    adminRole: auth.user.role,
    couponCode: upserted.coupon.code,
    before: upserted.existing,
    after: upserted.coupon
  });

  return privateJsonResponse({
    success: true,
    coupon: upserted.coupon,
    coupons: saved.coupons,
    products: buildAdminStoreCouponProductChoices(env),
    updatedAt: saved.updatedAt,
    auditKey,
    writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: auditKey ? 2 : 1 })
  }, 200, env);
}

async function handleAdminStoreCouponDelete(request, env) {
  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const auth = await requireAdminSession(request, env, 'fulfillment:manage', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;

  const loaded = await loadStoreCoupons(env);
  if (!loaded.ok) {
    return privateJsonResponse({
      error: loaded.error || 'Coupon storage unavailable.',
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0 })
    }, loaded.status || 503, env);
  }

  const requestedCode = String(parsedBody.body?.code || parsedBody.body?.id || '').trim().toUpperCase();
  const existing = loaded.coupons.find((coupon) => coupon.code === requestedCode || coupon.id === requestedCode.toLowerCase());
  if (!existing) {
    return privateJsonResponse({
      error: 'Coupon code was not found.',
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0 })
    }, 404, env);
  }

  const saved = await saveStoreCoupons(env, loaded.coupons.filter((coupon) => coupon.code !== existing.code));
  if (!saved.ok) {
    return privateJsonResponse({
      error: saved.error || 'Coupon could not be deleted.',
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0 })
    }, saved.status || 422, env);
  }

  const auditKey = await recordAdminAuditEvent(env, {
    action: 'store_coupon:delete',
    adminEmail: auth.user.email,
    adminRole: auth.user.role,
    couponCode: existing.code,
    before: existing
  });

  return privateJsonResponse({
    success: true,
    deleted: existing.code,
    coupons: saved.coupons,
    products: buildAdminStoreCouponProductChoices(env),
    updatedAt: saved.updatedAt,
    auditKey,
    writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: auditKey ? 2 : 1 })
  }, 200, env);
}

async function handleAdminStoreProductMedia(request, env) {
  const auth = await requireAdminSession(request, env, 'store:read', { accessScope: STORE_ADMIN_SCOPE });
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const productId = String(url.searchParams.get('productId') || '').trim();
  const media = collectAdminStoreProductMedia(env, productId);
  return privateJsonResponse({
    scope: STORE_ADMIN_SCOPE,
    productId,
    media,
    images: media,
    totals: { media: media.length },
    writeBudget: adminReadBudget({ kvListExpected: 0 })
  }, 200, env);
}

async function handleAdminStoreProductPreview(request, env) {
  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const auth = await requireAdminSession(request, env, 'fulfillment:manage', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;

  const normalized = normalizeAdminStoreProductPublishBody(parsedBody.body || {}, env, {
    intent: 'preview',
    requireChanges: false
  });
  if (!normalized.ok) {
    return privateJsonResponse({
      success: false,
      errors: normalized.errors || ['Invalid Store product preview.'],
      writeBudget: adminReadBudget({ kvListExpected: 0 })
    }, normalized.status || 422, env);
  }

  const previewProduct = buildAdminStoreProductPreviewProduct(normalized.product, parsedBody.body || {});
  return privateJsonResponse({
    success: true,
    scope: STORE_ADMIN_SCOPE,
    productId: String(previewProduct.id || normalized.product.id || ''),
    preview: {
      html: buildAdminStoreProductPreviewHtml(previewProduct, env),
      generatedAt: new Date().toISOString()
    },
    writeBudget: adminReadBudget({ kvListExpected: 0 })
  }, 200, env);
}

async function handleAdminStoreProductPublish(request, env) {
  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const auth = await requireAdminSession(request, env, 'fulfillment:manage', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;

  const normalized = normalizeAdminStoreProductPublishBody(parsedBody.body || {}, env);
  if (!normalized.ok) {
    return privateJsonResponse({
      success: false,
      errors: normalized.errors || ['Invalid Store product edit.'],
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0 })
    }, normalized.status || 422, env);
  }

  let existing = null;
  if (!normalized.createProduct) {
    existing = await readAdminRepoTextFile(env, normalized.sourcePath);
    if (!existing.ok) {
      return privateJsonResponse({
        error: existing.error || 'Unable to load product Markdown from repository',
        code: existing.code || 'repo_load_failed'
      }, existing.status || 502, env);
    }
  }

  const nextMarkdown = normalized.createProduct
    ? buildAdminStoreNewProductMarkdown(normalized.product.id, normalized.patch)
    : applyAdminStoreProductPatchToMarkdown(existing.content, normalized.patch);
  if (!nextMarkdown.ok) {
    return privateJsonResponse({ error: nextMarkdown.error }, 422, env);
  }

  if (!normalized.createProduct && nextMarkdown.content === existing.content) {
    return privateJsonResponse({
      success: true,
      published: false,
      productId: normalized.product.id,
      githubPath: normalized.sourcePath,
      message: 'No product changes to publish.',
      rebuild: { triggered: false, reason: 'No changes' },
      changedFields: normalized.patch.changedFields,
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0 })
    }, 200, env);
  }

  const commitMessage = String(parsedBody.body?.message || '').trim()
    || `${normalized.createProduct ? 'Create' : 'Update'} Store product ${normalized.product.id}`;
  const committed = await putAdminRepoTextFile(env, normalized.sourcePath, nextMarkdown.content, commitMessage, existing?.sha, {
    overwrite: !normalized.createProduct
  });
  if (!committed.ok) {
    return privateJsonResponse({
      error: committed.error || 'Unable to publish Store product',
      code: committed.code || 'repo_write_failed'
    }, committed.status || 502, env);
  }

  const rebuild = await triggerAdminRepoRebuild(env, `${normalized.createProduct ? 'admin-store-product-create' : 'admin-store-product-publish'}:${normalized.product.id}`);
  const auditKey = await recordAdminAuditEvent(env, {
    action: normalized.createProduct ? 'store_product:create' : 'store_product:publish',
    adminEmail: auth.user.email,
    adminRole: auth.user.role,
    productId: normalized.product.id,
    sku: normalized.product.sku || normalized.product.id,
    githubPath: normalized.sourcePath,
    commitSha: committed.commitSha,
    repositoryMode: adminRepoMode(env),
    changedFields: normalized.patch.changedFields,
    rebuildTriggered: rebuild.triggered === true
  });

  return privateJsonResponse({
    success: true,
    published: true,
    created: normalized.createProduct === true,
    productId: normalized.product.id,
    githubPath: normalized.sourcePath,
    commitSha: committed.commitSha,
    commitUrl: committed.commitUrl,
    repositoryMode: adminRepoMode(env),
    rebuild,
    auditKey,
    changedFields: normalized.patch.changedFields,
    deployNotice: normalized.createProduct
      ? adminRepoDeployNotice(
        env,
        'Product created in GitHub and deploy started. Changes may take a few minutes to appear.',
        'Product created locally. Jekyll will rebuild in local dev.'
      )
      : adminRepoDeployNotice(
        env,
        'Publishing commits changes to GitHub and starts a deploy. Changes may take a few minutes to appear.',
        'Product saved locally. Jekyll will rebuild in local dev.'
      ),
    writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 1, kvListExpected: 0 })
  }, 200, env);
}

async function handleAdminStoreProductBulkPublish(request, env) {
  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const auth = await requireAdminSession(request, env, 'fulfillment:manage', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;

  const normalized = normalizeAdminStoreProductBulkPublishBody(parsedBody.body || {}, env);
  if (!normalized.ok) {
    return privateJsonResponse({
      success: false,
      errors: normalized.errors || ['Invalid Store product bulk edit.'],
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0 })
    }, normalized.status || 422, env);
  }

  const results = [];
  const committedProducts = [];
  const pendingWrites = [];
  const commitMessage = String(parsedBody.body?.message || '').trim()
    || `Bulk update Store products (${normalized.targets.length})`;

  for (const target of normalized.targets) {
    const existing = await readAdminRepoTextFile(env, target.sourcePath);
    if (!existing.ok) {
      return privateJsonResponse({
        error: existing.error || `Unable to load ${target.sourcePath} from repository`,
        code: existing.code || 'repo_load_failed',
        productId: target.productId,
        results
      }, existing.status || 502, env);
    }

    const nextMarkdown = applyAdminStoreProductPatchToMarkdown(existing.content, normalized.patch);
    if (!nextMarkdown.ok) {
      return privateJsonResponse({
        error: nextMarkdown.error,
        productId: target.productId,
        results
      }, 422, env);
    }

    if (nextMarkdown.content === existing.content) {
      results.push({
        productId: target.productId,
        githubPath: target.sourcePath,
        published: false,
        reason: 'No changes'
      });
      continue;
    }

    const result = {
      productId: target.productId,
      githubPath: target.sourcePath,
      published: true
    };
    results.push(result);
    pendingWrites.push({
      result,
      path: target.sourcePath,
      content: nextMarkdown.content,
      expectedSha: existing.sha
    });
  }

  if (pendingWrites.length > 0) {
    const committed = await putAdminRepoTextFiles(env, pendingWrites, commitMessage, {
      overwrite: true
    });
    if (!committed.ok) {
      return privateJsonResponse({
        error: committed.error || 'Unable to publish Store product changes',
        code: committed.code || 'repo_write_failed',
        path: committed.path,
        results
      }, committed.status || 502, env);
    }

    for (const pending of pendingWrites) {
      pending.result.commitSha = committed.commitSha || '';
      pending.result.commitUrl = committed.commitUrl || '';
      committedProducts.push(pending.result);
    }
  }

  const rebuild = committedProducts.length > 0
    ? await triggerAdminRepoRebuild(env, `admin-store-products-bulk-publish:${committedProducts.length}`)
    : { triggered: false, reason: 'No changes' };
  const auditKey = committedProducts.length > 0
    ? await recordAdminAuditEvent(env, {
      action: 'store_product:bulk_publish',
      adminEmail: auth.user.email,
      adminRole: auth.user.role,
      productIds: committedProducts.map((product) => product.productId),
      githubPaths: committedProducts.map((product) => product.githubPath),
      changedFields: normalized.patch.changedFields,
      repositoryMode: adminRepoMode(env),
      rebuildTriggered: rebuild.triggered === true
    })
    : null;

  return privateJsonResponse({
    success: true,
    published: committedProducts.length > 0,
    updated: committedProducts.length,
    skipped: results.length - committedProducts.length,
    productIds: normalized.targets.map((target) => target.productId),
    results,
    rebuild,
    auditKey,
    repositoryMode: adminRepoMode(env),
    changedFields: normalized.patch.changedFields,
    deployNotice: committedProducts.length > 0
      ? adminRepoDeployNotice(
        env,
        'Bulk product publish committed changes to GitHub and started a deploy. Changes may take a few minutes to appear.',
        'Bulk product edits saved locally. Jekyll will rebuild in local dev.'
      )
      : 'No product changes to publish.',
    writeBudget: adminWriteBudget({
      readOnly: false,
      kvWritesExpected: committedProducts.length > 0 ? 1 : 0,
      kvListExpected: 0
    })
  }, 200, env);
}

async function handleAdminStoreProductOrderPublish(request, env) {
  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const auth = await requireAdminSession(request, env, 'fulfillment:manage', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;

  const normalized = normalizeAdminStoreProductOrderBody(parsedBody.body || {}, env);
  if (!normalized.ok) {
    return privateJsonResponse({
      success: false,
      errors: normalized.errors || ['Invalid Store product order.'],
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0, kvListExpected: 0 })
    }, normalized.status || 422, env);
  }

  const results = [];
  const committedProducts = [];
  const pendingWrites = [];
  const commitMessage = String(parsedBody.body?.message || '').trim()
    || 'Update Store product display order';

  for (const target of normalized.targets) {
    const existing = await readAdminRepoTextFile(env, target.sourcePath);
    if (!existing.ok) {
      return privateJsonResponse({
        error: existing.error || `Unable to load ${target.sourcePath} from repository`,
        code: existing.code || 'repo_load_failed',
        productId: target.productId,
        results
      }, existing.status || 502, env);
    }

    const nextMarkdown = applyAdminStoreProductPatchToMarkdown(existing.content, normalized.patchForTarget(target));
    if (!nextMarkdown.ok) {
      return privateJsonResponse({
        error: nextMarkdown.error,
        productId: target.productId,
        results
      }, 422, env);
    }

    if (nextMarkdown.content === existing.content) {
      results.push({
        productId: target.productId,
        githubPath: target.sourcePath,
        order: target.order,
        published: false,
        reason: 'No changes'
      });
      continue;
    }

    const result = {
      productId: target.productId,
      githubPath: target.sourcePath,
      order: target.order,
      published: true
    };
    results.push(result);
    pendingWrites.push({
      result,
      path: target.sourcePath,
      content: nextMarkdown.content,
      expectedSha: existing.sha
    });
  }

  if (pendingWrites.length > 0) {
    const committed = await putAdminRepoTextFiles(env, pendingWrites, commitMessage, {
      overwrite: true
    });
    if (!committed.ok) {
      return privateJsonResponse({
        error: committed.error || 'Unable to publish product order changes',
        code: committed.code || 'repo_write_failed',
        path: committed.path,
        results
      }, committed.status || 502, env);
    }

    for (const pending of pendingWrites) {
      pending.result.commitSha = committed.commitSha || '';
      pending.result.commitUrl = committed.commitUrl || '';
      committedProducts.push(pending.result);
    }
  }

  const rebuild = committedProducts.length > 0
    ? await triggerAdminRepoRebuild(env, `admin-store-products-order:${committedProducts.length}`)
    : { triggered: false, reason: 'No changes' };
  const auditKey = committedProducts.length > 0
    ? await recordAdminAuditEvent(env, {
      action: 'store_product:order_publish',
      adminEmail: auth.user.email,
      adminRole: auth.user.role,
      productIds: normalized.targets.map((target) => target.productId),
      githubPaths: committedProducts.map((product) => product.githubPath),
      changedFields: ['order'],
      repositoryMode: adminRepoMode(env),
      rebuildTriggered: rebuild.triggered === true
    })
    : null;

  return privateJsonResponse({
    success: true,
    published: committedProducts.length > 0,
    updated: committedProducts.length,
    skipped: results.length - committedProducts.length,
    productIds: normalized.targets.map((target) => target.productId),
    order: normalized.targets.map((target) => ({
      productId: target.productId,
      order: target.order
    })),
    results,
    rebuild,
    auditKey,
    repositoryMode: adminRepoMode(env),
    changedFields: ['order'],
    deployNotice: committedProducts.length > 0
      ? adminRepoDeployNotice(
        env,
        'Product order saved in GitHub and deploy started. Changes may take a few minutes to appear.',
        'Product order saved locally. Jekyll will rebuild in local dev.'
      )
      : 'Product order already matches the saved order.',
    writeBudget: adminWriteBudget({
      readOnly: false,
      kvWritesExpected: committedProducts.length > 0 ? 1 : 0,
      kvListExpected: 0
    })
  }, 200, env);
}

async function buildAdminStoreInventorySnapshot(env) {
  const baseSnapshot = getStoreCatalogSnapshot(env);
  const overrides = await getStoreInventoryOverrides(env);
  const effectiveSnapshot = applyStoreInventoryOverridesToSnapshot(baseSnapshot, overrides);
  const baseCatalog = normalizeStoreCatalogSnapshot(baseSnapshot);
  const effectiveCatalog = normalizeStoreCatalogSnapshot(effectiveSnapshot);
  const sold = await buildStoreInventorySoldCounts(env);
  if (!sold.ok) return sold;

  const rows = [];
  for (const product of baseCatalog.products || []) {
    if (product?.inventory_tracking !== true) continue;
    const productId = String(product.id || '').trim();
    const effectiveProduct = effectiveCatalog.productById.get(productId) || {};
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length > 0) {
      const effectiveVariants = new Map((Array.isArray(effectiveProduct.variants) ? effectiveProduct.variants : [])
        .map((variant) => [String(variant?.id || ''), variant]));
      for (const variant of variants) {
        rows.push(buildAdminStoreInventoryRow({
          product,
          variant,
          effectiveProduct,
          effectiveVariant: effectiveVariants.get(String(variant?.id || '')) || null,
          overrides,
          soldBySku: sold.soldBySku
        }));
      }
      continue;
    }

    rows.push(buildAdminStoreInventoryRow({
      product,
      effectiveProduct,
      overrides,
      soldBySku: sold.soldBySku
    }));
  }

  return {
    ok: true,
    rows,
    overridesUpdatedAt: overrides.updatedAt || null,
    updatedAt: new Date().toISOString(),
    scanned: sold.scanned,
    indexed: sold.indexed,
    listCalls: sold.listCalls,
    truncated: sold.truncated
  };
}

function sanitizeStoreInventoryMutationInteger(value, fieldName, { allowZero = true } = {}) {
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isFinite(parsed) || parsed < minimum || Math.floor(parsed) !== parsed) {
    throw new Error(`${fieldName} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
  return parsed;
}

function findStoreInventoryTarget(env, productId, variantId = '') {
  const catalog = normalizeStoreCatalogSnapshot(getStoreCatalogSnapshot(env));
  const product = catalog.productById.get(String(productId || '').trim());
  if (!product) throw new Error('Store product not found');
  if (product.inventory_tracking !== true) throw new Error('Store product does not track inventory');

  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length > 0) {
    const variant = variants.find((entry) => String(entry?.id || '') === String(variantId || ''));
    if (!variant) throw new Error('A valid Store product variant is required');
    return {
      productId: String(product.id || ''),
      variantId: String(variant.id || ''),
      label: `${String(product.name || product.id)} (${String(variant.label || variant.id)})`
    };
  }

  return {
    productId: String(product.id || ''),
    variantId: '',
    label: String(product.name || product.id)
  };
}

function findStoreInventorySnapshotRow(snapshot = {}, productId = '', variantId = '') {
  return (snapshot.rows || []).find((row) => (
    row.productId === productId &&
    String(row.variantId || '') === String(variantId || '')
  )) || null;
}

async function mutateStoreInventoryOverride(env, mutation = {}) {
  if (!env?.STORE_STATE) {
    throw new Error('STORE_STATE KV not configured');
  }

  const action = String(mutation.action || '').trim().toLowerCase();
  if (!['set', 'restock', 'reset'].includes(action)) {
    throw new Error('Unsupported inventory action');
  }

  const target = findStoreInventoryTarget(env, mutation.productId, mutation.variantId);
  const beforeSnapshot = await buildAdminStoreInventorySnapshot(env);
  if (!beforeSnapshot.ok) throw new Error(beforeSnapshot.error || 'Store inventory unavailable');
  const before = findStoreInventorySnapshotRow(beforeSnapshot, target.productId, target.variantId);
  if (!before) throw new Error('Store inventory target not found');

  const currentInventory = before.inventory === null || before.inventory === undefined
    ? null
    : sanitizeStoreInventoryMutationInteger(before.inventory, 'Current inventory');
  const configuredInventory = before.configuredInventory === null || before.configuredInventory === undefined
    ? null
    : sanitizeStoreInventoryMutationInteger(before.configuredInventory, 'Configured inventory');
  let nextInventory = configuredInventory;

  if (action === 'set') {
    nextInventory = sanitizeStoreInventoryMutationInteger(mutation.inventory, 'Inventory');
  } else if (action === 'restock') {
    if (currentInventory === null) {
      throw new Error('Unlimited inventory cannot be restocked');
    }
    nextInventory = currentInventory + sanitizeStoreInventoryMutationInteger(mutation.quantity, 'Restock quantity', { allowZero: false });
  }

  const overrides = await getStoreInventoryOverrides(env);
  const nextOverrides = action === 'reset' || nextInventory === configuredInventory
    ? resetStoreOverrideInventory(overrides, target.productId, target.variantId)
    : setStoreOverrideInventory(overrides, target.productId, target.variantId, nextInventory);

  const persistResult = await persistStoreInventoryOverrides(env, nextOverrides);
  const afterSnapshot = await buildAdminStoreInventorySnapshot(env);
  if (!afterSnapshot.ok) throw new Error(afterSnapshot.error || 'Store inventory unavailable');
  const after = findStoreInventorySnapshotRow(afterSnapshot, target.productId, target.variantId);

  return {
    action,
    productId: target.productId,
    variantId: target.variantId,
    label: target.label,
    before: {
      configuredInventory: before.configuredInventory,
      inventory: before.inventory,
      overrideInventory: before.overrideInventory,
      sold: before.sold,
      remaining: before.remaining,
      hasOverride: Boolean(before.hasOverride)
    },
    after: {
      configuredInventory: after?.configuredInventory ?? null,
      inventory: after?.inventory ?? null,
      overrideInventory: after?.overrideInventory ?? null,
      sold: after?.sold ?? 0,
      remaining: after?.remaining ?? null,
      hasOverride: Boolean(after?.hasOverride)
    },
    storageWrite: persistResult.storageWrite,
    overridesUpdatedAt: afterSnapshot.overridesUpdatedAt || null
  };
}

async function handleAdminStoreInventory(request, env) {
  const auth = await requireAdminSession(request, env, 'fulfillment:manage', { accessScope: STORE_ADMIN_SCOPE });
  if (!auth.ok) return auth.response;

  const snapshot = await buildAdminStoreInventorySnapshot(env);
  if (!snapshot.ok) {
    return privateJsonResponse({ error: snapshot.error }, snapshot.status || 503, env);
  }

  return privateJsonResponse({
    scope: STORE_ADMIN_SCOPE,
    rows: snapshot.rows,
    overridesUpdatedAt: snapshot.overridesUpdatedAt,
    updatedAt: snapshot.updatedAt,
    page: {
      scanned: snapshot.scanned,
      indexed: snapshot.indexed,
      truncated: snapshot.truncated
    },
    writeBudget: adminReadBudget({ kvListExpected: snapshot.listCalls || 1 })
  }, 200, env);
}

async function handleAdminStoreInventoryMutation(request, env) {
  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const auth = await requireAdminSession(request, env, 'fulfillment:manage', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;

  try {
    const mutation = await mutateStoreInventoryOverride(env, parsedBody.body || {});
    const auditKey = await recordAdminAuditEvent(env, {
      action: 'store_inventory:manage',
      adminEmail: auth.user.email,
      adminRole: auth.user.role,
      productId: mutation.productId,
      variantId: mutation.variantId,
      inventoryAction: mutation.action,
      before: mutation.before,
      after: mutation.after
    });

    return privateJsonResponse({
      success: true,
      mutation,
      auditKey,
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: mutation.storageWrite ? 2 : 1, kvListExpected: 2 })
    }, 200, env);
  } catch (error) {
    return privateJsonResponse({
      error: error instanceof Error ? error.message : String(error || 'Store inventory mutation failed')
    }, 400, env);
  }
}

function storeAdminOrderFiltersFromUrl(url) {
  return {
    status: String(url.searchParams.get('status') || 'all').trim().toLowerCase(),
    fulfillment: String(url.searchParams.get('fulfillment') || 'all').trim().toLowerCase(),
    query: String(url.searchParams.get('q') || '').trim().toLowerCase()
  };
}

async function buildAdminStoreOrdersPayload(request, env, options = {}) {
  const auth = await requireAdminSession(request, env, 'fulfillment:manage', { accessScope: STORE_ADMIN_SCOPE });
  if (!auth.ok) return { ok: false, response: auth.response };

  const scannedOrders = await readAdminStoreOrderScan(env, {
    force: options.forceScan === true,
    ctx: options.ctx || null
  });
  if (!scannedOrders.ok) {
    return { ok: false, response: privateJsonResponse({ error: scannedOrders.error }, scannedOrders.status || 503, env) };
  }

  const url = new URL(request.url);
  const filters = storeAdminOrderFiltersFromUrl(url);
  const orders = scannedOrders.orders.filter((order) => adminStoreOrderMatchesFilters(order, filters));

  const allFulfillmentRows = orders.flatMap((order) => (
    order.items
      .filter((item) => adminStoreFulfillmentMatchesFilter(item, filters))
      .map((item) => buildAdminStoreFulfillmentRow(order, item))
  ));
  const attendance = buildAdminStoreAttendanceReport(allFulfillmentRows);
  const matchedOrderTokens = new Set(allFulfillmentRows.map((row) => row.orderToken));
  const matchedOrders = orders.filter((order) => matchedOrderTokens.has(order.orderToken));
  const paginate = options.paginate !== false;
  const limit = paginate ? clampAdminPageLimit(url.searchParams.get('limit')) : matchedOrders.length || 0;
  const cursorOffset = paginate ? Math.max(0, Number.parseInt(String(url.searchParams.get('cursor') || '0'), 10) || 0) : 0;
  const pageOrders = paginate
    ? matchedOrders.slice(cursorOffset, cursorOffset + limit)
    : matchedOrders;
  const pageOrderTokens = new Set(pageOrders.map((order) => order.orderToken));
  const fulfillmentRows = paginate
    ? allFulfillmentRows.filter((row) => pageOrderTokens.has(row.orderToken))
    : allFulfillmentRows;
  const nextCursor = paginate && matchedOrders.length > cursorOffset + pageOrders.length
    ? cursorOffset + pageOrders.length
    : null;

  const scanCache = scannedOrders.cache || null;
  return {
    ok: true,
    payload: {
      user: auth.user,
      scope: STORE_ADMIN_SCOPE,
      orders: pageOrders,
      fulfillments: fulfillmentRows,
      totals: {
        orders: matchedOrders.length,
        fulfillmentRows: allFulfillmentRows.length,
        totalCents: matchedOrders.reduce((sum, order) => sum + Number(order.totals?.totalCents || 0), 0),
        ticketQuantity: allFulfillmentRows.filter(isAdminStoreAnalyticsTicketRow).reduce((sum, row) => sum + Number(row.quantity || 0), 0),
        checkedInQuantity: allFulfillmentRows.filter((row) => row.checkInAvailable).reduce((sum, row) => sum + Number(row.checkedInQuantity || 0), 0),
        physicalQuantity: allFulfillmentRows.filter((row) => row.shippable || row.fulfillmentType === 'physical').reduce((sum, row) => sum + Number(row.quantity || 0), 0),
        digitalQuantity: allFulfillmentRows.filter((row) => row.fulfillmentType === 'digital').reduce((sum, row) => sum + Number(row.quantity || 0), 0)
      },
      attendance,
      page: {
        limit,
        cursor: cursorOffset,
        nextCursor,
        returned: pageOrders.length,
        matched: allFulfillmentRows.length,
        matchedOrders: matchedOrders.length,
        scanned: scannedOrders.scanned,
        indexed: scannedOrders.indexed,
        truncated: scannedOrders.truncated === true,
        cache: scannedOrders.cache || null,
        generatedAt: scannedOrders.generatedAt || ''
      },
      filters,
      writeBudget: adminReadBudget({
        kvListExpected: scanCache?.hit ? 0 : (scannedOrders.listCalls || 1),
        kvReadsExpected: scanCache?.hit
          ? (scanCache.source === 'kv_index' ? 1 : 0)
          : scannedOrders.scanned
      }),
      generatedAt: new Date().toISOString()
    }
  };
}

async function handleAdminStoreSnipcartOrderImport(request, env, body = {}, ctx = null) {
  const auth = await requireAdminSession(request, env, 'fulfillment:manage', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;

  if (!isProductionWorkerRequest(request, env)) {
    return privateJsonResponse({
      success: false,
      error: 'Snipcart order imports can only run against the production Worker.',
      code: 'production_only',
      writeBudget: adminWriteBudget({ readOnly: true, kvWritesExpected: 0, kvListExpected: 0 })
    }, 409, env);
  }

  if (!env?.STORE_STATE) {
    return privateJsonResponse({ error: 'Order storage unavailable' }, 503, env);
  }

  const csv = String(body.csv || body.content || '');
  const filename = String(body.filename || 'snipcart-orders.csv').trim().slice(0, 160) || 'snipcart-orders.csv';
  if (!csv.trim()) {
    return privateJsonResponse({ error: 'Choose a Snipcart CSV file before importing.' }, 400, env);
  }

  const csvBytes = new TextEncoder().encode(csv).byteLength;
  if (csvBytes > SNIPCART_IMPORT_MAX_CSV_BYTES) {
    return privateJsonResponse({
      error: 'Snipcart CSV must be 1 MB or smaller.'
    }, 413, env);
  }

  const importedAt = new Date().toISOString();
  const parsed = parseSnipcartOrdersCsv(csv, { importedAt });
  if (!parsed.ok) {
    return privateJsonResponse({
      success: false,
      error: parsed.error || 'Snipcart CSV could not be imported.',
      missingHeaders: parsed.missingHeaders || [],
      errors: parsed.errors || [],
      warnings: parsed.warnings || [],
      writeBudget: adminWriteBudget({ readOnly: true, kvWritesExpected: 0, kvListExpected: 0 })
    }, parsed.status || 422, env);
  }

  const listed = await listAdminStoreOrderKeys(env);
  if (!listed.ok) {
    return privateJsonResponse({ error: listed.error }, listed.status || 503, env);
  }
  const existingKeys = new Set((listed.keys || []).map((key) => String(key?.name || '').trim()).filter(Boolean));
  const importedOrders = [];
  const lookupIndexedOrders = [];
  const skippedOrders = [];
  const failures = [];

  for (const order of parsed.orders) {
    const storageKey = getStoreOrderStorageKey(order.orderToken);
    if (!storageKey) {
      failures.push({ orderToken: order.orderToken || '', error: 'Invalid Store order token.' });
      continue;
    }
    if (existingKeys.has(storageKey)) {
      skippedOrders.push(order.orderToken);
      const existingOrder = await env.STORE_STATE.get(storageKey, { type: 'json' });
      const indexResult = existingOrder ? await upsertStoreOrderEmailIndex(env, existingOrder) : null;
      if (indexResult?.ok) lookupIndexedOrders.push(order.orderToken);
      continue;
    }

    try {
      const orderHash = await hashStoreOrderDraft(order.orderDraft || {});
      const storedOrder = {
        ...order,
        orderHash,
        orderDraft: {
          ...(order.orderDraft || {}),
          orderHash
        },
        emailSent: false
      };
      await env.STORE_STATE.put(storageKey, JSON.stringify(storedOrder));
      const indexResult = await upsertStoreOrderEmailIndex(env, storedOrder);
      if (indexResult?.ok) lookupIndexedOrders.push(storedOrder.orderToken);
      existingKeys.add(storageKey);
      importedOrders.push(storedOrder.orderToken);
    } catch (error) {
      failures.push({
        orderToken: order.orderToken || '',
        error: error?.message || 'Failed to write imported order.'
      });
    }
  }
  if (importedOrders.length > 0) invalidateAdminStoreOrderScanCache(env, ctx);

  const auditKey = await recordAdminAuditEvent(env, {
    action: 'store_orders:snipcart_import',
    adminEmail: auth.user.email,
    adminRole: auth.user.role,
    filename,
    rowCount: parsed.rowCount,
    parsedOrderCount: parsed.orderCount,
    importedOrderCount: importedOrders.length,
    lookupIndexedOrderCount: lookupIndexedOrders.length,
    skippedOrderCount: skippedOrders.length,
    failedOrderCount: failures.length
  });

  const message = [
    `Imported ${importedOrders.length} Snipcart order${importedOrders.length === 1 ? '' : 's'}.`,
    skippedOrders.length ? `Skipped ${skippedOrders.length} existing order${skippedOrders.length === 1 ? '' : 's'}.` : '',
    failures.length ? `${failures.length} order${failures.length === 1 ? '' : 's'} failed.` : ''
  ].filter(Boolean).join(' ');

  return privateJsonResponse({
    success: failures.length === 0,
    message,
    scope: STORE_ADMIN_SCOPE,
    filename,
    rowCount: parsed.rowCount,
    parsedOrderCount: parsed.orderCount,
    importedOrderCount: importedOrders.length,
    lookupIndexedOrderCount: lookupIndexedOrders.length,
    skippedOrderCount: skippedOrders.length,
    failedOrderCount: failures.length,
    importedOrderTokens: importedOrders.slice(0, 50),
    lookupIndexedOrderTokens: lookupIndexedOrders.slice(0, 50),
    skippedOrderTokens: skippedOrders.slice(0, 50),
    failures: failures.slice(0, 20),
    warnings: (parsed.warnings || []).slice(0, 20),
    auditKey,
    writeBudget: adminWriteBudget({
      readOnly: false,
      kvWritesExpected: importedOrders.length + lookupIndexedOrders.length + (auditKey ? 1 : 0),
      kvListExpected: listed.listCalls || 1
    })
  }, failures.length ? 207 : 200, env);
}

async function handleAdminStoreOrders(request, env, ctx = null) {
  const built = await buildAdminStoreOrdersPayload(request, env, { ctx });
  if (!built.ok) return built.response;
  return privateJsonResponse(built.payload, 200, env);
}

function incrementStoreAnalyticsBreakdown(map, key, quantity = 1, revenueCents = 0) {
  const normalizedKey = String(key || 'Unknown').trim() || 'Unknown';
  const existing = map.get(normalizedKey) || {
    key: normalizedKey,
    count: 0,
    quantity: 0,
    revenueCents: 0
  };
  existing.count += 1;
  existing.quantity += Math.max(0, Number(quantity || 0) || 0);
  existing.revenueCents += Math.max(0, Number(revenueCents || 0) || 0);
  map.set(normalizedKey, existing);
}

function storeAnalyticsBreakdownRows(map, limit = 20) {
  return Array.from(map.values())
    .sort((a, b) => Number(b.revenueCents || 0) - Number(a.revenueCents || 0) ||
      Number(b.quantity || 0) - Number(a.quantity || 0) ||
      String(a.key || '').localeCompare(String(b.key || '')))
    .slice(0, limit);
}

function buildAdminStoreAnalyticsPayload(ordersPayload = {}) {
  const allOrders = Array.isArray(ordersPayload.orders) ? ordersPayload.orders : [];
  const orders = allOrders.filter(isAdminStoreAnalyticsSettledOrder);
  const settledOrderTokens = new Set(orders.map((order) => String(order.orderToken || '')).filter(Boolean));
  const rows = (Array.isArray(ordersPayload.fulfillments) ? ordersPayload.fulfillments : [])
    .filter((row) => settledOrderTokens.has(String(row.orderToken || '')));
  const fulfillmentBreakdown = new Map();
  const productBreakdown = new Map();
  const statusBreakdown = new Map();
  const paymentBreakdown = new Map();
  const referralBreakdown = new Map();
  const utmSourceBreakdown = new Map();
  const utmMediumBreakdown = new Map();
  const utmCampaignBreakdown = new Map();
  const utmContentBreakdown = new Map();
  const revenueCents = orders.reduce((sum, order) => sum + Math.max(0, Number(order?.totals?.totalCents || 0) || 0), 0);
  const itemSubtotalCents = rows.reduce((sum, row) => sum + Math.max(0, Number(row.subtotalCents || 0) || 0), 0);
  const itemQuantity = rows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0) || 0), 0);
  const ticketRows = rows.filter(isAdminStoreAnalyticsTicketRow);
  const ticketQuantity = ticketRows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0) || 0), 0);
  const checkedInQuantity = ticketRows.reduce((sum, row) => sum + Math.max(0, Number(row.checkedInQuantity || 0) || 0), 0);

  orders.forEach((order) => {
    incrementStoreAnalyticsBreakdown(statusBreakdown, order.status || 'unknown', 1, order.totals?.totalCents || 0);
    incrementStoreAnalyticsBreakdown(paymentBreakdown, order.payment?.status || 'unknown', 1, order.totals?.totalCents || 0);
    const attribution = normalizeAdminStoreOrderAttribution(order.attribution || {});
    const orderRevenue = order.totals?.totalCents || 0;
    incrementStoreAnalyticsBreakdown(referralBreakdown, attribution.ref || 'direct', 1, orderRevenue);
    incrementStoreAnalyticsBreakdown(utmSourceBreakdown, attribution.utmSource || 'none', 1, orderRevenue);
    incrementStoreAnalyticsBreakdown(utmMediumBreakdown, attribution.utmMedium || 'none', 1, orderRevenue);
    incrementStoreAnalyticsBreakdown(utmCampaignBreakdown, attribution.utmCampaign || 'none', 1, orderRevenue);
    incrementStoreAnalyticsBreakdown(utmContentBreakdown, attribution.utmContent || 'none', 1, orderRevenue);
  });

  rows.forEach((row) => {
    const quantity = Math.max(0, Number(row.quantity || 0) || 0);
    const subtotal = Math.max(0, Number(row.subtotalCents || 0) || 0);
    const fulfillmentType = row.fulfillmentType || (row.shippable ? 'physical' : 'other');
    const productLabel = [row.itemName, row.variantLabel].filter(Boolean).join(' - ') || row.productId || row.sku || 'Unknown product';
    incrementStoreAnalyticsBreakdown(fulfillmentBreakdown, fulfillmentType, quantity, subtotal);
    incrementStoreAnalyticsBreakdown(productBreakdown, productLabel, quantity, subtotal);
  });

  return {
    user: ordersPayload.user || null,
    scope: STORE_ADMIN_SCOPE,
    totals: {
      orders: orders.length,
      fulfillmentRows: rows.length,
      itemQuantity,
      revenueCents,
      itemSubtotalCents,
      averageOrderCents: orders.length ? Math.round(revenueCents / orders.length) : 0,
      physicalQuantity: rows.filter((row) => row.shippable || row.fulfillmentType === 'physical').reduce((sum, row) => sum + Number(row.quantity || 0), 0),
      digitalQuantity: rows.filter((row) => row.fulfillmentType === 'digital').reduce((sum, row) => sum + Number(row.quantity || 0), 0),
      ticketQuantity,
      checkedInQuantity,
      uncheckedQuantity: Math.max(0, ticketQuantity - checkedInQuantity),
      checkedInRate: ticketQuantity > 0 ? Math.round((checkedInQuantity / ticketQuantity) * 100) : 0
    },
    breakdowns: {
      fulfillment: storeAnalyticsBreakdownRows(fulfillmentBreakdown),
      products: storeAnalyticsBreakdownRows(productBreakdown),
      status: storeAnalyticsBreakdownRows(statusBreakdown),
      payment: storeAnalyticsBreakdownRows(paymentBreakdown),
      referral: storeAnalyticsBreakdownRows(referralBreakdown),
      utmSource: storeAnalyticsBreakdownRows(utmSourceBreakdown),
      utmMedium: storeAnalyticsBreakdownRows(utmMediumBreakdown),
      utmCampaign: storeAnalyticsBreakdownRows(utmCampaignBreakdown),
      utmContent: storeAnalyticsBreakdownRows(utmContentBreakdown)
    },
    page: ordersPayload.page || null,
    filters: ordersPayload.filters || {},
    excluded: {
      unsettledOrders: Math.max(0, allOrders.length - orders.length)
    },
    generatedAt: new Date().toISOString(),
    writeBudget: ordersPayload.writeBudget || adminReadBudget()
  };
}

async function handleAdminStoreAnalytics(request, env) {
  const built = await buildAdminStoreOrdersPayload(request, env, { paginate: false });
  if (!built.ok) return built.response;
  const payload = buildAdminStoreAnalyticsPayload(built.payload);
  const referralRows = await readAdminStoreMarketingReferrals(env);
  payload.referralLabels = Object.fromEntries(referralRows.map((row) => [
    row.code,
    row.referrer || row.name || row.code
  ]));
  return privateJsonResponse(payload, 200, env);
}

function adminStoreMarketingAllowedOrigins(env) {
  return [env?.SITE_BASE, env?.CANONICAL_SITE_BASE, getSiteOrigin(env)]
    .map((value) => {
      try {
        return value ? new URL(String(value)).origin : '';
      } catch {
        return '';
      }
    })
    .filter(Boolean);
}

function normalizeAdminStoreMarketingUrl(value, env) {
  const raw = String(value || '').trim().slice(0, 2048);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const allowedOrigins = adminStoreMarketingAllowedOrigins(env);
    if (allowedOrigins.length > 0 && !allowedOrigins.includes(url.origin)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function publicAdminStoreMarketingReferral(record = {}) {
  const referrer = String(record.referrer || record.name || '');
  const url = String(record.url || '');
  return {
    code: normalizeAdminStoreMarketingCode(record.code),
    name: referrer,
    referrer,
    url,
    path: String(record.path || ''),
    utmSource: String(record.utmSource || ''),
    utmMedium: String(record.utmMedium || ''),
    utmCampaign: String(record.utmCampaign || ''),
    utmContent: String(record.utmContent || ''),
    qrCode: url ? { format: 'qr-code', url } : null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    createdBy: String(record.createdBy || '')
  };
}

async function readAdminStoreMarketingReferrals(env) {
  if (!env?.STORE_STATE) return [];
  const rows = await env.STORE_STATE.get(ADMIN_STORE_MARKETING_REFERRALS_KEY, { type: 'json' });
  return Array.isArray(rows)
    ? rows.map(publicAdminStoreMarketingReferral).filter((row) => row.code)
    : [];
}

async function handleAdminStoreMarketingReferrals(request, env) {
  const auth = await requireAdminSession(request, env, 'store:read', { accessScope: STORE_ADMIN_SCOPE });
  if (!auth.ok) return auth.response;

  const referrals = await readAdminStoreMarketingReferrals(env);
  return privateJsonResponse({
    user: auth.user,
    scope: STORE_ADMIN_SCOPE,
    referrals,
    writeBudget: adminReadBudget({ kvListExpected: 0 })
  }, 200, env);
}

async function handleAdminStoreMarketingReferralSave(request, env, body = {}) {
  const auth = await requireAdminSession(request, env, 'settings:publish', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;
  if (!env?.STORE_STATE) {
    return privateJsonResponse({ error: 'Store marketing storage unavailable' }, 503, env);
  }

  const code = normalizeAdminStoreMarketingCode(body.code);
  const originalCode = normalizeAdminStoreMarketingCode(body.originalCode);
  const normalizedReferrer = normalizeAdminPlainText(body.referrer || body.name || '', 'Referrer name', { maxLength: 120 });
  if (!normalizedReferrer.ok) {
    return privateJsonResponse({ error: normalizedReferrer.error }, 400, env);
  }
  const url = normalizeAdminStoreMarketingUrl(body.url, env);
  if (!code || !normalizedReferrer.value || !url) {
    return privateJsonResponse({ error: 'Referral code, referrer name, and Store URL are required.' }, 400, env);
  }

  const normalizeOptional = (value, label, maxLength = 120) => {
    const normalized = normalizeAdminPlainText(value || '', label, { maxLength });
    return normalized.ok ? normalized.value : '';
  };
  const now = new Date().toISOString();
  const referrals = await readAdminStoreMarketingReferrals(env);
  const originalIndex = originalCode ? referrals.findIndex((row) => row.code === originalCode) : -1;
  const codeIndex = referrals.findIndex((row) => row.code === code);
  if (originalIndex >= 0 && codeIndex >= 0 && codeIndex !== originalIndex) {
    return privateJsonResponse({ error: 'That referral code is already saved.' }, 409, env);
  }

  const existingIndex = originalIndex >= 0 ? originalIndex : codeIndex;
  const nextRecord = {
    code,
    name: normalizedReferrer.value,
    referrer: normalizedReferrer.value,
    url,
    path: normalizeOptional(body.path, 'Destination path', 2048),
    utmSource: normalizeOptional(body.utmSource, 'UTM source', 80),
    utmMedium: normalizeOptional(body.utmMedium, 'UTM medium', 80),
    utmCampaign: normalizeOptional(body.utmCampaign, 'UTM campaign', 120),
    utmContent: normalizeOptional(body.utmContent, 'UTM content', 120),
    qrCode: { format: 'qr-code', url },
    createdAt: existingIndex >= 0 ? referrals[existingIndex].createdAt || now : now,
    updatedAt: now,
    createdBy: existingIndex >= 0 ? referrals[existingIndex].createdBy || auth.user.email : auth.user.email
  };
  if (existingIndex >= 0) {
    referrals[existingIndex] = nextRecord;
  } else {
    referrals.unshift(nextRecord);
  }
  referrals.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const publicRows = referrals.map(publicAdminStoreMarketingReferral);
  await env.STORE_STATE.put(ADMIN_STORE_MARKETING_REFERRALS_KEY, JSON.stringify(publicRows));
  const auditKey = await recordAdminAuditEvent(env, {
    action: 'store_marketing:referral_save',
    adminEmail: auth.user.email,
    adminRole: auth.user.role,
    code,
    referrer: normalizedReferrer.value,
    url
  });

  return privateJsonResponse({
    success: true,
    user: auth.user,
    scope: STORE_ADMIN_SCOPE,
    referral: publicAdminStoreMarketingReferral(nextRecord),
    referrals: publicRows,
    auditKey,
    writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: auditKey ? 2 : 1, kvListExpected: 0 })
  }, 200, env);
}

async function handleAdminStoreMarketingReferralDelete(request, env, body = {}) {
  const auth = await requireAdminSession(request, env, 'settings:publish', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;
  if (!env?.STORE_STATE) {
    return privateJsonResponse({ error: 'Store marketing storage unavailable' }, 503, env);
  }

  const code = normalizeAdminStoreMarketingCode(body.code);
  if (!code) {
    return privateJsonResponse({ error: 'Referral code is required.' }, 400, env);
  }

  const referrals = await readAdminStoreMarketingReferrals(env);
  const nextReferrals = referrals.filter((row) => row.code !== code);
  if (nextReferrals.length === referrals.length) {
    return privateJsonResponse({ error: 'Referral code not found.' }, 404, env);
  }
  if (nextReferrals.length === 0) {
    await env.STORE_STATE.delete(ADMIN_STORE_MARKETING_REFERRALS_KEY);
  } else {
    await env.STORE_STATE.put(ADMIN_STORE_MARKETING_REFERRALS_KEY, JSON.stringify(nextReferrals.map(publicAdminStoreMarketingReferral)));
  }
  const auditKey = await recordAdminAuditEvent(env, {
    action: 'store_marketing:referral_delete',
    adminEmail: auth.user.email,
    adminRole: auth.user.role,
    code
  });

  return privateJsonResponse({
    success: true,
    user: auth.user,
    scope: STORE_ADMIN_SCOPE,
    deletedCode: code,
    referrals: nextReferrals.map(publicAdminStoreMarketingReferral),
    auditKey,
    writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: auditKey ? 2 : 1, kvListExpected: 0 })
  }, 200, env);
}

function publicAdminStoreMarketingDraft(record = null) {
  if (!record || typeof record !== 'object') return null;
  return {
    draft: record.draft || {},
    revision: String(record.revision || ''),
    updatedAt: String(record.updatedAt || ''),
    updatedBy: String(record.updatedBy || ''),
    expiresAt: String(record.expiresAt || '')
  };
}

function normalizeAdminStoreMarketingDraft(draft = {}) {
  const source = draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {};
  const normalizeOptional = (value, label, maxLength = 120) => {
    const normalized = normalizeAdminPlainText(value || '', label, { maxLength });
    return normalized.ok ? normalized.value : '';
  };
  const referrer = normalizeAdminPlainText(source.referrer || source.name || '', 'Referrer name', { maxLength: 120 });
  if (!referrer.ok) return referrer;
  const normalized = {
    path: normalizeOptional(source.path || '/', 'Destination path', 2048) || '/',
    referrer: referrer.value,
    ref: normalizeAdminStoreMarketingCode(source.ref || source.code || referrer.value),
    source: normalizeOptional(source.source || source.utmSource, 'UTM source', 80),
    medium: normalizeOptional(source.medium || source.utmMedium, 'UTM medium', 80),
    campaign: normalizeOptional(source.campaign || source.utmCampaign, 'UTM campaign', 120),
    content: normalizeOptional(source.content || source.utmContent, 'UTM content', 120)
  };
  return { ok: true, value: normalized };
}

async function adminStoreMarketingDraftRevision(draft = {}) {
  return sha256HexString(JSON.stringify(draft));
}

async function handleAdminStoreMarketingDraftRead(request, env) {
  const auth = await requireAdminSession(request, env, 'store:read', { accessScope: STORE_ADMIN_SCOPE });
  if (!auth.ok) return auth.response;
  if (!env?.STORE_STATE) {
    return privateJsonResponse({ error: 'Store marketing storage unavailable' }, 503, env);
  }

  const draft = publicAdminStoreMarketingDraft(await env.STORE_STATE.get(ADMIN_STORE_MARKETING_DRAFT_KEY, { type: 'json' }));
  return privateJsonResponse({
    user: auth.user,
    scope: STORE_ADMIN_SCOPE,
    draft,
    ttlSeconds: ADMIN_STORE_MARKETING_DRAFT_TTL_SECONDS,
    writeBudget: adminReadBudget({ kvListExpected: 0 })
  }, 200, env);
}

async function handleAdminStoreMarketingDraftSave(request, env, body = {}) {
  const auth = await requireAdminSession(request, env, 'settings:publish', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;
  if (!env?.STORE_STATE) {
    return privateJsonResponse({ error: 'Store marketing storage unavailable' }, 503, env);
  }

  const normalized = normalizeAdminStoreMarketingDraft(body.draft || {});
  if (!normalized.ok) {
    return privateJsonResponse({ error: normalized.error }, 400, env);
  }
  const existing = publicAdminStoreMarketingDraft(await env.STORE_STATE.get(ADMIN_STORE_MARKETING_DRAFT_KEY, { type: 'json' }));
  const baseRevision = String(body.baseRevision || '').trim();
  if (existing?.revision && existing.revision !== baseRevision) {
    return privateJsonResponse({
      error: 'Shared draft changed since you loaded it.',
      code: 'draft_conflict',
      currentDraft: existing,
      writeBudget: adminReadBudget({ kvListExpected: 0 })
    }, 409, env);
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ADMIN_STORE_MARKETING_DRAFT_TTL_SECONDS * 1000).toISOString();
  const record = {
    version: 1,
    draft: normalized.value,
    revision: await adminStoreMarketingDraftRevision(normalized.value),
    updatedAt: now,
    updatedBy: auth.user.email,
    expiresAt
  };
  await env.STORE_STATE.put(ADMIN_STORE_MARKETING_DRAFT_KEY, JSON.stringify(record), {
    expirationTtl: ADMIN_STORE_MARKETING_DRAFT_TTL_SECONDS
  });
  const auditKey = await recordAdminAuditEvent(env, {
    action: 'store_marketing:draft_save',
    adminEmail: auth.user.email,
    adminRole: auth.user.role
  });

  return privateJsonResponse({
    success: true,
    user: auth.user,
    scope: STORE_ADMIN_SCOPE,
    draft: publicAdminStoreMarketingDraft(record),
    auditKey,
    writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: auditKey ? 2 : 1, kvListExpected: 0 })
  }, 200, env);
}

async function handleAdminStoreMarketingDraftDelete(request, env) {
  const auth = await requireAdminSession(request, env, 'settings:publish', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;
  if (!env?.STORE_STATE) {
    return privateJsonResponse({ error: 'Store marketing storage unavailable' }, 503, env);
  }

  await env.STORE_STATE.delete(ADMIN_STORE_MARKETING_DRAFT_KEY);
  const auditKey = await recordAdminAuditEvent(env, {
    action: 'store_marketing:draft_delete',
    adminEmail: auth.user.email,
    adminRole: auth.user.role
  });

  return privateJsonResponse({
    success: true,
    user: auth.user,
    scope: STORE_ADMIN_SCOPE,
    draft: null,
    auditKey,
    writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: auditKey ? 2 : 1, kvListExpected: 0 })
  }, 200, env);
}

function escapeCsvValue(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function rebuildCsvReport(report = {}) {
  const header = Array.isArray(report.header) ? report.header : [];
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const csvRows = [header, ...rows]
    .map((row) => (Array.isArray(row) ? row : []).map(escapeCsvValue).join(','));
  return {
    header,
    rows,
    csv: `${csvRows.join('\n')}\n`
  };
}

function storeFulfillmentRowsCsv(rows = []) {
  const header = [
    'order_token',
    'status',
    'created_at',
    'confirmed_at',
    'customer_email',
    'customer_name',
    'total_cents',
    'currency',
    'payment_status',
    'email_sent',
    'item_id',
    'sku',
    'item_name',
    'variant',
    'quantity',
    'subtotal_cents',
    'fulfillment_type',
    'shipping_required',
    'event_starts_at',
    'event_venue',
    'event_address',
    'check_in_available',
    'checked_in',
    'checked_in_quantity',
    'checked_in_at',
    'checked_in_by',
    'download_access_status',
    'download_access_expires_at',
    'download_access_expires_hours',
    'download_access_revoked_at',
    'download_access_updated_at',
    'download_access_updated_by'
  ];
  const csvRows = rows.map((row) => [
    row.orderToken,
    row.status,
    row.createdAt,
    row.confirmedAt,
    row.customerEmail,
    row.customerName,
    row.totalCents,
    row.currency,
    row.paymentStatus,
    row.emailSent ? 'yes' : 'no',
    row.itemId,
    row.sku,
    row.itemName,
    row.variantLabel,
    row.quantity,
    row.subtotalCents,
    row.fulfillmentType,
    row.shippingRequired ? 'yes' : 'no',
    row.eventStartsAt,
    row.eventVenue,
    row.eventAddress,
    row.checkInAvailable ? 'yes' : 'no',
    row.checkedIn ? 'yes' : 'no',
    row.checkedInQuantity,
    row.checkedInAt,
    row.checkedInBy,
    row.downloadAccessStatus,
    row.downloadAccessExpiresAt,
    row.downloadAccessExpiresHours,
    row.downloadAccessRevokedAt,
    row.downloadAccessUpdatedAt,
    row.downloadAccessUpdatedBy
  ]);
  return rebuildCsvReport({ header, rows: csvRows }).csv;
}

function storeAttendeeRowsCsv(rows = []) {
  const attendeeRows = rows.filter((row) => row.checkInAvailable === true);
  const header = [
    'event_starts_at',
    'event_venue',
    'event_address',
    'item_name',
    'variant',
    'order_token',
    'customer_name',
    'customer_email',
    'quantity',
    'checked_in_quantity',
    'unchecked_quantity',
    'checked_in',
    'checked_in_at',
    'checked_in_by',
    'check_in_updated_at',
    'check_in_updated_by',
    'check_in_note'
  ];
  const csvRows = attendeeRows.map((row) => {
    const quantity = Math.max(0, Number(row.quantity || 0) || 0);
    const checkedInQuantity = Math.max(0, Number(row.checkedInQuantity || 0) || 0);
    return [
      row.eventStartsAt,
      row.eventVenue,
      row.eventAddress,
      row.itemName,
      row.variantLabel,
      row.orderToken,
      row.customerName,
      row.customerEmail,
      quantity,
      Math.min(quantity, checkedInQuantity),
      Math.max(0, quantity - checkedInQuantity),
      row.checkedIn ? 'yes' : 'no',
      row.checkedInAt,
      row.checkedInBy,
      row.checkInUpdatedAt,
      row.checkInUpdatedBy,
      row.checkInNote
    ];
  });
  return rebuildCsvReport({ header, rows: csvRows }).csv;
}

async function handleAdminStoreOrdersCsv(request, env, ctx = null) {
  const built = await buildAdminStoreOrdersPayload(request, env, { paginate: false, ctx });
  if (!built.ok) return built.response;
  const dateKey = getPlatformDateKey(env, new Date());
  return csvResponse(storeFulfillmentRowsCsv(built.payload.fulfillments), `store-orders-${dateKey}.csv`, env);
}

async function handleAdminStoreAttendeesCsv(request, env, ctx = null) {
  const built = await buildAdminStoreOrdersPayload(request, env, { paginate: false, ctx });
  if (!built.ok) return built.response;
  const dateKey = getPlatformDateKey(env, new Date());
  return csvResponse(storeAttendeeRowsCsv(built.payload.fulfillments), `store-attendees-${dateKey}.csv`, env);
}

function storeOrderReconciliationReview(order = {}) {
  const reasons = [];
  const orderStatus = String(order.status || '').trim();
  const payment = order.payment || {};
  const paymentRequired = payment.required === true;
  const totalCents = Math.max(0, Number(order.totals?.totalCents || 0) || 0);
  const paymentAmountCents = Math.max(0, Number(payment.amountCents || 0) || 0);
  const orderCurrency = String(order.totals?.currency || '').trim().toUpperCase();
  const paymentCurrency = String(payment.currency || '').trim().toUpperCase();
  const paymentStatus = String(payment.status || '').trim();

  if (totalCents !== paymentAmountCents) reasons.push('amount_mismatch');
  if (orderCurrency && paymentCurrency && orderCurrency !== paymentCurrency) reasons.push('currency_mismatch');
  if (paymentRequired && orderStatus === STORE_ORDER_STATUS_CONFIRMED && paymentStatus !== 'succeeded') reasons.push('confirmed_without_succeeded_payment');
  if (paymentRequired && paymentStatus === 'succeeded' && orderStatus !== STORE_ORDER_STATUS_CONFIRMED) reasons.push('succeeded_payment_without_confirmed_order');
  if (!paymentRequired && totalCents > 0) reasons.push('free_order_has_total');
  if (!paymentRequired && paymentStatus && paymentStatus !== 'not_required') reasons.push('free_order_payment_status_unexpected');
  if (orderStatus === STORE_ORDER_STATUS_PAYMENT_FAILED && paymentStatus !== STORE_ORDER_STATUS_PAYMENT_FAILED) reasons.push('failed_order_payment_status_mismatch');
  if (orderStatus === STORE_ORDER_STATUS_PAYMENT_PENDING && paymentRequired) reasons.push('payment_pending');

  return {
    needsReview: reasons.length > 0,
    reasons
  };
}

function storeOrderReconciliationRowsCsv(orders = []) {
  const header = [
    'order_token',
    'status',
    'created_at',
    'confirmed_at',
    'failed_at',
    'customer_email',
    'customer_name',
    'total_cents',
    'payment_amount_cents',
    'amount_match',
    'currency',
    'payment_currency',
    'currency_match',
    'payment_required',
    'payment_provider',
    'payment_status',
    'payment_intent_id',
    'charge_id',
    'balance_transaction_id',
    'card_address_line1_check',
    'card_address_postal_code_check',
    'card_cvc_check',
    'card_network_status',
    'card_risk_level',
    'card_outcome_type',
    'email_sent',
    'fulfillment_types',
    'physical_quantity',
    'digital_quantity',
    'ticket_quantity',
    'checked_in_quantity',
    'needs_review',
    'review_reason'
  ];
  const csvRows = orders.map((order) => {
    const payment = order.payment || {};
    const totalCents = Math.max(0, Number(order.totals?.totalCents || 0) || 0);
    const paymentAmountCents = Math.max(0, Number(payment.amountCents || 0) || 0);
    const currency = String(order.totals?.currency || '').trim().toUpperCase();
    const paymentCurrency = String(payment.currency || '').trim().toUpperCase();
    const review = storeOrderReconciliationReview(order);
    return [
      order.orderToken,
      order.status,
      order.createdAt,
      order.confirmedAt,
      order.failedAt,
      order.customer?.email,
      order.customer?.name,
      totalCents,
      paymentAmountCents,
      totalCents === paymentAmountCents ? 'yes' : 'no',
      currency,
      paymentCurrency,
      !currency || !paymentCurrency || currency === paymentCurrency ? 'yes' : 'no',
      payment.required === true ? 'yes' : 'no',
      payment.provider,
      payment.status,
      payment.paymentIntentId,
      payment.chargeId,
      payment.balanceTransactionId,
      payment.cardChecks?.addressLine1Check || '',
      payment.cardChecks?.addressPostalCodeCheck || '',
      payment.cardChecks?.cvcCheck || '',
      payment.cardChecks?.networkStatus || '',
      payment.cardChecks?.riskLevel || '',
      payment.cardChecks?.outcomeType || '',
      order.emailSent ? 'yes' : 'no',
      Array.isArray(order.fulfillmentTypes) ? order.fulfillmentTypes.join('|') : '',
      order.counts?.physicalItems || 0,
      order.counts?.digitalItems || 0,
      order.counts?.ticketItems || 0,
      order.counts?.checkedInItems || 0,
      review.needsReview ? 'yes' : 'no',
      review.reasons.join('|')
    ];
  });
  return rebuildCsvReport({ header, rows: csvRows }).csv;
}

async function handleAdminStoreReconciliationCsv(request, env) {
  const built = await buildAdminStoreOrdersPayload(request, env, { paginate: false });
  if (!built.ok) return built.response;
  const dateKey = getPlatformDateKey(env, new Date());
  return csvResponse(storeOrderReconciliationRowsCsv(built.payload.orders), `store-reconciliation-${dateKey}.csv`, env);
}

function normalizeAdminAuditDate(value = '') {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function adminAuditExportPrefix(request) {
  const url = new URL(request.url);
  const date = normalizeAdminAuditDate(url.searchParams.get('date'));
  return date ? `admin-audit:${date}:` : 'admin-audit:';
}

async function listAdminAuditEventKeys(env, prefix = 'admin-audit:') {
  if (!env?.STORE_STATE?.list) {
    return { ok: false, status: 503, error: 'Audit storage unavailable' };
  }

  const keys = [];
  let cursor = undefined;
  let listCalls = 0;
  let truncated = false;
  do {
    const listing = await env.STORE_STATE.list({
      prefix,
      cursor,
      limit: 1000
    });
    listCalls += 1;
    keys.push(...(Array.isArray(listing?.keys) ? listing.keys : []));
    cursor = listing?.cursor;
    truncated = keys.length >= MAX_ADMIN_AUDIT_EXPORT_EVENTS || listCalls >= 20;
    if (listing?.list_complete !== false || !cursor || truncated) break;
  } while (true);

  return { ok: true, keys: keys.slice(0, MAX_ADMIN_AUDIT_EXPORT_EVENTS), listCalls, truncated };
}

function adminAuditStringList(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean).join('|')
    : String(value || '');
}

function adminAuditDetailsJson(event = {}) {
  const detail = { ...event };
  [
    'action',
    'createdAt',
    'adminEmail',
    'adminRole',
    'productId',
    'productIds',
    'variantId',
    'sku',
    'orderToken',
    'itemId',
    'fileKey',
    'githubPath',
    'githubPaths',
    'commitSha',
    'changedFields',
    'inventoryAction',
    'mutation',
    'rebuildTriggered',
    'expiresAt',
    'expiresHours',
    'checkedIn',
    'quantity'
  ].forEach((key) => {
    delete detail[key];
  });
  return Object.keys(detail).length ? JSON.stringify(detail) : '';
}

function adminAuditRowsCsv(rows = []) {
  const header = [
    'key',
    'created_at',
    'action',
    'admin_email',
    'admin_role',
    'product_id',
    'product_ids',
    'variant_id',
    'sku',
    'order_token',
    'item_id',
    'file_key',
    'github_path',
    'github_paths',
    'commit_sha',
    'changed_fields',
    'inventory_action',
    'mutation',
    'rebuild_triggered',
    'expires_at',
    'expires_hours',
    'checked_in',
    'quantity',
    'details_json'
  ];
  const csvRows = rows.map((row) => [
    row.key,
    row.createdAt,
    row.action,
    row.adminEmail,
    row.adminRole,
    row.productId,
    adminAuditStringList(row.productIds),
    row.variantId,
    row.sku,
    row.orderToken,
    row.itemId,
    row.fileKey,
    row.githubPath,
    adminAuditStringList(row.githubPaths),
    row.commitSha,
    adminAuditStringList(row.changedFields),
    row.inventoryAction,
    row.mutation,
    row.rebuildTriggered === true ? 'yes' : row.rebuildTriggered === false ? 'no' : '',
    row.expiresAt,
    row.expiresHours,
    row.checkedIn === true ? 'yes' : row.checkedIn === false ? 'no' : '',
    row.quantity,
    row.detailsJson
  ]);
  return rebuildCsvReport({ header, rows: csvRows }).csv;
}

async function buildAdminAuditExportRows(request, env) {
  const listed = await listAdminAuditEventKeys(env, adminAuditExportPrefix(request));
  if (!listed.ok) return listed;

  const rows = [];
  for (const key of listed.keys) {
    const keyName = String(key?.name || '').trim();
    if (!keyName) continue;
    const event = await env.STORE_STATE.get(keyName, { type: 'json' });
    if (!event || typeof event !== 'object') continue;
    rows.push({
      key: keyName,
      ...event,
      detailsJson: adminAuditDetailsJson(event)
    });
  }

  rows.sort((a, b) => {
    const byDate = String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    return byDate || String(b.key || '').localeCompare(String(a.key || ''));
  });

  return { ok: true, rows, page: { listed: listed.keys.length, returned: rows.length, listCalls: listed.listCalls, truncated: listed.truncated } };
}

async function handleAdminAuditCsv(request, env) {
  const auth = await requireAdminSession(request, env, 'store:read', { accessScope: STORE_ADMIN_SCOPE });
  if (!auth.ok) return auth.response;
  if (auth.user.role !== 'super_admin') {
    return privateJsonResponse({ error: 'Forbidden' }, 403, env);
  }

  const built = await buildAdminAuditExportRows(request, env);
  if (!built.ok) {
    return privateJsonResponse({ error: built.error || 'Audit export unavailable' }, built.status || 503, env);
  }

  const dateKey = getPlatformDateKey(env, new Date());
  return csvResponse(adminAuditRowsCsv(built.rows), `admin-audit-${dateKey}.csv`, env);
}

function normalizeAdminStoreCheckInIntent(body = {}, item = {}) {
  const action = String(body.action || '').trim().toLowerCase();
  const checkedIn = body.checkedIn === false || ['undo', 'reset', 'check_out', 'check-out', 'unchecked'].includes(action)
    ? false
    : true;
  const itemQuantity = getStoreItemQuantity(item);
  const parsedQuantity = Number.parseInt(String(body.quantity ?? itemQuantity), 10);
  const quantity = checkedIn
    ? Math.max(1, Math.min(itemQuantity, Number.isFinite(parsedQuantity) ? parsedQuantity : itemQuantity))
    : 0;
  return {
    checkedIn,
    quantity,
    note: String(body.note || '').trim().slice(0, 240)
  };
}

function normalizeAdminStoreDownloadAccessIntent(body = {}, _item = {}) {
  const requestedAction = String(body.action || '').trim().toLowerCase();
  const action = requestedAction === 'expire' ? 'revoke' : requestedAction;
  if (action !== 'revoke' && action !== 'reissue') {
    return { ok: false, error: 'Invalid download access action' };
  }
  return {
    ok: true,
    action
  };
}

async function handleAdminStoreOrderDownloadAccess(request, env, body = {}, ctx = null) {
  const auth = await requireAdminSession(request, env, 'fulfillment:manage', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;

  const orderToken = String(body.orderToken || '').trim();
  if (!STORE_ORDER_TOKEN_PATTERN.test(orderToken)) {
    return privateJsonResponse({ error: 'Invalid Store order token' }, 400, env);
  }
  const loaded = await loadStoreOrderForRead(env, orderToken);
  if (!loaded.ok) {
    return privateJsonResponse({ error: loaded.error }, loaded.status || 404, env);
  }
  if (!isStoreOrderFulfillmentReady(loaded.storedOrder)) {
    return privateJsonResponse({ error: 'Store order is not ready for fulfillment' }, 409, env);
  }

  const match = findStoreFulfillmentItem(loaded.storedOrder, body.itemId || '');
  if (!match || !isStoreDownloadItem(match.item)) {
    return privateJsonResponse({ error: 'Store digital download item not found' }, 404, env);
  }

  const intent = normalizeAdminStoreDownloadAccessIntent(body, match.item);
  if (!intent.ok) {
    return privateJsonResponse({ error: intent.error }, 400, env);
  }

  const now = new Date().toISOString();
  const previousRecords = getStoreDownloadAccessRecords(loaded.storedOrder);
  const previousRecord = previousRecords[match.itemId] && typeof previousRecords[match.itemId] === 'object'
    ? previousRecords[match.itemId]
    : {};
  const nextRecord = {
    ...buildStoreDownloadAccessRecord(intent.action, previousRecord, match.item, auth, now),
    itemId: match.itemId
  };
  const updatedOrder = {
    ...loaded.storedOrder,
    downloadAccess: {
      ...previousRecords,
      [match.itemId]: nextRecord
    },
    updatedAt: now
  };
  const storageKey = getStoreOrderStorageKey(orderToken);
  await env.STORE_STATE.put(storageKey, JSON.stringify(updatedOrder));
  invalidateAdminStoreOrderScanCache(env, ctx);
  const auditKey = await recordAdminAuditEvent(env, {
    action: 'store_order:download_access',
    adminEmail: auth.user.email,
    adminRole: auth.user.role,
    orderToken,
    itemId: match.itemId,
    mutation: intent.action,
    revokedAt: nextRecord.revokedAt || '',
    linkTtlSeconds: STORE_FULFILLMENT_TOKEN_TTL_SECONDS
  });

  const order = buildAdminStoreOrderRecord(updatedOrder);
  const item = order.items.find((entry) => entry.id === match.itemId) || null;
  return privateJsonResponse({
    success: true,
    message: intent.action === 'revoke' ? 'Download access revoked.' : 'Download access refreshed.',
    order,
    fulfillment: item ? buildAdminStoreFulfillmentRow(order, item) : null,
    mutation: {
      orderToken,
      itemId: match.itemId,
      action: intent.action,
      revokedAt: nextRecord.revokedAt || '',
      linkTtlSeconds: STORE_FULFILLMENT_TOKEN_TTL_SECONDS
    },
    auditKey,
    writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 2 })
  }, 200, env);
}

async function handleAdminStoreOrderCheckIn(request, env, body = {}, ctx = null) {
  const auth = await requireAdminSession(request, env, 'fulfillment:manage', {
    accessScope: STORE_ADMIN_SCOPE,
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;

  const orderToken = String(body.orderToken || '').trim();
  if (!STORE_ORDER_TOKEN_PATTERN.test(orderToken)) {
    return privateJsonResponse({ error: 'Invalid Store order token' }, 400, env);
  }
  const loaded = await loadStoreOrderForRead(env, orderToken);
  if (!loaded.ok) {
    return privateJsonResponse({ error: loaded.error }, loaded.status || 404, env);
  }
  if (!isStoreOrderFulfillmentReady(loaded.storedOrder)) {
    return privateJsonResponse({ error: 'Store order is not ready for fulfillment' }, 409, env);
  }

  const match = findStoreFulfillmentItem(loaded.storedOrder, body.itemId || '');
  if (!match || !isStoreTicketLikeItem(match.item)) {
    return privateJsonResponse({ error: 'Store ticket or RSVP item not found' }, 404, env);
  }

  const intent = normalizeAdminStoreCheckInIntent(body, match.item);
  const now = new Date().toISOString();
  const previousCheckIns = getStoreFulfillmentCheckIns(loaded.storedOrder);
  const previousRecord = previousCheckIns[match.itemId] && typeof previousCheckIns[match.itemId] === 'object'
    ? previousCheckIns[match.itemId]
    : {};
  const history = (Array.isArray(previousRecord.history) ? previousRecord.history : [])
    .slice(-9)
    .concat([{
      checkedIn: intent.checkedIn,
      quantity: intent.quantity,
      at: now,
      by: auth.user.email
    }]);
  const nextRecord = intent.checkedIn
    ? {
        ...previousRecord,
        itemId: match.itemId,
        checkedIn: true,
        quantity: intent.quantity,
        checkedInAt: previousRecord.checkedInAt || now,
        checkedInBy: previousRecord.checkedInBy || auth.user.email,
        checkedOutAt: '',
        checkedOutBy: '',
        updatedAt: now,
        updatedBy: auth.user.email,
        note: intent.note,
        history
      }
    : {
        ...previousRecord,
        itemId: match.itemId,
        checkedIn: false,
        quantity: 0,
        checkedInAt: '',
        checkedInBy: '',
        checkedOutAt: now,
        checkedOutBy: auth.user.email,
        updatedAt: now,
        updatedBy: auth.user.email,
        note: intent.note,
        history
      };
  const updatedOrder = {
    ...loaded.storedOrder,
    fulfillmentCheckIns: {
      ...previousCheckIns,
      [match.itemId]: nextRecord
    },
    updatedAt: now
  };
  const storageKey = getStoreOrderStorageKey(orderToken);
  await env.STORE_STATE.put(storageKey, JSON.stringify(updatedOrder));
  invalidateAdminStoreOrderScanCache(env, ctx);
  const auditKey = await recordAdminAuditEvent(env, {
    action: 'store_order:check_in',
    adminEmail: auth.user.email,
    adminRole: auth.user.role,
    orderToken,
    itemId: match.itemId,
    checkedIn: intent.checkedIn,
    quantity: intent.quantity
  });

  const order = buildAdminStoreOrderRecord(updatedOrder);
  const item = order.items.find((entry) => entry.id === match.itemId) || null;
  return privateJsonResponse({
    success: true,
    order,
    fulfillment: item ? buildAdminStoreFulfillmentRow(order, item) : null,
    auditKey,
    writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 2 })
  }, 200, env);
}

function formatIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createCheckoutNonce() {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function handleStoreCartValidate(request, env) {
  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const snapshot = await getEffectiveStoreCatalogSnapshot(env);
  const validation = validateStoreOrderDraft(parsedBody.body || {}, {
    env,
    snapshot,
    enforceSubmittedPrices: true,
    enforceInventory: false
  });
  let responseValidation = validation;
  let couponResult = { ok: true, coupon: null, discountCents: 0 };
  const couponCode = String(parsedBody.body?.couponCode || parsedBody.body?.coupon_code || '').trim();
  if (validation.valid && couponCode) {
    couponResult = await applyStoreCouponCode(env, couponCode, validation);
    if (couponResult.ok) {
      responseValidation = couponResult.validation;
    } else {
      responseValidation = {
        ...validation,
        valid: false,
        errors: [
          ...(validation.errors || []),
          {
            code: couponResult.code || 'coupon_invalid',
            message: couponResult.error || 'Coupon code is invalid.',
            couponCode: couponResult.couponCode || couponCode
          }
        ]
      };
    }
  }
  const status = responseValidation.valid ? 200 : (couponResult.status || 422);

  return privateJsonResponse({
    ok: responseValidation.valid,
    coupon: couponResult.ok ? couponResult.coupon : null,
    ...responseValidation
  }, status, env);
}

async function handleStoreCheckoutIntent(request, env, ctx = null) {
  if (getCheckoutProvider(env) !== 'first_party') {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  const trustedOrigin = requireTrustedSiteOrigin(request, env);
  if (!trustedOrigin.ok) return trustedOrigin.response;

  const rateLimit = await checkRateLimit(request, env, {
    ...RATE_LIMITS.start,
    privateResponse: true
  });
  if (!rateLimit.allowed) return rateLimit.response;

  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body || {};

  const email = String(body?.customer?.email || body?.email || '').trim();
  if (email && !isValidEmail(email)) {
    return privateJsonResponse({ error: 'Invalid email format' }, 400, env);
  }
  const wantsAbandonedCartReminder = body.abandonedCartConsent === true ||
    String(body.abandonedCartConsent || '').trim().toLowerCase() === 'true';
  const abandonedCartEmail = normalizeAbandonedCartEmail(email);
  if (wantsAbandonedCartReminder && !abandonedCartEmail) {
    return privateJsonResponse({ error: 'Email is required for a checkout reminder.' }, 400, env);
  }

  const normalizedPreferredLang = normalizePreferredLang(body.preferredLang || body.lang);
  const normalizedShippingAddress = body.shippingAddress
    ? normalizeShippingDestination(body.shippingAddress)
    : { valid: false, destination: null };
  if (body.shippingAddress && !normalizedShippingAddress.valid) {
    return privateJsonResponse({ error: normalizedShippingAddress.error }, 400, env);
  }

  const normalizedBillingAddress = body.billingAddress
    ? normalizeTaxDestination(body.billingAddress)
    : { valid: false, destination: null };
  if (body.billingAddress && !normalizedBillingAddress.valid) {
    return privateJsonResponse({ error: normalizedBillingAddress.error }, 400, env);
  }

  if (!env.STORE_STATE) {
    return privateJsonResponse({ error: 'Order storage unavailable' }, 503, env);
  }

  const orderToken = `store-order-${createCheckoutNonce()}`;
  const storeCatalogSnapshot = await getEffectiveStoreCatalogSnapshot(env);
  let validation = validateStoreOrderDraft(body, {
    env,
    snapshot: storeCatalogSnapshot,
    enforceSubmittedPrices: true,
    enforceInventory: false
  });
  const couponCode = String(body.couponCode || body.coupon_code || '').trim();
  if (validation.valid && couponCode) {
    const couponResult = await applyStoreCouponCode(env, couponCode, validation);
    if (!couponResult.ok) {
      return privateJsonResponse({
        ok: false,
        code: couponResult.code || 'coupon_invalid',
        error: couponResult.error || 'Coupon code is invalid.',
        couponCode: couponResult.couponCode || couponCode
      }, couponResult.status || 422, env);
    }
    validation = couponResult.validation;
  }
  const submittedShippingCents = Math.max(0, Number(body.shippingCents) || 0);
  const validatedTaxableSubtotalCents = getValidationTaxableSubtotalCents(validation);
  const normalizedShippingTaxAddress = body.shippingAddress
    ? normalizeTaxDestination(body.shippingAddress)
    : { valid: false, destination: null };
  const taxDestination = normalizedBillingAddress.valid
    ? normalizedBillingAddress.destination
    : (normalizedShippingTaxAddress.valid ? normalizedShippingTaxAddress.destination : null);
  let computedTaxCents = Math.max(0, Number(body.taxCents) || 0);
  if (taxDestination && validatedTaxableSubtotalCents > 0) {
    try {
      const taxQuote = await quoteTax(env, {
        subtotalCents: validatedTaxableSubtotalCents,
        shippingCents: submittedShippingCents,
        destination: taxDestination
      });
      computedTaxCents = Math.max(0, Number(taxQuote.taxCents) || 0);
    } catch (error) {
      return privateJsonResponse({
        error: error instanceof Error ? error.message : 'Tax quote failed'
      }, 503, env);
    }
  }
  const draftResult = buildStoreOrderDraft(body, {
    env,
    validation,
    orderToken,
    preferredLang: normalizedPreferredLang,
    email,
    shippingAddress: body.shippingAddress || normalizedShippingAddress.destination,
    billingAddress: normalizedBillingAddress.valid ? normalizedBillingAddress.destination : null,
    shippingCents: submittedShippingCents,
    taxCents: computedTaxCents,
    tipPercent: body.tipPercent,
    shippingOption: body.shippingOption || 'standard',
    enforceSubmittedPrices: true,
    enforceInventory: false
  });

  if (!draftResult.ok) {
    return privateJsonResponse({
      ok: false,
      error: draftResult.error,
      ...draftResult.validation
    }, draftResult.status || 422, env);
  }

  const orderHash = await hashStoreOrderDraft(draftResult.orderDraft);
  const orderDraft = {
    ...draftResult.orderDraft,
    orderHash
  };
  const challenge = orderDraft.totals.requiresTurnstile
    ? await verifyTurnstile(request, env, body.turnstileToken || body['cf-turnstile-response'], {
        action: 'store_order',
        secretEnvNames: ['STORE_ORDER_TURNSTILE_SECRET_KEY', 'TURNSTILE_SECRET_KEY'],
        requiredEnvName: 'STORE_ORDER_TURNSTILE_REQUIRED',
        bypassEnvName: 'STORE_ORDER_TURNSTILE_BYPASS'
      })
    : { ok: true };
  if (!challenge.ok) {
    return privateJsonResponse({
      ok: false,
      code: challenge.code,
      error: challenge.error
    }, challenge.status || 400, env);
  }

  const storeOrderStorageKey = getStoreOrderStorageKey(orderToken);
  const buildStoredOrderBase = (inventoryReservationResult = null) => {
    const base = {
      version: STORE_ORDER_DRAFT_VERSION,
      orderToken,
      orderHash,
      checkoutProvider: 'first_party',
      createdAt: orderDraft.createdAt,
      expiresAt: orderDraft.expiresAt,
      validationWarnings: draftResult.validation.warnings || []
    };
    if (inventoryReservationResult?.reservation) {
      base.inventoryReservation = inventoryReservationResult.reservation;
    }
    return base;
  };
  const abandonedCartReminder = wantsAbandonedCartReminder ? {
    consent: true,
    email: abandonedCartEmail,
    preferredLang: normalizedPreferredLang,
    amountCents: orderDraft.totals.totalCents,
    itemCount: orderDraft.totals.itemCount
  } : null;

  if (!orderDraft.totals.requiresPayment) {
    const inventoryReservationResult = await saveStoreInventoryReservation(env, orderToken, draftResult.validation.items);
    if (!inventoryReservationResult?.success) {
      return privateJsonResponse({
        error: inventoryReservationResult?.error || 'Store inventory reservation failed',
        remaining: inventoryReservationResult?.remaining
      }, inventoryReservationResult?.status || 409, env);
    }

    const confirmedAt = new Date().toISOString();
    const inventoryCommit = await confirmOrClaimStoreInventoryReservation(
      env,
      orderToken,
      inventoryReservationResult.reservation
    );
    if (!inventoryCommit?.success) {
      await releaseStoreInventoryReservationQuietly(
        env,
        orderToken,
        'failed free Store order inventory commit',
        inventoryReservationResult.reservation
      );
      return privateJsonResponse({
        error: inventoryCommit?.error || 'Store inventory commit failed',
        remaining: inventoryCommit?.remaining
      }, inventoryCommit?.status || 409, env);
    }

    const storedOrderBase = buildStoredOrderBase(inventoryReservationResult);
    if (inventoryCommit.reservation) {
      storedOrderBase.inventoryReservation = inventoryCommit.reservation;
    }
    const confirmedOrderDraft = {
      ...orderDraft,
      status: STORE_ORDER_STATUS_CONFIRMED,
      confirmedAt
    };
    const storedOrder = {
      ...storedOrderBase,
      status: STORE_ORDER_STATUS_CONFIRMED,
      confirmedAt,
      orderDraft: confirmedOrderDraft,
      ...(abandonedCartReminder ? { abandonedCart: abandonedCartReminder } : {}),
      payment: {
        required: false,
        provider: null,
        status: 'not_required'
      }
    };

    await env.STORE_STATE.put(
      storeOrderStorageKey,
      JSON.stringify(storedOrder)
    );
    invalidateAdminStoreOrderScanCache(env, ctx);
    queueStoreOrderEmailIndexUpsert(ctx, env, storedOrder);
    queueStoreOrderEmailDeliveries(ctx, env, storedOrder);
    queueStoreEventRemindersQuietly(ctx, env, storedOrder);

    return privateJsonResponse({
      ok: true,
      checkoutProvider: 'first_party',
      orderToken,
      orderHash,
      orderDraft: confirmedOrderDraft,
      totals: confirmedOrderDraft.totals,
      requiresPayment: false,
      requiresShipping: confirmedOrderDraft.totals.requiresShipping,
      requiresTurnstile: confirmedOrderDraft.totals.requiresTurnstile,
      nextAction: 'order_confirmed',
      payment: storedOrder.payment,
      warnings: draftResult.validation.warnings,
      expiresAt: confirmedOrderDraft.expiresAt
    }, 200, env);
  }

  const stripeSecretKey = getStripeKey(env);
  const stripePublishableKey = getStripePublishableKey(env);
  const stripeKeyValidation = validateStripeCheckoutKeyPair(env, stripeSecretKey, stripePublishableKey);
  if (!stripeKeyValidation.ok) {
    console.error('Stripe Store checkout configuration error:', stripeKeyValidation.log);
    return privateJsonResponse({
      error: stripeKeyValidation.error || 'Stripe checkout is not configured'
    }, stripeKeyValidation.status || 503, env);
  }

  const inventoryReservationResult = await saveStoreInventoryReservation(env, orderToken, draftResult.validation.items);
  if (!inventoryReservationResult?.success) {
    return privateJsonResponse({
      error: inventoryReservationResult?.error || 'Store inventory reservation failed',
      remaining: inventoryReservationResult?.remaining
    }, inventoryReservationResult?.status || 409, env);
  }

  const pendingOrderDraft = {
    ...orderDraft,
    status: STORE_ORDER_STATUS_PAYMENT_PENDING
  };
  const storedOrderBase = buildStoredOrderBase(inventoryReservationResult);
  const pendingStoredOrder = {
    ...storedOrderBase,
    status: STORE_ORDER_STATUS_DRAFT,
    orderDraft,
    ...(abandonedCartReminder ? { abandonedCart: abandonedCartReminder } : {}),
    payment: {
      required: true,
      provider: 'stripe',
      status: 'not_created',
      amountCents: orderDraft.totals.totalCents,
      currency: orderDraft.currency
    }
  };

  await env.STORE_STATE.put(
    storeOrderStorageKey,
    JSON.stringify(pendingStoredOrder),
    { expirationTtl: STORE_ORDER_DRAFT_TTL_SECONDS }
  );

  const stripe = createStripeClient(stripeSecretKey);
  const paymentIntentParams = {
    amount: pendingOrderDraft.totals.totalCents,
    currency: pendingOrderDraft.currency.toLowerCase(),
    automatic_payment_methods: {
      enabled: true
    },
    metadata: {
      orderToken,
      orderHash,
      checkoutProvider: 'first_party',
      storeOrderVersion: String(STORE_ORDER_DRAFT_VERSION),
      email: pendingOrderDraft.customer.email || '',
      itemCount: String(pendingOrderDraft.totals.itemCount),
      couponCode: String(pendingOrderDraft.totals.couponCode || ''),
      discountCents: String(pendingOrderDraft.totals.discountCents || 0),
      tipPercent: String(pendingOrderDraft.totals.tipPercent || 0),
      tipAmountCents: String(pendingOrderDraft.totals.tipAmountCents || 0),
      requiresShipping: pendingOrderDraft.totals.requiresShipping ? 'true' : 'false',
      requiresTurnstile: pendingOrderDraft.totals.requiresTurnstile ? 'true' : 'false'
    }
  };
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(paymentIntentParams, {
      idempotencyKey: `store-order:${orderToken}`
    });
  } catch (stripeErr) {
    await env.STORE_STATE.delete(storeOrderStorageKey);
    await releaseStoreInventoryReservationQuietly(
      env,
      orderToken,
      'Stripe Store PaymentIntent creation failure',
      inventoryReservationResult.reservation
    );
    console.error('Stripe Store PaymentIntent error:', stripeErrorLogContext(stripeErr));
    return privateJsonResponse({ error: 'Failed to create payment intent' }, 500, env);
  }

  if (paymentIntent?.error || !paymentIntent?.id || !paymentIntent?.client_secret) {
    await env.STORE_STATE.delete(storeOrderStorageKey);
    await releaseStoreInventoryReservationQuietly(
      env,
      orderToken,
      'invalid Stripe Store PaymentIntent response',
      inventoryReservationResult.reservation
    );
    console.error('Stripe Store PaymentIntent error:', stripeErrorLogContext(paymentIntent?.error || paymentIntent));
    return privateJsonResponse({ error: 'Failed to create payment intent' }, 500, env);
  }

  const storedOrder = {
    ...storedOrderBase,
    status: STORE_ORDER_STATUS_PAYMENT_PENDING,
    orderDraft: pendingOrderDraft,
    ...(abandonedCartReminder ? { abandonedCart: abandonedCartReminder } : {}),
    payment: {
      required: true,
      provider: 'stripe',
      status: String(paymentIntent.status || 'requires_payment_method'),
      paymentIntentId: paymentIntent.id,
      amountCents: pendingOrderDraft.totals.totalCents,
      currency: pendingOrderDraft.currency
    }
  };

  await env.STORE_STATE.put(
    storeOrderStorageKey,
    JSON.stringify(storedOrder),
    { expirationTtl: STORE_ORDER_DRAFT_TTL_SECONDS }
  );
  invalidateAdminStoreOrderScanCache(env, ctx);
  if (abandonedCartReminder) {
    queueAbandonedCheckoutFollowupQuietly(ctx, env, storedOrder);
  }

  return privateJsonResponse({
    ok: true,
    checkoutProvider: 'first_party',
    checkoutUiMode: 'payment_intent',
    orderToken,
    orderHash,
    orderDraft: pendingOrderDraft,
    totals: pendingOrderDraft.totals,
    requiresPayment: true,
    requiresShipping: pendingOrderDraft.totals.requiresShipping,
    requiresTurnstile: pendingOrderDraft.totals.requiresTurnstile,
    nextAction: 'confirm_payment',
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
    publishableKey: stripePublishableKey,
    payment: storedOrder.payment,
    warnings: draftResult.validation.warnings,
    expiresAt: pendingOrderDraft.expiresAt
  }, 200, env);
}

function buildStoreShippingTierSelection(validation = {}) {
  return {
    selectedTiers: (validation.items || [])
      .filter((item) => item.shippable === true)
      .map((item) => ({
        qty: Number(item.quantity || 0) || 0,
        tier: {
          id: item.sku || item.variantId || item.productId || 'store-item',
          category: 'physical',
          shipping: item.shipping || null
        }
      }))
  };
}

function getStorePaymentIntentMetadata(paymentIntent = {}) {
  const metadata = paymentIntent?.metadata && typeof paymentIntent.metadata === 'object'
    ? paymentIntent.metadata
    : {};

  return {
    orderToken: String(metadata.orderToken || '').trim(),
    orderHash: String(metadata.orderHash || '').trim(),
    checkoutProvider: String(metadata.checkoutProvider || '').trim(),
    storeOrderVersion: String(metadata.storeOrderVersion || '').trim(),
    email: String(metadata.email || '').trim()
  };
}

function isStorePaymentIntent(paymentIntent = {}) {
  const metadata = getStorePaymentIntentMetadata(paymentIntent);
  return metadata.checkoutProvider === 'first_party' && metadata.orderToken.startsWith('store-order-');
}

function storePaymentIntentAmountCents(paymentIntent = {}) {
  return Math.trunc(Number(paymentIntent?.amount ?? 0) || 0);
}

function storePaymentIntentCurrency(paymentIntent = {}) {
  return String(paymentIntent?.currency || '').trim().toUpperCase();
}

function getStorePaymentFailureMessage(paymentIntent = {}) {
  const error = paymentIntent?.last_payment_error;
  if (!error) return 'Payment failed';
  return String(error.message || error.code || error.type || 'Payment failed').trim() || 'Payment failed';
}

function storeOrderSettlementError(error, status = 409, outcome = 'store_order_rejected', orderToken = '') {
  return {
    ok: false,
    status,
    error,
    outcome,
    orderToken
  };
}

async function loadStorePaymentOrder(env, orderToken) {
  if (!env.STORE_STATE) {
    return storeOrderSettlementError('Order storage unavailable', 503, 'store_order_storage_unavailable', orderToken);
  }

  const storageKey = getStoreOrderStorageKey(orderToken);
  if (!storageKey) {
    return storeOrderSettlementError('Missing Store order token', 400, 'store_order_rejected', orderToken);
  }

  const storedOrder = await env.STORE_STATE.get(storageKey, { type: 'json' });
  if (!storedOrder) {
    return storeOrderSettlementError('Store order not found', 404, 'store_order_not_found', orderToken);
  }

  return {
    ok: true,
    storageKey,
    storedOrder
  };
}

function validateStorePaymentIntentForOrder(paymentIntent = {}, storedOrder = {}, metadata = {}) {
  const orderToken = metadata.orderToken;
  if (metadata.storeOrderVersion && metadata.storeOrderVersion !== String(STORE_ORDER_DRAFT_VERSION)) {
    return storeOrderSettlementError('Store order version mismatch', 409, 'store_order_rejected', orderToken);
  }

  if (storedOrder.checkoutProvider !== 'first_party') {
    return storeOrderSettlementError('Store order provider mismatch', 409, 'store_order_rejected', orderToken);
  }

  if (String(storedOrder.orderToken || '') !== orderToken) {
    return storeOrderSettlementError('Store order token mismatch', 409, 'store_order_rejected', orderToken);
  }

  if (metadata.orderHash && String(storedOrder.orderHash || '') !== metadata.orderHash) {
    return storeOrderSettlementError('Store order hash mismatch', 409, 'store_order_rejected', orderToken);
  }

  if (metadata.orderHash && String(storedOrder.orderDraft?.orderHash || '') !== metadata.orderHash) {
    return storeOrderSettlementError('Store order draft hash mismatch', 409, 'store_order_rejected', orderToken);
  }

  const expectedPaymentIntentId = String(storedOrder.payment?.paymentIntentId || '').trim();
  const actualPaymentIntentId = stripeObjectId(paymentIntent);
  if (!expectedPaymentIntentId || !actualPaymentIntentId || expectedPaymentIntentId !== actualPaymentIntentId) {
    return storeOrderSettlementError('Store PaymentIntent mismatch', 409, 'store_order_rejected', orderToken);
  }

  const expectedAmountCents = Math.trunc(Number(
    storedOrder.payment?.amountCents ?? storedOrder.orderDraft?.totals?.totalCents ?? 0
  ) || 0);
  const actualAmountCents = storePaymentIntentAmountCents(paymentIntent);
  if (expectedAmountCents !== actualAmountCents) {
    return storeOrderSettlementError('Store PaymentIntent amount mismatch', 409, 'store_order_rejected', orderToken);
  }

  const expectedCurrency = String(storedOrder.payment?.currency || storedOrder.orderDraft?.currency || '').trim().toUpperCase();
  const actualCurrency = storePaymentIntentCurrency(paymentIntent);
  if (expectedCurrency && actualCurrency && expectedCurrency !== actualCurrency) {
    return storeOrderSettlementError('Store PaymentIntent currency mismatch', 409, 'store_order_rejected', orderToken);
  }

  return { ok: true };
}

function buildStorePaymentSnapshot(storedOrder = {}, paymentIntent = {}, status, settledAt) {
  const financials = extractStripePaymentIntentFinancials(paymentIntent);
  const cardChecks = extractStripePaymentIntentCardChecks(paymentIntent);
  const payment = {
    ...(storedOrder.payment || {}),
    required: true,
    provider: 'stripe',
    status,
    paymentIntentId: stripeObjectId(paymentIntent),
    amountCents: storePaymentIntentAmountCents(paymentIntent),
    currency: storePaymentIntentCurrency(paymentIntent) || storedOrder.payment?.currency || storedOrder.orderDraft?.currency || 'USD'
  };

  if (status === 'succeeded') {
    payment.confirmedAt = settledAt;
    delete payment.failedAt;
    delete payment.lastPaymentError;
  }
  if (status === 'payment_failed') {
    payment.failedAt = settledAt;
    payment.lastPaymentError = getStorePaymentFailureMessage(paymentIntent);
    delete payment.confirmedAt;
  }
  if (financials) {
    payment.stripeFinancials = financials;
    if (financials.chargeId) payment.chargeId = financials.chargeId;
    if (financials.balanceTransactionId) payment.balanceTransactionId = financials.balanceTransactionId;
  }
  if (cardChecks) {
    payment.cardChecks = cardChecks;
  }

  return {
    payment,
    financials
  };
}

async function confirmStorePaymentIntentOrder(paymentIntent, env, ctx = null) {
  const metadata = getStorePaymentIntentMetadata(paymentIntent);
  const loaded = await loadStorePaymentOrder(env, metadata.orderToken);
  if (!loaded.ok) return loaded;

  const validation = validateStorePaymentIntentForOrder(paymentIntent, loaded.storedOrder, metadata);
  if (!validation.ok) return validation;

  if (String(paymentIntent?.status || '') !== 'succeeded') {
    return storeOrderSettlementError('Store PaymentIntent has not succeeded', 409, 'store_order_rejected', metadata.orderToken);
  }

  const alreadyConfirmed = loaded.storedOrder.status === STORE_ORDER_STATUS_CONFIRMED;
  const confirmedAt = loaded.storedOrder.confirmedAt || new Date().toISOString();
  const inventoryCommit = alreadyConfirmed
    ? { success: true, reservation: loaded.storedOrder.inventoryReservation || null }
    : await confirmOrClaimStoreInventoryReservation(
        env,
        metadata.orderToken,
        loaded.storedOrder.inventoryReservation
      );
  if (!inventoryCommit?.success) {
    return storeOrderSettlementError(
      inventoryCommit?.error || 'Store inventory commit failed',
      inventoryCommit?.status || 409,
      'store_order_inventory_rejected',
      metadata.orderToken
    );
  }

  const settlementPaymentIntent = await enrichStripePaymentIntentForSettlement(paymentIntent, env);
  const snapshot = buildStorePaymentSnapshot(loaded.storedOrder, settlementPaymentIntent, 'succeeded', confirmedAt);
  const paymentCustomer = extractStorePaymentIntentCustomer(settlementPaymentIntent);
  const updatedOrder = {
    ...loaded.storedOrder,
    status: STORE_ORDER_STATUS_CONFIRMED,
    confirmedAt,
    updatedAt: new Date().toISOString(),
    orderDraft: {
      ...(loaded.storedOrder.orderDraft || {}),
      customer: mergeStoreOrderCustomer(loaded.storedOrder, paymentCustomer),
      status: STORE_ORDER_STATUS_CONFIRMED,
      confirmedAt
    },
    payment: snapshot.payment,
    stripePaymentIntentId: snapshot.payment.paymentIntentId
  };
  if (snapshot.financials?.chargeId) updatedOrder.stripeChargeId = snapshot.financials.chargeId;
  if (snapshot.financials?.balanceTransactionId) updatedOrder.stripeBalanceTransactionId = snapshot.financials.balanceTransactionId;
  if (inventoryCommit.reservation) updatedOrder.inventoryReservation = inventoryCommit.reservation;
  delete updatedOrder.failedAt;
  delete updatedOrder.orderDraft.failedAt;

  await env.STORE_STATE.put(loaded.storageKey, JSON.stringify(updatedOrder));
  invalidateAdminStoreOrderScanCache(env, ctx);
  await deleteAbandonedCheckoutFollowup(env, metadata.orderToken, { reason: 'completed' });
  queueStoreOrderEmailIndexUpsert(ctx, env, updatedOrder);
  queueStoreOrderEmailDeliveries(ctx, env, updatedOrder);
  queueStoreEventRemindersQuietly(ctx, env, updatedOrder);

  return {
    ok: true,
    status: 200,
    outcome: alreadyConfirmed ? 'store_order_already_confirmed' : 'store_order_confirmed',
    orderToken: metadata.orderToken,
    response: {
      received: true,
      storeOrder: 'confirmed'
    }
  };
}

async function failStorePaymentIntentOrder(paymentIntent, env, ctx = null) {
  const metadata = getStorePaymentIntentMetadata(paymentIntent);
  const loaded = await loadStorePaymentOrder(env, metadata.orderToken);
  if (!loaded.ok) return loaded;

  const validation = validateStorePaymentIntentForOrder(paymentIntent, loaded.storedOrder, metadata);
  if (!validation.ok) return validation;

  if (loaded.storedOrder.status === STORE_ORDER_STATUS_CONFIRMED) {
    return {
      ok: true,
      status: 200,
      outcome: 'store_order_already_confirmed',
      orderToken: metadata.orderToken,
      response: {
        received: true,
        storeOrder: 'confirmed'
      }
    };
  }

  const failedAt = new Date().toISOString();
  const inventoryRelease = await releaseStoreInventoryReservationQuietly(
    env,
    metadata.orderToken,
    'failed Store payment inventory reservation',
    loaded.storedOrder.inventoryReservation
  );
  const settlementPaymentIntent = await enrichStripePaymentIntentForSettlement(paymentIntent, env);
  const snapshot = buildStorePaymentSnapshot(loaded.storedOrder, settlementPaymentIntent, 'payment_failed', failedAt);
  const updatedOrder = {
    ...loaded.storedOrder,
    status: STORE_ORDER_STATUS_PAYMENT_FAILED,
    failedAt,
    updatedAt: failedAt,
    orderDraft: {
      ...(loaded.storedOrder.orderDraft || {}),
      status: STORE_ORDER_STATUS_PAYMENT_FAILED,
      failedAt
    },
    payment: snapshot.payment,
    stripePaymentIntentId: snapshot.payment.paymentIntentId
  };
  if (snapshot.financials?.chargeId) updatedOrder.stripeChargeId = snapshot.financials.chargeId;
  if (snapshot.financials?.balanceTransactionId) updatedOrder.stripeBalanceTransactionId = snapshot.financials.balanceTransactionId;
  if (inventoryRelease?.reservation) updatedOrder.inventoryReservation = inventoryRelease.reservation;

  await env.STORE_STATE.put(
    loaded.storageKey,
    JSON.stringify(updatedOrder),
    { expirationTtl: STORE_ORDER_DRAFT_TTL_SECONDS }
  );
  invalidateAdminStoreOrderScanCache(env, ctx);

  return {
    ok: true,
    status: 200,
    outcome: 'store_order_payment_failed',
    orderToken: metadata.orderToken,
    response: {
      received: true,
      storeOrder: 'payment_failed'
    }
  };
}

async function handleShippingQuote(request, env) {
  const trustedOrigin = requireTrustedSiteOrigin(request, env);
  if (!trustedOrigin.ok) return trustedOrigin.response;

  const rateLimit = await checkRateLimit(request, env, RATE_LIMITS.shipping);
  if (!rateLimit.allowed) return rateLimit.response;

  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    privateResponse: true
  });
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body;

  const normalizedDestination = normalizeShippingDestination(
    body?.shippingAddress || body?.destination || body?.address || {}
  );
  if (!normalizedDestination.valid) {
    return privateJsonResponse({ error: normalizedDestination.error }, 400, env);
  }

  const storeCatalogSnapshot = await getEffectiveStoreCatalogSnapshot(env);
  const validation = validateStoreOrderDraft(body || {}, {
    env,
    snapshot: storeCatalogSnapshot,
    enforceSubmittedPrices: true,
    enforceInventory: false
  });
  if (!validation.valid) {
    return privateJsonResponse({
      ok: false,
      error: 'Store cart is invalid.',
      validation
    }, 422, env);
  }

  if (!validation.totals.requiresShipping) {
    return privateJsonResponse({
      quotes: [],
      totalShippingCents: 0,
      shippingAddress: normalizedDestination.destination
    }, 200, env);
  }

  const quote = await quoteStoreShipment(
    env,
    buildStoreShippingTierSelection(validation),
    normalizedDestination.destination,
    [],
    body?.shippingOption || 'standard',
    []
  );
  if (!quote.valid) {
    return privateJsonResponse({ error: quote.error }, 400, env);
  }

  const quotes = [{
    scope: 'store',
    shippingCents: quote.quote.shippingCents,
    source: quote.quote.source,
    carrier: quote.quote.carrier,
    service: quote.quote.service,
    domestic: quote.quote.domestic,
    availableOptions: quote.availableOptions,
    defaultOption: quote.defaultOption,
    selectedOption: quote.selectedOption,
    shipment: quote.shipment
  }];

  return privateJsonResponse({
    quotes,
    totalShippingCents: quotes.reduce((sum, quote) => sum + (Number(quote.shippingCents) || 0), 0),
    shippingAddress: normalizedDestination.destination
  }, 200, env);
}

async function handleTaxQuote(request, env) {
  const trustedOrigin = requireTrustedSiteOrigin(request, env);
  if (!trustedOrigin.ok) return trustedOrigin.response;

  const rateLimit = await checkRateLimit(request, env, RATE_LIMITS.tax);
  if (!rateLimit.allowed) return rateLimit.response;

  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    privateResponse: true
  });
  if (!parsedBody.ok) return parsedBody.response;

  const body = parsedBody.body || {};
  const subtotalCents = Math.max(0, Number(body.subtotalCents) || 0);
  const shippingCents = Math.max(0, Number(body.shippingCents) || 0);

  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) {
    return privateJsonResponse({ error: 'Subtotal is required' }, 400, env);
  }

  const normalizedBillingAddress = body.billingAddress
    ? normalizeTaxDestination(body.billingAddress)
    : { valid: false, destination: null };
  if (body.billingAddress && !normalizedBillingAddress.valid) {
    return privateJsonResponse({ error: normalizedBillingAddress.error }, 400, env);
  }

  const normalizedShippingTaxAddress = body.shippingAddress
    ? normalizeTaxDestination(body.shippingAddress)
    : { valid: false, destination: null };
  if (body.shippingAddress && !normalizedShippingTaxAddress.valid) {
    return privateJsonResponse({ error: normalizedShippingTaxAddress.error }, 400, env);
  }

  const taxDestination = normalizedBillingAddress.valid
    ? normalizedBillingAddress.destination
    : (normalizedShippingTaxAddress.valid ? normalizedShippingTaxAddress.destination : null);
  if (!taxDestination) {
    return privateJsonResponse({ error: 'Billing or shipping address is required to calculate tax' }, 400, env);
  }

  try {
    const taxQuote = await quoteTax(env, {
      subtotalCents,
      shippingCents,
      destination: taxDestination
    });

    return privateJsonResponse({
      subtotalCents,
      shippingCents,
      taxCents: taxQuote.taxCents,
      taxDetails: sanitizeStoredTaxDetails(taxQuote, {
        destination: taxDestination,
        taxableSubtotalCents: subtotalCents,
        taxableShippingCents: 0,
        shippingTaxed: false,
        shippingCents
      }),
      destination: taxDestination
    }, 200, env);
  } catch (error) {
    return privateJsonResponse({
      error: error instanceof Error ? error.message : 'Tax quote failed'
    }, 503, env);
  }
}

async function handleStripeWebhook(request, env, ctx) {
  console.log('📨 Stripe webhook received');
  const startedAt = Date.now();
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');
  let observedEventId = '';
  let observedEventType = 'unknown';
  let observedOrderId = '';
  const finishWebhook = (response, outcome, extra = {}) => {
    queueBackgroundTask(
      ctx,
      recordWebhookObservation(env, {
        outcome,
        eventId: extra.eventId ?? observedEventId,
        eventType: extra.eventType ?? observedEventType,
        orderId: extra.orderId ?? observedOrderId,
        status: response?.status || 0,
        durationMs: Date.now() - startedAt
      }),
      `webhook observation (${outcome})`
    );
    return response;
  };

  // SEC-002: Early mode detection from raw payload to avoid signature mismatch
  // When prod worker (live mode) receives test events, the signature won't verify
  // because test events are signed with a different secret. Parse livemode early
  // and acknowledge if it doesn't match our environment.
  try {
    const parsed = JSON.parse(body);
    const isLiveEvent = parsed.livemode === true;
    const isLiveMode = getAppMode(env) === 'live';
    if (isLiveEvent !== isLiveMode) {
      console.log('📨 Skipping event (mode mismatch, pre-verification):', { 
        eventId: parsed.id, 
        eventType: parsed.type,
        isLiveEvent, 
        isLiveMode 
      });
      return finishWebhook(
        jsonResponse({ received: true, skipped: 'mode mismatch' }, 200),
        'mode_mismatch',
        {
          eventId: parsed.id,
          eventType: parsed.type
        }
      );
    }
  } catch (parseErr) {
    console.error('📨 Failed to parse webhook body for mode check:', parseErr.message);
    // Continue to signature verification which will fail properly
  }

  // SEC-002: Webhooks must fail closed when signing secrets are missing.
  // Mode mismatches are acknowledged above; everything else needs a configured
  // secret so forged payloads cannot be treated as successfully received.
  const webhookSecret = getStripeWebhookSecret(env);
  if (!webhookSecret) {
    console.error('Stripe webhook secret not configured for this mode; rejecting webhook');
    return finishWebhook(
      jsonResponse({ error: 'Webhook secret not configured' }, 500),
      'secret_missing'
    );
  }

  const { valid, error } = await verifyStripeSignature(body, sig, webhookSecret);
  if (!valid) {
    console.error('Webhook signature verification failed:', error);
    return finishWebhook(jsonResponse({ error: 'Invalid signature' }, 401), 'invalid_signature');
  }

  const event = JSON.parse(body);
  observedEventId = String(event?.id || '').trim();
  observedEventType = String(event?.type || 'unknown').trim() || 'unknown';
  console.log('📨 Event type:', event.type);

  const eventKey = env.STORE_STATE ? `stripe-event:${event.id}` : null;
  const markStripeEventProcessed = async () => {
    if (env.STORE_STATE && eventKey) {
      await env.STORE_STATE.put(eventKey, 'processed', { expirationTtl: 86400 });
    }
  };

  // Idempotency: skip if we've already processed this event
  if (env.STORE_STATE && eventKey) {
    const alreadyProcessed = await env.STORE_STATE.get(eventKey);
    if (alreadyProcessed) {
      console.log('📨 Skipping duplicate event:', event.id);
      return finishWebhook(jsonResponse({ received: true }), 'duplicate_event');
    }
  }

  if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object;
    if (isStorePaymentIntent(paymentIntent)) {
      const metadata = getStorePaymentIntentMetadata(paymentIntent);
      observedOrderId = metadata.orderToken;
      const result = event.type === 'payment_intent.succeeded'
        ? await confirmStorePaymentIntentOrder(paymentIntent, env, ctx)
        : await failStorePaymentIntentOrder(paymentIntent, env, ctx);

      if (!result.ok) {
        console.error('Store PaymentIntent webhook rejected:', {
          eventId: event.id,
          eventType: event.type,
          orderToken: result.orderToken || metadata.orderToken,
          error: result.error
        });
        return finishWebhook(
          jsonResponse({ error: result.error }, result.status || 409),
          result.outcome || 'store_order_rejected',
          { orderId: result.orderToken || metadata.orderToken }
        );
      }

      await markStripeEventProcessed();
      return finishWebhook(
        jsonResponse(result.response || { received: true }),
        result.outcome,
        { orderId: result.orderToken || metadata.orderToken }
      );
    }
  }

  await markStripeEventProcessed();
  return finishWebhook(jsonResponse({ received: true, skipped: 'unsupported_event' }), 'ignored_event_type');
}


async function handleCronStatus(request, env) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;

  const lastRun = await env.STORE_STATE?.get('cron:lastRun');
  const lastError = await env.STORE_STATE?.get('cron:lastError', { type: 'json' });

  return jsonResponse({
    lastRun,
    lastError,
    now: new Date().toISOString()
  });
}

async function handleWebhookObservability(request, env) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const days = clampObservabilityDays(url.searchParams.get('days'));
  const summaries = await listObservabilitySummaries(env, 'webhook', days);
  const recent = await getObservabilityRecentEvents(env, 'webhook');

  return jsonResponse({
    success: true,
    days,
    now: new Date().toISOString(),
    summaries,
    recent
  });
}

async function handlePerformanceObservability(request, env) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const days = clampObservabilityDays(url.searchParams.get('days'));
  const summaries = await listObservabilitySummaries(env, 'performance', days);

  return jsonResponse({
    success: true,
    days,
    sampleRate: getObservabilitySampleRate(env),
    now: new Date().toISOString(),
    summaries
  });
}





async function handleAdminRebuild(request, env) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;

  let reason = 'admin-triggered';
  const parsedBody = await parseOptionalJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body || {};
  if (body.reason) reason = body.reason;

  const result = await triggerAdminRepoRebuild(env, reason);
  
  if (result.triggered || result.mode === 'local') {
    return jsonResponse({
      success: true,
      message: result.mode === 'local' ? 'Local dev rebuild is handled by Jekyll.' : 'Site rebuild triggered',
      rebuild: result
    });
  }
  
  return jsonResponse({ 
    success: false, 
    error: result.reason || 'Failed to trigger rebuild' 
  }, 500);
}

function storeHealthCheck(key, label, status, detail, meta = {}) {
  return {
    key,
    label,
    status,
    detail,
    meta
  };
}

function storeHealthSecretStatus(status = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return 'info';
  if (normalized.includes('missing')) return 'action';
  if (normalized.includes('configured') || normalized.includes('github secret')) return 'ok';
  if (normalized.includes('optional')) return 'info';
  return 'info';
}

function summarizeStoreHealthStatus(checks = []) {
  if (checks.some((check) => check.status === 'action')) return 'action';
  if (checks.some((check) => check.status === 'warning')) return 'warning';
  if (checks.some((check) => check.status === 'ok')) return 'ok';
  return 'info';
}

function storeHealthTotals(checks = []) {
  return checks.reduce((totals, check) => {
    const status = check.status || 'info';
    totals[status] = Number(totals[status] || 0) + 1;
    totals.total += 1;
    return totals;
  }, { total: 0, ok: 0, warning: 0, action: 0, info: 0 });
}

function newestIsoDate(values = []) {
  let newest = '';
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text) continue;
    if (!newest || new Date(text).getTime() > new Date(newest).getTime()) newest = text;
  }
  return newest;
}

function summarizeWebhookHealth(summaries = [], recent = []) {
  const received = summaries.reduce((sum, summary) => sum + Number(summary?.received || 0), 0);
  const errorCount = summaries.reduce((sum, summary) => {
    const statusCounts = summary?.statusCounts || {};
    return sum + Number(statusCounts['4xx'] || 0) + Number(statusCounts['5xx'] || 0);
  }, 0);
  const latest = newestIsoDate([
    ...summaries.map((summary) => summary?.updatedAt),
    ...recent.map((entry) => entry?.recordedAt)
  ]);
  if (!received && !recent.length) {
    return storeHealthCheck(
      'webhook-observability',
      'Webhook activity',
      'info',
      'No Stripe webhook activity has been recorded in the last 2 days.',
      { received, errorCount, updatedAt: latest }
    );
  }
  const observed = received || recent.length;
  return storeHealthCheck(
    'webhook-observability',
    'Webhook activity',
    errorCount > 0 ? 'warning' : 'ok',
    `${observed} webhook event${observed === 1 ? '' : 's'} observed in the last 2 days.`,
    { received, errorCount, updatedAt: latest }
  );
}

function summarizeCatalogHealth(products = null) {
  const totals = products?.totals || {};
  const catalog = products?.catalog || {};
  const productCount = Number(totals.products || 0);
  const rowCount = Number(totals.rows || 0);
  const sourceHash = String(catalog.sourceHash || '').trim();
  if (!products) {
    return storeHealthCheck('catalog-snapshot', 'Catalog snapshot', 'action', 'Store catalog totals are unavailable.');
  }
  if (!productCount) {
    return storeHealthCheck('catalog-snapshot', 'Catalog snapshot', 'action', 'No active Store products were found in the generated catalog snapshot.');
  }
  return storeHealthCheck(
    'catalog-snapshot',
    'Catalog snapshot',
    sourceHash ? 'ok' : 'warning',
    `${productCount} product${productCount === 1 ? '' : 's'} and ${rowCount} sellable row${rowCount === 1 ? '' : 's'} loaded from ${catalog.source || '_products'}.`,
    {
      products: productCount,
      rows: rowCount,
      source: catalog.source || '',
      sourceHash,
      updatedAt: products.updatedAt || ''
    }
  );
}

function summarizeDownloadHealth(downloads = null) {
  const totals = downloads?.totals || {};
  const count = Number(totals.count || 0);
  const missing = Number(totals.missing || 0);
  const ready = Number(totals.ready || 0);
  const r2Ready = Number(totals.r2Ready || 0);
  const urlReady = Number(totals.urlReady || 0);
  if (!downloads) {
    return storeHealthCheck('download-readiness', 'Download readiness', 'action', 'Store download readiness is unavailable.');
  }
  if (!downloads.bucketConfigured) {
    return storeHealthCheck('download-readiness', 'Download readiness', 'action', 'STORE_DOWNLOADS is not configured for this Worker environment.', {
      count,
      ready,
      missing,
      r2Ready,
      urlReady,
      updatedAt: downloads.updatedAt || ''
    });
  }
  if (!count) {
    return storeHealthCheck('download-readiness', 'Download readiness', 'info', 'No digital download products are currently configured.', {
      count,
      ready,
      missing,
      r2Ready,
      urlReady,
      updatedAt: downloads.updatedAt || ''
    });
  }
  if (missing > 0) {
    return storeHealthCheck('download-readiness', 'Download readiness', 'action', `${missing} of ${count} configured download file${count === 1 ? '' : 's'} are missing.`, {
      count,
      ready,
      missing,
      r2Ready,
      urlReady,
      updatedAt: downloads.updatedAt || ''
    });
  }
  if (r2Ready < count && urlReady > 0) {
    return storeHealthCheck('download-readiness', 'Download readiness', 'warning', `${urlReady} download file${urlReady === 1 ? '' : 's'} rely on fallback URLs instead of R2.`, {
      count,
      ready,
      missing,
      r2Ready,
      urlReady,
      updatedAt: downloads.updatedAt || ''
    });
  }
  return storeHealthCheck('download-readiness', 'Download readiness', 'ok', `${ready} of ${count} download file${count === 1 ? '' : 's'} are ready in R2.`, {
    count,
    ready,
    missing,
    r2Ready,
    urlReady,
    updatedAt: downloads.updatedAt || ''
  });
}

function summarizeInventoryHealth(inventory = null) {
  if (!inventory) {
    return storeHealthCheck('inventory-baselines', 'Inventory baselines', 'action', 'Store inventory totals are unavailable.');
  }
  const rows = Array.isArray(inventory.rows) ? inventory.rows : [];
  const lowRows = rows.filter((row) => Number.isFinite(Number(row.remaining)) && Number(row.remaining) <= 5);
  if (inventory.truncated === true) {
    return storeHealthCheck('inventory-baselines', 'Inventory baselines', 'warning', 'Inventory scan was truncated before all orders were counted.', {
      rows: rows.length,
      lowRows: lowRows.length,
      updatedAt: inventory.updatedAt || '',
      overridesUpdatedAt: inventory.overridesUpdatedAt || ''
    });
  }
  if (!rows.length) {
    return storeHealthCheck('inventory-baselines', 'Inventory baselines', 'info', 'No inventory-tracked Store products are currently active.', {
      rows: 0,
      lowRows: 0,
      updatedAt: inventory.updatedAt || '',
      overridesUpdatedAt: inventory.overridesUpdatedAt || ''
    });
  }
  return storeHealthCheck(
    'inventory-baselines',
    'Inventory baselines',
    lowRows.length > 0 ? 'warning' : 'ok',
    lowRows.length > 0
      ? `${lowRows.length} inventory row${lowRows.length === 1 ? '' : 's'} are at or below the launch warning threshold.`
      : `${rows.length} inventory-tracked row${rows.length === 1 ? '' : 's'} have readable baselines.`,
    {
      rows: rows.length,
      lowRows: lowRows.length,
      updatedAt: inventory.updatedAt || '',
      overridesUpdatedAt: inventory.overridesUpdatedAt || ''
    }
  );
}

function summarizeCronHealth(lastRun = '', lastError = null) {
  if (lastError) {
    return storeHealthCheck('cron-heartbeat', 'Cron heartbeat', 'warning', 'The last cron heartbeat recorded an error.', {
      lastRun,
      lastError
    });
  }
  if (!lastRun) {
    return storeHealthCheck('cron-heartbeat', 'Cron heartbeat', 'info', 'No cron heartbeat has been recorded yet for this environment.', {
      lastRun: ''
    });
  }
  return storeHealthCheck('cron-heartbeat', 'Cron heartbeat', 'ok', `Last cron heartbeat was ${lastRun}.`, {
    lastRun
  });
}

function buildSecretHealthChecks(env) {
  return adminSecretStatusRows(env).map(([label, status]) => storeHealthCheck(
    `secret-${String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`,
    label,
    storeHealthSecretStatus(status),
    String(status || 'Not configured')
  ));
}

async function handleAdminStoreHealth(request, env) {
  const auth = await requireAdminSession(request, env, 'store:read', { accessScope: STORE_ADMIN_SCOPE });
  if (!auth.ok) return auth.response;

  const [
    productsResult,
    downloadsResult,
    inventoryResult,
    webhookSummariesResult,
    webhookRecentResult,
    cronLastRunResult,
    cronLastErrorResult
  ] = await Promise.allSettled([
    buildAdminStoreProductsSnapshot(env),
    buildAdminStoreDownloadsSnapshot(env),
    buildAdminStoreInventorySnapshot(env),
    listObservabilitySummaries(env, 'webhook', 2),
    getObservabilityRecentEvents(env, 'webhook'),
    env.STORE_STATE?.get('cron:lastRun') || Promise.resolve(''),
    env.STORE_STATE?.get('cron:lastError', { type: 'json' }) || Promise.resolve(null)
  ]);

  const products = productsResult.status === 'fulfilled' && productsResult.value?.ok ? productsResult.value : null;
  const downloads = downloadsResult.status === 'fulfilled' ? downloadsResult.value : null;
  const inventory = inventoryResult.status === 'fulfilled' && inventoryResult.value?.ok ? inventoryResult.value : null;
  const webhookSummaries = webhookSummariesResult.status === 'fulfilled' && Array.isArray(webhookSummariesResult.value)
    ? webhookSummariesResult.value
    : [];
  const webhookRecent = webhookRecentResult.status === 'fulfilled' && Array.isArray(webhookRecentResult.value)
    ? webhookRecentResult.value
    : [];
  const lastRun = cronLastRunResult.status === 'fulfilled' ? String(cronLastRunResult.value || '') : '';
  const lastError = cronLastErrorResult.status === 'fulfilled' ? cronLastErrorResult.value : null;

  const checks = [
    summarizeCatalogHealth(products),
    summarizeDownloadHealth(downloads),
    summarizeInventoryHealth(inventory),
    summarizeWebhookHealth(webhookSummaries, webhookRecent),
    summarizeCronHealth(lastRun, lastError)
  ];
  if (auth.user.role === 'super_admin') {
    checks.push(...buildSecretHealthChecks(env));
  }
  const totals = storeHealthTotals(checks);

  return privateJsonResponse({
    user: auth.user,
    scope: STORE_ADMIN_SCOPE,
    overallStatus: summarizeStoreHealthStatus(checks),
    totals,
    checks,
    store: {
      catalog: products ? {
        totals: products.totals,
        catalog: products.catalog,
        updatedAt: products.updatedAt
      } : null,
      downloads: downloads ? {
        bucketConfigured: downloads.bucketConfigured,
        totals: downloads.totals,
        updatedAt: downloads.updatedAt
      } : null,
      inventory: inventory ? {
        rows: Array.isArray(inventory.rows) ? inventory.rows.length : 0,
        scanned: inventory.scanned,
        indexed: inventory.indexed,
        truncated: inventory.truncated === true,
        overridesUpdatedAt: inventory.overridesUpdatedAt || null,
        updatedAt: inventory.updatedAt
      } : null,
      webhooks: {
        summaries: webhookSummaries,
        recent: webhookRecent.slice(0, 5)
      },
      cron: {
        lastRun,
        lastError
      }
    },
    writeBudget: adminReadBudget({ kvListExpected: 0 }),
    generatedAt: new Date().toISOString()
  }, 200, env);
}

async function handleAdminDashboardSummary(request, env) {
  const auth = await requireAdminSession(request, env, 'store:read', { accessScope: STORE_ADMIN_SCOPE });
  if (!auth.ok) return auth.response;

  const [ordersResult, productsResult, inventoryResult, downloadsResult] = await Promise.allSettled([
    buildAdminStoreOrdersPayload(request, env, { paginate: false }),
    buildAdminStoreProductsSnapshot(env),
    buildAdminStoreInventorySnapshot(env),
    buildAdminStoreDownloadsSnapshot(env)
  ]);
  const ordersPayload = ordersResult.status === 'fulfilled' && ordersResult.value?.ok
    ? ordersResult.value.payload
    : null;
  const products = productsResult.status === 'fulfilled' && productsResult.value?.ok
    ? productsResult.value
    : null;
  const inventory = inventoryResult.status === 'fulfilled' && inventoryResult.value?.ok
    ? inventoryResult.value
    : null;
  const downloads = downloadsResult.status === 'fulfilled'
    ? downloadsResult.value
    : null;
  const accessIssues = [];
  if (!ordersPayload) accessIssues.push({ scope: 'orders', error: 'Store order totals are unavailable.' });
  if (!products) accessIssues.push({ scope: 'products', error: 'Store product totals are unavailable.' });
  if (!inventory) accessIssues.push({ scope: 'inventory', error: 'Store inventory totals are unavailable.' });
  if (!downloads) accessIssues.push({ scope: 'downloads', error: 'Store download totals are unavailable.' });

  return privateJsonResponse({
    user: auth.user,
    scope: STORE_ADMIN_SCOPE,
    totals: {
      orders: Number(ordersPayload?.totals?.orders || 0),
      orderRevenueCents: Number(ordersPayload?.totals?.totalCents || 0),
      fulfillmentRows: Number(ordersPayload?.totals?.fulfillmentRows || 0),
      ticketQuantity: Number(ordersPayload?.totals?.ticketQuantity || 0),
      checkedInQuantity: Number(ordersPayload?.totals?.checkedInQuantity || 0),
      products: Number(products?.totals?.products || 0),
      productRows: Number(products?.totals?.rows || 0),
      activeProducts: Number(products?.totals?.active || 0),
      inventoryRows: Array.isArray(inventory?.rows) ? inventory.rows.length : 0,
      lowInventoryRows: Array.isArray(inventory?.rows)
        ? inventory.rows.filter((row) => Number.isFinite(Number(row.remaining)) && Number(row.remaining) <= 5).length
        : 0,
      downloads: Number(downloads?.totals?.count || 0),
      downloadsReady: Number(downloads?.totals?.ready || 0),
      downloadsMissing: Number(downloads?.totals?.missing || 0)
    },
    store: {
      orders: ordersPayload?.totals || null,
      products: products?.totals || null,
      inventory: inventory ? {
        rows: inventory.rows.length,
        scanned: inventory.scanned,
        indexed: inventory.indexed,
        truncated: inventory.truncated === true
      } : null,
      downloads: downloads?.totals || null
    },
    accessIssues,
    writeBudget: adminWriteBudget({ readOnly: true, kvWritesExpected: 0 }),
    generatedAt: new Date().toISOString()
  }, 200, env);
}

function stringifyAdminSettingValue(value) {
  if (value === undefined || value === null || value === '') return 'Not configured';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function adminSettingsSection(title, entries, lang = DEFAULT_I18N_LANG) {
  return {
    title: localizedAdminSectionTitle(title, lang),
    rows: entries.map(([label, value, options = {}]) => ({
      label: options.label || label,
      value: stringifyAdminSettingValue(value),
      rawValue: value ?? '',
      editable: Boolean(options.editable),
      path: options.path || '',
      type: options.type || 'string',
      input: options.input || options.type || 'text',
      min: options.min,
      max: options.max,
      step: options.step,
      displayMultiplier: options.displayMultiplier,
      submitDivisor: options.submitDivisor,
      placeholder: options.placeholder || '',
      options: Array.isArray(options.options) ? options.options : [],
      accessOptions: Array.isArray(options.accessOptions) ? options.accessOptions : [],
      currentUserEmail: options.currentUserEmail || '',
      timeParts: options.timeParts && typeof options.timeParts === 'object' ? options.timeParts : null,
      visibleWhen: options.visibleWhen && typeof options.visibleWhen === 'object' ? options.visibleWhen : null,
      layoutGroup: options.layoutGroup || '',
      hideLabel: Boolean(options.hideLabel),
      help: options.help || ''
    }))
  };
}

const ADMIN_SETTING_LOCALIZATIONS = {
  es: {
    fields: {
      'platform.favicon_path': {
        label: 'Favicon',
        help: 'Icono pequeno que aparece en la pestana del navegador. Usa una imagen cuadrada simple para mejor compatibilidad.'
      },
      'platform.default_social_image_path': {
        label: 'Imagen social predeterminada',
        help: 'Imagen de respaldo para tarjetas sociales cuando una pagina o producto no tiene su propia imagen.'
      },
      'seo.x_handle': {
        label: 'Usuario de X'
      },
      'seo.default_social_image_alt': {
        label: 'Texto alternativo de imagen social'
      },
      'seo.same_as': {
        label: 'Enlaces same-as'
      },
      'seo.merchant_return_policy.applicable_country': {
        label: 'Pais de politica de devoluciones',
        help: 'Codigo de pais de dos letras para la politica de devoluciones en los datos estructurados de producto.'
      },
      'seo.merchant_return_policy.return_policy_category': {
        label: 'Tipo de politica de devoluciones',
        help: 'Categoria de politica de devoluciones de Google Merchant emitida en el JSON-LD de Organization.'
      },
      'seo.merchant_return_policy.merchant_return_days': {
        label: 'Dias para devoluciones',
        help: 'Obligatorio cuando el tipo de politica usa una ventana de devolucion finita.'
      },
      'seo.merchant_return_policy.return_fees': {
        label: 'Costos de devolucion',
        help: 'Como se representan los costos de envio de devolucion en los datos estructurados cuando se permiten devoluciones.'
      },
      'seo.merchant_return_policy.return_method': {
        label: 'Metodo de devolucion',
        help: 'Metodo de devolucion representado en los datos estructurados cuando se permiten devoluciones.'
      }
    },
    options: {
      US: 'Estados Unidos',
      CA: 'Canada',
      GB: 'Reino Unido',
      AU: 'Australia',
      NZ: 'Nueva Zelanda',
      MX: 'Mexico',
      FR: 'Francia',
      DE: 'Alemania',
      ES: 'Espana',
      IT: 'Italia',
      NL: 'Paises Bajos',
      SE: 'Suecia',
      'https://schema.org/MerchantReturnFiniteReturnWindow': 'Ventana de devolucion finita',
      'https://schema.org/MerchantReturnUnlimitedWindow': 'Ventana de devolucion ilimitada',
      'https://schema.org/MerchantReturnNotPermitted': 'No se permiten devoluciones',
      'https://schema.org/ReturnFeesCustomerResponsibility': 'Cliente cubre envio de devolucion',
      'https://schema.org/FreeReturn': 'Devoluciones gratis',
      'https://schema.org/ReturnShippingFees': 'Comercio cobra envio de devolucion',
      'https://schema.org/ReturnByMail': 'Devolucion por correo',
      'https://schema.org/ReturnInStore': 'Devolucion en tienda',
      'https://schema.org/ReturnAtKiosk': 'Devolucion en kiosco'
    }
  }
};

function adminLocaleKey(lang = DEFAULT_I18N_LANG) {
  return normalizePreferredLang(lang).split('-')[0];
}

function localizedAdminOptions(options = [], lang = DEFAULT_I18N_LANG) {
  const localization = ADMIN_SETTING_LOCALIZATIONS[adminLocaleKey(lang)];
  if (!localization?.options || !Array.isArray(options)) return options;
  return options.map((option) => ({
    ...option,
    label: localization.options[String(option.value)] || option.label
  }));
}

function localizedAdminSettingSchema(path, schema, lang = DEFAULT_I18N_LANG) {
  if (!schema) return schema;
  const localization = ADMIN_SETTING_LOCALIZATIONS[adminLocaleKey(lang)];
  const field = localization?.fields?.[path] || {};
  return {
    ...schema,
    ...field,
    options: localizedAdminOptions(schema.options, lang)
  };
}

function localizedAdminSectionTitle(title, lang = DEFAULT_I18N_LANG) {
  const key = adminLocaleKey(lang);
  if (key === 'es' && title === 'Brand & SEO') return 'Marca y SEO';
  return title;
}

function preferredAdminSettingsLang(request) {
  try {
    const url = new URL(request.url);
    return normalizePreferredLang(url.searchParams.get('preferredLang') || url.searchParams.get('lang'));
  } catch {
    return DEFAULT_I18N_LANG;
  }
}

const ADMIN_TAX_PROVIDER_OPTIONS = [
  { value: 'flat', label: 'Flat rate' },
  { value: 'offline_rules', label: 'Offline rules' },
  { value: 'nm_grt', label: 'New Mexico GRT' },
  { value: 'zip_tax', label: 'ZIP.TAX' },
  { value: 'external', label: 'External/custom' }
];

const ADMIN_ORIGIN_COUNTRY_OPTIONS = [
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'AU', label: 'Australia' },
  { value: 'NZ', label: 'New Zealand' },
  { value: 'MX', label: 'Mexico' },
  { value: 'FR', label: 'France' },
  { value: 'DE', label: 'Germany' },
  { value: 'ES', label: 'Spain' },
  { value: 'IT', label: 'Italy' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'SE', label: 'Sweden' }
];

const ADMIN_SHIPPING_DEFAULT_OPTION_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'signature_required', label: 'Signature required' },
  { value: 'adult_signature_required', label: 'Adult signature required' }
];

const ADMIN_RETURN_POLICY_CATEGORY_OPTIONS = [
  { value: 'https://schema.org/MerchantReturnFiniteReturnWindow', label: 'Finite return window' },
  { value: 'https://schema.org/MerchantReturnUnlimitedWindow', label: 'Unlimited return window' },
  { value: 'https://schema.org/MerchantReturnNotPermitted', label: 'Returns not permitted' }
];

const ADMIN_RETURN_FEES_OPTIONS = [
  { value: 'https://schema.org/ReturnFeesCustomerResponsibility', label: 'Customer handles return shipping' },
  { value: 'https://schema.org/FreeReturn', label: 'Free returns' },
  { value: 'https://schema.org/ReturnShippingFees', label: 'Merchant charges return shipping fee' }
];

const ADMIN_RETURN_METHOD_OPTIONS = [
  { value: 'https://schema.org/ReturnByMail', label: 'Return by mail' },
  { value: 'https://schema.org/ReturnInStore', label: 'Return in store' },
  { value: 'https://schema.org/ReturnAtKiosk', label: 'Return at kiosk' }
];

const ADMIN_TIME_ZONE_OPTIONS = getTimeZoneOptions();

const ADMIN_PLATFORM_SETTING_SCHEMA = new Map([
  ['title', { label: 'Site title', layoutGroup: 'platform-identity' }],
  ['platform.name', { label: 'Name', layoutGroup: 'platform-identity' }],
  ['platform.company_name', { label: 'Company', layoutGroup: 'platform-identity' }],
  ['author', { label: 'Site author', layoutGroup: 'platform-identity' }],
  ['platform.default_creator_name', { label: 'Default creator name', layoutGroup: 'platform-defaults' }],
  ['platform.timezone', { label: 'Default timezone', input: 'select', options: ADMIN_TIME_ZONE_OPTIONS, layoutGroup: 'platform-defaults' }],
  ['platform.support_email', { label: 'Support email', input: 'email', layoutGroup: 'platform-email' }],
  ['description', { label: 'Site description', input: 'textarea' }],
  ['platform.orders_email_from', { label: 'Orders email from', input: 'email-sender', layoutGroup: 'platform-email-from' }],
  ['platform.updates_email_from', { label: 'Updates email from', input: 'email-sender', layoutGroup: 'platform-email-from' }],
  ['platform.logo_path', { label: 'Logo', input: 'image-upload', layoutGroup: 'brand-logo-footer-logo', help: 'Logo image used in the site header and platform emails. Upload a square PNG, JPEG, or WebP under 512 KB, or paste an existing asset path.' }],
  ['platform.footer_logo_path', { label: 'Footer logo', input: 'image-upload', layoutGroup: 'brand-logo-footer-logo', help: 'Logo image used in the site footer. Upload an image or paste an existing asset path.' }],
  ['platform.favicon_path', { label: 'Favicon', input: 'image-upload', layoutGroup: 'brand-favicon-social-image', help: 'Small browser-tab icon for the site. Use a simple square image for the most reliable display.' }],
  ['platform.default_social_image_path', { label: 'Default social image', input: 'image-upload', layoutGroup: 'brand-favicon-social-image', help: 'Fallback image used for social share cards when a page or product does not provide its own image.' }],
  ['seo.x_handle', { label: 'X handle', layoutGroup: 'brand-x-social-alt' }],
  ['seo.default_social_image_alt', { label: 'Default social image alt', layoutGroup: 'brand-x-social-alt' }],
  ['seo.same_as', { label: 'Same-as links', type: 'list', input: 'url-list' }],
  ['seo.merchant_return_policy.applicable_country', { label: 'Return policy country', input: 'select', options: ADMIN_ORIGIN_COUNTRY_OPTIONS, layoutGroup: 'brand-return-policy', help: 'Two-letter country code for the merchant return policy in product structured data.' }],
  ['seo.merchant_return_policy.return_policy_category', { label: 'Return policy type', input: 'select', options: ADMIN_RETURN_POLICY_CATEGORY_OPTIONS, layoutGroup: 'brand-return-policy', help: 'Google merchant-listing return policy category emitted under Organization JSON-LD.' }],
  ['seo.merchant_return_policy.merchant_return_days', { label: 'Return window days', type: 'number', input: 'integer', min: 1, max: 3650, step: 1, layoutGroup: 'brand-return-policy', visibleWhen: { path: 'seo.merchant_return_policy.return_policy_category', value: 'https://schema.org/MerchantReturnFiniteReturnWindow' }, help: 'Required when the return policy type is a finite return window.' }],
  ['seo.merchant_return_policy.return_fees', { label: 'Return fees', input: 'select', options: ADMIN_RETURN_FEES_OPTIONS, layoutGroup: 'brand-return-policy', help: 'How return shipping costs are represented in merchant listing structured data when returns are permitted.' }],
  ['seo.merchant_return_policy.return_method', { label: 'Return method', input: 'select', options: ADMIN_RETURN_METHOD_OPTIONS, layoutGroup: 'brand-return-policy', help: 'Return method represented in merchant listing structured data when returns are permitted.' }],
  ['platform.site_url', { label: 'Production site URL', input: 'url', layoutGroup: 'canonical-urls' }],
  ['platform.worker_url', { label: 'Production Worker URL', input: 'url', layoutGroup: 'canonical-urls' }],
  ['checkout.stripe_publishable_key', { label: 'Stripe publishable key', input: 'stripe-publishable-key' }],
  ['pricing.sales_tax_rate', { label: 'Sales Tax Rate', type: 'number', input: 'percent', min: 0, step: 0.0001, displayMultiplier: 100, submitDivisor: 100, layoutGroup: 'pricing-percentages' }],
  ['pricing.default_tip_percent', { label: 'Default Platform Tip Percent', type: 'number', input: 'percent', min: 0, step: 1, layoutGroup: 'pricing-percentages' }],
  ['pricing.max_tip_percent', { label: 'Max Platform Tip Percent', type: 'number', input: 'percent', min: 0, step: 1, layoutGroup: 'pricing-percentages' }],
  ['tax.provider', { label: 'Provider', input: 'select', options: ADMIN_TAX_PROVIDER_OPTIONS, layoutGroup: 'tax-core' }],
  ['tax.origin_country', { label: 'Origin country', input: 'select', options: ADMIN_ORIGIN_COUNTRY_OPTIONS, layoutGroup: 'tax-core' }],
  ['tax.use_regional_origin', { label: 'Use regional origin', type: 'boolean', layoutGroup: 'tax-core' }],
  ['tax.nm_grt_api_base', { label: 'New Mexico GRT API base' }],
  ['tax.zip_tax_api_base', { label: 'ZIP.TAX API base' }],
  ['shipping.origin_zip', { label: 'Origin postal code', layoutGroup: 'shipping-origin' }],
  ['shipping.origin_country', { label: 'Origin country', input: 'select', options: ADMIN_ORIGIN_COUNTRY_OPTIONS, layoutGroup: 'shipping-origin' }],
  ['shipping.fallback_flat_rate', { label: 'Fallback Shipping Fee (USD)', type: 'number', min: 0, layoutGroup: 'shipping-defaults' }],
  ['shipping.free_shipping_default', { label: 'Free shipping default', type: 'boolean', layoutGroup: 'shipping-defaults' }],
  ['shipping.default_option', { label: 'Default shipping option', input: 'select', options: ADMIN_SHIPPING_DEFAULT_OPTION_OPTIONS, layoutGroup: 'shipping-defaults' }],
  ['shipping.usps.enabled', { label: 'USPS enabled', type: 'boolean', layoutGroup: 'shipping-usps' }],
  ['shipping.usps.client_id', { label: 'USPS client ID', layoutGroup: 'shipping-usps' }],
  ['shipping.usps.api_base', { label: 'USPS API base', input: 'url', layoutGroup: 'shipping-usps' }],
  ['shipping.usps.timeout_ms', { label: 'USPS timeout ms', type: 'number', input: 'integer', min: 0, layoutGroup: 'shipping-usps-tuning' }],
  ['shipping.usps.quote_cache_ttl_seconds', { label: 'USPS quote cache TTL seconds', type: 'number', input: 'integer', min: 0, layoutGroup: 'shipping-usps-tuning' }],
  ['shipping.usps.failure_cooldown_seconds', { label: 'USPS failure cooldown seconds', type: 'number', input: 'integer', min: 0, layoutGroup: 'shipping-usps-tuning' }],
  ['shipping.usps.rate_limit_cooldown_seconds', { label: 'USPS rate limit cooldown seconds', type: 'number', input: 'integer', min: 0, layoutGroup: 'shipping-usps-tuning' }],
  ['marketing.default_utm_source', { label: 'Default UTM source', layoutGroup: 'marketing-utm-defaults', help: 'Default utm_source value used by the Store marketing URL builder.' }],
  ['marketing.default_utm_medium', { label: 'Default UTM medium', layoutGroup: 'marketing-utm-defaults', help: 'Default utm_medium value used by the Store marketing URL builder.' }],
  ['marketing.default_utm_campaign', { label: 'Default UTM campaign', layoutGroup: 'marketing-utm-defaults', help: 'Default utm_campaign value used by the Store marketing URL builder.' }],
  ['marketing.default_utm_content', { label: 'Default UTM content', layoutGroup: 'marketing-utm-defaults', help: 'Optional default utm_content value for distinguishing creative variants.' }],
  ['marketing.default_ref', { label: 'Default referral code', layoutGroup: 'marketing-link-defaults', help: 'Optional default referral code appended as ref= when building Store marketing links.' }],
  ['marketing.landing_page_path', { label: 'Landing page path', input: 'url', layoutGroup: 'marketing-link-defaults', help: 'Default Store path or URL used by the marketing link builder.' }],
  ['marketing.share_title', { label: 'Share title', layoutGroup: 'marketing-share-copy', help: 'Default title used for generated marketing snippets.' }],
  ['marketing.share_text', { label: 'Share text', input: 'textarea', help: 'Default short copy used in generated social and email snippets.' }],
  ['design.layout_max_width', { label: 'Layout max width', layoutGroup: 'design-layout', help: 'Maximum width for public page, header, and footer content. Use a CSS length such as 1000px.' }],
  ['design.font_body', { label: 'Body font', layoutGroup: 'design-fonts' }],
  ['design.font_display', { label: 'Heading font', layoutGroup: 'design-fonts' }],
  ['design.color_text', { label: 'Text Color', input: 'color', layoutGroup: 'design-colors', help: 'Main body-copy color used across public pages, admin screens, and Store emails.' }],
  ['design.color_text_muted', { label: 'Muted Color', input: 'color', layoutGroup: 'design-colors', help: 'Lower-emphasis text color used for descriptions, metadata, helper text, and labels.' }],
  ['design.color_surface_subtle', { label: 'Surface Color', input: 'color', layoutGroup: 'design-colors', help: 'Subtle panel background color used for grouped controls, cards, and admin surfaces.' }],
  ['design.color_border', { label: 'Border Color', input: 'color', layoutGroup: 'design-colors', help: 'Control-border and divider color used across storefront and admin UI.' }],
  ['design.color_primary', { label: 'Primary Color', input: 'color', layoutGroup: 'design-colors', help: 'Primary action and strong brand color for buttons, selected tabs, and highlights.' }],
  ['design.radius_lg', { label: 'Button Radius', layoutGroup: 'design-layout' }],
  ['admin.users', { label: 'Users', type: 'admin_users', input: 'admin-users' }],
  ['add_ons.enabled', { label: 'Add-ons Enabled', type: 'boolean', layoutGroup: 'platform-addons', help: 'Controls whether the cart suggests same-type add-on products.' }],
  ['add_ons.product_count', { label: 'Add-on product count', type: 'number', input: 'integer', min: 1, max: 5, step: 1, layoutGroup: 'platform-addons', help: 'Maximum number of same-type product suggestions shown in the cart. The cart shows fewer when fewer matching products exist.' }],
  ['performance.intent_prefetch_enabled', { label: 'Intent prefetch enabled', type: 'boolean', layoutGroup: 'performance' }],
  ['performance.intent_prefetch_delay_ms', { label: 'Intent prefetch delay ms', type: 'number', input: 'integer', min: 0, layoutGroup: 'performance' }],
  ['performance.intent_prefetch_limit', { label: 'Intent prefetch limit', type: 'number', input: 'integer', min: 0, layoutGroup: 'performance' }],
  ['cache.live_inventory_ttl_seconds', { label: 'Live inventory cache TTL seconds', type: 'number', input: 'integer', min: 0, layoutGroup: 'performance' }],
  ['debug.console_logging_enabled', { label: 'Console logging enabled', type: 'boolean', layoutGroup: 'debug' }],
  ['debug.verbose_console_logging', { label: 'Verbose console logging', type: 'boolean', layoutGroup: 'debug' }]
]);

function editableAdminSetting(path, type = 'string', lang = DEFAULT_I18N_LANG) {
  const schema = localizedAdminSettingSchema(path, ADMIN_PLATFORM_SETTING_SCHEMA.get(path), lang);
  return {
    label: schema?.label,
    editable: true,
    path,
    type: schema?.type || type,
    input: schema?.input || type || 'text',
    min: schema?.min,
    max: schema?.max,
    step: schema?.step,
    displayMultiplier: schema?.displayMultiplier,
    submitDivisor: schema?.submitDivisor,
    placeholder: schema?.placeholder || '',
    options: schema?.options || [],
    visibleWhen: schema?.visibleWhen || null,
    layoutGroup: schema?.layoutGroup || '',
    help: schema?.help || ''
  };
}

function readOnlyAdminSettingHelp(help, layoutGroup = '') {
  return { help, layoutGroup };
}

function readOnlyConditionalAdminSettingHelp(help, visibleWhen) {
  return { help, visibleWhen };
}



function parseAdminDelimitedList(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAdminAccessScopes(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  return Array.from(new Set(source
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
}

function adminUserCanAccessScope(user = {}, accessScope = '') {
  const scope = String(accessScope || '').trim();
  if (!scope) return user?.role === 'super_admin';
  return user?.role === 'super_admin' || (
    Array.isArray(user?.accessScopes) &&
    user.accessScopes.includes(scope)
  );
}

async function adminUserSettingsRows(env) {
  const users = await getEffectiveAdminUsers(env);
  return users.map((user) => ({
    name: user.name || '',
    email: user.email,
    role: user.role === 'super_admin' ? 'super_admin' : 'limited_admin',
    accessScopes: user.role === 'super_admin' ? [] : normalizeAdminAccessScopes(user.accessScopes || [])
  }));
}

function adminAccessOptions() {
  return [{
    label: 'Store',
    value: STORE_ADMIN_SCOPE
  }];
}

function adminSecretStatusRows(env) {
  const isConfigured = (value) => String(value || '').trim().length > 0;
  const status = (value, required = true) => {
    if (isConfigured(value)) return 'Configured';
    return required ? 'Missing' : 'Optional / not configured';
  };
  const activeStripeSecret = getStripeKey(env);
  const activeStripeWebhookSecret = getStripeWebhookSecret(env);
  const uspsRequired = String(env.USPS_ENABLED || '').toLowerCase() === 'true';
  const zipTaxRequired = String(env.TAX_PROVIDER || '').toLowerCase() === 'zip_tax';
  const turnstileRequired = ['1', 'true', 'yes', 'on'].includes(String(env.ADMIN_TURNSTILE_REQUIRED || '').toLowerCase());
  const secretStatusHelp = (help) => readOnlyAdminSettingHelp(help, 'secrets-credentials');
  const abandonedCartSecretStatus = isConfigured(env.ABANDONED_CART_TOKEN_SECRET)
    ? 'Configured'
    : (getAbandonedCartTokenSecret(env) ? 'Using shared secret' : 'Optional / not configured');

  return [
    ['Stripe secret key', status(activeStripeSecret), secretStatusHelp('Secret Stripe API key for the current Worker mode. Store it in Worker secrets for production or worker/.dev.vars for local development.')],
    ['Stripe webhook secret', status(activeStripeWebhookSecret), secretStatusHelp('Stripe webhook signing secret for the current Worker mode. This must stay outside site config and admin setting drafts.')],
    ['Checkout intent secret', status(env.CHECKOUT_INTENT_SECRET), secretStatusHelp('Signing secret for first-party checkout intent payloads and order draft recovery. Generate a unique value per environment.')],
    ['Magic link secret', status(env.MAGIC_LINK_SECRET), secretStatusHelp('Signing secret used by Store admin and order access flows. Generate a unique value per environment.')],
    ['Abandoned checkout token secret', abandonedCartSecretStatus, secretStatusHelp('Optional dedicated signing secret for reminder resume and unsubscribe links. If unset, Store uses the checkout intent or magic link secret.')],
    ['Admin session secret', status(env.ADMIN_SESSION_SECRET, false), secretStatusHelp('Dedicated signing secret for browser admin sessions. Optional in development because the Worker has fallbacks, but production should set it explicitly.')],
    ['Admin recovery secret', status(env.ADMIN_SECRET), secretStatusHelp('Bearer secret used by protected admin automation and recovery endpoints. Keep this in Worker or GitHub secrets only.')],
    ['Admin Turnstile secret', status(env.TURNSTILE_SECRET_KEY || env.ADMIN_TURNSTILE_SECRET_KEY, turnstileRequired), secretStatusHelp('Cloudflare Turnstile secret used to verify admin email sign-in challenges. Required when the admin Turnstile widget is enabled.')],
    ['Resend API key', status(env.RESEND_API_KEY), secretStatusHelp('Email provider API key used for admin magic links and Store order emails. Never store it in _config.yml.')],
    ['USPS client secret', status(env.USPS_CLIENT_SECRET, uspsRequired), secretStatusHelp('USPS OAuth client secret for live shipping quotes. Required only when USPS is enabled; the client ID remains non-secret config.')],
    ['ZIP.TAX API key', status(env.ZIP_TAX_API_KEY || env.TAX_API_KEY, zipTaxRequired), secretStatusHelp('ZIP.TAX API key for jurisdiction-level tax lookup. Required only when the ZIP.TAX provider is selected.')],
    ['Cloudflare usage analytics token', status(env.CLOUDFLARE_USAGE_API_TOKEN || env.CLOUDFLARE_ANALYTICS_API_TOKEN, false), secretStatusHelp('Optional read-only Cloudflare GraphQL Analytics token for the admin plan usage tracker. Keep deploy tokens separate from usage tokens.')],
    ['Cloudflare deploy credentials', 'GitHub secret / local shell only', secretStatusHelp('Cloudflare API tokens are not visible to the Worker runtime. Store deploy credentials in GitHub repository secrets or ignored local env files.')]
  ];
}

const ADMIN_PLAN_USAGE_SOURCE_URLS = {
  cloudflareWorkers: 'https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/',
  cloudflareKv: 'https://developers.cloudflare.com/kv/observability/metrics-analytics/',
  resendUsage: 'https://resend.com/settings/usage',
  resendRateLimit: 'https://resend.com/docs/api-reference/rate-limit',
  resendPricing: 'https://resend.com/pricing'
};

const ADMIN_CLOUDFLARE_PLAN_CATALOG = {
  unknown: {
    label: 'Plan not detected',
    upgradeUrl: 'https://dash.cloudflare.com/?to=/:account/workers/plans'
  },
  free: {
    label: 'Free',
    upgradeUrl: 'https://dash.cloudflare.com/?to=/:account/workers/plans',
    workerRequestsDaily: 100000,
    kvReadsDaily: 100000,
    kvWritesDaily: 1000,
    kvDeletesDaily: 1000,
    kvListsDaily: 1000
  },
  standard: {
    label: 'Workers Paid',
    upgradeUrl: 'https://dash.cloudflare.com/?to=/:account/workers/plans',
    workerRequestsMonthly: 10000000,
    kvReadsMonthly: 10000000,
    kvWritesMonthly: 1000000,
    kvDeletesMonthly: 1000000,
    kvListsMonthly: 1000000
  }
};

const ADMIN_RESEND_PLAN_CATALOG = {
  unknown: {
    label: 'Plan not detected',
    upgradeUrl: 'https://resend.com/settings/billing',
    emailsDaily: null,
    emailsMonthly: null
  },
  paid: {
    label: 'Paid plan',
    upgradeUrl: 'https://resend.com/settings/billing',
    emailsDaily: null,
    emailsMonthly: null
  },
  free: {
    label: 'Free',
    upgradeUrl: 'https://resend.com/settings/billing',
    emailsDaily: 100,
    emailsMonthly: 3000
  },
  pro: {
    label: 'Pro',
    upgradeUrl: 'https://resend.com/settings/billing',
    emailsDaily: null,
    emailsMonthly: 50000
  },
  scale: {
    label: 'Scale',
    upgradeUrl: 'https://resend.com/settings/billing',
    emailsDaily: null,
    emailsMonthly: 100000
  }
};

function normalizeAdminPlanKey(value, fallback = 'free') {
  return String(value || fallback || 'free')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;
}

function normalizeCloudflarePlanKey(value, fallback = 'unknown') {
  const key = normalizeAdminPlanKey(value, fallback);
  if (['paid', 'workers_paid', 'standard_paid', 'standard'].includes(key)) return 'standard';
  return ADMIN_CLOUDFLARE_PLAN_CATALOG[key] ? key : fallback;
}

function normalizeResendPlanKey(value, fallback = 'unknown') {
  const key = normalizeAdminPlanKey(value, fallback);
  if (['transactional_pro', 'email_pro'].includes(key)) return 'pro';
  if (['transactional_scale', 'email_scale'].includes(key)) return 'scale';
  return ADMIN_RESEND_PLAN_CATALOG[key] ? key : fallback;
}

function adminUsageNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function adminPlanUsagePercent(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(100, parsed));
}

function adminPlanUsageThresholds(env) {
  const warning = adminPlanUsagePercent(env.PLAN_USAGE_WARNING_PERCENT || env.ADMIN_PLAN_USAGE_WARNING_PERCENT, 80);
  const critical = adminPlanUsagePercent(env.PLAN_USAGE_CRITICAL_PERCENT || env.ADMIN_PLAN_USAGE_CRITICAL_PERCENT, 95);
  return {
    warning,
    critical: Math.max(warning, critical)
  };
}

function adminPlanLimit(env, name, fallback) {
  const override = adminUsageNumber(env[name]);
  if (override !== null && override >= 0) return override;
  return fallback === null || fallback === undefined ? null : Number(fallback || 0);
}

function adminPlanMetric(config, thresholds) {
  if (config.unlimited === true) {
    return {
      id: config.id,
      label: config.label,
      period: config.period || 'monthly',
      used: null,
      limit: null,
      unit: config.unit || 'count',
      percent: null,
      severity: 'ok',
      unlimited: true,
      source: config.source || '',
      help: config.help || ''
    };
  }
  const used = adminUsageNumber(config.used);
  const limit = adminUsageNumber(config.limit);
  const hasLimit = limit !== null && limit > 0;
  const percent = used !== null && hasLimit ? (used / limit) * 100 : null;
  let severity = 'unknown';
  if (percent !== null) {
    severity = percent >= thresholds.critical ? 'critical' : percent >= thresholds.warning ? 'warning' : 'ok';
  }
  return {
    id: config.id,
    label: config.label,
    period: config.period || 'monthly',
    used,
    limit: hasLimit ? limit : null,
    unit: config.unit || 'count',
    percent,
    severity,
    source: config.source || '',
    help: config.help || ''
  };
}

function adminConfiguredCloudflarePlanKey(env) {
  const raw = String(env.PLAN_USAGE_CLOUDFLARE_PLAN || env.CLOUDFLARE_PLAN || env.CLOUDFLARE_WORKERS_PLAN || '').trim();
  return raw ? normalizeCloudflarePlanKey(raw, 'unknown') : '';
}

function adminConfiguredResendPlanKey(env) {
  const raw = String(env.PLAN_USAGE_RESEND_PLAN || env.RESEND_PLAN || '').trim();
  return raw ? normalizeResendPlanKey(raw, 'unknown') : '';
}

function adminUtcDateString(date) {
  return date.toISOString().slice(0, 10);
}

function adminUtcStartOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function adminUtcStartOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function sumAdminWorkersUsageRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).reduce((totals, row) => {
    totals.requests += Number(row?.sum?.requests || 0) || 0;
    totals.subrequests += Number(row?.sum?.subrequests || 0) || 0;
    totals.errors += Number(row?.sum?.errors || 0) || 0;
    return totals;
  }, { requests: 0, subrequests: 0, errors: 0 });
}

function sumAdminKvUsageRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).reduce((totals, row) => {
    const action = String(row?.dimensions?.actionType || '').trim().toLowerCase();
    const requests = Number(row?.sum?.requests || 0) || 0;
    if (action === 'read') totals.reads += requests;
    else if (action === 'write') totals.writes += requests;
    else if (action === 'delete') totals.deletes += requests;
    else if (action === 'list') totals.lists += requests;
    else totals.other += requests;
    return totals;
  }, { reads: 0, writes: 0, deletes: 0, lists: 0, other: 0 });
}

async function fetchAdminCloudflareGraphql(token, query, variables) {
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || (Array.isArray(body?.errors) && body.errors.length > 0)) {
    throw new Error('cloudflare_graphql_failed');
  }
  return body?.data || {};
}

async function fetchAdminCloudflareWorkersUsage(token, accountTag, scriptName, now = new Date()) {
  const dayStart = adminUtcStartOfDay(now);
  const monthStart = adminUtcStartOfMonth(now);
  const scriptVariable = scriptName ? ', $scriptName: string' : '';
  const scriptFilter = scriptName ? 'scriptName: $scriptName,' : '';
  const query = `
    query AdminWorkersPlanUsage($accountTag: string!, $dayStart: string, $dayEnd: string, $monthStart: string, $monthEnd: string${scriptVariable}) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          day: workersInvocationsAdaptive(limit: 10000, filter: { ${scriptFilter} datetime_geq: $dayStart, datetime_leq: $dayEnd }) {
            sum { requests subrequests errors }
          }
          month: workersInvocationsAdaptive(limit: 10000, filter: { ${scriptFilter} datetime_geq: $monthStart, datetime_leq: $monthEnd }) {
            sum { requests subrequests errors }
          }
        }
      }
    }
  `;
  const variables = {
    accountTag,
    dayStart: dayStart.toISOString(),
    dayEnd: now.toISOString(),
    monthStart: monthStart.toISOString(),
    monthEnd: now.toISOString()
  };
  if (scriptName) variables.scriptName = scriptName;
  const data = await fetchAdminCloudflareGraphql(token, query, variables);
  const account = data?.viewer?.accounts?.[0] || {};
  return {
    day: sumAdminWorkersUsageRows(account.day || []),
    month: sumAdminWorkersUsageRows(account.month || [])
  };
}

async function fetchAdminCloudflareKvUsage(token, accountTag, now = new Date()) {
  const dayStart = adminUtcDateString(adminUtcStartOfDay(now));
  const monthStart = adminUtcDateString(adminUtcStartOfMonth(now));
  const today = adminUtcDateString(now);
  const query = `
    query AdminKvPlanUsage($accountTag: string!, $dayStart: Date, $monthStart: Date, $today: Date) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          day: kvOperationsAdaptiveGroups(filter: { date_geq: $dayStart, date_leq: $today }, limit: 10000) {
            sum { requests }
            dimensions { actionType }
          }
          month: kvOperationsAdaptiveGroups(filter: { date_geq: $monthStart, date_leq: $today }, limit: 10000) {
            sum { requests }
            dimensions { actionType }
          }
        }
      }
    }
  `;
  const data = await fetchAdminCloudflareGraphql(token, query, { accountTag, dayStart, monthStart, today });
  const account = data?.viewer?.accounts?.[0] || {};
  return {
    day: sumAdminKvUsageRows(account.day || []),
    month: sumAdminKvUsageRows(account.month || [])
  };
}

async function fetchAdminCloudflareSubscriptions(token, accountTag) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountTag)}/subscriptions`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.success === false) {
    throw new Error('cloudflare_subscriptions_failed');
  }
  return Array.isArray(body?.result) ? body.result : [];
}

function isActiveAdminCloudflareSubscription(subscription = {}) {
  const state = String(subscription?.state || '').trim().toLowerCase();
  return !['cancelled', 'failed', 'expired'].includes(state);
}

function adminCloudflareSubscriptionText(subscription = {}) {
  const plan = subscription?.rate_plan || {};
  return [
    subscription?.id,
    subscription?.price,
    plan?.id,
    plan?.public_name,
    plan?.scope,
    ...(Array.isArray(plan?.sets) ? plan.sets : [])
  ].map((value) => String(value || '').toLowerCase()).join(' ');
}

function adminCloudflareSubscriptionMatchesWorkers(subscription = {}) {
  return /\bworkers?\b/.test(adminCloudflareSubscriptionText(subscription));
}

function detectAdminCloudflarePlanFromSubscriptions(subscriptions = []) {
  const activeSubscriptions = (Array.isArray(subscriptions) ? subscriptions : [])
    .filter(isActiveAdminCloudflareSubscription);
  const workerSubscription = activeSubscriptions.find(adminCloudflareSubscriptionMatchesWorkers);
  if (!workerSubscription) return { planKey: 'free', planSource: 'cloudflare-subscriptions' };
  const text = adminCloudflareSubscriptionText(workerSubscription);
  const price = Number(workerSubscription?.price);
  if (/\b(free|workers_free)\b/.test(text)) return { planKey: 'free', planSource: 'cloudflare-subscriptions' };
  if (/\b(paid|standard|workers_paid)\b/.test(text) || (Number.isFinite(price) && price > 0)) {
    return { planKey: 'standard', planSource: 'cloudflare-subscriptions' };
  }
  return { planKey: 'unknown', planSource: 'cloudflare-subscriptions' };
}

async function detectAdminCloudflarePlan(token, accountTag, configuredPlanKey) {
  if (configuredPlanKey && configuredPlanKey !== 'unknown') {
    return { planKey: configuredPlanKey, planSource: 'configured' };
  }
  try {
    return detectAdminCloudflarePlanFromSubscriptions(await fetchAdminCloudflareSubscriptions(token, accountTag));
  } catch (_error) {
    return { planKey: configuredPlanKey || 'unknown', planSource: 'unavailable' };
  }
}

function adminCloudflarePlanMetrics(env, planKey, usage, thresholds) {
  const plan = ADMIN_CLOUDFLARE_PLAN_CATALOG[planKey] || ADMIN_CLOUDFLARE_PLAN_CATALOG.unknown;
  const paidPlan = planKey === 'standard';
  const period = paidPlan ? 'monthly' : 'daily';
  const workersUsage = paidPlan ? usage?.workers?.month : usage?.workers?.day;
  const kvUsage = paidPlan ? usage?.kv?.month : usage?.kv?.day;
  const suffix = paidPlan ? 'MONTHLY' : 'DAILY';
  const labelSuffix = paidPlan ? 'this month' : 'today';

  return [
    adminPlanMetric({
      id: 'cloudflare-workers-requests',
      label: 'Workers requests',
      period,
      used: workersUsage?.requests,
      limit: adminPlanLimit(env, `CLOUDFLARE_WORKERS_REQUESTS_${suffix}_LIMIT`, paidPlan ? plan.workerRequestsMonthly : plan.workerRequestsDaily),
      unit: 'requests',
      source: 'Cloudflare GraphQL Analytics',
      help: `Worker invocation requests ${labelSuffix}.`
    }, thresholds),
    adminPlanMetric({
      id: 'cloudflare-kv-reads',
      label: 'KV reads',
      period,
      used: kvUsage?.reads,
      limit: adminPlanLimit(env, `CLOUDFLARE_KV_READS_${suffix}_LIMIT`, paidPlan ? plan.kvReadsMonthly : plan.kvReadsDaily),
      unit: 'operations',
      source: 'Cloudflare GraphQL Analytics',
      help: `Workers KV read operations ${labelSuffix}.`
    }, thresholds),
    adminPlanMetric({
      id: 'cloudflare-kv-writes',
      label: 'KV writes',
      period,
      used: kvUsage?.writes,
      limit: adminPlanLimit(env, `CLOUDFLARE_KV_WRITES_${suffix}_LIMIT`, paidPlan ? plan.kvWritesMonthly : plan.kvWritesDaily),
      unit: 'operations',
      source: 'Cloudflare GraphQL Analytics',
      help: `Workers KV write operations ${labelSuffix}.`
    }, thresholds),
    adminPlanMetric({
      id: 'cloudflare-kv-deletes',
      label: 'KV deletes',
      period,
      used: kvUsage?.deletes,
      limit: adminPlanLimit(env, `CLOUDFLARE_KV_DELETES_${suffix}_LIMIT`, paidPlan ? plan.kvDeletesMonthly : plan.kvDeletesDaily),
      unit: 'operations',
      source: 'Cloudflare GraphQL Analytics',
      help: `Workers KV delete operations ${labelSuffix}.`
    }, thresholds),
    adminPlanMetric({
      id: 'cloudflare-kv-lists',
      label: 'KV list operations',
      period,
      used: kvUsage?.lists,
      limit: adminPlanLimit(env, `CLOUDFLARE_KV_LISTS_${suffix}_LIMIT`, paidPlan ? plan.kvListsMonthly : plan.kvListsDaily),
      unit: 'operations',
      source: 'Cloudflare GraphQL Analytics',
      help: `Workers KV list operations ${labelSuffix}.`
    }, thresholds)
  ];
}

async function buildAdminCloudflarePlanUsage(env, thresholds) {
  const configuredPlanKey = adminConfiguredCloudflarePlanKey(env);
  const token = String(env.CLOUDFLARE_USAGE_API_TOKEN || env.CLOUDFLARE_ANALYTICS_API_TOKEN || '').trim();
  const accountTag = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const scriptName = String(env.CLOUDFLARE_WORKER_SCRIPT_NAME || env.WORKER_SCRIPT_NAME || '').trim();
  let planKey = configuredPlanKey || 'unknown';
  let planSource = configuredPlanKey ? 'configured' : 'unknown';
  let status = 'ok';
  let statusMessage = 'Usage refreshed from Cloudflare GraphQL Analytics.';
  let usage = null;

  if (!token || !accountTag) {
    status = 'missing_credentials';
    statusMessage = 'Add CLOUDFLARE_USAGE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to refresh Cloudflare usage.';
  } else {
    try {
      const [workers, kv, detectedPlan] = await Promise.all([
        fetchAdminCloudflareWorkersUsage(token, accountTag, scriptName),
        fetchAdminCloudflareKvUsage(token, accountTag),
        detectAdminCloudflarePlan(token, accountTag, configuredPlanKey)
      ]);
      usage = { workers, kv };
      planKey = detectedPlan?.planKey || planKey;
      planSource = detectedPlan?.planSource || planSource;
    } catch (_error) {
      status = 'unavailable';
      statusMessage = 'Cloudflare usage could not be refreshed. Check the read-only analytics token and account scope.';
    }
  }
  const plan = ADMIN_CLOUDFLARE_PLAN_CATALOG[planKey] || ADMIN_CLOUDFLARE_PLAN_CATALOG.unknown;

  return {
    id: 'cloudflare',
    name: 'Cloudflare',
    planName: plan.label,
    planKey,
    planSource,
    status,
    statusMessage,
    upgradeUrl: plan.upgradeUrl,
    scope: scriptName ? `Worker script: ${scriptName}` : 'Account-wide Workers and KV usage',
    metrics: adminCloudflarePlanMetrics(env, planKey, usage, thresholds),
    sources: [ADMIN_PLAN_USAGE_SOURCE_URLS.cloudflareWorkers, ADMIN_PLAN_USAGE_SOURCE_URLS.cloudflareKv]
  };
}

function parseResendQuotaHeader(value) {
  const numbers = String(value || '').match(/[\d,]+/g);
  if (!numbers || !numbers.length) return null;
  const used = Number(String(numbers[0] || '').replace(/,/g, ''));
  const limit = numbers.length > 1 ? Number(String(numbers[1] || '').replace(/,/g, '')) : null;
  return {
    used: Number.isFinite(used) ? used : null,
    limit: Number.isFinite(limit) ? limit : null
  };
}

function formatAdminPlanInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : String(value || '');
}

function detectAdminResendPlanFromMonthlyLimit(limit, planSource) {
  const monthlyLimit = adminUsageNumber(limit);
  if (monthlyLimit === null || monthlyLimit <= 0) return null;
  const matchingPlanEntry = Object.entries(ADMIN_RESEND_PLAN_CATALOG)
    .find(([, plan]) => plan.emailsMonthly === monthlyLimit);
  if (matchingPlanEntry) {
    return {
      planKey: matchingPlanEntry[0],
      planName: matchingPlanEntry[1].label,
      planSource
    };
  }
  return {
    planKey: 'paid',
    planName: `${formatAdminPlanInteger(monthlyLimit)} emails / mo`,
    planSource
  };
}

function detectAdminResendPlan(env, usage) {
  const configuredPlanKey = adminConfiguredResendPlanKey(env);
  if (configuredPlanKey && configuredPlanKey !== 'unknown') {
    const configuredPlan = ADMIN_RESEND_PLAN_CATALOG[configuredPlanKey] || ADMIN_RESEND_PLAN_CATALOG.unknown;
    return { planKey: configuredPlanKey, planName: configuredPlan.label, planSource: 'configured' };
  }
  const monthlyHeader = parseResendQuotaHeader(usage?.monthlyQuota);
  const dailyHeader = parseResendQuotaHeader(usage?.dailyQuota);
  if (dailyHeader && dailyHeader.used !== null) {
    return { planKey: 'free', planName: ADMIN_RESEND_PLAN_CATALOG.free.label, planSource: 'resend-quota-headers' };
  }
  if (monthlyHeader && monthlyHeader.limit !== null) {
    return detectAdminResendPlanFromMonthlyLimit(monthlyHeader.limit, 'resend-quota-headers');
  }
  const configuredMonthlyPlan = detectAdminResendPlanFromMonthlyLimit(env.RESEND_EMAILS_MONTHLY_LIMIT, 'configured-limit');
  if (configuredMonthlyPlan) {
    return configuredMonthlyPlan;
  }
  if (monthlyHeader && monthlyHeader.used !== null) {
    return { planKey: 'paid', planName: ADMIN_RESEND_PLAN_CATALOG.paid.label, planSource: 'resend-quota-headers' };
  }
  return {
    planKey: configuredPlanKey || 'unknown',
    planName: (ADMIN_RESEND_PLAN_CATALOG[configuredPlanKey] || ADMIN_RESEND_PLAN_CATALOG.unknown).label,
    planSource: configuredPlanKey ? 'configured' : 'unknown'
  };
}

function adminResendPlanMetrics(env, planKey, usage, thresholds) {
  const plan = ADMIN_RESEND_PLAN_CATALOG[planKey] || ADMIN_RESEND_PLAN_CATALOG.unknown;
  const monthlyHeader = parseResendQuotaHeader(usage?.monthlyQuota);
  const dailyHeader = parseResendQuotaHeader(usage?.dailyQuota);
  const rateLimit = adminUsageNumber(usage?.rateLimit);
  const rateRemaining = adminUsageNumber(usage?.rateRemaining);
  const metrics = [
    adminPlanMetric({
      id: 'resend-monthly-emails',
      label: 'Monthly emails',
      period: 'monthly',
      used: monthlyHeader?.used,
      limit: adminPlanLimit(env, 'RESEND_EMAILS_MONTHLY_LIMIT', monthlyHeader?.limit ?? plan.emailsMonthly),
      unit: 'emails',
      source: 'Resend quota headers',
      help: 'Sent and received emails counted against the current monthly quota.'
    }, thresholds)
  ];

  if (dailyHeader && dailyHeader.used !== null) {
    metrics.push(adminPlanMetric({
      id: 'resend-daily-emails',
      label: 'Daily emails',
      period: 'daily',
      used: dailyHeader?.used,
      limit: adminPlanLimit(env, 'RESEND_EMAILS_DAILY_LIMIT', dailyHeader?.limit ?? plan.emailsDaily),
      unit: 'emails',
      source: 'Resend quota headers',
      help: 'Daily email quota usage. Resend only sends this header for free-plan accounts.'
    }, thresholds));
  } else if (['paid', 'pro', 'scale'].includes(planKey)) {
    metrics.push(adminPlanMetric({
      id: 'resend-daily-emails',
      label: 'Daily emails',
      period: 'daily',
      unlimited: true,
      unit: 'emails',
      source: 'Resend quota headers',
      help: 'Paid Resend transactional plans do not have a daily email quota.'
    }, thresholds));
  }

  if (rateLimit !== null && rateLimit > 0) {
    metrics.push(adminPlanMetric({
      id: 'resend-api-rate-window',
      label: 'API rate window',
      period: 'rate_limit',
      used: rateRemaining === null ? null : Math.max(0, rateLimit - rateRemaining),
      limit: rateLimit,
      unit: 'requests',
      source: 'Resend rate-limit headers',
      help: usage?.rateReset ? `Current API rate-limit window. Resets at ${usage.rateReset}.` : 'Current API rate-limit window.'
    }, thresholds));
  }

  return metrics;
}

async function fetchAdminResendUsage(apiKey) {
  const response = await fetch('https://api.resend.com/emails?limit=1', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json'
    }
  });
  if (!response.ok && response.status !== 429) {
    throw new Error('resend_usage_failed');
  }
  return {
    dailyQuota: response.headers.get('x-resend-daily-quota') || '',
    monthlyQuota: response.headers.get('x-resend-monthly-quota') || '',
    rateLimit: response.headers.get('ratelimit-limit') || '',
    rateRemaining: response.headers.get('ratelimit-remaining') || '',
    rateReset: response.headers.get('ratelimit-reset') || response.headers.get('retry-after') || ''
  };
}

async function buildAdminResendPlanUsage(env, thresholds) {
  let detectedPlan = detectAdminResendPlan(env, null);
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  let status = 'ok';
  let statusMessage = 'Usage refreshed from Resend response headers.';
  let usage = null;

  if (!apiKey) {
    status = 'missing_credentials';
    statusMessage = 'Add RESEND_API_KEY to refresh Resend usage.';
  } else {
    try {
      usage = await fetchAdminResendUsage(apiKey);
      detectedPlan = detectAdminResendPlan(env, usage);
    } catch (_error) {
      status = 'unavailable';
      statusMessage = 'Resend usage could not be refreshed. Check the API key and rate limits.';
    }
  }

  return {
    id: 'resend',
    name: 'Resend',
    planName: detectedPlan.planName,
    planKey: detectedPlan.planKey,
    planSource: detectedPlan.planSource,
    status,
    statusMessage,
    upgradeUrl: (ADMIN_RESEND_PLAN_CATALOG[detectedPlan.planKey] || ADMIN_RESEND_PLAN_CATALOG.paid).upgradeUrl,
    links: [{
      label: 'Usage',
      url: ADMIN_PLAN_USAGE_SOURCE_URLS.resendUsage
    }],
    scope: 'Team email quota',
    metrics: adminResendPlanMetrics(env, detectedPlan.planKey, usage, thresholds),
    sources: [ADMIN_PLAN_USAGE_SOURCE_URLS.resendRateLimit, ADMIN_PLAN_USAGE_SOURCE_URLS.resendPricing]
  };
}

async function handleAdminPlanUsage(request, env) {
  const auth = await requireAdminSession(request, env, 'settings:publish');
  if (!auth.ok) return auth.response;
  const thresholds = adminPlanUsageThresholds(env);
  const [cloudflare, resend] = await Promise.all([
    buildAdminCloudflarePlanUsage(env, thresholds),
    buildAdminResendPlanUsage(env, thresholds)
  ]);
  return privateJsonResponse({
    user: auth.user,
    thresholds,
    providers: [cloudflare, resend],
    writeBudget: adminReadBudget(),
    generatedAt: new Date().toISOString()
  }, 200, env);
}

async function handleAdminSettings(request, env) {
  const auth = await requireAdminSession(request, env, 'store:read');
  if (!auth.ok) return auth.response;

  const sections = [];
  const adminLang = preferredAdminSettingsLang(request);
  const canonicalSiteBase = env.CANONICAL_SITE_BASE || env.SITE_BASE;
  const canonicalWorkerBase = env.CANONICAL_WORKER_BASE || env.WORKER_BASE;
  const seoSameAs = parseAdminDelimitedList(env.SEO_SAME_AS);
  const platformLogoPath = env.EMAIL_LOGO_PATH || '/assets/images/defaults/dust-wave-square.png';
  const platformFooterLogoPath = env.PLATFORM_FOOTER_LOGO_PATH || platformLogoPath;
  const platformFaviconPath = env.PLATFORM_FAVICON_PATH || '/assets/icons/favicon.png';
  const platformDefaultSocialImagePath = env.PLATFORM_DEFAULT_SOCIAL_IMAGE_PATH || platformLogoPath;
  const seoReturnPolicyCountry = env.SEO_RETURN_POLICY_APPLICABLE_COUNTRY || env.SHIPPING_ORIGIN_COUNTRY || 'US';
  const seoReturnPolicyCategory = env.SEO_RETURN_POLICY_CATEGORY || 'https://schema.org/MerchantReturnFiniteReturnWindow';
  const seoMerchantReturnDays = Number.parseInt(String(env.SEO_MERCHANT_RETURN_DAYS || '14'), 10) || 14;
  const seoReturnFees = env.SEO_RETURN_FEES || 'https://schema.org/ReturnFeesCustomerResponsibility';
  const seoReturnMethod = env.SEO_RETURN_METHOD || 'https://schema.org/ReturnByMail';
  const defaultMarketingShareTitle = env.MARKETING_SHARE_TITLE || env.PLATFORM_NAME || env.SITE_TITLE || 'Store';
  const defaultMarketingShareText = env.MARKETING_SHARE_TEXT || env.SITE_DESCRIPTION || '';
  const addOnsEnabled = String(env.ADD_ONS_ENABLED ?? 'true').toLowerCase() !== 'false';
  const addOnProductCount = Math.max(1, Math.min(5, Number.parseInt(String(env.ADD_ON_PRODUCT_COUNT || '3'), 10) || 3));

  if (auth.user.role === 'super_admin') {
    sections.push(
      adminSettingsSection('Platform', [
        ['Site title', env.SITE_TITLE || env.PLATFORM_NAME, editableAdminSetting('title')],
        ['Name', env.PLATFORM_NAME, editableAdminSetting('platform.name')],
        ['Company', env.PLATFORM_COMPANY_NAME, editableAdminSetting('platform.company_name')],
        ['Site author', env.PLATFORM_AUTHOR, editableAdminSetting('author')],
        ['Default creator name', env.PLATFORM_DEFAULT_CREATOR_NAME || env.PLATFORM_COMPANY_NAME || env.PLATFORM_AUTHOR, editableAdminSetting('platform.default_creator_name')],
        ['Default timezone', getPlatformTimeZone(env), editableAdminSetting('platform.timezone')],
        ['Support email', env.SUPPORT_EMAIL, editableAdminSetting('platform.support_email')],
        ['Site description', env.SITE_DESCRIPTION, editableAdminSetting('description')],
        ['Orders email from', env.ORDERS_EMAIL_FROM, editableAdminSetting('platform.orders_email_from')],
        ['Updates email from', env.UPDATES_EMAIL_FROM, editableAdminSetting('platform.updates_email_from')],
        ['Add-ons Enabled', addOnsEnabled, editableAdminSetting('add_ons.enabled', 'boolean')],
        ['Add-on product count', addOnProductCount, editableAdminSetting('add_ons.product_count', 'number')],
        ['App mode', env.APP_MODE, readOnlyAdminSettingHelp('The runtime environment mode currently used by the Worker, such as live or test.')]
      ]),
      adminSettingsSection('Brand & SEO', [
        ['Logo', platformLogoPath, editableAdminSetting('platform.logo_path')],
        ['Footer logo', platformFooterLogoPath, editableAdminSetting('platform.footer_logo_path')],
        ['Favicon', platformFaviconPath, editableAdminSetting('platform.favicon_path', 'string', adminLang)],
        ['Default social image', platformDefaultSocialImagePath, editableAdminSetting('platform.default_social_image_path', 'string', adminLang)],
        ['X handle', env.SEO_X_HANDLE, editableAdminSetting('seo.x_handle', 'string', adminLang)],
        ['Default social image alt', env.SEO_DEFAULT_SOCIAL_IMAGE_ALT || env.PLATFORM_NAME, editableAdminSetting('seo.default_social_image_alt', 'string', adminLang)],
        ['Same-as links', seoSameAs, editableAdminSetting('seo.same_as', 'list', adminLang)],
        ['Return policy country', seoReturnPolicyCountry, editableAdminSetting('seo.merchant_return_policy.applicable_country', 'string', adminLang)],
        ['Return policy type', seoReturnPolicyCategory, editableAdminSetting('seo.merchant_return_policy.return_policy_category', 'string', adminLang)],
        ['Return window days', seoMerchantReturnDays, editableAdminSetting('seo.merchant_return_policy.merchant_return_days', 'number', adminLang)],
        ['Return fees', seoReturnFees, editableAdminSetting('seo.merchant_return_policy.return_fees', 'string', adminLang)],
        ['Return method', seoReturnMethod, editableAdminSetting('seo.merchant_return_policy.return_method', 'string', adminLang)]
      ], adminLang),
      adminSettingsSection('Canonical URLs', [
        ['Production site URL', canonicalSiteBase, editableAdminSetting('platform.site_url')],
        ['Production Worker URL', canonicalWorkerBase, editableAdminSetting('platform.worker_url')]
      ]),
      adminSettingsSection('Checkout', [
        ['Stripe publishable key', env.STRIPE_PUBLISHABLE_KEY || '', editableAdminSetting('checkout.stripe_publishable_key')]
      ]),
      adminSettingsSection('Pricing', [
        ['Sales Tax Rate', env.SALES_TAX_RATE, editableAdminSetting('pricing.sales_tax_rate', 'number')],
        ['Default Platform Tip Percent', env.DEFAULT_PLATFORM_TIP_PERCENT, editableAdminSetting('pricing.default_tip_percent', 'number')],
        ['Max Platform Tip Percent', env.MAX_PLATFORM_TIP_PERCENT, editableAdminSetting('pricing.max_tip_percent', 'number')]
      ]),
      adminSettingsSection('Tax', [
        ['Provider', env.TAX_PROVIDER, editableAdminSetting('tax.provider')],
        ['Origin country', env.TAX_ORIGIN_COUNTRY, editableAdminSetting('tax.origin_country')],
        ['Use regional origin', env.TAX_USE_REGIONAL_ORIGIN, editableAdminSetting('tax.use_regional_origin', 'boolean')],
        ['New Mexico GRT API base', env.NM_GRT_API_BASE, editableAdminSetting('tax.nm_grt_api_base')],
        ['ZIP.TAX API base', env.ZIP_TAX_API_BASE, editableAdminSetting('tax.zip_tax_api_base')]
      ]),
      adminSettingsSection('Shipping', [
        ['Origin postal code', env.SHIPPING_ORIGIN_ZIP, editableAdminSetting('shipping.origin_zip')],
        ['Origin country', env.SHIPPING_ORIGIN_COUNTRY, editableAdminSetting('shipping.origin_country')],
        ['Fallback Shipping Fee (USD)', env.SHIPPING_FALLBACK_FLAT_RATE, editableAdminSetting('shipping.fallback_flat_rate', 'number')],
        ['Free shipping default', env.FREE_SHIPPING_DEFAULT, editableAdminSetting('shipping.free_shipping_default', 'boolean')],
        ['Default shipping option', env.SHIPPING_DEFAULT_OPTION || 'standard', editableAdminSetting('shipping.default_option')],
        ['USPS enabled', env.USPS_ENABLED, editableAdminSetting('shipping.usps.enabled', 'boolean')],
        ['USPS client ID', env.USPS_CLIENT_ID, editableAdminSetting('shipping.usps.client_id')],
        ['USPS API base', env.USPS_API_BASE, editableAdminSetting('shipping.usps.api_base')],
        ['USPS timeout ms', env.USPS_TIMEOUT_MS, editableAdminSetting('shipping.usps.timeout_ms', 'number')],
        ['USPS quote cache TTL seconds', env.USPS_QUOTE_CACHE_TTL_SECONDS, editableAdminSetting('shipping.usps.quote_cache_ttl_seconds', 'number')],
        ['USPS failure cooldown seconds', env.USPS_FAILURE_COOLDOWN_SECONDS, editableAdminSetting('shipping.usps.failure_cooldown_seconds', 'number')],
        ['USPS rate limit cooldown seconds', env.USPS_RATE_LIMIT_COOLDOWN_SECONDS, editableAdminSetting('shipping.usps.rate_limit_cooldown_seconds', 'number')]
      ]),
      adminSettingsSection('Marketing', [
        ['Default UTM source', env.MARKETING_DEFAULT_UTM_SOURCE || 'dustwave', editableAdminSetting('marketing.default_utm_source')],
        ['Default UTM medium', env.MARKETING_DEFAULT_UTM_MEDIUM || 'social', editableAdminSetting('marketing.default_utm_medium')],
        ['Default UTM campaign', env.MARKETING_DEFAULT_UTM_CAMPAIGN || 'shop', editableAdminSetting('marketing.default_utm_campaign')],
        ['Default UTM content', env.MARKETING_DEFAULT_UTM_CONTENT || '', editableAdminSetting('marketing.default_utm_content')],
        ['Default referral code', env.MARKETING_DEFAULT_REF || '', editableAdminSetting('marketing.default_ref')],
        ['Landing page path', env.MARKETING_LANDING_PAGE_PATH || '/', editableAdminSetting('marketing.landing_page_path')],
        ['Share title', defaultMarketingShareTitle, editableAdminSetting('marketing.share_title')],
        ['Share text', defaultMarketingShareText, editableAdminSetting('marketing.share_text')]
      ]),
      adminSettingsSection('Design', [
        ['Layout max width', env.DESIGN_LAYOUT_MAX_WIDTH || '1000px', editableAdminSetting('design.layout_max_width')],
        ['Body font', env.EMAIL_FONT_FAMILY, editableAdminSetting('design.font_body')],
        ['Heading font', env.EMAIL_HEADING_FONT_FAMILY, editableAdminSetting('design.font_display')],
        ['Text Color', env.EMAIL_COLOR_TEXT, editableAdminSetting('design.color_text')],
        ['Muted Color', env.EMAIL_COLOR_MUTED, editableAdminSetting('design.color_text_muted')],
        ['Surface Color', env.EMAIL_COLOR_SURFACE, editableAdminSetting('design.color_surface_subtle')],
        ['Border Color', env.EMAIL_COLOR_BORDER, editableAdminSetting('design.color_border')],
        ['Primary Color', env.EMAIL_COLOR_PRIMARY, editableAdminSetting('design.color_primary')],
        ['Button Radius', env.EMAIL_BUTTON_RADIUS, editableAdminSetting('design.radius_lg')]
      ]),
      adminSettingsSection('Users', [
        ['Users', await adminUserSettingsRows(env), {
          ...editableAdminSetting('admin.users', 'admin_users'),
          accessOptions: adminAccessOptions(),
          currentUserEmail: auth.user.email
        }]
      ]),
      adminSettingsSection('Store readiness', [
        ['Store readiness', '', {
          input: 'store-readiness',
          hideLabel: true
        }]
      ]),
      adminSettingsSection('Plan usage', [
        ['Plan usage', '', {
          input: 'plan-usage',
          hideLabel: true
        }]
      ]),
      adminSettingsSection('Advanced performance', [
        ['Intent prefetch enabled', env.INTENT_PREFETCH_ENABLED ?? 'true', editableAdminSetting('performance.intent_prefetch_enabled', 'boolean')],
        ['Intent prefetch delay ms', env.INTENT_PREFETCH_DELAY_MS || '90', editableAdminSetting('performance.intent_prefetch_delay_ms', 'number')],
        ['Intent prefetch limit', env.INTENT_PREFETCH_LIMIT || '3', editableAdminSetting('performance.intent_prefetch_limit', 'number')],
        ['Live inventory cache TTL seconds', env.LIVE_INVENTORY_CACHE_TTL_SECONDS || '300', editableAdminSetting('cache.live_inventory_ttl_seconds', 'number')]
      ]),
      adminSettingsSection('Debug', [
        ['Console logging enabled', env.DEBUG_CONSOLE_LOGGING_ENABLED, editableAdminSetting('debug.console_logging_enabled', 'boolean')],
        ['Verbose console logging', env.DEBUG_VERBOSE_CONSOLE_LOGGING, editableAdminSetting('debug.verbose_console_logging', 'boolean')]
      ]),
      adminSettingsSection('Secrets & credentials', adminSecretStatusRows(env)),
      adminSettingsSection('Runtime diagnostics', [
        ['Current site base', env.SITE_BASE, readOnlyAdminSettingHelp('The site origin the current Worker runtime is configured to trust for browser requests.')],
        ['Current Worker base', env.WORKER_BASE, readOnlyAdminSettingHelp('The Worker API base URL used by the current runtime environment.')],
        ['CORS allowed origin', env.CORS_ALLOWED_ORIGIN, readOnlyAdminSettingHelp('The browser origin allowed to make credentialed admin and checkout requests to the Worker.')]
      ])
    );
  }

  return privateJsonResponse({
    user: auth.user,
    scope: auth.user.role === 'super_admin' ? 'platform' : 'store',
    sections,
    writeBudget: adminReadBudget(),
    generatedAt: new Date().toISOString()
  }, 200, env);
}

const ADMIN_TEXT_DEFAULT_MAX_LENGTH = 500;
const ADMIN_URL_MAX_LENGTH = 2048;
const ADMIN_FONT_STACK_MAX_LENGTH = 200;
const ADMIN_CSS_LENGTH_MAX_LENGTH = 50;
const ADMIN_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ADMIN_DATE_TIME_REGEX = /^\d{4}-\d{2}-\d{2}(?:[T ][0-2]\d:[0-5]\d(?::[0-5]\d)?(?:Z|[+-][0-2]\d:[0-5]\d)?)?$/;
const ADMIN_SAFE_SLUG_VALUES = /^[a-z0-9_-]+$/;

function stripAdminControlCharacters(value, { allowNewlines = false } = {}) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return allowNewlines
    ? text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    : text.replace(/[\u0000-\u001F\u007F]/g, '');
}

function hasAdminRawHtml(value) {
  const text = String(value || '');
  return /<!--|<\?|<\s*\/?\s*[a-z][^>]*>/i.test(text);
}

function normalizeAdminPlainText(value, label = 'Value', {
  maxLength = ADMIN_TEXT_DEFAULT_MAX_LENGTH,
  allowNewlines = false,
  allowRawHtml = false
} = {}) {
  const text = stripAdminControlCharacters(value, { allowNewlines }).trim();
  if (text.length > maxLength) return { ok: false, error: `${label} is too long.` };
  if (!allowRawHtml && hasAdminRawHtml(text)) {
    return { ok: false, error: `${label} cannot include raw HTML.` };
  }
  return { ok: true, value: text };
}

function normalizeAdminSlugValue(value, label = 'ID', { required = true } = {}) {
  const text = stripAdminControlCharacters(value).trim().toLowerCase();
  if (!text && !required) return { ok: true, value: '' };
  if (!isValidSlug(text)) return { ok: false, error: `${label} must use lowercase letters, numbers, and hyphens only.` };
  return { ok: true, value: text };
}

function slugifyAdminId(value, fallback = 'item') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function uniqueAdminId(base, usedIds) {
  const safeBase = slugifyAdminId(base, 'item');
  let candidate = safeBase;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${safeBase}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function normalizeAdminSafeToken(value, label = 'Value', { maxLength = 80, required = false } = {}) {
  const text = stripAdminControlCharacters(value).trim().toLowerCase();
  if (!text && !required) return { ok: true, value: '' };
  if (!text || text.length > maxLength || !ADMIN_SAFE_SLUG_VALUES.test(text)) {
    return { ok: false, error: `${label} must use letters, numbers, hyphens, or underscores only.` };
  }
  return { ok: true, value: text };
}

function isSafeAdminRootRelativePath(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('/') || text.startsWith('//') || text.includes('\\')) return false;
  if (/[\u0000-\u001F\u007F<>"'`\s]/.test(text)) return false;
  const pathOnly = text.split(/[?#]/)[0];
  let decoded = pathOnly;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    return false;
  }
  return !decoded.split('/').some((segment) => segment === '..');
}

function normalizeAdminUrlReference(value, label = 'URL', {
  allowRelative = true,
  requireAbsolute = false
} = {}) {
  const text = stripAdminControlCharacters(value).trim();
  if (!text) return { ok: true, value: '' };
  if (text.length > ADMIN_URL_MAX_LENGTH) return { ok: false, error: `${label} is too long.` };
  if (/[\u0000-\u001F\u007F<>"'`\s]/.test(text)) return { ok: false, error: `${label} contains unsafe characters.` };
  if (text.startsWith('/')) {
    if (requireAbsolute || !allowRelative) return { ok: false, error: `${label} must be an absolute http or https URL.` };
    if (!isSafeAdminRootRelativePath(text)) return { ok: false, error: `${label} must be a safe root-relative path.` };
    return { ok: true, value: text };
  }
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, error: `${label} must use http or https.` };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, error: `${label} cannot include embedded credentials.` };
    }
    return { ok: true, value: parsed.toString() };
  } catch {
    return { ok: false, error: `${label} must be a valid URL.` };
  }
}

function normalizeAdminAssetReference(value, label = 'Asset') {
  return normalizeAdminUrlReference(value, label, { allowRelative: true });
}

function parseAdminExternalVideoReference(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (host === 'youtu.be') {
      const id = parts[0] || '';
      return /^[A-Za-z0-9_-]+$/.test(id) ? { provider: 'youtube', id } : null;
    }
    if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
      let id = parsed.pathname === '/watch' ? parsed.searchParams.get('v') || '' : '';
      if (!id && ['embed', 'shorts', 'live'].includes(parts[0])) id = parts[1] || '';
      return /^[A-Za-z0-9_-]+$/.test(id) ? { provider: 'youtube', id } : null;
    }
    if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
      const videoIndex = parts.indexOf('video');
      const id = videoIndex >= 0 && /^\d+$/.test(parts[videoIndex + 1] || '')
        ? parts[videoIndex + 1]
        : parts.find((part) => /^\d+$/.test(part));
      return id ? { provider: 'vimeo', id } : null;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeAdminHeroVideoReference(value, label = 'Hero video') {
  const normalized = normalizeAdminAssetReference(value, label);
  if (!normalized.ok || !normalized.value) return normalized;
  if (parseAdminExternalVideoReference(normalized.value)) return normalized;
  const path = normalized.value.startsWith('/')
    ? normalized.value.split(/[?#]/)[0]
    : new URL(normalized.value).pathname;
  if (/\.(mp4|webm|mov)$/i.test(path)) return normalized;
  return {
    ok: false,
    error: `${label} must be an uploaded MP4, WebM, or MOV video path, or a YouTube or Vimeo URL.`
  };
}

const ADMIN_MEDIA_CLEANUP_IMAGE_EXTENSIONS = new Set(['.gif', '.jpg', '.jpeg', '.png', '.webp']);
const ADMIN_MEDIA_CLEANUP_RESPONSIVE_IMAGE_EXTENSIONS = new Set(['.gif', '.jpg', '.jpeg', '.png']);
const ADMIN_MEDIA_CLEANUP_VIDEO_EXTENSIONS = new Set(['.m4v', '.mov', '.mp4', '.webm']);
const ADMIN_MEDIA_CLEANUP_SOURCE_VIDEO_EXTENSIONS = ['.m4v', '.mov', '.mp4'];
const ADMIN_MEDIA_CLEANUP_AUDIO_EXTENSIONS = new Set(['.aac', '.m4a', '.mp3', '.ogg', '.wav', '.webm']);
const ADMIN_MEDIA_CLEANUP_RESPONSIVE_WIDTHS = [320, 480, 640, 960, 1600];

function adminMediaPathExtension(repoPath) {
  const match = String(repoPath || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

function adminMediaCleanupCompanionPaths(repoPath) {
  const paths = new Set([repoPath]);
  const extension = adminMediaPathExtension(repoPath);
  const base = extension ? repoPath.slice(0, -extension.length) : repoPath;
  if (repoPath.startsWith('assets/images/') && ADMIN_MEDIA_CLEANUP_RESPONSIVE_IMAGE_EXTENSIONS.has(extension)) {
    ADMIN_MEDIA_CLEANUP_RESPONSIVE_WIDTHS.forEach((width) => paths.add(`${base}-${width}.webp`));
  }
  if (repoPath.startsWith('assets/videos/')) {
    if (ADMIN_MEDIA_CLEANUP_SOURCE_VIDEO_EXTENSIONS.includes(extension)) {
      paths.add(`${base}.webm`);
    } else if (extension === '.webm') {
      ADMIN_MEDIA_CLEANUP_SOURCE_VIDEO_EXTENSIONS.forEach((sourceExtension) => paths.add(`${base}${sourceExtension}`));
    }
  }
  return paths;
}

function isAdminPreviewAllowedLink(href) {
  const normalized = String(href || '').trim();
  if (!normalized || normalized.startsWith('../')) return false;
  if (normalized.startsWith('#') || normalized.startsWith('/') || normalized.startsWith('?') || normalized.startsWith('./')) {
    return true;
  }
  try {
    const parsed = new URL(normalized);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function collectAdminRichTextErrors(value, fieldName, { maxLength = 8000 } = {}) {
  const text = stripAdminControlCharacters(value, { allowNewlines: true }).trim();
  const errors = [];
  if (text.length > maxLength) errors.push(`${fieldName} is too long.`);
  if (/\bstyle\s*=\s*["']/i.test(text)) errors.push(`${fieldName} includes inline style attributes, which are not allowed.`);
  if (/<script\b/i.test(text)) errors.push(`${fieldName} includes raw <script> HTML, which is not allowed.`);
  const inlineEvents = text.match(/\son[a-z]+\s*=\s*["']/ig) || [];
  for (const match of inlineEvents) {
    errors.push(`${fieldName} includes an inline event handler (${match.trim()}).`);
  }
  if (/<iframe\b/i.test(text)) errors.push(`${fieldName} includes raw <iframe> HTML, which is not allowed.`);
  text.replace(/<\s*\/?\s*([a-z0-9]+)(?:\s[^>]*)?>/ig, (_match, tagName) => {
    const tag = String(tagName || '').toLowerCase();
    if (!ADMIN_CONTENT_ALLOWED_INLINE_TAGS.has(tag)) {
      errors.push(`${fieldName} includes raw <${tag}> HTML; use Markdown or approved content blocks instead.`);
    }
    return '';
  });
  text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, _label, href) => {
    if (!isAdminPreviewAllowedLink(href)) errors.push(`${fieldName} includes an unsafe link URL.`);
    return '';
  });
  return { text, errors };
}

function normalizeAdminRichTextStorageValue(value, label = 'Text', { maxLength = 8000, required = false } = {}) {
  const normalized = collectAdminRichTextErrors(value, label, { maxLength });
  if (required && !normalized.text) return { ok: false, error: `${label} is required.` };
  if (normalized.errors.length) return { ok: false, error: normalized.errors.join(' ') };
  return { ok: true, value: normalized.text };
}

function normalizeAdminStoreContentAlignment(value) {
  const align = String(value || '').trim().toLowerCase();
  return ADMIN_STORE_CONTENT_ALLOWED_ALIGNMENTS.has(align) ? align : 'left';
}

function normalizeAdminStoreContentGalleryLayout(value) {
  const layout = String(value || '').trim().toLowerCase();
  return ADMIN_STORE_CONTENT_ALLOWED_GALLERY_LAYOUTS.has(layout) ? layout : 'grid';
}

function normalizeAdminStoreContentGalleryCaptionStyle(value) {
  const style = String(value || '').trim().toLowerCase();
  return ADMIN_STORE_CONTENT_ALLOWED_GALLERY_CAPTION_STYLES.has(style) ? style : 'inline';
}

function normalizeAdminStoreContentVideoProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  return ADMIN_STORE_CONTENT_ALLOWED_VIDEO_PROVIDERS.has(provider) ? provider : 'youtube';
}

function normalizeAdminStoreContentRichText(value, fieldName, errors, { required = false, maxLength = ADMIN_STORE_CONTENT_MAX_TEXT_LENGTH } = {}) {
  const normalized = normalizeAdminRichTextStorageValue(value, fieldName, { required, maxLength });
  if (!normalized.ok) {
    errors.push(normalized.error);
    return stripAdminControlCharacters(value, { allowNewlines: true }).trim();
  }
  return normalized.value;
}

function normalizeAdminStoreContentPlainText(value, fieldName, errors, { required = false, maxLength = 500 } = {}) {
  const normalized = normalizeAdminPlainText(value, fieldName, { maxLength });
  if (!normalized.ok) {
    errors.push(normalized.error);
    return stripAdminControlCharacters(value).trim();
  }
  if (required && !normalized.value) errors.push(`${fieldName} is required.`);
  return normalized.value;
}

function normalizeAdminStoreContentAsset(value, fieldName, errors, { required = false } = {}) {
  const normalized = normalizeAdminAssetReference(value, fieldName);
  if (!normalized.ok) {
    errors.push(normalized.error);
    return stripAdminControlCharacters(value).trim();
  }
  if (required && !normalized.value) errors.push(`${fieldName} is required.`);
  return normalized.value;
}

function isApprovedAdminStoreEmbedSrc(provider, src) {
  try {
    const parsed = new URL(String(src || '').trim());
    if (parsed.protocol !== 'https:') return false;
    if (provider === 'spotify') return parsed.host === 'open.spotify.com' && parsed.pathname.startsWith('/embed/');
    if (provider === 'youtube') {
      return (parsed.host === 'www.youtube.com' || parsed.host === 'www.youtube-nocookie.com') && parsed.pathname.startsWith('/embed/');
    }
    if (provider === 'vimeo') return parsed.host === 'player.vimeo.com' && parsed.pathname.startsWith('/video/');
  } catch {
    return false;
  }
  return false;
}

function validateAdminStoreContentBlock(block, index, errors, warnings) {
  const path = `longContent[${index}]`;
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    errors.push(`${path} must be an object.`);
    return null;
  }

  const type = String(block.type || '').trim();
  if (!ADMIN_STORE_CONTENT_ALLOWED_BLOCK_TYPES.has(type)) {
    errors.push(`${path}.type is not supported.`);
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(block, 'html')) {
    errors.push(`${path}.html is not allowed; use structured blocks instead.`);
  }

  if (type === 'text') {
    return {
      type,
      body: normalizeAdminStoreContentRichText(block.body || '', `${path}.body`, errors, { required: true }),
      align: normalizeAdminStoreContentAlignment(block.align)
    };
  }

  if (type === 'video') {
    const provider = String(block.provider || '').trim().toLowerCase();
    if (!ADMIN_STORE_CONTENT_ALLOWED_VIDEO_PROVIDERS.has(provider)) errors.push(`${path}.provider must be youtube, vimeo, or local.`);
    const normalizedProvider = normalizeAdminStoreContentVideoProvider(provider);
    const videoId = normalizedProvider === 'local' ? '' : stripAdminControlCharacters(block.video_id || '').trim();
    if (normalizedProvider !== 'local' && !videoId) errors.push(`${path}.video_id is required.`);
    if (videoId && !/^[A-Za-z0-9_-]{3,128}$/.test(videoId)) errors.push(`${path}.video_id contains unsafe characters.`);
    const src = normalizedProvider === 'local'
      ? normalizeAdminStoreContentAsset(block.src || '', `${path}.src`, errors, { required: true })
      : '';
    const poster = normalizedProvider === 'local' && block.poster
      ? normalizeAdminStoreContentAsset(block.poster || '', `${path}.poster`, errors)
      : '';
    return {
      type,
      provider: normalizedProvider,
      ...(normalizedProvider === 'local' ? { src, ...(poster ? { poster } : {}) } : { video_id: videoId }),
      caption: normalizeAdminStoreContentRichText(block.caption || '', `${path}.caption`, errors, { maxLength: 1000 }),
      align: normalizeAdminStoreContentAlignment(block.align)
    };
  }

  if (type === 'image') {
    const src = normalizeAdminStoreContentAsset(block.src || '', `${path}.src`, errors, { required: true });
    const alt = normalizeAdminStoreContentPlainText(block.alt || '', `${path}.alt`, errors, { maxLength: 300 });
    if (!alt.trim()) warnings.push(`${path}.alt should describe the image.`);
    return {
      type,
      src,
      alt,
      caption: normalizeAdminStoreContentRichText(block.caption || '', `${path}.caption`, errors, { maxLength: 1000 }),
      align: normalizeAdminStoreContentAlignment(block.align)
    };
  }

  if (type === 'gallery') {
    const images = Array.isArray(block.images) ? block.images.slice(0, ADMIN_STORE_CONTENT_MAX_GALLERY_IMAGES) : [];
    if (!Array.isArray(block.images) || block.images.length === 0) errors.push(`${path}.images must include at least one image.`);
    if (Array.isArray(block.images) && block.images.length > ADMIN_STORE_CONTENT_MAX_GALLERY_IMAGES) {
      warnings.push(`${path}.images was limited to ${ADMIN_STORE_CONTENT_MAX_GALLERY_IMAGES} images.`);
    }
    return {
      type,
      layout: normalizeAdminStoreContentGalleryLayout(block.layout),
      caption_style: normalizeAdminStoreContentGalleryCaptionStyle(block.caption_style),
      images: images.map((image, imageIndex) => ({
        src: normalizeAdminStoreContentAsset(image?.src || '', `${path}.images[${imageIndex}].src`, errors, { required: true }),
        alt: normalizeAdminStoreContentPlainText(image?.alt || '', `${path}.images[${imageIndex}].alt`, errors, { maxLength: 300 }),
        caption: normalizeAdminStoreContentRichText(image?.caption || '', `${path}.images[${imageIndex}].caption`, errors, { maxLength: 1000 })
      })),
      caption: normalizeAdminStoreContentRichText(block.caption || '', `${path}.caption`, errors, { maxLength: 1000 }),
      align: normalizeAdminStoreContentAlignment(block.align)
    };
  }

  if (type === 'audio') {
    const src = normalizeAdminStoreContentAsset(block.src || '', `${path}.src`, errors, { required: true });
    const title = normalizeAdminStoreContentPlainText(block.title || '', `${path}.title`, errors, { maxLength: 200 });
    if (!title.trim()) warnings.push(`${path}.title helps make audio previews accessible.`);
    return {
      type,
      src,
      title,
      caption: normalizeAdminStoreContentRichText(block.caption || '', `${path}.caption`, errors, { maxLength: 1000 }),
      align: normalizeAdminStoreContentAlignment(block.align)
    };
  }

  if (type === 'embed') {
    const provider = String(block.provider || '').trim().toLowerCase();
    if (!ADMIN_STORE_CONTENT_ALLOWED_EMBED_PROVIDERS.has(provider)) {
      errors.push(`${path}.provider is not approved.`);
    }
    if (!isApprovedAdminStoreEmbedSrc(provider, block.src)) {
      errors.push(`${path}.src must be an approved ${provider || 'embed'} URL.`);
    }
    return {
      type,
      provider,
      src: String(block.src || '').trim(),
      title: normalizeAdminStoreContentPlainText(block.title || '', `${path}.title`, errors, { maxLength: 200 }),
      caption: normalizeAdminStoreContentRichText(block.caption || '', `${path}.caption`, errors, { maxLength: 1000 }),
      align: normalizeAdminStoreContentAlignment(block.align)
    };
  }

  if (type === 'quote') {
    return {
      type,
      text: normalizeAdminStoreContentRichText(block.text || '', `${path}.text`, errors, { required: true }),
      author: normalizeAdminStoreContentPlainText(block.author || '', `${path}.author`, errors, { maxLength: 200 }),
      align: normalizeAdminStoreContentAlignment(block.align)
    };
  }

  return { type, align: normalizeAdminStoreContentAlignment(block.align) };
}

function parseAdminStoreLongContent(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeAdminStoreLongContent(value) {
  const rawBlocks = parseAdminStoreLongContent(value);
  const errors = [];
  const warnings = [];
  if (rawBlocks.length > ADMIN_STORE_CONTENT_MAX_BLOCKS) {
    warnings.push(`longContent was limited to ${ADMIN_STORE_CONTENT_MAX_BLOCKS} blocks.`);
  }
  const blocks = rawBlocks
    .slice(0, ADMIN_STORE_CONTENT_MAX_BLOCKS)
    .map((block, index) => validateAdminStoreContentBlock(block, index, errors, warnings))
    .filter(Boolean);
  return { ok: errors.length === 0, value: blocks, errors, warnings };
}

function normalizeAdminCssFontStack(value, label = 'Font') {
  const normalized = normalizeAdminPlainText(value, label, { maxLength: ADMIN_FONT_STACK_MAX_LENGTH });
  if (!normalized.ok || !normalized.value) return normalized;
  if (/[;{}()<>\\]/.test(normalized.value) || /\b(?:url|expression)\s*\(/i.test(normalized.value) || !/^[A-Za-z0-9\s'",._-]+$/.test(normalized.value)) {
    return { ok: false, error: `${label} must be a simple CSS font stack without CSS functions or declarations.` };
  }
  return normalized;
}

function normalizeAdminCssLength(value, label = 'CSS length') {
  const normalized = normalizeAdminPlainText(value, label, { maxLength: ADMIN_CSS_LENGTH_MAX_LENGTH });
  if (!normalized.ok || !normalized.value) return normalized;
  if (!/^(?:0|[0-9]+(?:\.[0-9]+)?(?:px|rem|em|%)?)$/.test(normalized.value)) {
    return { ok: false, error: `${label} must be a CSS length like 6px, 0.5rem, or 50%.` };
  }
  return normalized;
}

function normalizeAdminUsers(value, schema = {}) {
  let users;
  try {
    users = Array.isArray(value) ? value : JSON.parse(String(value || '[]'));
  } catch {
    return { ok: false, error: `${schema.label || 'Users'} must be valid user JSON.` };
  }
  if (!Array.isArray(users)) return { ok: false, error: `${schema.label || 'Users'} must be a list.` };
  if (users.length > 100) return { ok: false, error: `${schema.label || 'Users'} can include at most 100 users.` };

  const availableAccessScopes = new Set((schema.availableAccessScopes || []).map((scope) => String(scope || '').trim()).filter(Boolean));
  const currentUserEmail = String(schema.currentUserEmail || '').trim().toLowerCase();
  const seenEmails = new Set();
  const superAdminEmails = new Set();
  const normalized = [];

  for (const [index, user] of users.entries()) {
    if (!user || typeof user !== 'object' || Array.isArray(user)) {
      return { ok: false, error: `User ${index + 1} must be an object.` };
    }
    const normalizedName = normalizeAdminPlainText(user.name || '', `User ${index + 1} name`, { maxLength: 100 });
    if (!normalizedName.ok) return normalizedName;
    const name = normalizedName.value;
    const email = String(user.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) return { ok: false, error: `User ${index + 1} needs a valid email address.` };
    if (seenEmails.has(email)) return { ok: false, error: `User email "${email}" is duplicated.` };
    seenEmails.add(email);

    const role = String(user.role || '').trim() === 'super_admin' ? 'super_admin' : 'limited_admin';
    const accessScopes = role === 'super_admin'
      ? []
      : normalizeAdminAccessScopes(user.accessScopes ?? user.access_scopes);
    if (role === 'limited_admin' && !accessScopes.length) {
      return { ok: false, error: `Limited admin "${email}" needs at least one access area.` };
    }
    const invalidScope = accessScopes.find((scope) => !isValidSlug(scope));
    if (invalidScope) return { ok: false, error: `User "${email}" references an invalid access area "${invalidScope}".` };
    const unknownScope = accessScopes.find((scope) => availableAccessScopes.size && !availableAccessScopes.has(scope));
    if (unknownScope) return { ok: false, error: `User "${email}" references unknown access area "${unknownScope}".` };
    if (role === 'super_admin') superAdminEmails.add(email);

    normalized.push({ name, email, role, accessScopes });
  }

  if (!superAdminEmails.size) return { ok: false, error: 'Users must include at least one super admin.' };
  if (currentUserEmail && !superAdminEmails.has(currentUserEmail)) {
    return { ok: false, error: 'Your account must stay a super admin before publishing user changes.' };
  }

  return { ok: true, value: normalized };
}

function normalizeAdminSettingsValue(value, schema = {}) {
  const label = schema.label || 'Value';
  if (schema.type === 'boolean') {
    if (value === true || value === 'true') return { ok: true, value: true };
    if (value === false || value === 'false') return { ok: true, value: false };
    return { ok: false, error: `${label} must be true or false.` };
  }
  if (schema.type === 'admin_users') {
    return normalizeAdminUsers(value, schema);
  }
  if (schema.type === 'add_on_products') {
    return normalizeAdminAddOnProducts(value, schema);
  }
  if (schema.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) return { ok: false, error: `${label} must be a number.` };
    if (schema.input === 'integer' && !Number.isInteger(number)) return { ok: false, error: `${label} must be a whole number.` };
    if (schema.min !== undefined && number < schema.min) return { ok: false, error: `${label} must be at least ${schema.min}.` };
    if (schema.max !== undefined && number > schema.max) return { ok: false, error: `${label} must be no more than ${schema.max}.` };
    return { ok: true, value: number };
  }
  if (schema.path === 'platform.timezone') {
    const text = stripAdminControlCharacters(value).trim();
    if (!isSupportedTimeZone(text)) {
      return { ok: false, error: `${label} must be a supported IANA timezone.` };
    }
    return { ok: true, value: text };
  }
  if (schema.input === 'select' && Array.isArray(schema.options) && schema.options.length > 0) {
    const text = String(value ?? '').trim();
    const allowed = new Set(schema.options.map((option) => String(option?.value ?? '').trim()));
    if (!allowed.has(text)) {
      return { ok: false, error: `${label} must be one of the available options.` };
    }
    return { ok: true, value: text };
  }
  if (schema.type === 'list') {
    const items = Array.isArray(value)
      ? value
      : String(value || '').split(/[\n,]+/);
    let normalizedItems = items.map((item) => stripAdminControlCharacters(item).trim()).filter(Boolean);
    if (Array.isArray(schema.options) && schema.options.length > 0) {
      const allowed = new Set(schema.options.map((option) => String(option?.value ?? '').trim()).filter(Boolean));
      const invalid = normalizedItems.find((item) => !allowed.has(item));
      if (invalid) return { ok: false, error: `${label} contains an unavailable option.` };
    }
    if (schema.input === 'email-list') {
      normalizedItems = normalizedItems.map((item) => item.toLowerCase());
      const invalid = normalizedItems.find((item) => !isValidEmail(item));
      if (invalid) return { ok: false, error: `${label} contains an invalid email address.` };
    }
    if (schema.input === 'url-list') {
      const normalizedUrls = [];
      for (const item of normalizedItems) {
        const normalizedUrl = normalizeAdminUrlReference(item, label, { allowRelative: false, requireAbsolute: true });
        if (!normalizedUrl.ok) return { ok: false, error: `${label} contains an invalid URL.` };
        normalizedUrls.push(normalizedUrl.value);
      }
      normalizedItems = normalizedUrls;
    } else {
      const invalid = normalizedItems.find((item) => hasAdminRawHtml(item));
      if (invalid) return { ok: false, error: `${label} cannot include raw HTML.` };
    }
    return {
      ok: true,
      value: normalizedItems
    };
  }
  const text = stripAdminControlCharacters(value, { allowNewlines: schema.input === 'textarea' }).trim();
  if (schema.input === 'date' && text && !ADMIN_DATE_REGEX.test(text)) {
    return { ok: false, error: `${label} must use YYYY-MM-DD.` };
  }
  if (schema.input === 'slug' && !isValidSlug(text)) {
    return { ok: false, error: `${label} must use lowercase letters, numbers, and hyphens only.` };
  }
  if (schema.input === 'color' && text && !/^#[0-9a-f]{6}$/i.test(text)) {
    return { ok: false, error: `${label} must use a hex color like #101215.` };
  }
  if (schema.input === 'url') {
    const requireAbsolute = [
      'platform.site_url',
      'platform.worker_url',
      'tax.nm_grt_api_base',
      'tax.zip_tax_api_base',
      'shipping.usps.api_base'
    ].includes(schema.path);
    return normalizeAdminUrlReference(text, label, { allowRelative: !requireAbsolute, requireAbsolute });
  }
  if (schema.input === 'video-upload' && schema.path === 'hero_video') {
    return normalizeAdminHeroVideoReference(text, label);
  }
  if (schema.input === 'image-upload' || schema.input === 'video-upload') {
    return normalizeAdminAssetReference(text, label);
  }
  if (schema.input === 'email' && text && !isValidEmail(text)) {
    return { ok: false, error: `${label} must be a valid email address.` };
  }
  if (schema.input === 'email') {
    return { ok: true, value: text };
  }
  if (schema.input === 'email-sender' && text) {
    if (text.length > 200 || /[\n\r]/.test(text) || /<\s*\/?\s*[a-z][^>]*>/i.test(text.replace(/<[^<>]+>$/, ''))) {
      return { ok: false, error: `${label} must be a single sender identity.` };
    }
    const senderEmail = text.match(/<([^<>]+)>$/)?.[1] || text;
    if (!isValidEmail(senderEmail.trim())) {
      return { ok: false, error: `${label} must be an email address or Name <email@example.com>.` };
    }
  }
  if (schema.input === 'email-sender') {
    return { ok: true, value: text };
  }
  if (schema.input === 'stripe-publishable-key' && text && !/^pk_(test|live)_[A-Za-z0-9_]+$/.test(text)) {
    return { ok: false, error: `${label} must start with pk_test_ or pk_live_.` };
  }
  if (schema.input === 'stripe-publishable-key') {
    return { ok: true, value: text };
  }
  if (schema.input === 'rich-text-inline') {
    return normalizeAdminRichTextStorageValue(text, label, { maxLength: 2000 });
  }
  if (schema.path === 'design.font_body' || schema.path === 'design.font_display') {
    return normalizeAdminCssFontStack(text, label);
  }
  if (schema.path === 'design.radius_lg' || schema.path === 'design.layout_max_width') {
    return normalizeAdminCssLength(text, label);
  }
  const maxLength = schema.input === 'textarea' ? 1000 : 500;
  const normalized = normalizeAdminPlainText(text, label, {
    maxLength,
    allowNewlines: schema.input === 'textarea'
  });
  if (!normalized.ok) {
    return normalized;
  }
  return { ok: true, value: normalized.value };
}

function normalizeAdminAddOnProducts(value, schema = {}) {
  let products;
  try {
    products = Array.isArray(value) ? value : JSON.parse(String(value || '[]'));
  } catch {
    return { ok: false, error: `${schema.label || 'Products'} must be valid product JSON.` };
  }
  if (!Array.isArray(products)) {
    return { ok: false, error: `${schema.label || 'Products'} must be a list.` };
  }
  if (products.length > 50) {
    return { ok: false, error: `${schema.label || 'Products'} can include at most 50 products.` };
  }

  const seen = new Set();
  const normalized = [];
  for (const [index, product] of products.entries()) {
    if (!product || typeof product !== 'object' || Array.isArray(product)) {
      return { ok: false, error: `Product ${index + 1} must be an object.` };
    }
    const idResult = normalizeAdminSlugValue(product.id || '', `Product ${index + 1} id`);
    if (!idResult.ok) return idResult;
    const id = idResult.value;
    if (seen.has(id)) return { ok: false, error: `Product id "${id}" is duplicated.` };
    seen.add(id);

    const normalizedName = normalizeAdminPlainText(product.name || '', `Product "${id}" name`, { maxLength: 120 });
    if (!normalizedName.ok) return normalizedName;
    const name = normalizedName.value;
    if (!name) return { ok: false, error: `Product "${id}" needs a name.` };
    const category = String(product.category || 'physical').trim().toLowerCase();
    if (!['physical', 'digital'].includes(category)) return { ok: false, error: `Product "${id}" category must be physical or digital.` };
    const price = Number(product.price);
    if (!Number.isFinite(price) || price < 0) return { ok: false, error: `Product "${id}" needs a non-negative price.` };
    const description = normalizeAdminRichTextStorageValue(product.description || '', `Product "${id}" description`, { maxLength: 2000 });
    if (!description.ok) return description;
    const imageUrl = normalizeAdminAssetReference(product.image_url || product.imageUrl || '', `Product "${id}" image`);
    if (!imageUrl.ok) return imageUrl;

    const normalizedProduct = {
      id,
      name,
      description: description.value,
      image_url: imageUrl.value,
      price: Number(price.toFixed(2)),
      category
    };
    const shippingPresetResult = normalizeAdminSafeToken(product.shipping_preset || product.shippingPreset || '', `Product "${id}" shipping preset`);
    if (!shippingPresetResult.ok) return shippingPresetResult;
    const shippingPreset = shippingPresetResult.value;
    if (category === 'physical' && shippingPreset) {
      normalizedProduct.shipping_preset = shippingPreset;
    } else if (category === 'physical') {
      const shipping = normalizeAdminShippingPackage(product.shipping, `Product "${id}"`);
      if (!shipping.ok) return shipping;
      normalizedProduct.shipping = shipping.value;
    }
    const sourceUrlResult = normalizeAdminUrlReference(product.source_url || product.sourceUrl || '', `Product "${id}" source URL`, { allowRelative: true });
    if (!sourceUrlResult.ok) return sourceUrlResult;
    const sourceUrl = sourceUrlResult.value;
    if (sourceUrl) normalizedProduct.source_url = sourceUrl;
    const variantOptionNameResult = normalizeAdminPlainText(product.variant_option_name || product.variantOptionName || '', `Product "${id}" variant option name`, { maxLength: 80 });
    if (!variantOptionNameResult.ok) return variantOptionNameResult;
    const variantOptionName = variantOptionNameResult.value;
    if (variantOptionName) normalizedProduct.variant_option_name = variantOptionName;
    const inventory = product.inventory === '' || product.inventory === undefined || product.inventory === null
      ? null
      : Number(product.inventory);
    if (inventory !== null) {
      if (!Number.isInteger(inventory) || inventory < 0) return { ok: false, error: `Product "${id}" inventory must be a non-negative whole number.` };
      normalizedProduct.inventory = inventory;
    }

    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length > 30) return { ok: false, error: `Product "${id}" can include at most 30 variants.` };
    const seenVariants = new Set();
    normalizedProduct.variants = [];
    for (const [variantIndex, variant] of variants.entries()) {
      const variantIdResult = normalizeAdminSlugValue(variant?.id || '', `Variant ${variantIndex + 1} for "${id}" id`);
      if (!variantIdResult.ok) return variantIdResult;
      const variantId = variantIdResult.value;
      if (seenVariants.has(variantId)) return { ok: false, error: `Variant id "${variantId}" is duplicated for "${id}".` };
      seenVariants.add(variantId);
      const normalizedLabel = normalizeAdminPlainText(variant?.label || '', `Variant "${variantId}" label`, { maxLength: 120 });
      if (!normalizedLabel.ok) return normalizedLabel;
      const label = normalizedLabel.value;
      if (!label) return { ok: false, error: `Variant "${variantId}" for "${id}" needs a label.` };
      const variantInventory = variant.inventory === '' || variant.inventory === undefined || variant.inventory === null
        ? null
        : Number(variant.inventory);
      const normalizedVariant = { id: variantId, label };
      if (variantInventory !== null) {
        if (!Number.isInteger(variantInventory) || variantInventory < 0) return { ok: false, error: `Variant "${variantId}" inventory must be a non-negative whole number.` };
        normalizedVariant.inventory = variantInventory;
      }
      normalizedProduct.variants.push(normalizedVariant);
    }
    normalized.push(normalizedProduct);
  }
  return { ok: true, value: normalized };
}

const ADMIN_SHIPPING_PACKAGE_FIELDS = [
  ['weight_oz', 'weight', true],
  ['packaging_weight_oz', 'packaging weight', false],
  ['length_in', 'length', true],
  ['width_in', 'width', true],
  ['height_in', 'height', true],
  ['stack_height_in', 'stack height', false]
];

function normalizeAdminShippingPackage(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: `${label} needs package weight and dimensions when Shipping preset is None.` };
  }
  const normalized = {};
  for (const [key, fieldLabel, required] of ADMIN_SHIPPING_PACKAGE_FIELDS) {
    const raw = value[key];
    if (raw === '' || raw === undefined || raw === null) {
      if (required) return { ok: false, error: `${label} needs package ${fieldLabel}.` };
      continue;
    }
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0 || (required && number <= 0)) {
      return { ok: false, error: `${label} package ${fieldLabel} must be ${required ? 'greater than 0' : '0 or greater'}.` };
    }
    normalized[key] = Number(number.toFixed(3));
  }
  return { ok: true, value: normalized };
}

function parseAdminJsonArray(value, label) {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(String(value || '[]'));
    if (!Array.isArray(parsed)) return { ok: false, error: `${label} must be a list.` };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: `${label} must be valid JSON.` };
  }
}

function optionalAdminNumber(value, field, { integer = false } = {}) {
  if (value === '' || value === undefined || value === null) return { ok: true, value: undefined };
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) {
    return { ok: false, error: `${field} must be a non-negative ${integer ? 'whole ' : ''}number.` };
  }
  return { ok: true, value: number };
}

async function validateAdminSettingsChanges(request, env, body = {}, options = {}) {
  const auth = await requireAdminSession(request, env, 'store:read', options);
  if (!auth.ok) return { ok: false, response: auth.response };

  const changes = Array.isArray(body?.changes) ? body.changes : [];
  if (changes.length > 80) {
    return { ok: false, response: privateJsonResponse({ error: 'Too many settings changes.' }, 400, env) };
  }

  const normalized = [];
  const errors = [];
  const warnings = [];

  changes.forEach((change, index) => {
    const path = String(change?.path || '').trim();
    const schema = ADMIN_PLATFORM_SETTING_SCHEMA.get(path);

    if (!schema) {
      errors.push(`changes[${index}] is not an editable setting.`);
      return;
    }
    if (auth.user.role !== 'super_admin') {
      errors.push(`changes[${index}] requires super admin access.`);
      return;
    }
    if (path === 'admin.users') {
      errors.push(`changes[${index}] must be saved from the Users section.`);
      return;
    }
    const normalizedValue = normalizeAdminSettingsValue(change?.value, { ...schema, path });
    if (!normalizedValue.ok) {
      errors.push(`changes[${index}]: ${normalizedValue.error}`);
      return;
    }
    normalized.push({
      path,
      label: schema.label,
      type: schema.type,
      value: normalizedValue.value
    });
  });

  return {
    ok: errors.length === 0,
    auth,
    changes: normalized,
    errors,
    warnings: normalized.length
      ? Array.from(new Set(['Publishing commits changes to GitHub and starts a deploy. Changes may take a few minutes to appear.', ...warnings]))
      : []
  };
}

async function handleAdminSettingsPreview(request, env, body = {}) {
  const result = await validateAdminSettingsChanges(request, env, body);
  if (!result.ok && result.response) return result.response;
  return privateJsonResponse({
    user: result.auth.user,
    dryRun: true,
    valid: result.errors.length === 0,
    changeCount: result.changes.length,
    changes: result.changes.map((change) => ({
      path: change.path,
      label: change.label
    })),
    errors: result.errors,
    warnings: result.warnings,
    writeBudget: adminReadBudget()
  }, result.errors.length ? 422 : 200, env);
}

function accessNamesForAdminUser(user = {}) {
  if (user.role === 'super_admin') return [];
  const accessNames = new Map([[STORE_ADMIN_SCOPE, 'Store']]);
  return normalizeAdminAccessScopes(user.accessScopes || [])
    .map((scope) => accessNames.get(String(scope || '')) || String(scope || '').trim())
    .filter(Boolean);
}

async function notifyNewAdminUsers(env, users = [], previousUsers = [], options = {}) {
  const previousEmails = new Set((previousUsers || [])
    .map((user) => String(user?.email || '').trim().toLowerCase())
    .filter(Boolean));
  const newUsers = (users || []).filter((user) => user?.email && !previousEmails.has(String(user.email).trim().toLowerCase()));
  const results = [];

  for (const user of newUsers) {
    const result = await sendAdminUserCreatedEmail(env, {
      email: user.email,
      name: user.name || '',
      role: user.role,
      accessNames: accessNamesForAdminUser(user),
      createdBy: options.createdBy || '',
      lang: options.lang || 'en'
    });
    results.push({
      email: user.email,
      sent: result.sent !== false,
      reason: result.sent === false ? result.reason || 'Email unavailable' : undefined
    });
  }

  return {
    newUserEmails: newUsers.map((user) => user.email),
    sent: results.filter((result) => result.sent).map((result) => result.email),
    failed: results.filter((result) => !result.sent).map((result) => ({
      email: result.email,
      reason: result.reason
    }))
  };
}

async function handleAdminUsersSave(request, env, body = {}) {
  const auth = await requireAdminSession(request, env, 'settings:publish', { requireCsrf: true });
  if (!auth.ok) return auth.response;
  if (auth.user.role !== 'super_admin') {
    return privateJsonResponse({ error: 'Forbidden' }, 403, env);
  }

  const previousUsers = await getEffectiveAdminUsers(env);
  const normalized = normalizeAdminUsers(body.users ?? body.value ?? [], {
    label: 'Users',
    availableAccessScopes: [STORE_ADMIN_SCOPE],
    currentUserEmail: auth.user.email
  });
  if (!normalized.ok) {
    return privateJsonResponse({
      valid: false,
      errors: [normalized.error],
      writeBudget: adminReadBudget()
    }, 422, env);
  }

  const saved = await saveStoredAdminUsers(env, normalized.value, { updatedBy: auth.user.email });
  if (!saved.ok) {
    return privateJsonResponse({ error: saved.error }, saved.status || 500, env);
  }
  const notifications = await notifyNewAdminUsers(env, saved.users, previousUsers || [], {
    createdBy: auth.user.email,
    lang: body.preferredLang
  });

  return privateJsonResponse({
    success: true,
    users: saved.users.map((user) => ({
      name: user.name || '',
      email: user.email,
      role: user.role === 'super_admin' ? 'super_admin' : 'limited_admin',
      accessScopes: user.role === 'super_admin' ? [] : normalizeAdminAccessScopes(user.accessScopes || [])
    })),
    notifications,
    writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 1 })
  }, 200, env);
}

function yamlAdminValue(value, type = 'string') {
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') return Number(value).toString();
  return yamlQuoteAdminString(value);
}

function yamlAdminInlineObject(entry = {}) {
  return `{ ${Object.entries(entry).map(([key, value]) => `${key}: ${yamlAdminValue(value, typeof value === 'number' ? 'number' : 'string')}`).join(', ')} }`;
}

function appendAdminShippingPackageYaml(lines, shipping, indent) {
  if (!shipping || typeof shipping !== 'object') return;
  lines.push(`${indent}shipping:`);
  for (const [field] of ADMIN_SHIPPING_PACKAGE_FIELDS) {
    yamlAdminMaybeLine(lines, field, shipping[field], `${indent}  `);
  }
}

function serializeAdminAddOnProductsYaml(products = [], indent = '  ') {
  if (!Array.isArray(products) || !products.length) return `${indent}products: []`;
  const lines = [`${indent}products:`];
  for (const product of products) {
    lines.push(`${indent}  - id: ${yamlQuoteAdminString(product.id)}`);
    lines.push(`${indent}    name: ${yamlQuoteAdminString(product.name)}`);
    lines.push(`${indent}    description: ${yamlQuoteAdminString(product.description || '')}`);
    lines.push(`${indent}    image_url: ${yamlQuoteAdminString(product.image_url || '')}`);
    lines.push(`${indent}    price: ${Number(product.price).toFixed(2)}`);
    lines.push(`${indent}    category: ${yamlQuoteAdminString(product.category || 'physical')}`);
    if (product.shipping_preset) lines.push(`${indent}    shipping_preset: ${yamlQuoteAdminString(product.shipping_preset)}`);
    appendAdminShippingPackageYaml(lines, product.shipping, `${indent}    `);
    if (product.inventory !== undefined) lines.push(`${indent}    inventory: ${Number(product.inventory)}`);
    if (product.source_url) lines.push(`${indent}    source_url: ${yamlQuoteAdminString(product.source_url)}`);
    if (product.variant_option_name) lines.push(`${indent}    variant_option_name: ${yamlQuoteAdminString(product.variant_option_name)}`);
    if (Array.isArray(product.variants) && product.variants.length) {
      lines.push(`${indent}    variants:`);
      for (const variant of product.variants) {
        const entry = { id: variant.id, label: variant.label };
        if (variant.inventory !== undefined) entry.inventory = Number(variant.inventory);
        lines.push(`${indent}      - ${yamlAdminInlineObject(entry)}`);
      }
    } else {
      lines.push(`${indent}    variants: []`);
    }
  }
  return lines.join('\n');
}

function replaceYamlBlockAtPath(source, path, replacement) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length) return { ok: false, error: 'Missing settings path.' };
  const lines = String(source || '').split(/\r?\n/);
  let start = 0;
  let end = lines.length;
  let indent = 0;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const pattern = new RegExp(`^ {${indent}}${key}:\\s*(?:#.*)?$`);
    const sectionStart = lines.findIndex((line, lineIndex) => lineIndex >= start && lineIndex < end && pattern.test(line));
    if (sectionStart < 0) return { ok: false, error: `Missing settings section: ${parts.slice(0, index + 1).join('.')}` };
    start = sectionStart + 1;
    indent += 2;
    end = lines.findIndex((line, lineIndex) => (
      lineIndex >= start &&
      line.trim() &&
      !line.startsWith(' '.repeat(indent))
    ));
    if (end < 0) end = lines.length;
  }

  const key = parts[parts.length - 1];
  const keyPattern = new RegExp(`^ {${indent}}${key}:`);
  const lineIndex = lines.findIndex((line, index) => index >= start && index < end && keyPattern.test(line));
  const indentedReplacement = String(replacement || '')
    .split('\n')
    .map((line) => line ? `${' '.repeat(indent)}${line}` : line)
    .join('\n');
  if (lineIndex < 0) {
    lines.splice(end, 0, indentedReplacement);
    return { ok: true, content: lines.join('\n') };
  }
  let blockEnd = lineIndex + 1;
  while (blockEnd < lines.length && (!lines[blockEnd].trim() || lines[blockEnd].startsWith(' '.repeat(indent + 2)))) {
    blockEnd += 1;
  }
  lines.splice(lineIndex, blockEnd - lineIndex, indentedReplacement);
  return { ok: true, content: lines.join('\n') };
}

function replaceYamlScalarAtPath(source, path, value, type = 'string') {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length) return source;
  const lines = String(source || '').split(/\r?\n/);
  let start = 0;
  let end = lines.length;
  let indent = 0;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const pattern = new RegExp(`^ {${indent}}${key}:\\s*(?:#.*)?$`);
    const sectionStart = lines.findIndex((line, lineIndex) => lineIndex >= start && lineIndex < end && pattern.test(line));
    if (sectionStart < 0) return { ok: false, error: `Missing settings section: ${parts.slice(0, index + 1).join('.')}` };
    start = sectionStart + 1;
    indent += 2;
    end = lines.findIndex((line, lineIndex) => (
      lineIndex >= start &&
      line.trim() &&
      !line.startsWith(' '.repeat(indent))
    ));
    if (end < 0) end = lines.length;
  }

  const key = parts[parts.length - 1];
  const keyPattern = new RegExp(`^ {${indent}}${key}:`);
  const lineIndex = lines.findIndex((line, index) => index >= start && index < end && keyPattern.test(line));
  const replacement = `${' '.repeat(indent)}${key}: ${yamlAdminValue(value, type)}`;
  if (lineIndex >= 0) {
    lines[lineIndex] = replacement;
  } else {
    lines.splice(end, 0, replacement);
  }
  return { ok: true, content: lines.join('\n') };
}

function yamlAdminListLine(key, values = []) {
  if (!Array.isArray(values) || !values.length) return `${key}: []`;
  return `${key}:\n${values.map((value) => `  - ${yamlQuoteAdminString(value)}`).join('\n')}`;
}

function yamlAdminMaybeLine(lines, key, value, indent = '    ') {
  if (value === '' || value === undefined || value === null) return;
  lines.push(`${indent}${key}: ${yamlAdminValue(value, typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string')}`);
}

function yamlAdminBlockLine(lines, key, value, indent = '    ') {
  const text = String(value || '').trim();
  if (!text) return;
  lines.push(`${indent}${key}: |`);
  text.split(/\r?\n/).forEach((line) => lines.push(`${indent}  ${line}`));
}

function adminUploadSlug(value, fallback = 'upload') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || fallback;
}

function adminUploadTimestamp() {
  return new Date().toISOString()
    .replace(/\.\d{3}Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');
}

function adminUploadBaseName(body = {}, extension = '') {
  const kind = String(body.kind || '').trim().toLowerCase();
  const fieldPath = String(body.fieldPath || '').trim();
  const contextName = body.filenameBase || body.contextName || body.name || body.title || body.label || '';
  const contextSlug = adminUploadSlug(contextName || body.filename || 'upload');
  const fieldMap = new Map([
    ['platform.logo_path', 'logo'],
    ['platform.footer_logo_path', 'footer-logo'],
    ['platform.favicon_path', 'favicon'],
    ['platform.default_social_image_path', 'default-social-image']
  ]);
  if (fieldMap.has(fieldPath)) return fieldMap.get(fieldPath);
  if (kind === 'store-product') return `product-${contextSlug}`;
  if (kind === 'add-on') return `add-on-${contextSlug}`;
  if (kind.includes('video') && extension === 'webm') return `video-${contextSlug}`;
  return contextSlug;
}

function adminUploadDirectory(body = {}, options = {}) {
  const kind = String(body.kind || '').trim().toLowerCase();
  const contentType = String(body.contentType || '').trim().toLowerCase();
  if (contentType.startsWith('video/')) {
    return 'assets/videos/defaults';
  }
  if (contentType.startsWith('audio/')) {
    return 'assets/audio/defaults';
  }
  if (kind === 'add-on') {
    return 'assets/images/add-ons';
  }
  if (kind === 'store-product') return 'assets/images/products';
  if (kind === 'logo' || kind === 'admin') return 'assets/images/defaults';
  return String(options.directory || 'assets/images/defaults').replace(/\/+$/, '');
}

function adminUploadProcessingSummary(contentType, extension) {
  const isImage = String(contentType || '').startsWith('image/');
  const isVideo = String(contentType || '').startsWith('video/');
  return {
    imageOptimization: isImage ? 'source-preserved' : 'not-image',
    videoTranscoding: isVideo
      ? (extension === 'webm' ? 'already-webm' : 'source-preserved')
      : 'not-video'
  };
}

function shouldTriggerAdminMediaOptimization(filePath = '', contentType = '') {
  const normalizedPath = String(filePath || '').replace(/^\/+/, '');
  const type = String(contentType || '').toLowerCase();
  return (
    (type.startsWith('image/') && normalizedPath.startsWith('assets/images/')) ||
    (type.startsWith('video/') && normalizedPath.startsWith('assets/videos/'))
  );
}

function adminMediaUploadScope(body = {}) {
  const kind = String(body.kind || '').trim().toLowerCase();
  if (kind === 'store-product') {
    const productId = String(body.productId || body.product_id || '').trim();
    if (!productId) {
      return { ok: false, error: 'Store product media uploads require a product ID.' };
    }
    return {
      ok: true,
      permission: 'fulfillment:manage',
      accessScope: STORE_ADMIN_SCOPE,
      scope: 'store',
      productId
    };
  }
  const platformKinds = new Set(['', 'admin', 'add-on', 'logo']);
  if (!platformKinds.has(kind)) {
    return { ok: false, error: 'Unsupported Store media upload scope.' };
  }
  return { ok: true, permission: 'settings:publish', accessScope: '', scope: 'platform' };
}

function normalizeAdminMediaUpload(body = {}, options = {}) {
  const label = options.label || 'Media upload';
  const filename = String(body.filename || options.defaultFilename || 'upload').trim().toLowerCase();
  const contentType = String(body.contentType || '').trim().toLowerCase();
  const content = String(body.content || body.dataBase64 || '').trim();
  const allowedTypes = options.allowedTypes || new Map();
  const extension = allowedTypes.get(contentType);
  if (!extension) {
    return { ok: false, error: options.typeError || `${label} uses an unsupported file type.` };
  }
  const dataUrlMatch = content.match(/^data:([^;]+);base64,/i);
  if (dataUrlMatch && dataUrlMatch[1].toLowerCase() !== contentType) {
    return { ok: false, error: `${label} content type does not match the uploaded file.` };
  }
  const base64 = content.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { ok: false, error: `${label} content must be base64 encoded.` };
  }
  const estimatedBytes = Math.floor((base64.length * 3) / 4);
  if (estimatedBytes <= 0) {
    return { ok: false, error: `${label} is empty.` };
  }
  if (estimatedBytes > options.maxFileBytes) {
    return { ok: false, error: options.sizeError || `${label} is too large.` };
  }
  const uploadBaseBody = options.forceDefaultFilename
    ? { ...body, filename, filenameBase: options.defaultFilename || filename }
    : { ...body, filename };
  const safeBase = adminUploadSlug(adminUploadBaseName(uploadBaseBody, extension), options.defaultFilename || 'upload');
  const directory = adminUploadDirectory({ ...body, contentType }, options);
  const filePath = `${directory}/${safeBase}-${adminUploadTimestamp()}.${extension}`;
  return {
    ok: true,
    base64,
    filePath,
    publicPath: `/${filePath}`,
    estimatedBytes,
    contentType,
    processing: adminUploadProcessingSummary(contentType, extension)
  };
}

async function handleAdminMediaUpload(request, env, options = {}) {
  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: options.maxBodyBytes || MAX_ADMIN_LOGO_UPLOAD_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const body = parsedBody.body || {};
  const uploadScope = adminMediaUploadScope(body);
  const authPermission = uploadScope.ok ? uploadScope.permission : 'store:read';
  const auth = await requireAdminSession(request, env, authPermission, {
    requireCsrf: true,
    ...(uploadScope.ok && uploadScope.accessScope ? { accessScope: uploadScope.accessScope } : {})
  });
  if (!auth.ok) return auth.response;
  if (!uploadScope.ok) {
    return privateJsonResponse({ error: uploadScope.error }, 400, env);
  }
  if (uploadScope.scope === 'store') {
    const catalog = normalizeStoreCatalogSnapshot(getStoreCatalogSnapshot(env));
    const creatingProduct = body.createProduct === true || body.create_product === true;
    if (creatingProduct && !isValidSlug(uploadScope.productId)) {
      return privateJsonResponse({ error: 'Store product media upload uses an invalid product ID.' }, 422, env);
    }
    if (!creatingProduct && !catalog.productById.has(uploadScope.productId)) {
      return privateJsonResponse({ error: 'Store product media upload references an unknown product.' }, 404, env);
    }
  }

  const normalized = normalizeAdminMediaUpload(body, options);
  if (!normalized.ok) {
    return privateJsonResponse({ error: normalized.error }, 400, env);
  }

  const uploaded = await putAdminRepoBase64File(
    env,
    normalized.filePath,
    normalized.base64,
    `Upload ${options.commitLabel || 'admin media'} ${normalized.filePath}`
  );
  if (!uploaded.ok) {
    return privateJsonResponse({
      error: uploaded.error || 'Unable to upload media',
      code: uploaded.code || 'repo_upload_failed'
    }, uploaded.status || 502, env);
  }

  const mediaOptimization = shouldTriggerAdminMediaOptimization(normalized.filePath, normalized.contentType)
    ? await triggerAdminMediaOptimization(env, { scope: 'changed' })
    : { triggered: false, reason: 'Media optimization is not configured for this upload type.' };

  return privateJsonResponse({
    success: true,
    path: normalized.publicPath,
    githubPath: normalized.filePath,
    commitSha: uploaded.commitSha,
    commitUrl: uploaded.commitUrl,
    repositoryMode: adminRepoMode(env),
    contentType: normalized.contentType,
    bytes: normalized.estimatedBytes,
    processing: normalized.processing,
    mediaOptimization,
    writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0 })
  }, 200, env);
}

function handleAdminLogoUpload(request, env) {
  return handleAdminMediaUpload(request, env, {
    label: 'Logo upload',
    defaultFilename: 'logo',
    forceDefaultFilename: true,
    directory: 'assets/images/defaults',
    maxBodyBytes: MAX_ADMIN_LOGO_UPLOAD_BODY_BYTES,
    maxFileBytes: 512 * 1024,
    allowedTypes: new Map([
      ['image/png', 'png'],
      ['image/jpeg', 'jpg'],
      ['image/webp', 'webp']
    ]),
    typeError: 'Logo upload must be a PNG, JPEG, or WebP image.',
    sizeError: 'Logo upload must be 512 KB or smaller.',
    commitLabel: 'admin logo'
  });
}

function handleAdminImageUpload(request, env) {
  return handleAdminMediaUpload(request, env, {
    label: 'Image upload',
    defaultFilename: 'image',
    directory: 'assets/images/defaults',
    maxBodyBytes: MAX_ADMIN_IMAGE_UPLOAD_BODY_BYTES,
    maxFileBytes: 8 * 1024 * 1024,
    allowedTypes: new Map([
      ['image/png', 'png'],
      ['image/jpeg', 'jpg'],
      ['image/webp', 'webp'],
      ['image/gif', 'gif']
    ]),
    typeError: 'Image upload must be a PNG, JPEG, WebP, or GIF image.',
    sizeError: 'Image upload must be 8 MB or smaller.',
    commitLabel: 'admin image'
  });
}

function handleAdminAudioUpload(request, env) {
  return handleAdminMediaUpload(request, env, {
    label: 'Audio upload',
    defaultFilename: 'audio',
    directory: 'assets/audio/defaults',
    maxBodyBytes: MAX_ADMIN_AUDIO_UPLOAD_BODY_BYTES,
    maxFileBytes: 25 * 1024 * 1024,
    allowedTypes: new Map([
      ['audio/mpeg', 'mp3'],
      ['audio/mp3', 'mp3'],
      ['audio/mp4', 'm4a'],
      ['audio/aac', 'aac'],
      ['audio/ogg', 'ogg'],
      ['audio/wav', 'wav'],
      ['audio/x-wav', 'wav'],
      ['audio/webm', 'webm']
    ]),
    typeError: 'Audio upload must be an MP3, M4A, WAV, OGG, AAC, or WebM audio file.',
    sizeError: 'Audio upload must be 25 MB or smaller.',
    commitLabel: 'admin audio'
  });
}

function handleAdminVideoUpload(request, env) {
  return handleAdminMediaUpload(request, env, {
    label: 'Video upload',
    defaultFilename: 'hero-video',
    directory: 'assets/videos/defaults',
    maxBodyBytes: MAX_ADMIN_VIDEO_UPLOAD_BODY_BYTES,
    maxFileBytes: 100 * 1024 * 1024,
    allowedTypes: new Map([
      ['video/mp4', 'mp4'],
      ['video/webm', 'webm'],
      ['video/quicktime', 'mov']
    ]),
    typeError: 'Video upload must be an MP4, WebM, or MOV file.',
    sizeError: 'Video upload must be 100 MB or smaller.',
    commitLabel: 'admin video'
  });
}

async function handleAdminSettingsPublish(request, env) {
  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const result = await validateAdminSettingsChanges(request, env, parsedBody.body || {}, { requireCsrf: true });
  if (!result.ok && result.response) return result.response;
  if (result.errors.length) {
    return privateJsonResponse({
      valid: false,
      errors: result.errors,
      warnings: result.warnings,
      writeBudget: adminReadBudget()
    }, 422, env);
  }
  if (!result.changes.length) {
    return privateJsonResponse({
      success: true,
      published: false,
      message: 'No settings changes to publish.',
      rebuild: { triggered: false, reason: 'No changes' },
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0 })
    }, 200, env);
  }

  const commits = [];
  const platformChanges = result.changes;
  if (platformChanges.length) {
    const repoFile = await readAdminRepoTextFile(env, '_config.yml');
    if (!repoFile.ok) {
      return privateJsonResponse({ error: repoFile.error, code: repoFile.code || 'repo_error' }, repoFile.status || 502, env);
    }
    let content = repoFile.content;
    for (const change of platformChanges) {
      const applied = change.type === 'add_on_products'
        ? replaceYamlBlockAtPath(content, change.path, serializeAdminAddOnProductsYaml(change.value, ''))
        : change.type === 'list'
          ? replaceYamlBlockAtPath(content, change.path, yamlAdminListLine(change.path.split('.').pop(), change.value))
        : replaceYamlScalarAtPath(content, change.path, change.value, change.type);
      if (!applied.ok) return privateJsonResponse({ error: applied.error }, 422, env);
      content = applied.content;
    }
    const saved = await putAdminRepoTextFile(env, '_config.yml', content, `Update admin platform settings (${platformChanges.length})`, repoFile.sha, {
      overwrite: true
    });
    if (!saved.ok) return privateJsonResponse({ error: saved.error, code: saved.code || 'repo_error' }, saved.status || 502, env);
    commits.push(saved);
  }

  const rebuild = await triggerAdminRepoRebuild(env, 'admin-settings-publish');
  return privateJsonResponse({
    success: true,
    published: true,
    changeCount: result.changes.length,
    commits,
    rebuild,
    repositoryMode: adminRepoMode(env),
    deployNotice: adminRepoDeployNotice(
      env,
      'Publishing commits changes to GitHub and starts a deploy. Changes may take a few minutes to appear.',
      'Settings saved locally. Jekyll will rebuild in local dev.'
    ),
    writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: 0 })
  }, 200, env);
}

function adminWriteBudget({ readOnly = true, kvWritesExpected = 0, kvListExpected, r2WritesExpected } = {}) {
  const budget = {
    readOnly: Boolean(readOnly),
    kvWritesExpected: Number(kvWritesExpected || 0)
  };
  if (kvListExpected !== undefined) {
    budget.kvListExpected = Number(kvListExpected || 0);
  }
  if (r2WritesExpected !== undefined) {
    budget.r2WritesExpected = Number(r2WritesExpected || 0);
  }
  return budget;
}

function adminReadBudget({ kvListExpected = 0 } = {}) {
  return adminWriteBudget({ readOnly: true, kvWritesExpected: 0, kvListExpected });
}


function clampAdminPageLimit(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 25;
  return Math.min(parsed, 100);
}






















const ADMIN_CONTENT_ALLOWED_INLINE_TAGS = new Set(['b', 'br', 'em', 'i', 'strong', 'u']);

function yamlQuoteAdminString(value) {
  return JSON.stringify(String(value ?? ''));
}





function replaceAdminFrontMatterBlock(frontMatter, key, replacement) {
  const lines = String(frontMatter || '').split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${key}:`).test(line));
  if (start < 0) {
    return `${frontMatter.replace(/\s*$/, '')}\n${replacement}`;
  }
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_-]+:/.test(lines[end])) {
    end += 1;
  }
  lines.splice(start, end - start, ...replacement.split('\n'));
  return lines.join('\n');
}

function removeAdminFrontMatterBlock(frontMatter, key) {
  const lines = String(frontMatter || '').split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${key}:`).test(line));
  if (start < 0) return frontMatter;
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_-]+:/.test(lines[end])) {
    end += 1;
  }
  lines.splice(start, end - start);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function csvResponse(csv, filename, env = null) {
  const defaultFilename = 'store-report.csv';
  const safeFilename = String(filename || defaultFilename)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || defaultFilename;
  return new Response(String(csv || ''), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Cache-Control': PRIVATE_NO_STORE_CACHE_CONTROL,
      'Access-Control-Allow-Origin': getAllowedOrigin(env, false),
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key, x-store-admin-csrf',
      'Access-Control-Expose-Headers': 'Content-Disposition',
      ...SECURITY_HEADERS
    }
  });
}

function getAdminAuditEventKey(action, now = new Date()) {
  const dateKey = now.toISOString().slice(0, 10);
  const safeAction = String(action || 'admin_event')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'admin_event';
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  return `admin-audit:${dateKey}:${safeAction}:${id}`;
}

async function recordAdminAuditEvent(env, event = {}) {
  if (!env?.STORE_STATE) return null;
  const now = new Date();
  const action = String(event.action || 'admin_event').trim() || 'admin_event';
  const key = getAdminAuditEventKey(action, now);
  await env.STORE_STATE.put(key, JSON.stringify({
    ...event,
    action,
    createdAt: now.toISOString()
  }), { expirationTtl: ADMIN_AUDIT_EVENT_TTL_SECONDS });
  return key;
}

function flattenAdminAddOnInventory(snapshot = {}, catalog = {}) {
  const products = new Map((catalog.products || []).map((product) => [String(product?.id || ''), product]));
  const rows = [];

  for (const [productId, productState] of Object.entries(snapshot.products || {})) {
    const product = products.get(productId) || {};

    const variants = Array.isArray(product?.variants) ? product.variants : [];
    if (variants.length > 0) {
      for (const variant of variants) {
        const variantId = String(variant?.id || '');
        const variantState = productState.variants?.[variantId] || {};
        rows.push({
          productId,
          variantId,
          label: `${String(product?.name || productId)} (${String(variant?.label || variantId)})`,
          productName: String(product?.name || productId),
          variantLabel: String(variant?.label || variantId),
          category: String(product?.category || 'digital'),
          configuredInventory: variantState.configuredInventory ?? null,
          inventory: variantState.inventory ?? null,
          overrideInventory: variantState.overrideInventory ?? null,
          hasOverride: Boolean(variantState.hasOverride),
          sold: Number(variantState.sold || 0),
          remaining: variantState.remaining ?? null,
          soldOut: Boolean(variantState.soldOut)
        });
      }
      continue;
    }

    rows.push({
      productId,
      variantId: '',
      label: String(product?.name || productId),
      productName: String(product?.name || productId),
      variantLabel: '',
      category: String(product?.category || 'digital'),
      configuredInventory: productState.configuredInventory ?? null,
      inventory: productState.inventory ?? null,
      overrideInventory: productState.overrideInventory ?? null,
      hasOverride: Boolean(productState.hasOverride),
      sold: Number(productState.sold || 0),
      remaining: productState.remaining ?? null,
      soldOut: Boolean(productState.soldOut)
    });
  }

  rows.sort((a, b) => a.productName.localeCompare(b.productName) || a.variantLabel.localeCompare(b.variantLabel));
  return rows;
}

async function handleAdminAddOnInventory(request, env) {
  const auth = await requireAdminSession(request, env, 'platform_inventory:manage');
  if (!auth.ok) return auth.response;

  const [catalog, snapshot] = await Promise.all([
    getAddOns(env),
    getAddOnInventorySnapshot(env, {
      force: true,
      persistProjectionOnRebuild: false
    })
  ]);

  return privateJsonResponse({
    rows: flattenAdminAddOnInventory(snapshot, catalog),
    lowStockThreshold: snapshot.lowStockThreshold ?? catalog.low_stock_threshold ?? 5,
    overridesUpdatedAt: snapshot.overridesUpdatedAt || null,
    updatedAt: snapshot.updatedAt,
    writeBudget: adminReadBudget({ kvListExpected: 1 })
  }, 200, env);
}

async function handleAdminAddOnInventoryMutation(request, env) {
  const parsedBody = await parseJsonRequestBody(request, env, {
    maxBytes: MAX_STANDARD_JSON_BODY_BYTES,
    privateResponse: true,
    emptyValue: {}
  });
  if (!parsedBody.ok) return parsedBody.response;

  const body = parsedBody.body || {};
  const auth = await requireAdminSession(request, env, 'platform_inventory:manage', {
    requireCsrf: true
  });
  if (!auth.ok) return auth.response;

  try {
    const mutation = await mutateAddOnInventoryOverride(env, {
      action: body.action,
      productId: body.productId,
      variantId: body.variantId,
      inventory: body.inventory,
      quantity: body.quantity
    });

    const auditKey = await recordAdminAuditEvent(env, {
      action: 'platform_inventory:manage',
      adminEmail: auth.user.email,
      adminRole: auth.user.role,
      productId: mutation.productId,
      variantId: mutation.variantId,
      inventoryAction: mutation.action,
      before: mutation.before,
      after: mutation.after
    });

    return privateJsonResponse({
      success: true,
      mutation,
      auditKey,
      writeBudget: adminWriteBudget({ readOnly: false, kvWritesExpected: mutation.storageWrite ? 2 : 1, kvListExpected: 2 })
    }, 200, env);
  } catch (error) {
    return privateJsonResponse({
      error: error instanceof Error ? error.message : String(error || 'Inventory mutation failed')
    }, 400, env);
  }
}

// SEC-004 & SEC-012: Response helpers use imported getAllowedOrigin and SECURITY_HEADERS from validation.js

const PUBLIC_READ_CACHE_CONTROL = 'public, max-age=30, stale-while-revalidate=300';

function jsonResponse(data, status = 200, env = null, isPublic = false, extraHeaders = {}) {
  const origin = getAllowedOrigin(env, isPublic);
  const credentialHeaders = origin && origin !== '*'
    ? { 'Access-Control-Allow-Credentials': 'true' }
    : {};
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key, x-store-admin-csrf',
      ...credentialHeaders,
      ...extraHeaders,
      ...SECURITY_HEADERS
    }
  });
}

function privateJsonResponse(data, status = 200, env = null, extraHeaders = {}) {
  return jsonResponse(data, status, env, false, {
    'Cache-Control': PRIVATE_NO_STORE_CACHE_CONTROL,
    ...extraHeaders
  });
}

function cacheablePublicJsonResponse(data, status = 200, env = null) {
  return jsonResponse(data, status, env, true, {
    'Cache-Control': PUBLIC_READ_CACHE_CONTROL
  });
}

function corsResponse(env = null, isPublic = false) {
  const origin = getAllowedOrigin(env, isPublic);
  const credentialHeaders = origin && origin !== '*'
    ? { 'Access-Control-Allow-Credentials': 'true' }
    : {};
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key, x-store-admin-csrf',
      ...credentialHeaders,
      ...SECURITY_HEADERS
    }
  });
}

export {
  attemptStoreOrderAdminNotificationDelivery,
  buildAdminStoreAnalyticsPayload,
  buildStoreTicketSvg,
  buildStoreOrderAdminNotificationPayloads,
  buildStoreOrderEmailPayload,
  buildStoreOrderEventEmailAttachments,
  storeOrderReconciliationRowsCsv,
  processStoreEventReminders,
  queueStoreEventReminders
};

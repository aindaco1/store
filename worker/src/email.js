/**
 * Resend email integration for Store admin and order flows.
 */

import {
  DEFAULT_SITE_BASE,
  getEmailBorderColor,
  getEmailButtonRadius,
  getEmailFontFamily,
  getEmailHeadingFontFamily,
  getEmailLogoPath,
  getEmailMutedTextColor,
  getEmailPrimaryColor,
  getEmailSurfaceColor,
  getEmailTextColor,
  getOrdersEmailFrom,
  getPlatformCompanyName,
  getPlatformName,
  getSiteBase,
  getSupportEmail,
  getUpdatesEmailFrom
} from './provider-config.js';
import { getScopedConsole } from './logger.js';

const DEFAULT_I18N_LANG = 'en';
const FALLBACK_SITE_BASE = DEFAULT_SITE_BASE || 'https://shop.dustwave.xyz';
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const EMAIL_IMAGE_EXTENSIONS = new Set(['.gif', '.jpg', '.jpeg', '.png']);
const EMAIL_I18N_CACHE = new Map();
let console = globalThis.console;

function configureEmailLogging(env) {
  console = getScopedConsole(env, 'email');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function buildPlainTextFromHtml(html) {
  return decodeHtmlEntities(
    String(html ?? '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href, text) => {
        const label = String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return label ? `${label} (${href})` : href;
      })
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  );
}

function normalizeLang(value, fallback = DEFAULT_I18N_LANG) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized) ? normalized : fallback;
}

function interpolateTemplate(template, replacements = {}) {
  let result = String(template || '');
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(`%{${key}}`, String(value ?? ''));
  }
  return result;
}

function getNestedValue(source, key) {
  return String(key || '')
    .split('.')
    .reduce((value, segment) => (value && typeof value === 'object' ? value[segment] : undefined), source);
}

async function loadEmailCatalog(env = {}) {
  if (env.I18N_CATALOG && typeof env.I18N_CATALOG === 'object') {
    return env.I18N_CATALOG;
  }

  if (env.I18N_CATALOG_JSON) {
    const cacheKey = `json:${env.I18N_CATALOG_JSON}`;
    if (!EMAIL_I18N_CACHE.has(cacheKey)) {
      EMAIL_I18N_CACHE.set(cacheKey, Promise.resolve()
        .then(() => JSON.parse(String(env.I18N_CATALOG_JSON || '{}')))
        .catch(() => ({})));
    }
    return EMAIL_I18N_CACHE.get(cacheKey);
  }

  const siteBase = getResolvedSiteBase(env);
  const cacheKey = `site:${siteBase}`;
  if (!EMAIL_I18N_CACHE.has(cacheKey)) {
    EMAIL_I18N_CACHE.set(cacheKey, (async () => {
      try {
        const response = await fetch(safeSiteUrl('/assets/i18n.json', siteBase));
        if (!response.ok) return {};
        return await response.json();
      } catch (_error) {
        return {};
      }
    })());
  }
  return EMAIL_I18N_CACHE.get(cacheKey);
}

async function getEmailTranslator(env, preferredLang) {
  const lang = normalizeLang(preferredLang);
  const catalog = await loadEmailCatalog(env);

  return {
    lang,
    t(key, fallback, replacements = {}) {
      const localized = getNestedValue(catalog?.[lang]?.email, key);
      const defaultValue = getNestedValue(catalog?.[DEFAULT_I18N_LANG]?.email, key);
      return interpolateTemplate(localized ?? defaultValue ?? fallback ?? key, replacements);
    }
  };
}

function getLocalizedPath(path, preferredLang = DEFAULT_I18N_LANG) {
  const lang = normalizeLang(preferredLang);
  const normalizedPath = String(path || '/').startsWith('/') ? String(path || '/') : `/${String(path || '')}`;
  return lang === DEFAULT_I18N_LANG ? normalizedPath : `/${lang}${normalizedPath}`;
}

function getResolvedSiteBase(siteBaseOrEnv) {
  const siteBase = typeof siteBaseOrEnv === 'string'
    ? siteBaseOrEnv
    : getSiteBase(siteBaseOrEnv || {});
  try {
    return new URL(siteBase || FALLBACK_SITE_BASE).origin;
  } catch {
    return FALLBACK_SITE_BASE;
  }
}

function getEmailAssetBase(siteBaseOrEnv) {
  try {
    const resolved = new URL(getResolvedSiteBase(siteBaseOrEnv));
    const hostname = resolved.hostname.toLowerCase();
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    return resolved.protocol === 'https:' && !isLocalHost ? resolved.origin : getResolvedSiteBase(FALLBACK_SITE_BASE);
  } catch {
    return getResolvedSiteBase(FALLBACK_SITE_BASE);
  }
}

function safeSiteUrl(path, siteBaseOrEnv) {
  const base = getResolvedSiteBase(siteBaseOrEnv);
  try {
    const baseUrl = new URL(base);
    const parsed = new URL(String(path || '/'), baseUrl);
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol) && parsed.origin === baseUrl.origin
      ? parsed.toString()
      : base;
  } catch {
    return base;
  }
}

function safeExternalUrl(value, fallbackBase = DEFAULT_SITE_BASE) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, fallbackBase || FALLBACK_SITE_BASE);
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function safeEmailHostedAssetUrl(pathOrUrl, siteBaseOrEnv) {
  if (!pathOrUrl) return '';
  try {
    const assetBase = getEmailAssetBase(siteBaseOrEnv);
    const baseUrl = new URL(assetBase);
    const parsed = new URL(pathOrUrl, baseUrl);
    if (!SAFE_LINK_PROTOCOLS.has(parsed.protocol) || parsed.origin !== baseUrl.origin) return '';
    if (!parsed.pathname.startsWith('/assets/images/') && !parsed.pathname.startsWith('/assets/icons/')) return '';
    const pathname = parsed.pathname.toLowerCase();
    const extension = pathname.includes('.') ? pathname.slice(pathname.lastIndexOf('.')) : '';
    if (!EMAIL_IMAGE_EXTENSIONS.has(extension)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function safeEmailHeaderText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildEmailSubject(primary, secondary, prefix = '') {
  const core = [primary, secondary].map(safeEmailHeaderText).filter(Boolean).join(' | ');
  return [safeEmailHeaderText(prefix), core].filter(Boolean).join(' ').trim();
}

function getEmailPlatformDisplayName(env = {}) {
  const platformName = safeEmailHeaderText(getPlatformName(env) || 'Store') || 'Store';
  const hasCompanySetting = String(env.PLATFORM_COMPANY_NAME || env.PLATFORM_AUTHOR || '').trim();
  const companyName = hasCompanySetting ? safeEmailHeaderText(getPlatformCompanyName(env)) : '';
  if (!companyName || companyName.toLowerCase() === platformName.toLowerCase()) return platformName;
  if (platformName.toLowerCase().includes(companyName.toLowerCase())) return platformName;
  return `${companyName} ${platformName}`;
}

function parseHexColor(value) {
  const normalized = String(value || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(normalized)) {
    return normalized.slice(1).split('').map((char) => parseInt(char + char, 16));
  }
  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    return [
      parseInt(normalized.slice(1, 3), 16),
      parseInt(normalized.slice(3, 5), 16),
      parseInt(normalized.slice(5, 7), 16)
    ];
  }
  return null;
}

function getAccessibleButtonTextColor(backgroundColor, fallback = '#ffffff') {
  const channels = parseHexColor(backgroundColor);
  if (!channels) return fallback;
  const [red, green, blue] = channels.map((channel) => channel / 255);
  const linear = [red, green, blue].map((channel) => (
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  const luminance = (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  return luminance > 0.5 ? '#111111' : '#ffffff';
}

function emailListUnsubscribeHeaders(unsubscribeUrl, siteBaseOrEnv) {
  const href = safeExternalUrl(unsubscribeUrl, getResolvedSiteBase(siteBaseOrEnv));
  if (!href) return {};
  return {
    'List-Unsubscribe': `<${href}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  };
}

function getEmailTheme(env = {}) {
  const primaryColor = getEmailPrimaryColor(env);
  const siteBase = getResolvedSiteBase(env);
  const logoPath = getEmailLogoPath(env);
  const logoUrl = logoPath ? safeEmailHostedAssetUrl(logoPath, siteBase) : '';
  return {
    siteBase,
    platformName: safeEmailHeaderText(getEmailPlatformDisplayName(env)),
    siteHomeUrl: safeSiteUrl('/', siteBase),
    logoUrl,
    supportEmail: safeEmailHeaderText(getSupportEmail(env)),
    fontFamily: escapeHtml(getEmailFontFamily(env)),
    headingFontFamily: escapeHtml(getEmailHeadingFontFamily(env)),
    textColor: escapeHtml(getEmailTextColor(env)),
    mutedTextColor: escapeHtml(getEmailMutedTextColor(env)),
    surfaceColor: escapeHtml(getEmailSurfaceColor(env)),
    borderColor: escapeHtml(getEmailBorderColor(env)),
    primaryColor: escapeHtml(primaryColor),
    buttonRadius: escapeHtml(getEmailButtonRadius(env)),
    primaryTextColor: getAccessibleButtonTextColor(primaryColor)
  };
}

function getEmailBodyStyle(theme) {
  return `font-family: ${theme.fontFamily}; line-height: 1.6; color: ${theme.textColor}; max-width: 600px; margin: 0 auto; padding: 20px;`;
}

function getEmailCardStyle(theme, extras = '') {
  return `background: ${theme.surfaceColor}; border-radius: 8px; padding: 20px; margin-bottom: 24px;${extras ? ` ${extras}` : ''}`;
}

function getEmailPrimaryButtonStyle(theme, extras = '') {
  return `display: inline-block; background: ${theme.primaryColor}; color: ${theme.primaryTextColor}; padding: 12px 24px; text-decoration: none; border-radius: ${theme.buttonRadius}; font-weight: 600;${extras ? ` ${extras}` : ''}`;
}

function getEmailFooterStyle(theme) {
  return `border-top: 1px solid ${theme.borderColor}; padding-top: 20px; font-size: 12px; color: ${theme.mutedTextColor};`;
}

function renderEmailHeader(theme, heading, { emoji = '', headingColor = '' } = {}) {
  const logo = theme.logoUrl
    ? `<p style="margin: 0 0 16px 0;"><a href="${escapeHtml(theme.siteHomeUrl)}" style="text-decoration: none;"><img src="${escapeHtml(theme.logoUrl)}" alt="${escapeHtml(theme.platformName)}" style="display: inline-block; max-width: 88px; max-height: 88px; width: auto; height: auto;"></a></p>`
    : '';
  const emojiBlock = emoji ? `<div style="font-size: 48px; margin-bottom: 16px;">${emoji}</div>` : '';
  const resolvedHeadingColor = headingColor ? ` color: ${headingColor};` : '';
  return `
  <div style="text-align: center; margin-bottom: 32px;">
    ${logo}
    ${emojiBlock}
    <h1 style="margin: 0; font-size: 24px; font-family: ${theme.headingFontFamily};${resolvedHeadingColor}">${heading}</h1>
  </div>`;
}

function formatCurrency(cents) {
  return `$${(Math.max(0, Number(cents || 0) || 0) / 100).toFixed(2)}`;
}

function renderAmountBreakdown({ subtotal = 0, discount = 0, couponCode = '', tip = 0, tax = 0, shipping = 0, total = 0 } = {}, theme, t) {
  const discountCents = Math.max(0, Number(discount || 0) || 0);
  const discountLabel = couponCode
    ? `${t('store_order.discount', 'Discount')} (${couponCode})`
    : t('store_order.discount', 'Discount');
  const rows = [
    [t('store_order.subtotal', 'Subtotal'), subtotal, false],
    ...(discountCents > 0 ? [[discountLabel, discountCents, true]] : []),
    ...(Math.max(0, Number(tip || 0) || 0) > 0 ? [[t('store_order.tip', 'Tip'), tip]] : []),
    [t('store_order.shipping', 'Shipping'), shipping],
    [t('store_order.tax', 'Tax'), tax],
    [t('store_order.total_paid', 'Total paid'), total]
  ];
  return `
  <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
    ${rows.map(([label, value], index) => `
      <tr>
        <td style="padding: ${index === rows.length - 1 ? '12px 0 0' : '4px 0'}; color: ${index === rows.length - 1 ? theme.textColor : theme.mutedTextColor}; font-weight: ${index === rows.length - 1 ? '700' : '400'};">${escapeHtml(label)}</td>
        <td style="padding: ${index === rows.length - 1 ? '12px 0 0' : '4px 0'}; text-align: right; color: ${theme.textColor}; font-weight: ${index === rows.length - 1 ? '700' : '400'};">${rows[index][2] ? '-' : ''}${formatCurrency(value)}</td>
      </tr>`).join('')}
  </table>`;
}

function getStoreFulfillmentLabel(item = {}, t = (_key, fallback) => fallback) {
  const type = String(item.fulfillmentType || item.fulfillment_type || 'physical').trim().toLowerCase();
  if (type === 'digital') return t('store_order.fulfillment_digital', 'Digital delivery');
  if (type === 'ticket') return t('store_order.fulfillment_ticket', 'Ticket');
  if (type === 'rsvp') return t('store_order.fulfillment_rsvp', 'RSVP');
  if (type === 'service') return t('store_order.fulfillment_service', 'Service');
  return t('store_order.fulfillment_physical', 'Physical item');
}

function getStoreFulfillmentNote(item = {}, t = (_key, fallback) => fallback) {
  const type = String(item.fulfillmentType || item.fulfillment_type || 'physical').trim().toLowerCase();
  if (type === 'digital') return t('store_order.download_note', 'Open your order page to access your download.');
  if (type === 'ticket') return t('store_order.ticket_note', 'Open your order page for your ticket.');
  if (type === 'rsvp') return t('store_order.rsvp_note', 'Your RSVP is confirmed.');
  if (item.shippable === true) return t('store_order.shipping_note', 'Shipping updates will appear on your order page.');
  return '';
}

function renderStoreOrderItems(items = [], t = (_key, fallback) => fallback, theme = getEmailTheme()) {
  const rows = (Array.isArray(items) ? items : []).map((item) => {
    const name = String(item.name || item.productId || item.sku || 'Item').trim();
    const variantLabel = String(item.variantLabel || '').trim();
    const quantity = Math.max(1, Number(item.quantity || 1) || 1);
    const subtotalCents = Math.max(0, Number(item.subtotalCents || 0) || 0);
    const fulfillmentLabel = getStoreFulfillmentLabel(item, t);
    const fulfillmentNote = getStoreFulfillmentNote(item, t);
    const productUrl = safeExternalUrl(item.url, theme.siteBase);
    const title = productUrl
      ? `<a href="${escapeHtml(productUrl)}" style="color: ${theme.primaryColor}; text-decoration: underline;">${escapeHtml(name)}</a>`
      : escapeHtml(name);
    const variant = variantLabel ? ` <span style="color: ${theme.mutedTextColor};">(${escapeHtml(variantLabel)})</span>` : '';
    const note = fulfillmentNote
      ? `<p style="margin: 4px 0 0 0; color: ${theme.mutedTextColor}; font-size: 13px;">${escapeHtml(fulfillmentNote)}</p>`
      : '';

    return `
    <div style="padding: 12px 0; border-top: 1px solid ${theme.borderColor};">
      <p style="margin: 0; color: ${theme.textColor};">
        <strong>${title}${variant}</strong>
        <span style="float: right;">${formatCurrency(subtotalCents)}</span>
      </p>
      <p style="margin: 4px 0 0 0; color: ${theme.mutedTextColor}; font-size: 13px;">
        ${escapeHtml(t('store_order.quantity_label', 'Qty'))}: ${quantity} · ${escapeHtml(fulfillmentLabel)}
      </p>
      ${note}
    </div>`;
  });

  if (rows.length === 0) return '';
  return `
  <div style="margin-top: 16px;">
    <p style="margin: 0 0 8px 0; font-weight: 700; color: ${theme.textColor};">${escapeHtml(t('store_order.items_heading', 'Items'))}</p>
    ${rows.join('\n')}
  </div>`;
}

async function parseResendError(response) {
  let detail = '';
  try {
    const data = await response.json();
    detail = [data?.message, data?.name, data?.error].filter(Boolean).join(' ');
  } catch (_jsonError) {
    try {
      detail = await response.text();
    } catch (_textError) {
      detail = '';
    }
  }
  return safeEmailHeaderText(detail).slice(0, 240);
}

async function sendResendEmail(env, payload, { errorLabel = 'Resend error', failureLabel = 'Failed to send email' } = {}) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...payload,
      text: payload.text || buildPlainTextFromHtml(payload.html || ''),
      reply_to: payload.reply_to || getSupportEmail(env)
    })
  });

  if (!response.ok) {
    const detail = await parseResendError(response);
    console.error(`${errorLabel}:`, response.status, detail);
    throw new Error(`${failureLabel}: ${response.status}${detail ? ` (${detail})` : ''}`);
  }

  return response.json().catch(() => ({}));
}

export async function sendAdminLoginEmail(env, { email, loginUrl, lang } = {}) {
  configureEmailLogging(env);
  if (!env?.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not configured' };

  const normalizedLang = normalizeLang(lang);
  const isSpanish = normalizedLang === 'es';
  const theme = getEmailTheme(env);
  const platformName = safeEmailHeaderText(theme.platformName) || 'Store';
  const from = safeEmailHeaderText(getUpdatesEmailFrom(env) || getOrdersEmailFrom(env));
  const subject = safeEmailHeaderText(isSpanish
    ? buildEmailSubject('Tu enlace de administración', platformName)
    : buildEmailSubject('Admin sign-in link', platformName));
  const heading = isSpanish ? 'Inicia sesión en administración' : 'Sign in to admin';
  const body = isSpanish
    ? 'Este enlace funciona por 15 minutos. Si no lo solicitaste, puedes ignorar este correo.'
    : 'This link works for 15 minutes. If you did not ask for it, you can ignore this email.';
  const cta = isSpanish ? 'Abrir administración' : 'Open admin';
  const footer = isSpanish
    ? 'Alguien solicitó acceso al panel de administración con este correo.'
    : 'Someone requested access to the admin dashboard with this email address.';

  const html = `
  <body style="${getEmailBodyStyle(theme)}">
  ${renderEmailHeader(theme, escapeHtml(heading))}
  <div style="${getEmailCardStyle(theme)}">
    <p style="margin: 0 0 16px 0; font-size: 15px; color: ${theme.textColor};">${escapeHtml(body)}</p>
    <p style="margin: 0;"><a href="${escapeHtml(safeExternalUrl(loginUrl, theme.siteBase))}" style="${getEmailPrimaryButtonStyle(theme)}">${escapeHtml(cta)}</a></p>
  </div>
  <div style="${getEmailFooterStyle(theme)}">
    <p style="margin: 0;">${escapeHtml(footer)}</p>
  </div>
</body>`;

  try {
    await sendResendEmail(env, { from, to: email, subject, html }, {
      errorLabel: 'Resend error (admin login)',
      failureLabel: 'Failed to send admin login email'
    });
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error?.message || 'Failed to send admin login email' };
  }
}

export async function sendAdminUserCreatedEmail(env, { email, name = '', role = 'limited_admin', accessNames = [], createdBy = '', lang } = {}) {
  configureEmailLogging(env);
  if (!env?.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not configured' };

  const { t } = await getEmailTranslator(env, lang);
  const theme = getEmailTheme(env);
  const platformName = safeEmailHeaderText(theme.platformName) || 'Store';
  const from = safeEmailHeaderText(getUpdatesEmailFrom(env) || getOrdersEmailFrom(env));
  const roleLabel = role === 'super_admin'
    ? t('admin_user_created.role_super_admin', 'super admin')
    : t('admin_user_created.role_limited_admin', 'limited admin');
  const adminUrl = safeSiteUrl(getLocalizedPath('/admin/', lang), theme.siteBase);
  const displayName = String(name || '').trim() || email;
  const accessList = Array.isArray(accessNames)
    ? accessNames.map((accessName) => String(accessName || '').trim()).filter(Boolean)
    : [];
  const accessBlock = role === 'limited_admin' && accessList.length
    ? `<p style="margin: 16px 0 8px 0; font-weight: 600;">${escapeHtml(t('admin_user_created.access_heading', 'Access'))}</p><ul style="margin: 0; padding-left: 20px;">${accessList.map((accessName) => `<li>${escapeHtml(accessName)}</li>`).join('')}</ul>`
    : '';
  const createdByLine = createdBy
    ? `<p style="margin: 16px 0 0 0; font-size: 13px; color: ${theme.mutedTextColor};">${escapeHtml(t('admin_user_created.created_by', 'Added by %{email}', { email: createdBy }))}</p>`
    : '';
  const subject = buildEmailSubject(t('subjects.admin_user_created', 'Admin access added'), platformName);
  const heading = t('admin_user_created.heading', 'Admin access added');
  const footer = t('admin_user_created.footer', 'Not expecting this access? Ignore this email or contact the site owner.');

  const html = `
<body style="${getEmailBodyStyle(theme)}">
  ${renderEmailHeader(theme, escapeHtml(heading))}
  <div style="${getEmailCardStyle(theme)}">
    <p style="margin: 0 0 8px 0; font-size: 15px; color: ${theme.textColor};">${escapeHtml(t('admin_user_created.greeting', 'Hi %{name},', { name: displayName }))}</p>
    <p style="margin: 0 0 16px 0; font-size: 15px; color: ${theme.textColor};">${escapeHtml(t('admin_user_created.intro', 'You now have %{role} access to %{platform}.', { role: roleLabel, platform: platformName }))}</p>
    <p style="margin: 0 0 16px 0; font-size: 15px; color: ${theme.textColor};">${escapeHtml(t('admin_user_created.instructions', 'To sign in, open admin and enter this email address. We will send you a magic link.'))}</p>
    <p style="margin: 0;"><a href="${escapeHtml(adminUrl)}" style="${getEmailPrimaryButtonStyle(theme)}">${escapeHtml(t('admin_user_created.cta', 'Open admin'))}</a></p>
    ${accessBlock}
    ${createdByLine}
  </div>
  <div style="${getEmailFooterStyle(theme)}">
    <p style="margin: 0;">${escapeHtml(footer)}</p>
  </div>
</body>`;

  try {
    await sendResendEmail(env, { from, to: email, subject, html }, {
      errorLabel: 'Resend error (admin user created)',
      failureLabel: 'Failed to send admin user email'
    });
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error?.message || 'Failed to send admin user email' };
  }
}

function normalizeEmailAttachments(attachments = []) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((attachment) => ({
      filename: safeEmailHeaderText(attachment?.filename || ''),
      content: String(attachment?.content || '')
    }))
    .filter((attachment) => attachment.filename && attachment.content)
    .slice(0, 25);
}

export async function sendStoreOrderEmail(env, { email, orderToken, orderDraft = {}, payment = {}, preferredLang, attachments = [] } = {}) {
  configureEmailLogging(env);
  if (!env?.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not configured' };

  const { t, lang } = await getEmailTranslator(env, preferredLang || orderDraft.preferredLang);
  const theme = getEmailTheme(env);
  const platformName = safeEmailHeaderText(theme.platformName) || 'Store';
  const orderId = safeEmailHeaderText(orderToken || orderDraft.orderToken || '');
  const orderUrl = safeSiteUrl(`${getLocalizedPath('/order-success/', lang)}?orderToken=${encodeURIComponent(orderId)}`, theme.siteBase);
  const totals = orderDraft.totals || {};
  const itemsHtml = renderStoreOrderItems(orderDraft.items || [], t, theme);
  const safeAttachments = normalizeEmailAttachments(attachments);
  const hasShipping = orderDraft.fulfillment?.requiresShipping === true || totals.requiresShipping === true;
  const shippingAddress = orderDraft.shippingAddress || {};
  const addressLine = hasShipping
    ? [
        shippingAddress.name,
        shippingAddress.line1 || shippingAddress.address1,
        shippingAddress.line2 || shippingAddress.address2,
        [shippingAddress.city, shippingAddress.state || shippingAddress.province, shippingAddress.postalCode].filter(Boolean).join(', '),
        shippingAddress.country
      ].map((line) => String(line || '').trim()).filter(Boolean)
    : [];
  const shippingBlock = addressLine.length > 0 ? `
    <div style="${getEmailCardStyle(theme)}">
      <p style="margin: 0 0 8px 0; font-weight: 700;">${escapeHtml(t('store_order.shipping_heading', 'Shipping'))}</p>
      <p style="margin: 0; color: ${theme.mutedTextColor};">${addressLine.map(escapeHtml).join('<br>')}</p>
    </div>` : '';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="${getEmailBodyStyle(theme)}">
  ${renderEmailHeader(theme, escapeHtml(t('store_order.heading', 'Order confirmed')))}

  <div style="${getEmailCardStyle(theme)}">
    <p style="margin: 0 0 12px 0; color: ${theme.mutedTextColor};">${escapeHtml(t('store_order.order_label', 'Order'))}: ${escapeHtml(orderId)}</p>
    ${renderAmountBreakdown({
      subtotal: totals.subtotalCents || 0,
      discount: totals.discountCents || 0,
      couponCode: totals.couponCode || totals.coupon?.code || '',
      tip: totals.tipAmountCents || 0,
      tax: totals.taxCents || 0,
      shipping: totals.shippingCents || 0,
      total: totals.totalCents || payment.amountCents || 0
    }, theme, t)}
    ${itemsHtml}
  </div>

  ${shippingBlock}

  <div style="margin-bottom: 32px;">
    <p style="margin: 0 0 16px 0;">${escapeHtml(t('store_order.body', 'Thanks for your order. Your order page has the latest details for tickets, downloads, shipping, and receipts.'))}</p>
    ${safeAttachments.length ? `<p style="margin: 0 0 16px 0; color: ${theme.mutedTextColor};">${escapeHtml(t('store_order.attachments_note', 'Event tickets, check-in QR codes, and calendar files are attached when available.'))}</p>` : ''}
    <a href="${escapeHtml(orderUrl)}" style="${getEmailPrimaryButtonStyle(theme)}">${escapeHtml(t('store_order.cta', 'View order'))}</a>
  </div>

  <div style="${getEmailFooterStyle(theme)}">
    <p style="margin: 0;">${escapeHtml(t('common.questions_prefix', 'Questions? Reply to this email or visit'))} <a href="${escapeHtml(theme.siteHomeUrl)}" style="color: ${theme.primaryColor};">${escapeHtml(theme.platformName)}</a>.</p>
  </div>
</body>
</html>`.trim();

  await sendResendEmail(env, {
    from: getOrdersEmailFrom(env),
    to: email,
    subject: buildEmailSubject(t('subjects.store_order_confirmed', 'Order confirmed'), platformName),
    html,
    ...(safeAttachments.length ? { attachments: safeAttachments } : {})
  }, {
    errorLabel: 'Resend error (store order)',
    failureLabel: `Failed to send ${platformName} order email`
  });
  return { sent: true };
}

export async function sendStoreEventReminderEmail(env, {
  email,
  orderToken = '',
  orderUrl = '',
  eventTitle = '',
  eventTime = '',
  venue = '',
  address = '',
  reminderLabel = '',
  preferredLang,
  attachments = []
} = {}) {
  configureEmailLogging(env);
  if (!env?.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not configured' };

  const { t } = await getEmailTranslator(env, preferredLang);
  const theme = getEmailTheme(env);
  const platformName = safeEmailHeaderText(theme.platformName) || 'Store';
  const safeEmail = safeEmailHeaderText(email);
  const safeOrderUrl = safeExternalUrl(orderUrl, theme.siteBase);
  if (!safeEmail || !safeOrderUrl) return { sent: false, reason: 'Missing event reminder recipient or order URL' };

  const title = safeEmailHeaderText(eventTitle) || t('store_event_reminder.fallback_title', 'Your event');
  const when = safeEmailHeaderText(eventTime);
  const where = [venue, address].map((value) => String(value || '').trim()).filter(Boolean).join(', ');
  const safeAttachments = normalizeEmailAttachments(attachments);
  const subject = buildEmailSubject(t('subjects.store_event_reminder', 'Event reminder'), `${title} | ${platformName}`);
  const reminderLine = reminderLabel
    ? t('store_event_reminder.reminder_label', 'This is your %{label} reminder.', { label: reminderLabel })
    : t('store_event_reminder.body', 'This is a reminder for your ticket or RSVP.');
  const detailsRows = [
    [t('store_event_reminder.when', 'When'), when],
    [t('store_event_reminder.where', 'Where'), where],
    [t('store_event_reminder.order', 'Order'), orderToken]
  ].filter(([, value]) => String(value || '').trim());
  const detailsTable = detailsRows.length ? `
    <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
      ${detailsRows.map(([label, value]) => `
        <tr>
          <td style="padding: 6px 12px 6px 0; color: ${theme.mutedTextColor}; width: 96px;">${escapeHtml(label)}</td>
          <td style="padding: 6px 0; color: ${theme.textColor}; font-weight: 600;">${escapeHtml(value)}</td>
        </tr>`).join('')}
    </table>` : '';
  const attachmentLine = safeAttachments.length
    ? `<p style="margin: 16px 0 0 0; color: ${theme.mutedTextColor};">${escapeHtml(t('store_event_reminder.attachments', 'The calendar invite and check-in QR are attached when available.'))}</p>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="${getEmailBodyStyle(theme)}">
  ${renderEmailHeader(theme, escapeHtml(t('store_event_reminder.heading', '%{event} is coming up', { event: title })))}

  <div style="${getEmailCardStyle(theme)}">
    <p style="margin: 0; font-size: 15px; color: ${theme.textColor};">${escapeHtml(reminderLine)}</p>
    ${detailsTable}
    ${attachmentLine}
    <p style="margin: 18px 0 0 0;"><a href="${escapeHtml(safeOrderUrl)}" style="${getEmailPrimaryButtonStyle(theme)}">${escapeHtml(t('store_event_reminder.cta', 'View order'))}</a></p>
  </div>

  <div style="${getEmailFooterStyle(theme)}">
    <p style="margin: 0;">${escapeHtml(t('store_event_reminder.footer', 'You are receiving this because this email address is attached to an event or RSVP order from %{platform}.', { platform: platformName }))}</p>
  </div>
</body>
</html>`.trim();

  try {
    await sendResendEmail(env, {
      from: getUpdatesEmailFrom(env) || getOrdersEmailFrom(env),
      to: safeEmail,
      subject,
      html,
      ...(safeAttachments.length ? { attachments: safeAttachments } : {})
    }, {
      errorLabel: 'Resend error (store event reminder)',
      failureLabel: `Failed to send ${platformName} event reminder email`
    });
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error?.message || 'Failed to send event reminder email' };
  }
}

export async function sendStoreOrderLookupEmail(env, { email, lookupUrl, orderCount = 0, preferredLang } = {}) {
  configureEmailLogging(env);
  if (!env?.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not configured' };

  const { t } = await getEmailTranslator(env, preferredLang);
  const theme = getEmailTheme(env);
  const platformName = safeEmailHeaderText(theme.platformName) || 'Store';
  const safeLookupUrl = safeExternalUrl(lookupUrl, theme.siteBase);
  if (!safeLookupUrl) return { sent: false, reason: 'Invalid lookup URL' };

  const count = Math.max(0, Math.floor(Number(orderCount || 0) || 0));
  const body = count === 1
    ? t('store_order_lookup.body_one', 'Here is your secure link to view your %{platform} order. It works for 15 minutes.', { platform: platformName })
    : t('store_order_lookup.body_other', 'Here is your secure link to view your %{platform} orders. It works for 15 minutes.', { platform: platformName });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="${getEmailBodyStyle(theme)}">
  ${renderEmailHeader(theme, escapeHtml(t('store_order_lookup.heading', 'Find your order')))}

  <div style="${getEmailCardStyle(theme)}">
    <p style="margin: 0 0 16px 0; font-size: 15px; color: ${theme.textColor};">${escapeHtml(body)}</p>
    <p style="margin: 0;"><a href="${escapeHtml(safeLookupUrl)}" style="${getEmailPrimaryButtonStyle(theme)}">${escapeHtml(t('store_order_lookup.cta', 'View orders'))}</a></p>
  </div>

  <div style="${getEmailFooterStyle(theme)}">
    <p style="margin: 0 0 8px 0;">${escapeHtml(t('store_order_lookup.expiry', 'This link works once.'))}</p>
    <p style="margin: 0;">${escapeHtml(t('store_order_lookup.ignore', 'If you did not ask for this, you can ignore it.'))}</p>
  </div>
</body>
</html>`.trim();

  await sendResendEmail(env, {
    from: getOrdersEmailFrom(env),
    to: email,
    subject: buildEmailSubject(t('subjects.store_order_lookup', 'Find your order'), platformName),
    html
  }, {
    errorLabel: 'Resend error (store order lookup)',
    failureLabel: `Failed to send ${platformName} order lookup email`
  });
  return { sent: true };
}

export async function sendStoreAbandonedCartEmail(env, { email, resumeUrl = '', amountCents = 0, itemCount = 0, unsubscribeUrl = '', preferredLang } = {}) {
  configureEmailLogging(env);
  if (!env?.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not configured' };

  const { t } = await getEmailTranslator(env, preferredLang);
  const theme = getEmailTheme(env);
  const platformName = safeEmailHeaderText(theme.platformName) || 'Store';
  const safeResumeUrl = safeExternalUrl(resumeUrl, theme.siteBase) || theme.siteHomeUrl;
  const safeUnsubscribeUrl = safeExternalUrl(unsubscribeUrl, theme.siteBase);
  const unsubscribeHeaders = emailListUnsubscribeHeaders(safeUnsubscribeUrl, theme.siteBase);
  const safeEmail = safeEmailHeaderText(email);
  const count = Math.max(0, Math.floor(Number(itemCount || 0) || 0));
  const amount = Math.max(0, Number(amountCents || 0) || 0);
  const subject = buildEmailSubject(t('subjects.store_abandoned_cart', 'Finish your checkout'), platformName);
  const itemLine = count > 0
    ? t('store_abandoned_cart.item_count', '%{count} item%{plural} in your cart', {
        count,
        plural: count === 1 ? '' : 's'
      })
    : '';
  const totalLine = amount > 0
    ? t('store_abandoned_cart.estimated_total', 'Estimated total: %{amount}', { amount: formatCurrency(amount) })
    : '';
  const summaryLines = [itemLine, totalLine].filter(Boolean);
  const summaryBlock = summaryLines.length > 0 ? `
    <p style="margin: 0 0 16px 0; color: ${theme.mutedTextColor};">${escapeHtml(summaryLines.join(' · '))}</p>
  ` : '';
  const unsubscribeBlock = safeUnsubscribeUrl ? `
    <p style="margin: 12px 0 0 0;">
      <a href="${escapeHtml(safeUnsubscribeUrl)}" style="color: ${theme.primaryColor}; text-decoration: underline;">${escapeHtml(t('store_abandoned_cart.unsubscribe', 'Do not send checkout reminders'))}</a>
    </p>
  ` : '';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="${getEmailBodyStyle(theme)}">
  ${renderEmailHeader(theme, escapeHtml(t('store_abandoned_cart.heading', 'Finish your checkout')))}

  <div style="${getEmailCardStyle(theme)}">
    <p style="margin: 0 0 16px 0; font-size: 15px; color: ${theme.textColor};">${escapeHtml(t('store_abandoned_cart.body', 'You asked for one reminder before leaving checkout. Your cart is still here when you are ready.'))}</p>
    ${summaryBlock}
    <p style="margin: 0;"><a href="${escapeHtml(safeResumeUrl)}" style="${getEmailPrimaryButtonStyle(theme)}">${escapeHtml(t('store_abandoned_cart.cta', 'Finish checkout'))}</a></p>
  </div>

  <div style="${getEmailFooterStyle(theme)}">
    <p style="margin: 0;">${escapeHtml(t('store_abandoned_cart.footer', 'You are receiving this because you asked for one checkout reminder before leaving %{platform}.', { platform: platformName }))}</p>
    ${unsubscribeBlock}
  </div>
</body>
</html>`.trim();

  try {
    await sendResendEmail(env, {
      from: getUpdatesEmailFrom(env) || getOrdersEmailFrom(env),
      to: safeEmail,
      subject,
      html,
      ...(Object.keys(unsubscribeHeaders).length ? { headers: unsubscribeHeaders } : {})
    }, {
      errorLabel: 'Resend error (store abandoned checkout)',
      failureLabel: `Failed to send ${platformName} checkout reminder email`
    });
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error?.message || 'Failed to send checkout reminder email' };
  }
}

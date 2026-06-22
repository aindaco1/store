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
  getPlatformName,
  getSiteBase,
  getSupportEmail,
  getUpdatesEmailFrom
} from './provider-config.js';
import { getScopedConsole } from './logger.js';

const DEFAULT_I18N_LANG = 'en';
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
    return new URL(siteBase || DEFAULT_SITE_BASE || 'https://shop.dustwave.xyz').origin;
  } catch {
    return DEFAULT_SITE_BASE || 'https://shop.dustwave.xyz';
  }
}

function safeSiteUrl(path, siteBaseOrEnv) {
  const base = getResolvedSiteBase(siteBaseOrEnv);
  try {
    return new URL(String(path || '/'), base).toString();
  } catch {
    return base;
  }
}

function safeExternalUrl(value, fallbackBase = DEFAULT_SITE_BASE) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, fallbackBase || DEFAULT_SITE_BASE);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.toString() : '';
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

function getEmailTheme(env = {}) {
  const siteBase = getResolvedSiteBase(env);
  const logoPath = getEmailLogoPath(env);
  const platformName = safeEmailHeaderText(getPlatformName(env) || 'Store') || 'Store';
  return {
    siteBase,
    platformName,
    siteHomeUrl: safeSiteUrl('/', siteBase),
    logoUrl: logoPath ? safeSiteUrl(logoPath, siteBase) : '',
    supportEmail: safeEmailHeaderText(getSupportEmail(env)),
    fontFamily: escapeHtml(getEmailFontFamily(env)),
    headingFontFamily: escapeHtml(getEmailHeadingFontFamily(env)),
    textColor: getEmailTextColor(env),
    mutedTextColor: getEmailMutedTextColor(env),
    surfaceColor: getEmailSurfaceColor(env),
    borderColor: getEmailBorderColor(env),
    primaryColor: getEmailPrimaryColor(env),
    buttonRadius: getEmailButtonRadius(env)
  };
}

function getEmailBodyStyle(theme) {
  return `margin: 0; padding: 32px 20px; background: ${theme.surfaceColor}; color: ${theme.textColor}; font-family: ${theme.fontFamily}; line-height: 1.5;`;
}

function getEmailCardStyle(theme) {
  return `background: #ffffff; border: 1px solid ${theme.borderColor}; border-radius: 8px; padding: 24px; margin-bottom: 24px;`;
}

function getEmailPrimaryButtonStyle(theme) {
  return `display: inline-block; background: ${theme.primaryColor}; color: #111111; text-decoration: none; border-radius: ${theme.buttonRadius}; padding: 12px 18px; font-weight: 700;`;
}

function getEmailFooterStyle(theme) {
  return `font-size: 13px; color: ${theme.mutedTextColor};`;
}

function renderEmailHeader(theme, heading) {
  const logo = theme.logoUrl
    ? `<img src="${escapeHtml(theme.logoUrl)}" alt="${escapeHtml(theme.platformName)}" width="56" height="56" style="display: block; width: 56px; height: 56px; object-fit: contain; margin: 0 0 16px 0;">`
    : '';
  return `
  <div style="margin-bottom: 24px;">
    ${logo}
    <h1 style="margin: 0; font-family: ${theme.headingFontFamily}; font-size: 28px; line-height: 1.1; color: ${theme.textColor};">${heading}</h1>
  </div>`;
}

function formatCurrency(cents) {
  return `$${(Math.max(0, Number(cents || 0) || 0) / 100).toFixed(2)}`;
}

function renderAmountBreakdown({ subtotal = 0, tip = 0, tax = 0, shipping = 0, total = 0 } = {}, theme, t) {
  const rows = [
    [t('store_order.subtotal', 'Subtotal'), subtotal],
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
        <td style="padding: ${index === rows.length - 1 ? '12px 0 0' : '4px 0'}; text-align: right; color: ${theme.textColor}; font-weight: ${index === rows.length - 1 ? '700' : '400'};">${formatCurrency(value)}</td>
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
  if (type === 'digital') return t('store_order.download_note', 'Download delivery will arrive by email when fulfillment is ready.');
  if (type === 'ticket') return t('store_order.ticket_note', 'Ticket delivery will arrive by email.');
  if (type === 'rsvp') return t('store_order.rsvp_note', 'Your RSVP is confirmed.');
  if (item.shippable === true) return t('store_order.shipping_note', 'We will email again when fulfillment or shipping updates are available.');
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
  const platformName = safeEmailHeaderText(getPlatformName(env) || 'Store') || 'Store';
  const from = safeEmailHeaderText(getUpdatesEmailFrom(env) || getOrdersEmailFrom(env));
  const subject = safeEmailHeaderText(isSpanish
    ? buildEmailSubject('Tu enlace de administración', platformName)
    : buildEmailSubject('Your admin sign-in link', platformName));
  const heading = isSpanish ? 'Inicia sesión en administración' : 'Sign in to admin';
  const body = isSpanish
    ? 'Este enlace caduca en 15 minutos. Si no lo solicitaste, puedes ignorar este correo.'
    : 'This link expires in 15 minutes. If you did not request it, you can ignore this email.';
  const cta = isSpanish ? 'Abrir administración' : 'Open admin';

  const html = `
<body style="${getEmailBodyStyle(theme)}">
  ${renderEmailHeader(theme, escapeHtml(heading))}
  <div style="${getEmailCardStyle(theme)}">
    <p style="margin: 0 0 16px 0; font-size: 15px; color: ${theme.textColor};">${escapeHtml(body)}</p>
    <p style="margin: 0;"><a href="${escapeHtml(safeExternalUrl(loginUrl, theme.siteBase))}" style="${getEmailPrimaryButtonStyle(theme)}">${escapeHtml(cta)}</a></p>
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
  const platformName = safeEmailHeaderText(getPlatformName(env) || 'Store') || 'Store';
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

  const html = `
<body style="${getEmailBodyStyle(theme)}">
  ${renderEmailHeader(theme, escapeHtml(heading))}
  <div style="${getEmailCardStyle(theme)}">
    <p style="margin: 0 0 8px 0; font-size: 15px; color: ${theme.textColor};">${escapeHtml(t('admin_user_created.greeting', 'Hi %{name},', { name: displayName }))}</p>
    <p style="margin: 0 0 16px 0; font-size: 15px; color: ${theme.textColor};">${escapeHtml(t('admin_user_created.intro', 'You have been added as a %{role} for %{platform}.', { role: roleLabel, platform: platformName }))}</p>
    <p style="margin: 0 0 16px 0; font-size: 15px; color: ${theme.textColor};">${escapeHtml(t('admin_user_created.instructions', 'Use the admin sign-in page and enter this email address to receive a magic link. There is no password to set.'))}</p>
    <p style="margin: 0;"><a href="${escapeHtml(adminUrl)}" style="${getEmailPrimaryButtonStyle(theme)}">${escapeHtml(t('admin_user_created.cta', 'Open admin sign-in'))}</a></p>
    ${accessBlock}
    ${createdByLine}
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

export async function sendStoreOrderEmail(env, { email, orderToken, orderDraft = {}, payment = {}, preferredLang } = {}) {
  configureEmailLogging(env);
  if (!env?.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not configured' };

  const { t, lang } = await getEmailTranslator(env, preferredLang || orderDraft.preferredLang);
  const theme = getEmailTheme(env);
  const platformName = safeEmailHeaderText(getPlatformName(env) || 'Store') || 'Store';
  const orderId = safeEmailHeaderText(orderToken || orderDraft.orderToken || '');
  const orderUrl = safeSiteUrl(`${getLocalizedPath('/order-success/', lang)}?orderToken=${encodeURIComponent(orderId)}`, theme.siteBase);
  const totals = orderDraft.totals || {};
  const itemsHtml = renderStoreOrderItems(orderDraft.items || [], t, theme);
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
      tip: totals.tipAmountCents || 0,
      tax: totals.taxCents || 0,
      shipping: totals.shippingCents || 0,
      total: totals.totalCents || payment.amountCents || 0
    }, theme, t)}
    ${itemsHtml}
  </div>

  ${shippingBlock}

  <div style="margin-bottom: 32px;">
    <p style="margin: 0 0 16px 0;">${escapeHtml(t('store_order.body', 'Thanks for your order. Save this email for your records.'))}</p>
    <a href="${escapeHtml(orderUrl)}" style="${getEmailPrimaryButtonStyle(theme)}">${escapeHtml(t('store_order.cta', 'View order status'))}</a>
  </div>

  <div style="${getEmailFooterStyle(theme)}">
    <p style="margin: 0;">${escapeHtml(t('common.questions_prefix', 'Questions? Reply to this email or visit'))} <a href="${theme.siteHomeUrl}" style="color: ${theme.primaryColor};">${theme.platformName}</a>.</p>
  </div>
</body>
</html>`.trim();

  await sendResendEmail(env, {
    from: getOrdersEmailFrom(env),
    to: email,
    subject: buildEmailSubject(t('subjects.store_order_confirmed', 'Order confirmed'), platformName),
    html
  }, {
    errorLabel: 'Resend error (store order)',
    failureLabel: `Failed to send ${platformName} order email`
  });
  return { sent: true };
}

export async function sendStoreOrderLookupEmail(env, { email, lookupUrl, orderCount = 0, preferredLang } = {}) {
  configureEmailLogging(env);
  if (!env?.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not configured' };

  const { t } = await getEmailTranslator(env, preferredLang);
  const theme = getEmailTheme(env);
  const platformName = safeEmailHeaderText(getPlatformName(env) || 'Store') || 'Store';
  const safeLookupUrl = safeExternalUrl(lookupUrl, theme.siteBase);
  if (!safeLookupUrl) return { sent: false, reason: 'Invalid lookup URL' };

  const count = Math.max(0, Math.floor(Number(orderCount || 0) || 0));
  const body = count === 1
    ? t('store_order_lookup.body_one', 'Use this link within 15 minutes to view your %{platform} order.', { platform: platformName })
    : t('store_order_lookup.body_other', 'Use this link within 15 minutes to view your %{platform} orders.', { platform: platformName });

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
    <p style="margin: 0 0 8px 0;">${escapeHtml(t('store_order_lookup.expiry', 'This link expires after one use.'))}</p>
    <p style="margin: 0;">${escapeHtml(t('store_order_lookup.ignore', 'If you did not request this email, you can ignore it.'))}</p>
  </div>
</body>
</html>`.trim();

  await sendResendEmail(env, {
    from: getOrdersEmailFrom(env),
    to: email,
    subject: buildEmailSubject(t('subjects.store_order_lookup', 'Order lookup link'), platformName),
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
  const platformName = safeEmailHeaderText(getPlatformName(env) || 'Store') || 'Store';
  const safeResumeUrl = safeExternalUrl(resumeUrl, theme.siteBase) || theme.siteHomeUrl;
  const safeUnsubscribeUrl = safeExternalUrl(unsubscribeUrl, theme.siteBase);
  const safeEmail = safeEmailHeaderText(email);
  const count = Math.max(0, Math.floor(Number(itemCount || 0) || 0));
  const amount = Math.max(0, Number(amountCents || 0) || 0);
  const subject = buildEmailSubject(t('subjects.store_abandoned_cart', 'Finish your checkout'), platformName);
  const itemLine = count > 0
    ? t('store_abandoned_cart.item_count', '%{count} item%{plural} waiting', {
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
      <a href="${escapeHtml(safeUnsubscribeUrl)}" style="color: ${theme.primaryColor}; text-decoration: underline;">${escapeHtml(t('store_abandoned_cart.unsubscribe', 'Do not send me checkout reminders'))}</a>
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
    <p style="margin: 0 0 16px 0; font-size: 15px; color: ${theme.textColor};">${escapeHtml(t('store_abandoned_cart.body', 'You asked for one reminder if you left checkout before finishing your order. Your cart is ready when you are.'))}</p>
    ${summaryBlock}
    <p style="margin: 0;"><a href="${escapeHtml(safeResumeUrl)}" style="${getEmailPrimaryButtonStyle(theme)}">${escapeHtml(t('store_abandoned_cart.cta', 'Resume checkout'))}</a></p>
  </div>

  <div style="${getEmailFooterStyle(theme)}">
    <p style="margin: 0;">${escapeHtml(t('store_abandoned_cart.footer', 'You are receiving this because you opted into one checkout reminder for %{platform}.', { platform: platformName }))}</p>
    ${unsubscribeBlock}
  </div>
</body>
</html>`.trim();

  try {
    await sendResendEmail(env, {
      from: getUpdatesEmailFrom(env) || getOrdersEmailFrom(env),
      to: safeEmail,
      subject,
      html
    }, {
      errorLabel: 'Resend error (store abandoned checkout)',
      failureLabel: `Failed to send ${platformName} checkout reminder email`
    });
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error?.message || 'Failed to send checkout reminder email' };
  }
}

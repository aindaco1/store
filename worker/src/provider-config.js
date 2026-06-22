const CHECKOUT_PROVIDERS = ['first_party'];
const CART_RUNTIMES = ['first_party'];
const CHECKOUT_UI_MODES = ['hosted', 'embedded', 'custom'];
const DEFAULT_SITE_BASE = 'https://shop.dustwave.xyz';
const DEFAULT_WORKER_BASE = 'https://checkout.dustwave.xyz';
const DEFAULT_PLATFORM_NAME = 'Store';
const DEFAULT_PLATFORM_COMPANY_NAME = 'Dust Wave';
const DEFAULT_SUPPORT_EMAIL = 'info@dustwave.xyz';
const DEFAULT_ORDERS_EMAIL_FROM = 'Store <orders@shop.dustwave.xyz>';
const DEFAULT_UPDATES_EMAIL_FROM = 'Store <updates@shop.dustwave.xyz>';
const DEFAULT_EMAIL_FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const DEFAULT_EMAIL_HEADING_FONT_FAMILY = DEFAULT_EMAIL_FONT_FAMILY;
const DEFAULT_EMAIL_TEXT_COLOR = '#333333';
const DEFAULT_EMAIL_MUTED_TEXT_COLOR = '#666666';
const DEFAULT_EMAIL_SURFACE_COLOR = '#f8f9fa';
const DEFAULT_EMAIL_BORDER_COLOR = '#eeeeee';
const DEFAULT_EMAIL_PRIMARY_COLOR = '#000000';
const DEFAULT_EMAIL_BUTTON_RADIUS = '6px';
const DEFAULT_SALES_TAX_RATE = 0.07875;
const DEFAULT_FLAT_SHIPPING_RATE = 3;
const DEFAULT_SHIPPING_ORIGIN_ZIP = '87120';
const DEFAULT_SHIPPING_ORIGIN_COUNTRY = 'US';
const DEFAULT_SHIPPING_FALLBACK_FLAT_RATE = 3;
const DEFAULT_FREE_SHIPPING_DEFAULT = false;
const DEFAULT_SHIPPING_DEFAULT_OPTION = 'standard';
const SHIPPING_DEFAULT_OPTIONS = ['standard', 'signature_required', 'adult_signature_required'];
const DEFAULT_USPS_ENABLED = true;
const DEFAULT_USPS_API_BASE = 'https://apis.usps.com';
const DEFAULT_USPS_TEST_API_BASE = 'https://apis-tem.usps.com';
const DEFAULT_USPS_TIMEOUT_MS = 5000;
const DEFAULT_USPS_QUOTE_CACHE_TTL_SECONDS = 600;
const DEFAULT_USPS_FAILURE_COOLDOWN_SECONDS = 300;
const DEFAULT_USPS_RATE_LIMIT_COOLDOWN_SECONDS = 1800;
const DEFAULT_PLATFORM_TIP_PERCENT = 5;
const MAX_PLATFORM_TIP_PERCENT = 15;
const DEFAULT_CONSOLE_LOGGING_ENABLED = true;
const DEFAULT_VERBOSE_CONSOLE_LOGGING = true;

export {
  CART_RUNTIMES,
  CHECKOUT_PROVIDERS,
  CHECKOUT_UI_MODES,
  DEFAULT_PLATFORM_TIP_PERCENT,
  DEFAULT_ORDERS_EMAIL_FROM,
  DEFAULT_PLATFORM_COMPANY_NAME,
  DEFAULT_PLATFORM_NAME,
  DEFAULT_EMAIL_BORDER_COLOR,
  DEFAULT_EMAIL_BUTTON_RADIUS,
  DEFAULT_EMAIL_FONT_FAMILY,
  DEFAULT_EMAIL_HEADING_FONT_FAMILY,
  DEFAULT_EMAIL_MUTED_TEXT_COLOR,
  DEFAULT_EMAIL_PRIMARY_COLOR,
  DEFAULT_EMAIL_SURFACE_COLOR,
  DEFAULT_EMAIL_TEXT_COLOR,
  DEFAULT_FREE_SHIPPING_DEFAULT,
  DEFAULT_USPS_ENABLED,
  DEFAULT_USPS_API_BASE,
  DEFAULT_USPS_FAILURE_COOLDOWN_SECONDS,
  DEFAULT_USPS_QUOTE_CACHE_TTL_SECONDS,
  DEFAULT_USPS_RATE_LIMIT_COOLDOWN_SECONDS,
  DEFAULT_USPS_TEST_API_BASE,
  DEFAULT_USPS_TIMEOUT_MS,
  DEFAULT_SHIPPING_FALLBACK_FLAT_RATE,
  DEFAULT_SHIPPING_DEFAULT_OPTION,
  DEFAULT_SHIPPING_ORIGIN_COUNTRY,
  DEFAULT_SHIPPING_ORIGIN_ZIP,
  DEFAULT_SITE_BASE,
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_UPDATES_EMAIL_FROM,
  DEFAULT_WORKER_BASE,
  DEFAULT_CONSOLE_LOGGING_ENABLED,
  DEFAULT_VERBOSE_CONSOLE_LOGGING,
  MAX_PLATFORM_TIP_PERCENT
};

export function getCheckoutProvider(env = {}) {
  return normalizeFlag(env.CHECKOUT_PROVIDER, CHECKOUT_PROVIDERS, 'first_party');
}

export function getCartRuntime(env = {}) {
  return normalizeFlag(env.CART_RUNTIME, CART_RUNTIMES, 'first_party');
}

export function getCheckoutUiMode(env = {}) {
  return normalizeFlag(env.CHECKOUT_UI_MODE, CHECKOUT_UI_MODES, 'custom');
}

export function isFirstPartyCheckoutEnabled(env = {}) {
  return getCheckoutProvider(env) === 'first_party';
}

export function isFirstPartyCartEnabled(env = {}) {
  return getCartRuntime(env) === 'first_party';
}

export function getSalesTaxRate(env = {}) {
  const parsed = Number(env.SALES_TAX_RATE);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SALES_TAX_RATE;
}

export function getFlatShippingFeeCents(env = {}) {
  if (getFreeShippingDefault(env)) {
    return 0;
  }
  const parsed = Number(env.FLAT_SHIPPING_RATE);
  const amount = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FLAT_SHIPPING_RATE;
  return Math.round(amount * 100);
}

export function getShippingOriginZip(env = {}) {
  return normalizeString(env.SHIPPING_ORIGIN_ZIP, DEFAULT_SHIPPING_ORIGIN_ZIP);
}

export function getShippingOriginCountry(env = {}) {
  return normalizeString(env.SHIPPING_ORIGIN_COUNTRY, DEFAULT_SHIPPING_ORIGIN_COUNTRY);
}

export function getShippingFallbackFeeCents(env = {}) {
  if (getFreeShippingDefault(env)) {
    return 0;
  }
  const parsed = Number(env.SHIPPING_FALLBACK_FLAT_RATE);
  const amount = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SHIPPING_FALLBACK_FLAT_RATE;
  return Math.round(amount * 100);
}

export function isUspsEnabled(env = {}) {
  const normalized = normalizeBooleanish(env.USPS_ENABLED);
  return normalized === null ? DEFAULT_USPS_ENABLED : normalized;
}

export function getUspsApiBase(env = {}) {
  const configured = normalizeString(env.USPS_API_BASE, '');
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  return DEFAULT_USPS_API_BASE;
}

export function getUspsClientId(env = {}) {
  return normalizeString(env.USPS_CLIENT_ID, '');
}

export function getUspsTimeoutMs(env = {}) {
  const parsed = Number(env.USPS_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_USPS_TIMEOUT_MS;
}

export function getUspsQuoteCacheTtlMs(env = {}) {
  const parsed = Number(env.USPS_QUOTE_CACHE_TTL_SECONDS);
  const seconds = Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_USPS_QUOTE_CACHE_TTL_SECONDS;
  return seconds * 1000;
}

export function getUspsFailureCooldownMs(env = {}) {
  const parsed = Number(env.USPS_FAILURE_COOLDOWN_SECONDS);
  const seconds = Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_USPS_FAILURE_COOLDOWN_SECONDS;
  return seconds * 1000;
}

export function getUspsRateLimitCooldownMs(env = {}) {
  const parsed = Number(env.USPS_RATE_LIMIT_COOLDOWN_SECONDS);
  const seconds = Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_USPS_RATE_LIMIT_COOLDOWN_SECONDS;
  return seconds * 1000;
}

export function getFreeShippingDefault(env = {}) {
  const normalized = normalizeBooleanish(env.FREE_SHIPPING_DEFAULT);
  return normalized === null ? DEFAULT_FREE_SHIPPING_DEFAULT : normalized;
}

export function getShippingDefaultOption(env = {}) {
  const configured = normalizeNullableString(env.SHIPPING_DEFAULT_OPTION);
  return SHIPPING_DEFAULT_OPTIONS.includes(configured) ? configured : DEFAULT_SHIPPING_DEFAULT_OPTION;
}

export function getDefaultPlatformTipPercent(env = {}) {
  const parsed = Number(env.DEFAULT_PLATFORM_TIP_PERCENT);
  const max = getMaxPlatformTipPercent(env);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max
    ? parsed
    : Math.min(DEFAULT_PLATFORM_TIP_PERCENT, max);
}

export function getMaxPlatformTipPercent(env = {}) {
  const parsed = Number(env.MAX_PLATFORM_TIP_PERCENT);
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : MAX_PLATFORM_TIP_PERCENT;
}

export function getConsoleLoggingEnabled(env = {}) {
  const normalized = normalizeBooleanish(env.DEBUG_CONSOLE_LOGGING_ENABLED);
  return normalized === null ? DEFAULT_CONSOLE_LOGGING_ENABLED : normalized;
}

export function getVerboseConsoleLogging(env = {}) {
  const normalized = normalizeBooleanish(env.DEBUG_VERBOSE_CONSOLE_LOGGING);
  return normalized === null ? DEFAULT_VERBOSE_CONSOLE_LOGGING : normalized;
}

export function getPlatformName(env = {}) {
  return normalizeString(env.PLATFORM_NAME, DEFAULT_PLATFORM_NAME);
}

export function getPlatformCompanyName(env = {}) {
  return normalizeString(env.PLATFORM_COMPANY_NAME || env.PLATFORM_AUTHOR, DEFAULT_PLATFORM_COMPANY_NAME);
}

export function getSupportEmail(env = {}) {
  return normalizeString(env.SUPPORT_EMAIL, DEFAULT_SUPPORT_EMAIL);
}

export function getOrdersEmailFrom(env = {}) {
  return normalizeString(env.ORDERS_EMAIL_FROM, DEFAULT_ORDERS_EMAIL_FROM);
}

export function getUpdatesEmailFrom(env = {}) {
  return normalizeString(env.UPDATES_EMAIL_FROM, DEFAULT_UPDATES_EMAIL_FROM);
}

export function getEmailLogoPath(env = {}) {
  return normalizeString(env.EMAIL_LOGO_PATH, '');
}

export function getEmailFontFamily(env = {}) {
  return normalizeString(env.EMAIL_FONT_FAMILY, DEFAULT_EMAIL_FONT_FAMILY);
}

export function getEmailHeadingFontFamily(env = {}) {
  return normalizeString(env.EMAIL_HEADING_FONT_FAMILY, getEmailFontFamily(env) || DEFAULT_EMAIL_HEADING_FONT_FAMILY);
}

export function getEmailTextColor(env = {}) {
  return normalizeString(env.EMAIL_COLOR_TEXT, DEFAULT_EMAIL_TEXT_COLOR);
}

export function getEmailMutedTextColor(env = {}) {
  return normalizeString(env.EMAIL_COLOR_MUTED, DEFAULT_EMAIL_MUTED_TEXT_COLOR);
}

export function getEmailSurfaceColor(env = {}) {
  return normalizeString(env.EMAIL_COLOR_SURFACE, DEFAULT_EMAIL_SURFACE_COLOR);
}

export function getEmailBorderColor(env = {}) {
  return normalizeString(env.EMAIL_COLOR_BORDER, DEFAULT_EMAIL_BORDER_COLOR);
}

export function getEmailPrimaryColor(env = {}) {
  return normalizeString(env.EMAIL_COLOR_PRIMARY, DEFAULT_EMAIL_PRIMARY_COLOR);
}

export function getEmailButtonRadius(env = {}) {
  return normalizeString(env.EMAIL_BUTTON_RADIUS, DEFAULT_EMAIL_BUTTON_RADIUS);
}

export function getSiteBase(env = {}) {
  return getResolvedUrl(env.SITE_BASE, DEFAULT_SITE_BASE);
}

export function getWorkerBase(env = {}) {
  return getResolvedUrl(env.WORKER_BASE, DEFAULT_WORKER_BASE);
}

export function formatSalesTaxLabel(env = {}) {
  return `Sales tax (${(getSalesTaxRate(env) * 100).toFixed(3).replace(/\.?0+$/, '')}%)`;
}

function normalizeFlag(value, allowedValues, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

function normalizeString(value, fallback) {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value).trim();
}

function normalizeBooleanish(value) {
  if (value === true || value === false) {
    return value;
  }
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
}

function getResolvedUrl(value, fallback) {
  try {
    return new URL(normalizeString(value, fallback)).toString();
  } catch {
    return fallback;
  }
}

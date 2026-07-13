import { validateStoreOrderDraft } from './catalog.js';
import { getValidationDiscountedSubtotalCents } from './coupons.js';
import { getDefaultPlatformTipPercent, getMaxPlatformTipPercent } from './provider-config.js';
import { calculatePlatformTip, sanitizePlatformTipPercent } from './tip.js';

const STORE_ORDER_DRAFT_VERSION = 1;
const STORE_ORDER_DRAFT_TTL_SECONDS = 86400;
const STORE_ORDER_SOURCE_WEB = 'web';
const STORE_ORDER_STATUS_DRAFT = 'draft';
const STORE_ORDER_STATUS_PAYMENT_PENDING = 'payment_pending';
const STORE_ORDER_STATUS_PAYMENT_FAILED = 'payment_failed';
const STORE_ORDER_STATUS_CONFIRMED = 'confirmed';

export {
  STORE_ORDER_DRAFT_VERSION,
  STORE_ORDER_DRAFT_TTL_SECONDS,
  STORE_ORDER_STATUS_DRAFT,
  STORE_ORDER_STATUS_PAYMENT_PENDING,
  STORE_ORDER_STATUS_PAYMENT_FAILED,
  STORE_ORDER_STATUS_CONFIRMED
};

export function getStoreOrderStorageKey(orderToken) {
  const normalized = normalizeString(orderToken);
  return normalized ? `orders:${normalized}` : '';
}

export function buildStoreOrderDraft(input = {}, options = {}) {
  const validation = options.validation || validateStoreOrderDraft(input, {
    env: options.env || {},
    snapshot: options.snapshot,
    enforceSubmittedPrices: options.enforceSubmittedPrices !== false,
    enforceInventory: options.enforceInventory === true
  });

  if (!validation.valid) {
    return {
      ok: false,
      status: 422,
      error: 'Store order draft is invalid.',
      validation
    };
  }

  const currency = getSingleCurrency(validation.items);
  if (!currency.ok) {
    return {
      ok: false,
      status: 422,
      error: 'Store order draft mixes currencies.',
      validation: {
        ...validation,
        valid: false,
        errors: [
          ...validation.errors,
          {
            code: 'currency_mismatch',
            message: 'Cart items must use a single currency.',
            currencies: currency.currencies
          }
        ]
      }
    };
  }

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const ttlSeconds = Number.isFinite(options.ttlSeconds) && options.ttlSeconds > 0
    ? Math.floor(options.ttlSeconds)
    : STORE_ORDER_DRAFT_TTL_SECONDS;
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + (ttlSeconds * 1000)).toISOString();
  const orderToken = normalizeString(options.orderToken || input.orderToken);
  const shippingCents = normalizeCents(options.shippingCents ?? input.shippingCents);
  const taxCents = normalizeCents(options.taxCents ?? input.taxCents);
  const subtotalCents = validation.totals.subtotalCents;
  const discountCents = normalizeCents(validation.totals.discountCents);
  const discountedSubtotalCents = getValidationDiscountedSubtotalCents(validation);
  const coupon = normalizeStoreCouponSnapshot(validation.totals.coupon);
  const maxTipPercent = getMaxPlatformTipPercent(options.env || {});
  const defaultTipPercent = getDefaultPlatformTipPercent(options.env || {});
  const tipPercent = sanitizePlatformTipPercent(
    options.tipPercent ?? input.tipPercent,
    defaultTipPercent,
    maxTipPercent
  );
  const tipAmountCents = calculatePlatformTip(discountedSubtotalCents, tipPercent, maxTipPercent);
  const totalCents = discountedSubtotalCents + tipAmountCents + shippingCents + taxCents;
  const customer = normalizeCustomer(input, options);
  const shippingAddress = normalizeOrderAddress(options.shippingAddress ?? input.shippingAddress);
  const billingAddress = normalizeOrderAddress(options.billingAddress ?? input.billingAddress);
  const shippingOption = normalizeString(options.shippingOption ?? input.shippingOption ?? 'standard') || 'standard';
  const preferredLang = normalizeString(options.preferredLang ?? input.preferredLang ?? input.lang ?? 'en') || 'en';
  const attribution = normalizeStoreOrderAttribution(options.attribution ?? input.attribution);

  const orderDraft = {
    version: STORE_ORDER_DRAFT_VERSION,
    orderToken,
    status: STORE_ORDER_STATUS_DRAFT,
    checkoutProvider: 'first_party',
    source: STORE_ORDER_SOURCE_WEB,
    createdAt,
    valueTime: createdAt,
    bookedAt: createdAt,
    expiresAt,
    preferredLang,
    currency: currency.value,
    customer,
    shippingAddress,
    billingAddress,
    shippingOption,
    attribution,
    items: validation.items.map(compactStoreOrderItem),
    totals: {
      itemCount: validation.totals.itemCount,
      subtotalCents,
      discountCents,
      discountedSubtotalCents,
      couponCode: coupon?.code || '',
      coupon,
      tipPercent,
      tipAmountCents,
      shippingCents,
      taxCents,
      totalCents,
      requiresPayment: totalCents > 0,
      requiresShipping: validation.totals.requiresShipping,
      requiresTurnstile: validation.totals.requiresTurnstile
    },
    fulfillment: {
      requiresShipping: validation.totals.requiresShipping,
      requiresTurnstile: validation.totals.requiresTurnstile,
      shippableItemCount: validation.items
        .filter((item) => item.shippable)
        .reduce((sum, item) => sum + item.quantity, 0)
    },
    catalog: validation.catalog
  };

  return {
    ok: true,
    orderDraft,
    validation
  };
}

export function normalizeStoreOrderDraftForHash(draft = {}) {
  const items = Array.isArray(draft.items)
    ? draft.items.map((item) => ({
        productId: normalizeString(item?.productId),
        variantId: normalizeString(item?.variantId),
        sku: normalizeString(item?.sku),
        name: normalizeString(item?.name),
        variantLabel: normalizeString(item?.variantLabel),
        quantity: normalizeQuantity(item?.quantity),
        unitPriceCents: normalizeCents(item?.unitPriceCents),
        subtotalCents: normalizeCents(item?.subtotalCents),
        discountCents: normalizeCents(item?.discountCents),
        discountedSubtotalCents: normalizeCents(item?.discountedSubtotalCents),
        currency: normalizeCurrency(item?.currency),
        fulfillmentType: normalizeString(item?.fulfillmentType),
        event: normalizeString(item?.event),
        collection: normalizeString(item?.collection),
        category: normalizeString(item?.category),
        shippingPreset: normalizeString(item?.shippingPreset),
        taxCategory: normalizeString(item?.taxCategory)
      })).sort(compareHashItems)
    : [];

  return {
    version: normalizeQuantity(draft.version),
    checkoutProvider: normalizeString(draft.checkoutProvider || 'first_party'),
    source: normalizeString(draft.source || STORE_ORDER_SOURCE_WEB),
    preferredLang: normalizeString(draft.preferredLang || 'en'),
    currency: normalizeCurrency(draft.currency),
    customer: normalizeCustomer({ customer: draft.customer }),
    shippingAddress: normalizeOrderAddress(draft.shippingAddress),
    billingAddress: normalizeOrderAddress(draft.billingAddress),
    shippingOption: normalizeString(draft.shippingOption || 'standard'),
    attribution: normalizeStoreOrderAttribution(draft.attribution),
    items,
    totals: {
      itemCount: normalizeQuantity(draft.totals?.itemCount),
      subtotalCents: normalizeCents(draft.totals?.subtotalCents),
      discountCents: normalizeCents(draft.totals?.discountCents),
      discountedSubtotalCents: normalizeCents(draft.totals?.discountedSubtotalCents),
      couponCode: normalizeString(draft.totals?.couponCode),
      coupon: normalizeStoreCouponSnapshot(draft.totals?.coupon),
      tipPercent: normalizeQuantity(draft.totals?.tipPercent),
      tipAmountCents: normalizeCents(draft.totals?.tipAmountCents),
      shippingCents: normalizeCents(draft.totals?.shippingCents),
      taxCents: normalizeCents(draft.totals?.taxCents),
      totalCents: normalizeCents(draft.totals?.totalCents),
      requiresPayment: draft.totals?.requiresPayment === true,
      requiresShipping: draft.totals?.requiresShipping === true,
      requiresTurnstile: draft.totals?.requiresTurnstile === true
    },
    fulfillment: {
      requiresShipping: draft.fulfillment?.requiresShipping === true,
      requiresTurnstile: draft.fulfillment?.requiresTurnstile === true,
      shippableItemCount: normalizeQuantity(draft.fulfillment?.shippableItemCount)
    },
    catalog: {
      version: normalizeQuantity(draft.catalog?.version),
      source: normalizeString(draft.catalog?.source),
      sourceHash: normalizeString(draft.catalog?.sourceHash)
    }
  };
}

export async function hashStoreOrderDraft(draft = {}) {
  return sha256Hex(stableStringify(normalizeStoreOrderDraftForHash(draft)));
}

function compactStoreOrderItem(item = {}) {
  return {
    productId: normalizeString(item.productId),
    variantId: normalizeString(item.variantId),
    sku: normalizeString(item.sku),
    name: normalizeString(item.name),
    variantLabel: normalizeString(item.variantLabel),
    quantity: normalizeQuantity(item.quantity),
    unitPriceCents: normalizeCents(item.unitPriceCents),
    subtotalCents: normalizeCents(item.subtotalCents),
    discountCents: normalizeCents(item.discountCents),
    discountedSubtotalCents: normalizeCents(item.discountedSubtotalCents ?? item.subtotalCents),
    currency: normalizeCurrency(item.currency),
    fulfillmentType: normalizeString(item.fulfillmentType),
    event: normalizeString(item.event),
    collection: normalizeString(item.collection),
    category: normalizeString(item.category),
    shippable: item.shippable === true,
    shippingPreset: normalizeString(item.shippingPreset),
    taxCategory: normalizeString(item.taxCategory || 'standard'),
    inventory: {
      tracking: item.inventory?.tracking === true,
      quantity: normalizeQuantity(item.inventory?.quantity)
    },
    image: normalizeString(item.image),
    url: normalizeString(item.url),
    eventDetails: item.eventDetails || null,
    download: item.download || null,
    turnstileRequired: item.turnstileRequired === true
  };
}

function normalizeStoreCouponSnapshot(coupon = null) {
  if (!coupon || typeof coupon !== 'object' || Array.isArray(coupon)) return null;
  const code = normalizeString(coupon.code).toUpperCase();
  if (!code) return null;
  return {
    id: normalizeString(coupon.id),
    code,
    description: normalizeString(coupon.description),
    discountType: normalizeString(coupon.discountType),
    percentOff: normalizeNumber(coupon.percentOff),
    amountOffCents: normalizeCents(coupon.amountOffCents),
    appliesTo: normalizeString(coupon.appliesTo),
    productIds: Array.isArray(coupon.productIds)
      ? coupon.productIds.map((productId) => normalizeString(productId)).filter(Boolean)
      : [],
    discountCents: normalizeCents(coupon.discountCents)
  };
}

function getSingleCurrency(items = []) {
  const currencies = Array.from(new Set(items.map((item) => normalizeCurrency(item.currency || 'USD'))));
  if (currencies.length > 1) {
    return { ok: false, currencies };
  }
  return {
    ok: true,
    value: currencies[0] || 'USD'
  };
}

function normalizeCustomer(input = {}, options = {}) {
  const source = input?.customer && typeof input.customer === 'object' ? input.customer : {};
  const email = normalizeString(options.email ?? source.email ?? input.email).toLowerCase();
  const name = normalizeString(options.name ?? source.name ?? input.name ?? input.shippingAddress?.name);
  const phone = normalizeString(options.phone ?? source.phone ?? input.phone);

  return { email, name, phone };
}

function normalizeStoreOrderAttribution(attribution = null) {
  const source = attribution && typeof attribution === 'object' && !Array.isArray(attribution)
    ? attribution
    : {};
  return {
    ref: normalizeString(source.ref).toLowerCase().slice(0, 80),
    utmSource: normalizeString(source.utmSource || source.utm_source).slice(0, 80),
    utmMedium: normalizeString(source.utmMedium || source.utm_medium).slice(0, 80),
    utmCampaign: normalizeString(source.utmCampaign || source.utm_campaign).slice(0, 120),
    utmContent: normalizeString(source.utmContent || source.utm_content).slice(0, 120),
    landingPath: normalizeString(source.landingPath || source.landing_path).slice(0, 2048),
    capturedAt: normalizeString(source.capturedAt || source.captured_at).slice(0, 40)
  };
}

function normalizeOrderAddress(address = null) {
  if (!address || typeof address !== 'object') return null;

  return {
    name: normalizeString(address.name),
    line1: normalizeString(address.line1 || address.address1 || address.street),
    line2: normalizeString(address.line2 || address.address2),
    city: normalizeString(address.city),
    state: normalizeString(address.state || address.province || address.region || address.stateCode).toUpperCase(),
    postalCode: normalizeString(address.postalCode || address.postal_code).toUpperCase(),
    country: normalizeString(address.country || address.countryCode).toUpperCase()
  };
}

function compareHashItems(a, b) {
  return a.sku.localeCompare(b.sku) ||
    a.productId.localeCompare(b.productId) ||
    a.variantId.localeCompare(b.variantId) ||
    a.quantity - b.quantity;
}

async function sha256Hex(input) {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeCurrency(value) {
  const normalized = normalizeString(value || 'USD').toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : 'USD';
}

function normalizeCents(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function normalizeQuantity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeString(value) {
  return String(value ?? '').trim();
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map((entry) => stableStringify(entry)).join(',') + ']';
  }

  const keys = Object.keys(value).sort();
  const parts = keys.map((key) => JSON.stringify(key) + ':' + stableStringify(value[key]));
  return '{' + parts.join(',') + '}';
}

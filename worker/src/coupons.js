export const STORE_COUPONS_STORAGE_KEY = 'store-coupons:v1';

const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;
const COUPON_STATUSES = new Set(['active', 'draft']);
const COUPON_DISCOUNT_TYPES = new Set(['percent', 'amount']);
const COUPON_APPLIES_TO = new Set(['cart', 'products']);

export function normalizeCouponCode(value = '') {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function couponCodeIsValid(value = '') {
  return COUPON_CODE_PATTERN.test(normalizeCouponCode(value));
}

export function normalizeStoreCoupon(input = {}, options = {}) {
  const errors = [];
  const nowIso = options.nowIso || new Date().toISOString();
  const previous = options.previous && typeof options.previous === 'object' ? options.previous : {};
  const code = normalizeCouponCode(input.code || input.id || previous.code);
  const id = code.toLowerCase();
  const status = String(input.status || previous.status || 'draft').trim().toLowerCase();
  const discountType = String(input.discountType || input.discount_type || previous.discountType || 'percent').trim().toLowerCase();
  const appliesTo = String(input.appliesTo || input.applies_to || previous.appliesTo || 'cart').trim().toLowerCase();
  const description = String(input.description ?? previous.description ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const productIds = Array.from(new Set(
    (Array.isArray(input.productIds) ? input.productIds : Array.isArray(input.product_ids) ? input.product_ids : Array.isArray(previous.productIds) ? previous.productIds : [])
      .map((productId) => String(productId || '').trim())
      .filter(Boolean)
  )).slice(0, 200);
  const startsAt = normalizeCouponDate(input.startsAt ?? input.starts_at ?? previous.startsAt);
  const endsAt = normalizeCouponDate(input.endsAt ?? input.ends_at ?? previous.endsAt);
  const percentOff = normalizeCouponPercent(input.percentOff ?? input.percent_off ?? previous.percentOff);
  const amountOffCents = normalizeCouponAmountCents(input.amountOffCents ?? input.amount_off_cents ?? previous.amountOffCents);

  if (!COUPON_CODE_PATTERN.test(code)) {
    errors.push('Coupon code must be 2-40 characters using letters, numbers, hyphens, or underscores.');
  }
  if (description.length > 300) {
    errors.push('Coupon description must be 300 characters or fewer.');
  }
  if (!COUPON_STATUSES.has(status)) {
    errors.push('Coupon status must be active or draft.');
  }
  if (!COUPON_DISCOUNT_TYPES.has(discountType)) {
    errors.push('Coupon discount type must be percent or amount.');
  }
  if (discountType === 'percent' && (percentOff <= 0 || percentOff > 100)) {
    errors.push('Percentage coupons must be greater than 0 and no more than 100.');
  }
  if (discountType === 'amount' && amountOffCents <= 0) {
    errors.push('Amount coupons must be greater than $0.00.');
  }
  if (!COUPON_APPLIES_TO.has(appliesTo)) {
    errors.push('Coupon scope must be whole cart or specific products.');
  }
  if (appliesTo === 'products' && productIds.length === 0) {
    errors.push('Product-specific coupons must include at least one product.');
  }
  if (startsAt && endsAt && Date.parse(startsAt) > Date.parse(endsAt)) {
    errors.push('Coupon start date must be before the end date.');
  }

  return {
    ok: errors.length === 0,
    errors,
    coupon: {
      id,
      code,
      description,
      status,
      discountType,
      percentOff: discountType === 'percent' ? percentOff : 0,
      amountOffCents: discountType === 'amount' ? amountOffCents : 0,
      appliesTo,
      productIds,
      startsAt,
      endsAt,
      createdAt: previous.createdAt || nowIso,
      updatedAt: nowIso
    }
  };
}

export async function loadStoreCoupons(env = {}) {
  if (!env?.STORE_STATE?.get) {
    return { ok: false, status: 503, error: 'Coupon storage unavailable.', coupons: [] };
  }
  const stored = await env.STORE_STATE.get(STORE_COUPONS_STORAGE_KEY, { type: 'json' });
  const rawCoupons = Array.isArray(stored?.coupons) ? stored.coupons : [];
  const coupons = [];
  for (const rawCoupon of rawCoupons) {
    const normalized = normalizeStoreCoupon(rawCoupon, { previous: rawCoupon });
    if (normalized.ok) coupons.push(normalized.coupon);
  }
  coupons.sort(compareStoreCoupons);
  return {
    ok: true,
    version: Number(stored?.version || 1),
    coupons,
    updatedAt: String(stored?.updatedAt || '')
  };
}

export async function saveStoreCoupons(env = {}, coupons = []) {
  if (!env?.STORE_STATE?.put) {
    return { ok: false, status: 503, error: 'Coupon storage unavailable.' };
  }
  const nowIso = new Date().toISOString();
  const normalizedCoupons = [];
  const errors = [];
  const seen = new Set();

  for (const coupon of Array.isArray(coupons) ? coupons : []) {
    const normalized = normalizeStoreCoupon(coupon, { previous: coupon, nowIso });
    if (!normalized.ok) {
      errors.push(...normalized.errors);
      continue;
    }
    if (seen.has(normalized.coupon.code)) {
      errors.push(`Duplicate coupon code: ${normalized.coupon.code}.`);
      continue;
    }
    seen.add(normalized.coupon.code);
    normalizedCoupons.push(normalized.coupon);
  }
  if (errors.length > 0) {
    return { ok: false, status: 422, error: errors[0], errors };
  }

  normalizedCoupons.sort(compareStoreCoupons);
  await env.STORE_STATE.put(STORE_COUPONS_STORAGE_KEY, JSON.stringify({
    version: 1,
    coupons: normalizedCoupons,
    updatedAt: nowIso
  }));
  return { ok: true, coupons: normalizedCoupons, updatedAt: nowIso };
}

export function upsertStoreCoupon(coupons = [], incoming = {}, options = {}) {
  const existingCoupons = Array.isArray(coupons) ? coupons : [];
  const originalCode = normalizeCouponCode(options.originalCode || incoming.originalCode || incoming.original_code || '');
  const incomingCode = normalizeCouponCode(incoming.code || incoming.id || '');
  const nowIso = options.nowIso || new Date().toISOString();
  const existing = originalCode
    ? findCouponByCode(existingCoupons, originalCode)
    : null;

  if (originalCode && !existing) {
    return {
      ok: false,
      status: 404,
      error: 'Original coupon code was not found.',
      errors: ['Original coupon code was not found.']
    };
  }

  if (!originalCode && incomingCode && findCouponByCode(existingCoupons, incomingCode)) {
    return {
      ok: false,
      status: 409,
      error: 'Coupon code already exists.',
      errors: ['Coupon code already exists.']
    };
  }

  const normalized = normalizeStoreCoupon(incoming, {
    previous: existing || {},
    nowIso
  });
  if (!normalized.ok) {
    return {
      ok: false,
      status: 422,
      error: normalized.errors[0] || 'Coupon is invalid.',
      errors: normalized.errors
    };
  }

  const duplicate = existingCoupons.find((coupon) => (
    coupon.code === normalized.coupon.code &&
    (!existing || coupon.code !== existing.code)
  ));
  if (duplicate) {
    return {
      ok: false,
      status: 409,
      error: 'Coupon code already exists.',
      errors: ['Coupon code already exists.']
    };
  }

  const nextCoupons = existingCoupons
    .filter((coupon) => existing
      ? coupon.code !== existing.code && coupon.id !== existing.id
      : coupon.code !== normalized.coupon.code && coupon.id !== normalized.coupon.id)
    .concat(normalized.coupon);

  return {
    ok: true,
    coupon: normalized.coupon,
    coupons: nextCoupons,
    existing
  };
}

export async function applyStoreCouponCode(env = {}, couponCode = '', validation = {}, options = {}) {
  const code = normalizeCouponCode(couponCode);
  if (!code) return { ok: true, validation, coupon: null, discountCents: 0 };

  if (!COUPON_CODE_PATTERN.test(code)) {
    return couponApplicationError('coupon_invalid', 'Coupon code is invalid.', { status: 422, code });
  }

  const loaded = await loadStoreCoupons(env);
  if (!loaded.ok) return loaded;
  const coupon = loaded.coupons.find((candidate) => candidate.code === code);
  if (!coupon) {
    return couponApplicationError('coupon_not_found', 'Coupon code was not found.', { status: 404, code });
  }
  if (options.requireActive !== false && coupon.status !== 'active') {
    return couponApplicationError('coupon_inactive', 'Coupon code is not active.', { status: 422, code });
  }

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  if (coupon.startsAt && Date.parse(coupon.startsAt) > nowMs) {
    return couponApplicationError('coupon_not_started', 'Coupon code is not active yet.', { status: 422, code });
  }
  if (coupon.endsAt && Date.parse(coupon.endsAt) < nowMs) {
    return couponApplicationError('coupon_expired', 'Coupon code has expired.', { status: 422, code });
  }

  const applied = applyStoreCouponToValidation(validation, coupon);
  if (!applied.ok) return applied;
  return {
    ok: true,
    coupon: buildCouponPublicSnapshot(coupon, applied.discountCents),
    validation: applied.validation,
    discountCents: applied.discountCents
  };
}

export function applyStoreCouponToValidation(validation = {}, coupon = {}) {
  const items = Array.isArray(validation.items) ? validation.items : [];
  const eligibleIndexes = getCouponEligibleItemIndexes(items, coupon);
  const eligibleSubtotalCents = eligibleIndexes.reduce((sum, index) => (
    sum + normalizeCents(items[index]?.subtotalCents)
  ), 0);
  if (eligibleIndexes.length === 0 || eligibleSubtotalCents <= 0) {
    return couponApplicationError('coupon_not_eligible', 'Coupon code does not apply to this cart.', {
      status: 422,
      code: coupon.code
    });
  }

  const targetDiscountCents = coupon.discountType === 'percent'
    ? Math.min(eligibleSubtotalCents, Math.round((eligibleSubtotalCents * normalizeCouponPercent(coupon.percentOff)) / 100))
    : Math.min(eligibleSubtotalCents, normalizeCouponAmountCents(coupon.amountOffCents));

  if (targetDiscountCents <= 0) {
    return couponApplicationError('coupon_not_eligible', 'Coupon code does not apply to this cart.', {
      status: 422,
      code: coupon.code
    });
  }

  const allocations = allocateDiscountCents(items, eligibleIndexes, targetDiscountCents);
  const nextItems = items.map((item, index) => {
    const discountCents = normalizeCents(allocations.get(index));
    const subtotalCents = normalizeCents(item?.subtotalCents);
    return {
      ...item,
      discountCents,
      discountedSubtotalCents: Math.max(0, subtotalCents - discountCents)
    };
  });
  const subtotalCents = normalizeCents(validation?.totals?.subtotalCents) ||
    nextItems.reduce((sum, item) => sum + normalizeCents(item.subtotalCents), 0);
  const discountCents = nextItems.reduce((sum, item) => sum + normalizeCents(item.discountCents), 0);
  const discountedSubtotalCents = Math.max(0, subtotalCents - discountCents);
  const taxableSubtotalCents = nextItems.reduce((sum, item) => {
    if (String(item?.taxCategory || 'standard').trim().toLowerCase() === 'exempt') return sum;
    return sum + normalizeCents(item.discountedSubtotalCents ?? item.subtotalCents);
  }, 0);

  return {
    ok: true,
    discountCents,
    validation: {
      ...validation,
      items: nextItems,
      totals: {
        ...(validation.totals || {}),
        subtotalCents,
        discountCents,
        discountedSubtotalCents,
        taxableSubtotalCents,
        requiresPayment: discountedSubtotalCents > 0,
        coupon: buildCouponPublicSnapshot(coupon, discountCents)
      }
    }
  };
}

export function getValidationDiscountedSubtotalCents(validation = {}) {
  const subtotal = normalizeCents(validation?.totals?.subtotalCents);
  const discount = normalizeCents(validation?.totals?.discountCents);
  if (Object.prototype.hasOwnProperty.call(validation?.totals || {}, 'discountedSubtotalCents')) {
    return normalizeCents(validation.totals.discountedSubtotalCents);
  }
  return Math.max(0, subtotal - discount);
}

export function getValidationTaxableSubtotalCents(validation = {}) {
  if (Object.prototype.hasOwnProperty.call(validation?.totals || {}, 'taxableSubtotalCents')) {
    return normalizeCents(validation.totals.taxableSubtotalCents);
  }
  const items = Array.isArray(validation.items) ? validation.items : [];
  if (items.length > 0) {
    return items.reduce((sum, item) => {
      if (String(item?.taxCategory || 'standard').trim().toLowerCase() === 'exempt') return sum;
      return sum + normalizeCents(item.discountedSubtotalCents ?? item.subtotalCents);
    }, 0);
  }
  return getValidationDiscountedSubtotalCents(validation);
}

function buildCouponPublicSnapshot(coupon = {}, discountCents = 0) {
  if (!coupon?.code) return null;
  return {
    id: String(coupon.id || '').trim(),
    code: normalizeCouponCode(coupon.code),
    description: String(coupon.description || '').trim(),
    discountType: String(coupon.discountType || '').trim(),
    percentOff: normalizeCouponPercent(coupon.percentOff),
    amountOffCents: normalizeCouponAmountCents(coupon.amountOffCents),
    appliesTo: String(coupon.appliesTo || 'cart').trim(),
    productIds: Array.isArray(coupon.productIds) ? coupon.productIds : [],
    discountCents: normalizeCents(discountCents)
  };
}

function findCouponByCode(coupons = [], code = '') {
  const normalizedCode = normalizeCouponCode(code);
  const normalizedId = normalizedCode.toLowerCase();
  if (!normalizedCode) return null;
  return (Array.isArray(coupons) ? coupons : []).find((coupon) => (
    coupon.code === normalizedCode ||
    coupon.id === normalizedId
  )) || null;
}

function getCouponEligibleItemIndexes(items = [], coupon = {}) {
  const appliesTo = String(coupon.appliesTo || 'cart').trim().toLowerCase();
  if (appliesTo === 'cart') {
    return items
      .map((_item, index) => index)
      .filter((index) => normalizeCents(items[index]?.subtotalCents) > 0);
  }
  const productIds = new Set((Array.isArray(coupon.productIds) ? coupon.productIds : [])
    .map((productId) => String(productId || '').trim())
    .filter(Boolean));
  if (productIds.size === 0) return [];
  return items
    .map((item, index) => productIds.has(String(item?.productId || '').trim()) ? index : -1)
    .filter((index) => index >= 0 && normalizeCents(items[index]?.subtotalCents) > 0);
}

function allocateDiscountCents(items = [], eligibleIndexes = [], targetDiscountCents = 0) {
  const allocations = new Map();
  const target = normalizeCents(targetDiscountCents);
  if (target <= 0 || eligibleIndexes.length === 0) return allocations;

  const eligibleSubtotal = eligibleIndexes.reduce((sum, index) => sum + normalizeCents(items[index]?.subtotalCents), 0);
  if (eligibleSubtotal <= 0) return allocations;

  let remaining = target;
  eligibleIndexes.forEach((index, position) => {
    const subtotal = normalizeCents(items[index]?.subtotalCents);
    const allocation = position === eligibleIndexes.length - 1
      ? remaining
      : Math.min(subtotal, Math.floor((target * subtotal) / eligibleSubtotal));
    const safeAllocation = Math.max(0, Math.min(subtotal, allocation));
    allocations.set(index, safeAllocation);
    remaining -= safeAllocation;
  });

  let cursor = 0;
  while (remaining > 0 && eligibleIndexes.length > 0) {
    const index = eligibleIndexes[cursor % eligibleIndexes.length];
    const subtotal = normalizeCents(items[index]?.subtotalCents);
    const current = normalizeCents(allocations.get(index));
    if (current < subtotal) {
      allocations.set(index, current + 1);
      remaining -= 1;
    }
    cursor += 1;
    if (cursor > eligibleIndexes.length * target) break;
  }

  return allocations;
}

function couponApplicationError(code, message, details = {}) {
  return {
    ok: false,
    status: details.status || 422,
    code,
    error: message,
    couponCode: normalizeCouponCode(details.code || '')
  };
}

function normalizeCouponDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

function normalizeCouponPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(Math.max(0, Math.min(100, parsed)) * 100) / 100;
}

function normalizeCouponAmountCents(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function normalizeCents(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function compareStoreCoupons(a = {}, b = {}) {
  if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
  return String(a.code || '').localeCompare(String(b.code || ''));
}

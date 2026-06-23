import STORE_CATALOG_SNAPSHOT from './generated/catalog-snapshot.js';

const ACTIVE_STATUSES = new Set(['active', 'available', 'live']);
const NON_SHIPPABLE_TYPES = new Set(['digital', 'ticket', 'rsvp', 'service']);

export function getStoreCatalogSnapshot(env = {}, options = {}) {
  if (options.snapshot) return options.snapshot;

  const rawJson = env?.STORE_CATALOG_JSON || env?.CATALOG_SNAPSHOT_JSON || '';
  if (rawJson) {
    try {
      return JSON.parse(rawJson);
    } catch (_error) {
      return STORE_CATALOG_SNAPSHOT;
    }
  }

  return STORE_CATALOG_SNAPSHOT;
}

export function normalizeStoreCatalogSnapshot(snapshot = STORE_CATALOG_SNAPSHOT) {
  const products = Array.isArray(snapshot?.products) ? snapshot.products : [];
  const productById = new Map();
  const productBySku = new Map();

  for (const product of products) {
    const id = normalizeString(product?.id);
    const sku = normalizeString(product?.sku);
    if (id) productById.set(id, product);
    if (sku) productBySku.set(sku, product);
  }

  return {
    version: Number(snapshot?.version || 1),
    source: normalizeString(snapshot?.source || ''),
    sourceHash: normalizeString(snapshot?.source_hash || ''),
    defaults: snapshot?.defaults || {},
    shipping: snapshot?.shipping || {},
    products,
    productById,
    productBySku
  };
}

export function findStoreProduct(productIdOrSku, snapshot = STORE_CATALOG_SNAPSHOT) {
  const catalog = normalizeStoreCatalogSnapshot(snapshot);
  const key = normalizeString(productIdOrSku);
  if (!key) return null;
  return catalog.productById.get(key) || catalog.productBySku.get(key) || null;
}

export function validateStoreOrderDraft(draft = {}, options = {}) {
  const snapshot = getStoreCatalogSnapshot(options.env || {}, options);
  const catalog = normalizeStoreCatalogSnapshot(snapshot);
  const rawItems = getDraftItems(draft);
  const errors = [];
  const warnings = [];
  const items = [];

  rawItems.forEach((rawItem, index) => {
    const result = validateStoreOrderDraftItem(rawItem, catalog, {
      ...options,
      index
    });

    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (result.item) items.push(result.item);
  });

  if (rawItems.length === 0) {
    errors.push(buildValidationIssue('empty_cart', 'Cart has no items.'));
  }

  const subtotalCents = items.reduce((sum, item) => sum + item.subtotalCents, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    items,
    totals: {
      itemCount,
      subtotalCents,
      requiresPayment: subtotalCents > 0,
      requiresShipping: items.some((item) => item.shippable),
      requiresTurnstile: items.some((item) => item.turnstileRequired)
    },
    catalog: {
      version: catalog.version,
      source: catalog.source,
      sourceHash: catalog.sourceHash
    }
  };
}

export function validateStoreOrderDraftItem(rawItem = {}, catalog, options = {}) {
  const index = Number.isInteger(options.index) ? options.index : 0;
  const errors = [];
  const warnings = [];
  const parsedId = splitStoreItemId(rawItem?.id);
  const productId = firstPresent([
    rawItem?.productId,
    rawItem?.product_id,
    getCustomFieldValue(rawItem, ['_product_id', 'product_id']),
    parsedId.productId,
    rawItem?.sku
  ]);
  const product = resolveCatalogProduct(productId, catalog);

  if (!product) {
    return {
      item: null,
      errors: [
        buildValidationIssue(
          'unknown_product',
          'Product does not exist in the Store catalog.',
          { index, productId: productId || normalizeString(rawItem?.id) }
        )
      ],
      warnings
    };
  }

  if (!isActiveStatus(product.status)) {
    errors.push(buildValidationIssue(
      'product_unavailable',
      'Product is not available for checkout.',
      { index, productId: product.id, status: normalizeString(product.status) }
    ));
  }

  const quantity = normalizeQuantity(rawItem?.quantity);
  if (quantity < 1) {
    errors.push(buildValidationIssue(
      'invalid_quantity',
      'Item quantity must be at least 1.',
      { index, productId: product.id }
    ));
  }

  const variant = resolveCatalogVariant(product, rawItem, parsedId);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length > 0 && !variant) {
    errors.push(buildValidationIssue(
      'variant_required',
      'Product requires a valid variant.',
      { index, productId: product.id }
    ));
  }

  if (variant && !isActiveStatus(variant.status || product.status)) {
    errors.push(buildValidationIssue(
      'variant_unavailable',
      'Product variant is not available for checkout.',
      { index, productId: product.id, variantId: variant.id, status: normalizeString(variant.status) }
    ));
  }

  const unitPriceCents = normalizeMoneyCents(variant?.price_cents ?? product.price_cents);
  const submittedPriceCents = getSubmittedUnitPriceCents(rawItem);
  if (options.enforceSubmittedPrices !== false && submittedPriceCents !== null && submittedPriceCents !== unitPriceCents) {
    errors.push(buildValidationIssue(
      'price_mismatch',
      'Submitted item price does not match the Store catalog.',
      {
        index,
        productId: product.id,
        variantId: variant?.id || '',
        submittedPriceCents,
        expectedPriceCents: unitPriceCents
      }
    ));
  }

  const fulfillmentType = normalizeString(product.fulfillment_type || product.type || 'physical');
  const shippable = !NON_SHIPPABLE_TYPES.has(fulfillmentType);
  const inventoryQuantity = normalizeInventory(variant?.inventory ?? product.inventory);
  const inventoryTracking = product.inventory_tracking === true;

  if (inventoryTracking && inventoryQuantity <= 0) {
    const issue = buildValidationIssue(
      'inventory_unset_or_empty',
      'Inventory is tracked for this SKU but no available quantity is configured yet.',
      { index, productId: product.id, variantId: variant?.id || '', sku: variant?.sku || product.sku || '' }
    );
    if (options.enforceInventory === true) {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
  } else if (inventoryTracking && options.enforceInventory === true && quantity > inventoryQuantity) {
    errors.push(buildValidationIssue(
      'insufficient_inventory',
      'Requested quantity exceeds available inventory.',
      {
        index,
        productId: product.id,
        variantId: variant?.id || '',
        sku: variant?.sku || product.sku || '',
        requestedQuantity: quantity,
        availableQuantity: inventoryQuantity
      }
    ));
  }

  return {
    item: {
      productId: product.id,
      variantId: variant?.id || '',
      sku: variant?.sku || product.sku || product.id,
      name: product.name || product.id,
      variantLabel: variant?.label || '',
      quantity,
      unitPriceCents,
      subtotalCents: unitPriceCents * quantity,
      currency: product.currency || catalog.defaults?.currency || 'USD',
      fulfillmentType,
      event: product.event || product.collection || '',
      collection: product.collection || product.event || '',
      category: product.category || '',
      shippable,
      status: product.status || 'active',
      image: product.image || '',
      url: product.url || '',
      shippingPreset: shippable ? (product.shipping_preset || '') : '',
      shipping: shippable ? (product.shipping || null) : null,
      taxCategory: product.tax_category || catalog.defaults?.tax_category || 'standard',
      inventory: {
        tracking: inventoryTracking,
        quantity: inventoryQuantity
      },
      eventDetails: product.event_details || null,
      download: product.download || null,
      turnstileRequired: product.turnstile_required === true
    },
    errors,
    warnings
  };
}

function getDraftItems(draft = {}) {
  if (Array.isArray(draft?.items)) return draft.items;
  if (Array.isArray(draft?.cart?.items)) return draft.cart.items;
  if (Array.isArray(draft?.cart?.items?.items)) return draft.cart.items.items;
  return [];
}

function resolveCatalogProduct(productIdOrSku, catalog) {
  const key = normalizeString(productIdOrSku);
  if (!key) return null;
  return catalog.productById.get(key) || catalog.productBySku.get(key) || null;
}

function resolveCatalogVariant(product, rawItem, parsedId) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (variants.length === 0) return null;

  const requested = firstPresent([
    rawItem?.variantId,
    rawItem?.variant_id,
    getCustomFieldValue(rawItem, ['_variant_id', 'variant_id']),
    parsedId.variantId,
    getCustomFieldValue(rawItem, ['_variant', 'variant'])
  ]);
  if (!requested) return null;

  const normalizedRequested = normalizeString(requested).toLowerCase();
  return variants.find((variant) => {
    return [
      variant?.id,
      variant?.sku,
      variant?.label,
      variant?.name
    ].some((candidate) => normalizeString(candidate).toLowerCase() === normalizedRequested);
  }) || null;
}

function splitStoreItemId(rawId) {
  const id = normalizeString(rawId);
  if (!id) return { productId: '', variantId: '' };
  const marker = id.indexOf('__');
  if (marker < 0) return { productId: id, variantId: '' };
  return {
    productId: id.slice(0, marker),
    variantId: id.slice(marker + 2)
  };
}

function getCustomFieldValue(item, names = []) {
  const fields = Array.isArray(item?.customFields)
    ? item.customFields
    : Array.isArray(item?.custom_fields)
      ? item.custom_fields
      : [];
  const wanted = new Set(names.map((name) => normalizeString(name).toLowerCase()));
  const match = fields.find((field) => wanted.has(normalizeString(field?.name).toLowerCase()));
  return match ? normalizeString(match.value) : '';
}

function getSubmittedUnitPriceCents(item) {
  if (item?.price_cents !== undefined) return normalizeMoneyCents(item.price_cents);
  if (item?.unitPriceCents !== undefined) return normalizeMoneyCents(item.unitPriceCents);
  if (item?.unit_price_cents !== undefined) return normalizeMoneyCents(item.unit_price_cents);
  if (item?.price === undefined && item?.unitPrice === undefined && item?.unit_price === undefined) return null;
  return Math.round(Number(item.price ?? item.unitPrice ?? item.unit_price ?? 0) * 100);
}

function normalizeMoneyCents(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function normalizeQuantity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizeInventory(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function isActiveStatus(status) {
  return ACTIVE_STATUSES.has(normalizeString(status || 'active').toLowerCase());
}

function firstPresent(values = []) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return '';
}

function normalizeString(value) {
  return String(value ?? '').trim();
}

function buildValidationIssue(code, message, details = {}) {
  return {
    code,
    message,
    ...details
  };
}

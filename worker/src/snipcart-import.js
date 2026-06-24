import {
  STORE_ORDER_DRAFT_VERSION,
  STORE_ORDER_STATUS_CONFIRMED
} from './orders.js';

export const SNIPCART_IMPORT_MAX_CSV_BYTES = 1024 * 1024;
export const SNIPCART_IMPORT_MAX_ROWS = 2500;

const REQUIRED_SNIPCART_HEADERS = [
  'Invoice number',
  'Token',
  'Customer name',
  'Customer email',
  'Order date',
  'Order status',
  'Currency',
  'Payment status',
  'Sub total',
  'Grand total',
  'Adjusted total',
  'Refunds amount',
  'Discounts total',
  'Taxes total',
  'Shipping fees',
  'Shipping method',
  'Item ID',
  'Item name',
  'Unit price',
  'Quantity',
  'Total price'
];

const PHYSICAL_LEGACY_ITEM_PATTERN = /\b(t-?shirt|shirt|tee|sticker|bumper|postcard|poster|print|mug|calendar|vhs|tape|bucket|thong|condom|zine|book)\b/i;

export function parseSnipcartOrdersCsv(csvText, options = {}) {
  const text = String(csvText || '').replace(/^\uFEFF/, '');
  if (!text.trim()) {
    return { ok: false, status: 400, error: 'Snipcart CSV is empty.' };
  }

  const parsedRows = parseCsvRows(text);
  if (parsedRows.length < 2) {
    return { ok: false, status: 400, error: 'Snipcart CSV must include a header row and at least one order row.' };
  }

  const headers = parsedRows[0].map((header) => String(header || '').trim());
  const headerLookup = new Map(headers.map((header, index) => [header, index]));
  const missingHeaders = REQUIRED_SNIPCART_HEADERS.filter((header) => !headerLookup.has(header));
  if (missingHeaders.length) {
    return {
      ok: false,
      status: 422,
      error: 'Snipcart CSV is missing required columns.',
      missingHeaders
    };
  }

  const dataRows = parsedRows.slice(1).filter((row) => row.some((value) => String(value || '').trim()));
  if (dataRows.length > SNIPCART_IMPORT_MAX_ROWS) {
    return {
      ok: false,
      status: 413,
      error: `Snipcart CSV has too many rows. Import ${SNIPCART_IMPORT_MAX_ROWS} rows or fewer at a time.`
    };
  }

  const rowObjects = dataRows.map((row, index) => {
    const object = { __rowNumber: index + 2 };
    headers.forEach((header, headerIndex) => {
      if (!header) return;
      object[header] = String(row[headerIndex] || '').trim();
    });
    return object;
  });

  const importedAt = normalizeIsoDate(options.importedAt) || new Date().toISOString();
  const grouped = groupSnipcartRows(rowObjects);
  const orders = [];
  const errors = [];
  const warnings = [];

  grouped.forEach((rows, groupKey) => {
    const mapped = buildSnipcartImportedOrder(rows, { importedAt });
    if (!mapped.ok) {
      errors.push({
        groupKey,
        rows: rows.map((row) => row.__rowNumber),
        error: mapped.error || 'Unable to map Snipcart order.'
      });
      return;
    }
    if (mapped.warnings?.length) warnings.push(...mapped.warnings);
    orders.push(mapped.order);
  });

  if (!orders.length) {
    return {
      ok: false,
      status: 422,
      error: errors[0]?.error || 'No importable Snipcart orders were found.',
      errors,
      warnings
    };
  }

  orders.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
    String(a.orderToken || '').localeCompare(String(b.orderToken || '')));

  return {
    ok: true,
    rowCount: dataRows.length,
    orderCount: orders.length,
    orders,
    errors,
    warnings
  };
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }

  row.push(field);
  if (row.length > 1 || String(row[0] || '').trim()) rows.push(row);
  return rows;
}

function groupSnipcartRows(rows) {
  const groups = new Map();
  rows.forEach((row, index) => {
    const invoiceNumber = cleanText(row['Invoice number']);
    const token = cleanText(row.Token);
    const key = [invoiceNumber, token].filter(Boolean).join('|') || `row-${index + 1}`;
    const existing = groups.get(key) || [];
    existing.push(row);
    groups.set(key, existing);
  });
  return groups;
}

function buildSnipcartImportedOrder(rows, options = {}) {
  const first = rows[0] || {};
  const invoiceNumber = cleanText(first['Invoice number']);
  const legacyToken = cleanText(first.Token);
  const orderToken = buildSnipcartOrderToken(invoiceNumber, legacyToken);
  if (!orderToken) return { ok: false, error: 'Snipcart order is missing invoice number and token.' };

  const currency = normalizeCurrency(first.Currency);
  const createdAt = parseSnipcartDate(first['Order date']) || options.importedAt || new Date().toISOString();
  const importedAt = options.importedAt || new Date().toISOString();
  const customer = {
    email: cleanText(first['Customer email']).toLowerCase(),
    name: cleanText(first['Customer name']),
    phone: cleanText(first['Customer phone'])
  };
  const billingAddress = buildSnipcartAddress(first, 'Billing', customer.name);
  const shippingAddress = buildSnipcartAddress(first, 'Shipping', cleanText(first['Ship to']) || customer.name) ||
    (isTruthy(first['Ship to the billing address']) ? billingAddress : null);
  const items = rows.map((row, index) => buildSnipcartImportedItem(row, {
    currency,
    index,
    orderHasShipping: hasLegacyShipping(first)
  })).filter(Boolean);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  if (!items.length || itemCount <= 0) {
    return { ok: false, error: 'Snipcart order has no importable line items.' };
  }

  const subtotalCents = moneyToCents(first['Sub total']);
  const shippingCents = moneyToCents(first['Shipping fees']);
  const taxCents = moneyToCents(first['Taxes total']);
  const grandTotalCents = moneyToCents(first['Grand total']);
  const adjustedTotalCents = moneyToCents(first['Adjusted total']);
  const refundsCents = Math.abs(moneyToCents(first['Refunds amount'], { allowNegative: true }));
  const discountsCents = Math.abs(moneyToCents(first['Discounts total'], { allowNegative: true }));
  const totalCents = adjustedTotalCents || Math.max(0, grandTotalCents - refundsCents);
  const requiresShipping = items.some((item) => item.shippable === true);
  const orderDraft = {
    version: STORE_ORDER_DRAFT_VERSION,
    orderToken,
    status: STORE_ORDER_STATUS_CONFIRMED,
    checkoutProvider: 'snipcart',
    source: 'snipcart',
    createdAt,
    confirmedAt: createdAt,
    expiresAt: '',
    preferredLang: 'en',
    currency,
    customer,
    shippingAddress,
    billingAddress,
    shippingOption: cleanText(first['Shipping method']) || 'legacy',
    attribution: {
      ref: '',
      utmSource: '',
      utmMedium: '',
      utmCampaign: '',
      utmContent: '',
      landingPath: '',
      capturedAt: ''
    },
    items,
    totals: {
      itemCount,
      subtotalCents,
      tipPercent: 0,
      tipAmountCents: 0,
      shippingCents,
      taxCents,
      discountCents: discountsCents,
      refundCents: refundsCents,
      grandTotalCents,
      adjustedTotalCents,
      totalCents,
      requiresPayment: totalCents > 0,
      requiresShipping,
      requiresTurnstile: false
    },
    fulfillment: {
      requiresShipping,
      requiresTurnstile: false,
      shippableItemCount: items.filter((item) => item.shippable === true)
        .reduce((sum, item) => sum + item.quantity, 0)
    },
    catalog: {
      version: 0,
      source: 'snipcart',
      sourceHash: ''
    }
  };

  const legacy = {
    provider: 'snipcart',
    invoiceNumber,
    token: legacyToken,
    orderStatus: cleanText(first['Order status']),
    paymentStatus: cleanText(first['Payment status']),
    paymentMethod: cleanText(first['Payment Method']),
    paymentGatewayUsed: cleanText(first['Payment Gateway Used']),
    paymentGatewayTransactionId: cleanText(first.PaymentGatewayTransactionId),
    shippingMethod: cleanText(first['Shipping method']),
    discountsCents,
    refundsCents,
    grandTotalCents,
    adjustedTotalCents,
    rowCount: rows.length,
    importedAt
  };

  const order = {
    version: STORE_ORDER_DRAFT_VERSION,
    orderToken,
    checkoutProvider: 'snipcart',
    source: 'snipcart',
    status: STORE_ORDER_STATUS_CONFIRMED,
    createdAt,
    confirmedAt: createdAt,
    updatedAt: importedAt,
    importedAt,
    orderDraft,
    payment: {
      required: totalCents > 0,
      provider: 'snipcart',
      status: 'succeeded',
      amountCents: totalCents,
      currency,
      method: legacy.paymentMethod,
      gateway: legacy.paymentGatewayUsed,
      transactionId: legacy.paymentGatewayTransactionId,
      confirmedAt: createdAt
    },
    legacy
  };

  const warnings = [];
  if (!customer.email) {
    warnings.push({ orderToken, warning: 'missing_customer_email' });
  }
  if (discountsCents > 0 || refundsCents > 0) {
    warnings.push({ orderToken, warning: 'legacy_adjustments_present' });
  }

  return { ok: true, order, warnings };
}

function buildSnipcartImportedItem(row, options = {}) {
  const itemId = cleanText(row['Item ID']);
  const name = cleanText(row['Item name']) || itemId || `Legacy item ${options.index + 1}`;
  const type = cleanText(row.Type);
  const size = cleanText(row.Size);
  const variantLabel = [type, size].filter(Boolean).join(' / ');
  const variantId = slugify([type, size].filter(Boolean).join('-'), '');
  const fulfillmentType = inferLegacyFulfillmentType(row, options);
  const quantity = Math.max(1, Number.parseInt(cleanText(row.Quantity) || '1', 10) || 1);
  const unitPriceCents = moneyToCents(row['Unit price']);
  const subtotalCents = moneyToCents(row['Total price']) || unitPriceCents * quantity;
  const productId = slugify(itemId || name, `legacy-item-${options.index + 1}`);

  return {
    productId,
    variantId,
    sku: itemId || productId,
    name,
    variantLabel,
    quantity,
    unitPriceCents,
    subtotalCents,
    currency: options.currency || 'USD',
    fulfillmentType,
    event: '',
    collection: '',
    category: 'legacy',
    shippable: fulfillmentType === 'physical',
    shippingPreset: inferLegacyShippingPreset(row),
    taxCategory: fulfillmentType === 'physical' ? 'standard' : 'admission',
    inventory: {
      tracking: false,
      quantity: 0
    },
    image: '',
    url: cleanText(row['Item url']),
    eventDetails: null,
    download: null,
    turnstileRequired: false,
    legacy: {
      provider: 'snipcart',
      itemId,
      description: cleanText(row['Item description']),
      type,
      size,
      totalWeight: cleanText(row['Total Weight'])
    }
  };
}

function inferLegacyFulfillmentType(row, options = {}) {
  const text = `${row['Item ID'] || ''} ${row['Item name'] || ''}`;
  if (PHYSICAL_LEGACY_ITEM_PATTERN.test(text)) return 'physical';
  if (options.orderHasShipping === true) return 'physical';
  return 'legacy';
}

function inferLegacyShippingPreset(row) {
  const text = `${row['Item ID'] || ''} ${row['Item name'] || ''}`.toLowerCase();
  if (/t-?shirt|shirt|tee/.test(text)) return 'tshirt';
  if (/sticker|bumper|postcard/.test(text)) return 'sticker';
  if (/poster|print/.test(text)) return 'poster';
  if (/mug/.test(text)) return 'mug';
  if (/calendar|vhs|tape|bucket|thong|condom|zine|book/.test(text)) return 'parcel';
  return '';
}

function hasLegacyShipping(row) {
  return Boolean(cleanText(row['Shipping method'])) || moneyToCents(row['Shipping fees']) > 0;
}

function buildSnipcartAddress(row, prefix, fallbackName) {
  const keyPrefix = prefix === 'Billing' ? 'Billing address' : 'Shipping address';
  const name = prefix === 'Billing'
    ? cleanText(row['Customer name'])
    : cleanText(row['Ship to']);
  const address = {
    name: name || cleanText(fallbackName),
    line1: cleanText(row[keyPrefix]),
    line2: cleanText(row[`${keyPrefix} 2`]),
    city: cleanText(row[`${keyPrefix} city`]),
    state: cleanText(row[`${keyPrefix} province/state`]).toUpperCase(),
    postalCode: cleanText(row[`${keyPrefix} postal code`]).toUpperCase(),
    country: cleanText(row[`${keyPrefix} country`]).toUpperCase()
  };
  if (!address.line1 && !address.city && !address.postalCode && !address.country) return null;
  return address;
}

function buildSnipcartOrderToken(invoiceNumber, legacyToken) {
  const seed = slugify(invoiceNumber || legacyToken, '');
  return seed ? `store-order-snipcart-${seed}` : '';
}

function parseSnipcartDate(value) {
  const text = cleanText(value);
  if (!text) return '';
  const mysqlLike = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/);
  const date = mysqlLike
    ? new Date(`${mysqlLike[1]}T${mysqlLike[2]}Z`)
    : new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function normalizeIsoDate(value) {
  const date = new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function moneyToCents(value, options = {}) {
  const raw = cleanText(value);
  if (!raw) return 0;
  const negativeByParens = /^\(.*\)$/.test(raw);
  const normalized = raw.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '$1');
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return 0;
  const signed = negativeByParens ? -parsed : parsed;
  const cents = Math.round(signed * 100);
  if (options.allowNegative === true) return cents;
  return Math.max(0, cents);
}

function normalizeCurrency(value) {
  const currency = cleanText(value || 'USD').toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'y', 'on'].includes(cleanText(value).toLowerCase());
}

function slugify(value, fallback = 'item') {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return slug || fallback;
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

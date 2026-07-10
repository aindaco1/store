export const ADMIN_STORE_ORDER_INDEX_KEY = 'admin-store-orders:index:v2';
export const ADMIN_STORE_ORDER_INDEX_VERSION = 2;

const STORE_ORDER_TOKEN_PATTERN = /^store-order-[a-z0-9_-]+$/i;
const STORE_ORDER_WATERMARK_PATTERN = /^orders-v2-[a-f0-9]{16}$/;

export function parseReadModelTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function adminStoreOrderUpdatedAt(order = {}) {
  let latestMs = null;
  for (const value of [order.updatedAt, order.confirmedAt, order.failedAt, order.createdAt]) {
    const parsed = parseReadModelTimestamp(value);
    if (parsed !== null && (latestMs === null || parsed > latestMs)) latestMs = parsed;
  }
  return latestMs === null ? '' : new Date(latestMs).toISOString();
}

export function adminStoreOrderSortTime(order = {}) {
  return parseReadModelTimestamp(order.confirmedAt || order.createdAt || order.updatedAt || '') || 0;
}

export function compareAdminStoreOrders(a = {}, b = {}) {
  return adminStoreOrderSortTime(b) - adminStoreOrderSortTime(a) ||
    String(b.orderToken || '').localeCompare(String(a.orderToken || ''));
}

function stableOrderSignature(order = {}) {
  const items = Array.isArray(order.items) ? order.items : [];
  return [
    String(order.orderToken || ''),
    String(order.status || ''),
    adminStoreOrderUpdatedAt(order),
    order.emailSent === true ? '1' : '0',
    items.map((item) => [
      String(item.id || ''),
      String(item.sku || ''),
      Number(item.quantity || 0),
      item.checkIn?.checkedIn === true ? '1' : '0',
      String(item.checkIn?.updatedAt || ''),
      String(item.downloadAccess?.status || ''),
      String(item.downloadAccess?.updatedAt || '')
    ].join(':')).join('|')
  ].join('|');
}

function stableHash16(value) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildAdminStoreOrderSnapshotMetadata(orders = []) {
  const normalizedOrders = Array.isArray(orders) ? orders : [];
  let latestKnownUpdatedAt = '';
  let latestMs = null;
  for (const order of normalizedOrders) {
    const updatedAt = adminStoreOrderUpdatedAt(order);
    const parsed = parseReadModelTimestamp(updatedAt);
    if (parsed !== null && (latestMs === null || parsed > latestMs)) {
      latestMs = parsed;
      latestKnownUpdatedAt = updatedAt;
    }
  }
  const signature = normalizedOrders
    .slice()
    .sort(compareAdminStoreOrders)
    .map(stableOrderSignature)
    .join('\n');
  return {
    latestKnownUpdatedAt,
    watermark: `orders-v2-${stableHash16(signature)}`
  };
}

export function buildAdminStoreOrderIndexSnapshot(data = {}) {
  const orders = (Array.isArray(data.orders) ? data.orders : [])
    .filter((order) => STORE_ORDER_TOKEN_PATTERN.test(String(order?.orderToken || '')))
    .sort(compareAdminStoreOrders);
  const generatedAt = String(data.generatedAt || new Date().toISOString());
  const metadata = buildAdminStoreOrderSnapshotMetadata(orders);
  return {
    version: ADMIN_STORE_ORDER_INDEX_VERSION,
    generatedAt,
    latestKnownUpdatedAt: metadata.latestKnownUpdatedAt,
    watermark: metadata.watermark,
    scanned: Math.max(0, Number(data.scanned || 0) || 0),
    indexed: Math.max(orders.length, Number(data.indexed || orders.length) || orders.length),
    listCalls: Math.max(0, Number(data.listCalls || 0) || 0),
    truncated: data.truncated === true,
    orders
  };
}

export function normalizeAdminStoreOrderIndex(index = {}, options = {}) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) return null;
  if (Number(index.version || 0) !== ADMIN_STORE_ORDER_INDEX_VERSION) return null;
  const generatedAtMs = parseReadModelTimestamp(index.generatedAt || index.createdAt || '');
  if (generatedAtMs === null) return null;
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? Math.max(0, Number(options.maxAgeMs)) : Infinity;
  if (nowMs - generatedAtMs > maxAgeMs) return null;
  const normalized = buildAdminStoreOrderIndexSnapshot(index);
  if (!normalized.orders.length && Number(index.indexed || 0) > 0) return null;
  return {
    ...normalized,
    generatedAt: new Date(generatedAtMs).toISOString(),
    ageMs: Math.max(0, nowMs - generatedAtMs)
  };
}

export function normalizeAdminStoreOrdersSince(value) {
  const parsed = parseReadModelTimestamp(value);
  return parsed === null ? '' : new Date(parsed).toISOString();
}

export function normalizeAdminStoreOrdersWatermark(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return STORE_ORDER_WATERMARK_PATTERN.test(normalized) ? normalized : '';
}

export function adminStoreOrdersSnapshotIsUnchanged(snapshot = {}, requestState = {}) {
  const watermark = normalizeAdminStoreOrdersWatermark(requestState.watermark);
  if (watermark) return watermark === String(snapshot.watermark || '');
  const since = normalizeAdminStoreOrdersSince(requestState.since);
  return Boolean(since && since === String(snapshot.latestKnownUpdatedAt || ''));
}

export function buildStoreInventorySoldCountsFromOrders(orders = []) {
  const soldBySku = {};
  let confirmedOrders = 0;
  for (const order of Array.isArray(orders) ? orders : []) {
    if (String(order?.status || '').trim().toLowerCase() !== 'confirmed') continue;
    confirmedOrders += 1;
    for (const item of Array.isArray(order?.items) ? order.items : []) {
      const sku = String(item?.sku || '').trim();
      const quantity = Math.max(0, Number(item?.quantity || 0) || 0);
      if (!sku || quantity <= 0) continue;
      soldBySku[sku] = (soldBySku[sku] || 0) + quantity;
    }
  }
  return { soldBySku, confirmedOrders };
}

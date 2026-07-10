import { describe, expect, it } from 'vitest';

import {
  ADMIN_STORE_ORDER_INDEX_VERSION,
  adminStoreOrdersSnapshotIsUnchanged,
  buildAdminStoreOrderIndexSnapshot,
  buildAdminStoreOrderSnapshotMetadata,
  buildStoreInventorySoldCountsFromOrders,
  normalizeAdminStoreOrderIndex,
  normalizeAdminStoreOrdersSince,
  normalizeAdminStoreOrdersWatermark
} from '../../worker/src/admin-store-read-model.js';

function order(overrides: Record<string, unknown> = {}) {
  return {
    orderToken: 'store-order-alpha',
    status: 'confirmed',
    createdAt: '2026-07-09T12:00:00.000Z',
    confirmedAt: '2026-07-09T12:01:00.000Z',
    updatedAt: '2026-07-09T12:02:00.000Z',
    emailSent: true,
    customer: { email: 'buyer@example.com', name: 'Private Buyer' },
    items: [{ id: 'line-1', sku: 'poster', quantity: 2 }],
    ...overrides
  };
}

describe('admin Store order read model', () => {
  it('builds deterministic non-PII watermarks that change with fulfillment state', () => {
    const first = buildAdminStoreOrderSnapshotMetadata([order()]);
    const reordered = buildAdminStoreOrderSnapshotMetadata([order()]);
    const changed = buildAdminStoreOrderSnapshotMetadata([
      order({ items: [{ id: 'line-1', sku: 'poster', quantity: 2, checkIn: { checkedIn: true } }] })
    ]);

    expect(first).toEqual(reordered);
    expect(first.latestKnownUpdatedAt).toBe('2026-07-09T12:02:00.000Z');
    expect(first.watermark).toMatch(/^orders-v2-[a-f0-9]{16}$/);
    expect(first.watermark).not.toContain('buyer');
    expect(first.watermark).not.toContain('Private');
    expect(changed.watermark).not.toBe(first.watermark);
  });

  it('normalizes and freshness-checks versioned index snapshots', () => {
    const snapshot = buildAdminStoreOrderIndexSnapshot({
      orders: [order(), order({ orderToken: 'invalid token' })],
      scanned: 2,
      indexed: 2,
      listCalls: 1,
      generatedAt: '2026-07-09T12:05:00.000Z'
    });

    expect(snapshot.version).toBe(ADMIN_STORE_ORDER_INDEX_VERSION);
    expect(snapshot.orders).toHaveLength(1);
    expect(snapshot.indexed).toBe(2);
    expect(normalizeAdminStoreOrderIndex(snapshot, {
      nowMs: Date.parse('2026-07-09T12:06:00.000Z'),
      maxAgeMs: 120_000
    })).toMatchObject({ ageMs: 60_000, watermark: snapshot.watermark });
    expect(normalizeAdminStoreOrderIndex(snapshot, {
      nowMs: Date.parse('2026-07-09T12:08:00.000Z'),
      maxAgeMs: 120_000
    })).toBeNull();
    expect(normalizeAdminStoreOrderIndex({ ...snapshot, version: 1 })).toBeNull();
  });

  it('validates no-change request state without accepting arbitrary cache keys', () => {
    const snapshot = buildAdminStoreOrderIndexSnapshot({ orders: [order()] });
    expect(normalizeAdminStoreOrdersSince('2026-07-09T12:02:00Z')).toBe('2026-07-09T12:02:00.000Z');
    expect(normalizeAdminStoreOrdersSince('not-a-date')).toBe('');
    expect(normalizeAdminStoreOrdersWatermark(snapshot.watermark.toUpperCase())).toBe(snapshot.watermark);
    expect(normalizeAdminStoreOrdersWatermark('buyer@example.com')).toBe('');
    expect(adminStoreOrdersSnapshotIsUnchanged(snapshot, { watermark: snapshot.watermark })).toBe(true);
    expect(adminStoreOrdersSnapshotIsUnchanged(snapshot, { since: snapshot.latestKnownUpdatedAt })).toBe(true);
    expect(adminStoreOrdersSnapshotIsUnchanged(snapshot, { watermark: 'orders-v2-0000000000000000' })).toBe(false);
  });

  it('derives inventory sold counts only from confirmed normalized orders', () => {
    const counts = buildStoreInventorySoldCountsFromOrders([
      order(),
      order({ orderToken: 'store-order-beta', items: [{ sku: 'poster', quantity: 3 }, { sku: 'shirt', quantity: 1 }] }),
      order({ orderToken: 'store-order-draft', status: 'draft', items: [{ sku: 'poster', quantity: 100 }] })
    ]);

    expect(counts).toEqual({
      soldBySku: { poster: 5, shirt: 1 },
      confirmedOrders: 2
    });
  });
});

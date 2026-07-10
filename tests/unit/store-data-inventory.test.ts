import { describe, expect, it } from 'vitest';

import {
  auditStoreDataInventory,
  discoverWorkerStoragePrefixes
} from '../../scripts/audit-store-data-inventory.mjs';
import { loadStoreDataInventory } from '../../scripts/lib/store-data-inventory.mjs';

describe('Store data inventory coverage', () => {
  it('covers every discoverable Worker KV storage family', () => {
    const result = auditStoreDataInventory();
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.discovered).toEqual(expect.arrayContaining([
      'orders:',
      'stripe-event:',
      'store-order-admin-email-sent:',
      'admin-store-marketing-draft:builder',
      'store-event-address-lookup:'
    ]));
  });

  it('reports new source families until they are classified', () => {
    const inventory = loadStoreDataInventory();
    const discovered = [...discoverWorkerStoragePrefixes(), 'store-new-family:'];
    expect(auditStoreDataInventory({ inventory, discovered })).toMatchObject({
      ok: false,
      missing: ['store-new-family:']
    });
  });
});

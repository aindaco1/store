import { describe, expect, it } from 'vitest';

import {
  aggregateStoreInventoryAvailability,
  buildPublicStoreInventoryProjection,
  buildStoreInventoryAvailability
} from '../../worker/src/store-inventory-projection.js';

describe('Store inventory availability projection', () => {
  it('publishes only confirmed availability from the derived projection', () => {
    expect(buildPublicStoreInventoryProjection({
      'mug-1': {
        limit: 5,
        claimed: 1,
        productId: 'mug-1',
        name: 'DUST WAVE Mug'
      },
      'sold-out': { limit: 1, claimed: 4 },
      'private-sku': { limit: 3, claimed: 0 },
      malformed: { limit: 'unknown', claimed: 0 }
    }, new Set(['mug-1', 'sold-out', 'malformed']))).toEqual({
      ok: true,
      status: 'ready',
      inventory: {
        'mug-1': { available: 4 },
        'sold-out': { available: 0 }
      }
    });

    expect(buildPublicStoreInventoryProjection(null)).toEqual({
      ok: false,
      status: 'unavailable',
      inventory: {}
    });
  });

  it('uses committed claims and active reservations from the coordinator', () => {
    expect(buildStoreInventoryAvailability({
      sku: 'mug-1',
      baseline: 5,
      coordinator: {
        ok: true,
        inventory: { 'mug-1': { limit: 5, claimed: 1 } },
        reservedCounts: { 'mug-1': 2 }
      }
    })).toEqual({
      availabilityStatus: 'ready',
      coordinatorLimit: 5,
      claimed: 1,
      reserved: 2,
      available: 2,
      remaining: 2,
      baselineInSync: true
    });
  });

  it('fails closed when a finite SKU is absent from an available coordinator snapshot', () => {
    expect(buildStoreInventoryAvailability({
      sku: 'mug-1',
      baseline: 5,
      coordinator: { ok: true, inventory: {}, reservedCounts: {} }
    })).toMatchObject({
      availabilityStatus: 'unavailable',
      available: null,
      baselineInSync: null
    });
  });

  it('surfaces baseline drift without replacing coordinator truth', () => {
    expect(buildStoreInventoryAvailability({
      sku: 'mug-1',
      baseline: 5,
      coordinator: {
        ok: true,
        inventory: { 'mug-1': { limit: 7, claimed: 1 } },
        reservedCounts: {}
      }
    })).toMatchObject({
      availabilityStatus: 'drift',
      coordinatorLimit: 7,
      claimed: 1,
      reserved: 0,
      available: 6,
      baselineInSync: false
    });
  });

  it('preserves unlimited inventory and aggregates finite variants', () => {
    expect(buildStoreInventoryAvailability({ baseline: null })).toMatchObject({
      availabilityStatus: 'unlimited',
      available: null
    });

    expect(aggregateStoreInventoryAvailability([{
      availabilityStatus: 'ready',
      coordinatorLimit: 3,
      claimed: 1,
      reserved: 0,
      available: 2,
      baselineInSync: true
    }, {
      availabilityStatus: 'ready',
      coordinatorLimit: 4,
      claimed: 1,
      reserved: 1,
      available: 2,
      baselineInSync: true
    }])).toEqual({
      availabilityStatus: 'ready',
      coordinatorLimit: 7,
      claimed: 2,
      reserved: 1,
      available: 4,
      remaining: 4,
      baselineInSync: true
    });
  });
});

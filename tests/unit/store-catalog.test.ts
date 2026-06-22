import { describe, expect, it } from 'vitest';
import STORE_CATALOG_SNAPSHOT from '../../worker/src/generated/catalog-snapshot.js';
import {
  findStoreProduct,
  validateStoreOrderDraft
} from '../../worker/src/catalog.js';

describe('Store catalog snapshot and validation', () => {
  it('generates a canonical Worker snapshot from repo products', () => {
    expect(STORE_CATALOG_SNAPSHOT.version).toBe(1);
    expect(STORE_CATALOG_SNAPSHOT.source).toBe('_products');
    expect(STORE_CATALOG_SNAPSHOT.source_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(STORE_CATALOG_SNAPSHOT.products.length).toBeGreaterThanOrEqual(27);

    const fronterasShirt = findStoreProduct('t-shirt-2', STORE_CATALOG_SNAPSHOT);
    expect(fronterasShirt).toMatchObject({
      id: 't-shirt-2',
      name: 'Fronteras T-Shirt',
      collection: 'fronteras',
      category: 'apparel',
      localized_paths: {
        en: '/products/fronteras-t-shirt/',
        es: '/es/products/fronteras-t-shirt/'
      },
      shipping_preset: 'tshirt',
      tax_category: 'standard'
    });
    expect(fronterasShirt?.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'm',
          sku: 't-shirt-2-m',
          price_cents: 3000
        })
      ])
    );
  });

  it('validates Store cart items against product IDs, variants, SKUs, and catalog prices', () => {
    const result = validateStoreOrderDraft({
      items: [
        {
          id: 't-shirt-2__m',
          name: 'Fronteras T-Shirt',
          price: 30,
          quantity: 2,
          customFields: [
            { name: '_product_type', value: 'physical' },
            { name: '_sku', value: 't-shirt-2' },
            { name: '_variant', value: 'M' }
          ]
        }
      ]
    });

    expect(result.valid).toBe(true);
    expect(result.items).toEqual([
      expect.objectContaining({
        productId: 't-shirt-2',
        variantId: 'm',
        sku: 't-shirt-2-m',
        quantity: 2,
        unitPriceCents: 3000,
        subtotalCents: 6000,
        fulfillmentType: 'physical',
        event: 'fronteras',
        collection: 'fronteras',
        category: 'apparel',
        shippable: true,
        shippingPreset: 'tshirt',
        taxCategory: 'standard'
      })
    ]);
    expect(result.totals).toMatchObject({
      itemCount: 2,
      subtotalCents: 6000,
      requiresPayment: true,
      requiresShipping: true,
      requiresTurnstile: false
    });
    expect(result.warnings.map((warning) => warning.code)).toContain('inventory_unset_or_empty');
  });

  it('rejects submitted prices that do not match the catalog', () => {
    const result = validateStoreOrderDraft({
      items: [
        {
          id: 'ticket-1__supporter',
          price: 12,
          quantity: 1
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'price_mismatch',
          productId: 'ticket-1',
          variantId: 'supporter',
          submittedPriceCents: 1200,
          expectedPriceCents: 2000
        })
      ])
    );
  });

  it('requires variants for products that define variant options', () => {
    const result = validateStoreOrderDraft({
      items: [
        {
          id: 't-shirt-2',
          price: 30,
          quantity: 1
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'variant_required',
          productId: 't-shirt-2'
        })
      ])
    );
  });

  it('keeps free RSVP items on the same canonical validation path without shipping or payment', () => {
    const result = validateStoreOrderDraft({
      items: [
        {
          id: 'rsvp-1',
          price: 0,
          quantity: 1
        }
      ]
    });

    expect(result.valid).toBe(true);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        productId: 'rsvp-1',
        sku: 'rsvp-1',
        unitPriceCents: 0,
        subtotalCents: 0,
        fulfillmentType: 'rsvp',
        shippable: false,
        shipping: null,
        taxCategory: 'admission',
        turnstileRequired: true,
        eventDetails: expect.objectContaining({
          ics: true,
          ticket_delivery: 'qr'
        })
      })
    );
    expect(result.totals).toMatchObject({
      itemCount: 1,
      subtotalCents: 0,
      requiresPayment: false,
      requiresShipping: false,
      requiresTurnstile: true
    });
  });

  it('can fail closed on unavailable products and inventory when those checks are enabled', () => {
    const snapshot = {
      version: 1,
      source: 'test',
      products: [
        {
          id: 'limited-zine',
          sku: 'limited-zine',
          name: 'Limited Zine',
          price_cents: 500,
          currency: 'USD',
          fulfillment_type: 'digital',
          status: 'draft',
          inventory_tracking: true,
          inventory: 1,
          tax_category: 'standard',
          variants: []
        },
        {
          id: 'limited-poster',
          sku: 'limited-poster',
          name: 'Limited Poster',
          price_cents: 2500,
          currency: 'USD',
          fulfillment_type: 'physical',
          status: 'active',
          inventory_tracking: true,
          inventory: 1,
          shipping_preset: 'poster',
          tax_category: 'standard',
          variants: []
        }
      ],
      defaults: { currency: 'USD', tax_category: 'standard' }
    };

    const unavailable = validateStoreOrderDraft({
      items: [{ id: 'limited-zine', price: 5, quantity: 1 }]
    }, { snapshot });
    expect(unavailable.valid).toBe(false);
    expect(unavailable.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'product_unavailable', productId: 'limited-zine' })
      ])
    );

    const oversold = validateStoreOrderDraft({
      items: [{ id: 'limited-poster', price: 25, quantity: 2 }]
    }, { snapshot, enforceInventory: true });
    expect(oversold.valid).toBe(false);
    expect(oversold.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'insufficient_inventory',
          productId: 'limited-poster',
          requestedQuantity: 2,
          availableQuantity: 1
        })
      ])
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ADD_ON_CONFIG = {
  enabled: true,
  product_count: 2,
  low_stock_threshold: 5,
  products: [
    {
      id: 'dust-wave-sticker',
      sku: 'dust-wave-sticker',
      name: 'DUST WAVE Sticker',
      description: '3" x 3" matte laminated circle-cut vinyl sticker.',
      image_url: 'https://shop.dustwave.xyz/assets/images/sticker-glove.png',
      price: 3,
      category: 'physical',
      type: 'sticker',
      fulfillment_type: 'physical',
      shipping_preset: 'sticker',
      inventory: 50,
      variants: []
    },
    {
      id: 'dust-wave-tshirt',
      sku: 'dust-wave-tshirt',
      name: 'DUST WAVE T-Shirt',
      description: 'Our official t-shirt. 100% cotton.',
      image_url: 'https://shop.dustwave.xyz/assets/images/dustwave-tshirt.png',
      price: 25,
      category: 'physical',
      type: 'shirt',
      fulfillment_type: 'physical',
      shipping_preset: 'tshirt',
      variant_option_name: 'Size',
      variants: [
        { id: 'm', label: 'M', price: '', inventory: 4 },
        { id: 'l', label: 'L', price: 0, inventory: 4 }
      ]
    },
    {
      id: 'tour-shirt',
      sku: 'tour-shirt',
      name: 'Tour Shirt',
      description: 'A second shirt.',
      image_url: '',
      price: 20,
      category: 'physical',
      type: 'shirt',
      fulfillment_type: 'physical',
      shipping_preset: 'tshirt',
      inventory: 7,
      variants: []
    },
    {
      id: 'staff-shirt',
      sku: 'staff-shirt',
      name: 'Staff Shirt',
      description: 'A third shirt.',
      image_url: '',
      price: 22,
      category: 'physical',
      type: 'shirt',
      fulfillment_type: 'physical',
      shipping_preset: 'tshirt',
      inventory: 5,
      variants: []
    },
    {
      id: 'digital-zine',
      name: 'Digital Zine',
      description: 'A PDF companion download.',
      image_url: '',
      price: 5,
      category: 'digital',
      type: 'digital',
      fulfillment_type: 'digital',
      variants: []
    },
    {
      id: 'custom-pin',
      name: 'Custom Pin',
      description: 'A physical pin with explicit measurements.',
      image_url: '',
      price: 12,
      category: 'physical',
      type: 'pin',
      fulfillment_type: 'physical',
      shipping: {
        weight_oz: 2,
        packaging_weight_oz: 0.5,
        length_in: 2,
        width_in: 2,
        height_in: 0.5,
        stack_height_in: 0.2
      },
      inventory: 10,
      variants: []
    }
  ]
};

describe('add-on utils', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    delete (window as Window & { StoreAddOnUtils?: unknown }).StoreAddOnUtils;
    (window as any).STORE_CONFIG = {
      shipping: {
        presets: {
          sticker: {
            weight_oz: 1,
            packaging_weight_oz: 0.5,
            length_in: 4,
            width_in: 4,
            height_in: 0.1,
            stack_height_in: 0.05
          },
          tshirt: {
            weight_oz: 8,
            packaging_weight_oz: 1,
            length_in: 12,
            width_in: 10,
            height_in: 1.5,
            stack_height_in: 0.5
          }
        }
      }
    };
  });

  it('hides sold-out variants and marks low stock from the shared inventory snapshot', async () => {
    await import('../../assets/js/add-on-utils.js');

    const addOnUtils = (window as Window & { StoreAddOnUtils?: any }).StoreAddOnUtils;
    expect(addOnUtils).toBeTruthy();

    const entries = addOnUtils.buildProductStateEntries(ADD_ON_CONFIG, [], {
      lowStockThreshold: 5,
      products: {
        'dust-wave-tshirt': {
          inventory: 8,
          sold: 4,
          remaining: 4,
          available: true,
          soldOut: false,
          variants: {
            m: { inventory: 4, sold: 0, remaining: 4, available: true, soldOut: false },
            l: { inventory: 4, sold: 4, remaining: 0, available: false, soldOut: true }
          }
        },
        'dust-wave-sticker': {
          inventory: 50,
          sold: 50,
          remaining: 0,
          available: false,
          soldOut: true
        }
      }
    });

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: 'dust-wave-tshirt',
          lowStock: false,
          variants: [
            expect.objectContaining({
              id: 'm',
              remaining: 4,
              lowStock: true
            })
          ]
        })
      ])
    );

    const tshirt = entries.find((entry: { productId: string }) => entry.productId === 'dust-wave-tshirt');
    expect(tshirt?.variants.map((variant: { id: string }) => variant.id)).toEqual(['m']);
    expect(entries.find((entry: { productId: string }) => entry.productId === 'dust-wave-sticker')).toBeUndefined();
  });

  it('keeps saved remaining inventory separate from editable max for selected variants', async () => {
    await import('../../assets/js/add-on-utils.js');

    const addOnUtils = (window as Window & { StoreAddOnUtils?: any }).StoreAddOnUtils;
    expect(addOnUtils).toBeTruthy();

    const entries = addOnUtils.buildProductStateEntries(ADD_ON_CONFIG, [
      { productId: 'dust-wave-tshirt', variantId: 'm', quantity: 2 }
    ], {
      lowStockThreshold: 5,
      products: {
        'dust-wave-tshirt': {
          variants: {
            m: { inventory: 4, sold: 2, remaining: 2, available: true, soldOut: false }
          }
        }
      }
    });

    const tshirt = entries.find((entry: { productId: string }) => entry.productId === 'dust-wave-tshirt');
    const medium = tshirt?.variants.find((variant: { id: string }) => variant.id === 'm');
    expect(medium?.remaining).toBe(2);
    expect(medium?.maxQuantity).toBe(2);
    expect(medium?.editableMaxQuantity).toBe(4);
  });

  it('inherits blank variant prices and preserves explicit zero-price overrides', async () => {
    await import('../../assets/js/add-on-utils.js');

    const addOnUtils = (window as Window & { StoreAddOnUtils?: any }).StoreAddOnUtils;
    const product = ADD_ON_CONFIG.products.find((entry) => entry.id === 'dust-wave-tshirt');

    expect(addOnUtils.resolveUnitPrice(product, product?.variants?.[0])).toBe(25);
    expect(addOnUtils.resolveUnitPrice(product, product?.variants?.[1])).toBe(0);
    expect(addOnUtils.normalizeSelection({
      productId: 'dust-wave-tshirt',
      variantId: 'm',
      quantity: 1
    }, ADD_ON_CONFIG).unitPrice).toBe(2500);
    expect(addOnUtils.normalizeSelection({
      productId: 'dust-wave-tshirt',
      variantId: 'l',
      quantity: 1
    }, ADD_ON_CONFIG).unitPrice).toBe(0);
  });

  it('resolves physical add-on shipping from presets or explicit metadata and leaves digital add-ons unshippable', async () => {
    await import('../../assets/js/add-on-utils.js');

    const addOnUtils = (window as Window & { StoreAddOnUtils?: any }).StoreAddOnUtils;
    expect(addOnUtils).toBeTruthy();

    const tshirt = addOnUtils.normalizeSelection({
      productId: 'dust-wave-tshirt',
      variantId: 'm',
      quantity: 1
    }, ADD_ON_CONFIG);
    const pin = addOnUtils.normalizeSelection({
      productId: 'custom-pin',
      quantity: 1
    }, ADD_ON_CONFIG);
    const zine = addOnUtils.normalizeSelection({
      productId: 'digital-zine',
      quantity: 1
    }, ADD_ON_CONFIG);

    expect(tshirt.shipping_preset).toBe('tshirt');
    expect(tshirt.shipping).toEqual({
      weight_oz: 8,
      packaging_weight_oz: 1,
      length_in: 12,
      width_in: 10,
      height_in: 1.5,
      stack_height_in: 0.5
    });

    expect(pin.shipping).toEqual({
      weight_oz: 2,
      packaging_weight_oz: 0.5,
      length_in: 2,
      width_in: 2,
      height_in: 0.5,
      stack_height_in: 0.2
    });

    expect(zine.category).toBe('digital');
    expect(zine.shipping).toBeNull();
  });

  it('suggests same-type catalog products up to the configured count', async () => {
    await import('../../assets/js/add-on-utils.js');

    const addOnUtils = (window as Window & { StoreAddOnUtils?: any }).StoreAddOnUtils;
    expect(addOnUtils).toBeTruthy();

    const suggestions = addOnUtils.getSuggestedProductStateEntries(
      ADD_ON_CONFIG,
      [{ id: 'dust-wave-tshirt', sku: 'dust-wave-tshirt', quantity: 1 }],
      [],
      { products: {} }
    );

    expect(suggestions.map((entry: { productId: string }) => entry.productId)).toEqual(['tour-shirt', 'staff-shirt']);
    expect(suggestions.every((entry: { type: string }) => entry.type === 'shirt')).toBe(true);
  });

  it('normalizes variant-suffixed Store cart item IDs before matching add-on suggestions', async () => {
    await import('../../assets/js/add-on-utils.js');

    const addOnUtils = (window as Window & { StoreAddOnUtils?: any }).StoreAddOnUtils;
    expect(addOnUtils).toBeTruthy();

    const suggestions = addOnUtils.getSuggestedProductStateEntries(
      ADD_ON_CONFIG,
      [{
        id: 'dust-wave-tshirt__m',
        quantity: 1,
        customFields: [
          { name: '_sku', value: 'dust-wave-tshirt' },
          { name: '_variant', value: 'M' }
        ]
      }],
      [],
      { products: {} }
    );

    expect(suggestions.map((entry: { productId: string }) => entry.productId)).toEqual(['tour-shirt', 'staff-shirt']);
  });

  it('clears Store add-on inventory cache and emits Store-first invalidation events', async () => {
    await import('../../assets/js/add-on-utils.js');

    const addOnUtils = (window as Window & { StoreAddOnUtils?: any }).StoreAddOnUtils;
    const events: string[] = [];
    document.addEventListener('store:add-on-inventory-invalidated', () => events.push('store'));

    localStorage.setItem('store_add_on_inventory', '{"ok":true}');

    addOnUtils.invalidateCachedInventory();

    expect(localStorage.getItem('store_add_on_inventory')).toBeNull();
    expect(events).toEqual(['store']);
  });
});

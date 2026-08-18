import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('first-party pending cart handoff', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    localStorage.clear();

    document.body.innerHTML = `
      <div data-store-cart-root="true"></div>
      <span class="storecart-total-price"></span>
    `;

    (window as any).STORE_CONFIG = {
      cartRuntime: 'first_party',
      platformName: 'Simply Store'
    };

    localStorage.setItem('pendingCartItem', JSON.stringify({
      id: 'fronteras-poster-big',
      name: 'Fronteras Poster (Big)',
      price: 25,
      url: '/products/fronteras-poster-big/',
      description: '18 x 24 poster',
      stackable: false,
      shippable: false,
      maxQuantity: 1,
      customFields: [
        {
          name: '_category',
          type: 'hidden',
          value: 'physical',
          placeholder: '',
          required: false
        }
      ]
    }));

    (globalThis as any).requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    delete (window as any).STORE_CONFIG;
    delete (window as any).StoreConfig;
    delete (window as any).StoreCartProvider;
    delete (window as any).Store;
    delete (window as any).__StoreCartRuntimeCartUiLoaded;
    delete (globalThis as any).requestAnimationFrame;
    document.body.innerHTML = '';
  });

  it('consumes pendingCartItem through cart.js when first-party runtime boots', async () => {
    await import('../../assets/js/cart-provider.js');

    const provider = (window as any).StoreCartProvider;
    const readyApi = await provider.whenReady();
    const onOpened = vi.fn();
    provider.events.on('cart.opened', onOpened);

    await import('../../assets/js/cart.js');
    await vi.runAllTimersAsync();

    expect(localStorage.getItem('pendingCartItem')).toBeNull();
    expect(provider.store.getState()).toMatchObject({
      cart: {
        subtotal: 25,
        items: {
          count: 1,
          items: [
            expect.objectContaining({
              id: 'fronteras-poster-big',
              name: 'Fronteras Poster (Big)'
            })
          ]
        }
      }
    });
    await readyApi.api.theme.cart.open();
    const root = document.querySelector('[data-store-cart-root]') as HTMLElement | null;
    expect(root?.textContent).toContain('Estimated total');
    expect(root?.textContent).toContain('Estimated shipping');
    expect(root?.textContent).toContain('--');
    expect(onOpened).toHaveBeenCalled();
  });

  it('migrates stale inactive zero tips to the configured default and preserves explicit opt-out', async () => {
    localStorage.removeItem('pendingCartItem');
    localStorage.setItem('store_first_party_cart_state', JSON.stringify({
      token: 'storecart_tip_migration',
      tipPercent: 0,
      items: [
        {
          id: 'tip-migration-item',
          uniqueId: 'tip-migration-item',
          name: 'Tip migration item',
          price: 10,
          quantity: 1,
          shippable: false,
          customFields: []
        }
      ]
    }));

    await import('../../assets/js/cart-provider.js');

    const provider = (window as any).StoreCartProvider;
    const readyApi = await provider.whenReady();
    expect(provider.store.getState().cart.tipPercent).toBe(5);
    expect(provider.store.getState().cart.tipTouched).toBe(false);

    await readyApi.api.cart.update({ tipPercent: 0 });

    const persisted = JSON.parse(localStorage.getItem('store_first_party_cart_state') || '{}');
    expect(provider.store.getState().cart.tipPercent).toBe(0);
    expect(provider.store.getState().cart.tipTouched).toBe(true);
    expect(persisted.tipPercent).toBe(0);
    expect(persisted.tipTouched).toBe(true);
  });

  it('preserves physical-item metadata when cart.js handles redirect add buttons', async () => {
    document.body.innerHTML = `
      <div data-store-cart-root="true"></div>
      <span class="storecart-total-price"></span>
      <button
        class="store-add-item"
        data-item-id="fronteras-t-shirt"
        data-item-name="Fronteras T-Shirt"
        data-item-price="35"
        data-item-url="/products/fronteras-t-shirt/"
        data-item-description="Physical item"
        data-item-stackable="never"
        data-item-shippable="true"
        data-item-max-quantity="1"
        data-item-custom1-name="_category"
        data-item-custom1-type="hidden"
        data-item-custom1-value="physical"
        data-redirect-url="#product-fronteras-t-shirt"
        type="button"
      >
        View and add
      </button>
    `;
    localStorage.removeItem('pendingCartItem');

    await import('../../assets/js/cart-provider.js');
    await import('../../assets/js/cart.js');

    const button = document.querySelector('.store-add-item') as HTMLButtonElement | null;
    if (!button) throw new Error('Missing redirect add item button');
    button.click();

    const pendingItem = JSON.parse(localStorage.getItem('pendingCartItem') || '{}');
    expect(pendingItem).toMatchObject({
      id: 'fronteras-t-shirt',
      name: 'Fronteras T-Shirt',
      shippable: true,
      maxQuantity: 1,
      customFields: [
        expect.objectContaining({
          name: '_category',
          value: 'physical'
        })
      ]
    });
    expect(window.location.hash).toBe('#product-fronteras-t-shirt');
  });

  it('renders live shipping option amounts and quotes New Mexico tax from ZIP-only estimates', async () => {
    localStorage.removeItem('pendingCartItem');

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/shipping/quote')) {
        return new Response(JSON.stringify({
          totalShippingCents: 955,
          quotes: [
            {
              source: 'usps_live',
              shippingCents: 955,
              selectedOption: 'standard',
              defaultOption: 'standard',
              shipment: {
                hasPhysical: true
              },
              availableOptions: [
                {
                  id: 'standard',
                  label: 'Standard',
                  shippingCents: 955,
                  priceDeltaCents: 0
                },
                {
                  id: 'signature_required',
                  label: 'Signature required',
                  shippingCents: 1350,
                  priceDeltaCents: 395
                }
              ]
            }
          ]
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }

      if (url.endsWith('/tax/quote')) {
        const body = JSON.parse(String(init?.body || '{}'));
        expect(body).toMatchObject({
          subtotalCents: 2500,
          shippingCents: 955,
          shippingAddress: {
            country: 'US',
            postalCode: '87120'
          }
        });

        return new Response(JSON.stringify({
          taxCents: 191,
          taxDetails: {
            effectiveRate: 0.07625,
            destination: {
              country: 'US',
              state: 'NM',
              postalCode: '87120'
            }
          }
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }

      return new Response(JSON.stringify({ products: {} }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    });

    vi.stubGlobal('fetch', fetchMock);
    (window as any).STORE_CONFIG = {
      cartRuntime: 'first_party',
      checkoutProvider: 'first_party',
      checkoutUiMode: 'custom',
      workerBase: 'https://worker.test',
      platformName: 'Dust Wave Shop',
      platformCompanyName: 'Dust Wave',
      addOns: {
        enabled: false,
        products: []
      }
    };

    await import('../../assets/js/cart-provider.js');

    const provider = (window as any).StoreCartProvider;
    const readyApi = await provider.whenReady();
    await readyApi.api.cart.items.add({
      id: 'dust-wave-t-shirt__small',
      name: 'DUST WAVE T-Shirt',
      price: 25,
      quantity: 1,
      url: '/products/dust-wave-t-shirt/',
      description: 'Physical item',
      stackable: false,
      shippable: true,
      maxQuantity: 5,
      customFields: [
        {
          name: '_category',
          type: 'hidden',
          value: 'physical',
          required: false
        },
        {
          name: '_product_type',
          type: 'hidden',
          value: 'merch',
          required: false
        },
        {
          name: '_sku',
          type: 'hidden',
          value: 'dw-shirt-small',
          required: false
        }
      ]
    });
    await readyApi.api.cart.update({
      billingAddress: { country: 'US', postal_code: '10001', state: 'NY' }
    });
    await readyApi.api.theme.cart.open();
    await readyApi.api.theme.cart.navigate('/cart');

    const root = document.querySelector('[data-store-cart-root]') as HTMLElement | null;
    const postalField = root?.querySelector('[data-cart-estimate-postal]') as HTMLInputElement | null;
    expect(postalField).toBeTruthy();
    postalField!.value = '87120';
    postalField!.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://worker.test/tax/quote',
      expect.objectContaining({ method: 'POST' })
    );
    const tipBoxText = root?.querySelector('.store-first-party-cart__tip-box')?.textContent || '';
    expect(tipBoxText).toContain('Tip Dust Wave for platform maintenance.');
    expect(tipBoxText).toContain('Optional tips help keep Dust Wave doing its thing.');
    expect(root?.querySelector('[data-cart-summary-tip-label]')?.textContent).toBe('Dust Wave tip (5%)');
    expect(root?.querySelector('[data-cart-summary-tip-amount]')?.textContent).toBe('$1.25');
    expect(root?.querySelector('[data-cart-custom-shipping-option]')).toBeTruthy();
    expect(root?.querySelector('[data-cart-summary-shipping]')?.textContent).toBe('$9.55');
    expect(root?.querySelector('[data-cart-summary-tax]')?.textContent).toBe('$1.91');
    expect(root?.querySelector('[data-cart-summary-total]')?.textContent).toBe('$37.71');
  });

  it('does not present fallback shipping as a final quoted shipping charge', async () => {
    localStorage.removeItem('pendingCartItem');

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/shipping/quote')) {
        return new Response(JSON.stringify({
          totalShippingCents: 300,
          quotes: [
            {
              source: 'fallback_missing_metadata',
              shippingCents: 300,
              selectedOption: 'standard',
              defaultOption: 'standard',
              shipment: {
                hasPhysical: true
              },
              availableOptions: [
                {
                  id: 'standard',
                  label: 'Standard',
                  shippingCents: 300,
                  priceDeltaCents: 0
                }
              ]
            }
          ]
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }

      if (url.endsWith('/tax/quote')) {
        const body = JSON.parse(String(init?.body || '{}'));
        expect(body).toMatchObject({
          subtotalCents: 5000,
          shippingCents: 0,
          shippingAddress: {
            country: 'US',
            postalCode: '87120'
          }
        });

        return new Response(JSON.stringify({
          taxCents: 381,
          taxDetails: {
            effectiveRate: 0.07625,
            destination: {
              country: 'US',
              state: 'NM',
              postalCode: '87120'
            }
          }
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }

      return new Response(JSON.stringify({ products: {} }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    });

    vi.stubGlobal('fetch', fetchMock);
    (window as any).STORE_CONFIG = {
      cartRuntime: 'first_party',
      checkoutProvider: 'first_party',
      checkoutUiMode: 'custom',
      workerBase: 'https://worker.test',
      platformName: 'Dust Wave Shop',
      addOns: {
        enabled: false,
        products: []
      }
    };

    await import('../../assets/js/cart-provider.js');

    const provider = (window as any).StoreCartProvider;
    const readyApi = await provider.whenReady();
    await readyApi.api.cart.items.add({
      id: 'dust-wave-t-shirt__small',
      name: 'DUST WAVE T-Shirt',
      price: 25,
      quantity: 2,
      url: '/products/dust-wave-t-shirt/',
      description: 'Physical item',
      stackable: true,
      shippable: true,
      customFields: [
        {
          name: '_category',
          type: 'hidden',
          value: 'physical',
          required: false
        },
        {
          name: '_product_type',
          type: 'hidden',
          value: 'merch',
          required: false
        },
        {
          name: '_sku',
          type: 'hidden',
          value: 'dw-shirt-small',
          required: false
        }
      ]
    });
    await readyApi.api.theme.cart.open();

    const root = document.querySelector('[data-store-cart-root]') as HTMLElement | null;
    const postalField = root?.querySelector('[data-cart-estimate-postal]') as HTMLInputElement | null;
    expect(postalField).toBeTruthy();
    postalField!.value = '87120';
    postalField!.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(root?.querySelector('[data-cart-custom-shipping-option]')).toBeNull();
    expect(root?.querySelector('[data-cart-summary-shipping-label]')?.textContent).toBe('Estimated shipping');
    expect(root?.querySelector('[data-cart-summary-shipping]')?.textContent).toBe('--');
    expect(root?.querySelector('[data-cart-summary-tip-amount]')?.textContent).toBe('$2.50');
    expect(root?.querySelector('[data-cart-summary-tax]')?.textContent).toBe('$3.81');
    expect(root?.querySelector('[data-cart-summary-total-label]')?.textContent).toBe('Estimated total');
    expect(root?.querySelector('[data-cart-summary-total]')?.textContent).toBe('$56.31');
  });

  it('repairs stale Store cart items from the catalog before shipping quotes', async () => {
    localStorage.removeItem('pendingCartItem');
    localStorage.setItem('store_first_party_cart_state', JSON.stringify({
      token: 'storecart_stale',
      items: [
        {
          id: 't-shirt-1',
          uniqueId: 'stale-t-shirt-1',
          name: 'DUST WAVE T-Shirt',
          price: 25,
          quantity: 1,
          url: '/products/dust-wave-t-shirt/',
          description: 'Old cart item',
          stackable: true,
          shippable: true,
          customFields: [
            { name: '_product_type', type: 'hidden', value: 'physical' },
            { name: '_sku', type: 'hidden', value: 't-shirt-1' }
          ]
        }
      ]
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/shipping/quote')) {
        const body = JSON.parse(String(init?.body || '{}'));
        expect(body.items).toEqual([
          expect.objectContaining({
            id: 't-shirt-1__s',
            productId: 't-shirt-1',
            sku: 't-shirt-1',
            variantId: 's',
            price: 25
          })
        ]);

        return new Response(JSON.stringify({
          totalShippingCents: 955,
          quotes: [
            {
              source: 'usps_live',
              shippingCents: 955,
              selectedOption: 'standard',
              defaultOption: 'standard',
              shipment: { hasPhysical: true },
              availableOptions: [
                {
                  id: 'standard',
                  label: 'Standard',
                  shippingCents: 955,
                  priceDeltaCents: 0
                }
              ]
            }
          ]
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.endsWith('/tax/quote')) {
        return new Response(JSON.stringify({
          taxCents: 191,
          taxDetails: {
            effectiveRate: 0.07625,
            destination: {
              country: 'US',
              state: 'NM',
              postalCode: '87120'
            }
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ products: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    vi.stubGlobal('fetch', fetchMock);
    (window as any).STORE_CONFIG = {
      cartRuntime: 'first_party',
      checkoutProvider: 'first_party',
      checkoutUiMode: 'custom',
      workerBase: 'https://worker.test',
      platformName: 'Dust Wave Shop',
      addOns: {
        enabled: true,
        products: [
          {
            id: 't-shirt-1',
            sku: 't-shirt-1',
            name: 'DUST WAVE T-Shirt',
            price: 25,
            category: 'physical',
            fulfillment_type: 'physical',
            type: 'shirt',
            inventory_tracking: true,
            shipping: {
              weight_oz: 6.5,
              packaging_weight_oz: 1,
              length_in: 12,
              width_in: 10,
              height_in: 1.5,
              stack_height_in: 0.5
            },
            variants: [
              { id: 'xs', label: 'XS', sku: 't-shirt-1-xs', price: 25, inventory: 0 },
              { id: 's', label: 'S', sku: 't-shirt-1-s', price: 25, inventory: 3 }
            ]
          }
        ]
      }
    };

    await import('../../assets/js/cart-provider.js');

    const provider = (window as any).StoreCartProvider;
    const readyApi = await provider.whenReady();
    const repairedItem = provider.store.getState().cart.items.items[0];
    expect(repairedItem).toMatchObject({
      id: 't-shirt-1__s',
      price: 25,
      shipping: {
        weight_oz: 6.5,
        packaging_weight_oz: 1
      }
    });
    expect(repairedItem.customFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '_product_id', value: 't-shirt-1' }),
      expect.objectContaining({ name: '_variant_id', value: 's' }),
      expect.objectContaining({ name: '_variant', value: 'S' })
    ]));

    await readyApi.api.theme.cart.open();
    await readyApi.api.theme.cart.navigate('/cart');

    const root = document.querySelector('[data-store-cart-root]') as HTMLElement | null;
    const postalField = root?.querySelector('[data-cart-estimate-postal]') as HTMLInputElement | null;
    expect(postalField).toBeTruthy();
    postalField!.value = '87120';
    postalField!.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(root?.querySelector('[data-cart-summary-shipping]')?.textContent).toBe('$9.55');
    expect(root?.querySelector('[data-cart-summary-tip-amount]')?.textContent).toBe('$1.25');
    expect(root?.querySelector('[data-cart-summary-tax]')?.textContent).toBe('$1.91');
    expect(root?.querySelector('[data-cart-summary-total]')?.textContent).toBe('$37.71');
  });

  it('collects opt-in RSVP responses in memory and submits them with the canonical cart item', async () => {
    localStorage.removeItem('pendingCartItem');
    let checkoutBody: any = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/tax/quote')) {
        return new Response(JSON.stringify({
          taxCents: 0,
          taxDetails: {
            effectiveRate: 0,
            destination: { country: 'US', state: 'NY', postalCode: '10001' }
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/checkout/intent')) {
        checkoutBody = JSON.parse(String(init?.body || '{}'));
        return new Response(JSON.stringify({ error: 'Captured RSVP test payload' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ products: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    vi.stubGlobal('fetch', fetchMock);
    (window as any).STORE_CONFIG = {
      cartRuntime: 'first_party',
      checkoutProvider: 'first_party',
      checkoutUiMode: 'custom',
      workerBase: 'https://worker.test',
      platformName: 'Dust Wave Shop',
      addOns: {
        enabled: false,
        products: [{
          id: 'rsvp-1',
          sku: 'rsvp-1',
          name: 'Community Screening',
          price: 0,
          category: 'rsvp',
          fulfillment_type: 'rsvp',
          inventory_tracking: true,
          event_registration: {
            closes_at: '2026-12-17T23:59:00-07:00',
            max_party_size: 4,
            require_contact_name: true,
            require_attendee_names: true,
            questions: [{
              id: 'accessibility_needs',
              label: 'Accessibility needs',
              type: 'textarea',
              scope: 'party',
              required: false,
              max_length: 500
            }, {
              id: 'age_group',
              label: 'Age group',
              type: 'single_select',
              scope: 'attendee',
              required: true,
              options: [
                { value: 'under_18', label: 'Under 18' },
                { value: '18_plus', label: '18 or older' }
              ]
            }],
          },
          variants: []
        }]
      }
    };

    await import('../../assets/js/cart-provider.js');
    const readyApi = await (window as any).StoreCartProvider.whenReady();
    await readyApi.api.cart.items.add({
      id: 'rsvp-1',
      name: 'Community Screening',
      price: 0,
      quantity: 2,
      maxQuantity: 10,
      shippable: false,
      customFields: [
        { name: '_product_id', type: 'hidden', value: 'rsvp-1' },
        { name: '_product_type', type: 'hidden', value: 'rsvp' },
        { name: '_sku', type: 'hidden', value: 'rsvp-1' }
      ]
    });
    await readyApi.api.theme.cart.open();
    await readyApi.api.theme.cart.navigate('/checkout');

    const root = document.querySelector('[data-store-cart-root]') as HTMLElement;
    expect(root.querySelectorAll('[data-rsvp-attendee-name]')).toHaveLength(2);
    expect((window as any).StoreCartProvider.store.getState().cart.items.items[0].maxQuantity).toBe(10);
    expect((root.querySelector('[data-rsvp-registration]') as HTMLElement | null)?.textContent).toContain('Respond by');
    expect(root.querySelector('[data-cart-tax-destination-field]')).toBeNull();
    expect(root.querySelector('[data-cart-checkout-summary-tax]')?.textContent).toBe('$0.00');

    const setValue = (selector: string, value: string, eventName = 'input') => {
      const field = root.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (!field) throw new Error('Missing RSVP field: ' + selector);
      field.value = value;
      field.dispatchEvent(new Event(eventName, { bubbles: true }));
    };
    setValue('[data-cart-custom-checkout-name]', 'Casey Host');
    setValue('[data-cart-custom-checkout-email]', 'casey@example.com');
    setValue('[data-rsvp-registration-answer][data-rsvp-scope="party"]', 'Step-free access');
    setValue('[data-rsvp-attendee-name][data-rsvp-attendee-index="0"]', 'Alex Guest');
    setValue('[data-rsvp-attendee-name][data-rsvp-attendee-index="1"]', 'Sam Guest');
    setValue('[data-rsvp-registration-answer][data-rsvp-attendee-index="0"]', '18_plus', 'change');
    setValue('[data-rsvp-registration-answer][data-rsvp-attendee-index="1"]', 'under_18', 'change');
    await vi.runAllTimersAsync();
    await Promise.resolve();
    const start = root.querySelector('[data-cart-start-checkout]') as HTMLButtonElement | null;
    expect(start?.disabled).toBe(false);
    start!.click();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(checkoutBody).toMatchObject({
      customer: { name: 'Casey Host', email: 'casey@example.com' },
      items: [{
        productId: 'rsvp-1',
        quantity: 2,
        registration: {
          answers: { accessibility_needs: 'Step-free access' },
          attendees: [
            { name: 'Alex Guest', answers: { age_group: '18_plus' } },
            { name: 'Sam Guest', answers: { age_group: 'under_18' } }
          ]
        }
      }]
    });
    expect(localStorage.getItem('store_first_party_cart_state')).not.toContain('Alex Guest');
    expect(localStorage.getItem('store_first_party_cart_state')).not.toContain('Step-free access');
  });
});

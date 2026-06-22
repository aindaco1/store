import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('cart bootstrap provider integration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    localStorage.clear();

    document.body.innerHTML = `
      <div data-store-cart-root="true"></div>
      <span class="storecart-total-price"></span>
    `;

    const state = {
      cart: {
        subtotal: 20,
        total: 20,
        token: 'cart_token_123',
        items: {
          count: 0,
          items: []
        }
      },
      customer: {}
    };

    const eventHandlers = new Map<string, Array<(...args: any[]) => void>>();
    const onEvent = vi.fn((eventName: string, handler: (...args: any[]) => void) => {
      const handlers = eventHandlers.get(eventName) || [];
      handlers.push(handler);
      eventHandlers.set(eventName, handlers);
    });
    const subscribe = vi.fn(() => () => {});
    const update = vi.fn(async () => {});
    const navigate = vi.fn();
    const open = vi.fn();
    const onReady = vi.fn((handler: (api: any) => void) => Promise.resolve(handler({
      api: {
        cart: {
          update
        },
        theme: {
          cart: {
            navigate,
            open
          }
        }
      },
      store: {
        getState: () => state,
        subscribe
      },
      events: {
        on: onEvent
      }
    })));

    const provider = {
      onReady,
      getApi: () => ({
        api: {
          cart: {
            update
          },
          theme: {
            cart: {
              navigate,
              open
            }
          }
        },
        store: {
          getState: () => state,
          subscribe
        },
        events: {
          on: onEvent
        }
      }),
      store: {
        getState: () => state,
        subscribe
      },
      events: {
        on: onEvent
      },
      __test: {
        eventHandlers,
        update,
        navigate
      }
    };

    Object.assign(window, {
      StoreCartProvider: provider
    });

    (globalThis as any).requestAnimationFrame = vi.fn(() => 1);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    delete (window as any).StoreCartProvider;
    delete (window as any).StoreConfig;
    delete (window as any).STORE_CONFIG;
    delete (window as any).__StoreCartRuntimeCartUiLoaded;
    delete (globalThis as any).requestAnimationFrame;
    document.body.innerHTML = '';
  });

  it('boots cart.js through StoreCartProvider when available', async () => {
    (window as any).STORE_CONFIG = {
      cartRuntime: 'first_party',
      checkoutProvider: 'first_party'
    };
    (window as any).StoreCartProvider.activeRuntime = 'first_party';

    await import('../../assets/js/cart.js');

    const provider = (window as any).StoreCartProvider;
    expect(provider.onReady).toHaveBeenCalledTimes(1);
    expect(provider.store.subscribe).toHaveBeenCalledTimes(1);
    expect(provider.events.on).toHaveBeenCalledWith('summary.checkout_clicked', expect.any(Function));
    const registeredEvents = provider.events.on.mock.calls.map(([eventName]: [string]) => eventName);

    expect(registeredEvents).not.toContain('cart.created');
    expect(registeredEvents).not.toContain('item.added');
    expect(registeredEvents).not.toContain('theme.routechanged');
    expect(registeredEvents).not.toContain('item.updated');
    expect(registeredEvents).not.toContain('item.removed');
    await vi.runAllTimersAsync();
    expect(provider.__test.navigate).not.toHaveBeenCalled();
    expect(document.querySelector('.store-first-party-cart__tip-box')).toBeNull();
    expect(document.querySelector('.store-first-party-cart__checkout-summary')).toBeNull();
  });

  it('does not fall back to removed cart provider aliases', async () => {
    (window as any).STORE_CONFIG = {
      cartRuntime: 'first_party',
      checkoutProvider: 'first_party'
    };
    (window as any).StoreCartProvider.activeRuntime = 'first_party';
    delete (window as any).StoreCartProvider;

    await import('../../assets/js/cart.js');

    const provider = (window as any).StoreCartProvider;
    expect(provider).toBeUndefined();
  });
});

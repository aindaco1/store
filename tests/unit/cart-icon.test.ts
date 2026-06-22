import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('cart icon provider integration', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete (window as any).StoreCartProvider;
    document.body.innerHTML = '';
  });

  it('renders from first-party cart state and opens the provider cart on click', async () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    document.body.innerHTML = `
      <button class="site-header__cart storecart-checkout" id="header-cart-btn">
        <span class="site-header__cart-icon-wrap">
          <span class="storecart-items-count site-header__cart-count"></span>
        </span>
        <span class="storecart-total-price site-header__cart-price">$0</span>
      </button>
    `;

    const state = {
      cart: {
        total: 12,
        items: {
          count: 1
        }
      }
    };
    const subscribers = new Set<(state: any) => void>();
    const open = vi.fn();

    (window as any).StoreCartProvider = {
      activeRuntime: 'first_party',
      getApi: () => ({
        api: {
          theme: {
            cart: {
              open
            }
          }
        }
      }),
      events: {
        on: (eventName: string, handler: () => void) => {
          if (eventName === 'cart.opened') {
            (window as any).__cartOpenedHandler = handler;
          }
          if (eventName === 'cart.closed') {
            (window as any).__cartClosedHandler = handler;
          }
          return () => {};
        }
      },
      store: {
        getState: () => state,
        subscribe: (handler: (state: any) => void) => {
          subscribers.add(handler);
          return () => subscribers.delete(handler);
        }
      }
    };

    await import('../../assets/js/cart-icon.js');

    const priceEl = document.querySelector('.site-header__cart-price');
    const countEl = document.querySelector('.site-header__cart-count');
    const button = document.getElementById('header-cart-btn') as HTMLButtonElement | null;

    expect(priceEl?.textContent).toBe('$12.00');
    expect(countEl?.textContent).toBe('1');
    expect(button?.getAttribute('aria-label')).toBe('Open cart. 1 item, $12.00 total.');

    state.cart.total = 19;
    state.cart.items.count = 3;
    subscribers.forEach((handler) => handler(state));

    expect(priceEl?.textContent).toBe('$19.00');
    expect(countEl?.textContent).toBe('3');
    expect(button?.getAttribute('aria-label')).toBe('Open cart. 3 items, $19.00 total.');
    expect(JSON.parse(localStorage.getItem('store_cart_cache') || '{}')).toEqual({
      total: 19,
      count: 3
    });
    expect(JSON.parse(localStorage.getItem('store_cart_cache') || '{}')).toEqual({
      total: 19,
      count: 3
    });

    (window as any).__cartOpenedHandler?.();
    expect(button?.getAttribute('aria-expanded')).toBe('true');

    (window as any).__cartClosedHandler?.();
    expect(button?.getAttribute('aria-expanded')).toBe('false');

    button?.click();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('prefers provider display summaries so the header total can include calculated tax', async () => {
    document.body.innerHTML = `
      <button class="site-header__cart storecart-checkout" id="header-cart-btn">
        <span class="site-header__cart-icon-wrap">
          <span class="storecart-items-count site-header__cart-count"></span>
        </span>
        <span class="storecart-total-price site-header__cart-price">$0</span>
      </button>
    `;

    const state = {
      cart: {
        total: 12,
        items: {
          count: 1
        }
      }
    };
    const subscribers = new Set<(state: any) => void>();
    const eventSubscribers = new Set<(summary: any) => void>();

    (window as any).StoreCartProvider = {
      activeRuntime: 'first_party',
      getDisplaySummary: () => ({
        total: 12.98,
        count: 1
      }),
      getApi: () => ({
        api: {
          theme: {
            cart: {
              open: vi.fn()
            }
          }
        }
      }),
      store: {
        getState: () => state,
        subscribe: (handler: (state: any) => void) => {
          subscribers.add(handler);
          return () => subscribers.delete(handler);
        }
      },
      events: {
        on: (_eventName: string, handler: (summary: any) => void) => {
          eventSubscribers.add(handler);
          return () => eventSubscribers.delete(handler);
        }
      }
    };

    await import('../../assets/js/cart-icon.js');

    const priceEl = document.querySelector('.site-header__cart-price');
    const button = document.getElementById('header-cart-btn') as HTMLButtonElement | null;
    expect(priceEl?.textContent).toBe('$12.98');
    expect(button?.getAttribute('aria-label')).toBe('Open cart. 1 item, $12.98 total.');

    eventSubscribers.forEach((handler) => handler({
      total: 16.53,
      count: 2
    }));

    expect(priceEl?.textContent).toBe('$16.53');
    expect(button?.getAttribute('aria-label')).toBe('Open cart. 2 items, $16.53 total.');
    expect(JSON.parse(localStorage.getItem('store_cart_cache') || '{}')).toEqual({
      total: 16.53,
      count: 2
    });
    expect(JSON.parse(localStorage.getItem('store_cart_cache') || '{}')).toEqual({
      total: 16.53,
      count: 2
    });
  });

  it('renders through StoreCartProvider', async () => {
    document.body.innerHTML = `
      <button class="site-header__cart storecart-checkout" id="header-cart-btn">
        <span class="site-header__cart-icon-wrap">
          <span class="storecart-items-count site-header__cart-count"></span>
        </span>
        <span class="storecart-total-price site-header__cart-price">$0</span>
      </button>
    `;

    (window as any).StoreCartProvider = {
      activeRuntime: 'first_party',
      getApi: () => ({
        api: {
          theme: {
            cart: {
              open: vi.fn()
            }
          }
        }
      }),
      events: {
        on: () => () => {}
      },
      store: {
        getState: () => ({
          cart: {
            total: 8,
            items: {
              count: 2
            }
          }
        }),
        subscribe: () => () => {}
      }
    };

    await import('../../assets/js/cart-icon.js');

    expect(document.querySelector('.site-header__cart-price')?.textContent).toBe('$8.00');
    expect(document.querySelector('.site-header__cart-count')?.textContent).toBe('2');
  });
});

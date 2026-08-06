import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Store product options image recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <article class="store-product-card" data-store-product-card>
        <a class="store-product-card__media" href="/products/dust-wave-sticker/">
          <img class="store-product-card__image" src="/assets/images/sticker-glove.png" alt="DUST WAVE Sticker">
        </a>
        <div data-store-product-controls>
          <button class="store-add-item" data-store-base-price="3" data-item-price="3" data-store-button-label="Add to Cart"></button>
        </div>
      </article>
    `;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    delete (window as any).StoreProductOptions;
  });

  it('retries complete but broken product-card images with a bounded cache-busted URL', async () => {
    await import('../../assets/js/store-product-options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    const image = document.querySelector<HTMLImageElement>('.store-product-card__image');
    expect(image).not.toBeNull();
    Object.defineProperty(image, 'complete', {
      configurable: true,
      value: true
    });
    Object.defineProperty(image, 'naturalWidth', {
      configurable: true,
      value: 0
    });

    expect((window as any).StoreProductOptions.refreshProductCardImages()).toBe(1);
    expect(image?.dataset.storeImageRetries).toBe('1');
    expect(image?.getAttribute('src')).toContain('/assets/images/sticker-glove.png?_store_image_retry=');

    expect((window as any).StoreProductOptions.refreshProductCardImages()).toBe(1);
    expect(image?.dataset.storeImageRetries).toBe('2');

    expect((window as any).StoreProductOptions.refreshProductCardImages()).toBe(0);
    expect(image?.dataset.storeImageRetries).toBe('2');
  });
});

describe('Store product options live inventory', () => {
  beforeEach(() => {
    vi.resetModules();
    (window as any).StoreConfig = { workerBase: 'https://checkout.example.com/' };
    document.body.innerHTML = `
      <article class="store-product-card" data-store-product-card>
        <p
          data-store-availability
          data-store-inventory-state="low"
          data-store-tracks-inventory="true"
          data-store-low-stock-threshold="5"
          data-store-sold-out-label="Sold out"
          data-store-inventory-pending-label="Inventory pending"
          data-store-in-stock-label="In stock"
          data-store-low-stock-template="Only %{count} left">Only 5 left</p>
        <div data-store-product-controls>
          <input type="number" value="1" data-store-quantity>
          <button type="button" data-store-quantity-step="-1">-</button>
          <button type="button" data-store-quantity-step="1">+</button>
          <button
            class="store-add-item"
            data-store-base-price="20"
            data-item-price="20"
            data-product-sku="mug-1"
            data-product-status="active"
            data-product-base-status="active"
            data-product-inventory="5"
            data-product-inventory-configured="true"
            data-product-inventory-tracking="true"
            data-store-button-label="Add to Cart"
            data-store-sold-out-label="Sold out"></button>
        </div>
      </article>
      <article class="store-product-card" data-store-product-card>
        <p
          data-store-availability
          data-store-inventory-state="low"
          data-store-tracks-inventory="true"
          data-store-low-stock-threshold="5"
          data-store-sold-out-label="Sold out"
          data-store-low-stock-template="Only %{count} left">Only 1 left</p>
        <div data-store-product-controls>
          <select data-store-variant-select>
            <option value="s" data-label="S" data-sku="shirt-s" data-price="30" data-inventory="1" data-inventory-configured="true" data-status="active" selected>S</option>
          </select>
          <input type="number" value="1" data-store-quantity>
          <button
            class="store-add-item"
            data-store-base-price="30"
            data-item-price="30"
            data-product-sku="shirt"
            data-product-status="active"
            data-product-base-status="active"
            data-product-inventory="1"
            data-product-inventory-configured="true"
            data-product-inventory-tracking="true"
            data-store-button-label="Add to Cart"
            data-store-sold-out-label="Sold out"></button>
        </div>
      </article>
    `;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      status: 'ready',
      inventory: {
        'mug-1': { available: 4, claimed: 999 },
        'shirt-s': { available: 0 }
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })));
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    delete (window as any).StoreConfig;
    delete (window as any).StoreProductOptions;
  });

  it('uses one public projection request for every card and variant on the page', async () => {
    await import('../../assets/js/store-product-options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    await vi.waitFor(() => {
      expect(document.querySelector('[data-store-availability]')?.textContent).toBe('Only 4 left');
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://checkout.example.com/api/store/inventory', {
      headers: { Accept: 'application/json' }
    });
    expect(document.querySelector('.store-add-item')?.getAttribute('data-product-inventory')).toBe('4');

    const variant = document.querySelectorAll<HTMLSelectElement>('[data-store-variant-select]')[0];
    expect(variant.options[0].getAttribute('data-inventory')).toBe('0');
    expect(variant.options[0].disabled).toBe(true);
    expect(document.querySelectorAll('[data-store-availability]')[1].textContent).toBe('Sold out');
    expect(document.querySelectorAll<HTMLButtonElement>('.store-add-item')[1].disabled).toBe(true);
  });
});

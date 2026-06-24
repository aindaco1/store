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

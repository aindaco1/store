import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('buy-buttons provider integration', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as any).__StoreBuyButtonsLoaded;
    document.body.innerHTML = '<button class="store-add-item" data-item-name="VIP Pass">Buy</button>';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).StoreCartProvider;
    delete (window as any).__StoreBuyButtonsLoaded;
    document.body.innerHTML = '';
  });

  it('subscribes through StoreCartProvider when available', async () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    const onItemAdded = vi.fn();
    const onReady = vi.fn(async (handler: (api: any) => void) => {
      handler({
        events: {
          on: onItemAdded
        }
      });
    });

    (window as any).StoreCartProvider = {
      onReady
    };

    await import('../../assets/js/buy-buttons.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onItemAdded).toHaveBeenCalledTimes(1);
    expect(onItemAdded).toHaveBeenCalledWith('item.added', expect.any(Function));
  });

  it('subscribes through StoreCartProvider for Store buttons', async () => {
    document.body.innerHTML = '<button class="store-add-item" data-item-name="VIP Pass">Buy</button>';
    const onItemAdded = vi.fn();
    const onReady = vi.fn(async (handler: (api: any) => void) => {
      handler({
        events: {
          on: onItemAdded
        }
      });
    });

    (window as any).StoreCartProvider = {
      onReady
    };

    await import('../../assets/js/buy-buttons.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onItemAdded).toHaveBeenCalledWith('item.added', expect.any(Function));
  });
});

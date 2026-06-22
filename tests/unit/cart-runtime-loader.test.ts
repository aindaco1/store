import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeScriptKeys = [
  'add-on-utils',
  'shipping-option-utils',
  'stripe-checkout-sidecar',
  'cart-provider',
  'cart',
  'buy-buttons'
];

function installLoaderScript(version = '123') {
  document.head.innerHTML = `
    <script
      src="https://store.test/assets/js/cart-runtime-loader.js?v=${version}"
      data-store-cart-runtime-loader="true"
      data-asset-version="${version}">
    </script>
  `;
}

function installRuntimeScriptHarness(providerClick = vi.fn()) {
  const appended: string[] = [];
  const provider = {
    activeRuntime: 'first_party',
    whenReady: vi.fn(async () => (window as any).StoreCartProvider),
    getApi: () => ({
      api: {
        theme: {
          cart: {
            open: vi.fn()
          }
        }
      }
    })
  };

  const originalAppendChild = Element.prototype.appendChild;
  const appendSpy = vi.spyOn(Element.prototype, 'appendChild').mockImplementation(function(child: Node) {
    const result = originalAppendChild.call(this, child);
    const script = child instanceof HTMLScriptElement ? child : null;
    if (!script?.dataset.storeCartRuntimeScript) {
      return result;
    }

    appended.push(script.dataset.storeCartRuntimeScript);
    queueMicrotask(() => {
      switch (script.dataset.storeCartRuntimeScript) {
        case 'add-on-utils':
          (window as any).StoreAddOnUtils = {};
          break;
        case 'shipping-option-utils':
          (window as any).StoreShippingOptionUtils = {};
          break;
        case 'stripe-checkout-sidecar':
          (window as any).StoreStripeCheckoutSidecar = {};
          break;
        case 'cart-provider':
          (window as any).StoreCartProvider = provider;
          document.addEventListener('click', (event) => {
            if ((event.target as Element | null)?.closest?.('.store-add-item')) {
              providerClick();
            }
          });
          document.dispatchEvent(new CustomEvent('storecart.provider.ready', {
            detail: { activeRuntime: 'first_party' }
          }));
          break;
        case 'cart':
          (window as any).__StoreCartRuntimeCartUiLoaded = true;
          break;
        case 'buy-buttons':
          (window as any).__StoreBuyButtonsLoaded = true;
          break;
        default:
          break;
      }

      script.dispatchEvent(new Event('load'));
    });

    return result;
  });

  return {
    appended,
    appendSpy,
    provider,
    providerClick
  };
}

async function flushAsyncWork() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('cart runtime loader', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete (window as any).StoreCartRuntime;
    delete (window as any).StoreCartProvider;
    delete (window as any).StoreAddOnUtils;
    delete (window as any).StoreShippingOptionUtils;
    delete (window as any).StoreStripeCheckoutSidecar;
    delete (window as any).__StoreCartRuntimeCartUiLoaded;
    delete (window as any).__StoreBuyButtonsLoaded;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete (window as any).StoreCartRuntime;
    delete (window as any).StoreCartProvider;
    delete (window as any).StoreAddOnUtils;
    delete (window as any).StoreShippingOptionUtils;
    delete (window as any).StoreStripeCheckoutSidecar;
    delete (window as any).__StoreCartRuntimeCartUiLoaded;
    delete (window as any).__StoreBuyButtonsLoaded;
  });

  it('loads the cart provider stack once with the page asset version', async () => {
    installLoaderScript('456');
    const harness = installRuntimeScriptHarness();

    await import('../../assets/js/cart-runtime-loader.js');

    const runtime = (window as any).StoreCartRuntime;
    await expect(runtime.load('unit-test')).resolves.toBe(harness.provider);
    await expect(runtime.load('second-call')).resolves.toBe(harness.provider);

    expect(harness.appended).toEqual(runtimeScriptKeys);
    expect(harness.appended).toHaveLength(runtimeScriptKeys.length);

    const scriptVersions = Array.from(document.querySelectorAll<HTMLScriptElement>('script[data-store-cart-runtime-script]'))
      .map((script) => new URL(script.src).searchParams.get('v'));
    expect(scriptVersions).toEqual(runtimeScriptKeys.map(() => '456'));
    expect(document.querySelectorAll<HTMLScriptElement>('script[data-store-cart-runtime-script]')).toHaveLength(runtimeScriptKeys.length);
  });

  it('loads the runtime and replays the original Store add button click', async () => {
    installLoaderScript();
    const providerClick = vi.fn();
    const harness = installRuntimeScriptHarness(providerClick);
    document.body.innerHTML = `
      <button class="store-add-item" data-item-id="demo__standard" type="button">
        Add
      </button>
    `;

    await import('../../assets/js/cart-runtime-loader.js');

    const button = document.querySelector<HTMLButtonElement>('.store-add-item');
    button?.click();
    await flushAsyncWork();

    expect(harness.appended).toEqual(runtimeScriptKeys);
    expect(providerClick).toHaveBeenCalledTimes(1);
  });

  it('replays Store add button clicks after lazy loading', async () => {
    installLoaderScript();
    const providerClick = vi.fn();
    const harness = installRuntimeScriptHarness(providerClick);
    document.body.innerHTML = `
      <button class="store-add-item" data-item-id="demo__standard" type="button">
        Add
      </button>
    `;

    await import('../../assets/js/cart-runtime-loader.js');

    const button = document.querySelector<HTMLButtonElement>('.store-add-item');
    button?.click();
    await flushAsyncWork();

    expect(harness.appended).toEqual(runtimeScriptKeys);
    expect(providerClick).toHaveBeenCalledTimes(1);
  });

  it('autoloads for stored cart work and recovery routes', async () => {
    installLoaderScript();
    installRuntimeScriptHarness();
    localStorage.setItem('store_first_party_cart_state', JSON.stringify({
      items: [{ id: 'demo__standard' }]
    }));

    await import('../../assets/js/cart-runtime-loader.js');

    expect((window as any).StoreCartRuntime.shouldAutoload()).toBe(true);

    localStorage.clear();
    sessionStorage.setItem('store_pending_order', JSON.stringify({
      value: 'true',
      savedAt: Date.now()
    }));
    expect((window as any).StoreCartRuntime.shouldAutoload()).toBe(true);

    sessionStorage.clear();
    window.history.replaceState({}, '', '/order-success/?orderId=store-intent-demo123');
    expect((window as any).StoreCartRuntime.shouldAutoload()).toBe(true);
  });
});

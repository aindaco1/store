import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('config boot scripts', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    delete (window as any).STORE_CONFIG;
    delete (window as any).StoreConfig;
    delete (window as any).STORE_TIME;
    delete (window as any).StoreTime;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    delete (window as any).STORE_CONFIG;
    delete (window as any).StoreConfig;
    delete (window as any).STORE_TIME;
    delete (window as any).StoreTime;
  });

  it('hydrates STORE_CONFIG from script data attributes', async () => {
    document.body.innerHTML = `
      <script
        data-store-config-script="true"
        data-current-lang="es"
        data-runtime-messages='{"cart":{"checkout":"Pagar"},"manage":{"saved":"Guardado"}}'
        data-site-url="https://store.test"
        data-worker-base="https://worker.test"
        data-platform-name="Fork Store"
        data-platform-company-name="Fork Studio"
        data-platform-author="Fork Studio"
        data-platform-support-email="support@fork.test"
        data-platform-timezone="Europe/London"
        data-default-creator-name="Fork Studio"
        data-sales-tax-rate="0.07875"
        data-flat-shipping-rate="3.00"
        data-shipping-origin-zip="87120"
        data-shipping-origin-country="US"
        data-shipping-fallback-flat-rate="3.00"
        data-shipping-free-shipping-default="false"
        data-shipping-countries='[{"value":"US","label":"United States"},{"value":"CA","label":"Canada"}]'
        data-shipping-presets='{"poster":{"weight_oz":5,"length_in":18,"width_in":3,"height_in":3}}'
        data-add-ons='{"enabled":true,"product_count":3,"low_stock_threshold":5,"products":[{"id":"dust-wave-sticker","name":"DUST WAVE Sticker","image_url":"https://shop.dustwave.xyz/assets/images/sticker-glove.png","price":3,"inventory":50,"category":"physical","type":"sticker","shipping_preset":"sticker","variants":[]},{"id":"dust-wave-tshirt","name":"DUST WAVE T-Shirt","image_url":"https://shop.dustwave.xyz/assets/images/dustwave-tshirt.png","price":25,"category":"physical","type":"shirt","shipping_preset":"tshirt","variant_option_name":"Size","variants":[{"id":"s","label":"S","inventory":2},{"id":"m","label":"M","inventory":4}]}]}'
        data-default-tip-percent="5"
        data-max-tip-percent="15"
        data-live-inventory-cache-ttl-seconds="300"
        data-seo-x-handle="dustwave"
        data-debug-console-logging-enabled="true"
        data-debug-verbose-console-logging="false"
        data-stripe-publishable-key="pk_test_store"></script>
    `;

    await import('../../assets/js/store-config.js');

    expect((window as any).STORE_CONFIG).toEqual({
      i18n: {
        currentLang: 'es',
        messages: {
          cart: {
            checkout: 'Pagar'
          },
          manage: {
            saved: 'Guardado'
          }
        }
      },
      platform: {
        name: 'Fork Store',
        companyName: 'Fork Studio',
        author: 'Fork Studio',
        supportEmail: 'support@fork.test',
        siteUrl: 'https://store.test',
        workerUrl: 'https://worker.test',
        timezone: 'Europe/London',
        defaultCreatorName: 'Fork Studio'
      },
      pricing: {
        salesTaxRate: '0.07875',
        flatShippingRate: '3.00',
        defaultTipPercent: '5',
        maxTipPercent: '15'
      },
      shipping: {
        originZip: '87120',
        originCountry: 'US',
        fallbackFlatRate: '3.00',
        freeShippingDefault: 'false',
        countries: [
          { value: 'US', label: 'United States' },
          { value: 'CA', label: 'Canada' }
        ],
        presets: {
          poster: {
            weight_oz: 5,
            length_in: 18,
            width_in: 3,
            height_in: 3
          }
        }
      },
      addOns: {
        enabled: true,
        product_count: 3,
        low_stock_threshold: 5,
        products: [
        {
          id: 'dust-wave-sticker',
          name: 'DUST WAVE Sticker',
          image_url: 'https://shop.dustwave.xyz/assets/images/sticker-glove.png',
          price: 3,
	          inventory: 50,
	          category: 'physical',
	          type: 'sticker',
	          shipping_preset: 'sticker',
            variants: []
          },
        {
          id: 'dust-wave-tshirt',
          name: 'DUST WAVE T-Shirt',
          image_url: 'https://shop.dustwave.xyz/assets/images/dustwave-tshirt.png',
          price: 25,
	            category: 'physical',
	            type: 'shirt',
	            shipping_preset: 'tshirt',
            variant_option_name: 'Size',
            variants: [
              { id: 's', label: 'S', inventory: 2 },
              { id: 'm', label: 'M', inventory: 4 }
            ]
          }
        ]
      },
      cache: {
        liveInventoryTtlSeconds: '300'
      },
      checkout: {
        cartRuntime: 'first_party',
        provider: 'first_party',
        uiMode: 'custom',
        stripePublishableKey: 'pk_test_store'
      },
      seo: {
        xHandle: 'dustwave'
      },
      debug: {
        consoleLoggingEnabled: 'true',
        verboseConsoleLogging: 'false'
      },
      siteUrl: 'https://store.test',
      workerBase: 'https://worker.test',
      platformName: 'Fork Store',
      platformCompanyName: 'Fork Studio',
      platformAuthor: 'Fork Studio',
      platformTimezone: 'Europe/London',
      supportEmail: 'support@fork.test',
      defaultCreatorName: 'Fork Studio',
      salesTaxRate: '0.07875',
      flatShippingRate: '3.00',
      shippingOriginZip: '87120',
      shippingOriginCountry: 'US',
      shippingFallbackFlatRate: '3.00',
      shippingFreeShippingDefault: 'false',
      shippingCountries: [
        { value: 'US', label: 'United States' },
        { value: 'CA', label: 'Canada' }
      ],
      defaultTipPercent: '5',
      maxTipPercent: '15',
      liveInventoryCacheTtlSeconds: '300',
      cartRuntime: 'first_party',
      checkoutProvider: 'first_party',
      checkoutUiMode: 'custom',
      stripePublishableKey: 'pk_test_store',
      seoXHandle: 'dustwave',
      debugConsoleLoggingEnabled: 'true',
      debugVerboseConsoleLogging: 'false'
    });
    expect((window as any).StoreConfig).toBe((window as any).STORE_CONFIG);
    expect((window as any).StoreTime).toBe((window as any).STORE_TIME);
  });
});

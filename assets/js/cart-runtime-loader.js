(function() {
  'use strict';

  if (window.StoreCartRuntime) return;

  var loaderScript = document.currentScript ||
    document.querySelector('[data-store-cart-runtime-loader]');
  var loaderUrl = null;
  try {
    loaderUrl = loaderScript?.src ? new URL(loaderScript.src, window.location.href) : null;
  } catch (_error) {
    loaderUrl = null;
  }

  var assetVersion = loaderScript?.dataset?.assetVersion || loaderUrl?.searchParams?.get('v') || '';
  var runtimePromise = null;
  var runtimeLoaded = false;
  var replayingButtons = new WeakSet();
  var warmedByPointer = false;
  var pointerWarmTimer = null;
  var POINTER_WARM_DELAY_MS = 90;

  var runtimeScripts = [
    {
      file: 'add-on-utils.js',
      key: 'add-on-utils',
      ready: function() {
        return Boolean(window.StoreAddOnUtils);
      }
    },
    {
      file: 'shipping-option-utils.js',
      key: 'shipping-option-utils',
      ready: function() {
        return Boolean(window.StoreShippingOptionUtils);
      }
    },
    {
      file: 'stripe-checkout-sidecar.js',
      key: 'stripe-checkout-sidecar',
      ready: function() {
        return Boolean(window.StoreStripeCheckoutSidecar);
      }
    },
    {
      file: 'cart-provider.js',
      key: 'cart-provider',
      ready: function() {
        return Boolean(window.StoreCartProvider);
      }
    },
    {
      file: 'cart.js',
      key: 'cart',
      ready: function() {
        return Boolean(window.__StoreCartRuntimeCartUiLoaded);
      }
    },
    {
      file: 'buy-buttons.js',
      key: 'buy-buttons',
      ready: function() {
        return Boolean(window.__StoreBuyButtonsLoaded);
      }
    }
  ];

  function getLogger() {
    return window.StoreLogger?.createLogger?.('cart-runtime') || {
      debug: function() {},
      info: function() {},
      warn: function() {},
      error: function() {}
    };
  }

  function resolveScriptUrl(file) {
    var url;
    try {
      url = loaderUrl
        ? new URL(file, loaderUrl.href)
        : new URL('/assets/js/' + file, window.location.href);
    } catch (_error) {
      url = new URL('/assets/js/' + file, window.location.href);
    }

    if (assetVersion) {
      url.searchParams.set('v', assetVersion);
    }

    return url.href;
  }

  function dispatchRuntimeEvent(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  function findExistingRuntimeScript(scriptDef) {
    return document.querySelector('script[data-store-cart-runtime-script="' + scriptDef.key + '"]');
  }

  function loadScript(scriptDef) {
    if (scriptDef.ready()) return Promise.resolve();

    var existing = findExistingRuntimeScript(scriptDef);
    if (existing?.dataset?.loaded === 'true') return Promise.resolve();

    return new Promise(function(resolve, reject) {
      var script = existing || document.createElement('script');

      function handleLoad() {
        script.dataset.loaded = 'true';
        resolve();
      }

      function handleError() {
        reject(new Error('Failed to load cart runtime script: ' + scriptDef.file));
      }

      script.addEventListener('load', handleLoad, { once: true });
      script.addEventListener('error', handleError, { once: true });

      if (!existing) {
        script.src = resolveScriptUrl(scriptDef.file);
        script.defer = true;
        script.async = false;
        script.dataset.storeCartRuntimeScript = scriptDef.key;
        (document.head || document.body || document.documentElement).appendChild(script);
      }
    });
  }

  function getCartProvider() {
    return window.StoreCartProvider || null;
  }

  function waitForProvider() {
    var provider = getCartProvider();
    if (!provider?.whenReady) return Promise.resolve(provider || null);
    return provider.whenReady().then(function() {
      return provider;
    });
  }

  async function loadRuntime(reason) {
    if (runtimeLoaded && getCartProvider()) {
      await waitForProvider();
      return getCartProvider();
    }

    if (runtimePromise) return runtimePromise;

    runtimePromise = runtimeScripts.reduce(function(promise, scriptDef) {
      return promise.then(function() {
        return loadScript(scriptDef);
      });
    }, Promise.resolve())
      .then(waitForProvider)
      .then(function(provider) {
        runtimeLoaded = true;
        dispatchRuntimeEvent('storecart.runtime.ready', {
          reason: reason || '',
          activeRuntime: provider?.activeRuntime || ''
        });
        return provider;
      })
      .catch(function(error) {
        runtimePromise = null;
        getLogger().error('Failed to load cart runtime', error);
        dispatchRuntimeEvent('storecart.runtime.error', {
          reason: reason || '',
          message: error?.message || String(error)
        });
        throw error;
      });

    return runtimePromise;
  }

  function getStorageValue(storageName, key) {
    try {
      return window[storageName]?.getItem?.(key) || '';
    } catch (_error) {
      return '';
    }
  }

  function hasStoredCartWork() {
    var checks = [
      ['localStorage', 'pendingCartItem'],
      ['localStorage', 'store_first_party_cart_state'],
      ['localStorage', 'store_first_party_checkout_snapshot'],
      ['localStorage', 'store_pending_order'],
      ['sessionStorage', 'store_first_party_cart_draft'],
      ['sessionStorage', 'store_pending_order'],
      ['sessionStorage', 'store_active_custom_checkout_order_id']
    ];

    return checks.some(function(check) {
      return Boolean(getStorageValue(check[0], check[1]));
    });
  }

  function hasCartQueryAction() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      return ['changeTier', 'addTiers', 'addSupport'].some(function(key) {
        return params.has(key);
      });
    } catch (_error) {
      return false;
    }
  }

  function isCartRecoveryPath() {
    var path = String(window.location?.pathname || '/');
    return /^\/(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})?\/)?(?:cart|checkout|order-success)\/?$/.test(path) ||
      /^\/(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})?\/)?checkout\/(?:billing|payment)\/?$/.test(path);
  }

  function shouldAutoload() {
    return isCartRecoveryPath() || hasCartQueryAction() || hasStoredCartWork();
  }

  function openProviderCart(provider) {
    return provider?.getApi?.()?.api?.theme?.cart?.open?.();
  }

  async function handleHeaderCartClick(event) {
    if (!event.target?.closest?.('#header-cart-btn')) return;
    if (runtimeLoaded && getCartProvider()) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    try {
      var provider = await loadRuntime('header-cart-click');
      openProviderCart(provider);
    } catch (_error) {}
  }

  async function handleAddButtonClick(event) {
    var button = event.target?.closest?.('.store-add-item');
    if (!button) return;
    if (button.disabled) return;
    if (replayingButtons.has(button)) {
      replayingButtons.delete(button);
      return;
    }
    if (runtimeLoaded && getCartProvider()) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    try {
      await loadRuntime('add-button-click');
      replayingButtons.add(button);
      button.click();
    } catch (_error) {}
  }

  function getCartIntentTarget(event) {
    var target = event.target?.closest?.('#header-cart-btn, .store-add-item') || null;
    if (target?.matches?.('.store-add-item') && target.disabled) return null;
    return target;
  }

  function startPointerWarm(reason) {
    if (warmedByPointer || runtimeLoaded || runtimePromise) return;

    warmedByPointer = true;
    void loadRuntime(reason).catch(function() {
      warmedByPointer = false;
    });
  }

  function warmRuntimeFromPointer(event) {
    if (!getCartIntentTarget(event)) return;

    if (event.type === 'touchstart') {
      startPointerWarm('touch-intent');
      return;
    }

    window.clearTimeout(pointerWarmTimer);
    pointerWarmTimer = window.setTimeout(function() {
      startPointerWarm('pointer-intent');
    }, POINTER_WARM_DELAY_MS);
  }

  function startAutoloadIfNeeded() {
    if (!shouldAutoload()) return;
    void loadRuntime('autoload').catch(function() {});
  }

  document.addEventListener('click', handleHeaderCartClick, true);
  document.addEventListener('click', handleAddButtonClick, true);
  document.addEventListener('pointerover', warmRuntimeFromPointer, {
    capture: true,
    passive: true
  });
  document.addEventListener('touchstart', warmRuntimeFromPointer, {
    capture: true,
    passive: true
  });

  var cartRuntime = {
    load: loadRuntime,
    shouldAutoload: shouldAutoload,
    isLoaded: function() {
      return runtimeLoaded && Boolean(getCartProvider());
    }
  };
  window.StoreCartRuntime = cartRuntime;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startAutoloadIfNeeded, { once: true });
  } else {
    window.setTimeout(startAutoloadIfNeeded, 0);
  }
})();

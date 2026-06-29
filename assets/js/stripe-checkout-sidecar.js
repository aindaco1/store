(function() {
  'use strict';

  const STRIPE_JS_URL = 'https://js.stripe.com/clover/stripe.js';
  let stripeJsPromise = null;

  function readThemeVar(names, fallback) {
    try {
      const candidates = Array.isArray(names) ? names : [names];
      const computedStyle = window.getComputedStyle(document.documentElement);
      for (const name of candidates) {
        const computed = computedStyle.getPropertyValue(name);
        const normalized = String(computed || '').trim();
        if (normalized) return normalized;
      }
      return fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function buildStripeAppearance() {
    const radiusMd = readThemeVar('--store-radius-md', '10px');
    const colorPrimary = readThemeVar('--store-color-primary', '#101215');
    const colorPrimaryHover = readThemeVar('--store-color-primary-hover', colorPrimary);
    const colorText = readThemeVar('--store-ink-default', '#252930');
    const colorTextStrong = readThemeVar('--store-ink-strong', '#101215');
    const colorTextMuted = readThemeVar('--store-ink-muted', '#5d6573');
    const colorTextSoft = readThemeVar('--store-ink-soft', '#7b8494');
    const colorSurfaceBase = readThemeVar('--store-surface-base', '#ffffff');
    const colorSurfaceSubtle = readThemeVar('--store-surface-subtle', '#f0f1ed');
    const colorSurfacePage = readThemeVar('--store-surface-page', '#f5f5f2');
    const colorBorder = readThemeVar('--store-border-default', '#d2d7df');
    const colorBorderStrong = readThemeVar('--store-border-strong', '#9ea7b5');
    const fontFamily = readThemeVar('--store-font-body', 'Inter, sans-serif');

    return {
      theme: 'flat',
      labels: 'floating',
      variables: {
        colorPrimary: colorPrimary,
        colorText: colorText,
        colorTextSecondary: colorTextMuted,
        colorDanger: '#9f1239',
        colorBackground: colorSurfaceSubtle,
        borderRadius: radiusMd,
        spacingUnit: '4px',
        fontFamily: fontFamily,
        fontSizeBase: '13px',
        fontWeightNormal: '400'
      },
      rules: {
        '.Block': {
          backgroundColor: colorSurfaceBase,
          border: '1px solid ' + colorBorder,
          boxShadow: 'none',
          borderRadius: radiusMd
        },
        '.Input': {
          backgroundColor: colorSurfaceBase,
          border: '1px solid ' + colorBorder,
          boxShadow: 'none',
          color: colorText,
          fontSize: '13px',
          fontWeight: '400',
          lineHeight: '1.4',
          padding: '10px 12px'
        },
        '.Input::placeholder': {
          color: colorTextMuted
        },
        '.Input:focus': {
          borderColor: colorPrimary,
          boxShadow: '0 0 0 1px ' + colorPrimary
        },
        '.Label': {
          fontWeight: '700',
          color: colorTextStrong,
          fontSize: '12px'
        },
        '.Tab': {
          backgroundColor: colorSurfaceBase,
          border: '1px solid ' + colorBorder,
          boxShadow: 'none',
          borderRadius: radiusMd,
          padding: '12px 14px'
        },
        '.Tab:hover': {
          borderColor: colorBorderStrong
        },
        '.Tab--selected': {
          backgroundColor: colorSurfacePage,
          border: '2px solid ' + colorPrimary,
          boxShadow: 'none'
        },
        '.TabLabel': {
          color: colorTextSoft,
          fontWeight: '500',
          fontSize: '13px'
        },
        '.TabLabel--selected': {
          color: colorPrimaryHover,
          fontWeight: '700'
        },
        '.TabIcon': {
          color: colorTextSoft,
          fill: colorTextSoft
        },
        '.TabIcon--selected': {
          color: colorPrimaryHover,
          fill: colorPrimaryHover
        }
      }
    };
  }

  function isMountableContainer(value) {
    return value instanceof HTMLElement;
  }

  function getStripeElementErrorMessage(event, fallback) {
    return String(
      event?.error?.message ||
      event?.message ||
      fallback ||
      'Secure checkout could not load.'
    ).trim();
  }

  function ensureStripeJs() {
    if (typeof window.Stripe === 'function') {
      return Promise.resolve(window.Stripe);
    }

    if (stripeJsPromise) return stripeJsPromise;

    stripeJsPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector('script[data-store-stripe-js="true"]');
      const handleLoad = function() {
        if (typeof window.Stripe === 'function') {
          resolve(window.Stripe);
          return;
        }

        stripeJsPromise = null;
        reject(new Error('Stripe.js loaded without exposing Stripe.'));
      };
      const handleError = function() {
        stripeJsPromise = null;
        reject(new Error('Failed to load Stripe.js.'));
      };

      if (existingScript) {
        existingScript.addEventListener('load', handleLoad, { once: true });
        existingScript.addEventListener('error', handleError, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = STRIPE_JS_URL;
      script.async = true;
      script.dataset.storeStripeJs = 'true';
      script.addEventListener('load', handleLoad, { once: true });
      script.addEventListener('error', handleError, { once: true });
      document.head.appendChild(script);
    });

    return stripeJsPromise;
  }

  async function mountCustomCheckout(options) {
    const publishableKey = String(options?.publishableKey || '');
    const clientSecret = String(options?.clientSecret || '');
    const paymentContainer = options?.paymentContainer;
    const linkAuthenticationContainer = options?.linkAuthenticationContainer;
    const shippingContainer = options?.shippingContainer;
    const useShippingAddressElement = options?.useShippingAddressElement === true;
    const locale = String(options?.locale || document.documentElement.lang || 'en').trim().toLowerCase();

    if (!publishableKey) {
      throw new Error('Missing Stripe publishable key.');
    }

    if (!clientSecret) {
      throw new Error('Missing Stripe client secret.');
    }

    if (!isMountableContainer(paymentContainer)) {
      throw new Error('Missing Payment Element container.');
    }

    await ensureStripeJs();

    const stripe = window.Stripe(publishableKey, {
      locale: locale || 'en'
    });
    if (!stripe || typeof stripe.initCheckout !== 'function') {
      throw new Error('Stripe custom checkout is unavailable.');
    }

    const checkout = await stripe.initCheckout({
      clientSecret,
      elementsOptions: {
        syncAddressCheckbox: 'shipping',
        appearance: buildStripeAppearance()
      }
    });
    if (!checkout || typeof checkout.loadActions !== 'function') {
      throw new Error('Stripe custom checkout did not initialize correctly.');
    }

    const loadActionsResult = await checkout.loadActions();
    if (loadActionsResult?.type !== 'success' || !loadActionsResult.actions) {
      throw new Error(loadActionsResult?.error?.message || 'Stripe checkout actions failed to load.');
    }

    paymentContainer.innerHTML = '';
    const paymentElement = checkout.createPaymentElement({
      layout: {
        type: 'tabs'
      },
      paymentMethodOrder: ['card', 'link'],
      fields: {
        billingDetails: {
          name: 'never',
          email: 'never',
          address: 'never'
        }
      }
    });
    paymentElement.mount(paymentContainer);

    let linkAuthenticationElement = null;
    if (isMountableContainer(linkAuthenticationContainer) && typeof checkout.createLinkAuthenticationElement === 'function') {
      try {
        linkAuthenticationContainer.innerHTML = '';
        linkAuthenticationElement = checkout.createLinkAuthenticationElement();
        if (typeof linkAuthenticationElement?.on === 'function' && typeof options?.onLinkChange === 'function') {
          linkAuthenticationElement.on('change', options.onLinkChange);
        }
        linkAuthenticationElement.mount(linkAuthenticationContainer);
      } catch (_error) {
        linkAuthenticationElement = null;
      }
    }

    let shippingAddressElement = null;
    if (useShippingAddressElement &&
      isMountableContainer(shippingContainer) &&
      typeof checkout.createShippingAddressElement === 'function') {
      try {
        shippingContainer.innerHTML = '';
        const shippingOptions = {};
        if (Array.isArray(options?.allowedCountries) && options.allowedCountries.length > 0) {
          shippingOptions.allowedCountries = options.allowedCountries;
        }
        if (options?.defaultCountry) {
          shippingOptions.defaultValues = {
            address: {
              country: String(options.defaultCountry).toUpperCase()
            }
          };
        }
        shippingAddressElement = checkout.createShippingAddressElement(shippingOptions);
        shippingAddressElement.mount(shippingContainer);
      } catch (_error) {
        shippingAddressElement = null;
      }
    }

    if (typeof checkout.on === 'function' && typeof options?.onChange === 'function') {
      checkout.on('change', options.onChange);
    }

    return {
      stripe,
      checkout,
      actions: loadActionsResult.actions,
      session: typeof loadActionsResult.actions.getSession === 'function'
        ? loadActionsResult.actions.getSession()
        : null,
      supportsLinkAuthenticationElement: Boolean(linkAuthenticationElement),
      supportsShippingAddressElement: Boolean(shippingAddressElement),
      updateEmail: function(email) {
        if (typeof loadActionsResult.actions.updateEmail !== 'function') {
          return Promise.resolve({});
        }
        return loadActionsResult.actions.updateEmail(email);
      },
      updateShippingAddress: function(shippingDetails) {
        if (typeof loadActionsResult.actions.updateShippingAddress !== 'function') {
          return Promise.resolve({});
        }
        return loadActionsResult.actions.updateShippingAddress(shippingDetails);
      },
      confirm: function(params) {
        return loadActionsResult.actions.confirm({
          redirect: 'if_required',
          ...(params || {})
        });
      },
      unmount: function() {
        if (typeof paymentElement?.unmount === 'function') {
          paymentElement.unmount();
        }

        if (typeof linkAuthenticationElement?.unmount === 'function') {
          linkAuthenticationElement.unmount();
        }

        if (typeof shippingAddressElement?.unmount === 'function') {
          shippingAddressElement.unmount();
        }
      }
    };
  }

  async function mountPaymentIntent(options) {
    const publishableKey = String(options?.publishableKey || '');
    const clientSecret = String(options?.clientSecret || '');
    const paymentContainer = options?.paymentContainer;
    const locale = String(options?.locale || document.documentElement.lang || 'en').trim().toLowerCase();

    if (!publishableKey) {
      throw new Error('Missing Stripe publishable key.');
    }

    if (!clientSecret) {
      throw new Error('Missing Stripe client secret.');
    }

    if (!isMountableContainer(paymentContainer)) {
      throw new Error('Missing Payment Element container.');
    }

    await ensureStripeJs();

    const stripe = window.Stripe(publishableKey, {
      locale: locale || 'en'
    });
    if (!stripe || typeof stripe.elements !== 'function' || typeof stripe.confirmPayment !== 'function') {
      throw new Error('Stripe Payment Element is unavailable.');
    }

    const elements = stripe.elements({
      clientSecret,
      appearance: buildStripeAppearance()
    });
    if (!elements || typeof elements.create !== 'function') {
      throw new Error('Stripe Elements did not initialize correctly.');
    }

    paymentContainer.innerHTML = '';
    const paymentElement = elements.create('payment', {
      layout: {
        type: 'tabs'
      },
      paymentMethodOrder: ['card', 'link'],
      fields: {
        billingDetails: {
          name: 'never',
          email: 'never',
          address: 'never'
        }
      }
    });
    if (!paymentElement || typeof paymentElement.mount !== 'function') {
      throw new Error('Stripe Payment Element did not initialize correctly.');
    }

    let paymentElementLoadError = '';

    if (typeof paymentElement.on === 'function') {
      if (typeof options?.onChange === 'function') {
        paymentElement.on('change', options.onChange);
      }
      if (typeof options?.onReady === 'function') {
        paymentElement.on('ready', options.onReady);
      }
      paymentElement.on('loaderror', function(event) {
        paymentElementLoadError = getStripeElementErrorMessage(event, 'Secure checkout could not load.');
        if (typeof options?.onLoadError === 'function') {
          options.onLoadError(paymentElementLoadError, event);
        }
      });
    }

    paymentElement.mount(paymentContainer);

    return {
      stripe,
      elements,
      supportsLinkAuthenticationElement: false,
      supportsShippingAddressElement: false,
      updateEmail: function() {
        return Promise.resolve({});
      },
      updateShippingAddress: function() {
        return Promise.resolve({});
      },
      confirm: function(params) {
        if (paymentElementLoadError) {
          return Promise.reject(new Error(paymentElementLoadError));
        }
        const confirmParams = params && typeof params === 'object' ? params : {};
        const mergedConfirmParams = {
          return_url: options?.returnUrl || window.location.href,
          ...(confirmParams.confirmParams || {})
        };
        delete mergedConfirmParams.receipt_email;
        return stripe.confirmPayment({
          elements,
          redirect: 'if_required',
          ...confirmParams,
          confirmParams: mergedConfirmParams
        });
      },
      unmount: function() {
        if (typeof paymentElement?.unmount === 'function') {
          paymentElement.unmount();
        }
      }
    };
  }

  const stripeCheckoutSidecar = {
    ensureStripeJs,
    mount: mountCustomCheckout,
    mountPaymentIntent
  };
  window.StoreStripeCheckoutSidecar = stripeCheckoutSidecar;
})();

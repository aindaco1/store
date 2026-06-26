import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('stripe checkout sidecar helper', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
    delete (window as any).StoreStripeCheckoutSidecar;
    delete (window as any).Stripe;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
    delete (window as any).StoreStripeCheckoutSidecar;
    delete (window as any).Stripe;
  });

  it('mounts a payment element and optional shipping address element from Stripe custom checkout using theme vars', async () => {
    document.documentElement.style.setProperty('--store-color-primary', '#654321');
    document.documentElement.style.setProperty('--store-color-primary-hover', '#102f52');
    document.documentElement.style.setProperty('--store-ink-default', '#223344');
    document.documentElement.style.setProperty('--store-ink-strong', '#101820');
    document.documentElement.style.setProperty('--store-ink-muted', '#667788');
    document.documentElement.style.setProperty('--store-ink-soft', '#7a8696');
    document.documentElement.style.setProperty('--store-surface-base', '#fffef9');
    document.documentElement.style.setProperty('--store-surface-subtle', '#f3f0ea');
    document.documentElement.style.setProperty('--store-surface-page', '#ece6dc');
    document.documentElement.style.setProperty('--store-border-default', '#c8bbaa');
    document.documentElement.style.setProperty('--store-border-strong', '#9a8f82');
    document.documentElement.style.setProperty('--store-radius-md', '8px');
    document.documentElement.style.setProperty('--store-font-body', '"Inter", sans-serif');

    const paymentMount = vi.fn();
    const paymentUnmount = vi.fn();
    const linkMount = vi.fn();
    const linkUnmount = vi.fn();
    const shippingMount = vi.fn();
    const shippingUnmount = vi.fn();
    const paymentElement = {
      mount: paymentMount,
      unmount: paymentUnmount
    };
    const linkElement = {
      mount: linkMount,
      unmount: linkUnmount,
      on: vi.fn()
    };
    const shippingElement = {
      mount: shippingMount,
      unmount: shippingUnmount
    };
    const actions = {
      getSession: vi.fn(() => ({ id: 'cs_test_123' })),
      updateEmail: vi.fn(async () => ({})),
      updateShippingAddress: vi.fn(async () => ({})),
      confirm: vi.fn(async () => ({ type: 'success' }))
    };
    const checkout = {
      loadActions: vi.fn(async () => ({ type: 'success', actions })),
      createPaymentElement: vi.fn(() => paymentElement),
      createLinkAuthenticationElement: vi.fn(() => linkElement),
      createShippingAddressElement: vi.fn(() => shippingElement),
      on: vi.fn((eventName, handler) => {
        if (eventName === 'change') {
          handler({ session: { canConfirm: true } });
        }
      })
    };
    const stripeInstance = {
      initCheckout: vi.fn(async () => checkout)
    };
    (window as any).Stripe = vi.fn(() => stripeInstance);

    await import('../../assets/js/stripe-checkout-sidecar.js');

    const paymentContainer = document.createElement('div');
    const linkContainer = document.createElement('div');
    const shippingContainer = document.createElement('div');
    document.body.append(paymentContainer, linkContainer, shippingContainer);

    const result = await (window as any).StoreStripeCheckoutSidecar.mount({
      publishableKey: 'pk_test_123',
      clientSecret: 'cs_test_secret_123',
      paymentContainer,
      linkAuthenticationContainer: linkContainer,
      shippingContainer,
      useShippingAddressElement: true,
      allowedCountries: ['US', 'CA', 'JP'],
      defaultCountry: 'US',
      onLinkChange: vi.fn(),
      onChange: vi.fn()
    });

    expect((window as any).Stripe).toHaveBeenCalledWith('pk_test_123', { locale: 'en' });
    expect(stripeInstance.initCheckout).toHaveBeenCalledWith({
      clientSecret: 'cs_test_secret_123',
      elementsOptions: {
        syncAddressCheckbox: 'shipping',
        appearance: {
          theme: 'flat',
          labels: 'floating',
          variables: {
            colorPrimary: '#654321',
            colorText: '#223344',
            colorTextSecondary: '#667788',
            colorDanger: '#9f1239',
            colorBackground: '#f3f0ea',
            borderRadius: '8px',
            spacingUnit: '4px',
            fontFamily: '"Inter", sans-serif',
            fontSizeBase: '13px',
            fontWeightNormal: '400'
          },
          rules: {
            '.Block': {
              backgroundColor: '#fffef9',
              border: '1px solid #c8bbaa',
              boxShadow: 'none',
              borderRadius: '8px'
            },
            '.Input': {
              backgroundColor: '#fffef9',
              border: '1px solid #c8bbaa',
              boxShadow: 'none',
              color: '#223344',
              fontSize: '13px',
              fontWeight: '400',
              lineHeight: '1.4',
              padding: '10px 12px'
            },
            '.Input::placeholder': {
              color: '#667788'
            },
            '.Input:focus': {
              borderColor: '#654321',
              boxShadow: '0 0 0 1px #654321'
            },
            '.Label': {
              fontWeight: '700',
              color: '#101820',
              fontSize: '12px'
            },
            '.Tab': {
              backgroundColor: '#fffef9',
              border: '1px solid #c8bbaa',
              boxShadow: 'none',
              borderRadius: '8px',
              padding: '12px 14px'
            },
            '.Tab:hover': {
              borderColor: '#9a8f82'
            },
            '.Tab--selected': {
              backgroundColor: '#ece6dc',
              border: '2px solid #654321',
              boxShadow: 'none'
            },
            '.TabLabel': {
              color: '#7a8696',
              fontWeight: '500',
              fontSize: '13px'
            },
            '.TabLabel--selected': {
              color: '#102f52',
              fontWeight: '700'
            },
            '.TabIcon': {
              color: '#7a8696',
              fill: '#7a8696'
            },
            '.TabIcon--selected': {
              color: '#102f52',
              fill: '#102f52'
            }
          }
        }
      }
    });
    expect(checkout.loadActions).toHaveBeenCalledTimes(1);
    expect(checkout.on).toHaveBeenCalledWith('change', expect.any(Function));
    expect(checkout.createPaymentElement).toHaveBeenCalledWith({
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
    expect(paymentMount).toHaveBeenCalledWith(paymentContainer);
    expect(checkout.createLinkAuthenticationElement).toHaveBeenCalledTimes(1);
    expect(linkMount).toHaveBeenCalledWith(linkContainer);
    expect(checkout.createShippingAddressElement).toHaveBeenCalledTimes(1);
    expect(checkout.createShippingAddressElement).toHaveBeenCalledWith({
      allowedCountries: ['US', 'CA', 'JP'],
      defaultValues: {
        address: {
          country: 'US'
        }
      }
    });
    expect(shippingMount).toHaveBeenCalledWith(shippingContainer);
    expect(result.supportsLinkAuthenticationElement).toBe(true);
    expect(result.supportsShippingAddressElement).toBe(true);
    expect(result.session).toEqual({ id: 'cs_test_123' });
    await result.updateEmail('supporter@example.com');
    expect(actions.updateEmail).toHaveBeenCalledWith('supporter@example.com');
    await result.updateShippingAddress({
      name: 'Supporter',
      address: {
        line1: '123 Main',
        city: 'Albuquerque',
        state: 'NM',
        postal_code: '87101',
        country: 'US'
      }
    });
    expect(actions.updateShippingAddress).toHaveBeenCalledWith({
      name: 'Supporter',
      address: {
        line1: '123 Main',
        city: 'Albuquerque',
        state: 'NM',
        postal_code: '87101',
        country: 'US'
      }
    });
    await result.confirm();
    expect(actions.confirm).toHaveBeenCalledWith({ redirect: 'if_required' });

    result.unmount();
    expect(paymentUnmount).toHaveBeenCalledTimes(1);
    expect(linkUnmount).toHaveBeenCalledTimes(1);
    expect(shippingUnmount).toHaveBeenCalledTimes(1);
  });

  it('mounts a PaymentIntent Payment Element and confirms payment with an order return URL', async () => {
    const paymentMount = vi.fn();
    const paymentUnmount = vi.fn();
    const onChange = vi.fn();
    const paymentElement = {
      mount: paymentMount,
      unmount: paymentUnmount,
      on: vi.fn((eventName, handler) => {
        if (eventName === 'change') {
          handler({ complete: true });
        }
      })
    };
    const elements = {
      create: vi.fn(() => paymentElement)
    };
    const stripeInstance = {
      elements: vi.fn(() => elements),
      confirmPayment: vi.fn(async () => ({ paymentIntent: { status: 'succeeded' } }))
    };
    (window as any).Stripe = vi.fn(() => stripeInstance);

    await import('../../assets/js/stripe-checkout-sidecar.js');

    const paymentContainer = document.createElement('div');
    document.body.append(paymentContainer);

    const result = await (window as any).StoreStripeCheckoutSidecar.mountPaymentIntent({
      publishableKey: 'pk_test_123',
      clientSecret: 'pi_test_secret_123',
      paymentContainer,
      returnUrl: 'https://shop.test/order-success/?orderToken=store-order-123',
      onChange
    });

    expect((window as any).Stripe).toHaveBeenCalledWith('pk_test_123', { locale: 'en' });
    expect(stripeInstance.elements).toHaveBeenCalledWith({
      clientSecret: 'pi_test_secret_123',
      appearance: expect.objectContaining({
        theme: 'flat',
        labels: 'floating'
      })
    });
    expect(elements.create).toHaveBeenCalledWith('payment', {
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
    expect(paymentElement.on).toHaveBeenCalledWith('change', onChange);
    expect(onChange).toHaveBeenCalledWith({ complete: true });
    expect(paymentMount).toHaveBeenCalledWith(paymentContainer);
    await expect(result.updateEmail('buyer@example.com')).resolves.toEqual({});
    await expect(result.updateShippingAddress({})).resolves.toEqual({});

    await result.confirm({
      confirmParams: {
        receipt_email: 'buyer@example.com',
        payment_method_data: {
          billing_details: {
            name: 'Buyer Example',
            email: 'buyer@example.com',
            address: {
              line1: '123 Main',
              city: 'Albuquerque',
              state: 'NM',
              postal_code: '87101',
              country: 'US'
            }
          }
        }
      }
    });
    expect(stripeInstance.confirmPayment).toHaveBeenCalledWith({
      elements,
      redirect: 'if_required',
      confirmParams: {
        return_url: 'https://shop.test/order-success/?orderToken=store-order-123',
        receipt_email: 'buyer@example.com',
        payment_method_data: {
          billing_details: {
            name: 'Buyer Example',
            email: 'buyer@example.com',
            address: {
              line1: '123 Main',
              city: 'Albuquerque',
              state: 'NM',
              postal_code: '87101',
              country: 'US'
            }
          }
        }
      }
    });

    expect(result.supportsShippingAddressElement).toBe(false);
    result.unmount();
    expect(paymentUnmount).toHaveBeenCalledTimes(1);
  });

  it('blocks PaymentIntent confirmation after a Payment Element load error', async () => {
    const handlers: Record<string, Function> = {};
    const paymentElement = {
      mount: vi.fn(),
      unmount: vi.fn(),
      on: vi.fn((eventName: string, handler: Function) => {
        handlers[eventName] = handler;
      })
    };
    const elements = {
      create: vi.fn(() => paymentElement)
    };
    const stripeInstance = {
      elements: vi.fn(() => elements),
      confirmPayment: vi.fn(async () => ({ paymentIntent: { status: 'succeeded' } }))
    };
    const onLoadError = vi.fn();
    (window as any).Stripe = vi.fn(() => stripeInstance);

    await import('../../assets/js/stripe-checkout-sidecar.js');

    const paymentContainer = document.createElement('div');
    document.body.append(paymentContainer);

    const result = await (window as any).StoreStripeCheckoutSidecar.mountPaymentIntent({
      publishableKey: 'pk_test_123',
      clientSecret: 'pi_test_secret_123',
      paymentContainer,
      returnUrl: 'https://shop.test/order-success/?orderToken=store-order-123',
      onLoadError
    });

    handlers.loaderror?.({ error: { message: 'The client_secret provided does not match this account.' } });

    expect(onLoadError).toHaveBeenCalledWith(
      'The client_secret provided does not match this account.',
      { error: { message: 'The client_secret provided does not match this account.' } }
    );
    await expect(result.confirm()).rejects.toThrow('The client_secret provided does not match this account.');
    expect(stripeInstance.confirmPayment).not.toHaveBeenCalled();
  });

  it('fails clearly when Stripe custom checkout actions do not load', async () => {
    const checkout = {
      loadActions: vi.fn(async () => ({
        type: 'error',
        error: { message: 'checkout unavailable' }
      })),
      createPaymentElement: vi.fn()
    };
    const stripeInstance = {
      initCheckout: vi.fn(async () => checkout)
    };
    (window as any).Stripe = vi.fn(() => stripeInstance);

    await import('../../assets/js/stripe-checkout-sidecar.js');

    const paymentContainer = document.createElement('div');
    document.body.append(paymentContainer);

    await expect((window as any).StoreStripeCheckoutSidecar.mount({
      publishableKey: 'pk_test_123',
      clientSecret: 'cs_test_secret_123',
      paymentContainer
    })).rejects.toThrow('checkout unavailable');
  });

  it('skips the Stripe shipping address element by default', async () => {
    const paymentElement = {
      mount: vi.fn(),
      unmount: vi.fn()
    };
    const checkout = {
      loadActions: vi.fn(async () => ({
        type: 'success',
        actions: {
          getSession: vi.fn(() => ({ id: 'cs_test_456' })),
          confirm: vi.fn(async () => ({ type: 'success' }))
        }
      })),
      createPaymentElement: vi.fn(() => paymentElement),
      createShippingAddressElement: vi.fn(() => ({
        mount: vi.fn(),
        unmount: vi.fn()
      })),
      on: vi.fn()
    };
    const stripeInstance = {
      initCheckout: vi.fn(async () => checkout)
    };
    (window as any).Stripe = vi.fn(() => stripeInstance);

    await import('../../assets/js/stripe-checkout-sidecar.js');

    const paymentContainer = document.createElement('div');
    const shippingContainer = document.createElement('div');
    document.body.append(paymentContainer, shippingContainer);

    const result = await (window as any).StoreStripeCheckoutSidecar.mount({
      publishableKey: 'pk_test_123',
      clientSecret: 'cs_test_secret_123',
      paymentContainer,
      shippingContainer
    });

    expect(checkout.createShippingAddressElement).not.toHaveBeenCalled();
    expect(result.supportsShippingAddressElement).toBe(false);
  });

  it('loads Stripe.js once when it is not already present', async () => {
    await import('../../assets/js/stripe-checkout-sidecar.js');

    const ensurePromise = (window as any).StoreStripeCheckoutSidecar.ensureStripeJs();
    const injectedScript = document.querySelector('script[data-store-stripe-js="true"]') as HTMLScriptElement | null;

    expect(injectedScript).toBeTruthy();
    expect(injectedScript?.dataset.storeStripeJs).toBe('true');
    (window as any).Stripe = vi.fn();
    injectedScript?.dispatchEvent(new Event('load'));

    await expect(ensurePromise).resolves.toBe((window as any).Stripe);
  });
});

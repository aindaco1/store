import '../../shared/dust-wave-platform/packages/site-shell/src/script-loader-browser.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Store Stripe script lifecycle', () => {
  const selector = 'script[data-store-stripe-js="true"]';
  beforeEach(async () => {
    vi.resetModules();
    document.querySelectorAll(selector).forEach(node => node.remove());
    delete (window as any).Stripe;
    delete (window as any).StoreStripeCheckoutSidecar;
    await import('../../assets/js/stripe-checkout-sidecar.js');
  });
  afterEach(() => {
    document.querySelectorAll(selector).forEach(node => node.remove());
    delete (window as any).Stripe;
    delete (window as any).StoreStripeCheckoutSidecar;
  });
  const ensure = () => (window as any).StoreStripeCheckoutSidecar.ensureStripeJs();

  it('uses an available SDK without adding a script', async () => {
    const sdk = () => {};
    (window as any).Stripe = sdk;
    await expect(ensure()).resolves.toBe(sdk);
    expect(document.querySelector(selector)).toBeNull();
  });

  it('shares an in-flight request across concurrent callers', async () => {
    const first = ensure();
    const second = ensure();
    expect(second).toBe(first);
    expect(document.querySelectorAll(selector)).toHaveLength(1);
    const script = document.querySelector(selector) as HTMLScriptElement;
    expect(script.src).toBe('https://js.stripe.com/clover/stripe.js');
    expect(script.async).toBe(true);
    const sdk = () => {};
    (window as any).Stripe = sdk;
    script.dispatchEvent(new Event('load'));
    await expect(first).resolves.toBe(sdk);
    await expect(second).resolves.toBe(sdk);
  });

  it('joins a matching script already being loaded', async () => {
    const script = document.createElement('script');
    script.setAttribute('data-store-stripe-js', 'true');
    document.head.append(script);
    const promise = ensure();
    expect(document.querySelectorAll(selector)).toHaveLength(1);
    (window as any).Stripe = () => {};
    script.dispatchEvent(new Event('load'));
    await expect(promise).resolves.toBe((window as any).Stripe);
  });

  it.each(['error', 'load'])('permits retry after %s without retaining the failed tag', async event => {
    const first = ensure();
    const second = ensure();
    const outcomes = Promise.allSettled([first, second]);
    const failed = document.querySelector(selector)!;
    failed.dispatchEvent(new Event(event));
    const results = await outcomes;
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect((results[0] as PromiseRejectedResult).reason.message).toBe(event === 'error'
      ? 'Failed to load Stripe.js.' : 'Stripe.js loaded without exposing Stripe.');
    expect(failed.isConnected).toBe(false);
    const retry = ensure();
    const replacement = document.querySelector(selector)!;
    expect(replacement).not.toBe(failed);
    (window as any).Stripe = () => {};
    replacement.dispatchEvent(new Event('load'));
    await expect(retry).resolves.toBe((window as any).Stripe);
  });
});

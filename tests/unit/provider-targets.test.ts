import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { findRequiredStripeWebhook, resolveProviderTargets } from '../../scripts/lib/provider-targets.mjs';

describe('release provider targets', () => {
  it('lets explicit release targets override checked-in local Wrangler values', () => {
    expect(resolveProviderTargets({
      siteBaseOverride: ' https://shop.dustwave.xyz ',
      workerBaseOverride: ' https://checkout.dustwave.xyz ',
      vars: {
        SITE_BASE: 'http://127.0.0.1:4002',
        WORKER_BASE: 'http://127.0.0.1:8989'
      },
      stagingVars: { WORKER_BASE: 'https://store-worker-staging.jogo.workers.dev' }
    })).toEqual({
      siteBase: 'https://shop.dustwave.xyz',
      workerBase: 'https://checkout.dustwave.xyz',
      testWorkerBase: 'https://store-worker-staging.jogo.workers.dev'
    });
  });

  it('keeps an explicit Stripe test target isolated from production', () => {
    expect(resolveProviderTargets({
      stripeTestWebhookBase: 'https://stripe-test.example.workers.dev',
      vars: { WORKER_BASE: 'https://checkout.dustwave.xyz' },
      stagingVars: { WORKER_BASE: 'https://staging.example.workers.dev' }
    }).testWorkerBase).toBe('https://stripe-test.example.workers.dev');
  });

  it('prefers canonical production origins over localhost-safe runtime defaults', () => {
    expect(resolveProviderTargets({
      vars: {
        SITE_BASE: 'http://127.0.0.1:4002',
        WORKER_BASE: 'http://127.0.0.1:8989',
        CANONICAL_SITE_BASE: 'https://shop.dustwave.xyz',
        CANONICAL_WORKER_BASE: 'https://checkout.dustwave.xyz'
      }
    })).toEqual({
      siteBase: 'https://shop.dustwave.xyz',
      workerBase: 'https://checkout.dustwave.xyz',
      testWorkerBase: 'https://checkout.dustwave.xyz'
    });
  });

  it('uses safe production defaults when no configuration is available', () => {
    expect(resolveProviderTargets()).toEqual({
      siteBase: 'https://shop.dustwave.xyz',
      workerBase: 'https://checkout.dustwave.xyz',
      testWorkerBase: 'https://checkout.dustwave.xyz'
    });
  });

  it('pins both production origins in the provider-evidence workflow', () => {
    const workflow = readFileSync('.github/workflows/release-provider-evidence.yml', 'utf8');
    expect(workflow).toContain('SITE_BASE: https://shop.dustwave.xyz');
    expect(workflow).toContain('WORKER_BASE: https://checkout.dustwave.xyz');
  });
});


describe('Stripe webhook release readiness', () => {
  const workerBase = 'https://checkout.example.com';
  const endpoint = {
    url: `${workerBase}/webhooks/stripe`,
    status: 'enabled',
    livemode: true,
    enabled_events: ['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled']
  };

  it('requires cancellation delivery as well as payment success and failure', () => {
    expect(findRequiredStripeWebhook([endpoint], `${workerBase}/`, { livemode: true })).toBe(endpoint);
    for (const missing of endpoint.enabled_events) {
      expect(findRequiredStripeWebhook([{ ...endpoint, enabled_events: endpoint.enabled_events.filter(event => event !== missing) }], workerBase)).toBeUndefined();
    }
  });

  it('accepts an all-events subscription', () => {
    const wildcard = { ...endpoint, enabled_events: ['*'] };
    expect(findRequiredStripeWebhook([wildcard], workerBase)).toBe(wildcard);
  });

  it('rejects disabled, wrong-origin and wrong-mode endpoints', () => {
    expect(findRequiredStripeWebhook([{ ...endpoint, status: 'disabled' }], workerBase)).toBeUndefined();
    expect(findRequiredStripeWebhook([endpoint], 'https://another.example.com')).toBeUndefined();
    expect(findRequiredStripeWebhook([endpoint], workerBase, { livemode: false })).toBeUndefined();
    expect(findRequiredStripeWebhook([], workerBase)).toBeUndefined();
  });
});

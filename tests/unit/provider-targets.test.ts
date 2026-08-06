import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { resolveProviderTargets } from '../../scripts/lib/provider-targets.mjs';

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

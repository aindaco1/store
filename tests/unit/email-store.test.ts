import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  sendAdminLoginEmail,
  sendAdminUserCreatedEmail,
  sendStoreOrderEmail,
  sendStoreOrderLookupEmail
} from '../../worker/src/email.js';

const env = {
  RESEND_API_KEY: 'test_resend_key',
  SITE_BASE: 'https://shop.test',
  PLATFORM_NAME: 'Simply Store',
  SUPPORT_EMAIL: 'orders@shop.test',
  ORDERS_EMAIL_FROM: 'Simply Store <orders@shop.test>',
  UPDATES_EMAIL_FROM: 'Simply Store <updates@shop.test>',
  I18N_CATALOG_JSON: JSON.stringify({ en: { email: {} } })
};

function mockResend(response: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'email_test_123', ...response }),
    text: async () => '',
    init
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function getEmailPayload(fetchMock: ReturnType<typeof mockResend>) {
  const [, init] = fetchMock.mock.calls.at(-1) || [];
  return JSON.parse(String(init?.body || '{}'));
}

describe('Store email integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends escaped Store order confirmations with themed payload metadata', async () => {
    const fetchMock = mockResend();

    await sendStoreOrderEmail(env, {
      email: 'customer@example.com',
      orderToken: 'store-order-demo123',
      orderDraft: {
        orderToken: 'store-order-demo123',
        preferredLang: 'en',
        totals: {
          subtotalCents: 3000,
          tipPercent: 5,
          tipAmountCents: 150,
          shippingCents: 500,
          taxCents: 267,
          totalCents: 3917,
          requiresShipping: true
        },
        fulfillment: { requiresShipping: true },
        shippingAddress: {
          name: 'Ada',
          line1: '100 Central Ave',
          city: 'Albuquerque',
          state: 'NM',
          postalCode: '87102',
          country: 'US'
        },
        items: [{
          name: '<img src=x onerror=alert(1)>',
          variantLabel: '<script>alert(2)</script>',
          quantity: 2,
          subtotalCents: 3000,
          fulfillmentType: 'physical',
          shippable: true,
          url: 'javascript:alert(3)'
        }]
      }
    });

    const payload = getEmailPayload(fetchMock);
    expect(payload.from).toBe('Simply Store <orders@shop.test>');
    expect(payload.reply_to).toBe('orders@shop.test');
    expect(payload.subject).toBe('Order confirmed | Simply Store');
    expect(payload.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(payload.html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
    expect(payload.html).not.toContain('javascript:alert(3)');
    expect(payload.html).toContain('$1.50');
    expect(payload.html).toContain('https://shop.test/order-success/?orderToken=store-order-demo123');
    expect(payload.text).toContain('Order confirmed');
  });

  it('surfaces sanitized Resend provider errors for platform-branded order emails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        message: 'The sender domain is not verified.',
        name: 'validation_error'
      }),
      text: async () => ''
    })));

    await expect(sendStoreOrderEmail(env, {
      email: 'customer@example.com',
      orderToken: 'store-order-demo123',
      orderDraft: {
        totals: { totalCents: 1000 },
        items: []
      }
    })).rejects.toThrow('Failed to send Simply Store order email: 403 (The sender domain is not verified. validation_error)');
  });

  it('uses update sender for admin login emails and keeps bad URLs out of the CTA', async () => {
    const fetchMock = mockResend();

    await expect(sendAdminLoginEmail(env, {
      email: 'admin@example.com',
      loginUrl: 'javascript:alert(1)',
      lang: 'en'
    })).resolves.toEqual({ sent: true });

    const payload = getEmailPayload(fetchMock);
    expect(payload.from).toBe('Simply Store <updates@shop.test>');
    expect(payload.subject).toBe('Your admin sign-in link | Simply Store');
    expect(payload.html).not.toContain('javascript:alert(1)');
  });

  it('sends Store order lookup links through the order sender', async () => {
    const fetchMock = mockResend();

    await expect(sendStoreOrderLookupEmail(env, {
      email: 'customer@example.com',
      lookupUrl: 'https://shop.test/orders/?token=lookup-token',
      orderCount: 2,
      preferredLang: 'en'
    })).resolves.toEqual({ sent: true });

    const payload = getEmailPayload(fetchMock);
    expect(payload.from).toBe('Simply Store <orders@shop.test>');
    expect(payload.reply_to).toBe('orders@shop.test');
    expect(payload.subject).toBe('Order lookup link | Simply Store');
    expect(payload.html).toContain('https://shop.test/orders/?token=lookup-token');
    expect(payload.html).toContain('This link expires after one use.');
    expect(payload.text).toContain('Find your order');
  });

  it('returns a skipped result for admin user notices when Resend is not configured', async () => {
    await expect(sendAdminUserCreatedEmail({
      ...env,
      RESEND_API_KEY: ''
    }, {
      email: 'new-admin@example.com',
      role: 'limited_admin',
      accessNames: ['Store']
    })).resolves.toEqual({
      sent: false,
      reason: 'RESEND_API_KEY not configured'
    });
  });
});

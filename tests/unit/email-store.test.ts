import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  sendAdminLoginEmail,
  sendAdminUserCreatedEmail,
  sendStoreAbandonedCartEmail,
  sendStoreEventReminderEmail,
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
  EMAIL_COLOR_PRIMARY: '#000000',
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
      },
      attachments: [{
        filename: 'ticket.ics',
        content: 'QkVHSU46VkNBTEVOREFS'
      }]
    });

    const payload = getEmailPayload(fetchMock);
    expect(payload.from).toBe('Simply Store <orders@shop.test>');
    expect(payload.reply_to).toBe('orders@shop.test');
    expect(payload.subject).toBe('Order confirmed | Simply Store');
    expect(payload.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(payload.html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
    expect(payload.html).not.toContain('javascript:alert(3)');
    expect(payload.html).toContain('$1.50');
    expect(payload.html).toContain('Event tickets, check-in QR codes, and calendar files are attached when available.');
    expect(payload.html).toContain('https://shop.test/order-success/?orderToken=store-order-demo123');
    expect(payload.attachments).toEqual([{
      filename: 'ticket.ics',
      content: 'QkVHSU46VkNBTEVOREFS'
    }]);
    expect(payload.html).toContain('color: #ffffff');
    expect(payload.text).toContain('Order confirmed');
  });

  it('brands Store emails with the configured company and platform name when both are set', async () => {
    const fetchMock = mockResend();

    await sendStoreOrderEmail({
      ...env,
      PLATFORM_COMPANY_NAME: 'Dust & Wave',
      PLATFORM_NAME: 'Shop'
    }, {
      email: 'customer@example.com',
      orderToken: 'store-order-demo123',
      orderDraft: {
        totals: { totalCents: 1000 },
        items: []
      }
    });

    const payload = getEmailPayload(fetchMock);
    expect(payload.subject).toBe('Order confirmed | Dust & Wave Shop');
    expect(payload.html).toContain('Dust &amp; Wave Shop');
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
    expect(payload.subject).toBe('Admin sign-in link | Simply Store');
    expect(payload.html).not.toContain('javascript:alert(1)');
  });

  it('renders admin login emails with Pool-style layout and an email-safe logo URL', async () => {
    const fetchMock = mockResend();

    await expect(sendAdminLoginEmail({
      ...env,
      EMAIL_LOGO_PATH: '/assets/images/defaults/dust-wave-square.png'
    }, {
      email: 'admin@example.com',
      loginUrl: 'https://shop.test/admin/?admin_login=magic-token',
      lang: 'en'
    })).resolves.toEqual({ sent: true });

    const payload = getEmailPayload(fetchMock);
    expect(payload.html).toContain('max-width: 600px; margin: 0 auto; padding: 20px;');
    expect(payload.html).toContain('text-align: center; margin-bottom: 32px;');
    expect(payload.html).toContain('src="https://shop.test/assets/images/defaults/dust-wave-square.png"');
    expect(payload.html).toContain('href="https://shop.test/admin/?admin_login=magic-token"');
    expect(payload.html).toContain('This link works for 15 minutes.');
  });

  it('does not embed SVG logos in email clients', async () => {
    const fetchMock = mockResend();

    await expect(sendAdminLoginEmail({
      ...env,
      EMAIL_LOGO_PATH: '/assets/images/logo.svg'
    }, {
      email: 'admin@example.com',
      loginUrl: 'https://shop.test/admin/?admin_login=magic-token',
      lang: 'en'
    })).resolves.toEqual({ sent: true });

    const payload = getEmailPayload(fetchMock);
    expect(payload.html).not.toContain('/assets/images/logo.svg');
    expect(payload.html).not.toContain('<img');
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
    expect(payload.subject).toBe('Find your order | Simply Store');
    expect(payload.html).toContain('https://shop.test/orders/?token=lookup-token');
    expect(payload.html).toContain('This link works once.');
    expect(payload.text).toContain('Find your order');
  });

  it('sends abandoned checkout reminders with unsubscribe headers', async () => {
    const fetchMock = mockResend();

    await expect(sendStoreAbandonedCartEmail(env, {
      email: 'customer@example.com',
      resumeUrl: 'https://shop.test/?checkoutResume=token',
      amountCents: 2500,
      itemCount: 2,
      unsubscribeUrl: 'https://checkout.test/abandoned-cart/unsubscribe?t=token',
      preferredLang: 'en'
    })).resolves.toEqual({ sent: true });

    const payload = getEmailPayload(fetchMock);
    expect(payload.from).toBe('Simply Store <updates@shop.test>');
    expect(payload.subject).toBe('Finish your checkout | Simply Store');
    expect(payload.headers).toMatchObject({
      'List-Unsubscribe': '<https://checkout.test/abandoned-cart/unsubscribe?t=token>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    });
    expect(payload.html).toContain('2 items in your cart');
    expect(payload.html).toContain('Estimated total: $25.00');
    expect(payload.html).toContain('Finish checkout');
  });

  it('sends event reminders with order CTA and event attachments', async () => {
    const fetchMock = mockResend();

    await expect(sendStoreEventReminderEmail(env, {
      email: 'customer@example.com',
      orderToken: 'store-order-event123',
      orderUrl: 'https://shop.test/order-success/?orderToken=store-order-event123',
      eventTitle: 'DANCEWAVE',
      eventTime: 'Sat, Sep 6, 2026, 8:00 PM MDT',
      venue: 'Sund Brewery',
      address: '4501 1st St NW, Albuquerque, NM',
      reminderLabel: '1 day before',
      preferredLang: 'en',
      attachments: [{
        filename: 'dancewave-check-in-qr.svg',
        content: 'PHN2Zz48L3N2Zz4='
      }]
    })).resolves.toEqual({ sent: true });

    const payload = getEmailPayload(fetchMock);
    expect(payload.from).toBe('Simply Store <updates@shop.test>');
    expect(payload.subject).toBe('Event reminder | DANCEWAVE | Simply Store');
    expect(payload.html).toContain('DANCEWAVE is coming up');
    expect(payload.html).toContain('This is your 1 day before reminder.');
    expect(payload.html).toContain('Sund Brewery, 4501 1st St NW, Albuquerque, NM');
    expect(payload.html).toContain('https://shop.test/order-success/?orderToken=store-order-event123');
    expect(payload.attachments).toEqual([{
      filename: 'dancewave-check-in-qr.svg',
      content: 'PHN2Zz48L3N2Zz4='
    }]);
  });

  it('sends admin access emails with direct instructions and footer copy', async () => {
    const fetchMock = mockResend();

    await expect(sendAdminUserCreatedEmail(env, {
      email: 'new-admin@example.com',
      name: 'Ada',
      role: 'limited_admin',
      accessNames: ['Products', 'Orders'],
      createdBy: 'owner@example.com',
      lang: 'en'
    })).resolves.toEqual({ sent: true });

    const payload = getEmailPayload(fetchMock);
    expect(payload.subject).toBe('Admin access added | Simply Store');
    expect(payload.html).toContain('You now have limited admin access to Simply Store.');
    expect(payload.html).toContain('To sign in, open admin and enter this email address. We will send you a magic link.');
    expect(payload.html).toContain('Not expecting this access? Ignore this email or contact the site owner.');
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

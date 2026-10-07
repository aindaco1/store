import { describe, expect, it, vi } from 'vitest';
import { validateStoreOrderDraft } from '../../worker/src/catalog.js';
import { buildStoreOrderDraft, hashStoreOrderDraft } from '../../worker/src/orders.js';
import { applyStoreCouponToValidation } from '../../worker/src/coupons.js';
import { normalizeProductPricing } from '../../worker/src/product-pricing.js';
import { sendStoreOrderEmail } from '../../worker/src/email.js';
import { applyAdminStoreProductPatchToMarkdown, normalizeAdminStoreProductPublishBody, buildAdminStoreProductPreviewHtml } from '../../worker/src/index.js';
import catalog from '../../worker/src/generated/catalog-snapshot.js';

const product = catalog.products.find((p) => p.id === 'support-paradiso')!;
const item = (amount = 2537) => ({ id: product.id, quantity: 1, price: amount / 100, customAmountCents: amount });

describe('pay what you want', () => {
  it('publishes the approved contribution configuration', () => {
    expect(product).toMatchObject({ pricing_mode: 'pay_what_you_want', suggested_amounts: [10, 25, 50, 100], fulfillment_type: 'service', tax_category: 'standard', inventory_tracking: false });
    expect(normalizeProductPricing(product).errors).toEqual([]);
  });

  it.each([50, 1000, 2500, 5000, 10000, 2537, 100000000])('accepts %i cents as canonical order money', (amount) => {
    const validation = validateStoreOrderDraft({ items: [item(amount)] });
    expect(validation.valid).toBe(true);
    expect(validation.items[0]).toMatchObject({ unitPriceCents: amount, subtotalCents: amount, quantity: 1, pricingMode: 'pay_what_you_want', shippable: false, fulfillmentType: 'service', taxCategory: 'standard', eventDetails: null, download: null });
  });

  it.each([undefined, null, '', '2500', 0, -1, 49, 50.5, NaN, Infinity, 100000001])('rejects invalid submitted cents %s even when ordinary price checks are disabled', (amount) => {
    const validation = validateStoreOrderDraft({ items: [{ ...item(), customAmountCents: amount }] }, { enforceSubmittedPrices: false });
    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid_contribution_amount' })]));
  });

  it('rejects quantity multiplication, mismatched displayed amounts, and custom prices on fixed products', () => {
    expect(validateStoreOrderDraft({ items: [{ ...item(), quantity: 2 }] }).valid).toBe(false);
    expect(validateStoreOrderDraft({ items: [{ ...item(), price: 10 }] }).valid).toBe(false);
    expect(validateStoreOrderDraft({ items: [{ id: 'download-1', quantity: 1, price: 5, customAmountCents: 100 }] }).valid).toBe(false);
    expect(validateStoreOrderDraft({ items: [item(100000000), item(50)] }).valid).toBe(false);
  });

  it('fails closed for an unavailable product and unsupported pricing configuration', () => {
    for (const overrides of [{ status: 'draft' }, { pricing_mode: 'unknown' }, { fulfillment_type: 'ticket' }, { inventory_tracking: true }, { currency: 'EUR' }, { variants: [{ id: 'a' }] }, { suggested_amounts: [0] }]) {
      expect(validateStoreOrderDraft({ items: [item()] }, { snapshot: { ...catalog, products: [{ ...product, ...overrides }] } }).valid).toBe(false);
    }
  });

  it.each(['cart', 'products'])('excludes contributions from %s coupons while discounting eligible ordinary items', (appliesTo) => {
    const validation = validateStoreOrderDraft({ items: [item(), { id: 'download-1', quantity: 1, price: 5 }] });
    const coupon = { code: 'TEST', appliesTo, productIds: [product.id, 'download-1'], discountType: 'percent', percentOff: 100 };
    const result = applyStoreCouponToValidation(validation, coupon);
    expect(result.ok).toBe(true);
    expect(result.discountCents).toBe(500);
    expect(result.validation.items[0]).toMatchObject({ subtotalCents: 2537, discountCents: 0, discountedSubtotalCents: 2537 });
    expect(applyStoreCouponToValidation(validateStoreOrderDraft({ items: [item()] }), coupon).ok).toBe(false);
  });

  it('defaults tips to zero, respects an explicit tip, and binds the chosen amount into the payment hash', async () => {
    const options = { orderToken: 'store-order-contribution', taxCents: 194, env: { DEFAULT_PLATFORM_TIP_PERCENT: '5' } };
    const result = buildStoreOrderDraft({ items: [item()] }, options);
    expect(result.ok).toBe(true);
    expect(result.orderDraft.totals).toMatchObject({ subtotalCents: 2537, tipPercent: 0, tipAmountCents: 0, taxCents: 194, totalCents: 2731, requiresShipping: false, requiresPayment: true });
    expect(result.orderDraft.items[0]).toMatchObject({ pricingMode: 'pay_what_you_want', unitPriceCents: 2537 });
    const tipped = buildStoreOrderDraft({ items: [item()], tipPercent: 5 }, options);
    expect(tipped.orderDraft.totals.tipAmountCents).toBe(127);
    const changed = buildStoreOrderDraft({ items: [item(5000)] }, options);
    expect(await hashStoreOrderDraft(changed.orderDraft)).not.toBe(await hashStoreOrderDraft(result.orderDraft));
  });

  it('round trips pricing through the same admin repository patch and previews the amount controls', () => {
    const normalized = normalizeAdminStoreProductPublishBody({ intent: 'publish', productId: product.id, fields: { pricingMode: 'pay_what_you_want', suggestedAmounts: [10, 25, 50, 100], price: 10 }, variants: [] });
    expect(normalized.ok).toBe(true);
    const patched = applyAdminStoreProductPatchToMarkdown('---\nidentifier: support-paradiso\nprice: 5\n---\nSupport copy.\n', normalized.patch);
    expect(patched.content).toContain('pricing_mode: "pay_what_you_want"');
    expect(patched.content).toContain('suggested_amounts: [10,25,50,100]');
    const preview = buildAdminStoreProductPreviewHtml(product, {});
    expect(preview).toContain('Pay what you want');
    expect(preview).toContain('Your amount (USD)');
    expect(preview).not.toContain('Decrease quantity');
  });

  it('renders the stored contribution amount in the confirmation email', async () => {
    const { orderDraft } = buildStoreOrderDraft({ items: [item()] }, { orderToken: 'store-order-contribution' });
    const fetchMock = vi.fn(async () => Response.json({ id: 'email_fixture' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await sendStoreOrderEmail({
        RESEND_API_KEY: 'fixture_resend_key', SITE_BASE: 'https://shop.test',
        ORDERS_EMAIL_FROM: 'Store <orders@shop.test>', I18N_CATALOG_JSON: JSON.stringify({ en: { email: {} } })
      }, { email: 'fixture@example.com', orderToken: 'store-order-contribution', orderDraft });
      const payload = JSON.parse(String((fetchMock.mock.calls.at(-1) as any)?.[1]?.body));
      expect(payload.html).toContain('$25.37');
      expect(payload.text).toContain('$25.37');
      expect(payload.html).toContain('Support Paradiso');
      expect(payload.attachments || []).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([{ fulfillmentType: 'physical' }, { inventoryTracking: true }, { pricingMode: 'anything' }, { suggestedAmounts: [10, 10] }, { suggestedAmounts: [10.001] }, { suggestedAmounts: false }])('rejects invalid admin pricing changes %j', (fields) => {
    expect(normalizeAdminStoreProductPublishBody({ intent: 'publish', productId: product.id, fields }).ok).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { parseSnipcartOrdersCsv } from '../../worker/src/snipcart-import.js';

const HEADER = [
  'Invoice number',
  'Customer name',
  'Customer email',
  'Customer phone',
  'Order date',
  'Order status',
  'Currency',
  'Payment status',
  'Quantity of items',
  'Sub total',
  'Grand total',
  'Adjusted total',
  'Refunds amount',
  'Discounts total',
  'Taxes total',
  'Shipping fees',
  'Shipping method',
  'Ship to the billing address',
  'Company name',
  'Billing address',
  'Billing address 2',
  'Billing address city',
  'Billing address province/state',
  'Billing address postal code',
  'Billing address country',
  'Ship to',
  'Ship to company',
  'Shipping address',
  'Shipping address 2',
  'Shipping address city',
  'Shipping address province/state',
  'Shipping address postal code',
  'Shipping address country',
  'Order discounts',
  'Token',
  'Payment Method',
  'Payment Gateway Used',
  'Metadata',
  'PaymentGatewayTransactionId',
  'Taxes',
  'ABQ Tax Rate',
  'Item ID',
  'Item name',
  'Item description',
  'Item url',
  'Unit price',
  'Quantity',
  'Total price',
  'Total Weight',
  '',
  'Type',
  'Size'
];

function csvEscape(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function row(overrides: Record<string, string>) {
  const base: Record<string, string> = {
    'Invoice number': 'SNIP-1001',
    'Customer name': 'Test Buyer',
    'Customer email': 'buyer@example.com',
    'Customer phone': '555-0100',
    'Order date': '2024-01-02 03:04:05',
    'Order status': 'Processed',
    Currency: 'usd',
    'Payment status': 'Paid',
    'Quantity of items': '1',
    'Sub total': '35.00',
    'Grand total': '43.67',
    'Adjusted total': '43.67',
    'Refunds amount': '0.00',
    'Discounts total': '0',
    'Taxes total': '2.67',
    'Shipping fees': '6.00',
    'Shipping method': 'USPS 1st Class Package',
    'Ship to the billing address': 'true',
    'Billing address': '123 Test St',
    'Billing address 2': '',
    'Billing address city': 'Albuquerque',
    'Billing address province/state': 'NM',
    'Billing address postal code': '87102',
    'Billing address country': 'US',
    'Ship to': 'Test Buyer',
    'Shipping address': '123 Test St',
    'Shipping address 2': '',
    'Shipping address city': 'Albuquerque',
    'Shipping address province/state': 'NM',
    'Shipping address postal code': '87102',
    'Shipping address country': 'US',
    Token: 'legacy-token-1001',
    'Payment Method': 'CreditCard',
    'Payment Gateway Used': 'Stripe',
    PaymentGatewayTransactionId: 'txn_123',
    'Item ID': 't-shirt-1',
    'Item name': 'DUST WAVE T-Shirt',
    'Item description': 'Black shirt',
    'Item url': 'https://example.test/products/dust-wave-t-shirt',
    'Unit price': '35.00',
    Quantity: '1',
    'Total price': '35.00',
    Type: '',
    Size: 'M'
  };
  const values = HEADER.map((header) => csvEscape(overrides[header] ?? base[header] ?? ''));
  return values.join(',');
}

function fixture(rows: string[]) {
  return `${HEADER.join(',')}\n${rows.join('\n')}`;
}

describe('Snipcart order import mapping', () => {
  it('groups Snipcart line items into one confirmed Store order', () => {
    const result = parseSnipcartOrdersCsv(fixture([
      row({ 'Item ID': 'sticker-1', 'Item name': 'DUST WAVE Sticker', 'Unit price': '3.00', Quantity: '2', 'Total price': '6.00', Size: '' }),
      row({ 'Item ID': 't-shirt-1', 'Item name': 'DUST WAVE T-Shirt', 'Unit price': '29.00', Quantity: '1', 'Total price': '29.00', Size: 'M' })
    ]), { importedAt: '2026-06-23T12:00:00.000Z' });

    expect(result.ok).toBe(true);
    expect(result.rowCount).toBe(2);
    expect(result.orderCount).toBe(1);
    expect(result.orders[0]).toMatchObject({
      orderToken: 'store-order-snipcart-snip-1001',
      checkoutProvider: 'snipcart',
      status: 'confirmed',
      payment: {
        provider: 'snipcart',
        status: 'succeeded',
        amountCents: 4367
      },
      orderDraft: {
        currency: 'USD',
        totals: {
          itemCount: 3,
          subtotalCents: 3500,
          shippingCents: 600,
          taxCents: 267,
          totalCents: 4367,
          requiresShipping: true
        }
      }
    });
    expect(result.orders[0].orderDraft.items).toHaveLength(2);
    expect(result.orders[0].orderDraft.items[1]).toMatchObject({
      sku: 't-shirt-1',
      variantLabel: 'M',
      fulfillmentType: 'physical',
      shippingPreset: 'tshirt'
    });
  });

  it('uses adjusted totals and preserves legacy adjustment warnings', () => {
    const result = parseSnipcartOrdersCsv(fixture([
      row({
        'Invoice number': 'SNIP-1002',
        Token: 'legacy-token-1002',
        'Sub total': '25.00',
        'Grand total': '27.00',
        'Adjusted total': '5.45',
        'Refunds amount': '21.55',
        'Discounts total': '-5.00',
        'Shipping fees': '0.00',
        'Shipping method': '',
        'Item ID': 'benefit-1',
        'Item name': 'A Dust Wave Benefit at Studio 123!',
        'Unit price': '25.00',
        Quantity: '1',
        'Total price': '25.00',
        Type: 'Early Bird',
        Size: ''
      })
    ]));

    expect(result.ok).toBe(true);
    expect(result.orders[0].payment.amountCents).toBe(545);
    expect(result.orders[0].orderDraft.totals).toMatchObject({
      discountCents: 500,
      refundCents: 2155,
      adjustedTotalCents: 545,
      totalCents: 545,
      requiresShipping: false
    });
    expect(result.orders[0].orderDraft.items[0]).toMatchObject({
      fulfillmentType: 'legacy',
      taxCategory: 'admission',
      variantLabel: 'Early Bird'
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ warning: 'legacy_adjustments_present' })
    ]));
  });

  it('rejects files missing required Snipcart columns', () => {
    const result = parseSnipcartOrdersCsv('Invoice number,Customer email\nSNIP-1,buyer@example.com\n');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.missingHeaders).toContain('Token');
    expect(result.missingHeaders).toContain('Item name');
  });
});

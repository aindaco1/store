import { describe, expect, it } from 'vitest';
import { storeOrderReconciliationRowsCsv } from '../../worker/src/index.js';

describe('Store reconciliation CSV', () => {
  it('includes Stripe card verification checks and financial ids', () => {
    const csv = storeOrderReconciliationRowsCsv([{
      orderToken: 'store-order-cvc-check',
      status: 'confirmed',
      createdAt: '2026-06-30T22:45:49.410Z',
      confirmedAt: '2026-06-30T22:46:09.748Z',
      customer: {
        email: 'buyer@example.com',
        name: 'Buyer Example'
      },
      totals: {
        totalCents: 14612,
        currency: 'USD'
      },
      payment: {
        required: true,
        provider: 'stripe',
        status: 'succeeded',
        amountCents: 14612,
        currency: 'USD',
        paymentIntentId: 'pi_test',
        chargeId: 'ch_test',
        balanceTransactionId: 'txn_test',
        cardChecks: {
          addressLine1Check: 'pass',
          addressPostalCodeCheck: 'pass',
          cvcCheck: 'fail',
          networkStatus: 'approved_by_network',
          riskLevel: 'normal',
          outcomeType: 'authorized'
        }
      },
      emailSent: false,
      fulfillmentTypes: ['physical'],
      counts: {
        physicalItems: 4,
        digitalItems: 0,
        ticketItems: 0,
        checkedInItems: 0
      }
    }]);

    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('balance_transaction_id,card_address_line1_check,card_address_postal_code_check,card_cvc_check');
    expect(lines[1]).toContain('pi_test,ch_test,txn_test,pass,pass,fail,approved_by_network,normal,authorized');
    expect(lines[1]).toContain(',no,');
  });
});

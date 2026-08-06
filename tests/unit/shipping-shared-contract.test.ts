import { describe, expect, it } from 'vitest';

import {
  getAddOnShippingProfile,
  getSelectedShippingOptionDetails,
  getSupportItemShippingProfile,
  getTierShippingProfile,
  resolveSelectedShippingOption,
  summarizeStoreShipmentSelection
} from '../../worker/src/shipping.js';

const shipping = {
  weight_oz: 4,
  length_in: 12,
  width_in: 7,
  height_in: 0.2,
  packaging_weight_oz: 1,
  stack_height_in: 0.1,
  manual_domestic_rate: 'first_class_flat',
  usps_domestic: {
    processing_category: 'FLATS',
    mail_classes: ['USPS_GROUND_ADVANTAGE']
  }
};

describe('shared shipping mechanics contract', () => {
  it('normalizes each physical item shape and summarizes a mixed shipment', () => {
    const tier = { id: 'tier-one', category: 'physical', shipping };
    const supportItem = {
      id: 'support-one',
      category: 'physical',
      shipping: { ...shipping, weight_oz: 2, packaging_weight_oz: 0.5, height_in: 0.1 }
    };
    const addOn = {
      productId: 'add-on-one',
      name: 'Add-on',
      category: 'physical',
      quantity: 3,
      shipping: { ...shipping, weight_oz: 1, packaging_weight_oz: 0.25, height_in: 0.2, stack_height_in: 0.15 }
    };

    expect(getTierShippingProfile(tier)).toMatchObject({ valid: true, shipping: { weightOz: 4 } });
    expect(getSupportItemShippingProfile(supportItem)).toMatchObject({ valid: true, shipping: { weightOz: 2 } });
    expect(getAddOnShippingProfile(addOn)).toMatchObject({ valid: true, shipping: { weightOz: 1 } });

    const result = summarizeStoreShipmentSelection(
      { selectedTiers: [{ tier, qty: 2 }] },
      [{ id: 'support-one', amount: 500 }],
      { support_items: [supportItem] },
      [addOn]
    );

    expect(result).toMatchObject({
      valid: true,
      shipment: {
        hasPhysical: true,
        physicalTierCount: 1,
        physicalSupportItemCount: 1,
        physicalAddOnCount: 1,
        physicalUnitCount: 6,
        weightOz: 14.75,
        lengthIn: 12,
        widthIn: 7,
        tierIds: ['tier-one'],
        supportItemIds: ['support-one'],
        addOnIds: ['add-on-one'],
        manualDomesticRate: 'FIRST_CLASS_FLAT',
        uspsDomesticProfile: {
          processingCategory: 'FLATS',
          mailClasses: ['USPS_GROUND_ADVANTAGE']
        }
      }
    });
    expect(result.shipment?.heightIn).toBeCloseTo(0.9);
  });

  it('preserves option fallback and selected-detail behavior', () => {
    const options = [
      { id: 'standard', shippingCents: 300 },
      { id: 'signature_required', shippingCents: 695 }
    ];
    expect(resolveSelectedShippingOption(options, 'unknown', 'signature_required')).toBe('signature_required');
    expect(getSelectedShippingOptionDetails(options, '', 'signature_required')).toEqual(options[1]);
    expect(resolveSelectedShippingOption([], 'unknown')).toBe('standard');
  });
});

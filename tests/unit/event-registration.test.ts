import { describe, expect, it } from 'vitest';

import { validateStoreOrderDraft } from '../../worker/src/catalog.js';
import {
  normalizeEventRegistrationConfig,
  validateEventRegistrationSubmission
} from '../../worker/src/event-registration.js';
import { buildStoreOrderDraft, normalizeStoreOrderDraftForHash } from '../../worker/src/orders.js';

const NOW = Date.parse('2026-08-18T18:00:00.000Z');

function snapshot(products: any[]) {
  return {
    version: 1,
    source: 'event-registration-test',
    defaults: { currency: 'USD', tax_category: 'standard' },
    products
  };
}

function rsvpProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rsvp-test',
    sku: 'rsvp-test',
    name: 'RSVP Test',
    price_cents: 0,
    currency: 'USD',
    fulfillment_type: 'rsvp',
    status: 'active',
    inventory_tracking: true,
    inventory: 50,
    event_details: {
      starts_at: '2026-09-18T19:00:00-06:00',
      registration: {
        opens_at: '2026-08-01T00:00:00-06:00',
        closes_at: '2026-09-17T23:00:00-06:00',
        max_party_size: 4,
        require_attendee_names: true,
        questions: [
          {
            id: 'accessibility_needs',
            label: 'Accessibility needs',
            type: 'textarea',
            scope: 'party',
            required: false,
            max_length: 500
          },
          {
            id: 'meal',
            label: 'Meal',
            type: 'single_select',
            scope: 'attendee',
            required: true,
            options: [
              { value: 'vegetarian', label: 'Vegetarian' },
              { value: 'vegan', label: 'Vegan' },
              { value: 'none', label: 'No meal' }
            ]
          }
        ]
      }
    },
    ...overrides
  };
}

function validSubmission() {
  return {
    answers: { accessibility_needs: 'Step-free entrance, please.' },
    attendees: [
      { name: 'Primary Guest', answers: { meal: 'vegetarian' } },
      { name: 'Plus One', answers: { meal: 'vegan' } }
    ]
  };
}

describe('Store RSVP event registration', () => {
  it('is opt-in and leaves ticket and unconfigured RSVP products unchanged', () => {
    expect(validateEventRegistrationSubmission({
      fulfillmentType: 'ticket',
      eventDetails: rsvpProduct().event_details,
      quantity: 1,
      enforceSubmission: true,
      nowMs: NOW
    })).toMatchObject({ configured: false, registration: null, errors: [] });

    expect(validateEventRegistrationSubmission({
      fulfillmentType: 'rsvp',
      eventDetails: { starts_at: '2026-09-18T19:00:00-06:00' },
      quantity: 1,
      enforceSubmission: true,
      nowMs: NOW
    })).toMatchObject({ configured: false, registration: null, errors: [] });
  });

  it('normalizes a bounded versioned question contract', () => {
    const normalized = normalizeEventRegistrationConfig(rsvpProduct().event_details);

    expect(normalized.errors).toEqual([]);
    expect(normalized.config).toMatchObject({
      version: 1,
      maxPartySize: 4,
      requireAttendeeNames: true,
      requireContactName: true,
      questions: [
        { id: 'accessibility_needs', type: 'textarea', scope: 'party', maxLength: 500 },
        { id: 'meal', type: 'single_select', scope: 'attendee' }
      ]
    });
  });

  it('validates and snapshots canonical party and attendee answers', () => {
    const result = validateEventRegistrationSubmission({
      fulfillmentType: 'rsvp',
      eventDetails: rsvpProduct().event_details,
      quantity: 2,
      submission: validSubmission(),
      enforceSubmission: true,
      nowMs: NOW
    });

    expect(result.errors).toEqual([]);
    expect(result.registration).toEqual({
      version: 1,
      answers: [{
        id: 'accessibility_needs',
        label: 'Accessibility needs',
        type: 'textarea',
        scope: 'party',
        value: 'Step-free entrance, please.'
      }],
      attendees: [
        {
          id: 'attendee-1',
          name: 'Primary Guest',
          answers: [{
            id: 'meal',
            label: 'Meal',
            type: 'single_select',
            scope: 'attendee',
            value: 'vegetarian',
            displayValue: 'Vegetarian'
          }]
        },
        {
          id: 'attendee-2',
          name: 'Plus One',
          answers: [{
            id: 'meal',
            label: 'Meal',
            type: 'single_select',
            scope: 'attendee',
            value: 'vegan',
            displayValue: 'Vegan'
          }]
        }
      ]
    });
  });

  it('fails closed for missing rows, invalid choices, party limits, and closed registration', () => {
    const invalidAnswers = validateEventRegistrationSubmission({
      fulfillmentType: 'rsvp',
      eventDetails: rsvpProduct().event_details,
      quantity: 2,
      submission: {
        answers: {},
        attendees: [{ name: '', answers: { meal: 'Injected option' } }]
      },
      enforceSubmission: true,
      nowMs: NOW
    });
    expect(invalidAnswers.errors.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'registration_attendee_count_mismatch',
      'registration_attendee_name_required',
      'registration_answer_invalid'
    ]));

    const closed = validateEventRegistrationSubmission({
      fulfillmentType: 'rsvp',
      eventDetails: rsvpProduct().event_details,
      quantity: 5,
      submission: validSubmission(),
      enforceSubmission: true,
      nowMs: Date.parse('2026-09-18T06:00:00.000Z')
    });
    expect(closed.errors.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'registration_closed',
      'registration_party_too_large'
    ]));
  });

  it('enforces RSVP contact data only when registration is configured', () => {
    const catalog = snapshot([rsvpProduct()]);
    const input = {
      items: [{
        id: 'rsvp-test',
        productId: 'rsvp-test',
        price: 0,
        quantity: 2,
        registration: validSubmission()
      }]
    };
    const validation = validateStoreOrderDraft(input, {
      snapshot: catalog,
      enforceEventRegistration: true,
      nowMs: NOW
    });

    expect(validation.valid).toBe(true);
    expect(buildStoreOrderDraft(input, { validation, nowMs: NOW })).toMatchObject({
      ok: false,
      status: 422,
      validation: {
        errors: expect.arrayContaining([
          expect.objectContaining({ code: 'registration_email_required' }),
          expect.objectContaining({ code: 'registration_contact_name_required' })
        ])
      }
    });

    const built = buildStoreOrderDraft({
      ...input,
      customer: { name: 'Primary Guest', email: 'primary@example.com' }
    }, { validation, nowMs: NOW });
    expect(built.ok).toBe(true);
    expect(built.orderDraft?.items[0].registration?.attendees).toHaveLength(2);
  });

  it('does not add registration to legacy order hashes when the item has none', () => {
    const normalized = normalizeStoreOrderDraftForHash({
      version: 1,
      items: [{ productId: 'physical', sku: 'physical', quantity: 1 }]
    });
    expect(normalized.items[0]).not.toHaveProperty('registration');
  });
});

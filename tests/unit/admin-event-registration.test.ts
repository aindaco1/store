import { describe, expect, it } from 'vitest';

import {
  buildAdminStoreFulfillmentRow,
  buildAdminStoreOrderRecord,
  storeAttendeeRowsCsv
} from '../../worker/src/index.js';

function registeredOrder(checkIns: Record<string, unknown> = {}) {
  return {
    orderToken: 'store_order_registration_test',
    status: 'confirmed',
    confirmedAt: '2026-08-18T18:00:00.000Z',
    payment: { required: false, status: 'not_required' },
    fulfillmentCheckIns: checkIns,
    orderDraft: {
      currency: 'USD',
      customer: { name: 'Host Person', email: 'host@example.com' },
      totals: { totalCents: 0, itemCount: 2 },
      items: [{
        id: 'rsvp-1',
        productId: 'rsvp-1',
        sku: 'rsvp-1',
        name: 'Community Screening',
        fulfillmentType: 'rsvp',
        quantity: 2,
        eventDetails: {
          starts_at: '2026-12-18T19:00:00-07:00',
          venue: 'DUST WAVE'
        },
        registration: {
          version: 1,
          answers: [{
            id: 'accessibility_needs',
            label: 'Accessibility needs',
            type: 'textarea',
            scope: 'party',
            value: 'Step-free access'
          }],
          attendees: [
            {
              id: 'attendee-1',
              name: 'Alex Guest',
              answers: [{ id: 'age_group', label: 'Age group', type: 'single_select', scope: 'attendee', value: '18_plus', displayValue: '18 or older' }]
            },
            {
              id: 'attendee-2',
              name: 'Sam Guest',
              answers: [{ id: 'age_group', label: 'Age group', type: 'single_select', scope: 'attendee', value: 'under_18', displayValue: 'Under 18' }]
            }
          ]
        }
      }]
    }
  };
}

describe('admin RSVP attendee read model', () => {
  it('keeps attendee names and answers attached to individual check-in state', () => {
    const order = buildAdminStoreOrderRecord(registeredOrder({
      'rsvp-1': {
        attendees: {
          'attendee-1': {
            checkedIn: true,
            quantity: 1,
            checkedInAt: '2026-12-19T02:05:00.000Z',
            checkedInBy: 'door@example.com'
          },
          'attendee-2': { checkedIn: false, quantity: 0 }
        }
      }
    }));

    expect(order.items[0].checkIn).toMatchObject({ checkedIn: false, quantity: 1 });
    expect(order.items[0].registration?.attendees).toEqual([
      expect.objectContaining({ id: 'attendee-1', name: 'Alex Guest', checkIn: expect.objectContaining({ checkedIn: true }) }),
      expect.objectContaining({ id: 'attendee-2', name: 'Sam Guest', checkIn: expect.objectContaining({ checkedIn: false }) })
    ]);
    expect(order.counts.checkedInItems).toBe(1);
  });

  it('treats legacy item-level check-in as applying to every named attendee', () => {
    const order = buildAdminStoreOrderRecord(registeredOrder({
      'rsvp-1': {
        checkedIn: true,
        quantity: 2,
        checkedInAt: '2026-12-19T02:05:00.000Z',
        checkedInBy: 'door@example.com'
      }
    }));

    expect(order.items[0].checkIn).toMatchObject({ checkedIn: true, quantity: 2 });
    expect(order.items[0].registration?.attendees.every((attendee) => attendee.checkIn.checkedIn)).toBe(true);
  });

  it('maps a partial legacy item-level check-in to roster order', () => {
    const order = buildAdminStoreOrderRecord(registeredOrder({
      'rsvp-1': {
        checkedIn: true,
        quantity: 1,
        checkedInAt: '2026-12-19T02:05:00.000Z',
        checkedInBy: 'door@example.com'
      }
    }));

    expect(order.items[0].checkIn).toMatchObject({ checkedIn: false, quantity: 1 });
    expect(order.items[0].registration?.attendees.map((attendee) => attendee.checkIn.checkedIn)).toEqual([true, false]);
  });

  it('exports one CSV row per named attendee without changing legacy row shape semantics', () => {
    const order = buildAdminStoreOrderRecord(registeredOrder());
    const row = buildAdminStoreFulfillmentRow(order, order.items[0]);
    const csv = storeAttendeeRowsCsv([row]);

    expect(csv.trim().split('\n')).toHaveLength(3);
    expect(csv).toContain('attendee_id');
    expect(csv).toContain('Alex Guest');
    expect(csv).toContain('Sam Guest');
    expect(csv).toContain('Accessibility needs');
    expect(csv).toContain('Age group');
    expect(csv).toContain('18 or older');
  });
});

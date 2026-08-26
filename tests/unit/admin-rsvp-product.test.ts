import { describe, expect, it } from 'vitest';

import {
  applyAdminStoreProductPatchToMarkdown,
  normalizeAdminStoreProductPublishBody
} from '../../worker/src/index.js';

function registrationFields() {
  return {
    fulfillmentType: 'rsvp',
    eventStartsAt: '2026-12-19T02:00:00.000Z',
    eventEndsAt: '2026-12-19T04:00:00.000Z',
    eventVenue: 'DUST WAVE',
    eventIcs: true,
    eventFollowupEnabled: true,
    rsvpRegistrationEnabled: true,
    rsvpRegistrationOpensAt: '2026-08-01T06:00:00.000Z',
    rsvpRegistrationClosesAt: '2026-12-18T06:59:00.000Z',
    rsvpMaxPartySize: 4,
    rsvpRequireContactName: true,
    rsvpRequireAttendeeNames: true,
    rsvpQuestions: JSON.stringify([
      {
        id: 'accessibility_needs',
        label: 'Accessibility needs',
        type: 'textarea',
        scope: 'party',
        required: false,
        maxLength: 500
      },
      {
        id: 'age_group',
        label: 'Age group',
        type: 'single_select',
        scope: 'attendee',
        required: true,
        options: [
          { value: 'under_18', label: 'Under 18' },
          { value: '18_plus', label: '18 or older' }
        ]
      }
    ])
  };
}

describe('admin RSVP product publishing', () => {
  it('serializes versioned registration settings into the existing event_details block', () => {
    const normalized = normalizeAdminStoreProductPublishBody({
      intent: 'publish',
      productId: 'rsvp-1',
      fields: registrationFields()
    });

    expect(normalized.ok).toBe(true);
    const source = `---
identifier: rsvp-1
sku: rsvp-1
name: Existing RSVP
fulfillment_type: rsvp
event_details:
  starts_at: "2026-12-18T19:00:00-07:00"
  venue: "DUST WAVE"
---
Existing body.
`;
    const applied = applyAdminStoreProductPatchToMarkdown(source, normalized.patch);
    expect(applied.ok).toBe(true);
    expect(applied.content).toContain('  registration:');
    expect(applied.content).toContain('  followup:\n    enabled: true');
    expect(applied.content).toContain('    max_party_size: 4');
    expect(applied.content).toContain('      - id: "accessibility_needs"');
    expect(applied.content).toContain('        scope: "attendee"');
    expect(applied.content).toContain('          - value: "under_18"');
    expect(applied.content).toContain('Existing body.');
  });

  it('rejects malformed question definitions before repository publication', () => {
    const fields = registrationFields();
    fields.rsvpQuestions = JSON.stringify([
      { id: 'bad id', label: 'Bad question', type: 'text', scope: 'party' }
    ]);
    const normalized = normalizeAdminStoreProductPublishBody({
      intent: 'publish',
      productId: 'rsvp-1',
      fields
    });

    expect(normalized.ok).toBe(false);
    expect(normalized.errors).toContain('RSVP question IDs must use lowercase letters, numbers, dashes, or underscores.');
  });

  it('removes registration settings when an RSVP becomes a ticket', () => {
    const normalized = normalizeAdminStoreProductPublishBody({
      intent: 'publish',
      productId: 'rsvp-1',
      fields: {
        fulfillmentType: 'ticket',
        eventStartsAt: '2026-12-19T02:00:00.000Z',
        eventIcs: true
      }
    });

    expect(normalized.ok).toBe(true);
    const eventPatch = normalized.patch.frontMatter.find((entry) => entry.key === 'event_details');
    expect(eventPatch?.replacement).not.toContain('registration:');
  });

  it('keeps legacy event follow-up disabled unless the admin explicitly enables it', () => {
    const normalized = normalizeAdminStoreProductPublishBody({
      intent: 'publish',
      productId: 'ticket-1',
      fields: {
        fulfillmentType: 'ticket',
        eventEndsAt: '2026-12-19T04:00:00.000Z'
      }
    });

    expect(normalized.ok).toBe(true);
    const eventPatch = normalized.patch.frontMatter.find((entry) => entry.key === 'event_details');
    expect(eventPatch?.replacement).toContain('  followup:\n    enabled: false');
  });
});

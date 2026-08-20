---
identifier: rsvp-1
sku: rsvp-1
name: DUST WAVE Free RSVP
description: "Tickets for DUST WAVE Free RSVP on December 18, 2026."
price: 0
image: "/assets/images/calendar-2026.png"
type: rsvp
fulfillment_type: rsvp
status: active
public: false
launch_test: true
category: dustwave
order: 500
shipping_preset: ticket
tax_category: admission
inventory_tracking: true
inventory: 0
event_details:
  starts_at: "2026-12-18T19:00:00-07:00"
  ends_at: "2026-12-18T21:00:00-07:00"
  venue: "DUST WAVE"
  ticket_delivery: qr
  ics: true
  registration:
    opens_at: "2026-08-01T00:00:00-06:00"
    closes_at: "2026-12-17T23:59:00-07:00"
    max_party_size: 4
    require_contact_name: true
    require_attendee_names: true
    questions:
      - id: accessibility_needs
        label: "Accessibility needs or accommodations"
        type: textarea
        scope: party
        required: false
        max_length: 500
      - id: age_group
        label: "Age group"
        type: single_select
        scope: attendee
        required: true
        options:
          - value: under_18
            label: "Under 18"
          - value: 18_plus
            label: "18 or older"
turnstile_required: true
---
A starter free RSVP product for Store's no-payment, Turnstile-protected ticket flow.

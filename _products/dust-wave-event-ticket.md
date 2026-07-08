---
identifier: ticket-1
sku: ticket-1
name: DUST WAVE Event Ticket
description: "Tickets for DUST WAVE Event Ticket at The Guild Cinema on December 12, 2026."
price: 12
image: "/assets/images/dancewave.png"
type: ticket
fulfillment_type: ticket
status: active
public: false
launch_test: true
category: dustwave
order: 490
shipping_preset: ticket
tax_category: admission
inventory_tracking: true
inventory: 0
variant_option_name: Ticket Type
variants:
- id: general
  label: General Admission
  sku: ticket-1-general
  price: 12
  inventory: 0
- id: supporter
  label: Supporter Ticket
  sku: ticket-1-supporter
  price: 20
  inventory: 0
event_details:
  starts_at: "2026-12-12T22:30:00-07:00"
  ends_at: "2026-12-13T00:30:00-07:00"
  venue: "The Guild Cinema"
  address: "3405 Central Ave NE, Albuquerque, NM 87106"
  ticket_delivery: qr
  ics: true
---
A starter paid ticket product for Store's ticket, QR, and `.ics` confirmation flow.

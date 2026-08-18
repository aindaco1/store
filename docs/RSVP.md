# RSVP Registration

Store supports an opt-in, repository-backed registration layer for `rsvp` products. Existing physical products, downloads, tickets, services, and RSVP products without `event_details.registration` keep their current checkout and fulfillment behavior.

## Product configuration

Use the dashboard **Products** editor for normal changes, or edit the canonical `_products/*.md` record directly:

```yaml
fulfillment_type: rsvp
event_details:
  starts_at: "2026-12-18T19:00:00-07:00"
  venue: "DUST WAVE"
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
```

Question IDs are stable lowercase tokens. Supported types are `text`, `textarea`, `single_select`, `multi_select`, and `checkbox`; supported scopes are `party` and `attendee`. A registration can contain at most 12 questions and 20 attendees. Choice questions require at least two unique value/label options.

## Runtime contract

- Public catalog projections expose only the repository-authored registration definition.
- The cart caps quantity to the configured party size and keeps guest names and answers in memory rather than local or session storage.
- Checkout sends response values to the Worker. The Worker resolves the current product definition, enforces the open/deadline window and party size, rejects unknown choices, and stores canonical question snapshots with the order.
- Free RSVPs continue to confirm without Stripe. Paid RSVP configurations, if used, retain the existing PaymentIntent and inventory lifecycle.
- The private order page shows the submitted attendee roster and responses. Customer email lists attendee names but omits custom answers.
- Admin Orders supports attendee search, per-attendee check-in, partial attendance totals, response review, and one-row-per-attendee CSV export. Older item-level check-ins remain readable and mutable.

## Privacy and operations

Registration answers can contain accessibility, dietary, or other sensitive attendee information. Ask only what event operations require. Answers live inside the authoritative `orders:` record and its private derived admin read model; they are not placed in browser storage, public catalog JSON, Stripe metadata, logs, audit events, or email content. Admin/order responses remain authenticated or token-scoped and `private, no-store`.

Order retention and encrypted backup policy apply to registration responses. Removing a question from a product affects new checkouts only; confirmed orders keep their historical question labels and responses. Operators should limit CSV exports, store them only in approved encrypted locations, and delete working copies when the event workflow no longer needs them.

## Verification

Run focused contracts after RSVP changes:

```bash
npx vitest run tests/unit/event-registration.test.ts tests/unit/admin-event-registration.test.ts tests/unit/admin-rsvp-product.test.ts
bundle exec jekyll build --quiet
```

Run `npm run test:premerge` before merging a release-facing change.

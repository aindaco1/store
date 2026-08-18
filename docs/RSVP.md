# RSVP Registration

Store supports an opt-in, repository-backed registration layer for `rsvp` products. Existing physical products, downloads, tickets, services, and RSVP products without `event_details.registration` keep their current checkout and fulfillment behavior.

Audience: Store operators and developers configuring, testing, or extending RSVP products.

## Shipped in v1.2.0

- Optional registration open/close timestamps and a per-registration party limit.
- Required or optional contact and attendee names.
- Party- or attendee-scoped text, textarea, single-select, multi-select, and checkbox questions.
- Server-side validation against the current repository product, including deadline, party size, exact attendee count, required fields, and allowed choices.
- Historical question and response snapshots on confirmed orders, so later product edits do not rewrite prior registrations.
- Customer order-page attendee details, private admin response review and search, one-row-per-attendee CSV export, partial attendance totals, and independently audited attendee check-in.
- Free confirmation without Stripe. A displayed total of `$0.00` omits the tip and payment-method controls, uses **Complete order**, and does not prewarm Stripe. Paid and mixed carts keep the existing payment UI and PaymentIntent lifecycle.
- English and Spanish system copy, keyboard and text-scaling coverage, and in-memory guest-response drafts that are not written to browser storage.

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

Question IDs are stable lowercase tokens. Supported types are `text`, `textarea`, `single_select`, `multi_select`, and `checkbox`; supported scopes are `party` and `attendee`.

Current bounds and defaults:

- `opens_at` and `closes_at` are optional valid timestamps. When both exist, closing must be later than opening; the close timestamp is exclusive.
- `max_party_size` defaults to 20 and must be between 1 and 20.
- `require_contact_name` and `require_attendee_names` default to `true`.
- A registration can contain at most 12 questions. Choice questions require 2–20 unique non-empty value/label options.
- Question IDs use lowercase letters, numbers, dashes, or underscores and are limited to 64 characters. Labels are limited to 160 characters.
- Names are limited to 120 characters. Text answers default to 160 characters, textarea answers default to 1,000, and an explicit `max_length` is capped at 2,000.

Use stable question IDs after publication. Renaming a label is safe for new orders because confirmed orders retain the historical label; changing or reusing an ID for a different meaning makes cross-order exports ambiguous.

## Runtime contract

- Public catalog projections expose only the repository-authored registration definition.
- The cart caps quantity to the configured party size and keeps guest names and answers in memory rather than local or session storage.
- Checkout places **Contact** before **RSVP details** and sends response values to the Worker. The Worker resolves the current product definition, enforces the open/deadline window and party size, rejects unknown choices, and stores canonical question snapshots with the order.
- Free RSVPs continue to confirm without Stripe. Paid RSVP configurations, if used, retain the existing PaymentIntent and inventory lifecycle.
- The private order page shows the submitted attendee roster and responses. Customer email lists attendee names but omits custom answers.
- Admin Orders supports attendee search, per-attendee check-in, partial attendance totals, response review, and one-row-per-attendee CSV export. Older item-level check-ins remain readable and mutable.
- A direct-linked cart that predates the registration schema can repair the non-sensitive schema from the current product page. Names and answers remain memory-only, and the Worker still performs the authoritative validation.

## Privacy and operations

Registration answers can contain accessibility, dietary, or other sensitive attendee information. Ask only what event operations require. Answers live inside the authoritative `orders:` record and its private derived admin read model; they are not placed in browser storage, public catalog JSON, Stripe metadata, logs, audit events, or email content. Admin/order responses remain authenticated or token-scoped and `private, no-store`.

Order retention and encrypted backup policy apply to registration responses. Removing a question from a product affects new checkouts only; confirmed orders keep their historical question labels and responses. Operators should limit CSV exports, store them only in approved encrypted locations, and delete working copies when the event workflow no longer needs them.

Ask for another attendee's information only when it is necessary to run the event and the person completing checkout is authorized to provide it. Do not use operational RSVP answers as marketing consent, infer sensitive traits from them, or copy them into general contact lists.

## Current limitations

The following are not shipped in v1.2.0:

- Customer self-service edits, substitutions, or cancellations.
- Capacity-aware waitlists or automatic promotion.
- Invite-only household links, invitation imports, or explicit yes/no/maybe responses.
- Event-wide guest messaging beyond the existing confirmed-order reminder workflow.
- Camera scanning, offline door mode, walk-in registration, or event-scoped door-staff roles.
- Recurring event series, reusable event templates, or cross-event guest profiles.

Do not describe these as available on product pages or in operator communications. The prioritized designs and safety constraints live in [ROADMAP.md](ROADMAP.md#rsvp-and-event-operations).

## Verification

Run focused contracts after RSVP changes:

```bash
npx vitest run tests/unit/event-registration.test.ts tests/unit/admin-event-registration.test.ts tests/unit/admin-rsvp-product.test.ts
npx vitest run tests/unit/cart-pending-item.test.ts
npx playwright test tests/e2e/public-page-controls.spec.ts --project=chromium --grep "direct-link RSVP"
bundle exec jekyll build --quiet
```

Run `npm run test:premerge` before merging a release-facing change.

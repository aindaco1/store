# Film Fatale event follow-up preflight

Date: 2026-08-26

Status: **local candidate only; not deployed, queued, or sent**

## Approved behavior

- One post-event email becomes eligible 24 hours after an opted-in ticket or RSVP event ends.
- The audience is confirmed purchasers, deduplicated by normalized email address.
- Imported, launch-test, invalid, suppressed, and already-processed records are excluded.
- New event drafts enable the follow-up by default. Existing event products remain disabled unless explicitly enabled.
- An administrator must refresh the exact email and audience, then match the audience digest, recipient count, confirmation dialog, and `QUEUE EVENT FOLLOW-UP` acknowledgement before a manual backfill can enter the outbox.
- Optional-email suppression never suppresses receipts, tickets, security messages, or essential order updates.

## Film Fatale read-only audience evidence

The fresh production KV scan was generated at `2026-08-26T18:12:08.993Z`. It read 466 orders without truncation and emitted no customer addresses into this evidence.

- 49 matching confirmed orders
- 74 tickets
- 40 unique purchasers before suppression
- 9 duplicate purchases collapsed
- 40 eligible unique recipients
- 0 unconfirmed, imported, launch-test, invalid, suppressed, or already-processed exclusions

The preview sender is `Dust Wave Shop <updates@shop.dustwave.xyz>`. The English subject is `Thanks for showing up for FILM FATALE at the Guild Cinema | Dust Wave Shop`.

## Deliverability and content review

- Uses the configured verified-domain sender and shared support reply-to contract.
- Sends multipart HTML and plain text without attachments.
- Uses a restrained event-specific subject, one linked brand logo, readable live text, and HTTPS support/newsletter links.
- The revised logo links to the configured organization site; the copy also offers merchandise, active-project, one-time, monthly, and newsletter paths without tying direct support to a specific campaign.
- Direct-support cards render in two columns on desktop and stack on narrow screens.
- The message uses the purchaser's checkout language. When one deduplicated address has matching orders in more than one language, the most recent confirmed checkout language wins deterministically.
- Includes the Albuquerque postal address, commercial/support disclosure, a visible durable opt-out, `List-Unsubscribe`, and `List-Unsubscribe-Post` one-click headers.
- Uses the durable outbox, deterministic per-event/per-recipient idempotency, bounce/complaint suppression, and the existing 20-message-per-minute delivery batches.
- States that the message is the only post-event email for the event and does not silently add recipients to the newsletter.

## Local verification

- `npm run test:unit`: 102 files and 488 tests passed.
- Host Worker security suite: 4 files and 22 tests passed.
- Focused admin dashboard browser coverage passed after verifying the super-admin selector and 390-pixel Orders layout.
- Production Jekyll build and asset minification passed.
- Performance budgets passed: 502,539 JavaScript bytes and 193,990 CSS bytes; `admin.css` is 114,998 of 115,000 bytes.
- English/Spanish i18n completeness and the 46-family Store data-inventory audit passed.
- Wrangler production-configuration dry run passed without deploying.
- Read-only provider checks reported 0 failures, 0 warnings, and 3 credential-dependent skips. The current process did not re-read the Resend domain API because no Resend API key was supplied; the existing `v1.0.8` release evidence records the verified domain, signed webhook, and delivered marker.

The complete Podman pre-merge wrapper passed through the production build, then stopped because the local Podman virtual machine would not remain running. The equivalent host Worker security suite passed. This is local runtime evidence, not a claim that the complete container gate or a production deployment passed.

## Required operator sequence

1. Review and approve the rendered email and the aggregate Film Fatale audience above.
2. Run the complete pre-merge gate with a healthy Podman runtime.
3. Deploy the reviewed commit through the documented manual release workflow.
4. In Orders, refresh the Film Fatale preview and confirm the fresh recipient count and digest.
5. Queue only after the exact acknowledgement and confirmation. Observe the first outbox batch and signed Resend delivery/suppression evidence.

# Pay what you want: production release

Date: October 7, 2026. User authorized pulling current production changes and
deploying the completed contribution feature.

## Source and deployment

Pulled production through `098604549d8cd6e3e9d176a3b5f0b01b60f39c64`, including
four newer commits with Paradiso's updated poster and `FUSION | The Cell` venue.
The new support product uses that poster. No existing product edit was discarded.

[PR #96](https://github.com/aindaco1/store/pull/96) merged the reviewed feature
commit `7e1639497bd1f44f303c23ad6c65cac2f28d9f02` into
`4f831be0fba09f83cb364aea20aebb6604f854f6`.
[Deploy Production](https://github.com/aindaco1/store/actions/runs/37691588937)
ran from `main` with that immutable merge SHA. Worker and Pages deployment,
cache purges, admin response security and public crawl verification passed.
Worker version: `6d84dc40-c1fb-4499-98b7-b4c528b3222b`.

Live product: <https://shop.dustwave.xyz/products/support-paradiso/>.

## Verification

- [Hosted Merge Smoke](https://github.com/aindaco1/store/actions/runs/37690320319)
  passed every pre-merge phase for the final combined source. The preceding local
  full gate passed 654 unit, 22 security and 72 browser tests.
- Local release checks passed launch readiness, 11 accessibility scenarios,
  rendered English/Spanish SEO, Worker fulfillment, payment contracts and boundary
  validation, media publish readiness, and the production Worker bundle dry run.
- Read-only provider checks passed public DNS, GitHub deploy secret names,
  Cloudflare API/KV/R2, live/test Stripe webhook configuration, Resend domains and
  USPS quote fixtures. The first probe inherited a localhost target; the rerun
  against the canonical production origins passed. Local Cloudflare DNS API
  credentials were unavailable; [hosted provider evidence](https://github.com/aindaco1/store/actions/runs/37691571712)
  passed the DNS and admin response checks using production credentials.
- [Production Posture](https://github.com/aindaco1/store/actions/runs/37691606871)
  passed for the merge SHA, reporting `status: ok`. This configuration/provider
  check ran alongside deployment; deployed application behavior was then verified
  separately below.
- Metadata-only backup planning, the 48-family inventory audit, synthetic Podman
  recovery and backup readiness passed. Readiness retains one warning: no current
  encrypted-snapshot receipt was available. Codex reviewed this boundary on
  October 7; no new production snapshot or customer-data restore was attempted.

At 21:47 UTC, live canonical validation accepted a $25.37 contribution as an
unshippable service with standard tax metadata. It rejected $0.49 and rejected
custom pricing on the fixed-price ticket. Responses retained `no-store`, and the
ticket's canonical venue retained the production update.

Live Chromium checks passed at 1360px English, 390px English and 390px Spanish:
four presets, custom $25.37 entry, zero default tip, no coupon or quantity field,
cart reload preservation and no horizontal overflow. The current poster and
localized controls were visually inspected. No checkout order, charge or email
was created by this production verification.

Already completed phases were reused across the release-smoke invocations;
the hosted gate supplies complete final pre-merge coverage. Optional VoiceOver
transcript evidence and real provider payment/email delivery were not performed.
See [local feature evidence](2026-10-07-pay-what-you-want-local.md) and
[ethical review](../ETHICAL_RISK.md#pay-what-you-want--2026-10-07).

## Rollback

Dispatch Deploy Production from `main` with the prior successful production ref
`098604549d8cd6e3e9d176a3b5f0b01b60f39c64`
([deployment](https://github.com/aindaco1/store/actions/runs/37689297970)).
Roll back the Worker and storefront together. No storage migration or new key
family was introduced; confirmed orders retain their stored unit prices.

# Admin product price layout: production release

Date: October 7, 2026.

Pulled production through `cd299da25145d37cce4b500ff5fc5f682d5335d7` before
editing, preserving the latest Support Paradiso copy and display order.

Price ranges such as `$100-$1000` overflowed the fixed-width Products table and
touched Inventory. The Price column now has more room. Ranges can wrap after
their separator, with a fallback for unusually long amounts. Checkout and
product data behavior are unchanged.

## Source and deployment

[PR #97](https://github.com/aindaco1/store/pull/97) merged into
`b3a247ed75ea331e8b401dabe66d837860b57d9f`.
[Deploy Production](https://github.com/aindaco1/store/actions/runs/37701224542)
deployed that immutable ref successfully to Worker and Pages, including cache
purges, admin response security checks and crawl verification.
Worker version: `e714e9c1-47a5-4901-82d2-4cfcbb1c8252`.

## Verification

- Reproduced the original overlap with a failing browser assertion and screenshot.
- Eight layout scenarios cover 320, 390, 768, 1024, 1280 and 1440 CSS pixels,
  Spanish desktop, 200% desktop text and amounts up to the Worker ceiling.
  Checks verify price text stays inside its column and the page does not overflow.
- The existing broad admin browser scenario passed locally. Repeated layout
  checks passed with retries disabled, including the Podman environment.
- The first hosted run exposed a test fixture that intercepted only one Worker
  port. The fixture now reuses the shared admin router. The corrected
  [full pre-merge gate](https://github.com/aindaco1/store/actions/runs/37700240787)
  passed every phase. The production implementation did not change during this
  fixture correction.
- [Release Provider Evidence](https://github.com/aindaco1/store/actions/runs/37701206412)
  passed for the merged release commit.
- All eight layout scenarios passed against the deployed admin HTML, JavaScript
  and stylesheets with synthetic admin responses. Desktop and mobile screenshots
  were visually inspected. Unexpected write requests were blocked; no production
  sign-in email, catalog mutation, inventory change, order or charge was created.
- The deployed admin page returned HTTP 200 with private, no-store, no-transform
  cache policy. Public catalog verification retained the latest Support Paradiso
  configuration and copy.

## Rollback

Dispatch Deploy Production with the previous successful production ref
`cd299da25145d37cce4b500ff5fc5f682d5335d7`
([deployment](https://github.com/aindaco1/store/actions/runs/37696693341)).
No storage migration or new key family was introduced.

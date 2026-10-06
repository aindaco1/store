# Event detail spacing and typography

Deployed October 5, 2026 (America/Denver), through
[PR #95](https://github.com/aindaco1/store/pull/95).
Production uses immutable merge commit
`92caa2c333aa860fbf690efb3c4f15611b710d26`, whose tree matches the tested PR
head `0fc66570606bbef6518416175a871d32d81700ee`.

## Changes

Product-detail cards retain their natural height when the adjacent description
is long. Event dates, venues, addresses, and purchase controls therefore retain
compact spacing. Date/time and venue names are bold on all ticket and RSVP
product pages and in the shared admin preview styles.

The keyboard release check recognizes enabled Store purchase buttons regardless
of fulfillment-specific wording, while requiring an accessible name and visible
focus. The SEO audit accepts numeric zero prices and still rejects missing
prices. Phantom's search description now uses its existing screening details;
the Worker catalog was regenerated from repository products, including previously
published catalog additions and display order.

## Verification

- [Merge Smoke](https://github.com/aindaco1/store/actions/runs/37411463052)
  passed the full pre-merge gate: secret/content/i18n audits, template drift,
  syntax, focused/full unit suites, build checks, security, Worker smoke, and
  Podman browser coverage.
- Local Jekyll build, product-preview unit test, five focused public/admin browser
  tests, all 11 release accessibility checks, rendered English/Spanish SEO,
  fulfillment evidence, and payment unit contracts passed. A built-site negative
  check proved that a missing offer price still fails while a numeric zero passes.
- Read-only production provider checks passed for public DNS, GitHub deploy secret
  names, Cloudflare API/KV/R2, live/test Stripe webhook endpoints, Resend sender
  domain, and USPS quote fixtures.
- [Hosted provider evidence](https://github.com/aindaco1/store/actions/runs/37412193704)
  passed, covering the locally unavailable Cloudflare DNS API check and the admin
  response policy.
- Data inventory and metadata-only backup planning passed. Synthetic recovery
  restored representative digital, physical, ticket, RSVP, and failed-payment
  records without provider writes. Backup readiness passed with one warning:
  a current encrypted snapshot receipt was unavailable.

Already completed phases were not repeated by subsequent release-smoke invocations.
The hosted gate supplies the complete pre-merge and Podman browser evidence.
Local payment boundary checks are covered by that gate; standalone payment
readiness ran unit contracts only. No live payment, email send, customer-data
restore, or new encrypted production snapshot was performed. Optional speech-based
screen-reader evidence was not run. These boundaries were reviewed by Codex on
October 5, 2026.

## Production

[Deploy Production](https://github.com/aindaco1/store/actions/runs/37412209241)
passed Worker and Pages deployment, cache purges, admin response-policy checks,
and public crawl verification. Worker version:
`9f4f3639-d958-41d7-9782-27a3d5db11ae`.
[Production Posture](https://github.com/aindaco1/store/actions/runs/37412364652)
also passed.

Live Phantom and Paradiso pages, plus Spanish Phantom, showed 4px event-row gaps
and font weights of 700 for date/time and venue, with address weight 400.
Phantom retained a 12px gap before its price. The Worker-rendered preview using
the production stylesheet showed the same event spacing and weights. The updated
search description was present on the live Phantom page.

Ethical review: factual event information, prices, inventory, access, messaging,
and provider behavior remain intact. The search summary reflects existing product
metadata; no new customer data, privilege, or automation is introduced.

## Rollback and cleanup

Rollback through Deploy Production from `main`, with immutable ref
`468d8081822f8644d34fb4e3c19ab23b378c3117` (previous successful deployment
37409805019). No data migration is required.

Moved 15 generated artifact/metadata paths (167,879,068 bytes), including build
output, caches, test output, temporary Worker bundles, and disposable verification
fixtures, into recoverable Trash at
`/Users/aindaco1/.Trash/store-cleanup-20261005-221105/`.
Its `cleanup-report.json` records original and recovery paths.

Only `main` remains locally and remotely. The merged feature branch was removed
after ancestry and remote-tip checks. Preview servers and test containers are
stopped. Node dependencies, Ruby tooling, Playwright browsers, Podman images and
volumes, local configuration and credentials, shared submodules, source media,
and retained Jev evidence remain. All 24 original local Worker state files were
restored after the isolated rehearsal and verified against their original hashes.
Local configuration and credential-file preservation checks also passed.

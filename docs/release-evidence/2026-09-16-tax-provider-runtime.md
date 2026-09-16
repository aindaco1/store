# Tax provider runtime adoption — 2026-09-16

## Finding and change

A review of the current default branches of all 12 local Platform consumers
found that Pool and Store alone import the affected address-provider client.
Pool has already adopted the fix. Other consumers use different Platform
packages or the core tax arithmetic, so their pins remain independent.

Cloudflare Workers reject `fetch` with `redirect: 'error'` before issuing the
request. Store catches the provider error and uses its configured fallback.
The new Store regression emulates Cloudflare's accepted redirect modes. Against
the previous pin it fails: a fixture quote returns flat fallback tax of $11.90
instead of the mocked address provider's $11.80.

Store now pins Platform 0.39.1 / Tax Core 0.3.1 at immutable commit
`51f552d02fe0f888ffdefcc556a4059067f0f3d4`. Provider requests use manual redirect
handling and reject all 3xx responses without following them or forwarding
credentials. Store retains its catalog, tax fallback policy, routes, persistence,
and accepted order totals. The pin also includes the additive Admin Shell 0.12.0
and Design Core 0.3.0 exports; Store does not opt into the new editor styles.

## Verification

The regression fails against the old pin and passes with the new pin. Focused
tax and Platform-pin suites pass all 18 tests. The fixture uses a synthetic
street address; no customer details are recorded here.

- Full local pre-merge checks passed: 569 unit, 22 security, and 57 browser tests,
  together with builds, content, localization, templates, secret checks, and
  Worker smoke checks.
- Root and Worker production and full dependency audits all reported zero
  vulnerabilities.
- Backup inventory validation passed for 48 storage families; backup planning
  passed in dry-run mode. A synthetic restore rehearsal passed for 17 records,
  including five orders, with 26 verified artifacts and 50 planned actions.
  This used no production records or provider writes. The separate backup
  readiness report still warns that current production backup/rehearsal evidence
  is missing; remote provider inventory was not requested. Synthetic rehearsal
  success does not establish production backup readiness.
- [PR 85](https://github.com/aindaco1/store/pull/85) passed the
  [hosted Merge Smoke gate](https://github.com/aindaco1/store/actions/runs/35152124621)
  and merged at `ecdae3dd09433be0e428e4c1290bf9952bd0772e`.
- [Production deployment](https://github.com/aindaco1/store/actions/runs/35152898153)
  used that exact reviewed ref and succeeded for Worker and Pages, including
  cache purges, admin response security policy, and the 52-URL public crawl audit.
  Worker version: `83cb5478-2405-4276-a6ce-b993c307e3ca`.
- Read-only production quotes for the authorized verification address returned
  $11.90 at 7.625% from `nm_grt_fallback_flat` before deployment, then $11.80 at
  7.5625% from `nm_grt_api_intuit`, location `29-504`, after deployment. The input
  subtotal was $156.00 with $5.17 shipping. The response was HTTP 200 with
  `Cache-Control: private, no-store, max-age=0`. Only redacted amounts and provider
  metadata were retained. No order, payment, or customer record was changed.

## Ethical review and rollback

This change restores provider-derived quotes for new checkouts. It introduces
no new collection, messaging, payment operation, permission, or data migration.
Verification must not create orders or charge customers. Settled orders continue
to use stored totals.

Rollback reverts this consumer change and restores the prior Platform pin
`da7bd21ad77e936342d7d67948da88a25f56782c` together with its expected package
versions. That rollback also restores the provider runtime defect. Other
consumers can retain their own pins and deployments.

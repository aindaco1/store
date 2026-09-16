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
street address; no customer details are recorded here. Full release checks and
production acceptance are appended after completion.

## Ethical review and rollback

This change restores provider-derived quotes for new checkouts. It introduces
no new collection, messaging, payment operation, permission, or data migration.
Verification must not create orders or charge customers. Settled orders continue
to use stored totals.

Rollback reverts this consumer change and restores the prior Platform pin
`da7bd21ad77e936342d7d67948da88a25f56782c` together with its expected package
versions. That rollback also restores the provider runtime defect. Other
consumers can retain their own pins and deployments.

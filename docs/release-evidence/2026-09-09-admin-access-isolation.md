# Store admin access isolation and user editor

Verified on 2026-09-09 America/Denver (2026-09-10 UTC). This is a dated
production record; the dashboard and recovery guides own ongoing procedures.

## Result

- Store and Pool previously shared admin user and authentication keys in one
  KV namespace. Store now uses the isolated `store-admin-` key families and
  never falls back to the old shared keys.
- Store limited admins retain product, coupon, download, order, inventory,
  attendance, analytics, and marketing operations. Settings and user management
  require a super admin in both the dashboard and Worker API.
- The Store user editor shows Name, Email, and Role. It automatically submits
  `accessScopes: ["store"]` for limited admins and no explicit scopes for super
  admins. A separate Store checkbox is no longer shown.
- Rejected user saves show their validation reason and retain unsaved edits.
- Pool can preserve an existing unassigned campaign user while saving other
  user changes. This does not authorize new unassigned users or removal of an
  existing campaign assignment through a client-supplied exception.

## Reviewed changes and deployments

| Change | Merged commit | Successful production deployment |
| --- | --- | --- |
| [Store #78](https://github.com/aindaco1/store/pull/78): storage isolation and roles | `33f92d7e0f3b5b7456e9a1f7ed4dc0e1c449ab9c` | [34425569023](https://github.com/aindaco1/store/actions/runs/34425569023) |
| [Pool #41](https://github.com/aindaco1/pool/pull/41): preserve existing unassigned users | `5b478149d8957c9210fbab21b8a7d02e0e42dc1b` | [34425302222](https://github.com/aindaco1/pool/actions/runs/34425302222) |
| [Store #79](https://github.com/aindaco1/store/pull/79): remove the Store checkbox | `8426841ed78caf08f4675047862a1bb947c3cacf` | [34429032555](https://github.com/aindaco1/store/actions/runs/34429032555) |

Each deployment used the reviewed immutable commit and completed Worker and
Pages publishing, cache purges, admin response-policy verification, and public
crawl checks. Store's production application ref after this work is `8426841`.

## Validation and live acceptance

- Store's full local pre-merge gate passed for the isolation fix. Its hosted
  [Merge Smoke](https://github.com/aindaco1/store/actions/runs/34424905638)
  also passed.
- The checkbox follow-up passed syntax and English/Spanish completeness checks,
  the focused admin browser scenario, and the complete hosted
  [pre-merge gate](https://github.com/aindaco1/store/actions/runs/34428400475).
  Existing browser coverage verifies automatic scopes for new limited admins
  and role changes, unchanged super-admin scope representation, self-account
  protection, and the absence of the checkbox.
- Pool's [hosted Merge Smoke](https://github.com/aindaco1/pool/actions/runs/34424755013)
  passed. Local units, build, and security checks passed; its local full wrapper
  stopped at Podman engine selection and is not claimed as a complete local pass.
- The approved production Store list was provisioned and read back before
  removing the Store-only operator from Pool. Both resulting lists were read
  back independently; the Pool save left the Store list unchanged. Existing
  Pool campaign access and the pending, unassigned Pool account were preserved.
- After deployment and cache purge, the authenticated owner dashboard showed
  the approved Store roster with Name, Email, and Role and no Access checkbox.
  Save users remained disabled on the unchanged list. The Pool owner dashboard
  also showed its corrected independent roster.
- No invitations were sent as part of the migration. Individual operator
  invitation delivery and sign-in were not exercised, and no live payment or
  catalog mutation was used for validation.

## Recovery boundary

The isolation cutover required fresh Store sign-in. Old shared sessions and
login nonces were not migrated; the later checkbox removal did not require
another sign-in reset. Preserve Pool's unprefixed records and Store's isolated
user list. Do not roll back to a shared-key Store release. Follow the
[admin storage recovery procedure](../BACKUP_RESTORE.md#store-admin-storage-isolation)
for older snapshots and additional installations.

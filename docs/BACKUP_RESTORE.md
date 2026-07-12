# Backup, Restore, And Disaster Recovery

The Store owner/operator approved the documented RPO/RTO, four-hour active-sales snapshot interval, and 7-daily/5-weekly/12-monthly plus release retention policy on 2026-07-10. Snapshot receipts record aggregate duration and Cloudflare KV/R2/admin-export read usage so that interval can be revisited with evidence.

This runbook covers Store Git/config/build artifacts, Cloudflare KV, private R2 downloads, provider evidence, and guarded recovery. Do not commit snapshots, exports, decrypted archives, or customer data.

## Recovery Objectives

The machine-readable source of truth is [`config/store-data-inventory.json`](../config/store-data-inventory.json). `npm run backup:inventory:audit` compares known Worker storage families with that inventory.

Initial objectives:

| Data | RPO | RTO |
| --- | --- | --- |
| Git/config/build artifacts | every release | 1 hour |
| Orders, payment/fulfillment, admin state | every 4 hours during active sales | 4 hours |
| R2 objects | after create/replace and before delete | 4 hours |
| Bulk import, restore, inventory reset, provider migration | pre-change snapshot | 1 hour |

Recommended retention is 7 daily, 5 weekly, and 12 monthly encrypted snapshots plus release snapshots. Keep at least one verified copy outside the production Cloudflare account and off the primary operator device.

The Store owner/operator approved these objectives, the four-hour active-sales snapshot interval, and the retention counts on `2026-07-10`. `config/store-data-inventory.json` is the machine-readable approval record. Re-review the policy after a material data-class, provider, checkout-volume, or recovery-architecture change; automation validates the record but does not silently change or renew approval.

## Data Classes

- **Authoritative:** `orders:`, inventory overrides, coupons, admin users, saved referrals, reminder suppressions, and `STORE_DOWNLOADS` objects.
- **Idempotency/control:** `stripe-event:`, customer/admin email sent markers, abandoned-cart sent markers, and event-reminder sent markers. Restore these before unpausing webhooks/email jobs to prevent duplicate side effects.
- **Derived/rebuildable:** `admin-store-orders:index:v2`, inventory projections, email lookup indexes, queue summaries, health rows, and address lookup cache. Do not restore these as authoritative records.
- **Incident evidence:** admin audit and selected observability/purge-failure records. Restore only when incident retention requires it.
- **Ephemeral/quarantined:** sessions, login nonces, rate limits, one-time lookup/resume capabilities, pending reminder records, marketing drafts, and cron markers. Never restore them to production.

Durable Object inventory reservations are live derived state. Restore orders and inventory overrides, then reconcile the coordinator; do not import Durable Object storage directly.

## Snapshot Modes

Dry-run first:

```bash
npm run backup:plan
```

A local metadata snapshot writes a v2 manifest, private `0700` directories/`0600` files, SHA-256 artifact checksums, Git head/status/diff/bundle, selected config files, isolated Jekyll/minification/Wrangler dry-run build evidence, canonical KV classification, secret-name presence without values, and a restore plan:

```bash
npm run backup:snapshot -- --output "$HOME/store-backups/$(date -u +%Y%m%dT%H%M%SZ)"
```

Pass `--release-snapshot` for an encrypted release snapshot that the retention planner must preserve.

Read-only remote metadata adds Worker deployments/versions/secret names, shared provider readiness, and KV key inventories:

```bash
npm run backup:snapshot -- --remote --output "$HOME/store-backups/$(date -u +%Y%m%dT%H%M%SZ)"
```

Cloudflare KV key listing is billable even when values are not exported. R2 listing is Class A; object head/get is Class B. Do not schedule remote inventory more frequently than the recovery objective requires.

## Sensitive Snapshot

`--kv-values`, `--r2-objects`, and `--admin-exports` are sensitive. They require:

- an output path outside this repository
- `--acknowledge-sensitive=STORE_SENSITIVE_BACKUP`
- an age or GPG recipient
- local decryptability verification before plaintext staging is deleted
- `STORE_BACKUP_ADMIN_LOGIN_TOKEN` in the environment for admin exports; never pass the token as a CLI argument
- `CLOUDFLARE_R2_API_TOKEN` plus `CLOUDFLARE_ACCOUNT_ID` when `--require-complete-r2` must enumerate unattached objects through the provider API

The helper resolves existing output ancestors before accepting the destination, so a symlink into the repository is rejected as well. R2 keys must map to contained snapshot paths; unsafe `..`, empty-segment, backslash, or NUL forms stop capture. Temporary plaintext archives and sensitive staging are removed on success or failure.

Example with a GPG recipient that has a locally available secret key for verification:

```bash
export STORE_BACKUP_ADMIN_LOGIN_TOKEN='<fresh-one-time-super-admin-token>'
export STORE_BACKUP_ENCRYPTION_RECIPIENT='<gpg-key-id-or-email>'

npm run backup:snapshot -- \
  --remote \
  --kv-values \
  --r2-objects \
  --require-complete-r2 \
  --admin-exports \
  --worker-base=https://checkout.example.com \
  --acknowledge-sensitive=STORE_SENSITIVE_BACKUP \
  --encryption-backend=gpg \
  --encryption-recipient="$STORE_BACKUP_ENCRYPTION_RECIPIENT" \
  --output="$HOME/store-backups/$(date -u +%Y%m%dT%H%M%SZ)"
```

For age, set `STORE_BACKUP_AGE_IDENTITY` to the local identity file used for decryptability verification. The final directory contains only the encrypted archive and a sanitized receipt with archive size/checksum, warning categories, KV record coverage, and R2 completeness/source. Provider stderr, local paths, object keys, and payloads stay inside encrypted staging and are not copied to the receipt. Remote Stripe inventory runs only after a captured `stripe whoami` succeeds; signed-out CLI state is skipped without launching interactive authentication, and raw auth output is never added to the manifest.

The snapshot never exports secret values. Back up and rotate Cloudflare, Stripe, Resend, GitHub, USPS, and tax credentials through their provider-specific secure recovery process.

## Admin And R2 Inventory

Admin export capture exchanges a one-time token in memory, keeps the session cookie/CSRF token in memory, and writes Orders, attendee, reconciliation, audit, download-library, and health artifacts only inside encrypted staging. Production Worker bases must use HTTPS; loopback HTTP is allowed only for local development, and normalized export paths must remain under `/admin/`. Tokens, cookies, response bodies, object keys, and customer rows are not written to logs or the sanitized receipt.

The admin Downloads export discovers attached and unattached library objects. When a fresh admin token is unavailable, `--require-complete-r2` uses Cloudflare's paginated R2 object API with a read token. `--r2-objects` downloads the union of provider/admin inventory and catalog-referenced keys, and the required mode fails if enumeration or any download is incomplete. KV value capture chunks at 100 keys and accepts both current Wrangler raw-string output and the older structured value/metadata form.

## Verify And Plan Restore

Decrypt an encrypted archive into a new isolated `0700` directory. Then run:

```bash
npm run restore:plan -- --snapshot /secure/decrypted/store-snapshot
```

Planning is the default. It verifies every listed checksum, including the finalized `manifest.json`, rejects duplicate, unlisted, symlink, unsupported, or path-escaping artifacts, validates authoritative record shapes, identifies missing value artifacts, excludes quarantine families, schedules derived-record rebuilds, and lists R2 objects. It performs no provider writes. A metadata-only snapshot remains useful evidence but cannot execute until every required value artifact is present.

Generate aggregate-only captured-order and inventory evidence before restoration:

```bash
npm run recovery:reconcile -- \
  --snapshot=/secure/decrypted/store-snapshot \
  --stripe-mode=required \
  --expected-stripe-mode=live \
  --strict \
  --output=/secure/evidence/captured-reconciliation.json
```

Use a dedicated restricted live read key through `STRIPE_SECRET_KEY`. The command rejects test/live credential mismatch before a provider request and writes counts/reason categories only; it never writes customer, order, PaymentIntent, or credential identifiers. `--stripe-mode=off` is suitable only for local format testing, not a protected production-data drill.

For a reviewed Durable Object inventory correction, use the authenticated `POST /admin/store/recovery/inventory-reconciliation` `plan` -> distinct-super-admin `approve` -> requester `execute` flow. The 15-minute plan fingerprints Store order/inventory/reservation state and a fresh bounded read-only Stripe comparison. Execution additionally requires exact `STORE_INVENTORY_RECONCILE`, maintenance, paused-webhook, and reservation-review confirmations, and blocks on stale state, active data anomalies, incomplete provider coverage, or any payment mismatch. The operation replaces claimed inventory from confirmed orders and clears reviewed reservations; it does not import Durable Object storage or modify Stripe.

Rehearse the same contracts with the production-like local stack:

```bash
npm run restore:rehearse
```

The drill uses synthetic PII, proves session data is excluded, verifies the v2 index rebuild action, and confirms the Podman Worker keeps unauthenticated admin responses private/no-store.

The representative fixture includes physical, digital, ticket, RSVP, failed-payment, Stripe/email/reminder idempotency, audit, inventory-control, R2, quarantined, and derived-rebuild classes. Its runner permits only reviewed Wrangler KV/R2 commands and asserts that no Stripe, email, webhook, or check-in provider command is generated. This is application-contract evidence, not proof that a captured production snapshot is recoverable.

## Execute Local Or Preview Restore

Execution requires an explicit overwrite decision:

```bash
npm run restore:plan -- \
  --snapshot /secure/decrypted/store-snapshot \
  --target=local \
  --execute \
  --conflict=overwrite \
  --persist-to=/tmp/store-restore-wrangler
```

Use `--target=preview` only when the Wrangler preview namespaces and R2 bucket are isolated and reviewed. KV supports Wrangler's `--preview` namespace selection, but R2 object commands do not; preview execution therefore requires an explicit bucket distinct from the captured source bucket:

```bash
npm run restore:plan -- \
  --snapshot /secure/decrypted/store-snapshot \
  --target=preview \
  --preview-r2-bucket=store-downloads-preview \
  --execute \
  --conflict=overwrite
```

The command transforms KV bulk-get output to bulk-put records in a private temporary directory, restores only reviewed authoritative/control artifacts, uploads included R2 objects to the explicit preview bucket, and deletes `admin-store-orders:index:v2` so normal admin reads rebuild it. It rejects a missing preview bucket or one equal to the captured source bucket.

Read back every restored KV value and R2 object checksum, then remove only snapshot-owned preview data:

```bash
npm run restore:plan -- \
  --snapshot=/secure/decrypted/store-snapshot \
  --target=preview \
  --preview-r2-bucket=store-downloads-preview \
  --verify --json

npm run restore:plan -- \
  --snapshot=/secure/decrypted/store-snapshot \
  --target=preview \
  --preview-r2-bucket=store-downloads-preview \
  --cleanup-preview \
  --acknowledge-preview-cleanup=STORE_PREVIEW_RESTORE_CLEANUP \
  --json
```

Verification and cleanup evidence contains counts only. Cleanup cannot target production, is idempotent, checks KV/R2 absence, runs explicitly after a successful protected drill, and is attempted again by the failure trap after a partial preview restore.

## Readiness And Retention

Generate a sanitized readiness report:

```bash
npm run backup:readiness -- \
  --provider-evidence=/secure/evidence/providers.json \
  --snapshot-receipt=/secure/backups/latest/manifest.json \
  --rehearsal-evidence=/secure/evidence/recovery-rehearsal.json \
  --strict \
  --output=/secure/evidence/recovery-readiness.json
```

It checks the canonical inventory, metadata-only snapshot plan, credential names without values, required tools/encryption backend, provider failures, encrypted snapshot age, and rehearsal age. Missing live receipts are warnings unless `--require-current-evidence` is supplied.

Retention is plan-only by default:

```bash
npm run backup:retention -- --root="$HOME/store-backups"
```

The planner revalidates encrypted receipt/archive checksums and never selects the newest, release, daily, weekly, monthly, invalid, unencrypted, symlinked, or checksum-mismatched entry. Deletion additionally requires a real, non-symlinked root outside the repository, recomputes retention eligibility immediately before deletion, revalidates each receipt/archive, and requires both `--execute` and `--acknowledge=STORE_BACKUP_RETENTION_PRUNE`. Review the plan and verify the off-device copy before executing it.

## Scheduled Evidence And Drills

- **Recovery Readiness** runs weekly at `03:43 America/Denver`. It performs read-only Cloudflare provider evidence, the representative Podman rehearsal, and backup readiness, then uploads sanitized evidence only.
- **Quarterly Recovery Operations** runs a Worker-wide Cloudflare invocation/error preflight at `04:17 America/Denver` on the first day of January, April, July, and October. The captured-data job remains disabled unless `RECOVERY_DRILL_ENABLED=true`.
- The captured-data job shares production concurrency with deploy/cache operations and requires approval through the `production-recovery` environment. It requires a dedicated age recipient/identity, a fresh one-time super-admin token, a restricted live Stripe read key, an explicit preview R2 bucket, and off-account S3-compatible archive credentials/destination. An optional endpoint keeps the workflow provider-neutral. It captures encrypted KV/admin/R2 data, verifies the remote copy, reconciles captured orders read-only, restores only to preview, verifies every restored value/object, removes snapshot-owned preview data, derives artifacts from sanitized counts/status, and removes detailed restore output and plaintext material before artifact upload.
- Store the dedicated recovery identity as a protected environment secret only after review; do not reuse an operator's personal/master key. A fresh `STORE_BACKUP_ADMIN_LOGIN_TOKEN` must be supplied immediately before approval because it is short-lived and one-time, then deleted from the environment after the run or expiry.
- GitHub's 90-day encrypted drill artifact is secondary drill evidence, not the approved long-term 7-daily/5-weekly/12-monthly destination and not proof of decryption on a second isolated device. The protected path additionally requires a verified S3-compatible upload. `npm run backup:offsite -- --snapshot=... --destination=...` provides a plan-first copy to a mounted external or private remote filesystem; execution requires `--execute --acknowledge=STORE_BACKUP_OFF_DEVICE_COPY`, a different filesystem device, checksum readback, and an append-only target. Run `--verify-only --verify-decrypt` on the separately located recovery machine to produce second-device evidence.

A separately located, operator-controlled recovery device is the preferred local-friendly second-location target. Mount its encrypted destination through a private LAN/VPN share or rotate an encrypted removable disk; do not expose public SSH/SMB. The recovery device must receive only the encrypted archive and receipt, preserve append-only snapshots, verify checksums, and run the age decrypt-to-`/dev/null` proof locally before the second-device gate is marked complete. An S3-compatible provider remains optional and AWS is not required.

- No scheduled or protected workflow contains a production restore acknowledgement or production target. A production restore remains a separate manual incident procedure governed by the gates below.

## Production Restore Gates

Do not execute a production restore until all of these are true:

1. Checkout/admin mutation traffic is in maintenance mode or otherwise frozen.
2. Stripe webhook delivery is paused or safely buffered.
3. Inventory reservations and in-flight PaymentIntents are reviewed.
4. A fresh verified pre-restore snapshot exists.
5. The restore plan has no invalid actions or missing value artifacts and conflict policy is explicitly `overwrite`.
6. A local/preview rehearsal passed with the same snapshot format.

The CLI enforces the first five interlocks. The pre-restore snapshot must be checksum-valid and distinct from the snapshot being restored. Restore commands stop after the first provider failure rather than continuing into later phases:

```bash
npm run restore:plan -- \
  --snapshot /secure/decrypted/store-snapshot \
  --target=production \
  --execute \
  --conflict=overwrite \
  --acknowledge-production=STORE_PRODUCTION_RESTORE \
  --maintenance-confirmed \
  --stripe-webhooks-paused \
  --inventory-reservations-reviewed \
  --pre-restore-snapshot=/secure/pre-restore-snapshot
```

Restore order:

1. Git/config/build artifacts and matching storefront/Worker version.
2. Admin users only when break-glass access requires it.
3. Orders and payment/fulfillment records.
4. Inventory overrides, coupons, referrals, and suppression preferences.
5. Stripe/email/reminder idempotency markers before side effects resume.
6. R2 objects, verified by size/checksum.
7. Rebuild order/email/inventory projections and reconcile Durable Object reservations.
8. Preserve audit evidence when required; do not restore observability or purge-failure rows as runtime state.

## Git-Only Rollback

Use Git restore before touching KV for catalog/config mistakes:

```bash
git log --oneline -- _products worker/src/generated/catalog-snapshot.js api/products.json
git show <good-sha>:_products/<product>.md
git restore --source <good-sha> -- _products worker/src/generated/catalog-snapshot.js api/products.json
npm run sync:worker-config
bundle exec jekyll build --config _config.yml,_config.local.yml
```

For a full clone from the snapshot bundle:

```bash
git clone /secure/decrypted/store-snapshot/git/store.bundle store-restore
```

Deploy storefront and Worker together so public catalog JSON and Worker validation remain aligned.

## Recovery Verification

Before reopening production traffic:

```bash
npm run sync:worker-config
npm run backup:inventory:audit
npm run test:content-security
npm run test:seo
npm run test:security
npm run test:e2e:headless
```

Also verify Settings -> Store readiness, orders/audit/reconciliation exports, a non-destructive order lookup, R2 download delivery, inventory totals, Stripe idempotency markers, cron state after a fresh scheduler run, and a Workers Cache purge followed by a fresh Orders read. Resume Stripe webhooks before checkout traffic and monitor duplicate/missing side effects.

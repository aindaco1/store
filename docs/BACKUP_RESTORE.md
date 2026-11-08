# Backup, Restore, And Disaster Recovery

The Store owner/operator approved the documented RPO/RTO, four-hour active-sales snapshot interval, and 7-daily/5-weekly/12-monthly plus release retention policy on 2026-07-10. Snapshot receipts record aggregate duration and Cloudflare KV/R2/admin-export read usage so that interval can be revisited with evidence.

This runbook covers Store Git/config/build artifacts, Cloudflare KV, private R2 downloads, provider evidence, and guarded recovery. Do not commit snapshots, exports, decrypted archives, or customer data.

Daily product reports reuse existing recovery families: published recipient
configuration is in repository product front matter; `store_product_report`
payloads (including lifetime purchaser rows and the rendered CSV attachment)
use the quarantined email outbox and its existing 30-day retention; provider evidence uses the existing
email-delivery ledger, and `cron:product-reports:*` markers are ephemeral. Restore
recipient configuration and delivery evidence before considering any report
replay. Never restore pending report emails or cron markers automatically.

## Store admin storage isolation

The Dust Wave production cutover completed on 2026-09-09; see the
[deployment and verification record](release-evidence/2026-09-09-admin-access-isolation.md).
The first-release procedure below applies to installations that still use the
shared layout and to review of older snapshots.

Store auth and audit records use `store-admin-` prefixes. When Store and Pool
share a KV namespace, unprefixed `admin-users:v1`, `admin-user:`, `admin-login:`,
`admin-session:`, `admin-login-history:`, and `admin-audit:` records belong to
the old shared layout and may contain Pool data. Never automatically copy,
restore, or delete them as Store records.

Before the first isolated release, prepare an explicitly reviewed Store user
list under `store-admin-users:v1`, preserving the Store owner as super admin
and assigning `limited_admin` / `accessScopes: ["store"]` only to approved
Store operators. Preserve Pool campaign assignments in its existing list.
An existing isolated Store list must be reviewed before replacement; a missing
list falls back only to Store's own configured or bootstrap users.

The cutover requires fresh Store sign-in: old shared sessions and invitation
nonces are deliberately not migrated. Pool sign-in continues using its own
records. Store backup and restore cover the isolated user list and audit
events; sessions, nonces, and 30-day minimized login history remain excluded
from restored authentication state. Older snapshots require explicit key and
membership review before any admin-user restore.

Rollback to a release using the shared keys reintroduces the collision. Prefer
a forward fix; do not roll back auth isolation while either app is being used
to manage users.

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

- **Authoritative:** `orders:` (including opt-in RSVP attendee names and custom responses), inventory overrides, coupons, admin users, saved referrals, reminder suppressions, permanent hashed promotional-email opt-outs, and `STORE_DOWNLOADS` objects.
- **Idempotency/control:** `stripe-event:`, `email-delivery:v1:`, `email-suppression:v1:`, `resend-webhook:v1:`, customer/admin email sent markers, abandoned-cart sent markers, event-reminder sent markers, and post-event sent markers. Restore these before unpausing webhooks/email jobs to prevent duplicate side effects.
- **Derived/rebuildable:** `admin-store-orders:index:v2`, `store-payment-reconciliation-state:v1`, post-event reconciliation markers, inventory projections, email lookup indexes, queue summaries, health rows, and address lookup cache. Do not restore these as authoritative records.
- **Incident evidence:** `processor-event:v1:`, `reconciliation-break:v1:`, admin audit, and selected observability/purge-failure records. Restore only when payment/incident retention requires it.
- **Ephemeral/quarantined:** `email-outbox:v1:` pending payloads, sessions, login nonces, rate limits, one-time lookup/resume capabilities, pending reminder and post-event follow-up records, marketing drafts, and cron markers. Never restore them to production without a provider-delivery and duplicate-send review.

Outbox queue state is rebuildable. If exceptional incident review authorizes pending-message recovery, restore delivery, suppression, and webhook idempotency evidence first, reconcile provider acceptance, then rebuild the queue marker. Never bulk-restore frozen pending payloads merely because they exist in a snapshot.

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

For a reviewed Durable Object inventory correction, use the authenticated `POST /admin/store/recovery/inventory-reconciliation` `plan` -> distinct-super-admin `approve` -> requester `execute` flow. The 15-minute plan fingerprints Store order/inventory/reservation state and a fresh bounded read-only Stripe comparison. Execution additionally requires exact `STORE_INVENTORY_RECONCILE`, maintenance, paused-webhook, and reservation-review confirmations, and blocks on stale state, active data anomalies, incomplete provider coverage, or any payment mismatch. The operation replaces claimed inventory from confirmed native Store orders and clears reviewed reservations; historical imports remain reporting-only. It does not import Durable Object storage or modify Stripe.

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

Before the first delete, cleanup lists the preview KV namespace, compares each listed snapshot key's current value and metadata, and hashes each listed R2 object against the snapshot. It skips confirmed absent targets. A mismatch, incomplete read, or provider error aborts the batch with zero deletes. If all listed R2 objects are absent, the command also confirms the preview bucket is accessible with Wrangler's `r2 bucket info`. A second successful cleanup issues zero deletes.

Keep preview writers idle from preflight through deletion. The checked-in Store `STORE_STATE` and Pool `PLEDGES` bindings use the same preview namespace ID. Coordinate drills across both projects because the reads and deletes are separate provider operations.

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
npm run backup:retention -- --root="$HOME/store-backups" --output=store-retention.json
```

Review the keep and prune lists in `store-retention.json` and verify the off-device copy. Apply the reviewed preview with the following command.

```bash
npm run backup:retention -- --root="$HOME/store-backups" \
  --execute --plan=store-retention.json --acknowledge=STORE_BACKUP_RETENTION_PRUNE
```

The planner keeps the newest snapshot, release snapshots, and the configured daily, weekly, and monthly representatives. It skips invalid receipts and symlinked entries. The preview binds the directory and each verified archive's SHA-256. Before the first deletion, the command rechecks every reviewed archive and each prune target's eligibility under the active policy. A different root, changed archive, or newly protected target rejects the entire batch. Newly discovered snapshots stay in place. Generate a fresh preview after a rejection or when upgrading from version 1.

Use a real, non-symlinked root outside the repository. Run pruning while other processes that change these backups are idle. The command rechecks each target before removal, but a later filesystem error can interrupt a batch after a deletion.

## Scheduled Evidence And Drills

- **Recovery Readiness** runs weekly at `03:43 America/Denver`. It performs read-only Cloudflare provider evidence, the representative Podman rehearsal, and backup readiness, then uploads sanitized evidence only.
- **Quarterly Recovery Operations** runs a Worker-wide Cloudflare invocation/error preflight at `04:17 America/Denver` on the first day of January, April, July, and October. The captured-data job remains disabled unless `RECOVERY_DRILL_ENABLED=true`.
- The captured-data job shares production concurrency with deploy/cache operations and requires approval through the `production-recovery` environment. It requires a dedicated age recipient/identity, a fresh one-time super-admin token, a restricted live Stripe read key, an explicit preview R2 bucket, and bucket-scoped Object Read & Write credentials for a private Standard R2 archive in a Cloudflare account separate from production. Configure the separate account ID, its `https://<account-id>.r2.cloudflarestorage.com` endpoint, region `auto`, a `s3://<bucket>/store/...` destination, and the fixed 400-day lock. The script rejects a production-account endpoint, a non-Store prefix, or any other lock duration before capture. It uploads a non-sensitive canary, verifies byte-identical readback, requires deletion to be rejected, and reads it back again before any customer data is captured. It then captures encrypted KV/admin/R2 data, verifies the remote copy, reconciles captured orders read-only, restores only to preview, verifies every restored value/object, removes snapshot-owned preview data, derives artifacts from sanitized counts/status, and removes detailed restore output and plaintext material before artifact upload.
- Store the dedicated recovery identity as a protected environment secret only after review; do not reuse an operator's personal/master key. A fresh `STORE_BACKUP_ADMIN_LOGIN_TOKEN` must be supplied immediately before approval because it is short-lived and one-time, then deleted from the environment after the run or expiry.
- GitHub's 90-day encrypted drill artifact is secondary drill evidence, not the approved long-term 7-daily/5-weekly/12-monthly destination and not proof of decryption on a second isolated device. The protected path additionally requires a verified S3-compatible upload. `npm run backup:offsite -- --snapshot=... --destination=...` provides a plan-first copy to a mounted external or private remote filesystem; execution requires `--execute --acknowledge=STORE_BACKUP_OFF_DEVICE_COPY`, a different filesystem device, checksum readback, and an append-only target. Run `--verify-only --verify-decrypt` on the separately located recovery machine to produce second-device evidence.

The command writes a success receipt only when the copied archive matches the SHA-256 recorded at the start of execution. On a mismatch, it removes the new snapshot directory and its partial contents. It leaves any pre-existing snapshot untouched.

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
4. Inventory overrides, coupons, referrals, and suppression preferences, including permanent promotional-email opt-outs.
5. Stripe/email/reminder/post-event idempotency markers before side effects resume.
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


## Checkout coordinator recovery

The checkout candidate stores payment recovery checkpoints alongside inventory in the existing DO (`checkout:` and `checkout-due:`). These cannot be reconstructed from claimed-stock projections alone. Preserve the live coordinator; never import or revive ephemeral holds from backups. Stop sales and resolve processor/order discrepancies before the existing maker/checker inventory rebuild. Replacement now rejects active checkout reservations, including pinned uncertain payments. Terminal records expire after 30 days; unresolved money evidence is retained for reconciliation. See [checkout holds](CHECKOUT_HOLDS.md).

## Verify the current R2 archive without a restore

Run **Verify Recovery Archive** manually from `main`. The `production-recovery`
environment retains its existing reviewer and branch restrictions. This job
uses the configured R2 credentials and recovery identity to list and download
the newest encrypted snapshot, check its four-hour freshness, verify its size
and SHA-256, decrypt it, and validate every internal checksum. It does not
restore records, write to R2, change the scheduled drill setting, or send messages.

The shared audit tool is pinned by immutable Platform commit separately from
the application runtime pin. Missing, stale, corrupt, undecryptable, or incomplete
archives fail the run. Only sanitized counts/status are retained as an artifact;
temporary plaintext and key files are removed. This verifies the archive with
the configured key, not independent key escrow, bucket-lock policy, historical
retention coverage, or application restore behavior.


## Four-hour captured-production backups

**Capture Production Backup** runs every four hours at minute 17 UTC and can
also be dispatched manually from `main`. `BACKUP_SCHEDULE_ENABLED=true` enables
scheduled capture. The `production-backup` environment admits only `main` and has
no per-run reviewer, so unattended runs do not stall at the restore approval gate.
The existing `production-recovery` reviewer and disabled quarterly restore-drill
setting are unchanged.

Each run uses the existing Store snapshot tool to capture Git history/config and
all inventory-approved authoritative/control KV values. Store also captures the full private R2 download library via provider enumeration, without requiring a one-time admin login. It encrypts with the
existing age recipient, verifies decryptability and complete checksums/data
coverage locally, uploads to a new unique prefix in the existing R2 archive,
publishes its receipt last, then downloads and verifies that exact archive again.
No production writes, restore, payment mutation, notification sends, or archive
pruning occur. Live KV capture is not a transactional database snapshot; the
existing restore/reconciliation procedure remains necessary during recovery.

Only sanitized `backup-verification.json` is retained as a 90-day GitHub artifact.
Ciphertext stays in R2 under its existing 400-day lock; private temporary identity
and plaintext files are removed on completion or failure. Capture or verification
failure fails the Actions run. Operators should keep GitHub Actions failure
notifications enabled. GitHub schedules can be delayed and are not a hard RPO
clock; inspect the recorded snapshot timestamp and investigate failed or missed
runs. UTC scheduling keeps the interval stable through daylight-saving changes.

The capture workflow uses the repository's existing Cloudflare source credential
for read operations and five environment secrets: `RECOVERY_AGE_IDENTITY`,
`RECOVERY_ENCRYPTION_RECIPIENT`, `RECOVERY_ARCHIVE_URI`, `AWS_ACCESS_KEY_ID`, and
`AWS_SECRET_ACCESS_KEY`. No admin login or Stripe credential is needed.

For initial provisioning/rotation, create the main-only `production-backup`
environment, read its GitHub environment public key, and set repository variables
`BACKUP_ENV_PUBLIC_KEY`/`BACKUP_ENV_KEY_ID`. Dispatch **Provision Backup Credentials**
through the existing `production-recovery` approval gate. Install its five sealed
values through GitHub's environment-secrets API only after matching the target
key ID to a fresh public-key read. These LibSodium envelopes can only be decrypted
by GitHub; they contain no plaintext secrets. Delete the transfer artifact after
installation. Run capture manually and verify its result before enabling the
schedule. This uses the existing R2 destinations and identities; independent key
escrow and additional backup destinations are outside the operator-approved scope.

Local archive/encryption/decryption commands have a five-minute timeout for larger
repository bundles; provider reads retain their shorter bounds. The shared runner
reports capture/upload/verification phases and fixed failure categories without
logging provider stderr or captured values. A failed run does not enable scheduling
or count as a verified recovery point.

### Test-only complimentary licenses

The `software-licenses` instance of `STORE_INVENTORY_COORDINATOR` owns
`complimentary:v1:` grant checkpoints and `complimentary-due:v1:` retry indexes.
These must be reconciled with the licensing authority and the existing Resend
receipt ledger before recovering pending work. Retain the original
`LICENSING_KEY_SECRET`; rotating it without versioned migration prevents key
recovery by design. A rendered `software_license` outbox payload contains a
key: quarantine it with other pending mail, never blindly replay it after
restore. Independent grant export/restore and final retention/erasure policy
remain production gates; this synthetic-only slice does not claim those gates.

### Paid software billing pilot

Pause new intake with `SOFTWARE_CHECKOUT_ENABLED=false`; leave existing billing
processing enabled. Each `software-billing:<orderToken>` DO retains its frozen
order, append-only payment receipts/balanced postings, tax snapshots, refund
reservations/provider mappings, license key hashes, coverage commands and retry
indexes. These `billing-*` records are authoritative and cannot be reconstructed
from a current expiry date or the KV order summary. The
`software-billing-watchdog:v1` KV cursor is disposable; reset it to rescan canonical
orders after restoring the authority. The per-order `billing-invoice-cursor` is
also disposable; it discovers existing invoices without creating purchases.

Reconcile Stripe payments/refunds first; reapply coverage refund tombstones before
reopening licensing downloads; then reconcile Resend receipts before resuming
notification work. Restore the original derivation secret. Unknown refunds older
than 23 hours require review, not a fresh request ID. Paused renewal invoices need
their saved tax snapshot verified before collection resumes. Retain Stripe's
`pause_collection.behavior=keep_as_draft` guard: Store finalizes and pays each
verified invoice individually. Do not unset it during a restore. Do not revert to a
Store build that cannot process active subscriptions. Independent encrypted DO
exports, retention approval and a complete paid-state restore drill remain launch
gates. See [software billing](SOFTWARE_LICENSING.md) for commands and key families.

Payment recovery adds one bounded `billing-card-setup` checkpoint per order: opaque
request/session IDs, creation time and completion state, never card details. Do
not import or blindly replay a stale checkpoint after restore. Reconcile the
current Checkout Session/SetupIntent/customer/subscription with Stripe or discard
it and have the customer start a new setup. Normal retries use the original
SetupIntent-derived provider keys. This operation updates payment defaults only;
it cannot collect or unpause an invoice. The admin browser's session-only refund
hint contains an opaque request ID and payload hash, no customer/license/card
data; it is disposable and never authoritative for money recovery.

## Software licensing checkpoint integration (pre-launch)

`--software-licensing` extends the existing v2 snapshot. It adds Store's logical
billing/complimentary journals and the licensing consumer's schema-3 authority
and complete artifact inventory under `software/`. All files enter the same
checksum inventory, age/GPG archive, decryptability check, private archive copy,
readback verification and retention policy. No new scheduler, destination,
encryption format or credential store is introduced. macOS tar metadata is
excluded so it cannot create files outside the checksum inventory.

This is an **isolated, test-mode maintenance checkpoint**, not an online database
snapshot. Production licensing and paid checkout remain disabled. Stop intake,
webhooks, scheduled work and artifact publishers, drain in-flight requests and
alarms, then restart both Workers with the same unique
`SOFTWARE_RECOVERY_CHECKPOINT` (16–100 letters/digits/underscores/hyphens).
Store blocks ordinary requests and scheduled/alarm work; licensing blocks grants,
activations, downloads and releases. The rehearsal proves this boundary by
stopping both source runtimes before reopening their persisted state in checkpoint
mode. Do not assume a rolling deployment alone has drained old requests. Do not
write directly to KV/R2 during capture. A future live rollout needs a reviewed
quiescence procedure or online snapshot protocol before claiming a four-hour
licensing RPO; the existing ordinary Store backup schedule remains unchanged.

Scheduled capture is wired only to purpose-limited read credentials:
`SOFTWARE_BACKUP_READ_SECRET` for Store and `LICENSING_BACKUP_READ_SECRET` for
licensing (bound there as `SOFTWARE_BACKUP_READ_SECRET`). They permit checkpoint
info/exports/object reads, never import/upload, issuance or other mutations. Store's
workflow security gate continues to forbid admin or Stripe payment credentials.
These read credentials must be provisioned in the existing protected secret stores
before enabling the opt-in; none were provisioned during this local implementation.
Manual local capture can reuse the existing maintenance/admin credentials, while
restore requires `ADMIN_MAINTENANCE_SECRET` (or local `ADMIN_SECRET`) and
`LICENSING_ADMIN_SECRET`. Only names/presence and checkpoint-bound key proofs are
captured; raw secrets, license keys and bearer tokens are not. Recover original
Store key-derivation and licensing token secrets through the existing secure
provider recovery process. The signing public key must also match.

For a reviewed paused test source, set `WORKER_BASE`, `LICENSING_WORKER_BASE`,
`STORE_BACKUP_SOFTWARE_CHECKPOINT` and the existing authentication/encryption
variables, then add `--software-licensing` to the usual capture invocation:

```bash
node scripts/store-backup.mjs --remote --kv-values --r2-objects \
  --require-complete-r2 --software-licensing --skip-build \
  --acknowledge-sensitive=STORE_SENSITIVE_BACKUP
```

The existing capture workflow has optional environment wiring for
`STORE_BACKUP_SOFTWARE_ENABLED` (default `false`) and the checkpoint/client
settings. No GitHub variables, environment secrets, schedules, Cloudflare
bindings or live deployments were changed during implementation. Keep the
workflow opt-in off for the current production Store: these adapters deliberately
require `APP_MODE=test`. An enabled capture fails if either authenticated endpoint
is unavailable, a page/schema/checkpoint mismatches, a billing journal is missing,
a completed grant/refund is absent from licensing, or an artifact is missing or
changed. It never silently downgrades to a partial licensing backup.

`billing-owner:v1:<orderToken>` is a recovery membership record in the existing
`software-licenses` Durable Object, written before the first billing operation.
It includes failed and KV-lagged attempts; canonical orders remain authoritative
for commerce. Every indexed journal is exported. A canonical software order
without membership or its matching immutable journal fails capture. Older test
states created before this index must be reconciled/reseeded explicitly; do not
claim an old orphan journal can be rediscovered from KV. This adapter has not
been deployed against production licensing data.

Recovery preserves grants/key hashes, installation seats/token generations,
coverage intervals/refund tombstones, releases, frozen billing orders, receipts,
integer balanced postings, tax snapshots, refund allocation/deduplication and
command evidence. It excludes temporary inventory holds, alarms, due indexes,
card-setup sessions and invoice discovery cursors. Existing KV policy continues
to quarantine sessions and pending notification jobs while retaining delivery
receipts. Pending command evidence is retained without scheduling it: reconcile
money and Resend receipts separately before any explicit retry.

### Isolated restore and acceptance

The standard restore planner validates the software bundle and exposes a logical
restore action. It refuses to silently skip it. Software execution supports local targets and uniquely named, synthetic Cloudflare
preview targets. Production execution remains refused; existing production restore
approvals do not enable this adapter.
The two destination Workers must use empty, dedicated persistence/buckets,
`APP_MODE=test`, the snapshot's checkpoint and `SOFTWARE_RECOVERY_TARGET=empty`.
Keep `SOFTWARE_CHECKOUT_ENABLED=false`. Restore original secrets separately.

After decrypting and verifying into a private directory, configure loopback
`WORKER_BASE` / `LICENSING_WORKER_BASE` and the existing bearer variables. For a
captured Stripe test account, `STRIPE_SECRET_KEY_TEST` permits only GET payment,
invoice and refund comparisons. Use the same isolated local persistence directory
as the Store Worker for the ordinary KV/R2 restore actions:

```bash
node scripts/store-restore.mjs --snapshot=/private/verified-snapshot \
  --target=local --persist-to=/private/isolated-worker-state \
  --conflict=overwrite --software-licensing --execute --verify
```

The planner's ordinary inventory reconciliation and order/index checks still
apply. Provider drift (including a new paid invoice or post-backup/unallocated
refund), pending refunds or billing reviews stops automatic acceptance. Resolve
that state with reviewed provider truth and a new checkpoint/explicit reconciliation;
do not invoke the billing watchdog as a read-only money comparison, since it can
collect prepared invoices. Seller revocations made after the snapshot also need
operator reconciliation before acceptance. This tool does not invent them.

Import uses empty-target checks, atomic bounded pages and conflict detection.
Retries after a lost upload reply reuse the matching import checkpoint and verify
the existing bytes. Full logical readback, R2 readback hashes and the existing
Minisign verifier run before completion. New R2 versions are rebound only after
verification. Restore markers keep the authority/journals closed across restarts,
even if checkpoint mode is removed. After all provider/revocation/mail/inventory
checks pass, an operator may set `SOFTWARE_RECOVERY_ACCEPTED` to that checkpoint;
that is an explicit acceptance step, not a command the restore tool runs.
Never set it on a partial import. Paid checkout stays independently disabled.

Run the synthetic acceptance rehearsal without any production credentials:

```bash
npm run restore:rehearse:software -- --evidence=/private/tmp/software-restore.json
```

It expects the licensing checkout/dependencies at `../dust-wave-licensing` (or
`LICENSING_REPO`) and `age`/`age-keygen`. It uses actual local Workers, temporary
private persistence, ephemeral encryption/signing keys and a synthetic Stripe
provider. It runs the existing archive encryption and Platform archive verifier,
then restores to fresh Workers. It tests mixed purchase/renewal/refund history,
more than one export page, missing-page rejection, post-backup refund detection,
lost-reply/repeated-restore safety, original key/activation retention, seats,
coverage gaps, revocation, signed artifact rebinding and duplicate-event mail
suppression. It cleans temporary plaintext, ciphertext, keys and runtimes.
This does not claim a new remote archive upload, deployed restore or live-provider
acceptance; those existing protected workflows remain separate release evidence.


### Manual Cloudflare software rehearsal

`npm run restore:rehearse:software:preview -- --evidence=/private/software-recovery.json`
uses the same fixture, encrypted snapshot, archive verifier, logical restore and
ordinary KV/R2 restore planner as the local rehearsal. It seeds and captures a
guarded deployed source, verifies explicit resumption, removes that source, then
restores the downloaded snapshot into a separate empty deployed target. Each pair
creates fresh `dw-recovery-<random-id>-*` Workers, one isolated KV namespace (shared
by test Store state/rate-limit bindings) and two private artifact/download buckets.
No production Worker configuration, payment credential, mail credential or schedule
is deployed. Ephemeral read-only capture and mutation secrets are installed as
Worker secrets and removed with the test resources.

The standard `--target=preview --software-licensing --execute --verify` path now
requires `--software-preview-id=<16-hex-id>` and `--worker-config=<private-json>`.
It checks the dedicated HTTPS origins, test/disabled-checkout configuration,
matching preview bindings, provider namespace ownership and both authenticated
recovery identities before ordinary KV/R2 writes. Production targets and generic
preview bindings fail closed. Whole-resource cleanup belongs to the rehearsal;
partial snapshot cleanup is not sufficient for licensing Durable Objects.

**Rehearse Software Recovery** is manual, main-only and uses the existing
`production-recovery` environment and reviewer protection. Its licensing input
must be a reviewed full commit of `aindaco1/dust-wave-licensing`; that consumer
is already published privately. The private consumer
uses a repository-scoped read-only SSH deploy-key `LICENSING_SOURCE_READ_KEY` approved for checkout. No source
publication, workflow merge, permission expansion or environment change is implied
by the local implementation.

The job uses the existing protected age identity, separate-account R2 bucket and
S3 credentials. Ciphertext is uploaded before its receipt, downloaded into a fresh
private directory, compared byte-for-byte/by digest and verified by the pinned
Platform archive verifier before extraction and restore. Synthetic archives use
`software-rehearsal/<unique-run>/` beside the existing `store/` prefix so production
latest-backup selection cannot choose a synthetic receipt. They remain under the
existing bucket retention/lock policy; the rehearsal never deletes them. No new
scheduler, encryption format, destination bucket or credential store is created.

`--preview-only` explicitly skips the protected remote archive step and uses a
locally verified encrypted round trip. Its evidence records `remoteArchive:false`;
that result cannot close remote-archive acceptance. Both modes retain the restore
lock across redeploys, explicitly accept only the completed synthetic target,
check original activation/seats, coverage gaps/refunds/revocation, signed bytes
and duplicate-event mail suppression, then remove and verify test resources.
Failed-run receipts list any resources still requiring cleanup. Private command
logs are kept beside local evidence and are never uploaded by the workflow.

The preview rehearsal uses deployed test-source Workers and synthetic Stripe
records. The local-only command retains its stopped-workerd source path. Neither
establishes a production drain procedure, live Stripe/Resend acceptance,
independent secret escrow or a licensing RPO/RTO. Paid checkout and
production licensing capture remain off. Review actual timing and remaining
operational gates before any separately authorized production rollout.

Cloudflare now defaults Durable Object code updates to a deferred window of up to
300 seconds. The synthetic rehearsal uses the supported
`--durable-objects-code-update-mode immediate` override after every awaited phase;
otherwise a restored object can retain its old acceptance configuration during
verification. This is not a production drain technique: immediate updates can
interrupt requests. See [Durable Objects code updates](https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/).

### Guarded deployed-source checkpoints

Provision dedicated test Workers with `SOFTWARE_RECOVERY_SOURCE_ID` equal to their
16-hex `SOFTWARE_RECOVERY_PREVIEW_ID`, `APP_MODE=test`, explicit
`SOFTWARE_CHECKOUT_ENABLED=false`, and no restore target/checkpoint variable.
The guard must be installed before source traffic is admitted and remain present
through every source deployment. This is opt-in staging infrastructure; it does
not retrofit an unguarded live source or make rolling deployments a drain method.

Store's existing coordinator class owns a dedicated `software-source-control`
object and a bounded `software-source:v1` control record. Licensing's existing
Publisher owns `licensing-source:v1`. They track opaque admission IDs, checkpoint,
generation and open/draining/frozen state, with at most 128 active operations.
They contain no customer payload. Control records stay with their source and
are excluded from logical exports/imports. An interrupted or abandoned admission
never expires automatically. A timeout, lost completion or uncertain write keeps
capture/resume blocked; investigate the source rather than clearing its tickets.

Authenticated maintenance POSTs use `/admin/store/recovery/source` for Store and
`/internal/source` for licensing, with `{action, sourceId, checkpoint}`. Supported
public actions are `status`, `pause`, `resume`; capture-only credentials cannot
control the barrier. Pause is idempotent at the same checkpoint. Drain Store
first so its admitted handoffs can finish against licensing, then pause licensing.
Require both to report `phase:frozen`, `active:0`, matching identity/checkpoint and
sales disabled. Capture rejects a changed generation/state at either endpoint.
Use a fresh checkpoint for each cycle; resume retries are idempotent.

The Store guard covers requests/webhooks, scheduled handlers and coordinator
alarms. Source request completion includes registered `waitUntil` tasks. A paused
alarm retains a delayed retry; restored targets still omit alarms/due indexes.
Licensing covers admission through authorization/publication, including artifact
verification. Already-authorized read-only response streams may finish after
admission completion; they do not mutate the snapshot. Direct provider KV/R2
writes and deployments that remove/bypass the guard are prohibited during capture.

After capture succeeds, explicitly resume licensing first, then Store. Do not
resume after an incomplete/failed capture merely because a timer elapsed. The
synthetic rehearsal also proves a rejected early resume, a webhook rejected during
drain, an admitted alarm and deferred write completing before freeze, a blocked
scheduled handler, freeze retained across identical-code redeploys, original-key
access after resume, and duplicate-event mail suppression. Ordinary fixture KV
and download bytes are seeded and read back from the deployed source. The fixture
waits for readback before accepting KV capture; this is not a general online,
transactional KV snapshot protocol or proof of production inventory recovery.

Durable admission records are separate from installation seats and business
journals. Consumer-specific ingress and storage adapters stay in Store/licensing;
resource provisioning and capture orchestration are shared within the existing
Store rehearsal. See [Cloudflare's concurrency rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).

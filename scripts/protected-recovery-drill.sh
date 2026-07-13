#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

required_names=(
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_API_TOKEN
  STORE_BACKUP_ENCRYPTION_RECIPIENT
  STORE_BACKUP_AGE_IDENTITY
  STORE_BACKUP_ADMIN_LOGIN_TOKEN
  STRIPE_SECRET_KEY
  STORE_RECOVERY_PREVIEW_R2_BUCKET
  STORE_RECOVERY_ARCHIVE_ACCOUNT_ID
  STORE_RECOVERY_ARCHIVE_S3_URI
  STORE_RECOVERY_ARCHIVE_S3_ENDPOINT
  WORKER_BASE
)

for name in "${required_names[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "Required protected recovery input is unavailable: ${name}" >&2
    exit 1
  fi
done

ARCHIVE_ACCESS_KEY_ID="${STORE_RECOVERY_ARCHIVE_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}"
ARCHIVE_SECRET_ACCESS_KEY="${STORE_RECOVERY_ARCHIVE_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"
ARCHIVE_REGION="${STORE_RECOVERY_ARCHIVE_REGION:-${AWS_REGION:-auto}}"
ARCHIVE_ENDPOINT="${STORE_RECOVERY_ARCHIVE_S3_ENDPOINT:-${AWS_ENDPOINT_URL:-}}"
ARCHIVE_LOCK_DAYS="${STORE_RECOVERY_ARCHIVE_LOCK_DAYS:-400}"
if [ -z "$ARCHIVE_ACCESS_KEY_ID" ] || [ -z "$ARCHIVE_SECRET_ACCESS_KEY" ]; then
  echo "Protected recovery requires restricted S3-compatible archive credentials." >&2
  exit 1
fi
export AWS_ACCESS_KEY_ID="$ARCHIVE_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$ARCHIVE_SECRET_ACCESS_KEY"
export AWS_REGION="$ARCHIVE_REGION"

if [ -z "${STORE_RECOVERY_TRAFFIC_EVIDENCE:-}" ] || [ ! -f "$STORE_RECOVERY_TRAFFIC_EVIDENCE" ]; then
  echo "Protected recovery drill requires a current traffic preflight artifact." >&2
  exit 1
fi

node -e '
  const fs = require("node:fs");
  const evidence = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (evidence?.traffic?.lowTraffic !== true) {
    throw new Error("Recent production traffic exceeds the recovery drill threshold.");
  }
' "$STORE_RECOVERY_TRAFFIC_EVIDENCE"

if ! command -v age >/dev/null 2>&1; then
  echo "age is required for the protected recovery drill." >&2
  exit 1
fi
if ! command -v aws >/dev/null 2>&1; then
  echo "The S3-compatible AWS CLI client is required for the durable off-account recovery archive." >&2
  exit 1
fi

node -e '
  const value = String(process.argv[1] || "").trim();
  const match = value.match(/^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\/([A-Za-z0-9._\/-]+)$/);
  if (!match || value.includes("..") || !(match[2] === "store" || match[2].startsWith("store/"))) {
    throw new Error("STORE_RECOVERY_ARCHIVE_S3_URI must include a bounded Store-only prefix.");
  }
' "$STORE_RECOVERY_ARCHIVE_S3_URI"

node -e '
  const production = String(process.argv[1] || "").trim().toLowerCase();
  const archive = String(process.argv[2] || "").trim().toLowerCase();
  const endpoint = new URL(String(process.argv[3] || "").trim());
  const lockDays = String(process.argv[4] || "").trim();
  if (!/^[a-f0-9]{32}$/.test(archive)) throw new Error("STORE_RECOVERY_ARCHIVE_ACCOUNT_ID is invalid.");
  if (production === archive) throw new Error("The recovery archive account must be separate from production.");
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
    throw new Error("STORE_RECOVERY_ARCHIVE_S3_ENDPOINT must be a credential-free HTTPS origin.");
  }
  if (endpoint.hostname !== `${archive}.r2.cloudflarestorage.com`) {
    throw new Error("The recovery archive endpoint must match the separate Cloudflare R2 account.");
  }
  if (lockDays !== "400") throw new Error("The recovery archive lock must be exactly 400 days for v1.0.8.");
' "$CLOUDFLARE_ACCOUNT_ID" "$STORE_RECOVERY_ARCHIVE_ACCOUNT_ID" "$ARCHIVE_ENDPOINT" "$ARCHIVE_LOCK_DAYS"

archive_cli_args=()
archive_cli_args+=(--endpoint-url "$ARCHIVE_ENDPOINT")

WORK_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/store-protected-recovery.XXXXXX")"
IDENTITY_FILE="${WORK_DIR}/age-identity.txt"
ENCRYPTED_DIR="${STORE_RECOVERY_ENCRYPTED_DIR:-${WORK_DIR}/encrypted}"
DECRYPTED_ARCHIVE="${WORK_DIR}/store-backup.tar.gz"
SNAPSHOT_DIR="${WORK_DIR}/snapshot"
EVIDENCE_DIR="${STORE_RECOVERY_DRILL_EVIDENCE_DIR:-${WORK_DIR}/evidence}"
RESTORE_RESULT="${WORK_DIR}/restore-result.json"
RESTORE_VERIFICATION_RESULT="${WORK_DIR}/restore-verification.json"
RESTORE_CLEANUP_RESULT="${WORK_DIR}/restore-cleanup.json"
OFF_ACCOUNT_ARCHIVE_COPY="${WORK_DIR}/off-account-store-backup.tar.gz.age"
OFF_ACCOUNT_RECEIPT_COPY="${WORK_DIR}/off-account-manifest.json"
LOCK_PROBE_SOURCE="${WORK_DIR}/archive-lock-probe.txt"
LOCK_PROBE_READBACK="${WORK_DIR}/archive-lock-probe-readback.txt"
LOCK_PROBE_DELETE_ERROR="${WORK_DIR}/archive-lock-probe-delete-error.txt"
RECONCILIATION_RESULT="${EVIDENCE_DIR}/captured-reconciliation.json"
PREVIEW_RESTORE_STARTED=false

cleanup() {
  status=$?
  if [ "$PREVIEW_RESTORE_STARTED" = true ] && [ -f "${SNAPSHOT_DIR}/manifest.json" ]; then
    node ./scripts/store-restore.mjs \
      --snapshot="$SNAPSHOT_DIR" \
      --target=preview \
      --preview-r2-bucket="$STORE_RECOVERY_PREVIEW_R2_BUCKET" \
      --cleanup-preview \
      --acknowledge-preview-cleanup=STORE_PREVIEW_RESTORE_CLEANUP \
      --json >/dev/null 2>&1 || true
  fi
  rm -rf "$SNAPSHOT_DIR" "$DECRYPTED_ARCHIVE" "$IDENTITY_FILE" "$RESTORE_RESULT" "$RESTORE_VERIFICATION_RESULT" "$RESTORE_CLEANUP_RESULT" "$OFF_ACCOUNT_ARCHIVE_COPY" "$OFF_ACCOUNT_RECEIPT_COPY" "$LOCK_PROBE_SOURCE" "$LOCK_PROBE_READBACK" "$LOCK_PROBE_DELETE_ERROR"
  rm -rf "${ENCRYPTED_DIR}.staging-"*
  return "$status"
}
trap cleanup EXIT

mkdir -p "$(dirname "$ENCRYPTED_DIR")" "$SNAPSHOT_DIR" "$EVIDENCE_DIR"
printf '%s\n' "$STORE_BACKUP_AGE_IDENTITY" > "$IDENTITY_FILE"
chmod 600 "$IDENTITY_FILE"

lock_probe_key="lock-probes/${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}-$(date -u '+%Y%m%dT%H%M%SZ').txt"
lock_probe_uri="${STORE_RECOVERY_ARCHIVE_S3_URI%/}/${lock_probe_key}"
printf '%s\n' 'Store recovery archive lock probe v1; contains no customer data.' > "$LOCK_PROBE_SOURCE"
aws "${archive_cli_args[@]}" s3 cp "$LOCK_PROBE_SOURCE" "$lock_probe_uri" --only-show-errors
aws "${archive_cli_args[@]}" s3 cp "$lock_probe_uri" "$LOCK_PROBE_READBACK" --only-show-errors
cmp -s "$LOCK_PROBE_SOURCE" "$LOCK_PROBE_READBACK"
if aws "${archive_cli_args[@]}" s3 rm "$lock_probe_uri" --only-show-errors >/dev/null 2>"$LOCK_PROBE_DELETE_ERROR"; then
  echo "Recovery archive immutability check failed: the 400-day lock allowed deletion." >&2
  exit 1
fi
rm -f "$LOCK_PROBE_READBACK" "$LOCK_PROBE_DELETE_ERROR"
aws "${archive_cli_args[@]}" s3 cp "$lock_probe_uri" "$LOCK_PROBE_READBACK" --only-show-errors
cmp -s "$LOCK_PROBE_SOURCE" "$LOCK_PROBE_READBACK"

started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
started_epoch="$(date +%s)"

STORE_BACKUP_AGE_IDENTITY="$IDENTITY_FILE" \
STORE_BACKUP_ADMIN_LOGIN_TOKEN="$STORE_BACKUP_ADMIN_LOGIN_TOKEN" \
node ./scripts/store-backup.mjs \
  --output="$ENCRYPTED_DIR" \
  --remote \
  --kv-values \
  --r2-objects \
  --require-complete-r2 \
  --admin-exports \
  --worker-base="$WORKER_BASE" \
  --acknowledge-sensitive=STORE_SENSITIVE_BACKUP \
  --encryption-recipient="$STORE_BACKUP_ENCRYPTION_RECIPIENT" \
  --encryption-backend=age \
  --skip-build

archive_run_key="${GITHUB_RUN_ID:-manual}-${started_at//[:]/-}"
archive_uri="${STORE_RECOVERY_ARCHIVE_S3_URI%/}/${archive_run_key}"
aws "${archive_cli_args[@]}" s3 cp \
  "${ENCRYPTED_DIR}/store-backup.tar.gz.age" \
  "${archive_uri}/store-backup.tar.gz.age" \
  --only-show-errors
aws "${archive_cli_args[@]}" s3 cp \
  "${ENCRYPTED_DIR}/manifest.json" \
  "${archive_uri}/manifest.json" \
  --only-show-errors
aws "${archive_cli_args[@]}" s3 ls "${archive_uri}/store-backup.tar.gz.age" >/dev/null
aws "${archive_cli_args[@]}" s3 ls "${archive_uri}/manifest.json" >/dev/null
aws "${archive_cli_args[@]}" s3 cp \
  "${archive_uri}/store-backup.tar.gz.age" \
  "$OFF_ACCOUNT_ARCHIVE_COPY" \
  --only-show-errors
aws "${archive_cli_args[@]}" s3 cp \
  "${archive_uri}/manifest.json" \
  "$OFF_ACCOUNT_RECEIPT_COPY" \
  --only-show-errors
cmp -s "${ENCRYPTED_DIR}/store-backup.tar.gz.age" "$OFF_ACCOUNT_ARCHIVE_COPY"
cmp -s "${ENCRYPTED_DIR}/manifest.json" "$OFF_ACCOUNT_RECEIPT_COPY"
rm -f "$OFF_ACCOUNT_ARCHIVE_COPY" "$OFF_ACCOUNT_RECEIPT_COPY"

age --decrypt \
  --identity "$IDENTITY_FILE" \
  --output "$DECRYPTED_ARCHIVE" \
  "${ENCRYPTED_DIR}/store-backup.tar.gz.age"
tar -xzf "$DECRYPTED_ARCHIVE" -C "$SNAPSHOT_DIR"

npm run recovery:reconcile -- \
  --snapshot="$SNAPSHOT_DIR" \
  --stripe-mode=required \
  --expected-stripe-mode=live \
  --maximum-stripe-requests=500 \
  --output="$RECONCILIATION_RESULT" \
  --strict

PREVIEW_RESTORE_STARTED=true
node ./scripts/store-restore.mjs \
  --snapshot="$SNAPSHOT_DIR" \
  --target=preview \
  --preview-r2-bucket="$STORE_RECOVERY_PREVIEW_R2_BUCKET" \
  --execute \
  --conflict=overwrite \
  --json > "$RESTORE_RESULT"

node ./scripts/store-restore.mjs \
  --snapshot="$SNAPSHOT_DIR" \
  --target=preview \
  --preview-r2-bucket="$STORE_RECOVERY_PREVIEW_R2_BUCKET" \
  --verify \
  --json > "$RESTORE_VERIFICATION_RESULT"

node ./scripts/store-restore.mjs \
  --snapshot="$SNAPSHOT_DIR" \
  --target=preview \
  --preview-r2-bucket="$STORE_RECOVERY_PREVIEW_R2_BUCKET" \
  --cleanup-preview \
  --acknowledge-preview-cleanup=STORE_PREVIEW_RESTORE_CLEANUP \
  --json > "$RESTORE_CLEANUP_RESULT"
PREVIEW_RESTORE_STARTED=false

cp "${ENCRYPTED_DIR}/manifest.json" "${EVIDENCE_DIR}/encrypted-snapshot-receipt.json"
completed_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
completed_epoch="$(date +%s)"

node -e '
  const fs = require("node:fs");
  const restore = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const receipt = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const reconciliation = JSON.parse(fs.readFileSync(process.argv[7], "utf8"));
  const verification = JSON.parse(fs.readFileSync(process.argv[9], "utf8"));
  const cleanup = JSON.parse(fs.readFileSync(process.argv[10], "utf8"));
  const evidence = {
    schemaVersion: 1,
    startedAt: process.argv[3],
    completedAt: process.argv[4],
    durationSeconds: Number(process.argv[5]),
    target: "preview",
    productionWrites: false,
    stripeReadOperations: reconciliation.stripe?.compared || 0,
    stripeWriteOperations: 0,
    stripeComparisonState: reconciliation.stripe?.state || "unavailable",
    stripeMismatches: reconciliation.stripe?.mismatches || 0,
    recoveredOrdersCompared: reconciliation.orders?.total || 0,
    recoveredSoldSkus: reconciliation.orders?.soldSkus || 0,
    restoreReadbackVerified: verification.verification?.ok === true,
    restoredKvRecordsVerified: verification.verification?.kvRecords || 0,
    restoredR2ObjectsVerified: verification.verification?.r2Objects || 0,
    previewCleanupVerified: cleanup.cleanup?.ok === true,
    previewResidualKvRecords: cleanup.cleanup?.residualKvRecords || 0,
    previewResidualR2Objects: cleanup.cleanup?.residualR2Objects || 0,
    offAccountArchiveProvider: process.env.STORE_RECOVERY_ARCHIVE_PROVIDER || "cloudflare-r2",
    offAccountArchiveVerified: process.argv[8] === "true",
    archiveAccountSeparated: process.env.STORE_RECOVERY_ARCHIVE_ACCOUNT_ID !== process.env.CLOUDFLARE_ACCOUNT_ID,
    archiveStorePrefixVerified: String(process.env.STORE_RECOVERY_ARCHIVE_S3_URI || "").includes("/store"),
    archiveLockDays: Number(process.env.STORE_RECOVERY_ARCHIVE_LOCK_DAYS || 0),
    archiveLockDeleteRejected: true,
    archiveLockReadbackVerified: true,
    emailOperations: 0,
    sourceArchiveSha256: receipt.archiveSha256 || "",
    includedDataClasses: receipt.includedDataClasses || [],
    integrityArtifacts: restore.plan?.integrity?.checked || 0,
    plannedActions: restore.plan?.actions?.length || 0,
    missingValueFamilies: restore.plan?.missingValueFamilies?.length || 0,
    invalidActions: restore.plan?.invalidActions?.length || 0,
    executionOk: restore.execution?.ok === true,
    containsCredentials: false,
    containsCustomerData: false
  };
  fs.writeFileSync(process.argv[6], `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
' \
  "$RESTORE_RESULT" \
  "${EVIDENCE_DIR}/encrypted-snapshot-receipt.json" \
  "$started_at" \
  "$completed_at" \
  "$((completed_epoch - started_epoch))" \
  "${EVIDENCE_DIR}/recovery-drill.json" \
  "$RECONCILIATION_RESULT" \
  "true" \
  "$RESTORE_VERIFICATION_RESULT" \
  "$RESTORE_CLEANUP_RESULT"

rm -f "$RESTORE_RESULT"
echo "Protected recovery drill completed against the isolated preview target."

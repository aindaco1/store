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
  STORE_RECOVERY_PREVIEW_R2_BUCKET
  WORKER_BASE
)

for name in "${required_names[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "Required protected recovery input is unavailable: ${name}" >&2
    exit 1
  fi
done

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

WORK_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/store-protected-recovery.XXXXXX")"
IDENTITY_FILE="${WORK_DIR}/age-identity.txt"
ENCRYPTED_DIR="${STORE_RECOVERY_ENCRYPTED_DIR:-${WORK_DIR}/encrypted}"
DECRYPTED_ARCHIVE="${WORK_DIR}/store-backup.tar.gz"
SNAPSHOT_DIR="${WORK_DIR}/snapshot"
EVIDENCE_DIR="${STORE_RECOVERY_DRILL_EVIDENCE_DIR:-${WORK_DIR}/evidence}"
RESTORE_RESULT="${WORK_DIR}/restore-result.json"

cleanup() {
  rm -rf "$SNAPSHOT_DIR" "$DECRYPTED_ARCHIVE" "$IDENTITY_FILE" "$RESTORE_RESULT"
  rm -rf "${ENCRYPTED_DIR}.staging-"*
}
trap cleanup EXIT

mkdir -p "$(dirname "$ENCRYPTED_DIR")" "$SNAPSHOT_DIR" "$EVIDENCE_DIR"
printf '%s\n' "$STORE_BACKUP_AGE_IDENTITY" > "$IDENTITY_FILE"
chmod 600 "$IDENTITY_FILE"

started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
started_epoch="$(date +%s)"

STORE_BACKUP_AGE_IDENTITY="$IDENTITY_FILE" \
STORE_BACKUP_ADMIN_LOGIN_TOKEN="$STORE_BACKUP_ADMIN_LOGIN_TOKEN" \
node ./scripts/store-backup.mjs \
  --output="$ENCRYPTED_DIR" \
  --remote \
  --kv-values \
  --r2-objects \
  --admin-exports \
  --worker-base="$WORKER_BASE" \
  --acknowledge-sensitive=STORE_SENSITIVE_BACKUP \
  --encryption-recipient="$STORE_BACKUP_ENCRYPTION_RECIPIENT" \
  --encryption-backend=age \
  --skip-build

age --decrypt \
  --identity "$IDENTITY_FILE" \
  --output "$DECRYPTED_ARCHIVE" \
  "${ENCRYPTED_DIR}/store-backup.tar.gz.age"
tar -xzf "$DECRYPTED_ARCHIVE" -C "$SNAPSHOT_DIR"

node ./scripts/store-restore.mjs \
  --snapshot="$SNAPSHOT_DIR" \
  --target=preview \
  --preview-r2-bucket="$STORE_RECOVERY_PREVIEW_R2_BUCKET" \
  --execute \
  --conflict=overwrite \
  --json > "$RESTORE_RESULT"

cp "${ENCRYPTED_DIR}/manifest.json" "${EVIDENCE_DIR}/encrypted-snapshot-receipt.json"
completed_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
completed_epoch="$(date +%s)"

node -e '
  const fs = require("node:fs");
  const restore = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const receipt = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const evidence = {
    schemaVersion: 1,
    startedAt: process.argv[3],
    completedAt: process.argv[4],
    durationSeconds: Number(process.argv[5]),
    target: "preview",
    productionWrites: false,
    stripeOperations: 0,
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
  "${EVIDENCE_DIR}/recovery-drill.json"

rm -f "$RESTORE_RESULT"
echo "Protected recovery drill completed against the isolated preview target."

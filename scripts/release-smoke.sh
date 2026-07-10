#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RUN_PREMERGE=true
RUN_READINESS=true
RUN_A11Y_EVIDENCE=true
RUN_I18N_SEO_EVIDENCE=true
RUN_FULFILLMENT_EVIDENCE=true
RUN_SCREEN_READER_EVIDENCE=false
RUN_PROVIDER_CHECKS=true
RUN_PAYMENT_SMOKE=true
RUN_RECOVERY_EVIDENCE=true
USE_DEV_VARS=true
PODMAN_E2E_MODE="auto"
PODMAN_E2E_RAN=false
EVIDENCE_FILE=""
LOG_DIR="${RELEASE_SMOKE_LOG_DIR:-$(mktemp -d /tmp/store-release-smoke-logs.XXXXXX)}"
PROVIDER_EVIDENCE_FILE="${LOG_DIR}/provider-evidence.json"
RECOVERY_REHEARSAL_FILE="${LOG_DIR}/recovery-rehearsal.json"
RECOVERY_READINESS_FILE="${LOG_DIR}/recovery-readiness.json"
declare -a PHASE_RESULTS=()
declare -a SCREEN_READER_EVIDENCE_ARGS=()

usage() {
  cat <<'EOF'
Usage: npm run release:smoke -- [options]

Options:
  --evidence-file <path>  Write a Markdown evidence/sign-off file.
  --podman-e2e           Require the Podman headless E2E phase.
  --skip-podman-e2e      Skip the Podman headless E2E phase.
  --skip-premerge        Skip npm run test:premerge.
  --skip-readiness       Skip npm run launch:readiness.
  --skip-a11y-evidence   Skip focused accessibility evidence when not covered by Podman E2E.
  --skip-i18n-seo-evidence
                         Skip rendered i18n/SEO evidence.
  --skip-fulfillment-evidence
                         Skip Worker-backed fulfillment evidence.
  --screen-reader-evidence
                         Run optional screen-reader/Whisper capability evidence.
  --screen-reader-record-voiceover
                         Record macOS VoiceOver audio and transcribe it with Whisper.
                         Requires VOICEOVER_AUDIO_DEVICE.
  --screen-reader-audio-file <path>
                         Transcribe an existing VoiceOver recording.
  --screen-reader-url <url>
                         URL to open before recording VoiceOver audio.
  --screen-reader-expect <phrase>
                         Required phrase in the Whisper transcript. Repeatable.
  --skip-provider-checks Skip read-only external provider probes.
  --skip-payment-smoke   Skip payment contract/local smoke probes.
  --skip-recovery-evidence
                         Skip backup readiness and Podman restore rehearsal evidence.
  --no-dev-vars          Do not let provider/payment probes read worker/.dev.vars.
                         Use this for clean-shell CI probes.
  --help                 Show this help.

Default behavior runs the pre-merge gate, launch readiness, and Podman E2E
when Podman is available. It also records focused accessibility evidence,
rendered i18n/SEO evidence, Worker-backed fulfillment evidence, read-only
provider probes, payment smoke readiness, and recovery evidence. The screen-reader transcript
helper is opt-in because it depends on controlled local audio and
assistive-technology setup.
EOF
}

run_recovery_readiness() {
  local -a args=(run backup:readiness -- --strict "--output=${RECOVERY_READINESS_FILE}")
  if [ -f "$PROVIDER_EVIDENCE_FILE" ]; then
    args+=("--provider-evidence=${PROVIDER_EVIDENCE_FILE}")
  fi
  if [ -f "$RECOVERY_REHEARSAL_FILE" ]; then
    args+=("--rehearsal-evidence=${RECOVERY_REHEARSAL_FILE}")
  fi
  npm "${args[@]}"
}

phase_slug() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

prefer_podman_path() {
  local candidate=""
  for candidate in \
    "/opt/podman/bin" \
    "/usr/local/podman/bin" \
    "/opt/homebrew/bin" \
    "/usr/local/bin"
  do
    if [ -x "$candidate/podman" ]; then
      export PATH="$candidate:$PATH"
      return 0
    fi
  done
  return 1
}

podman_ready() {
  prefer_podman_path || true
  command -v podman >/dev/null 2>&1 || return 1
  if podman info >/dev/null 2>&1; then
    return 0
  fi
  ./scripts/podman-doctor.sh >/dev/null 2>&1 || true
  podman info >/dev/null 2>&1
}

record_skip() {
  local label="$1"
  local reason="$2"
  PHASE_RESULTS+=("SKIP|${label}|${reason}")
  printf '%s\n' "$label"
  printf '  SKIP: %s\n\n' "$reason"
}

record_pass() {
  local label="$1"
  local detail="$2"
  PHASE_RESULTS+=("PASS|${label}|${detail}")
  printf '%s\n' "$label"
  printf '  PASS: %s\n\n' "$detail"
}

run_phase() {
  local label="$1"
  shift

  local slug=""
  local logfile=""
  local status=0
  slug="$(phase_slug "$label")"
  logfile="${LOG_DIR}/${slug}.log"

  printf '%s\n' "$label"
  if "$@" >"$logfile" 2>&1; then
    PHASE_RESULTS+=("PASS|${label}|${logfile}")
    printf '  PASS\n'
    printf '  log: %s\n\n' "$logfile"
    return 0
  else
    status=$?
  fi

  PHASE_RESULTS+=("FAIL|${label}|${logfile}")
  printf '  FAIL\n'
  printf '  log: %s\n\n' "$logfile"
  printf 'Last log lines:\n'
  tail -n 60 "$logfile" || true
  return "$status"
}

run_required_phase() {
  run_phase "$@" || exit "$?"
}

print_summary() {
  local entry=""
  local status=""
  local label=""
  local detail=""

  printf '\nRelease smoke summary:\n'
  for entry in "${PHASE_RESULTS[@]}"; do
    IFS='|' read -r status label detail <<< "$entry"
    printf '  - %s: %s\n' "$status" "$label"
    printf '    %s\n' "$detail"
  done
  printf '  logs dir: %s\n' "$LOG_DIR"
}

write_evidence() {
  if [ -z "$EVIDENCE_FILE" ]; then
    return 0
  fi

  local evidence_dir=""
  local generated_at=""
  local branch=""
  local commit=""
  local entry=""
  local status=""
  local label=""
  local detail=""

  evidence_dir="$(dirname "$EVIDENCE_FILE")"
  mkdir -p "$evidence_dir"
  generated_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  branch="$(git branch --show-current 2>/dev/null || echo unknown)"
  commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

  {
    printf '# Store Release Smoke Evidence\n\n'
    printf '%s\n' "- Generated: \`${generated_at}\`"
    printf '%s\n' "- Branch: \`${branch}\`"
    printf '%s\n' "- Commit: \`${commit}\`"
    printf '%s\n\n' "- Log directory: \`${LOG_DIR}\`"
    printf '## Automated Phases\n\n'
    printf '| Result | Phase | Log or Reason |\n'
    printf '| --- | --- | --- |\n'
    for entry in "${PHASE_RESULTS[@]}"; do
      IFS='|' read -r status label detail <<< "$entry"
      printf '| %s | %s | `%s` |\n' "$status" "$label" "$detail"
    done
    printf '\n## Release Scope Evidence\n\n'
    printf '%s\n' '- [ ] Accessibility: automated axe, keyboard, focus order, status announcements, reduced motion, high zoom, and mobile-overflow evidence passed; optional VoiceOver/Whisper transcript evidence recorded when release scope requires it.'
    printf '%s\n' '- [ ] I18N: rendered English and Spanish public/order/admin route evidence passed; creator-authored product content remains canonical unless explicit localized overrides exist.'
    printf '%s\n' '- [ ] Podman: local stack and Podman E2E behavior accepted, or skip reason documented above.'
    printf '%s\n' '- [ ] SEO: rendered canonical, hreflang, social metadata, Product JSON-LD, sitemap, robots, and private-route noindex evidence passed.'
    printf '%s\n' '- [ ] Providers: automated provider probes passed or each skip has owner/date/reason and external evidence.'
    printf '%s\n' '- [ ] Store checkout and fulfillment: automated payment and fulfillment evidence passed or each skip has owner/date/reason; signed downloads, revoke/refresh, check-in, CSV exports, webhook settlement, and failure release covered.'
    printf '%s\n' '- [ ] Recovery: inventory audit, metadata-only backup plan, provider evidence, and representative Podman restore rehearsal passed; any missing live encrypted snapshot receipt is recorded as an operational warning rather than fabricated evidence.'
    printf '%s\n\n' '- [ ] Admin: settings, products, coupons, downloads, orders, analytics, marketing, scoped access, Spanish admin, tab persistence, and CSV exports reviewed.'
    printf '## External Evidence Gates\n\n'
    printf '%s\n' '- Production Cloudflare DNS evidence must come from the GitHub Actions workflow when local credentials cannot prove production DNS state.'
    printf '%s\n' '- External provider evidence is required for any Cloudflare, Stripe, Resend, USPS, DNS, or R2 surface skipped by automated provider probes.'
    printf '%s\n' '- Synthetic recovery evidence does not replace an approved encrypted live snapshot, isolated decryptability check, durable off-account copy, or protected captured-data preview drill.'
    printf '%s\n\n' '- Any skipped Podman, payment, accessibility, provider, i18n/SEO, or fulfillment check must include owner, date, reason, and follow-up.'
    printf '## Sign-Off\n\n'
    printf '%s\n' '- Automated gate owner/date:'
    printf '%s\n' '- Accessibility owner/date:'
    printf '%s\n' '- I18N owner/date:'
    printf '%s\n' '- Podman owner/date:'
    printf '%s\n' '- SEO owner/date:'
    printf '%s\n' '- Checkout/fulfillment owner/date:'
    printf '%s\n' '- Admin owner/date:'
    printf '%s\n' '- Notes/blockers:'
  } > "$EVIDENCE_FILE"
}

finish() {
  local status=$?
  trap - EXIT
  write_evidence
  print_summary
  if [ -n "$EVIDENCE_FILE" ]; then
    printf 'Evidence file: %s\n' "$EVIDENCE_FILE"
  fi
  exit "$status"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --evidence-file)
      if [ -z "${2:-}" ]; then
        echo "--evidence-file requires a path" >&2
        exit 2
      fi
      EVIDENCE_FILE="$2"
      shift 2
      ;;
    --podman-e2e)
      PODMAN_E2E_MODE="required"
      shift
      ;;
    --skip-podman-e2e)
      PODMAN_E2E_MODE="skip"
      shift
      ;;
    --skip-premerge)
      RUN_PREMERGE=false
      shift
      ;;
    --skip-readiness)
      RUN_READINESS=false
      shift
      ;;
    --skip-a11y-evidence)
      RUN_A11Y_EVIDENCE=false
      shift
      ;;
    --skip-i18n-seo-evidence)
      RUN_I18N_SEO_EVIDENCE=false
      shift
      ;;
    --skip-fulfillment-evidence)
      RUN_FULFILLMENT_EVIDENCE=false
      shift
      ;;
    --screen-reader-evidence)
      RUN_SCREEN_READER_EVIDENCE=true
      shift
      ;;
    --screen-reader-record-voiceover)
      RUN_SCREEN_READER_EVIDENCE=true
      SCREEN_READER_EVIDENCE_ARGS+=("--record-voiceover")
      shift
      ;;
    --screen-reader-audio-file)
      if [ -z "${2:-}" ]; then
        echo "--screen-reader-audio-file requires a path" >&2
        exit 2
      fi
      RUN_SCREEN_READER_EVIDENCE=true
      SCREEN_READER_EVIDENCE_ARGS+=("--audio-file" "$2")
      shift 2
      ;;
    --screen-reader-url)
      if [ -z "${2:-}" ]; then
        echo "--screen-reader-url requires a URL" >&2
        exit 2
      fi
      RUN_SCREEN_READER_EVIDENCE=true
      SCREEN_READER_EVIDENCE_ARGS+=("--url" "$2")
      shift 2
      ;;
    --screen-reader-expect)
      if [ -z "${2:-}" ]; then
        echo "--screen-reader-expect requires a phrase" >&2
        exit 2
      fi
      RUN_SCREEN_READER_EVIDENCE=true
      SCREEN_READER_EVIDENCE_ARGS+=("--expect" "$2")
      shift 2
      ;;
    --skip-provider-checks)
      RUN_PROVIDER_CHECKS=false
      shift
      ;;
    --skip-payment-smoke)
      RUN_PAYMENT_SMOKE=false
      shift
      ;;
    --skip-recovery-evidence)
      RUN_RECOVERY_EVIDENCE=false
      shift
      ;;
    --no-dev-vars)
      USE_DEV_VARS=false
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

mkdir -p "$LOG_DIR"
trap finish EXIT

printf '==> Store release smoke\n\n'

if [ "$RUN_PREMERGE" = "true" ]; then
  run_required_phase "1. Pre-merge regression gate" npm run test:premerge
else
  record_skip "1. Pre-merge regression gate" "Skipped by --skip-premerge"
fi

if [ "$RUN_READINESS" = "true" ]; then
  run_required_phase "2. Launch readiness audit" npm run launch:readiness
else
  record_skip "2. Launch readiness audit" "Skipped by --skip-readiness"
fi

case "$PODMAN_E2E_MODE" in
  skip)
    record_skip "3. Podman headless E2E suite" "Skipped by --skip-podman-e2e"
    ;;
  required)
    run_required_phase "3a. Podman doctor" env PODMAN_REQUIRE_RELEASE_RESOURCES=true npm run podman:doctor
    run_required_phase "3b. Podman headless E2E suite" npm run test:e2e:headless:podman
    PODMAN_E2E_RAN=true
    ;;
  auto)
    if podman_ready; then
      run_required_phase "3a. Podman doctor" env PODMAN_REQUIRE_RELEASE_RESOURCES=true npm run podman:doctor
      run_required_phase "3b. Podman headless E2E suite" npm run test:e2e:headless:podman
      PODMAN_E2E_RAN=true
    else
      record_skip "3. Podman headless E2E suite" "Podman is not available; rerun with --podman-e2e on a Podman-ready host"
    fi
    ;;
esac

if [ "$RUN_A11Y_EVIDENCE" = "true" ]; then
  if [ "$PODMAN_E2E_RAN" = "true" ]; then
    record_pass "4. Accessibility automated evidence" "Covered by the passed Podman headless E2E suite; rerun npm run release:a11y-evidence for a focused artifact"
  else
    run_required_phase "4. Accessibility automated evidence" npm run release:a11y-evidence
  fi
else
  record_skip "4. Accessibility automated evidence" "Skipped by --skip-a11y-evidence"
fi

if [ "$RUN_SCREEN_READER_EVIDENCE" = "true" ]; then
  if [ "${#SCREEN_READER_EVIDENCE_ARGS[@]}" -gt 0 ]; then
    run_required_phase "5. Screen-reader transcript evidence" npm run release:screen-reader-evidence -- "${SCREEN_READER_EVIDENCE_ARGS[@]}"
  else
    run_required_phase "5. Screen-reader transcript evidence" npm run release:screen-reader-evidence
  fi
else
  record_skip "5. Screen-reader transcript evidence" "Skipped by default; rerun with --screen-reader-evidence and --audio-file or host audio setup"
fi

if [ "$RUN_I18N_SEO_EVIDENCE" = "true" ]; then
  run_required_phase "6. Rendered i18n and SEO evidence" npm run release:i18n-seo-evidence
else
  record_skip "6. Rendered i18n and SEO evidence" "Skipped by --skip-i18n-seo-evidence"
fi

if [ "$RUN_FULFILLMENT_EVIDENCE" = "true" ]; then
  run_required_phase "7. Worker fulfillment evidence" npm run release:fulfillment-evidence
else
  record_skip "7. Worker fulfillment evidence" "Skipped by --skip-fulfillment-evidence"
fi

if [ "$RUN_PROVIDER_CHECKS" = "true" ]; then
  if [ "$USE_DEV_VARS" = "true" ]; then
    run_required_phase "8. Read-only provider readiness probes" env RELEASE_USE_DEV_VARS=1 npm run release:providers -- "--json-output=${PROVIDER_EVIDENCE_FILE}"
  else
    run_required_phase "8. Read-only provider readiness probes" env RELEASE_USE_DEV_VARS=0 npm run release:providers -- "--json-output=${PROVIDER_EVIDENCE_FILE}"
  fi
else
  record_skip "8. Read-only provider readiness probes" "Skipped by --skip-provider-checks"
fi

if [ "$RUN_PAYMENT_SMOKE" = "true" ]; then
  if [ "$USE_DEV_VARS" = "true" ]; then
    run_required_phase "9. Payment smoke readiness" env RELEASE_USE_DEV_VARS=1 npm run release:payment-smoke
  else
    run_required_phase "9. Payment smoke readiness" env RELEASE_USE_DEV_VARS=0 npm run release:payment-smoke
  fi
else
  record_skip "9. Payment smoke readiness" "Skipped by --skip-payment-smoke"
fi

if [ "$RUN_RECOVERY_EVIDENCE" = "true" ]; then
  if podman_ready; then
    run_required_phase "10. Representative Podman restore rehearsal" npm run restore:rehearse -- "--output=${RECOVERY_REHEARSAL_FILE}"
  else
    record_skip "10. Representative Podman restore rehearsal" "Podman is not available; no captured or production data was substituted"
  fi
  run_required_phase "11. Backup and recovery readiness evidence" run_recovery_readiness
else
  record_skip "10. Representative Podman restore rehearsal" "Skipped by --skip-recovery-evidence"
  record_skip "11. Backup and recovery readiness evidence" "Skipped by --skip-recovery-evidence"
fi

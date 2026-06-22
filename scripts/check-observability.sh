#!/usr/bin/env bash
set -euo pipefail

WORKER_URL="${WORKER_URL:-http://127.0.0.1:8989}"
ADMIN_SECRET="${ADMIN_SECRET:-}"
DAYS="${DAYS:-2}"

usage() {
  cat <<'EOF'
Usage: ./scripts/check-observability.sh [--local] [--worker-url URL] [--admin-secret SECRET] [--days N]

Examples:
  ./scripts/check-observability.sh --local
  ADMIN_SECRET=... ./scripts/check-observability.sh --worker-url https://api.shop.dustwave.xyz --days 3
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --local)
      WORKER_URL="http://127.0.0.1:8989"
      shift
      ;;
    --worker-url)
      WORKER_URL="${2:-}"
      shift 2
      ;;
    --admin-secret)
      ADMIN_SECRET="${2:-}"
      shift 2
      ;;
    --days)
      DAYS="${2:-2}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -z "$ADMIN_SECRET" ]; then
  echo "ADMIN_SECRET is required (set env var or pass --admin-secret)." >&2
  exit 1
fi

pretty_print() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool
  else
    cat
  fi
}

fetch_json() {
  local path="$1"
  curl --fail --silent --show-error \
    -H "Authorization: Bearer ${ADMIN_SECRET}" \
    "${WORKER_URL}${path}"
}

echo "== Webhook Observability =="
fetch_json "/admin/observability/webhooks?days=${DAYS}" | pretty_print
echo
echo "== Performance Observability =="
fetch_json "/admin/observability/performance?days=${DAYS}" | pretty_print

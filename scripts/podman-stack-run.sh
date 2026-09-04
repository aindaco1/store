#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/podman-stack-ready.sh"

PODMAN_STACK_STARTED=false
DEV_PID=""
STOP_FILE=""

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

cleanup() {
  if [ "$PODMAN_STACK_STARTED" = "true" ]; then
    if [ -n "$STOP_FILE" ]; then
      touch "$STOP_FILE" 2>/dev/null || true
    fi
    if [ -n "$DEV_PID" ]; then
      wait "$DEV_PID" 2>/dev/null || true
    fi
    rm -f "$STOP_FILE" 2>/dev/null || true
    podman rm -f store-dev-site store-dev-worker >/dev/null 2>&1 || true
    podman pod rm -f store-dev-pod >/dev/null 2>&1 || true
  fi
}

finish() {
  local status=$?
  trap - EXIT
  cleanup
  exit "$status"
}

trap finish EXIT

prefer_podman_path || true

if ! command -v podman >/dev/null 2>&1; then
  echo "❌ Podman is required for this wrapper" >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  echo "Usage: ./scripts/podman-stack-run.sh <command...>" >&2
  exit 1
fi

shared_stack_ready() {
  podman info >/dev/null 2>&1 || return 1
  podman exec store-dev-worker true >/dev/null 2>&1 || return 1
  podman exec store-dev-site true >/dev/null 2>&1 || return 1
  curl -fsS http://127.0.0.1:4002/ >/dev/null 2>&1 || return 1

  local status=""
  status="$(curl -sS -o /dev/null -w "%{http_code}" \
    -X POST http://127.0.0.1:8989/api/cart/validate \
    -H "Content-Type: application/json" \
    --data '{"items":[{"id":"t-shirt-2__m","price":30,"quantity":1}]}' 2>/dev/null || true)"
  if [ "$status" = "200" ]; then
    return 0
  fi

  return 1
}

if ! shared_stack_ready; then
  echo "📦 Starting shared Podman dev stack..." >&2
  PODMAN_STACK_LOG="${PODMAN_STACK_LOG:-/tmp/store-podman-stack-run.log}"
  STOP_FILE="$(mktemp /tmp/store-podman-stack-stop.XXXXXX)"
  rm -f "$STOP_FILE"
  PODMAN_STOP_FILE="$STOP_FILE" PODMAN_RESET_WRANGLER_STATE=true SKIP_STRIPE=true ./scripts/dev.sh --podman > "$PODMAN_STACK_LOG" 2>&1 &
  DEV_PID=$!
  PODMAN_STACK_STARTED=true

  echo "⏳ Waiting for Podman-backed site and worker..." >&2
  store_wait_for_podman_stack shared_stack_ready "$DEV_PID" "$PODMAN_STACK_LOG" || exit 1
fi

set +e
SITE_URL="${SITE_URL:-http://127.0.0.1:4002}" \
WORKER_URL="${WORKER_URL:-http://127.0.0.1:8989}" \
"$@"
COMMAND_STATUS=$?
set -e

trap - EXIT
cleanup
exit "$COMMAND_STATUS"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PLAYWRIGHT_VERSION="$(node -e '
  const lock = require("./package-lock.json");
  const version = lock.packages?.["node_modules/@playwright/test"]?.version;
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) process.exit(1);
  process.stdout.write(version);
')"
PLAYWRIGHT_IMAGE="localhost/store-dev-playwright:${PLAYWRIGHT_VERSION}"
PLAYWRIGHT_NODE_MODULES_VOLUME="store-dev-playwright-node-modules"
PODMAN_REBUILD="${PODMAN_REBUILD:-0}"
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
  echo "❌ Podman is required for containerized Playwright" >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  set -- npx playwright test
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
  PODMAN_PLAYWRIGHT_LOG="${PODMAN_PLAYWRIGHT_LOG:-/tmp/store-playwright-podman.log}"
  STOP_FILE="$(mktemp /tmp/store-playwright-stop.XXXXXX)"
  rm -f "$STOP_FILE"
  PODMAN_STOP_FILE="$STOP_FILE" PODMAN_RESET_WRANGLER_STATE=true SKIP_STRIPE=true ./scripts/dev.sh --podman > "$PODMAN_PLAYWRIGHT_LOG" 2>&1 &
  DEV_PID=$!
  PODMAN_STACK_STARTED=true

  echo "⏳ Waiting for Podman-backed site and worker..." >&2
  for _ in {1..60}; do
    if shared_stack_ready; then
      break
    fi
    if ! kill -0 "$DEV_PID" 2>/dev/null; then
      echo "❌ Podman dev stack process exited before readiness" >&2
      tail -n 80 "$PODMAN_PLAYWRIGHT_LOG" >&2 || true
      exit 1
    fi
    sleep 1
  done

  if ! shared_stack_ready; then
    echo "❌ Podman dev stack did not become ready within 60 seconds" >&2
    tail -n 80 "$PODMAN_PLAYWRIGHT_LOG" >&2 || true
    exit 1
  fi
fi

if [ "$PODMAN_REBUILD" = "1" ] || ! podman image exists "$PLAYWRIGHT_IMAGE"; then
  echo "🔨 Building $PLAYWRIGHT_IMAGE..." >&2
  podman build \
    --build-arg "PLAYWRIGHT_VERSION=$PLAYWRIGHT_VERSION" \
    -t "$PLAYWRIGHT_IMAGE" \
    -f "$ROOT_DIR/Containerfile.playwright.dev" \
    "$ROOT_DIR" >&2
fi

podman volume exists "$PLAYWRIGHT_NODE_MODULES_VOLUME" >/dev/null 2>&1 || podman volume create "$PLAYWRIGHT_NODE_MODULES_VOLUME" >/dev/null

set +e
podman run --rm \
  --pod store-dev-pod \
  -v "$ROOT_DIR:/workspace" \
  -v "$PLAYWRIGHT_NODE_MODULES_VOLUME:/workspace/node_modules" \
  -w /workspace \
  -e CI="${CI:-1}" \
  -e PLAYWRIGHT_EXTERNAL_SERVER=1 \
  -e PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:4000}" \
  -e PLAYWRIGHT_WORKER_BASE_URL="${PLAYWRIGHT_WORKER_BASE_URL:-http://127.0.0.1:8787}" \
  -e PLAYWRIGHT_WORKERS="${PLAYWRIGHT_WORKERS:-1}" \
  "$PLAYWRIGHT_IMAGE" \
  bash /workspace/scripts/podman-playwright-entrypoint.sh "$@"
COMMAND_STATUS=$?
set -e

trap - EXIT
cleanup
exit "$COMMAND_STATUS"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PODMAN_STACK_STARTED=false

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
    podman rm -f store-dev-site store-dev-worker >/dev/null 2>&1 || true
    podman pod rm -f store-dev-pod >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

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
  if curl -s http://127.0.0.1:4002 >/dev/null 2>&1 && \
     curl -s http://127.0.0.1:8989/notfound >/dev/null 2>&1; then
    return 0
  fi

  if podman exec store-dev-worker true >/dev/null 2>&1 && \
     podman exec store-dev-site true >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

if ! shared_stack_ready; then
  echo "📦 Starting shared Podman dev stack..." >&2
  PODMAN_STACK_LOG="${PODMAN_STACK_LOG:-/tmp/store-podman-stack-run.log}"
  PODMAN_DETACH=true SKIP_STRIPE=true ./scripts/dev.sh --podman > "$PODMAN_STACK_LOG" 2>&1
  PODMAN_STACK_STARTED=true

  echo "⏳ Waiting for Podman-backed site and worker..." >&2
  for _ in {1..60}; do
    if shared_stack_ready; then
      break
    fi
    sleep 1
  done

  if ! shared_stack_ready; then
    echo "❌ Podman-backed site/worker did not become ready within 60 seconds" >&2
    exit 1
  fi
fi

SITE_URL="${SITE_URL:-http://127.0.0.1:4002}" \
WORKER_URL="${WORKER_URL:-http://127.0.0.1:8989}" \
"$@"

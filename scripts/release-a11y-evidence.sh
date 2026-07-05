#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${RELEASE_A11Y_MODE:-auto}"
GREP_PATTERN="${RELEASE_A11Y_GREP:-has no obvious axe violations|200% text scaling|supports keyboard-only product add-to-cart flow|release focus order|release live status|release reduced motion}"
HOST_SERVER_PID=""

usage() {
  cat <<'EOF'
Usage: npm run release:a11y-evidence -- [options]

Options:
  --host       Run the focused Playwright accessibility evidence on the host.
  --podman     Run the focused Playwright accessibility evidence through Podman.
  --help       Show this help.

The focused evidence path covers automated axe checks, public keyboard-only cart
flow, release-critical 200% text-scaling checks, focus-order reachability, live
status regions, and reduced-motion checks. VoiceOver/Whisper transcript evidence is
optional unless the release scope explicitly requires it.
EOF
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

cleanup() {
  if [ -n "$HOST_SERVER_PID" ]; then
    kill "$HOST_SERVER_PID" >/dev/null 2>&1 || true
    wait "$HOST_SERVER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

wait_for_host_server() {
  local attempt=0
  for attempt in $(seq 1 80); do
    if curl -fsS "http://127.0.0.1:4002/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

ensure_host_server() {
  if curl -fsS "http://127.0.0.1:4002/" >/dev/null 2>&1; then
    return 0
  fi

  if [ ! -f "_site/index.html" ]; then
    bundle exec jekyll build --config _config.yml,_config.local.yml --quiet
  fi

  python3 -m http.server 4002 --bind 127.0.0.1 --directory _site >/tmp/store-release-a11y-server.log 2>&1 &
  HOST_SERVER_PID="$!"
  if ! wait_for_host_server; then
    echo "Host accessibility server failed to start; log follows:" >&2
    cat /tmp/store-release-a11y-server.log >&2 || true
    return 1
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      MODE="host"
      shift
      ;;
    --podman)
      MODE="podman"
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

if [ "$MODE" = "auto" ]; then
  if podman_ready; then
    MODE="podman"
  else
    MODE="host"
  fi
fi

echo "Store release accessibility evidence"
echo "Mode: $MODE"
echo "Pattern: $GREP_PATTERN"

if [ "$MODE" = "podman" ]; then
  CI=1 PLAYWRIGHT_WORKERS=1 ./scripts/podman-playwright-run.sh \
    npx playwright test \
    tests/e2e/accessibility-public-pages.spec.ts \
    tests/e2e/release-a11y-evidence.spec.ts \
    tests/e2e/admin-dashboard.spec.ts \
    tests/e2e/public-page-controls.spec.ts \
    --project=chromium \
    --workers=1 \
    --grep "$GREP_PATTERN"
else
  ensure_host_server
  CI=1 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_EXTERNAL_SERVER=1 npx playwright test \
    tests/e2e/accessibility-public-pages.spec.ts \
    tests/e2e/release-a11y-evidence.spec.ts \
    tests/e2e/admin-dashboard.spec.ts \
    tests/e2e/public-page-controls.spec.ts \
    --project=chromium \
    --workers=1 \
    --grep "$GREP_PATTERN"
fi

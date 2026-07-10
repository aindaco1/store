#!/usr/bin/env bash
set -euo pipefail

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

detect_os_family() {
  case "$(uname -s)" in
    Darwin)
      echo "macos"
      ;;
    Linux)
      echo "linux"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "windows"
      ;;
    *)
      echo "unknown"
      ;;
  esac
}

detect_podman_socket() {
  podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}' podman-machine-default 2>/dev/null || true
}

configure_podman_connection() {
  local socket_path="${1:-}"

  if [ -z "$socket_path" ]; then
    socket_path="$(detect_podman_socket)"
  fi

  if [ -n "$socket_path" ]; then
    unset CONTAINER_CONNECTION
    export CONTAINER_HOST="unix://${socket_path}"
  fi
}

podman_machine_log_path() {
  local socket_path=""
  socket_path="$(detect_podman_socket)"
  if [ -n "$socket_path" ]; then
    echo "$(dirname "$socket_path")/podman-machine-default.log"
  fi
}

pass() { printf '✅ %s\n' "$1"; }
warn() { printf '⚠️  %s\n' "$1"; }
fail() { printf '❌ %s\n' "$1"; exit 1; }

PODMAN_RELEASE_MIN_MEMORY_MIB="${PODMAN_RELEASE_MIN_MEMORY_MIB:-6144}"
PODMAN_REQUIRE_RELEASE_RESOURCES="${PODMAN_REQUIRE_RELEASE_RESOURCES:-false}"

prefer_podman_path || true

if ! command -v podman >/dev/null 2>&1; then
  fail "Podman is not on PATH. Install Podman first: https://podman.io/docs/installation"
fi

OS_FAMILY="$(detect_os_family)"
echo "Podman doctor"
echo "OS family: $OS_FAMILY"
echo ""

if ! podman --version >/dev/null 2>&1; then
  fail "Podman CLI is installed but not responding. Try reinstalling Podman or reopening your shell."
fi
pass "Podman CLI is available"

if [ "$OS_FAMILY" = "macos" ] || [ "$OS_FAMILY" = "windows" ]; then
  if ! podman machine inspect >/dev/null 2>&1; then
    fail "No Podman machine found. Run: podman machine init --now"
  fi

  MACHINE_STATE="$(podman machine inspect --format '{{.State}}' podman-machine-default 2>/dev/null || true)"
  if [ "$MACHINE_STATE" != "running" ]; then
    warn "Podman machine is not running. Attempting to start it once..."
    podman machine start podman-machine-default >/tmp/store-podman-doctor-start.log 2>&1 || true
    MACHINE_STATE="$(podman machine inspect --format '{{.State}}' podman-machine-default 2>/dev/null || true)"
    if [ "$MACHINE_STATE" != "running" ]; then
      LOG_PATH="$(podman_machine_log_path)"
      if [ -f /tmp/store-podman-doctor-start.log ]; then
        echo "   Podman start log: /tmp/store-podman-doctor-start.log"
      fi
      if [ -n "${LOG_PATH:-}" ] && [ -f "$LOG_PATH" ]; then
        echo "   Podman machine log: $LOG_PATH"
      fi
      fail "Podman machine did not stay running after startup."
    fi
  fi
  pass "Podman machine is running"
  configure_podman_connection

  MACHINE_MEMORY_MIB="$(podman machine inspect --format '{{.Resources.Memory}}' podman-machine-default 2>/dev/null || true)"
  if [[ "$MACHINE_MEMORY_MIB" =~ ^[0-9]+$ ]]; then
    if [ "$MACHINE_MEMORY_MIB" -lt "$PODMAN_RELEASE_MIN_MEMORY_MIB" ]; then
      if [ "$PODMAN_REQUIRE_RELEASE_RESOURCES" = "true" ]; then
        fail "Podman machine memory is ${MACHINE_MEMORY_MIB} MiB; release/pre-merge suites require at least ${PODMAN_RELEASE_MIN_MEMORY_MIB} MiB. Stop the machine, run 'podman machine set --memory ${PODMAN_RELEASE_MIN_MEMORY_MIB}', then restart it."
      fi
      warn "Podman machine memory is ${MACHINE_MEMORY_MIB} MiB; use at least ${PODMAN_RELEASE_MIN_MEMORY_MIB} MiB for release/pre-merge suites."
    else
      pass "Podman machine memory: ${MACHINE_MEMORY_MIB} MiB"
    fi
  fi

  if [ "$OS_FAMILY" = "macos" ]; then
    MACHINE_VMTYPE="$(podman machine info 2>/dev/null | awk '/vmtype:/ {print $2}' | head -n 1 || true)"
    if [ "$MACHINE_VMTYPE" = "applehv" ]; then
      warn "Podman is using applehv on macOS."
      echo "   If startup is flaky, prefer libkrun in ~/.config/containers/containers.conf:"
      echo "   [machine]"
      echo "   provider = \"libkrun\""
    elif [ -n "$MACHINE_VMTYPE" ]; then
      pass "Podman machine backend: $MACHINE_VMTYPE"
    fi
  fi
fi

if ! podman info >/dev/null 2>&1; then
  if [ "$OS_FAMILY" = "macos" ] || [ "$OS_FAMILY" = "windows" ]; then
    warn "Podman machine looks running but the API is stale. Restarting it once..."
    podman machine stop podman-machine-default >/tmp/store-podman-doctor-stop.log 2>&1 || true
    podman machine start podman-machine-default >/tmp/store-podman-doctor-start.log 2>&1 || true
    configure_podman_connection
  fi
fi

if ! podman info >/dev/null 2>&1; then
  if [ "$OS_FAMILY" = "linux" ]; then
    fail "Podman engine is not ready. Try running 'podman info' directly and fix the local service/session first."
  fi
  fail "Podman engine is not ready. Try: podman machine stop && podman machine start"
fi
pass "Podman engine is reachable"

if [ "$OS_FAMILY" = "macos" ] || [ "$OS_FAMILY" = "windows" ]; then
  STABILITY_CHECKS=3
  if [ "$PODMAN_REQUIRE_RELEASE_RESOURCES" = "true" ]; then
    STABILITY_CHECKS=10
  fi
  for _ in $(seq 1 "$STABILITY_CHECKS"); do
    configure_podman_connection
    if ! podman info >/dev/null 2>&1; then
      LOG_PATH="$(podman_machine_log_path)"
      if [ -n "${LOG_PATH:-}" ] && [ -f "$LOG_PATH" ]; then
        echo "   Podman machine log: $LOG_PATH"
      fi
      fail "Podman machine is not staying up after startup."
    fi
    sleep 1
  done
  pass "Podman machine stays reachable after startup"
fi

ROOTLESS="$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null || echo false)"
if [ "$ROOTLESS" != "true" ]; then
  fail "Podman is not running rootless. This repo expects a rootless local setup."
fi
pass "Podman is running rootless"

if ! podman run --rm docker.io/library/alpine:3.20 echo ok >/tmp/store-podman-doctor-alpine.log 2>&1; then
  cat /tmp/store-podman-doctor-alpine.log >&2 || true
  fail "Podman could not run a simple container."
fi
pass "Basic container execution works"

echo ""
echo "Recommended next checks:"
echo "  ./scripts/dev.sh --podman"
echo "  npm run test:e2e:headless:podman"

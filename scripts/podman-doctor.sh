#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/podman-connection.sh"

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

using_explicit_podman_connection() {
  [ -n "${PODMAN_CONNECTION_NAME:-}" ]
}

configure_podman_connection() {
  local socket_path="${1:-}"

  if using_explicit_podman_connection; then
    unset CONTAINER_HOST
    return 0
  fi

  if [ -z "$socket_path" ]; then
    socket_path="$(detect_podman_socket)"
  fi

  if [ -n "$socket_path" ]; then
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
store_select_podman_connection
PODMAN_CONNECTION_NAME="${CONTAINER_CONNECTION:-}"

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
  if using_explicit_podman_connection; then
    configure_podman_connection
    pass "Using Podman connection: ${PODMAN_CONNECTION_NAME}"
  else
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
          tail -n 12 /tmp/store-podman-doctor-start.log
        fi
        if [ -n "${LOG_PATH:-}" ] && [ -f "$LOG_PATH" ]; then
          echo "   Podman machine log: $LOG_PATH"
        fi
        fail "Podman machine failed to start; see the startup error above."
      fi
    fi
    pass "Podman machine is running"
    configure_podman_connection

  fi

  if [ "$OS_FAMILY" = "macos" ] && ! using_explicit_podman_connection; then
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
  if { [ "$OS_FAMILY" = "macos" ] || [ "$OS_FAMILY" = "windows" ]; } && ! using_explicit_podman_connection; then
    warn "Podman machine looks running but the API is stale. Restarting it once..."
    podman machine stop podman-machine-default >/tmp/store-podman-doctor-stop.log 2>&1 || true
    podman machine start podman-machine-default >/tmp/store-podman-doctor-start.log 2>&1 || true
    configure_podman_connection
  fi
fi

if ! podman info >/dev/null 2>&1; then
  if using_explicit_podman_connection; then
    fail "Podman connection '${PODMAN_CONNECTION_NAME}' is not reachable. Check 'podman system connection list' and the VM that owns that connection."
  fi
  if [ "$OS_FAMILY" = "linux" ]; then
    fail "Podman engine is not ready. Try running 'podman info' directly and fix the local service/session first."
  fi
  fail "Podman engine is not ready. Try: podman machine stop && podman machine start"
fi
pass "Podman engine is reachable"

if [ "$OS_FAMILY" = "macos" ] || [ "$OS_FAMILY" = "windows" ]; then
  MEMORY_COMPARISON_MIN_MIB="$PODMAN_RELEASE_MIN_MEMORY_MIB"
  MEMORY_IS_GUEST_AVAILABLE="false"
  if using_explicit_podman_connection; then
    MACHINE_MEMORY_MIB="$(podman machine inspect --format '{{.Resources.Memory}}' "$PODMAN_CONNECTION_NAME" 2>/dev/null || true)"
    if ! [[ "$MACHINE_MEMORY_MIB" =~ ^[0-9]+$ ]]; then
      MACHINE_MEMORY_BYTES="$(podman info --format '{{.Host.MemTotal}}' 2>/dev/null || true)"
      if [[ "$MACHINE_MEMORY_BYTES" =~ ^[0-9]+$ ]]; then
        MACHINE_MEMORY_MIB="$((MACHINE_MEMORY_BYTES / 1024 / 1024))"
        MEMORY_COMPARISON_MIN_MIB="$((PODMAN_RELEASE_MIN_MEMORY_MIB * 9 / 10))"
        MEMORY_IS_GUEST_AVAILABLE="true"
      else
        MACHINE_MEMORY_MIB=""
      fi
    fi
  else
    MACHINE_MEMORY_MIB="$(podman machine inspect --format '{{.Resources.Memory}}' podman-machine-default 2>/dev/null || true)"
  fi
  if [[ "$MACHINE_MEMORY_MIB" =~ ^[0-9]+$ ]]; then
    if [ "$MACHINE_MEMORY_MIB" -lt "$MEMORY_COMPARISON_MIN_MIB" ]; then
      if [ "$MEMORY_IS_GUEST_AVAILABLE" = "true" ]; then
        MEMORY_DETAIL="Podman engine reports ${MACHINE_MEMORY_MIB} MiB available; the selected connection does not meet the ${PODMAN_RELEASE_MIN_MEMORY_MIB} MiB configured-memory baseline"
      else
        MEMORY_DETAIL="Podman engine memory is ${MACHINE_MEMORY_MIB} MiB; release/pre-merge suites require at least ${PODMAN_RELEASE_MIN_MEMORY_MIB} MiB"
      fi
      if [ "$PODMAN_REQUIRE_RELEASE_RESOURCES" = "true" ]; then
        fail "${MEMORY_DETAIL}. Resize the selected machine before retrying."
      fi
      warn "${MEMORY_DETAIL}."
    else
      if [ "$MEMORY_IS_GUEST_AVAILABLE" = "true" ]; then
        pass "Podman engine available memory supports the ${PODMAN_RELEASE_MIN_MEMORY_MIB} MiB configured-memory baseline"
      else
        pass "Podman engine memory: ${MACHINE_MEMORY_MIB} MiB"
      fi
    fi
  fi
fi

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
  if using_explicit_podman_connection; then
    pass "Selected Podman connection stays reachable"
  else
    pass "Podman machine stays reachable after startup"
  fi
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

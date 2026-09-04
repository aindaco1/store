#!/usr/bin/env bash

store_wait_for_podman_stack() {
  local readiness_check="$1"
  local dev_pid="$2"
  local logfile="$3"
  local timeout="${PODMAN_STACK_READY_TIMEOUT:-600}"
  local deadline
  local failure=""

  if ! [[ "$timeout" =~ ^[1-9][0-9]{0,4}$ ]]; then
    echo "PODMAN_STACK_READY_TIMEOUT must be a positive number of seconds (at most 99999)." >&2
    return 1
  fi

  # Cold image builds and dependency installs are part of startup, not test execution.
  deadline=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if "$readiness_check"; then
      return 0
    fi
    if ! kill -0 "$dev_pid" 2>/dev/null; then
      failure="Podman dev stack process exited before readiness"
      break
    fi
    sleep 1
  done

  tail -n 80 "$logfile" >&2 || true
  echo "❌ ${failure:-Podman dev stack did not become ready within ${timeout} seconds}" >&2
  return 1
}

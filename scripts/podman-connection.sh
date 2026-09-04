#!/usr/bin/env bash

# Keep Store on the user's selected engine without managing another VM's lifecycle.
store_select_podman_connection() {
  [ -z "${CONTAINER_CONNECTION:-}" ] || return 0
  case "$(uname -s)" in
    Darwin|MINGW*|MSYS*|CYGWIN*) ;;
    *) return 0 ;;
  esac
  command -v podman >/dev/null 2>&1 || return 0

  local selected_connection=""
  selected_connection="$(podman system connection list \
    --format '{{if .Default}}{{.Name}}{{end}}' 2>/dev/null | awk 'NF {print; exit}' || true)"
  case "$selected_connection" in
    ''|podman-machine-default) return 0 ;;
  esac
  export CONTAINER_CONNECTION="$selected_connection"
}

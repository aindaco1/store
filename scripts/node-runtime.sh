#!/usr/bin/env bash
# Source this file before invoking repository Node tools.
node_has_patched_trust() {
  local version major minor patch
  version="$("$1" --version 2>/dev/null)" || return 1
  [[ "$version" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || return 1
  major="${BASH_REMATCH[1]}"; minor="${BASH_REMATCH[2]}"; patch="${BASH_REMATCH[3]}"
  case "$major" in
    22) (( minor > 23 || (minor == 23 && patch >= 4) )) ;;
    24) (( minor > 22 || (minor == 22 && patch >= 1) )) ;;
    26) (( minor > 12 || (minor == 12 && patch >= 1) )) ;;
    *) return 1 ;;
  esac
}

prefer_current_node_path() {
  local candidate
  if command -v node >/dev/null 2>&1 && node_has_patched_trust "$(command -v node)"; then
    return 0
  fi
  for candidate in "$HOME"/.nvm/versions/node/v24.*/bin "$HOME"/.nvm/versions/node/v22.*/bin "$HOME"/.nvm/versions/node/v26.*/bin; do
    if [[ -x "$candidate/node" ]] && node_has_patched_trust "$candidate/node"; then
      export PATH="$candidate:$PATH"
      return 0
    fi
  done
  echo "Install patched Node 22.23.4+, 24.22.1+, or 26.12.1+ before running these tools." >&2
  return 1
}

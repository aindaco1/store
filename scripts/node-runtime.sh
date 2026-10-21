#!/usr/bin/env bash
# Source this file before invoking repository Node tools.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/shared/dust-wave-platform/packages/node-core/bin/node-runtime.sh"
node_has_patched_trust() {
  dustwave_node_meets_floor "$1" 22.23.4 24.22.1 26.12.1
}
prefer_current_node_path() {
  local runtime_root="${DUSTWAVE_NODE_VERSION_ROOT:-$HOME/.nvm/versions/node}"
  dustwave_prefer_node_path node_has_patched_trust "$runtime_root"/v24.*/bin "$runtime_root"/v22.*/bin "$runtime_root"/v26.*/bin && return 0
  echo "Install patched Node 22.23.4+, 24.22.1+, or 26.12.1+ before running these tools." >&2
  return 1
}

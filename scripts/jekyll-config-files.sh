#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CONFIG_FILES="_config.yml"

if [[ -f "${ROOT_DIR}/_config.local.yml" ]]; then
  CONFIG_FILES="${CONFIG_FILES},_config.local.yml"
fi

printf '%s\n' "${CONFIG_FILES}"

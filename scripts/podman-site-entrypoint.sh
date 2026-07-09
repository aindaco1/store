#!/usr/bin/env bash
set -euo pipefail

JEKYLL_CONFIG_FILES="$(/workspace/scripts/jekyll-config-files.sh /workspace)"

exec /workspace/scripts/podman-jekyll-command.sh bundle exec jekyll serve \
  --config "${JEKYLL_CONFIG_FILES}" \
  --force_polling \
  --host 0.0.0.0 \
  --port 4000

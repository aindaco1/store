#!/usr/bin/env bash
set -euo pipefail

if [[ -f /workspace/_config.local.yml ]]; then
  JEKYLL_CONFIG_FILES="$(/workspace/scripts/jekyll-config-files.sh /workspace)"
else
  TEMP_JEKYLL_CONFIG="$(mktemp /tmp/store-podman-jekyll.XXXXXX.yml)"
  JEKYLL_CONFIG_FILES="$(SITE_BASE="${SITE_BASE:-http://127.0.0.1:4002}" WORKER_BASE="${WORKER_BASE:-http://127.0.0.1:8989}" /workspace/scripts/jekyll-test-config-files.sh "${TEMP_JEKYLL_CONFIG}")"
fi

exec /workspace/scripts/podman-jekyll-command.sh bundle exec jekyll serve \
  --config "${JEKYLL_CONFIG_FILES}" \
  --force_polling \
  --host 0.0.0.0 \
  --port 4000

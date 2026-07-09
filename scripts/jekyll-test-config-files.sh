#!/usr/bin/env bash
set -euo pipefail

OUTPUT_PATH="${1:-}"
if [[ -z "${OUTPUT_PATH}" ]]; then
  echo "Usage: scripts/jekyll-test-config-files.sh <output-yml-path>" >&2
  exit 2
fi

SITE_BASE_VALUE="${SITE_BASE:-${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:4002}}"
WORKER_BASE_VALUE="${WORKER_BASE:-${WORKER_URL:-${PLAYWRIGHT_WORKER_BASE_URL:-http://127.0.0.1:8989}}}"

cat > "${OUTPUT_PATH}" <<EOF
url: "${SITE_BASE_VALUE}"
platform:
  site_url: "${SITE_BASE_VALUE}"
  worker_url: "${WORKER_BASE_VALUE}"
admin:
  turnstile_site_key: ""
EOF

printf '_config.yml,%s\n' "${OUTPUT_PATH}"

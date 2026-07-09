#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf _site .jekyll-cache

TEMP_JEKYLL_CONFIG_DIR="$(mktemp -d /tmp/store-playwright-jekyll.XXXXXX)"
TEMP_JEKYLL_CONFIG="${TEMP_JEKYLL_CONFIG_DIR}/config.yml"
cleanup() {
  rm -rf "${TEMP_JEKYLL_CONFIG_DIR}"
}
trap cleanup EXIT

JEKYLL_CONFIG_FILES="$(./scripts/jekyll-test-config-files.sh "${TEMP_JEKYLL_CONFIG}")"

bundle exec jekyll build --config "${JEKYLL_CONFIG_FILES}" --quiet
cleanup
trap - EXIT

exec python3 -m http.server 4002 --bind 127.0.0.1 --directory _site

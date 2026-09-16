#!/usr/bin/env bash
set -euo pipefail

cd /workspace

bundle config set path "${BUNDLE_PATH:-/usr/local/bundle}" >/dev/null
bundle check >/dev/null 2>&1 || bundle install

# Host and container Ruby processes must not share serialized cache files.
# An interrupted host build or iCloud sync can leave a truncated Marshal entry.
exec "$@" --disable-disk-cache

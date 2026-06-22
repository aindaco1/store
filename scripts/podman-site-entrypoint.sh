#!/usr/bin/env bash
set -euo pipefail

cd /workspace

bundle config set path "${BUNDLE_PATH:-/usr/local/bundle}" >/dev/null
bundle check >/dev/null 2>&1 || bundle install

exec bundle exec jekyll serve \
  --config _config.yml,_config.local.yml \
  --force_polling \
  --host 0.0.0.0 \
  --port 4000

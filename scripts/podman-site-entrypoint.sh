#!/usr/bin/env bash
set -euo pipefail

exec /workspace/scripts/podman-jekyll-command.sh bundle exec jekyll serve \
  --config _config.yml,_config.local.yml \
  --force_polling \
  --host 0.0.0.0 \
  --port 4000

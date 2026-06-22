#!/usr/bin/env bash
set -euo pipefail

cd /workspace/worker

PACKAGE_LOCK_HASH_FILE="node_modules/.package-lock.sha256"
CURRENT_PACKAGE_LOCK_HASH="$(sha256sum package-lock.json | awk '{print $1}')"
INSTALLED_PACKAGE_LOCK_HASH=""

if [ -f "$PACKAGE_LOCK_HASH_FILE" ]; then
  INSTALLED_PACKAGE_LOCK_HASH="$(cat "$PACKAGE_LOCK_HASH_FILE" 2>/dev/null || true)"
fi

if [ ! -d node_modules ] || \
   [ ! -x node_modules/.bin/wrangler ] || \
   [ ! -d node_modules/sales-tax ] || \
   [ "$CURRENT_PACKAGE_LOCK_HASH" != "$INSTALLED_PACKAGE_LOCK_HASH" ]; then
  npm ci
  mkdir -p node_modules
  printf '%s\n' "$CURRENT_PACKAGE_LOCK_HASH" > "$PACKAGE_LOCK_HASH_FILE"
fi

exec npx wrangler dev \
  --env dev \
  --port 8787 \
  --ip 0.0.0.0

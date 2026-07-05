#!/usr/bin/env bash
set -euo pipefail

cd /workspace

LOCKFILE_HASH_FILE="node_modules/.store-package-lock.sha256"
CURRENT_LOCKFILE_HASH="$(sha256sum package-lock.json | awk '{print $1}')"
INSTALLED_LOCKFILE_HASH="$(cat "$LOCKFILE_HASH_FILE" 2>/dev/null || true)"

if [ ! -d node_modules ] || [ ! -x node_modules/.bin/playwright ] || [ "$CURRENT_LOCKFILE_HASH" != "$INSTALLED_LOCKFILE_HASH" ]; then
  npm install
  echo "$CURRENT_LOCKFILE_HASH" > "$LOCKFILE_HASH_FILE"
fi

exec "$@"

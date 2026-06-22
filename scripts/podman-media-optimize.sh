#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

SITE_IMAGE="localhost/store-dev-site:latest"
PODMAN_REBUILD="${PODMAN_REBUILD:-0}"

prefer_podman_path() {
  local candidate=""
  for candidate in \
    "/opt/podman/bin" \
    "/usr/local/podman/bin" \
    "/opt/homebrew/bin" \
    "/usr/local/bin"
  do
    if [ -x "$candidate/podman" ]; then
      export PATH="$candidate:$PATH"
      return 0
    fi
  done
  return 1
}

prefer_podman_path || true

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required for the Podman media optimizer." >&2
  exit 1
fi

if ! podman info >/dev/null 2>&1; then
  ./scripts/podman-doctor.sh >/dev/null
fi

if [ "$PODMAN_REBUILD" = "1" ] || ! podman image exists "$SITE_IMAGE"; then
  echo "Building $SITE_IMAGE..." >&2
  podman build -t "$SITE_IMAGE" -f "$ROOT_DIR/Containerfile.dev" "$ROOT_DIR" >&2
fi

exec podman run --rm \
  -v "$ROOT_DIR:/workspace" \
  -w /workspace \
  "$SITE_IMAGE" \
  node ./scripts/optimize-media.mjs "$@"

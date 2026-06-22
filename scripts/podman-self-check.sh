#!/usr/bin/env bash
set -euo pipefail

echo "Running Podman self-check..."

./scripts/podman-doctor.sh

echo ""
echo "Starting Podman-backed local services..."
PODMAN_SELF_CHECK_LOG="${PODMAN_SELF_CHECK_LOG:-/tmp/store-podman-self-check.log}"
PODMAN_DETACH=true SKIP_STRIPE=true ./scripts/dev.sh --podman > "$PODMAN_SELF_CHECK_LOG" 2>&1

cleanup() {
  podman rm -f store-dev-site store-dev-worker >/dev/null 2>&1 || true
  podman pod rm -f store-dev-pod >/dev/null 2>&1 || true
}

trap cleanup EXIT

for _ in {1..60}; do
  if curl -s http://127.0.0.1:4002 >/dev/null 2>&1 && \
     curl -s http://127.0.0.1:8989/notfound >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -s http://127.0.0.1:4002 >/dev/null 2>&1 || \
   ! curl -s http://127.0.0.1:8989/notfound >/dev/null 2>&1; then
  echo "❌ Podman-backed site/worker did not become ready within 60 seconds"
  exit 1
fi

echo "✅ Podman-backed site and worker are reachable"

./scripts/test-worker.sh

echo ""
echo "Running containerized automated browser suite..."
bash ./scripts/podman-playwright-run.sh npx playwright test

echo ""
echo "✅ Podman self-check passed"

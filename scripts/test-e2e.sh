#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "🚀 Starting E2E tests..."

USE_PODMAN=false
PODMAN_STARTED_BY_SCRIPT=false

for arg in "$@"; do
    if [ "$arg" = "--podman" ]; then
        USE_PODMAN=true
    fi
done

USES_FIRST_PARTY_LOCAL=true

prefer_current_node_path() {
    local candidate=""
    for candidate in \
        "$HOME/.nvm/versions/node/v24.*/bin" \
        "$HOME/.nvm/versions/node/v22.*/bin"
    do
        for resolved in $candidate; do
            if [ -x "$resolved/node" ]; then
                export PATH="$resolved:$PATH"
                return 0
            fi
        done
    done
    return 1
}

prefer_current_node_path || true

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

has_local_secret() {
    local key="$1"
    grep -q "^${key}=" "worker/.dev.vars" 2>/dev/null
}

cleanup() {
    if [ -n "${JEKYLL_PID:-}" ]; then
        kill "$JEKYLL_PID" 2>/dev/null || true
    fi
    if [ "$PODMAN_STARTED_BY_SCRIPT" = "true" ]; then
        podman rm -f store-dev-site store-dev-worker >/dev/null 2>&1 || true
        podman pod rm -f store-dev-pod >/dev/null 2>&1 || true
    fi
    if [ -f "_config.local.yml.bak" ] && [ "${USE_PODMAN:-false}" != "true" ]; then
        mv _config.local.yml.bak _config.local.yml
    fi
}

trap cleanup EXIT

LOCAL_URL="http://127.0.0.1:4002"

if [ "$USE_PODMAN" = "true" ]; then
    prefer_podman_path || true
    echo "📦 Podman mode enabled"
else
    # Kill any existing processes
    pkill -f "jekyll serve" 2>/dev/null || true
    sleep 1

    # Start Jekyll with localhost first (for automated tests)
    echo "🔨 Starting Jekyll (localhost)..."
    rm -rf _site .jekyll-cache

    # Build with localhost for fast automated tests
    sed -i.bak "s|^url:.*|url: $LOCAL_URL|" _config.local.yml
    bundle exec jekyll serve --config _config.yml,_config.local.yml --port 4002 > /tmp/jekyll.log 2>&1 &
    JEKYLL_PID=$!

    # Wait for Jekyll
    for i in {1..30}; do
        if curl -s http://127.0.0.1:4002 > /dev/null 2>&1; then
            echo "✅ Jekyll ready"
            break
        fi
        sleep 1
    done
fi

# Run automated tests against the local stack.
echo ""
echo "🧪 Running automated tests..."
if [ "$USE_PODMAN" = "true" ]; then
    CI=1 ./scripts/podman-playwright-run.sh npx playwright test
    AUTOMATED_EXIT=$?
else
    CI=1 npx playwright test --headed
    AUTOMATED_EXIT=$?
fi

if [ $AUTOMATED_EXIT -ne 0 ]; then
    echo "❌ Automated tests failed"
    exit $AUTOMATED_EXIT
fi

echo ""
echo "✅ Automated tests passed!"
exit 0

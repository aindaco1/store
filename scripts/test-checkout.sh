#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ruby ./scripts/sync-worker-config.rb >/dev/null

USE_PODMAN=false
PODMAN_STARTED_BY_SCRIPT=false

for arg in "$@"; do
    if [ "$arg" = "--podman" ]; then
        USE_PODMAN=true
    fi
done

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

echo "🚀 Starting E2E checkout test..."

cleanup() {
    if [ -n "${JEKYLL_PID:-}" ]; then
        kill "$JEKYLL_PID" 2>/dev/null || true
    fi
    if [ "$PODMAN_STARTED_BY_SCRIPT" = "true" ]; then
        podman rm -f store-dev-site store-dev-worker >/dev/null 2>&1 || true
        podman pod rm -f store-dev-pod >/dev/null 2>&1 || true
    fi
    if [ -f "${BACKUP_FILE:-}" ] && [ "${USE_PODMAN:-false}" != "true" ]; then
        mv "$BACKUP_FILE" "$CONFIG_FILE"
        echo "✅ Restored original $CONFIG_FILE"
    fi
}

trap cleanup EXIT

if [ "$USE_PODMAN" = "true" ]; then
    prefer_podman_path || true
    echo "📦 Starting shared Podman dev stack..."
    PODMAN_DEV_LOG="${PODMAN_DEV_LOG:-/tmp/store-test-checkout-podman.log}"
    PODMAN_DETACH=true ./scripts/dev.sh --podman > "$PODMAN_DEV_LOG" 2>&1
    PODMAN_STARTED_BY_SCRIPT=true

    echo "⏳ Waiting for Podman-backed local services..."
    PODMAN_READY=false
    for i in {1..60}; do
        if curl -s http://127.0.0.1:4002 > /dev/null 2>&1 && \
           curl -s http://127.0.0.1:8989/notfound > /dev/null 2>&1; then
            echo "✅ Podman dev stack is ready"
            PODMAN_READY=true
            break
        fi
        sleep 1
    done

    if [ "$PODMAN_READY" != "true" ]; then
        echo "❌ Podman dev stack did not become ready within 60 seconds"
        exit 1
    fi
fi

CONFIG_FILE="_config.local.yml"
BACKUP_FILE="_config.local.yml.bak"
LOCAL_URL="http://127.0.0.1:4002"

if [ "$USE_PODMAN" != "true" ]; then
    # Kill any existing jekyll processes
    pkill -f "jekyll serve" 2>/dev/null || true
    sleep 1

    # Backup original config
    cp "$CONFIG_FILE" "$BACKUP_FILE"
fi

if [ "$USE_PODMAN" = "true" ]; then
    echo "📝 Using Podman-backed localhost checkout URLs"
else
    sed -i '' "s|^url:.*|url: $LOCAL_URL|" "$CONFIG_FILE"
    echo "📝 Using localhost checkout URLs for first-party local testing"
fi

# Skip prompt if SKIP_CHECKOUT_PROMPT is set
if [ -z "${SKIP_CHECKOUT_PROMPT:-}" ]; then
    read -p "Press Enter to continue (set SKIP_CHECKOUT_PROMPT=1 to skip)..."
fi

if [ "$USE_PODMAN" != "true" ]; then
    # Clear Jekyll cache and start server
    echo "🔨 Building Jekyll..."
    rm -rf _site .jekyll-cache
    bundle exec jekyll serve --config _config.yml,_config.local.yml --port 4002 > /tmp/jekyll.log 2>&1 &
    JEKYLL_PID=$!

    # Wait for Jekyll to be ready
    echo "⏳ Waiting for Jekyll to start..."
    for i in {1..30}; do
        if curl -s http://127.0.0.1:4002 > /dev/null 2>&1; then
            echo "✅ Jekyll is ready"
            break
        fi
        sleep 1
    done
fi

# Run the checkout test
echo "🧪 Running checkout test..."
echo ""
MANUAL_CHECKOUT=1 npm run test:e2e -- --headed --grep "manual checkout"
TEST_EXIT=$?

exit $TEST_EXIT

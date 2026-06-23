#!/bin/bash
# Start all dev services in parallel

set -euo pipefail

for arg in "$@"; do
  if [ "$arg" = "--podman" ]; then
    exec "$(cd "$(dirname "$0")" && pwd)/dev-podman.sh" "$@"
  fi
done

trap 'kill 0' EXIT

JEKYLL_PORT=4002
WORKER_PORT=8989
LOCAL_REPO_SERVICE_PORT=8799
STRIPE_LOG="/tmp/store-stripe-listen.log"
USES_FIRST_PARTY_LOCAL=true
SKIP_STRIPE=false

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

prefer_stripe_path() {
  local candidate=""
  for candidate in \
    "/opt/homebrew/bin" \
    "/usr/local/bin" \
    "$HOME/.local/bin"
  do
    if [ -x "$candidate/stripe" ]; then
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

generate_local_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return 0
  fi

  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
}

ensure_local_secret() {
  local key="$1"
  local value=""

  if has_local_secret "$key"; then
    return 0
  fi

  value="$(generate_local_secret)"
  if [ -z "$value" ]; then
    echo "❌ Failed to generate local secret for $key"
    return 1
  fi

  echo "${key}=${value}" >> worker/.dev.vars
  echo "🔐 Added missing ${key} to worker/.dev.vars"
}

run_stripe_login() {
  echo "🔐 Refreshing Stripe CLI authentication..."
  printf '\n' | stripe login
}

start_stripe_listener() {
  rm -f "$STRIPE_LOG"
  stripe listen --forward-to "127.0.0.1:$WORKER_PORT/webhooks/stripe" > "$STRIPE_LOG" 2>&1 &
  STRIPE_LISTEN_PID=$!
}

wait_for_stripe_secret() {
  local secret=""
  for _ in $(seq 1 20); do
    if [ -f "$STRIPE_LOG" ]; then
      secret=$(grep -Eo 'whsec_[A-Za-z0-9_]+' "$STRIPE_LOG" 2>/dev/null | head -1 || true)
      if [ -n "$secret" ]; then
        echo "$secret"
        return 0
      fi
      if grep -q "Authorization failed" "$STRIPE_LOG"; then
        return 1
      fi
    fi
    sleep 1
  done
  return 1
}

kill_port_if_busy() {
  local port="$1"
  local label="$2"
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids=$(lsof -ti tcp:"$port" || true)
    if [ -n "$pids" ]; then
      echo "🔄 Clearing existing $label process(es) on port $port..."
      while IFS= read -r pid; do
        [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
      done <<< "$pids"
      sleep 1
    fi
  fi
}

echo "🚀 Starting development environment..."

prefer_current_node_path || true
prefer_stripe_path || true

ruby ./scripts/sync-worker-config.rb

"$(cd "$(dirname "$0")" && pwd)/configure-dev-secrets.sh" --non-interactive

# Check Stripe CLI login
if ! stripe config --list &>/dev/null; then
  echo "⚠️  Not logged into Stripe CLI. Running 'stripe login'..."
  run_stripe_login
  if [ $? -ne 0 ]; then
    echo "❌ Stripe login failed. Continuing without webhook forwarding."
    SKIP_STRIPE=true
  fi
fi

# Clear stale local services so the dev environment matches the test harness ports.
kill_port_if_busy "$JEKYLL_PORT" "Jekyll"
kill_port_if_busy "$WORKER_PORT" "Worker"
kill_port_if_busy "$LOCAL_REPO_SERVICE_PORT" "local repo service"

# Jekyll (without livereload - causes issues with iCloud Drive sync)
echo "📦 Starting Jekyll..."
bundle exec jekyll serve --config _config.yml,_config.local.yml --port "$JEKYLL_PORT" &

# Wrangler (worker) - use local simulation for KV, Durable Objects, and R2.
# Note: production orders live in remote Cloudflare resources, not local dev state.
echo "⚡ Starting Wrangler (local KV)..."
(cd worker && {
  prefer_current_node_path || true
  node src/local-repo-service.mjs &
  LOCAL_REPO_SERVICE_PID=$!
  trap 'kill "$LOCAL_REPO_SERVICE_PID" >/dev/null 2>&1 || true' EXIT INT TERM
  npx wrangler dev --env dev --port "$WORKER_PORT"
}) &

# Stripe CLI (forward webhooks to local worker)
if [ "${SKIP_STRIPE:-false}" != "true" ]; then
  echo "💳 Starting Stripe webhook forwarding..."
  start_stripe_listener

  echo "💳 Waiting for Stripe webhook secret..."
  STRIPE_SECRET="$(wait_for_stripe_secret || true)"

  if [ -z "$STRIPE_SECRET" ] && [ -f "$STRIPE_LOG" ] && grep -q "Authorization failed" "$STRIPE_LOG"; then
    echo "⚠️  Stripe CLI authentication appears stale. Re-running 'stripe login'..."
    kill "$STRIPE_LISTEN_PID" 2>/dev/null || true
    wait "$STRIPE_LISTEN_PID" 2>/dev/null || true
    if run_stripe_login; then
      echo "💳 Retrying Stripe webhook forwarding..."
      start_stripe_listener
      STRIPE_SECRET="$(wait_for_stripe_secret || true)"
    else
      echo "❌ Stripe login failed. Continuing without webhook forwarding."
      SKIP_STRIPE=true
    fi
  fi

  if [ "${SKIP_STRIPE:-false}" != "true" ] && [ -n "$STRIPE_SECRET" ]; then
    DEV_VARS="worker/.dev.vars"
    if [ -f "$DEV_VARS" ]; then
      if grep -q "^STRIPE_WEBHOOK_SECRET=" "$DEV_VARS"; then
        sed -i '' "s|^STRIPE_WEBHOOK_SECRET=.*|STRIPE_WEBHOOK_SECRET=$STRIPE_SECRET|" "$DEV_VARS"
      else
        echo "STRIPE_WEBHOOK_SECRET=$STRIPE_SECRET" >> "$DEV_VARS"
      fi
      echo "   Updated $DEV_VARS with Stripe listener secret"
    fi
  elif [ "${SKIP_STRIPE:-false}" != "true" ]; then
    echo "⚠️  Could not detect Stripe webhook secret from listener output"
    if [ -f "$STRIPE_LOG" ] && grep -q "Authorization failed" "$STRIPE_LOG"; then
      echo "   Stripe CLI authentication failed even after retrying login."
    fi
    echo "   Check $STRIPE_LOG and update worker/.dev.vars manually if needed"
    SKIP_STRIPE=true
  fi
else
  echo "⏭️  Skipping Stripe webhook forwarding"
fi

echo ""
echo "✅ All services starting..."
echo "   Jekyll:   http://127.0.0.1:$JEKYLL_PORT"
echo "   Worker:   http://127.0.0.1:$WORKER_PORT"
echo "   Local repo writes: http://127.0.0.1:$LOCAL_REPO_SERVICE_PORT"
if [ "${SKIP_STRIPE:-false}" = "true" ]; then
  echo "   Stripe:   webhook forwarding inactive"
else
  echo "   Stripe:   forwarding to worker"
fi
echo ""
echo "💡 TROUBLESHOOTING:"
echo "   If a Stripe checkout completes but an order doesn't appear:"
echo "   1. Check Stripe CLI output for webhook delivery"
echo "   2. If Stripe forwarding is inactive, rerun ./scripts/dev.sh and finish the browser auth"
echo "   3. Check http://127.0.0.1:$JEKYLL_PORT/admin/ for Store order state"
echo ""
echo "🧪 USEFUL CHECKS:"
echo "   npm run test:secrets"
echo "   npm run test:content-security"
echo "   ./scripts/test-worker.sh"
echo ""
echo "Press Ctrl+C to stop all services"

wait

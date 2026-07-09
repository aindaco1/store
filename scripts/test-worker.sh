#!/bin/bash
# Test Worker endpoints against local Jekyll site
# Run manually, or via `RUN_POST_BUILD_TESTS=1 bundle exec jekyll build`

set -e

cd "$(dirname "$0")/.."

ruby ./scripts/sync-worker-config.rb >/dev/null

USE_PODMAN=false
PODMAN_STARTED_BY_SCRIPT=false
DEV_PID=""
STOP_FILE=""

for arg in "$@"; do
  if [ "$arg" = "--podman" ]; then
    USE_PODMAN=true
  fi
done

SITE_URL="${SITE_URL:-http://127.0.0.1:4002}"
WORKER_URL="${WORKER_URL:-http://127.0.0.1:8989}"
REQUEST_IP="${REQUEST_IP:-127.0.0.$(( (RANDOM % 200) + 20 ))}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

WORKER_HEADERS=(
  -H "CF-Connecting-IP: ${REQUEST_IP}"
  -H "X-Forwarded-For: ${REQUEST_IP}"
)

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

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

podman_stack_ready() {
  podman info >/dev/null 2>&1 || return 1
  podman exec store-dev-worker true >/dev/null 2>&1 || return 1
  podman exec store-dev-site true >/dev/null 2>&1 || return 1
  curl -fsS "$SITE_URL" >/dev/null 2>&1 || return 1

  local status=""
  status="$(curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$WORKER_URL/api/cart/validate" \
    "${WORKER_HEADERS[@]}" \
    -H "Content-Type: application/json" \
    --data '{"items":[{"id":"t-shirt-2__m","price":30,"quantity":1}]}' 2>/dev/null || true)"
  [ "$status" = "200" ]
}

cleanup_podman_stack() {
  podman rm -f store-dev-site store-dev-worker >/dev/null 2>&1 || true
  podman pod rm -f store-dev-pod >/dev/null 2>&1 || true
}

request_json() {
  local method="$1"
  local url="$2"
  local payload="$3"
  local body_file
  body_file=$(mktemp)

  REQUEST_STATUS=$(curl -s -o "$body_file" -w "%{http_code}" -X "$method" "$url" \
    "${WORKER_HEADERS[@]}" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null || true)
  REQUEST_BODY=$(cat "$body_file")
  rm -f "$body_file"
}

cleanup() {
  if [ "$PODMAN_STARTED_BY_SCRIPT" = "true" ]; then
    if [ -n "$STOP_FILE" ]; then
      touch "$STOP_FILE" 2>/dev/null || true
    fi
    if [ -n "$DEV_PID" ]; then
      wait "$DEV_PID" 2>/dev/null || true
    fi
    rm -f "$STOP_FILE" 2>/dev/null || true
    cleanup_podman_stack
  fi
}

finish() {
  local status=$?
  trap - EXIT
  cleanup
  exit "$status"
}

trap finish EXIT

if [ "$USE_PODMAN" = "true" ]; then
  prefer_podman_path || true
  if podman_stack_ready; then
    echo "✅ Reusing existing Podman dev stack"
  else
    echo "📦 Starting shared Podman dev stack..."
    PODMAN_DEV_LOG="${PODMAN_DEV_LOG:-/tmp/store-test-worker-podman.log}"
    STOP_FILE="$(mktemp /tmp/store-test-worker-stop.XXXXXX)"
    rm -f "$STOP_FILE"
    PODMAN_STOP_FILE="$STOP_FILE" PODMAN_RESET_WRANGLER_STATE=true SKIP_STRIPE=true ./scripts/dev.sh --podman > "$PODMAN_DEV_LOG" 2>&1 &
    DEV_PID=$!
    PODMAN_STARTED_BY_SCRIPT=true

    echo "⏳ Waiting for Podman-backed local services..."
    PODMAN_READY=false
    for _ in {1..60}; do
      if podman_stack_ready; then
        echo "✅ Podman dev stack is ready"
        PODMAN_READY=true
        break
      fi
      if ! kill -0 "$DEV_PID" 2>/dev/null; then
        tail -n 80 "$PODMAN_DEV_LOG" >&2 || true
        fail "Podman dev stack process exited before readiness"
      fi
      sleep 1
    done

    if [ "$PODMAN_READY" != "true" ]; then
      tail -n 80 "$PODMAN_DEV_LOG" >&2 || true
      fail "Podman dev stack did not become ready within 60 seconds"
    fi
  fi
fi

echo "Testing Worker endpoints..."
echo "Site: $SITE_URL | Worker: $WORKER_URL"
echo ""

# 1. Test Store product catalog exists
echo "--- Store Catalog Data ---"
PRODUCTS=$(curl -sf "$SITE_URL/api/products.json" 2>/dev/null) || fail "products.json not accessible at $SITE_URL/api/products.json"
pass "products.json accessible"

echo "$PRODUCTS" | jq -e '.products | length > 0' > /dev/null 2>&1 || fail "products.json has no products"
COUNT=$(echo "$PRODUCTS" | jq '.products | length')
pass "Found $COUNT Store products"

echo "$PRODUCTS" | jq -e '.products[] | select(.id == "t-shirt-2")' > /dev/null 2>&1 || fail "products.json is missing expected t-shirt-2 product"
pass "Expected Store product present"

ADD_ONS=$(curl -sf "$SITE_URL/api/add-ons.json" 2>/dev/null) || fail "add-ons.json not accessible at $SITE_URL/api/add-ons.json"
echo "$ADD_ONS" | jq -e '.products' > /dev/null 2>&1 || fail "add-ons.json is not a Store add-on catalog"
pass "add-ons.json accessible"

# 2. Test Worker is running
echo ""
echo "--- Worker Endpoints ---"
WORKER_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${WORKER_HEADERS[@]}" "$WORKER_URL/notfound" 2>/dev/null || true)
if [ -z "$WORKER_STATUS" ] || [ "$WORKER_STATUS" = "000" ]; then
  warn "Worker not running at $WORKER_URL (start with: npm --prefix worker run dev)"
  exit 0
fi
pass "Worker responding (HTTP $WORKER_STATUS)"

# 3. Test Store cart validation accepts a canonical catalog item
request_json "POST" "$WORKER_URL/api/cart/validate" '{"items":[{"id":"t-shirt-2__m","price":30,"quantity":2}]}'
[ "$REQUEST_STATUS" = "200" ] || fail "/api/cart/validate should accept a valid Store cart (got $REQUEST_STATUS: $REQUEST_BODY)"
echo "$REQUEST_BODY" | jq -e '.ok == true and .valid == true and .totals.itemCount == 2' > /dev/null 2>&1 || fail "/api/cart/validate returned an unexpected valid-cart response"
pass "/api/cart/validate accepts valid Store carts"

# 4. Test Store cart validation fail-closes on tampered prices
request_json "POST" "$WORKER_URL/api/cart/validate" '{"items":[{"id":"t-shirt-2__m","price":1,"quantity":1}]}'
[ "$REQUEST_STATUS" = "422" ] || fail "/api/cart/validate should reject a tampered Store cart (got $REQUEST_STATUS: $REQUEST_BODY)"
echo "$REQUEST_BODY" | jq -e '.ok == false and .valid == false and (.errors | length > 0)' > /dev/null 2>&1 || fail "/api/cart/validate returned an unexpected tampered-cart response"
pass "/api/cart/validate rejects tampered Store carts"

# 5. Test Store checkout intent requires a valid payload
request_json "POST" "$WORKER_URL/api/checkout/intent" '{"items":[{"id":"bad-item","quantity":1}]}'
if [ "$REQUEST_STATUS" = "200" ]; then
  fail "/api/checkout/intent should not create an order from a malformed Store cart"
fi
echo "$REQUEST_BODY" | grep -Eq "error|errors|Invalid|not configured|Rate limit" || fail "/api/checkout/intent should fail closed on malformed checkout starts"
pass "/api/checkout/intent fail-closes on malformed Store checkout payloads"

echo ""
echo -e "${GREEN}All tests passed!${NC}"

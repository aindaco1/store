#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

ruby ./scripts/sync-worker-config.rb
./scripts/configure-dev-secrets.sh --non-interactive

JEKYLL_PORT=4002
WORKER_PORT=8989
STRIPE_LOG="/tmp/store-stripe-listen.log"
POD_NAME="store-dev-pod"
SITE_CONTAINER="store-dev-site"
WORKER_CONTAINER="store-dev-worker"
SITE_IMAGE="localhost/store-dev-site:latest"
WORKER_IMAGE="localhost/store-dev-worker:latest"
PODMAN_DEV_LABEL="store.dev.stack=store"
WORKER_NODE_IMAGE="${PODMAN_WORKER_NODE_IMAGE:-}"
SITE_VOLUME="store-dev-bundle"
WORKER_NODE_MODULES_VOLUME="store-dev-worker-node-modules"
SKIP_STRIPE="${SKIP_STRIPE:-false}"
PODMAN_REBUILD="${PODMAN_REBUILD:-0}"
PODMAN_SOCKET=""
PODMAN_DETACH="${PODMAN_DETACH:-false}"
PODMAN_SUPERVISE_INTERVAL="${PODMAN_SUPERVISE_INTERVAL:-2}"
PODMAN_SUPERVISE_LOG_LINES="${PODMAN_SUPERVISE_LOG_LINES:-30}"
PODMAN_STACK_START_ATTEMPTS="${PODMAN_STACK_START_ATTEMPTS:-3}"
PODMAN_STACK_RETRY_DELAY="${PODMAN_STACK_RETRY_DELAY:-3}"
PODMAN_SITE_READY_TIMEOUT="${PODMAN_SITE_READY_TIMEOUT:-180}"
PODMAN_WORKER_READY_TIMEOUT="${PODMAN_WORKER_READY_TIMEOUT:-60}"
PODMAN_RESET_WRANGLER_STATE="${PODMAN_RESET_WRANGLER_STATE:-false}"
PODMAN_STOP_FILE="${PODMAN_STOP_FILE:-}"

detect_podman_socket() {
  podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}' podman-machine-default 2>/dev/null || true
}

configure_podman_connection() {
  local socket_path="${1:-}"

  if [ -z "$socket_path" ]; then
    socket_path="$(detect_podman_socket)"
  fi

  PODMAN_SOCKET="$socket_path"
  if [ -n "$socket_path" ]; then
    unset CONTAINER_CONNECTION
    export CONTAINER_HOST="unix://${socket_path}"
  fi
}

podman_machine_log_path() {
  local socket_path="${PODMAN_SOCKET:-}"

  if [ -z "$socket_path" ]; then
    socket_path="$(detect_podman_socket)"
  fi

  if [ -n "$socket_path" ]; then
    echo "$(dirname "$socket_path")/podman-machine-default.log"
  fi
}

ensure_podman_stability() {
  local os_family="$1"
  local log_path=""

  if ! { [ "$os_family" = "macos" ] || [ "$os_family" = "windows" ]; }; then
    return 0
  fi

  for _ in $(seq 1 5); do
    configure_podman_connection
    if ! podman info >/dev/null 2>&1; then
      echo "❌ Podman machine became unreachable immediately after startup."
      log_path="$(podman_machine_log_path)"
      if [ -n "$log_path" ] && [ -f "$log_path" ]; then
        echo "   Podman machine log: $log_path"
        tail -n 20 "$log_path" || true
      fi
      return 1
    fi
    sleep 1
  done

  return 0
}

for arg in "$@"; do
  if [ "$arg" = "--detach" ]; then
    PODMAN_DETACH=true
  fi
done

detect_os_family() {
  case "$(uname -s)" in
    Darwin)
      echo "macos"
      ;;
    Linux)
      echo "linux"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "windows"
      ;;
    *)
      echo "unknown"
      ;;
  esac
}

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

is_podman_managed_pid() {
  local pid="$1"
  local process_name=""
  local process_args=""

  process_name="$(ps -p "$pid" -o comm= 2>/dev/null | tr -d '[:space:]' || true)"
  process_args="$(ps -p "$pid" -o args= 2>/dev/null || true)"

  [[ "$process_name $process_args" == *gvproxy* ]] || \
    [[ "$process_name $process_args" == *podman* ]] || \
    [[ "$process_name $process_args" == *qemu* ]] || \
    [[ "$process_name $process_args" == *vfkit* ]]
}

has_clearable_port_listener() {
  local port="$1"
  local pid=""

  if ! command -v lsof >/dev/null 2>&1; then
    return 1
  fi

  while IFS= read -r pid; do
    [ -z "$pid" ] && continue
    if ! is_podman_managed_pid "$pid"; then
      return 0
    fi
  done <<< "$(lsof -ti tcp:"$port" || true)"

  return 1
}

signal_clearable_port_listeners() {
  local port="$1"
  local signal="$2"
  local pid=""

  while IFS= read -r pid; do
    [ -z "$pid" ] && continue
    if is_podman_managed_pid "$pid"; then
      echo "   Skipping Podman-managed listener on port $port (pid $pid)."
      continue
    fi
    kill "-$signal" "$pid" 2>/dev/null || true
  done <<< "$(lsof -ti tcp:"$port" || true)"
}

kill_port_if_busy() {
  local port="$1"
  local label="$2"
  local pids=""

  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi

  pids="$(lsof -ti tcp:"$port" || true)"
  if [ -z "$pids" ]; then
    return 0
  fi

  echo "🔄 Clearing existing $label process(es) on port $port..."
  signal_clearable_port_listeners "$port" "TERM"
  for _ in $(seq 1 5); do
    if ! has_clearable_port_listener "$port"; then
      return 0
    fi
    sleep 1
  done

  echo "   Escalating stale $label listener cleanup on port $port..."
  signal_clearable_port_listeners "$port" "KILL"
  sleep 1
}

wait_for_port_release() {
  local port="$1"
  local label="$2"

  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi

  for _ in $(seq 1 20); do
    if ! lsof -ti tcp:"$port" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "⚠️  Port $port is still in use after cleaning up $label."
  lsof -nP -iTCP:"$port" -sTCP:LISTEN || true
  return 1
}

ensure_podman_ready() {
  if ! command -v podman >/dev/null 2>&1; then
    echo "❌ Podman is required for --podman mode."
    echo "   Install it from https://podman.io/docs/installation"
    exit 1
  fi

  local os_family
  os_family="$(detect_os_family)"

  if [ "$os_family" = "macos" ] || [ "$os_family" = "windows" ]; then
    local machine_vmtype=""
    machine_vmtype="$(podman machine info 2>/dev/null | awk '/vmtype:/ {print $2}' | head -n 1 || true)"
    if [ "$os_family" = "macos" ] && [ -n "$machine_vmtype" ] && [ "$machine_vmtype" = "applehv" ]; then
      echo "⚠️  Podman is using the applehv backend on macOS."
      echo "   If Podman machine startup is unstable, prefer libkrun via ~/.config/containers/containers.conf:"
      echo "   [machine]"
      echo "   provider = \"libkrun\""
    fi
    if ! podman machine inspect >/dev/null 2>&1; then
      echo "🛠️  Initializing default Podman machine..."
      podman machine init
    fi
    local machine_state=""
    machine_state="$(podman machine inspect --format '{{.State}}' podman-machine-default 2>/dev/null || true)"
    if [ "$machine_state" != "running" ]; then
      echo "🚀 Ensuring Podman machine is running..."
      podman machine start --quiet --no-info podman-machine-default >/tmp/store-podman-machine-start.log 2>&1 || true
    else
      echo "✅ Podman machine already running"
    fi
    configure_podman_connection
  fi

  echo "⏳ Waiting for Podman API to become ready..."
  local ready=0
  local attempted_restart=0
  for _ in $(seq 1 60); do
    if { [ "$os_family" = "macos" ] || [ "$os_family" = "windows" ]; }; then
      configure_podman_connection
    fi
    if podman info >/dev/null 2>&1; then
      ready=1
      break
    fi
    if [ "$ready" != "1" ] && [ "$attempted_restart" = "0" ] && { [ "$os_family" = "macos" ] || [ "$os_family" = "windows" ]; }; then
      local machine_state=""
      machine_state="$(podman machine inspect --format '{{.State}}' podman-machine-default 2>/dev/null || true)"
      if [ "$machine_state" = "running" ]; then
        echo "🔄 Podman machine looks stale; restarting it..."
        podman machine stop podman-machine-default >/tmp/store-podman-machine-stop.log 2>&1 || true
        podman machine start --quiet --no-info podman-machine-default >/tmp/store-podman-machine-start.log 2>&1 || true
        configure_podman_connection
        attempted_restart=1
      fi
    fi
    sleep 2
  done

  if [ "$ready" != "1" ]; then
    if [ "$os_family" = "linux" ]; then
      echo "❌ Podman API did not become ready."
    else
      echo "❌ Podman machine did not become ready."
    fi
    local podman_log=""
    if [ -n "${PODMAN_SOCKET:-}" ]; then
      podman_log="$(dirname "$PODMAN_SOCKET")/podman-machine-default.log"
    fi
    if [ -n "$podman_log" ] && [ -f "$podman_log" ]; then
      if grep -q "Entering emergency mode" "$podman_log" || grep -q "Ignition has failed" "$podman_log"; then
        echo "   The Podman VM booted into emergency mode."
        echo "   Host fix: podman machine rm -f podman-machine-default && podman machine init --now"
        echo "   Last machine log lines:"
        tail -n 20 "$podman_log" || true
        exit 1
      fi
    fi
    if [ "$os_family" = "linux" ]; then
      echo "   Try: podman info"
      echo "   If that fails, restart your rootless Podman service/session and rerun this command."
    else
      echo "   Try: podman machine stop && podman machine start"
    fi
    exit 1
  fi

  local rootless
  rootless="$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null || echo true)"
  if [ "$rootless" != "true" ]; then
    echo "❌ Podman must run rootless for this local dev path."
    exit 1
  fi

  ensure_podman_stability "$os_family" || exit 1
}

build_image_if_needed() {
  local image="$1"
  local context="$2"
  local file="$3"
  shift 3

  if [ "$PODMAN_REBUILD" = "1" ] || ! podman image exists "$image"; then
    echo "🔨 Building $image..."
    podman build "$@" -t "$image" -f "$file" "$context"
  fi
}

cleanup_pod() {
  local id=""

  podman rm -f "$SITE_CONTAINER" "$WORKER_CONTAINER" >/dev/null 2>&1 || true
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    podman rm -f "$id" >/dev/null 2>&1 || true
  done <<< "$(podman ps -aq --filter "label=${PODMAN_DEV_LABEL}" 2>/dev/null || true)"

  podman pod rm -f "$POD_NAME" >/dev/null 2>&1 || true
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    podman pod rm -f "$id" >/dev/null 2>&1 || true
  done <<< "$(podman pod ps -q --filter "label=${PODMAN_DEV_LABEL}" 2>/dev/null || true)"

  for _ in $(seq 1 8); do
    if ! podman container exists "$SITE_CONTAINER" >/dev/null 2>&1 && \
       ! podman container exists "$WORKER_CONTAINER" >/dev/null 2>&1 && \
       ! podman pod exists "$POD_NAME" >/dev/null 2>&1; then
      return 0
    fi
    podman rm -f "$SITE_CONTAINER" "$WORKER_CONTAINER" >/dev/null 2>&1 || true
    podman pod rm -f "$POD_NAME" >/dev/null 2>&1 || true
    sleep 1
  done

  echo "⚠️  Podman did not fully remove the previous dev pod; continuing with a clean-create attempt."
  print_dev_stack_state
  return 0
}

print_dev_stack_state() {
  echo "   Current Podman dev stack state:"
  podman pod inspect "$POD_NAME" --format "   pod ${POD_NAME}: {{.State}}" 2>/dev/null || echo "   pod ${POD_NAME}: missing"
  podman inspect --format "   ${SITE_CONTAINER}: {{.State.Status}} (exit {{.State.ExitCode}})" "$SITE_CONTAINER" 2>/dev/null || echo "   ${SITE_CONTAINER}: missing"
  podman inspect --format "   ${WORKER_CONTAINER}: {{.State.Status}} (exit {{.State.ExitCode}})" "$WORKER_CONTAINER" 2>/dev/null || echo "   ${WORKER_CONTAINER}: missing"
}

recover_podman_stack_start() {
  local attempt="$1"
  local os_family=""

  print_dev_stack_state
  cleanup_pod

  os_family="$(detect_os_family)"
  if [ "$attempt" -ge 2 ] && { [ "$os_family" = "macos" ] || [ "$os_family" = "windows" ]; }; then
    echo "🔄 Restarting Podman machine to clear stale libpod state..."
    podman machine stop podman-machine-default >/tmp/store-podman-machine-stop.log 2>&1 || true
    podman machine start --quiet --no-info podman-machine-default >/tmp/store-podman-machine-start.log 2>&1 || true
    configure_podman_connection
    ensure_podman_stability "$os_family" || return 1
  else
    ensure_podman_ready || return 1
  fi

  sleep "$PODMAN_STACK_RETRY_DELAY"
}

start_pod_containers() {
  echo "📦 Starting Podman dev pod..."
  podman pod create \
    --name "$POD_NAME" \
    --label "$PODMAN_DEV_LABEL" \
    -p "127.0.0.1:${JEKYLL_PORT}:4000" \
    -p "127.0.0.1:${WORKER_PORT}:8787" >/dev/null || return 1
  podman pod start "$POD_NAME" >/dev/null || return 1

  podman run -d \
    --name "$SITE_CONTAINER" \
    --pod "$POD_NAME" \
    --label "$PODMAN_DEV_LABEL" \
    --restart=unless-stopped \
    -v "$ROOT_DIR:/workspace" \
    -v "$SITE_VOLUME:/usr/local/bundle" \
    "$SITE_IMAGE" >/dev/null || return 1

  podman run -d \
    --name "$WORKER_CONTAINER" \
    --pod "$POD_NAME" \
    --label "$PODMAN_DEV_LABEL" \
    --restart=unless-stopped \
    -v "$ROOT_DIR:/workspace" \
    -v "$WORKER_NODE_MODULES_VOLUME:/workspace/worker/node_modules" \
    "$WORKER_IMAGE" >/dev/null || return 1
}

start_dev_stack_once() {
  cleanup_pod
  kill_port_if_busy "$JEKYLL_PORT" "Jekyll" || return 1
  kill_port_if_busy "$WORKER_PORT" "Worker" || return 1
  wait_for_port_release "$JEKYLL_PORT" "Jekyll" || return 1
  wait_for_port_release "$WORKER_PORT" "Worker" || return 1
  if ! start_pod_containers; then
    cleanup_pod
    return 1
  fi
  if ! container_running "$SITE_CONTAINER" || ! container_running "$WORKER_CONTAINER"; then
    print_dev_stack_state
    cleanup_pod
    return 1
  fi
  wait_for_site_http "http://127.0.0.1:${JEKYLL_PORT}" "Jekyll" || return 1
  wait_for_worker_http "http://127.0.0.1:${WORKER_PORT}/notfound" "Worker" || return 1
}

reset_wrangler_local_state_if_requested() {
  if [ "$PODMAN_RESET_WRANGLER_STATE" != "true" ]; then
    return 0
  fi

  echo "🧹 Resetting local Wrangler state for Podman test run..."
  rm -rf "$ROOT_DIR/worker/.wrangler/state" "$ROOT_DIR/worker/.wrangler/tmp"
}

start_dev_stack() {
  local attempt=1

  while [ "$attempt" -le "$PODMAN_STACK_START_ATTEMPTS" ]; do
    if start_dev_stack_once; then
      return 0
    fi

    echo "⚠️  Podman dev stack failed to start on attempt ${attempt}/${PODMAN_STACK_START_ATTEMPTS}."
    if [ "$attempt" -ge "$PODMAN_STACK_START_ATTEMPTS" ]; then
      print_dev_stack_state
      cleanup_pod
      return 1
    fi

    recover_podman_stack_start "$attempt" || return 1
    attempt=$((attempt + 1))
  done

  return 1
}

wait_for_site_http() {
  local url="$1"
  local label="$2"
  for _ in $(seq 1 "$PODMAN_SITE_READY_TIMEOUT"); do
    if ! container_running "$SITE_CONTAINER"; then
      echo "❌ $label container stopped before it became ready"
      echo "   Last $PODMAN_SUPERVISE_LOG_LINES $label log lines:"
      podman logs --tail "$PODMAN_SUPERVISE_LOG_LINES" "$SITE_CONTAINER" 2>&1 | sed 's/^/   /' || true
      return 1
    fi
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "✅ $label ready"
      return 0
    fi
    sleep 1
  done

  echo "❌ $label failed to start within ${PODMAN_SITE_READY_TIMEOUT}s"
  echo "   Last $PODMAN_SUPERVISE_LOG_LINES $label log lines:"
  podman logs --tail "$PODMAN_SUPERVISE_LOG_LINES" "$SITE_CONTAINER" 2>&1 | sed 's/^/   /' || true
  return 1
}

container_running() {
  local container="$1"
  [ "$(podman inspect --format '{{.State.Running}}' "$container" 2>/dev/null || echo false)" = "true" ]
}

container_status_summary() {
  local container="$1"
  podman inspect --format '{{.State.Status}} (exit {{.State.ExitCode}})' "$container" 2>/dev/null || echo "missing"
}

restart_dev_container() {
  local container="$1"
  local label="$2"
  local wait_function="$3"
  local wait_url="$4"
  local status=""

  status="$(container_status_summary "$container")"
  echo "⚠️  $label container stopped: $status"
  echo "   Last $PODMAN_SUPERVISE_LOG_LINES $label log lines:"
  podman logs --tail "$PODMAN_SUPERVISE_LOG_LINES" "$container" 2>&1 | sed 's/^/   /' || true

  echo "🔄 Restarting $label container..."
  if ! podman start "$container" >/dev/null; then
    echo "⚠️  Could not restart $label container directly; recreating the Podman dev stack with recovery retries..."
    start_dev_stack || return 1
    return 0
  fi

  if ! "$wait_function" "$wait_url" "$label"; then
    echo "⚠️  $label did not become healthy after restart; recreating the Podman dev stack with recovery retries..."
    start_dev_stack || return 1
  fi
}

retry_later() {
  local reason="$1"
  echo "⚠️  ${reason}; will retry in ${PODMAN_STACK_RETRY_DELAY}s."
  sleep "$PODMAN_STACK_RETRY_DELAY"
}

supervise_dev_stack() {
  echo "🛡️  Supervising Podman containers; stopped services will be restarted automatically"
  while true; do
    if [ -n "$PODMAN_STOP_FILE" ] && [ -f "$PODMAN_STOP_FILE" ]; then
      echo "🛑 Podman stop file detected; stopping dev stack..."
      return 0
    fi

    sleep "$PODMAN_SUPERVISE_INTERVAL"

    if [ -n "$PODMAN_STOP_FILE" ] && [ -f "$PODMAN_STOP_FILE" ]; then
      echo "🛑 Podman stop file detected; stopping dev stack..."
      return 0
    fi

    if ! podman info >/dev/null 2>&1; then
      echo "⚠️  Podman became unreachable; attempting to recover the Podman machine..."
      if ! ensure_podman_ready || ! start_dev_stack; then
        retry_later "Podman recovery did not complete"
      fi
      continue
    fi

    if ! podman pod exists "$POD_NAME" >/dev/null 2>&1; then
      echo "⚠️  Podman dev pod is missing; recreating it..."
      if ! start_dev_stack; then
        retry_later "Podman dev pod recreation failed"
      fi
      continue
    fi

    if ! podman container exists "$SITE_CONTAINER" >/dev/null 2>&1 || \
       ! podman container exists "$WORKER_CONTAINER" >/dev/null 2>&1; then
      echo "⚠️  One or more dev containers are missing; recreating the Podman dev stack..."
      if ! start_dev_stack; then
        retry_later "Podman dev stack recreation failed"
      fi
      continue
    fi

    if ! container_running "$SITE_CONTAINER"; then
      if ! restart_dev_container "$SITE_CONTAINER" "Jekyll" wait_for_site_http "http://127.0.0.1:${JEKYLL_PORT}"; then
        retry_later "Jekyll restart failed"
      fi
    fi

    if ! container_running "$WORKER_CONTAINER"; then
      if ! restart_dev_container "$WORKER_CONTAINER" "Worker" wait_for_worker_http "http://127.0.0.1:${WORKER_PORT}/notfound"; then
        retry_later "Worker restart failed"
      fi
    fi
  done
}

wait_for_worker_http() {
  local url="$1"
  local label="$2"
  local status=""
  for _ in $(seq 1 "$PODMAN_WORKER_READY_TIMEOUT"); do
    if ! container_running "$WORKER_CONTAINER"; then
      echo "❌ $label container stopped before it became ready"
      echo "   Last $PODMAN_SUPERVISE_LOG_LINES $label log lines:"
      podman logs --tail "$PODMAN_SUPERVISE_LOG_LINES" "$WORKER_CONTAINER" 2>&1 | sed 's/^/   /' || true
      return 1
    fi
    status="$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || true)"
    if [ -n "$status" ] && [ "$status" != "000" ]; then
      echo "✅ $label ready"
      return 0
    fi
    sleep 1
  done

  echo "❌ $label failed to start within ${PODMAN_WORKER_READY_TIMEOUT}s"
  return 1
}

cleanup() {
  if [ -n "${STRIPE_LISTEN_PID:-}" ]; then
    kill "$STRIPE_LISTEN_PID" >/dev/null 2>&1 || true
  fi
  cleanup_pod
}

if [ "$PODMAN_DETACH" != "true" ]; then
  trap 'cleanup' EXIT
fi

prefer_current_node_path || true
prefer_podman_path || true
prefer_stripe_path || true
ensure_podman_ready

cleanup_pod
ensure_podman_ready
cleanup_pod
kill_port_if_busy "$JEKYLL_PORT" "Jekyll"
kill_port_if_busy "$WORKER_PORT" "Worker"
ensure_podman_ready

build_image_if_needed "$SITE_IMAGE" "$ROOT_DIR" "$ROOT_DIR/Containerfile.dev"
if [ -z "$WORKER_NODE_IMAGE" ] && \
   ! podman image exists "docker.io/library/node:24-bookworm-slim" && \
   podman image exists "mcr.microsoft.com/playwright:v1.57.0-noble"; then
  WORKER_NODE_IMAGE="mcr.microsoft.com/playwright:v1.57.0-noble"
  echo "ℹ️  Using cached Playwright Node 24 image for the Worker dev base."
fi

if [ -n "$WORKER_NODE_IMAGE" ]; then
  build_image_if_needed "$WORKER_IMAGE" "$ROOT_DIR/worker" "$ROOT_DIR/worker/Containerfile.dev" \
    --build-arg "WORKER_NODE_IMAGE=$WORKER_NODE_IMAGE"
else
  build_image_if_needed "$WORKER_IMAGE" "$ROOT_DIR/worker" "$ROOT_DIR/worker/Containerfile.dev"
fi

podman volume exists "$SITE_VOLUME" >/dev/null 2>&1 || podman volume create "$SITE_VOLUME" >/dev/null
podman volume exists "$WORKER_NODE_MODULES_VOLUME" >/dev/null 2>&1 || podman volume create "$WORKER_NODE_MODULES_VOLUME" >/dev/null

reset_wrangler_local_state_if_requested
start_dev_stack

if [ "$SKIP_STRIPE" != "true" ]; then
  if ! command -v stripe >/dev/null 2>&1; then
    echo "⚠️  Stripe CLI not found. Continuing without webhook forwarding."
    SKIP_STRIPE=true
  elif ! stripe config --list &>/dev/null; then
    echo "⚠️  Not logged into Stripe CLI. Running 'stripe login'..."
    if ! run_stripe_login; then
      echo "❌ Stripe login failed. Continuing without webhook forwarding."
      SKIP_STRIPE=true
    fi
  fi
fi

if [ "$SKIP_STRIPE" != "true" ]; then
  echo "💳 Starting Stripe webhook forwarding..."
  start_stripe_listener
  STRIPE_SECRET="$(wait_for_stripe_secret || true)"

  if [ -z "$STRIPE_SECRET" ] && [ -f "$STRIPE_LOG" ] && grep -q "Authorization failed" "$STRIPE_LOG"; then
    echo "⚠️  Stripe CLI authentication appears stale. Re-running 'stripe login'..."
    kill "$STRIPE_LISTEN_PID" 2>/dev/null || true
    wait "$STRIPE_LISTEN_PID" 2>/dev/null || true
    if run_stripe_login; then
      start_stripe_listener
      STRIPE_SECRET="$(wait_for_stripe_secret || true)"
    else
      echo "❌ Stripe login failed. Continuing without webhook forwarding."
      SKIP_STRIPE=true
    fi
  fi

  if [ "$SKIP_STRIPE" != "true" ] && [ -n "$STRIPE_SECRET" ]; then
    if grep -q "^STRIPE_WEBHOOK_SECRET=" worker/.dev.vars 2>/dev/null; then
      sed -i.bak "s|^STRIPE_WEBHOOK_SECRET=.*|STRIPE_WEBHOOK_SECRET=$STRIPE_SECRET|" worker/.dev.vars
      rm -f worker/.dev.vars.bak
    else
      echo "STRIPE_WEBHOOK_SECRET=$STRIPE_SECRET" >> worker/.dev.vars
    fi
    echo "   Updated worker/.dev.vars with Stripe listener secret"
  else
    echo "⚠️  Stripe webhook forwarding inactive"
    SKIP_STRIPE=true
  fi
fi

echo ""
echo "✅ Podman local dev is running"
echo "   Jekyll:   http://127.0.0.1:${JEKYLL_PORT}"
echo "   Worker:   http://127.0.0.1:${WORKER_PORT}"
if [ "$SKIP_STRIPE" = "true" ]; then
  echo "   Stripe:   webhook forwarding inactive"
else
  echo "   Stripe:   forwarding to worker"
fi
echo ""
echo "💡 Podman notes:"
echo "   - Rebuild images with: PODMAN_REBUILD=1 ./scripts/dev.sh --podman"
echo "   - Restart supervision interval: PODMAN_SUPERVISE_INTERVAL=${PODMAN_SUPERVISE_INTERVAL}s"
echo "   - Logs: podman logs -f $SITE_CONTAINER | podman logs -f $WORKER_CONTAINER"
echo "   - Stop all services with Ctrl+C"
echo ""

if [ "$PODMAN_DETACH" = "true" ]; then
  echo "📎 Detached mode enabled; containers will keep running after this command exits"
  exit 0
fi

supervise_dev_stack

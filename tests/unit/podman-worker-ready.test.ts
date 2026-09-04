import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const launcher = readFileSync(resolve('scripts/dev-podman.sh'), 'utf8');
const timeoutDefault = launcher.match(/^PODMAN_WORKER_READY_TIMEOUT=.*$/m)![0];
const workerWait = launcher.slice(launcher.indexOf('wait_for_worker_http() {'), launcher.indexOf('\ncleanup() {'));

function waitForWorker({ readyAfter = 0, timeout = '', running = true } = {}) {
  return spawnSync('bash', ['-c', `
    set -euo pipefail
    source "$1"
    ${timeoutDefault}
    ${workerWait}
    WORKER_CONTAINER=store-dev-worker
    elapsed=0
    container_running() { [ "$STORE_TEST_RUNNING" = "true" ]; }
    sleep() { elapsed=$((elapsed + 1)); SECONDS=$((SECONDS + 1)); }
    curl() {
      [ "$1" = "--max-time" ] || exit 2
      if [ "$elapsed" -ge "$STORE_TEST_READY_AFTER" ]; then echo 404; else echo 000; fi
    }
    podman() { echo "dependency installation diagnostic"; }
    wait_for_worker_http http://localhost/notfound Worker
  `, 'podman-worker-ready-test', resolve('scripts/podman-stack-ready.sh')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PODMAN_STACK_READY_TIMEOUT: '',
      PODMAN_WORKER_READY_TIMEOUT: timeout,
      STORE_TEST_READY_AFTER: String(readyAfter),
      STORE_TEST_RUNNING: String(running)
    }
  });
}

describe('Podman Worker startup', () => {
  it('allows dependency installation beyond one minute before HTTP readiness', () => {
    const result = waitForWorker({ readyAfter: 90 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Worker ready');
  });

  it('honors a service timeout and logs the still-running container', () => {
    const result = waitForWorker({ readyAfter: 90, timeout: '2' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('failed to start within 2s');
    expect(result.stderr).toContain('dependency installation diagnostic');
  });

  it('fails promptly with logs when the container stops', () => {
    const result = waitForWorker({ running: false });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('container stopped before it became ready');
    expect(result.stderr).toContain('dependency installation diagnostic');
  });
});

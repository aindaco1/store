import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function waitForStack({ readyAfter = 0, timeout = '', alive = true, probeSeconds = 0 } = {}) {
  return spawnSync('bash', ['-c', `
    set -euo pipefail
    source "$1"
    checks=0
    ready() {
      checks=$((checks + 1))
      SECONDS=$((SECONDS + STORE_TEST_PROBE_SECONDS))
      [ "$checks" -gt "$STORE_TEST_READY_AFTER" ]
    }
    sleep() { SECONDS=$((SECONDS + 1)); }
    kill() { [ "$1" = "-0" ] && [ "$STORE_TEST_ALIVE" = "true" ]; }
    podman() { echo "container startup log"; }
    store_wait_for_podman_stack ready 123 /dev/null
    echo "checks=$checks"
  `, 'podman-stack-ready-test', resolve('scripts/podman-stack-ready.sh')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PODMAN_STACK_READY_TIMEOUT: timeout,
      STORE_TEST_READY_AFTER: String(readyAfter),
      STORE_TEST_ALIVE: String(alive),
      STORE_TEST_PROBE_SECONDS: String(probeSeconds)
    }
  });
}

describe('Podman stack startup deadline', () => {
  it('accepts a ready stack immediately', () => {
    const result = waitForStack();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('checks=1\n');
  });

  it('allows cold startup beyond the old one-minute limit', () => {
    const result = waitForStack({ readyAfter: 90 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('checks=91\n');
  });

  it('fails when the configured deadline expires', () => {
    const result = waitForStack({ readyAfter: 100, timeout: '2' });
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toMatch(/did not become ready within 2 seconds$/);
    expect(result.stderr).toContain('container startup log');
  });

  it('counts time spent in readiness probes toward the deadline', () => {
    const result = waitForStack({ readyAfter: 2, timeout: '2', probeSeconds: 3 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('within 2 seconds');
  });

  it('fails immediately when the launcher exits', () => {
    const result = waitForStack({ readyAfter: 100, alive: false });
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toMatch(/process exited before readiness$/);
  });

  it.each(['0', '-1', 'abc', '100000'])('rejects invalid timeout %s', (timeout) => {
    const result = waitForStack({ timeout });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must be a positive number of seconds');
  });
});

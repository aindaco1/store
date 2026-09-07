import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function runPlaywright({ volume = 'test-worker-dependencies', inspectStatus = 0, commandStatus = 0 } = {}) {
  return spawnSync('bash', ['-c', `
    podman() {
      case "$1" in
        inspect)
          printf '%s' "$STORE_TEST_WORKER_VOLUME"
          return "$STORE_TEST_INSPECT_STATUS"
          ;;
        run)
          printf '%s\\n' "$@"
          return "$STORE_TEST_COMMAND_STATUS"
          ;;
        info|exec|image|volume) return 0 ;;
        *) echo "Unexpected Podman command: $*" >&2; return 99 ;;
      esac
    }
    curl() { printf '200'; }
    export -f podman curl
    exec bash "$1" npx playwright test tests/e2e/store-check-in-page.spec.ts --workers=1
  `, 'podman-playwright-test', resolve('scripts/podman-playwright-run.sh')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PODMAN_REBUILD: '0',
      STORE_TEST_WORKER_VOLUME: volume,
      STORE_TEST_INSPECT_STATUS: String(inspectStatus),
      STORE_TEST_COMMAND_STATUS: String(commandStatus)
    }
  });
}

describe('Podman Playwright dependency isolation', () => {
  it('mounts the running Worker dependency volume read-only and preserves test arguments', () => {
    const result = runPlaywright();
    expect(result.status, result.stderr).toBe(0);
    const args = result.stdout.trim().split('\n');
    expect(args).toContain('test-worker-dependencies:/workspace/worker/node_modules:ro');
    expect(args).toContain('store-dev-playwright-node-modules:/workspace/node_modules');
    expect(args.slice(-5)).toEqual([
      'npx', 'playwright', 'test', 'tests/e2e/store-check-in-page.spec.ts', '--workers=1'
    ]);
  });

  it('fails before launching tests when the Worker dependency mount is missing', () => {
    const result = runPlaywright({ volume: '' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot locate the running Worker's dependency volume");
    expect(result.stdout).toBe('');
  });

  it('propagates Worker inspection failures instead of falling back to host dependencies', () => {
    const result = runPlaywright({ inspectStatus: 9 });
    expect(result.status).toBe(9);
    expect(result.stdout).toBe('');
  });

  it('preserves a failing test exit status', () => {
    const result = runPlaywright({ commandStatus: 37 });
    expect(result.status).toBe(37);
  });
});

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const helper = resolve('scripts/podman-connection.sh');

function selectConnection(os: string, selected: string, explicit = '', status = 0, host = '') {
  const result = spawnSync('bash', ['-c', `
    set -euo pipefail
    uname() { printf '%s\\n' "$STORE_TEST_OS"; }
    podman() {
      if [ "$*" != "system connection list --format {{if .Default}}{{.Name}}{{end}}" ]; then
        echo "Unexpected Podman operation: $*" >&2
        return 99
      fi
      printf '%s\\n' "$STORE_TEST_SELECTED"
      return "$STORE_TEST_STATUS"
    }
    source "$1"
    store_select_podman_connection
    printf '%s\\n' "\${CONTAINER_CONNECTION:-}"
  `, 'podman-connection-test', helper], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CONTAINER_CONNECTION: explicit,
      CONTAINER_HOST: host,
      STORE_TEST_OS: os,
      STORE_TEST_SELECTED: selected,
      STORE_TEST_STATUS: String(status)
    }
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout.trim();
}

describe('Store Podman connection selection', () => {
  it.each(['Darwin', 'MINGW64_NT-10.0', 'MSYS_NT-10.0', 'CYGWIN_NT-10.0'])(
    'reuses the selected engine on %s without starting a VM', (os) => {
      expect(selectConnection(os, '\nshared-engine\n')).toBe('shared-engine');
    }
  );

  it('preserves an explicit override over the selected default', () => {
    expect(selectConnection('Darwin', 'shared-engine', 'explicit-engine')).toBe('explicit-engine');
  });

  it('pins the standard default without managing its lifecycle', () => {
    expect(selectConnection('Darwin', 'podman-machine-default')).toBe('podman-machine-default');
  });

  it('preserves an explicit URL without selecting a conflicting connection', () => {
    expect(selectConnection('Darwin', 'shared-engine', '', 0, 'unix:///tmp/explicit.sock')).toBe('');
  });

  it('leaves native Linux engine selection unchanged', () => {
    expect(selectConnection('Linux', 'remote-engine')).toBe('');
  });

  it('retains the existing fallback when no connection is available', () => {
    expect(selectConnection('Darwin', '')).toBe('');
    expect(selectConnection('Darwin', '', '', 125)).toBe('');
  });
  it('reports a busy host port without signalling its owner', () => {
    const source = readFileSync(resolve('scripts/dev-podman.sh'), 'utf8');
    const fn = source.slice(source.indexOf('wait_for_port_release() {'), source.indexOf('ensure_podman_ready() {'));
    const result = spawnSync('bash', ['-c', `
      set -euo pipefail
      lsof() { echo 'unrelated project listener'; }
      sleep() { :; }
      kill() { echo 'UNSAFE SIGNAL' >&2; return 99; }
      ${fn}
      wait_for_port_release 4000 Jekyll
    `], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Port 4000 is still in use');
    expect(result.stderr).not.toContain('UNSAFE SIGNAL');
  });
});

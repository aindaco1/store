import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const source = readFileSync('scripts/dev-podman.sh', 'utf8');
const prepareState = source.slice(source.indexOf('prepare_wrangler_local_state() {'), source.indexOf('\nstart_dev_stack() {'));
const fixtures: string[] = [];
afterEach(() => fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'store-wrangler-state-test-'));
  fixtures.push(root);
  const original = join(root, 'worker/.wrangler/state');
  const volume = join(root, 'volumes/store-dev-worker-wrangler');
  const testVolume = join(root, 'volumes/store-test-worker-wrangler');
  mkdirSync(original, { recursive: true });
  writeFileSync(join(original, 'order'), 'original order');
  const run = (reset = false, failCopy = false) => execFileSync('bash', ['-c', `
    set -euo pipefail
    podman() {
      case "$1 $2" in
        'volume exists') test -d "$ROOT_DIR/volumes/$3" ;;
        'volume create') mkdir -p "$ROOT_DIR/volumes/$3" ;;
        'volume rm') rm -rf "$ROOT_DIR/volumes/$3" ;;
        'run --rm')
          cp -a "$ROOT_DIR/worker/.wrangler/state" "$ROOT_DIR/volumes/$WORKER_WRANGLER_VOLUME/state"
          test "$FAIL_COPY" != true ;;
        *) return 1 ;;
      esac
    }
    ${prepareState}
    prepare_wrangler_local_state
  `], { env: { ...process.env, ROOT_DIR: root, WORKER_WRANGLER_VOLUME: 'store-dev-worker-wrangler', WORKER_IMAGE: 'fixture', PODMAN_RESET_WRANGLER_STATE: String(reset), FAIL_COPY: String(failCopy) }, stdio: 'pipe' });
  return { original, volume, testVolume, run };
}

describe('Podman Wrangler storage', () => {
  it('copies existing host state once and preserves subsequent local orders', () => {
    const { original, volume, run } = fixture();
    run();
    expect(readFileSync(join(volume, 'state/order'), 'utf8')).toBe('original order');
    writeFileSync(join(volume, 'state/order'), 'new local order');
    run();
    expect(readFileSync(join(volume, 'state/order'), 'utf8')).toBe('new local order');
    expect(readFileSync(join(original, 'order'), 'utf8')).toBe('original order');
    expect(source).toContain('-v "$WORKER_WRANGLER_VOLUME:/workspace/worker/.wrangler"');
  });

  it.each([false, true])('isolates test resets from preview orders and host data (existing preview: %s)', (existing) => {
    const { original, volume, testVolume, run } = fixture();
    if (existing) {
      run();
      writeFileSync(join(volume, 'state/order'), 'preview payment checkpoint');
    }
    run(true);
    expect(existsSync(testVolume)).toBe(true);
    expect(existsSync(join(testVolume, 'state'))).toBe(false);
    writeFileSync(join(testVolume, 'test-order'), 'test payment');
    run(true);
    expect(existsSync(join(testVolume, 'test-order'))).toBe(false);
    if (existing) expect(readFileSync(join(volume, 'state/order'), 'utf8')).toBe('preview payment checkpoint');
    else expect(existsSync(volume)).toBe(false);
    expect(readFileSync(join(original, 'order'), 'utf8')).toBe('original order');
  });

  it('fails startup and removes a partial import so the next start can retry', () => {
    const { original, volume, run } = fixture();
    expect(() => run(false, true)).toThrow();
    expect(existsSync(volume)).toBe(false);
    expect(readFileSync(join(original, 'order'), 'utf8')).toBe('original order');
    run();
    expect(readFileSync(join(volume, 'state/order'), 'utf8')).toBe('original order');
  });
});

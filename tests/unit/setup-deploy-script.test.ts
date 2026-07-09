import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..');
const sourceSetupScript = path.join(repoRoot, 'scripts', 'setup-deploy.mjs');

function writeExecutable(filePath: string, body: string) {
  fs.writeFileSync(filePath, body, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function writeFakeCli(binDir: string, name: string, body: string) {
  writeExecutable(path.join(binDir, name), `#!/bin/sh
set -eu
LOG_FILE="\${SETUP_FAKE_LOG:-}"
if [ -n "$LOG_FILE" ]; then
  printf '%s %s\\n' "${name}" "$*" >> "$LOG_FILE"
fi
${body}
`);
}

function createTempSetupRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-setup-deploy-'));
  const scriptsDir = path.join(root, 'scripts');
  const workerDir = path.join(root, 'worker');
  const binDir = path.join(root, 'fake-bin');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(workerDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(sourceSetupScript, path.join(scriptsDir, 'setup-deploy.mjs'));
  fs.writeFileSync(path.join(scriptsDir, 'sync-worker-config.rb'), 'puts "synced"\n', 'utf8');
  fs.writeFileSync(path.join(workerDir, '.dev.vars.example'), '# local dev secrets\n', 'utf8');
  fs.writeFileSync(path.join(workerDir, 'wrangler.toml'), `name = "store-worker"

[[kv_namespaces]]
binding = "STORE_STATE"
id = ""
preview_id = ""

[[kv_namespaces]]
binding = "RATELIMIT"
id = ""
preview_id = ""
`, 'utf8');

  const logPath = path.join(root, 'fake-cli.log');
  writeFakeCli(binDir, 'npm', `
if [ "\${1:-}" = "--version" ]; then echo "10.0.0"; exit 0; fi
exit 0
`);
  writeFakeCli(binDir, 'git', `
if [ "\${1:-}" = "--version" ]; then echo "git version 2.50.0"; exit 0; fi
exit 0
`);
  writeFakeCli(binDir, 'ruby', `
if [ "\${1:-}" = "--version" ]; then echo "ruby 3.3.0"; exit 0; fi
exit 0
`);
  writeFakeCli(binDir, 'gh', `
if [ "\${1:-}" = "--version" ]; then echo "gh version 2.0.0"; exit 0; fi
if [ "\${1:-}" = "auth" ]; then exit 0; fi
if [ "\${1:-}" = "repo" ]; then echo '{"nameWithOwner":"owner/repo","url":"https://github.com/owner/repo"}'; exit 0; fi
if [ "\${1:-}" = "secret" ] && [ "\${2:-}" = "list" ]; then echo '[]'; exit 0; fi
if [ "\${1:-}" = "secret" ] && [ "\${2:-}" = "set" ]; then exit 0; fi
exit 0
`);
  writeFakeCli(binDir, 'stripe', `
if [ "\${1:-}" = "--version" ]; then echo "stripe version 1.0.0"; exit 0; fi
if [ "\${1:-}" = "whoami" ]; then echo "test@example.com"; exit 0; fi
if [ "\${1:-}" = "webhook_endpoints" ]; then echo '{"data":[]}'; exit 0; fi
exit 0
`);
  writeFakeCli(binDir, 'npx', `
if [ "\${1:-}" = "--version" ]; then echo "10.0.0"; exit 0; fi
if [ "\${1:-}" != "wrangler" ]; then exit 0; fi
shift
if [ "\${1:-}" = "whoami" ]; then echo "user@example.com"; exit 0; fi
if [ "\${1:-}" = "kv" ] && [ "\${2:-}" = "namespace" ] && [ "\${3:-}" = "list" ]; then
  printf '%s\\n' "\${SETUP_FAKE_KV_LIST:-[]}"
  exit 0
fi
if [ "\${1:-}" = "kv:namespace" ] && [ "\${2:-}" = "list" ]; then
  printf '%s\\n' "\${SETUP_FAKE_KV_LIST:-[]}"
  exit 0
fi
if [ "\${1:-}" = "kv" ] && [ "\${2:-}" = "namespace" ] && [ "\${3:-}" = "create" ]; then
  binding="\${4:-UNKNOWN}"
  preview=""
  case " $* " in *" --preview "*) preview="preview_" ;; esac
  lower=$(printf '%s' "$binding" | tr '[:upper:]' '[:lower:]')
  printf '{"id":"%s%screatedid00000000000000000000"}\\n' "$lower" "$preview"
  exit 0
fi
if [ "\${1:-}" = "wrangler" ]; then shift; fi
if [ "\${1:-}" = "secret" ] && [ "\${2:-}" = "put" ]; then cat >/dev/null; exit 0; fi
if [ "\${1:-}" = "deploy" ]; then exit 0; fi
exit 0
`);

  return { root, binDir, logPath, scriptPath: path.join(scriptsDir, 'setup-deploy.mjs') };
}

function runSetup(temp: ReturnType<typeof createTempSetupRepo>, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [temp.scriptPath, ...args], {
    cwd: temp.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${temp.binDir}${path.delimiter}${process.env.PATH || ''}`,
      SETUP_FAKE_LOG: temp.logPath,
      RESEND_API_KEY: '',
      USPS_CLIENT_SECRET: '',
      ZIP_TAX_API_KEY: '',
      ...env
    }
  });
}

function readTempFile(temp: ReturnType<typeof createTempSetupRepo>, relativePath: string) {
  return fs.readFileSync(path.join(temp.root, relativePath), 'utf8');
}

function commandLog(temp: ReturnType<typeof createTempSetupRepo>) {
  return fs.existsSync(temp.logPath) ? fs.readFileSync(temp.logPath, 'utf8') : '';
}

describe('setup-deploy script', () => {
  it('prints help without requiring provider tools', () => {
    const temp = createTempSetupRepo();
    const result = runSetup(temp, ['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: node scripts/setup-deploy.mjs');
    expect(result.stdout).toContain('--mode=production');
  });

  it('fails clearly for unknown modes before doing setup work', () => {
    const temp = createTempSetupRepo();
    const result = runSetup(temp, ['--mode=staging', '--dry-run']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown --mode=staging');
    expect(commandLog(temp)).toBe('');
  });

  it('dry-runs production setup by reusing discovered Cloudflare KV namespaces without mutating wrangler.toml', () => {
    const temp = createTempSetupRepo();
    const before = readTempFile(temp, 'worker/wrangler.toml');
    const kvList = JSON.stringify([
      { title: 'STORE_STATE', id: 'store_state_existing' },
      { title: 'STORE_STATE_preview', id: 'store_state_preview_existing' },
      { title: 'RATELIMIT', id: 'ratelimit_existing' },
      { title: 'RATELIMIT_preview', id: 'ratelimit_preview_existing' }
    ]);

    const result = runSetup(temp, [
      '--mode=production',
      '--dry-run',
      '--non-interactive',
      '--skip-auth',
      '--skip-readiness',
      '--skip-secrets'
    ], { SETUP_FAKE_KV_LIST: kvList });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('STORE_STATE: reusing existing namespace store_state_existing');
    expect(result.stdout).toContain('[dry-run] update worker/wrangler.toml KV RATELIMIT');
    expect(result.stdout).not.toContain('namespace create STORE_STATE');
    expect(readTempFile(temp, 'worker/wrangler.toml')).toBe(before);
  });

  it('dry-runs production setup by planning KV namespace creation when no reusable namespace exists', () => {
    const temp = createTempSetupRepo();
    const before = readTempFile(temp, 'worker/wrangler.toml');

    const result = runSetup(temp, [
      '--mode=production',
      '--dry-run',
      '--non-interactive',
      '--skip-auth',
      '--skip-readiness',
      '--skip-secrets'
    ], { SETUP_FAKE_KV_LIST: '[]' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[dry-run] npx wrangler kv namespace create STORE_STATE --json');
    expect(result.stdout).toContain('[dry-run] npx wrangler kv namespace create STORE_STATE --json --preview');
    expect(result.stdout).toContain('RATELIMIT: planned/created namespace ratelimit_id');
    expect(readTempFile(temp, 'worker/wrangler.toml')).toBe(before);
  });

  it('writes generated local secrets in non-interactive local mode without adding blank provider secrets', () => {
    const temp = createTempSetupRepo();
    const result = runSetup(temp, ['--mode=local', '--non-interactive']);

    expect(result.status).toBe(0);
    const devVars = readTempFile(temp, 'worker/.dev.vars');
    for (const key of [
      'ADMIN_SECRET',
      'ADMIN_SESSION_SECRET',
      'CHECKOUT_INTENT_SECRET',
      'MAGIC_LINK_SECRET',
      'STORE_DOWNLOAD_SECRET',
      'WORKERS_CACHE_PURGE_SECRET'
    ]) {
      expect(devVars).toMatch(new RegExp(`${key}=[a-f0-9]{64}`));
    }
    expect(devVars).not.toContain('STRIPE_SECRET_KEY=');
    expect(commandLog(temp)).toContain('npm install');
    expect(commandLog(temp)).toContain('ruby scripts/sync-worker-config.rb');
  });

  it('updates wrangler KV ids and writes only generated Worker secrets in non-interactive production mode', () => {
    const temp = createTempSetupRepo();
    const result = runSetup(temp, [
      '--mode=production',
      '--non-interactive',
      '--skip-auth',
      '--skip-readiness',
      '--skip-github'
    ], { SETUP_FAKE_KV_LIST: '[]' });

    expect(result.status).toBe(0);
    const wrangler = readTempFile(temp, 'worker/wrangler.toml');
    expect(wrangler).toContain('id = "store_statecreatedid00000000000000000000"');
    expect(wrangler).toContain('preview_id = "store_statepreview_createdid00000000000000000000"');
    expect(wrangler).toContain('id = "ratelimitcreatedid00000000000000000000"');
    const log = commandLog(temp);
    expect(log).toContain('npx wrangler secret put ADMIN_SECRET');
    expect(log).toContain('npx wrangler secret put STORE_DOWNLOAD_SECRET');
    expect(log).toContain('npx wrangler secret put WORKERS_CACHE_PURGE_SECRET');
    expect(log).not.toContain('npx wrangler secret put STRIPE_SECRET_KEY');
    expect(log).not.toContain('gh secret set');
  });

  it('runs dry-run readiness checks as read-only provider probes when not skipped', () => {
    const temp = createTempSetupRepo();
    const result = runSetup(temp, [
      '--mode=production',
      '--dry-run',
      '--non-interactive',
      '--skip-auth',
      '--skip-kv',
      '--skip-secrets'
    ], {
      SETUP_FAKE_KV_LIST: JSON.stringify([{ title: 'STORE_STATE', id: 'store_state_existing' }])
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK: GitHub repository access');
    expect(result.stdout).toContain('OK: GitHub repository secrets access');
    expect(result.stdout).toContain('OK: Cloudflare Wrangler account access');
    expect(result.stdout).toContain('OK: Cloudflare KV namespace discovery');
    expect(result.stdout).toContain('OK: Stripe webhook endpoint access');
    expect(result.stdout).toContain('Check: Resend domain access');
    const log = commandLog(temp);
    expect(log).toContain('gh repo view --json nameWithOwner,url');
    expect(log).toContain('gh secret list');
    expect(log).toContain('npx wrangler whoami');
    expect(log).not.toContain('secret set');
    expect(log).not.toContain('secret put');
  });
});

// @vitest-environment node
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../../worker/src/index.js';
import { createAdminLoginUrl } from '../../worker/src/admin-auth.js';

class MemoryKV {
  store = new Map<string, string>();
  async get(key: string, options?: { type?: string }) {
    const value = this.store.get(key);
    return value == null ? null : options?.type === 'json' ? JSON.parse(value) : value;
  }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
}

let root: string;
let sidecar: ChildProcess;
let base: string;
let env: any;
let session: { cookie: string; csrf: string };
const initialMarkdown = '---\nidentifier: local-product\nname: Local product\nprice: 20\nstatus: draft\nfulfillment_type: service\n---\nOriginal copy.\n';

async function snapshot() {
  const source = await readFile(path.join(root, 'worker/src/generated/catalog-snapshot.js'), 'utf8');
  return JSON.parse(source.match(/Object\.freeze\(([\s\S]+)\);/)![1]);
}

function request(route: string, body?: unknown, authenticated = true) {
  return worker.fetch(new Request(`${env.WORKER_BASE}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: env.SITE_BASE, 'Content-Type': 'application/json',
      ...(authenticated ? { Cookie: session.cookie, 'x-store-admin-csrf': session.csrf } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), env, { waitUntil() {} } as any);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'store-local-publish-'));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, '_products'));
  await copyFile('scripts/generate-catalog-snapshot.rb', path.join(root, 'scripts/generate-catalog-snapshot.rb'));
  await writeFile(path.join(root, '_config.yml'), 'url: http://127.0.0.1:4002\n');
  await writeFile(path.join(root, '_products/local-product.md'), initialMarkdown);
  execFileSync('ruby', [path.join(root, 'scripts/generate-catalog-snapshot.rb')]);
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  sidecar = spawn(process.execPath, ['src/local-repo-service.mjs'], {
    cwd: path.resolve('worker'), stdio: 'ignore',
    env: { ...process.env, ADMIN_LOCAL_REPO_ROOT: root, ADMIN_LOCAL_REPO_TOKEN: 'local-test-token', ADMIN_LOCAL_REPO_SERVICE_PORT: String(port) }
  });
  await expect.poll(async () => fetch(`${base}/health`).then((r) => r.status).catch(() => 0)).toBe(200);
  env = {
    APP_MODE: 'test', ADMIN_LOCAL_REPO_WRITES_ENABLED: 'true', ADMIN_LOCAL_REPO_SERVICE: base,
    ADMIN_LOCAL_REPO_TOKEN: 'local-test-token', ADMIN_SECRET: 'local-test-secret', ADMIN_SESSION_SECRET: 'local-session-secret',
    SITE_BASE: 'http://127.0.0.1:4002', WORKER_BASE: 'http://127.0.0.1:8989', CORS_ALLOWED_ORIGIN: 'http://127.0.0.1:4002',
    ADMIN_USERS_JSON: JSON.stringify([{ name: 'Owner', email: 'owner@example.com', role: 'super_admin', accessScopes: [] }]),
    STORE_CATALOG_JSON: JSON.stringify(await snapshot()), STORE_STATE: new MemoryKV(), RATELIMIT: new MemoryKV()
  };
  const loginUrl = await createAdminLoginUrl(env, { email: 'owner@example.com' });
  const token = new URL(loginUrl).searchParams.get('admin_login');
  const exchange = await request('/admin/auth/exchange', { token }, false);
  const data = await exchange.json();
  session = { cookie: exchange.headers.get('set-cookie')!.split(';')[0], csrf: data.csrfToken };
});

afterEach(async () => {
  if (sidecar && sidecar.exitCode === null) {
    const exited = once(sidecar, 'exit');
    sidecar.kill();
    await exited;
  }
  if (root) await rm(root, { recursive: true, force: true });
});

describe('local admin product publishing', () => {
  it('writes the repository, regenerates, and reports ready only after the Worker loads the saved hash', async () => {
    const response = await request('/admin/store/products/publish', {
      intent: 'publish', productId: 'local-product', fields: { name: 'Edited locally', price: 35 }
    });
    const data = await response.json();
    expect(response.status, JSON.stringify(data)).toBe(200);
    expect(data).toMatchObject({ success: true, published: true, repositoryMode: 'local', deployment: null, rebuild: { ok: true } });
    expect(await readFile(path.join(root, '_products/local-product.md'), 'utf8')).toContain('name: "Edited locally"');
    expect(data.rebuild.sourceHash).toBe((await snapshot()).source_hash);
    const route = `/admin/store/deployments/status?sourceHash=${data.rebuild.sourceHash}`;
    const waiting = await request(route);
    expect(await waiting.json()).toMatchObject({ deployment: { mode: 'local', status: 'in_progress' } });
    env.STORE_CATALOG_JSON = JSON.stringify(await snapshot()); // Wrangler hot reload, modeled without a production deployment.
    const ready = await request(route);
    expect(ready.headers.get('cache-control')).toContain('private, no-store');
    expect(await ready.json()).toMatchObject({ deployment: { mode: 'local', status: 'completed', conclusion: 'success' } });
    const products = await request('/admin/store/products');
    expect((await products.json()).products).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Edited locally', priceCents: 3500 })]));
  });

  it('keeps rebuild bearer auth, admin auth, and CSRF checks intact', async () => {
    expect((await fetch(`${base}/rebuild`, { method: 'POST', body: '{}' })).status).toBe(403);
    const unauthenticated = await request(`/admin/store/deployments/status?sourceHash=${'a'.repeat(64)}`, undefined, false);
    expect([401, 403]).toContain(unauthenticated.status);
    const csrf = session.csrf;
    session.csrf = '';
    const blocked = await request('/admin/store/products/publish', { intent: 'publish', productId: 'local-product', fields: { price: 99 } });
    expect(blocked.status).toBe(403);
    session.csrf = csrf;
    expect(await readFile(path.join(root, '_products/local-product.md'), 'utf8')).toBe(initialMarkdown);
    expect((await request('/admin/store/deployments/status?sourceHash=bad')).status).toBe(400);
  });

  it('distinguishes a saved file from failed regeneration', async () => {
    await writeFile(path.join(root, '_products/broken.md'), '---\nvariants: [\n---\n');
    const response = await request('/admin/store/products/publish', { intent: 'publish', productId: 'local-product', fields: { price: 36 } });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toMatchObject({ published: true, repositoryMode: 'local', rebuild: { ok: false, triggered: false, code: 'local_catalog_rebuild_failed' } });
    expect(await readFile(path.join(root, '_products/local-product.md'), 'utf8')).toContain('price: 36');
    expect((await snapshot()).products[0].price).toBe(20);
  });
});

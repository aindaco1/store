#!/usr/bin/env node
// Manual synthetic rehearsal. Production configuration is never deployed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { rehearseSoftwareRestore } from './rehearse-software-restore.mjs';
import { softwareBackupClient, restoreSoftwareBackup } from './lib/software-backup.mjs';
import { softwareArchiveConfiguration, softwareArchiveRoundTrip } from './lib/software-recovery-archive.mjs';
import { runStoreRestore } from './store-restore.mjs';
import { stripeRead } from '../experiments/software-licensing/recovery-fixture.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export async function rehearseSoftwarePreview({ previewOnly = false, evidenceFile } = {}) {
  if (!/^[a-f0-9]{32}$/.test(process.env.CLOUDFLARE_ACCOUNT_ID || '')) throw new Error('Cloudflare source account is required');
  if (!previewOnly) {
    softwareArchiveConfiguration();
    execFileSync('aws', ['--version'], { stdio: 'pipe' });
  }
  const licensing = path.resolve(process.env.LICENSING_REPO || path.join(root, '../dust-wave-licensing'));
  const cli = path.join(licensing, 'node_modules/wrangler/bin/wrangler.js');
  const report = { ok: false, synthetic: true, remoteArchive: false, productionWrites: false, paidCheckoutEnabled: false, livePayments: 0, realEmails: 0, timingsMs: {}, cleanup: {} };
  const started = performance.now();
  const emit = () => { if (evidenceFile) fs.writeFileSync(evidenceFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); };
  try {
    const result = await rehearseSoftwareRestore({
      archiveIdentity: previewOnly ? undefined : process.env.STORE_BACKUP_AGE_IDENTITY,
      archiveRoundTrip: previewOnly ? undefined : async context => {
        const start = performance.now();
        const downloaded = softwareArchiveRoundTrip(context);
        report.remoteArchive = true; report.timingsMs.archiveRoundTrip = Math.round(performance.now() - start); emit();
        return downloaded;
      },
      previewRestore: async context => {
        const { snapshot, secret, readSecret, checkpoint, publicKey, token, revokedToken, license, bytes, temp } = context;
        const previewId = randomBytes(8).toString('hex'), prefix = `dw-recovery-${previewId}`;
        const directory = path.join(temp, 'preview'); fs.mkdirSync(directory, { mode: 0o700 });
        const configPaths = Object.fromEntries(['store', 'licensing'].map(role => [role, path.join(directory, `${role}.json`)]));
        const resources = { workers: [], buckets: [], namespace: null };
        let namespaceAttempted = false;
        report.resources = resources; emit();
        const run = (args, { absentOK = false } = {}) => {
          const retryable = args[0]==='deploy' || (args[0]==='secret' && args[1]==='bulk') || args.includes('list') || args.includes('delete');
          for(let attempt=0;attempt<3;attempt++) {
            try { return execFileSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8', stdio: 'pipe', timeout: 180000, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' } }); }
            catch(error) {
              const detail=String(error.stdout || '')+String(error.stderr || '');
              if(absentOK && /code: (10090|10007|10013)/.test(detail)) return 'absent';
              if(evidenceFile) fs.appendFileSync(evidenceFile+'.private.log',detail,{mode:0o600});
              if(retryable && attempt<2 && /fetch failed|connectivity issue|ECONNRESET|ETIMEDOUT/.test(detail)) continue;
              throw new Error('Preview provider command failed: '+args.slice(0,2).join(' '));
            }
          }
        };
        const write = (role, value) => fs.writeFileSync(configPaths[role], JSON.stringify(value), { mode: 0o600 });
        const common = { account_id: process.env.CLOUDFLARE_ACCOUNT_ID, compatibility_date: '2026-10-30', workers_dev: true, limits: { cpu_ms: 30000 } };
        const vars = { APP_MODE: 'test', SOFTWARE_CHECKOUT_ENABLED: 'false', SOFTWARE_RECOVERY_PREVIEW_ID: previewId, SOFTWARE_RECOVERY_TARGET: 'empty', SOFTWARE_RECOVERY_CHECKPOINT: checkpoint };
        let configs;
        const deploy = role => {
          const name = `${prefix}-${role}`;
          if (!resources.workers.includes(name)) {
            assert.equal(run(['deployments','list','--name',name],{absentOK:true}),'absent','Rehearsal Worker name already exists');
            resources.workers.push(name);
          }
          emit();
          const output = run(['deploy', '--config', configPaths[role], '--durable-objects-code-update-mode', 'immediate']);
          const endpoint = output.match(new RegExp(`https://${name}\\.[a-z0-9-]+\\.workers\\.dev`))?.[0];
          assert.ok(endpoint, 'Deployment did not report its isolated endpoint');
          return endpoint;
        };
        try {
          write('store', { ...common, name: `${prefix}-store` });
          assert.equal(JSON.parse(run(['kv','namespace','list'])).some(entry=>entry.title===`${prefix}-store-STORE_STATE`),false,'Rehearsal namespace already exists');
          namespaceAttempted = true;
          const output = run(['kv', 'namespace', 'create', `${prefix}-store-STORE_STATE`, '--config', configPaths.store]);
          resources.namespace = output.match(/"id"\s*:\s*"([a-f0-9]{32})"/)?.[1];
          assert.ok(resources.namespace, 'Namespace create did not return its ID'); emit();
          for (const suffix of ['artifacts', 'downloads']) {
            const name = `${prefix}-${suffix}`;
            assert.equal(run(['r2','bucket','list']).includes(name),false,'Rehearsal bucket already exists');
            resources.buckets.push(name); emit(); run(['r2', 'bucket', 'create', name]);
          }
          configs = {
            licensing: { ...common, name: `${prefix}-licensing`, main: path.join(licensing, 'src/worker.js'), vars,
              durable_objects: { bindings: [{ name: 'PUBLISHER', class_name: 'Publisher' }] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['Publisher'] }], r2_buckets: [{ binding: 'ARTIFACTS', bucket_name: `${prefix}-artifacts` }] },
            store: { ...common, name: `${prefix}-store`, main: path.join(root, 'experiments/software-licensing/recovery-worker.js'), compatibility_flags: ['nodejs_compat'],
              vars: { ...vars, SOFTWARE_LICENSING_ENABLED: 'true', TAX_PROVIDER: 'flat', SALES_TAX_RATE: '0.10', STORE_EMAIL_DRY_RUN: 'true', OBSERVABILITY_SAMPLE_RATE: '0' },
              kv_namespaces: ['STORE_STATE','RATELIMIT'].map(binding=>({binding,id:resources.namespace,preview_id:resources.namespace})),
              r2_buckets: [{ binding: 'STORE_DOWNLOADS', bucket_name: `${prefix}-downloads` }],
              durable_objects: { bindings: [{ name: 'STORE_INVENTORY_COORDINATOR', class_name: 'StoreInventoryCoordinator' }] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['StoreInventoryCoordinator'] }],
              services: [{ binding: 'LICENSING_SERVICE', service: `${prefix}-licensing` }] }
          };
          // Wrangler keeps bulk secrets in its encrypted provider store. Files are
          // private/temporary and never enter an archive, receipt or repository.
          const secrets = {
            licensing: { ADMIN_SECRET: secret, TOKEN_SECRET: secret, SOFTWARE_BACKUP_READ_SECRET: readSecret, UPDATER_PUBLIC_KEY: publicKey },
            store: { ADMIN_SECRET: secret, SOFTWARE_BACKUP_READ_SECRET: readSecret, LICENSING_ADMIN_SECRET: secret, LICENSING_KEY_SECRET: secret, RESEND_API_KEY: 'dry-run' }
          };
          for (const role of ['licensing', 'store']) {
            write(role, configs[role]); deploy(role);
            const file = path.join(directory, `${role}-secrets.json`); fs.writeFileSync(file, JSON.stringify(secrets[role]), { mode: 0o600 });
            run(['secret', 'bulk', file, '--config', configPaths[role]]); fs.rmSync(file);
          }
          const bases = { storeBase: deploy('store'), licensingBase: deploy('licensing') };
          const request = softwareBackupClient({ ...bases, storeSecret: secret, licensingSecret: secret, restore: true });
          const readOnly = softwareBackupClient({ ...bases, storeSecret: readSecret, licensingSecret: readSecret });
          for (const [service, route] of [['store', '/admin/store/recovery/software'], ['licensing', '/internal/backup']]) {
            await assert.rejects(readOnly(service, route, { checkpoint, action: 'begin', owner: 'software-licenses', count: 0 }), /403/);
          }
          const fetchLicense = (route, auth = token, body) => fetch(bases.licensingBase + route, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
          let lost = false;
          await assert.rejects(restoreSoftwareBackup(snapshot, { previewId, stripeRead, request: async (...args) => {
            const response = await request(...args);
            if (!lost && args[1].startsWith('/internal/backup-upload')) { lost = true; throw new Error('synthetic lost upload reply'); } return response;
          } }), /lost upload reply/);
          assert.equal((await fetchLicense('/v1/releases/old')).status, 503);
          const previous = { WORKER_BASE: process.env.WORKER_BASE, LICENSING_WORKER_BASE: process.env.LICENSING_WORKER_BASE };
          Object.assign(process.env, { WORKER_BASE: bases.storeBase, LICENSING_WORKER_BASE: bases.licensingBase });
          const start = performance.now();
          try {
            const restored = await runStoreRestore({ snapshot, target: 'preview', execute: true, verify: true, conflict: 'overwrite', softwareLicensing: true, previewId, workerConfig: configPaths.store,
              previewR2Bucket: `${prefix}-downloads`, softwareRecovery: { request, stripeRead },
              runner: (_cmd, args) => { try { return { status: 0, stdout: run(args.slice(1)), stderr: '' }; } catch (error) { return { status: 1, stdout: '', stderr: 'Preview Wrangler operation failed' }; } } });
            assert.equal(restored.execution?.ok, true); assert.equal(restored.verification?.ok, true);
          } finally { for (const [key,value] of Object.entries(previous)) { if(value===undefined) delete process.env[key]; else process.env[key]=value; } }
          report.timingsMs.previewRestore = Math.round(performance.now() - start);
          assert.equal((await restoreSoftwareBackup(snapshot, { previewId, request, stripeRead })).ok, true);
          for (const role of ['store', 'licensing']) { configs[role].vars.SOFTWARE_RECOVERY_CHECKPOINT = ''; write(role, configs[role]); deploy(role); }
          assert.equal((await fetchLicense('/v1/releases/old')).status, 503, 'Restart without acceptance stays closed');
          // Explicit acceptance is only for this completed, synthetic target.
          for (const role of ['store', 'licensing']) { configs[role].vars.SOFTWARE_RECOVERY_ACCEPTED = checkpoint; write(role, configs[role]); deploy(role); }
          assert.equal(await (await fetchLicense('/v1/releases/old')).text(), bytes.toString());
          for (const id of ['gap','new']) assert.equal((await fetchLicense(`/v1/releases/${id}`)).status, 403);
          assert.equal((await fetchLicense('/v1/releases/old', revokedToken)).status, 403);
          assert.equal((await fetchLicense('/v1/activate', secret, { key: license.key, installation: 'second-mac' })).status, 409);
          const replay = await fetch(bases.storeBase + '/fixture/replay', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type':'application/json' }, body:JSON.stringify({key:license.key}), redirect: 'error', signal: AbortSignal.timeout(30000) });
          assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), { sameKey: true, queuedMail: 0 });
          report.checks = ['remote credential boundaries', 'lost upload reply retry', 'complete logical and KV/R2 readback', 'restart acceptance lock', 'original activation and seats', 'coverage gaps, refunds and revocations', 'signature-verified downloads', 'duplicate payment produces no email'];
          return { ok: true, paidCheckoutEnabled: false };
        } finally {
          const failures = [];
          for (const name of resources.workers) { try { run(['delete', '--name', name, '--force'], {absentOK:true});
            assert.equal(run(['deployments', 'list', '--name', name], {absentOK:true}), 'absent'); } catch { failures.push('worker:' + name); } }
          if (!resources.namespace && namespaceAttempted) {
            const found=JSON.parse(run(['kv','namespace','list'])).filter(entry=>entry.title===`${prefix}-store-STORE_STATE`);
            if(found.length===1) resources.namespace=found[0].id;
            else if(found.length>1) failures.push('ambiguous namespace allocation');
          }
          if (resources.namespace) { try { run(['kv', 'namespace', 'delete', '--namespace-id', resources.namespace], {absentOK:true}); } catch { failures.push('kv:' + resources.namespace); } }
          const metadata = JSON.parse(fs.readFileSync(path.join(snapshot, 'software/manifest.json'), 'utf8'));
          for (const name of resources.buckets) {
            const keys = name.endsWith('-artifacts') ? metadata.objects.map(o => o.key) : ['downloads/restore-drill.txt'];
            try { for (const key of keys) run(['r2', 'object', 'delete', `${name}/${key}`, '--remote']); run(['r2', 'bucket', 'delete', name]); } catch { if(run(['r2','bucket','list']).includes(name)) failures.push('bucket:' + name); }
          }
          const buckets = run(['r2', 'bucket', 'list']); const namespaces = run(['kv', 'namespace', 'list']);
          if (resources.buckets.some(name => buckets.includes(name)) || (resources.namespace && namespaces.includes(resources.namespace))) failures.push('residual resources');
          report.cleanup = { ok: failures.length === 0, failures }; emit();
          assert.equal(failures.length, 0, 'Preview resource cleanup incomplete; see evidence');
        }
      }
    });
    report.local = { ok: result.ok, captured: result.captured, checks: result.checks };
    report.ok = result.ok && report.cleanup.ok && (previewOnly || report.remoteArchive);
  } catch (error) { if(evidenceFile) fs.appendFileSync(evidenceFile+'.private.log',String(error.stack || error),{mode:0o600}); report.error = error instanceof assert.AssertionError ? error.message : 'Preview rehearsal failed; inspect private operator logs'; throw error; }
  finally { report.timingsMs.total = Math.round(performance.now() - started); emit(); }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const evidenceFile = process.argv.find(arg => arg.startsWith('--evidence='))?.slice(11);
    if (!evidenceFile) throw new Error('--evidence is required');
    const result = await rehearseSoftwarePreview({ previewOnly: process.argv.includes('--preview-only'), evidenceFile });
    console.log(JSON.stringify(result, null, 2));
  } catch { console.error('Software preview rehearsal failed; inspect its sanitized evidence and protected operator configuration.'); process.exitCode = 1; }
}

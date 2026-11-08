#!/usr/bin/env node
// Manual synthetic rehearsal. Production configuration is never deployed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rehearseSoftwareRestore } from './rehearse-software-restore.mjs';
import { softwareBackupClient, restoreSoftwareBackup } from './lib/software-backup.mjs';
import { softwareArchiveConfiguration, softwareArchiveRoundTrip } from './lib/software-recovery-archive.mjs';
import { withSoftwarePreview } from './lib/software-preview-workers.mjs';
import { captureDeployedSource } from './lib/software-source.mjs';
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
      sourceCapture: context => withSoftwarePreview(context,{root,licensing,cli,report,emit,evidenceFile,source:true}, resource => captureDeployedSource(context,resource,{report,emit})),
      archiveIdentity: previewOnly ? undefined : process.env.STORE_BACKUP_AGE_IDENTITY,
      archiveRoundTrip: previewOnly ? undefined : async context => {
        const start = performance.now();
        const downloaded = softwareArchiveRoundTrip(context);
        report.remoteArchive = true; report.timingsMs.archiveRoundTrip = Math.round(performance.now() - start); emit();
        return downloaded;
      },
      previewRestore: async context => {
        const { snapshot, secret, readSecret, checkpoint, publicKey, token, legacyToken, revokedToken, license, bytes, temp } = context;
        return withSoftwarePreview(context,{root,licensing,cli,report,emit,evidenceFile},async ({previewId,prefix,resources,configs,configPaths,bases,run,write,deploy,secrets,installSecrets}) => {
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
          assert.equal((await fetchLicense('/v1/releases/old',legacyToken)).status,200,'previous signing key recovered');
          for (const id of ['gap','new']) assert.equal((await fetchLicense(`/v1/releases/${id}`)).status, 403);
          assert.equal((await fetchLicense('/v1/releases/old', revokedToken)).status, 403);
          assert.equal((await fetchLicense('/v1/activate', secret, { key: license.key, installation: 'second-mac' })).status, 409);
          const replay = await fetch(bases.storeBase + '/fixture/replay', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type':'application/json' }, body:JSON.stringify({key:license.key}), redirect: 'error', signal: AbortSignal.timeout(30000) });
          assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), { sameKey: true, queuedMail: 0 });
          const nextAdmin=randomBytes(32).toString('hex');
          Object.assign(secrets.licensing,{ADMIN_SECRET:nextAdmin,ADMIN_SECRET_PREVIOUS:secret,ADMIN_SECRET_PREVIOUS_UNTIL:String(Math.floor(Date.now()/1000)+3600)});
          installSecrets('licensing');
          const status={action:'status',target:license.id,product:license.product};
          for(const credential of [secret,nextAdmin])assert.equal((await fetchLicense('/internal/administration',credential,status)).status,200);
          secrets.store.LICENSING_ADMIN_SECRET=nextAdmin;installSecrets('store');
          Object.assign(secrets.licensing,{ADMIN_SECRET_PREVIOUS_UNTIL:'1',TOKEN_PREVIOUS_UNTIL:'1'});installSecrets('licensing');
          assert.equal((await fetchLicense('/internal/administration',secret,status)).status,403);
          assert.equal((await fetchLicense('/internal/administration',nextAdmin,status)).status,200);
          assert.equal((await fetchLicense('/v1/releases/old',legacyToken)).status,403);
          assert.equal((await fetchLicense('/v1/releases/old')).status,200);
          const recovered=await request('store','/fixture/replay',{key:license.key});
          assert.deepEqual(await recovered.json(),{sameKey:true,queuedMail:0});
          report.checks = ['remote credential boundaries', 'lost upload reply retry', 'complete logical and KV/R2 readback', 'restart acceptance lock', 'original activation and seats', 'coverage gaps, refunds and revocations', 'signature-verified downloads', 'duplicate payment produces no email','previous signing key recovered','service overlap and retirement','retired signer denied; current signer and Store key recovery retained'];
          return { ok: true, paidCheckoutEnabled: false };
        });
      }
    });
    report.local = { ok: result.ok, captured: result.captured, checks: result.checks };
    report.ok = result.ok && report.sourceCleanup?.ok && report.cleanup.ok && (previewOnly || report.remoteArchive);
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

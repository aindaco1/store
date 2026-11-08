import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// One resource lifecycle for both the guarded source and empty restore target.
export async function withSoftwarePreview(context, {root,licensing,cli,report,emit,evidenceFile,source=false,includeObjects=true,configure}, use) {
  const {snapshot,secret,readSecret,checkpoint,publicKey,temp}=context;
  const previewId = randomBytes(8).toString('hex'), prefix = `dw-recovery-${previewId}`;
  const directory = path.join(temp, source ? 'source-preview' : 'preview'); fs.mkdirSync(directory, { mode: 0o700 });
  const configPaths = Object.fromEntries(['store', 'licensing'].map(role => [role, path.join(directory, `${role}.json`)]));
  const resources = { workers: [], buckets: [], namespace: null };
  let namespaceAttempted = false;
  report[source ? 'sourceResources' : 'resources'] = resources; emit();
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
  const vars = { APP_MODE: 'test', SOFTWARE_CHECKOUT_ENABLED: 'false', SOFTWARE_RECOVERY_PREVIEW_ID: previewId, ...(source ? { SOFTWARE_RECOVERY_SOURCE_ID: previewId } : { SOFTWARE_RECOVERY_TARGET: 'empty', SOFTWARE_RECOVERY_CHECKPOINT: checkpoint }) };
  let configs;
  const deploy = role => {
    const name = `${prefix}-${role}`;
    validateSoftwarePreviewConfig(JSON.parse(fs.readFileSync(configPaths[role], 'utf8')), name);
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
    for (const suffix of includeObjects ? ['artifacts', 'downloads'] : []) {
      const name = `${prefix}-${suffix}`;
      assert.equal(run(['r2','bucket','list']).includes(name),false,'Rehearsal bucket already exists');
      resources.buckets.push(name); emit(); run(['r2', 'bucket', 'create', name]);
    }
    configs = {
      licensing: { ...common, name: `${prefix}-licensing`, main: path.join(licensing, 'src/worker.js'), vars,
        durable_objects: { bindings: [{ name: 'PUBLISHER', class_name: 'Publisher' }] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['Publisher'] }], r2_buckets: includeObjects ? [{ binding: 'ARTIFACTS', bucket_name: `${prefix}-artifacts` }] : [] },
      store: { ...common, name: `${prefix}-store`, main: path.join(root, 'experiments/software-licensing/recovery-worker.js'), compatibility_flags: ['nodejs_compat'],
        vars: { ...vars, SOFTWARE_LICENSING_ENABLED: 'true', TAX_PROVIDER: 'flat', SALES_TAX_RATE: '0.10', STORE_EMAIL_DRY_RUN: 'true', OBSERVABILITY_SAMPLE_RATE: '0' },
        kv_namespaces: ['STORE_STATE','RATELIMIT'].map(binding=>({binding,id:resources.namespace,preview_id:resources.namespace})),
        r2_buckets: includeObjects ? [{ binding: 'STORE_DOWNLOADS', bucket_name: `${prefix}-downloads` }] : [],
        durable_objects: { bindings: [{ name: 'STORE_INVENTORY_COORDINATOR', class_name: 'StoreInventoryCoordinator' }] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['StoreInventoryCoordinator'] }],
        services: [{ binding: 'LICENSING_SERVICE', service: `${prefix}-licensing` }] }
    };
    // Wrangler keeps bulk secrets in its encrypted provider store. Files are
    // private/temporary and never enter an archive, receipt or repository.
    const secrets = {
      licensing: { ADMIN_SECRET: secret, TOKEN_SECRET: secret, SOFTWARE_BACKUP_READ_SECRET: readSecret, UPDATER_PUBLIC_KEY: publicKey },
      store: { ADMIN_SECRET: secret, SOFTWARE_BACKUP_READ_SECRET: readSecret, LICENSING_ADMIN_SECRET: secret, LICENSING_KEY_SECRET: secret, RESEND_API_KEY: 'dry-run' }
    };
    await configure?.({configs,secrets,directory,previewId,prefix});
    for (const role of ['licensing', 'store']) {
      write(role, configs[role]); deploy(role);
      const file = path.join(directory, `${role}-secrets.json`); fs.writeFileSync(file, JSON.stringify(secrets[role]), { mode: 0o600 });
      run(['secret', 'bulk', file, '--config', configPaths[role]]); fs.rmSync(file);
    }
    const bases = { storeBase: deploy('store'), licensingBase: deploy('licensing') };
    return await use({previewId,prefix,resources,configs,configPaths,bases,run,write,deploy,directory});
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
    const metadata = !includeObjects ? {objects:[]} : source ? {objects:[{key:'app.tar.gz'},{key:'unattached.txt'}]} : JSON.parse(fs.readFileSync(path.join(snapshot, 'software/manifest.json'), 'utf8'));
    for (const name of resources.buckets) {
      const keys = name.endsWith('-artifacts') ? metadata.objects.map(o => o.key) : ['downloads/restore-drill.txt'];
      try { for (const key of keys) run(['r2', 'object', 'delete', `${name}/${key}`, '--remote']); run(['r2', 'bucket', 'delete', name]); } catch { if(run(['r2','bucket','list']).includes(name)) failures.push('bucket:' + name); }
    }
    const buckets = includeObjects ? run(['r2', 'bucket', 'list']) : ''; const namespaces = run(['kv', 'namespace', 'list']);
    if (resources.buckets.some(name => buckets.includes(name)) || (resources.namespace && namespaces.includes(resources.namespace))) failures.push('residual resources');
    report[source ? 'sourceCleanup' : 'cleanup'] = { ok: failures.length === 0, failures }; emit();
    assert.equal(failures.length, 0, 'Preview resource cleanup incomplete; see evidence');
  }
}

export function validateSoftwarePreviewConfig(config, expectedName) {
  assert.match(expectedName, /^dw-recovery-[a-f0-9]{16}-(store|licensing)$/);
  assert.equal(config.name, expectedName, 'Preview name changed');
  assert.equal(config.vars?.APP_MODE, 'test');
  assert.equal(config.vars?.SOFTWARE_CHECKOUT_ENABLED, 'false');
  assert.ok(!config.route, 'Preview cannot attach a production route');
  assert.equal((config.routes || []).length, 0, 'Preview cannot attach production routes');
  assert.equal((config.triggers?.crons || []).length, 0, 'Preview cannot add schedules');
}

#!/usr/bin/env node
// Isolated actual Workers + synthetic provider; never uses .dev.vars or live credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createSyntheticSnapshot } from './rehearse-store-restore.mjs';
import { archiveSensitiveSnapshot, validateBackupSafety } from './store-backup.mjs';
import { readAndVerifySnapshot, buildStoreRestorePlan, transformKvValuesToRestoreRecords } from './store-restore.mjs';
import { captureSoftwareBackup, restoreSoftwareBackup, reconcileSoftwareMoney, validateSoftwareBackup } from './lib/software-backup.mjs';
import { buildChecksumManifest } from './lib/file-integrity.mjs';
import { order, orderToken, stripeRead, refund } from '../experiments/software-licensing/recovery-fixture.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
export async function rehearseSoftwareRestore({ archiveRoundTrip, previewRestore, archiveIdentity } = {}) {
  const licensingRoot=path.resolve(process.env.LICENSING_REPO || path.join(root,'../dust-wave-licensing'));
  const require=createRequire(path.join(licensingRoot,'package.json'));
  const {Miniflare,convertV4MiniflareOptions}=require('miniflare'), {buildSync}=require('esbuild');
  const {signingFixture}=await import(pathToFileURL(path.join(licensingRoot,'test/signature-fixture.mjs')));
  const signer=signingFixture(), secret=randomBytes(32).toString('hex'), readSecret=randomBytes(32).toString('hex'), checkpoint='rehearsal-'+randomBytes(16).toString('hex');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'software-restore-')); fs.chmodSync(temp,0o700);
  const previousIdentity=process.env.STORE_BACKUP_AGE_IDENTITY;
  const write=(name,value)=>fs.writeFileSync(name,JSON.stringify(value)+'\n',{mode:0o600});
  const runtimes=new Set(); let externalCalls=0;
  const script=buildSync({entryPoints:[path.join(root,'experiments/software-licensing/recovery-worker.js')],bundle:true,write:false,format:'esm',platform:'node',banner:{js:'import {createRequire} from "node:module"; const require=createRequire("/worker.js");'}}).outputFiles[0].text;
  const licensingScript=buildSync({entryPoints:[path.join(licensingRoot,'src/worker.js')],bundle:true,write:false,format:'esm',platform:'browser'}).outputFiles[0].text;
  function runtime(name,extra={}) {
    const mf=new Miniflare(convertV4MiniflareOptions({resourcePersistencePath:path.join(temp,name),workers:[
      {name:'store',modules:true,script,compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat'],bindings:{APP_MODE:'test',SOFTWARE_LICENSING_ENABLED:'true',SOFTWARE_CHECKOUT_ENABLED:'false',ADMIN_SECRET:secret,SOFTWARE_BACKUP_READ_SECRET:readSecret,LICENSING_ADMIN_SECRET:secret,LICENSING_KEY_SECRET:secret,TAX_PROVIDER:'flat',SALES_TAX_RATE:'0.10',RESEND_API_KEY:'dry-run',STORE_EMAIL_DRY_RUN:'true',OBSERVABILITY_SAMPLE_RATE:'0',...extra},kvNamespaces:['STORE_STATE','RATELIMIT'],durableObjects:{STORE_INVENTORY_COORDINATOR:{className:'StoreInventoryCoordinator',useSQLite:true}},serviceBindings:{LICENSING_SERVICE:'licensing'},outboundService:()=>{externalCalls++;throw new Error('External request prohibited');}},
      {name:'licensing',modules:true,script:licensingScript,compatibilityDate:'2026-10-30',bindings:{APP_MODE:'test',ADMIN_SECRET:secret,SOFTWARE_BACKUP_READ_SECRET:readSecret,TOKEN_SECRET:secret,UPDATER_PUBLIC_KEY:signer.publicKey,...extra},durableObjects:{PUBLISHER:{className:'Publisher',useSQLite:true}},r2Buckets:['ARTIFACTS'],outboundService:()=>{externalCalls++;throw new Error('External request prohibited');}}
    ]})); runtimes.add(mf);return mf;
  }
  const stop=async mf=>{await mf.dispose();runtimes.delete(mf);};
  async function raw(mf,service,route,payload,upload,credential=secret) {
    const target=service==='store'?mf:await mf.getWorker('licensing');
    const body=upload ? fs.readFileSync(upload) : JSON.stringify(payload);
    return target.fetch ? target.fetch('https://local'+route,{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':upload?'application/octet-stream':'application/json',...(upload?{'Content-Length':String(body.length)}:{})},body}) : target.dispatchFetch('https://local'+route,{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body});
  }
  const client=(mf,credential=secret)=>async(service,route,payload,upload)=>{const response=await raw(mf,service,route,payload,upload,credential);assert.equal(response.ok,true,`recovery request ${service} ${route}: ${response.status} ${response.ok?'':await response.clone().text()}`);return response;};
  const post=async(mf,route,payload)=>raw(mf,'licensing',route,payload);
  const download=async(mf,token,id)=> (await mf.getWorker('licensing')).fetch('https://local/v1/releases/'+id,{headers:{Authorization:'Bearer '+token}});
  try {
    let source=runtime('source');
    const seeded=await raw(source,'store','/fixture/seed',{});assert.equal(seeded.status,200,await seeded.clone().text());const license=await seeded.json();
    const bucket=await source.getR2Bucket('ARTIFACTS','licensing'), bytes=Buffer.from('signed synthetic application');
    await bucket.put('app.tar.gz',bytes);await bucket.put('unattached.txt','unattached synthetic artifact');
    for(const [id,releasedAt,version] of [['old',150000,'1.0.0'],['gap',250000,'1.1.0'],['new',350000,'1.2.0']]) {
      assert.equal((await post(source,'/internal/publish',{id,product:'ascii-vj-remix',key:'app.tar.gz',major:1,releasedAt,update:{version,platform:'darwin-aarch64',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),signature:signer.sign(bytes)}})).status,201);
    }
    const token=(await (await post(source,'/v1/activate',{key:license.key,installation:'mac'})).json()).token;assert.ok(token);
    const compKey='synthetic-revoked-'+secret;
    await post(source,'/internal/grant',{id:'revoked',key:compKey,product:'ascii-vj-remix',seats:1,policy:{kind:'lifetime'}});
    const revokedToken=(await (await post(source,'/v1/activate',{key:compKey,installation:'mac'})).json()).token;
    await post(source,'/internal/revoke',{id:'revoked'});
    assert.equal((await download(source,token,'old')).status,200);assert.equal((await download(source,token,'new')).status,403);
    await stop(source); // No in-flight request or alarm can straddle the checkpoint.
    source=runtime('source',{SOFTWARE_RECOVERY_CHECKPOINT:checkpoint});
    assert.equal((await post(source,'/v1/activate',{key:license.key,installation:'other'})).status,503);
    for(const [service,route] of [['store','/admin/store/recovery/software'],['licensing','/internal/backup']]) {
      assert.equal((await raw(source,service,route,{checkpoint,action:'begin',owner:'software-licenses',count:0},undefined,readSecret)).status,403);
    }
    const snapshot=path.join(temp,'snapshot');createSyntheticSnapshot(snapshot);
    const ordersPath=path.join(snapshot,'kv','orders.values.json');const orders=JSON.parse(fs.readFileSync(ordersPath,'utf8'));orders['orders:'+orderToken]={value:JSON.stringify(order)};write(ordersPath,orders);
    const captured=await captureSoftwareBackup(snapshot,{checkpoint,request:client(source,readSecret)});
    const originalOrders=fs.readFileSync(ordersPath,'utf8');
    write(ordersPath,{});assert.throws(()=>validateSoftwareBackup(snapshot),/KV and software checkpoint differ/);fs.writeFileSync(ordersPath,originalOrders,{mode:0o600});
    // Negative capture cases cannot produce a complete software manifest.
    const broken=path.join(temp,'broken');fs.mkdirSync(broken);
    await assert.rejects(captureSoftwareBackup(broken,{checkpoint,request:async(service,route,p,upload)=>{
      const response=await client(source,readSecret)(service,route,p,upload);
      if(service==='licensing' && p?.action==='export' && p.table==='grants') { const page=await response.json();page.rows.pop();return Response.json(page); } return response;
    }}),/Incomplete authority page/);
    const manifest=JSON.parse(fs.readFileSync(path.join(snapshot,'manifest.json'),'utf8'));
    Object.assign(manifest,{includesSoftwareLicensing:true,softwareLicensing:captured,completedAt:new Date().toISOString(),warnings:[],includedDataClasses:['software-licensing-journals-and-artifacts']});
    write(path.join(snapshot,'manifest.json'),manifest);write(path.join(snapshot,'checksums.json'),{schemaVersion:1,artifacts:buildChecksumManifest(snapshot,{exclude:['checksums.json']})});
    assert.equal(buildStoreRestorePlan(readAndVerifySnapshot(snapshot),{target:'local'}).invalidActions.length,0);
    const identity=path.join(temp,'identity');if(archiveIdentity) fs.writeFileSync(identity,archiveIdentity+'\n',{mode:0o600}); else execFileSync('age-keygen',['-o',identity],{stdio:'pipe'});fs.chmodSync(identity,0o600);
    const recipient=execFileSync('age-keygen',['-y',identity],{encoding:'utf8'}).trim();process.env.STORE_BACKUP_AGE_IDENTITY=identity;
    const archive=path.join(temp,'archive'),options={softwareLicensing:true,acknowledgeSensitive:'STORE_SENSITIVE_BACKUP',encryptionRecipient:recipient,encryptionBackend:'age'};
    assert.equal(validateBackupSafety(options,archive).ok,true);
    const receipt=archiveSensitiveSnapshot(snapshot,archive,options,manifest);assert.equal(fs.existsSync(snapshot),false);
    const archiveForRestore=archiveRoundTrip ? await archiveRoundTrip({archive,receipt,identity,temp}) : archive;
    // Existing Platform verifier checks every archived file without trusting extraction.
    const verifier=path.join(root,'shared/dust-wave-platform/scripts/verify-recovery-archive.py');
    execFileSync('python3',['-c',`import importlib.util,json,os,pathlib,subprocess,sys
spec=importlib.util.spec_from_file_location('audit',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
folder=pathlib.Path(sys.argv[2]);receipt=json.loads((folder/'manifest.json').read_text())
def command(args): return subprocess.check_output(args,stderr=subprocess.PIPE)
result=m.verify_snapshot(receipt,folder/receipt['archive'],{'RECOVERY_ARCHIVE_NAME':receipt['archive'],'RECOVERY_AGE_IDENTITY':pathlib.Path(os.environ['STORE_BACKUP_AGE_IDENTITY']).read_text()},folder,command)
assert result['status']=='PASS',result
`,verifier,archiveForRestore],{stdio:'pipe'});
    const decrypted=path.join(temp,'decrypted');fs.mkdirSync(decrypted,{mode:0o700});const tar=path.join(temp,'restore.tar.gz');
    execFileSync('age',['--decrypt','--identity',identity,'--output',tar,path.join(archiveForRestore,receipt.archive)]);execFileSync('tar',['-xzf',tar,'-C',decrypted]);readAndVerifySnapshot(decrypted);
    const preview=previewRestore ? await previewRestore({snapshot:decrypted,secret,readSecret,checkpoint,publicKey:signer.publicKey,token,revokedToken,license,bytes,temp}) : null;
    const drift=await reconcileSoftwareMoney(decrypted,async route=>{
      const result=await stripeRead(route);if(route.startsWith('/refunds?')&&route.includes('pi_first'))return {has_more:false,data:[{...refund,id:'re_after_backup',payment_intent:'pi_first'}]};return result;
    });assert.equal(drift.ok,false);assert.ok(drift.issues.includes('unreconciled_refund'));
    let target=runtime('target',{SOFTWARE_RECOVERY_CHECKPOINT:checkpoint,SOFTWARE_RECOVERY_TARGET:'empty'});
    await assert.rejects(restoreSoftwareBackup(decrypted,{previewId:'0123456789abcdef',request:client(target),stripeRead}),/Preview destination identity/);
    const untouched=await (await raw(target,'licensing','/internal/backup',{checkpoint,action:'info'})).json();
    assert.equal(untouched.recovery,null);assert.equal(untouched.counts.grants,0);
    let loseUpload=true;
    await assert.rejects(restoreSoftwareBackup(decrypted,{stripeRead,request:async(...args)=>{
      const response=await client(target)(...args);
      if(args[1].startsWith('/internal/backup-upload') && loseUpload) {loseUpload=false;throw new Error('lost upload reply');}
      return response;
    }}),/lost upload reply/);
    assert.equal((await download(target,token,'old')).status,503);
    const restored=await restoreSoftwareBackup(decrypted,{request:client(target),stripeRead});assert.equal(restored.ok,true);
    const kvTarget=await target.getKVNamespace('STORE_STATE');
    const plan=buildStoreRestorePlan(readAndVerifySnapshot(decrypted),{target:'local'});
    for(const action of plan.actions.filter(action=>action.type==='kv-restore')) {
      for(const record of transformKvValuesToRestoreRecords(JSON.parse(fs.readFileSync(action.valuesFile,'utf8')))) {
        await kvTarget.put(record.key,record.base64?Buffer.from(record.value,'base64'):record.value,{...(record.metadata?{metadata:record.metadata}:{})});
        assert.equal(await kvTarget.get(record.key),record.base64?Buffer.from(record.value,'base64').toString():record.value);
      }
    }
    assert.equal(await kvTarget.get('store-admin-session:must-not-restore'),null);
    assert.equal(await kvTarget.get('abandoned-cart:must-not-restore'),null);
    assert.equal((await restoreSoftwareBackup(decrypted,{request:client(target),stripeRead})).ok,true);
    await stop(target);target=runtime('target');assert.equal((await download(target,token,'old')).status,503);await stop(target);
    // Only the synthetic rehearsal explicitly accepts the completed checkpoint.
    target=runtime('target',{SOFTWARE_RECOVERY_ACCEPTED:checkpoint});
    assert.equal(await (await download(target,token,'old')).text(),bytes.toString());
    assert.equal((await download(target,token,'gap')).status,403);assert.equal((await download(target,token,'new')).status,403);assert.equal((await download(target,revokedToken,'old')).status,403);
    assert.equal((await post(target,'/v1/activate',{key:license.key,installation:'second-mac'})).status,409);
    const ns=await target.getDurableObjectNamespace('STORE_INVENTORY_COORDINATOR','store');
    const journal=ns.get(ns.idFromName('software-billing:'+orderToken));
    const billing=async(action,p={})=>journal.fetch('https://journal/billing-'+action,{method:'POST',body:JSON.stringify(p)});
    const recovered=await (await billing('recover',{lineId:'software'})).json();assert.equal(recovered.key,license.key);
    await billing('invoice',{invoiceId:'in_first',eventId:'evt_replayed'});await billing('drain');
    const kv=await target.getKVNamespace('STORE_STATE');assert.equal((await kv.list({prefix:'email-outbox:v1:'})).keys.length,0);
    assert.equal(externalCalls,0);
    return {ok:true,preview,encrypted:true,archiveVerification:'PASS',captured,restored,checks:['read-only capture credential cannot import','paused mutation rejected','more than one export page','missing page rejected','mismatched KV checkpoint rejected','age round trip and full checksums','fresh refund drift blocks acceptance','restored authority stays closed','artifact readback and signature rebinding','old activation retained and seat limit enforced','coverage gap and refunded renewal denied','seller revocation retained','lost upload reply and complete restore replay safe','original Store key retained','approved KV and mail receipts restored without sessions or pending mail','duplicate payment event produces no new mail'],externalRequests:externalCalls,livePayments:0,realEmails:0,paidCheckoutEnabled:false};
  } finally {
    await Promise.allSettled([...runtimes].map(mf=>mf.dispose()));fs.rmSync(temp,{recursive:true,force:true});
    if(previousIdentity===undefined)delete process.env.STORE_BACKUP_AGE_IDENTITY;else process.env.STORE_BACKUP_AGE_IDENTITY=previousIdentity;
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const evidence=await rehearseSoftwareRestore();
  const output=process.argv.find(arg=>arg.startsWith('--evidence='))?.slice('--evidence='.length);
  if(output)fs.writeFileSync(path.resolve(output),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(evidence,null,2));
}

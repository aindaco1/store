import fs from 'node:fs';
import { validateSoftwareJournalRecord } from '../../worker/src/software-backup.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readBoundedJson } from '../../shared/dust-wave-platform/packages/worker-core/src/response-body.js';
import { DEFAULT_STRIPE_API_VERSION } from '../../worker/src/stripe.js';
import { sha256File, verifyChecksumManifest } from './file-integrity.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const tables = ['grants','installs','coverage','releases'];
const write = (root,name,value) => fs.writeFileSync(path.join(root,name),JSON.stringify(value)+'\n',{mode:0o600});
const read = (root,name) => JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const check = (condition,message) => { if (!condition) throw new Error(message); };
const maxPages = 40000;
export function softwareBackupClient({ storeBase = process.env.WORKER_BASE, licensingBase = process.env.LICENSING_WORKER_BASE,
  storeSecret, licensingSecret, restore = false, fetchImpl = fetch } = {}) {
  storeSecret ||= (restore ? '' : process.env.SOFTWARE_BACKUP_READ_SECRET) || process.env.ADMIN_MAINTENANCE_SECRET || process.env.ADMIN_SECRET;
  licensingSecret ||= (restore ? '' : process.env.LICENSING_BACKUP_READ_SECRET) || process.env.LICENSING_ADMIN_SECRET;
  const bases = {store:storeBase,licensing:licensingBase}, secrets = {store:storeSecret,licensing:licensingSecret};
  for (const service of ['store','licensing']) {
    const url = new URL(bases[service]);
    check((url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password && !!secrets[service], 'Software backup needs authenticated HTTPS origins (or isolated loopback)');
  }
  return async (service,route,payload,upload) => {
    const response = await fetchImpl(new URL(route,bases[service]),{method:'POST',redirect:'error',signal:AbortSignal.timeout(upload ? 300000 : 60000),
      headers:{Authorization:`Bearer ${secrets[service]}`,'Content-Type':upload ? 'application/octet-stream' : 'application/json',...(upload ? {'Content-Length':String(fs.statSync(upload).size)} : {})},
      body:upload ? fs.createReadStream(upload) : JSON.stringify(payload),...(upload ? {duplex:'half'} : {})});
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Software recovery ${service} request failed (${response.status})`); }
    return response;
  };
}
const storeRoute = '/admin/store/recovery/software';
const authorityRoute = '/internal/backup';
async function json(request,service,route,payload) { return readBoundedJson(await request(service,route,payload),2*1024*1024); }
async function pages(fetchPage,consume) {
  let cursor = null; const seen = new Set();
  for (let index=0; index<maxPages; index++) {
    const page = await fetchPage(cursor);
    await consume(page,index);
    if (page.cursor === null) return;
    check(typeof page.cursor === 'string' && page.cursor && !seen.has(page.cursor),'Incomplete or repeated software backup cursor');
    seen.add(page.cursor); cursor=page.cursor;
  }
  throw new Error('Software backup page limit exceeded');
}
async function objects(request,checkpoint) {
  const rows=[];
  await pages(cursor => json(request,'licensing','/internal/backup-objects',{checkpoint,cursor}),page => {
    check(page.version===1 && page.checkpoint===checkpoint && Array.isArray(page.objects) && page.objects.length<=25,'Invalid artifact inventory');
    rows.push(...page.objects);
  });
  check(new Set(rows.map(row=>row.key)).size===rows.length,'Duplicate artifact');
  return rows.sort((a,b)=>a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
export async function captureSoftwareBackup(snapshotRoot,{checkpoint,request=softwareBackupClient(),sourceId}={}) {
  check(/^[a-zA-Z0-9_-]{16,100}$/.test(checkpoint || ''),'A shared software maintenance checkpoint is required');
  const root=path.join(snapshotRoot,'software');
  fs.mkdirSync(root,{mode:0o700});
  const manifest={version:1,checkpoint,owners:[],tables:{},objects:[],orders:{count:0,pages:[]}};
  const validatePage=page=>check(page.version===1 && page.checkpoint===checkpoint,'Software checkpoint/schema mismatch');
  manifest.store=await json(request,'store',storeRoute,{checkpoint,action:'info'}); validatePage(manifest.store);
  manifest.authority=await json(request,'licensing',authorityRoute,{checkpoint,action:'info'}); validatePage(manifest.authority);
  check(manifest.authority.schema===3,'Unsupported licensing schema');
  const expectedSource=sourceId || manifest.store.source?.sourceId;
  if(expectedSource || manifest.authority.source) check(/^[a-f0-9]{16}$/.test(expectedSource || '') && [manifest.store,manifest.authority].every(info=>info.source?.sourceId===expectedSource && info.source.phase==='frozen' && info.source.active===0 && info.source.checkpoint===checkpoint && info.paidCheckoutEnabled===false),'Source is not frozen at a matching checkpoint');
  const registry=[];
  async function owner(name) {
    const entry={name,count:0,pages:[]}, seen=new Set();
    await pages(cursor=>json(request,'store',storeRoute,{checkpoint,action:'export',owner:name,cursor}), (page,index)=>{
      validatePage(page); check(Array.isArray(page.records) && page.records.length<=25,'Invalid journal page');
      for (const [key,value] of page.records) {
        check(!seen.has(key),'Duplicate journal record'); seen.add(key);
        if (name==='software-licenses' && key.startsWith('billing-owner:v1:')) registry.push(value.orderToken);
      }
      const file=`owner-${hash(name)}-${index}.json`; write(root,file,page.records); entry.pages.push(file); entry.count+=page.records.length;
    });
    manifest.owners.push(entry);
  }
  await owner('software-licenses');
  check(new Set(registry).size===registry.length && registry.every(id=>/^store-order-[a-f0-9]{64}$/.test(id)),'Invalid billing owner index');
  for (const id of registry.sort()) await owner(`software-billing:${id}`);
  await pages(cursor=>json(request,'store',storeRoute,{checkpoint,action:'orders',cursor}),(page,index)=>{
    validatePage(page); check(Array.isArray(page.records) && page.records.length<=25,'Invalid order page');
    for (const [key,order] of page.records) {
      check(key===`orders:${order.orderToken}` && registry.includes(order.orderToken),'Canonical software order has no recovery journal index');
      check(order?.orderToken,'Missing canonical order');
    }
    const file=`orders-${index}.json`;write(root,file,page.records);manifest.orders.pages.push(file);manifest.orders.count+=page.records.length;
  });
  for (const table of tables) {
    const count=manifest.authority.counts[table], entry={count,pages:[]};
    check(Number.isSafeInteger(count) && count>=0 && count<=1000000,'Invalid authority count');
    for (let offset=0; offset<count; offset+=25) {
      const page=await json(request,'licensing',authorityRoute,{checkpoint,action:'export',table,offset}); validatePage(page);
      check(page.table===table && page.offset===offset && page.rows?.length===Math.min(25,count-offset),'Incomplete authority page');
      const file=`${table}-${offset}.json`; write(root,file,page.rows); entry.pages.push(file);
    }
    manifest.tables[table]=entry;
  }
  const inventory=await objects(request,checkpoint);
  for (const object of inventory) {
    check(typeof object.key==='string' && object.key.length<=1024 && typeof object.version==='string' && typeof object.etag==='string' && Number.isSafeInteger(object.size) && object.size>=0 && object.size<=160*1024*1024,'Invalid artifact metadata');
    const file=`artifact-${hash(object.key)}.bin`, target=path.join(root,file);
    const response=await request('licensing','/internal/backup-object',{checkpoint,...object});
    let received=0;
    const bounded=new Transform({transform(chunk,_encoding,callback) { received+=chunk.length; callback(received>object.size ? new Error('Artifact exceeded declared size') : null,chunk); }});
    await pipeline(Readable.fromWeb(response.body),bounded,fs.createWriteStream(target,{mode:0o600}));
    check(fs.statSync(target).size===object.size,'Incomplete artifact body');
    manifest.objects.push({...object,file,sha256:sha256File(target)});
  }
  check(JSON.stringify(inventory)===JSON.stringify(await objects(request,checkpoint)),'Artifacts changed during checkpoint capture');
  const authority=await json(request,'licensing',authorityRoute,{checkpoint,action:'info'});
  check(JSON.stringify(authority)===JSON.stringify(manifest.authority),'Authority changed during checkpoint capture');
  check(JSON.stringify(await json(request,'store',storeRoute,{checkpoint,action:'info'}))===JSON.stringify(manifest.store),'Store changed during checkpoint capture');
  write(root,'manifest.json',manifest);
  validateSoftwareBackup(snapshotRoot);
  return {version:1,owners:manifest.owners.length,records:manifest.owners.reduce((sum,owner)=>sum+owner.count,0),authorityRows:Object.values(manifest.tables).reduce((sum,t)=>sum+t.count,0),objects:manifest.objects.length};
}
export function validateSoftwareBackup(snapshotRoot) {
  const root=path.join(snapshotRoot,'software'), manifest=read(root,'manifest.json');
  check(manifest.version===1 && /^[a-zA-Z0-9_-]{16,100}$/.test(manifest.checkpoint) && manifest.authority?.schema===3 && Object.keys(manifest.tables||{}).sort().join()===tables.slice().sort().join(),'Unsupported software snapshot');
  const named=new Set(['manifest.json']);
  const file = name => { check(typeof name==='string' && /^[a-zA-Z0-9_-]+\.(json|bin)$/.test(name) && !named.has(name),'Invalid/duplicate software artifact'); named.add(name); return path.join(root,name); };
  const rows = entry => {
    check(Array.isArray(entry.pages) && Number.isSafeInteger(entry.count) && entry.count>=0,'Invalid software journal');
    const records=entry.pages.flatMap(name=>{ const value=JSON.parse(fs.readFileSync(file(name),'utf8')); check(Array.isArray(value) && value.length<=25,'Invalid software page'); return value; });
    check(records.length===entry.count,'Incomplete software journal'); return records;
  };
  const owners=new Map();
  for (const entry of manifest.owners) {
    check((entry.name==='software-licenses' || /^software-billing:store-order-[a-f0-9]{64}$/.test(entry.name)) && !owners.has(entry.name),'Invalid software owner');
    const values=rows(entry); values.forEach(validateSoftwareJournalRecord);
    check(values.every(([key,value])=>entry.name==='software-licenses' ? /^(billing-owner:v1:|complimentary:v1:)/.test(key) : key.startsWith('billing-') && !key.startsWith('billing-owner:') && (key!=='billing-order' || entry.name==='software-billing:'+value.orderToken)),'Journal belongs to a different owner');
    check(new Set(values.map(([key])=>key)).size===values.length,'Duplicate journal key'); owners.set(entry.name,values);
  }
  check(owners.has('software-licenses'),'Missing complimentary owner');
  const expected=['software-licenses',...owners.get('software-licenses').filter(([key])=>key.startsWith('billing-owner:v1:')).map(([,v])=>`software-billing:${v.orderToken}`)].sort();
  check(expected.join() === [...owners.keys()].sort().join(),'Missing billing journal');
  const authority=Object.fromEntries(tables.map(table=>[table,rows(manifest.tables[table])]));
  for (const table of tables) check(authority[table].length===manifest.authority.counts[table],'Authority count mismatch');
  const grants=new Map(authority.grants.map(row=>[row.id,row]));
  check(grants.size===authority.grants.length,'Duplicate authority grant');
  const periods=new Map(authority.coverage.map(row=>[row.grant_id+':'+row.id,row]));
  check(periods.size===authority.coverage.length,'Duplicate coverage');
  for (const records of owners.values()) for(const [key,value] of records) {
    if(key.startsWith('complimentary:v1:') && value.grantedAt) check(grants.get(value.payload.id)?.key_hash===value.keyHash,'Completed complimentary grant missing from authority');
    if(key.startsWith('billing-license:') && value.grantedAt) check(grants.get(value.id)?.key_hash===value.keyHash,'Completed paid grant missing from authority');
    if(key.startsWith('billing-work:') && value.type==='coverage' && value.done) {
      const license=records.find(([k])=>k==='billing-license:'+value.lineId)?.[1], period=periods.get(license?.id+':'+value.coverageId);
      check(period && period.revision>=value.revision && period.policy===JSON.stringify(value.policy),'Completed coverage/refund missing from authority');
    }
  }
  check(new Set(manifest.objects.map(o=>o.key)).size===manifest.objects.length,'Duplicate artifact key');
  for (const object of manifest.objects) { const target=file(object.file); check(fs.statSync(target).size===object.size && sha256File(target)===object.sha256,'Artifact checksum mismatch'); }
  for (const release of authority.releases) { const metadata=JSON.parse(release.metadata), object=manifest.objects.find(o=>o.key===metadata.key);
    check(object && metadata.etag===object.etag && metadata.version===object.version && metadata.update?.size===object.size && metadata.update?.sha256===object.sha256,'Release artifact missing or changed'); }
  const orderRows=rows(manifest.orders);
  check(new Set(orderRows.map(([key])=>key)).size===orderRows.length,'Duplicate canonical order');
  const kvFile=path.join(snapshotRoot,'kv','orders.values.json');
  const capturedOrders=fs.existsSync(kvFile)?JSON.parse(fs.readFileSync(kvFile,'utf8')):{};
  const kvSoftware=new Map();
  for(const [key,entry] of Object.entries(capturedOrders)) {
    const order=JSON.parse(typeof entry==='string'?entry:entry.value);
    if(order?.payment?.billing?.snapshot) kvSoftware.set(key,order);
  }
  check(kvSoftware.size===orderRows.length && orderRows.every(([key,order])=>JSON.stringify(kvSoftware.get(key))===JSON.stringify(order)),'Canonical KV and software checkpoint differ');
  for (const [key,order] of orderRows) { const journal=owners.get(`software-billing:${order.orderToken}`), frozen=journal?.find(([k])=>k==='billing-order')?.[1];
    check(key===`orders:${order.orderToken}` && frozen?.orderToken===order.orderToken && frozen.orderHash===order.orderHash,'Missing or inconsistent canonical order journal'); }
  check(fs.readdirSync(root).sort().join() === [...named].sort().join(),'Unlisted software snapshot artifact');
  return {root,manifest,owners,authority};
}
// This comparison only reads Stripe. An unrecorded/post-checkpoint refund blocks
// acceptance; neither a backup nor this comparison authorizes a new payment.
export async function reconcileSoftwareMoney(snapshotRoot,stripeRead) {
  const {owners}=validateSoftwareBackup(snapshotRoot); const issues=[]; let payments=0, refunds=0;
  for (const records of owners.values()) {
    const values=new Map(records), order=values.get('billing-order'); if (!order) continue;
    const initialId=order.billing.initialInvoiceId || order.paymentIntentId;
    if (!values.has(`billing-payment:${initialId}`)) {
      await stripeRead(`/payment_intents/${encodeURIComponent(order.paymentIntentId)}`);
      issues.push('missing_initial_receipt');
    }
    if (order.billing.subscriptionId) {
      let cursor=''; const seen=new Set();
      for(let page=0;page<maxPages;page++) {
        const result=await stripeRead('/invoices?'+new URLSearchParams({subscription:order.billing.subscriptionId,limit:'100',...(cursor?{starting_after:cursor}:{})}));
        check(Array.isArray(result.data) && result.data.length<=100 && typeof result.has_more==='boolean','Invalid invoice inventory');
        for(const invoice of result.data) {
          check(!seen.has(invoice.id),'Repeated invoice page'); seen.add(invoice.id);
          const paid=values.get(`billing-payment:${invoice.id}`);
          if(invoice.livemode!==false || invoice.customer!==order.billing.customerId || invoice.parent?.subscription_details?.subscription!==order.billing.subscriptionId ||
              (invoice.status==='paid' && (!paid || paid.receipt.amountCents!==invoice.amount_paid)) || !['paid','void'].includes(invoice.status)) issues.push('unreconciled_invoice');
        }
        if(!result.has_more)break;
        check(result.data.length>0 && page<maxPages-1,'Incomplete invoice inventory');cursor=result.data.at(-1).id;
      }
      for(const [key,value] of records) if(key.startsWith('billing-payment:') && value.receipt.id.startsWith('in_') && !seen.has(value.receipt.id))issues.push('missing_provider_invoice');
    }
    for (const [key,value] of records) {
      if (key.startsWith('billing-review:') || (key.startsWith('billing-refund:') && !['succeeded','failed'].includes(value.state))) issues.push('unresolved_billing_review');
      if (!key.startsWith('billing-payment:')) continue;
      const receipt=value.receipt, pi=await stripeRead(`/payment_intents/${encodeURIComponent(receipt.paymentIntentId)}`); payments++;
      if (pi.id!==receipt.paymentIntentId || pi.livemode!==false || pi.status!=='succeeded' || pi.currency!=='usd' || pi.amount!==receipt.amountCents || pi.amount_received!==receipt.amountCents || pi.metadata?.orderToken!==order.orderToken || (order.billing.customerId && (typeof pi.customer==='string'?pi.customer:pi.customer?.id)!==order.billing.customerId)) issues.push('payment_mismatch');
      let cursor='', seen=new Set();
      for (let page=0; page<maxPages; page++) {
        const result=await stripeRead('/refunds?'+new URLSearchParams({payment_intent:pi.id,limit:'100',...(cursor ? {starting_after:cursor} : {})}));
        check(Array.isArray(result.data) && result.data.length<=100 && typeof result.has_more==='boolean','Invalid refund inventory');
        for (const refund of result.data) {
          if (seen.has(refund.id)) throw new Error('Repeated refund page'); seen.add(refund.id); refunds++;
          const record=records.find(([k,v])=>k.startsWith('billing-refund:') && v.refundId===refund.id)?.[1];
          if (!record || refund.payment_intent!==pi.id || refund.currency!=='usd' || record.amountCents!==refund.amount || record.state!==refund.status || !['succeeded','failed'].includes(refund.status)) issues.push('unreconciled_refund');
        }
        if (!result.has_more) break;
        check(result.data.length>0 && page<maxPages-1,'Incomplete refund inventory'); cursor=result.data.at(-1).id;
      }
      for (const [k,v] of records) if (k.startsWith('billing-refund:') && v.request.paymentId===receipt.id && v.refundId && !seen.has(v.refundId)) issues.push('missing_provider_refund');
    }
  }
  return {ok:issues.length===0,payments,refunds,issues:[...new Set(issues)],providerWrites:0};
}
export async function verifySoftwareRestoreDestination(snapshotRoot,{request,previewId}) {
  const {manifest}=validateSoftwareBackup(snapshotRoot), checkpoint=manifest.checkpoint;
  const info=await json(request,'licensing',authorityRoute,{checkpoint,action:'info'}), store=await json(request,'store',storeRoute,{checkpoint,action:'info'});
  if (previewId) check([info,store].every(value=>value.previewId===previewId && value.target==='empty' && value.paidCheckoutEnabled===false),'Preview destination identity or disabled-sales guard mismatch');
  check(info.keyProof===manifest.authority.keyProof && info.publicKey===manifest.authority.publicKey && store.keyProof===manifest.store.keyProof,'Original licensing secrets/signing key required');
  return {info,store};
}
export async function restoreSoftwareBackup(snapshotRoot,{request=softwareBackupClient({restore:true}),stripeRead,previewId}={}) {
  const checksums=read(snapshotRoot,'checksums.json');
  check(verifyChecksumManifest(snapshotRoot,checksums.artifacts,{requireComplete:true,exclude:['checksums.json']}).ok,'Snapshot integrity failed');
  const {root,manifest,authority,owners}=validateSoftwareBackup(snapshotRoot), checkpoint=manifest.checkpoint;
  check(typeof stripeRead==='function','Fresh read-only money comparison is required');
  const money=await reconcileSoftwareMoney(snapshotRoot,stripeRead);
  check(money.ok,'Money reconciliation requires review; restore remains closed');
  const {info}=await verifySoftwareRestoreDestination(snapshotRoot,{request,previewId});
  const priorObjects=await objects(request,checkpoint);
  check(!priorObjects.length || info.recovery?.checkpoint===checkpoint,'Artifact destination is not empty');
  check(priorObjects.every(object=>manifest.objects.some(source=>source.key===object.key)),'Unexpected destination artifact');
  // Begin all owners before importing: no destination can serve partial rights.
  for (const owner of manifest.owners) await json(request,'store',storeRoute,{checkpoint,action:'begin',owner:owner.name,count:owner.count});
  await json(request,'licensing',authorityRoute,{checkpoint,action:'begin',counts:manifest.authority.counts});
  for (const owner of manifest.owners) for (const name of owner.pages) { const records=read(root,name); if (records.length) await json(request,'store',storeRoute,{checkpoint,action:'import',owner:owner.name,records}); }
  for (const table of tables) for (const name of manifest.tables[table].pages) await json(request,'licensing',authorityRoute,{checkpoint,action:'import',table,rows:read(root,name)});
  for (const object of manifest.objects) {
    if (priorObjects.some(prior=>prior.key===object.key)) continue;
    await request('licensing','/internal/backup-upload?'+new URLSearchParams({key:object.key,checkpoint}),null,path.join(root,object.file));
  }
  const uploaded=await objects(request,checkpoint);
  check(uploaded.length===manifest.objects.length,'Incomplete restored artifact inventory');
  for (const object of uploaded) {
    const original=manifest.objects.find(o=>o.key===object.key); check(original && original.size===object.size,'Restored artifact mismatch');
    const response=await request('licensing','/internal/backup-object',{checkpoint,...object});
    const digest=createHash('sha256'); for await (const chunk of response.body) digest.update(chunk);
    check(digest.digest('hex')===original.sha256,'Restored artifact readback failed');
  }
  for (const row of authority.releases) await json(request,'licensing',authorityRoute,{checkpoint,action:'verify-artifact',id:row.id});
  // Compare full logical records, not just counts, before marking import complete.
  for (const owner of manifest.owners) {
    const actual=[];
    await pages(cursor=>json(request,'store',storeRoute,{checkpoint,action:'export',owner:owner.name,cursor}),page=>actual.push(...page.records));
    check(JSON.stringify(actual)===JSON.stringify(owners.get(owner.name)),'Restored journal readback failed');
  }
  const normalize=row=>{
    if (!row.metadata) return row;
    const metadata=JSON.parse(row.metadata);delete metadata.etag;delete metadata.version;
    return {...row,metadata:JSON.stringify(metadata)};
  };
  for(const table of tables) for(let offset=0;offset<authority[table].length;offset+=25) {
    const actual=await json(request,'licensing',authorityRoute,{checkpoint,action:'export',table,offset});
    check(JSON.stringify(actual.rows.map(normalize))===JSON.stringify(authority[table].slice(offset,offset+25).map(normalize)),'Restored authority readback failed');
  }
  for (const owner of manifest.owners) await json(request,'store',storeRoute,{checkpoint,action:'finish',owner:owner.name});
  await json(request,'licensing',authorityRoute,{checkpoint,action:'finish'});
  return {ok:true,money,owners:manifest.owners.length,artifacts:uploaded.length,quarantined:true,automaticPayments:0,automaticEmails:0};
}

// HTTPS execution is limited to run-specific rehearsal Workers. Production remains forbidden.
export function softwareRecoveryClients({target='local',previewId}={}) {
  for (const value of [process.env.WORKER_BASE,process.env.LICENSING_WORKER_BASE]) {
    const url=new URL(value);
    if(target==='local') check(url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Software restore requires isolated loopback Workers');
    else check(target==='preview' && /^[a-f0-9]{16}$/.test(previewId || '') && url.protocol==='https:' && new RegExp('^dw-recovery-'+previewId+'-(store|licensing)\\.[a-z0-9-]+\\.workers\\.dev$').test(url.hostname),'Software restore requires isolated preview Workers');
  }
  const secret=process.env.STRIPE_SECRET_KEY_TEST;
  check(secret?.startsWith('sk_test_'),'Read-only reconciliation requires a Stripe test key');
  return {request:softwareBackupClient({restore:true}),stripeRead:async route=>{
    check(/^\/(payment_intents\/pi_[A-Za-z0-9_]+|refunds\?|invoices\?)/.test(route),'Unsupported recovery provider read');
    const response=await fetch('https://api.stripe.com/v1'+route,{method:'GET',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${secret}`,'Stripe-Version':DEFAULT_STRIPE_API_VERSION}});
    check(response.ok,'Read-only provider reconciliation failed');return readBoundedJson(response,2*1024*1024);
  }};
}

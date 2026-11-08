import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { softwareBackupClient } from './software-backup.mjs';
const routes={store:'/admin/store/recovery/source',licensing:'/internal/source'};
export async function awaitSource(check, accept, {timeoutMs=60000}={}) {
  const deadline=Date.now()+timeoutMs;
  do { const value=await check();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,200)); } while(Date.now()<deadline);
  throw new Error('Source drain timed out; keep maintenance closed');
}
export function sourceController(request,sourceId) {
  return async (service,action,checkpoint) => (await request(service,routes[service],{action,sourceId,checkpoint})).json();
}
export async function pauseSoftwareSource(control,checkpoint) {
  const states={};
  // Finish Store handoffs before pausing the licensing authority they call.
  for(const service of ['store','licensing']) {
    await control(service,'pause',checkpoint);
    states[service]=await awaitSource(()=>control(service,'status'),state=>state.phase==='frozen' && state.active===0 && state.checkpoint===checkpoint);
  }
  return states;
}
export async function resumeSoftwareSource(control,checkpoint) {
  for(const service of ['licensing','store']) assert.equal((await control(service,'resume',checkpoint)).phase,'open');
}
export async function captureDeployedSource(context, resource, {report,emit}) {
  const {snapshot,secret,readSecret,checkpoint,seed,capture}=context;
  const {bases,previewId,prefix,run,directory,deploy}=resource;
  const request=softwareBackupClient({...bases,storeSecret:secret,licensingSecret:secret,restore:true});
  const read=softwareBackupClient({...bases,storeSecret:readSecret,licensingSecret:readSecret});
  const control=sourceController(request,previewId);
  const kvFiles=fs.readdirSync(path.join(snapshot,'kv')).filter(name=>name.endsWith('.values.json'));
  const ordinary=Object.fromEntries(kvFiles.map(name=>[name,JSON.parse(fs.readFileSync(path.join(snapshot,'kv',name),'utf8'))]));
  const downloadFile=path.join(snapshot,'r2/objects/downloads/restore-drill.txt');
  await request('store','/fixture/storage',{kv:Object.assign({},...Object.values(ordinary)),download:fs.readFileSync(downloadFile,'utf8')});
  const seeded=await seed(request,async(key,bytes)=> {
    const file=path.join(directory,key);fs.writeFileSync(file,bytes,{mode:0o600});run(['r2','object','put',`${prefix}-artifacts/${key}`,'--file',file,'--remote']);
  });
  for(const service of ['store','licensing']) await assert.rejects(read(service,routes[service],{action:'pause',sourceId:previewId,checkpoint}),/401|403/);
  await request('store','/fixture/alarm',{});
  await awaitSource(async()=>(await request('store','/fixture/alarm-state',{})).json(),value=>value.started);
  const held=request('store','/fixture/hold',{});
  // Attach rejection handling immediately; the assertion below still checks it.
  held.catch(()=>{});
  await awaitSource(()=>control('store','status'),value=>value.active>=2);
  assert.equal((await control('store','pause',checkpoint)).phase,'draining');
  await assert.rejects(control('store','resume',checkpoint),/409/);
  await assert.rejects(read('store','/admin/store/recovery/software',{action:'info',checkpoint}),/503/);
  const denied=await fetch(bases.storeBase+'/webhooks/stripe',{method:'POST',body:'{}',redirect:'error'});assert.equal(denied.status,503);
  const started=performance.now();
  const frozen=await pauseSoftwareSource(control,checkpoint);await held;
  report.timingsMs.sourceDrain=Math.round(performance.now()-started);
  // Redeploy identical guarded code: persistent freeze must survive a new version.
  for(const service of ['store','licensing'])deploy(service);
  for(const service of ['store','licensing'])assert.deepEqual(await control(service,'status'),frozen[service]);
  await request('store','/admin/store/recovery/software',{action:'fixture-scheduled',checkpoint});
  const exported=await awaitSource(async()=>(await read('store','/admin/store/recovery/software',{action:'fixture-storage',checkpoint})).json(),value=>
    Object.values(ordinary).every(family=>Object.entries(family).every(([key,entry])=>value.kv[key]?.value===entry.value)));
  assert.equal(exported.kv['fixture:inflight']?.value,'done');assert.equal(exported.kv['fixture:deferred']?.value,'done');assert.equal(exported.kv['fixture:alarm-finished']?.value,'true');
  assert.equal(exported.kv['cron:lastRun'],undefined);
  for(const [name,family] of Object.entries(ordinary)) {
    const values=Object.fromEntries(Object.keys(family).map(key=>[key,exported.kv[key]]));
    fs.writeFileSync(path.join(snapshot,'kv',name),JSON.stringify(values)+'\n',{mode:0o600});
  }
  assert.equal(exported.download,fs.readFileSync(downloadFile,'utf8'));fs.writeFileSync(downloadFile,exported.download,{mode:0o600});
  seeded.captured=await capture(read,previewId);
  report.source={deployed:true,checkpointMatched:true,inflightDrained:true,deferredWritesDrained:true,alarmDrained:true,scheduledBlocked:true,webhookBlocked:true,restartFreeze:true,ordinaryKvReadback:true,downloadReadback:true,resumed:false};emit();
  await resumeSoftwareSource(control,checkpoint);
  await resumeSoftwareSource(control,checkpoint); // Lost resume response is safe to retry.
  const authorized=await fetch(bases.licensingBase+'/v1/releases/old',{headers:{Authorization:`Bearer ${seeded.token}`},redirect:'error'});assert.equal(authorized.status,200);await authorized.body.cancel();
  const replay=await (await request('store','/fixture/replay',{key:seeded.license.key})).json();assert.equal(replay.sameKey,true);
  assert.equal(replay.queuedMail,Object.keys(exported.kv).filter(key=>key.startsWith('email-outbox:v1:')).length);
  report.source.resumed=true;emit();
  return seeded;
}

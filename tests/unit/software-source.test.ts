import { describe, it, expect } from 'vitest';
import { sourceControl, sourceWork, sourceCheckpointEnv, withStoreSource } from '../../worker/src/software-source.js';
const checkpoint = 'source-checkpoint-0123456789';
function fixture() {
  const values = new Map();
  const storage: any = { get: async (key: string) => structuredClone(values.get(key)), put: async (key: string, value: any) => values.set(key, structuredClone(value)) };
  storage.transaction = (fn: any) => fn(storage);
  const env: any = { APP_MODE:'test',SOFTWARE_CHECKOUT_ENABLED:'false',SOFTWARE_RECOVERY_SOURCE_ID:'0123456789abcdef',SOFTWARE_RECOVERY_PREVIEW_ID:'0123456789abcdef' };
  env.STORE_INVENTORY_COORDINATOR = {idFromName:(name: string)=>name,get:()=>({fetch:async (r: Request)=> {
    try {return Response.json(await sourceControl(storage,env,await r.json()));} catch {return Response.json({error:'rejected'},{status:409});}
  }})};
  const control = (action: string, extra = {}) => sourceControl(storage,env,{action,sourceId:env.SOFTWARE_RECOVERY_SOURCE_ID,...extra});
  return {storage,env,control};
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r=>resolve=r); return {promise,resolve}; };
describe('deployed source maintenance', () => {
  it('waits for admitted requests and deferred writes; rejects new work and early resume', async () => {
    const {env,control} = fixture(), started=deferred(), finish=deferred(), mail=deferred();
    let effects=0;
    const running=sourceWork(env,{},async ctx=>{ctx.waitUntil(mail.promise.then(()=>effects++));started.resolve();await finish.promise;effects++;return true;});
    await started.promise;
    expect(await control('pause',{checkpoint})).toMatchObject({phase:'draining',active:1});
    expect(await sourceWork(env,{},()=>{throw new Error('must not start');})).toBeNull();
    await expect(sourceCheckpointEnv(env)).rejects.toThrow('not drained');
    await expect(control('resume',{checkpoint})).rejects.toThrow('not drained');
    finish.resolve();await Promise.resolve();expect((await control('status')).phase).toBe('draining');
    mail.resolve();await running;
    expect(effects).toBe(2);expect(await control('status')).toMatchObject({phase:'frozen',active:0});
    expect((await sourceCheckpointEnv(env)).SOFTWARE_RECOVERY_CHECKPOINT).toBe(checkpoint);
    await expect(control('resume',{checkpoint:'wrong-checkpoint-000'})).rejects.toThrow();
    expect(await control('resume',{checkpoint})).toMatchObject({phase:'open',generation:2});
    await expect(control('pause',{checkpoint})).rejects.toThrow('conflict');
  });
  it('keeps orphaned admissions across new clients and never times them out', async () => {
    const {env,storage,control}=fixture(),ticket=crypto.randomUUID();
    await control('enter',{ticket});await control('pause',{checkpoint});
    expect(await sourceControl(storage,{...env},{action:'status',sourceId:env.SOFTWARE_RECOVERY_SOURCE_ID})).toMatchObject({phase:'draining',active:1});
    await control('leave',{ticket});await control('leave',{ticket});
    expect(await control('status')).toMatchObject({phase:'frozen',active:0});
    await expect(control('pause',{checkpoint:'different-checkpoint-0000'})).rejects.toThrow();
  });
  it('bounds admission and refuses live, paid or restore-target wiring', async () => {
    const {env,storage,control}=fixture();
    for(let i=0;i<128;i++)await control('enter',{ticket:crypto.randomUUID()});
    expect(await control('enter',{ticket:crypto.randomUUID()})).toEqual({admitted:false});
    for(const change of [{APP_MODE:'live'},{SOFTWARE_CHECKOUT_ENABLED:'true'},{SOFTWARE_RECOVERY_TARGET:'empty'},{SOFTWARE_RECOVERY_PREVIEW_ID:'fedcba9876543210'}])
      await expect(sourceControl(storage,{...env,...change},{action:'status',sourceId:env.SOFTWARE_RECOVERY_SOURCE_ID})).rejects.toThrow();
  });
  it('blocks webhook and scheduled entrypoints while keeping the existing non-source path', async () => {
    const {env,control}=fixture();let requests=0,jobs=0;
    const worker=withStoreSource({fetch:async()=>{requests++;return new Response('ok');},scheduled:async()=>{jobs++;}});
    await control('pause',{checkpoint});
    expect((await worker.fetch(new Request('https://test/webhooks/stripe',{method:'POST'}),env,{})).status).toBe(503);
    await worker.scheduled({},env,{});expect(jobs).toBe(0);expect(requests).toBe(0);
    await worker.scheduled({}, {}, {});expect(jobs).toBe(1);
  });
});

import { pauseSoftwareSource, resumeSoftwareSource, awaitSource } from '../../scripts/lib/software-source.mjs';
it('drains Store handoffs before licensing and resumes in the opposite order', async () => {
  const actions:string[]=[];
  const control=async(service:string,action:string,cp:string)=>{
    actions.push(`${service}:${action}`);
    return {phase:action==='resume'?'open':'frozen',active:0,checkpoint:cp || checkpoint};
  };
  await pauseSoftwareSource(control,checkpoint);await resumeSoftwareSource(control,checkpoint);
  expect(actions).toEqual(['store:pause','store:status','licensing:pause','licensing:status','licensing:resume','store:resume']);
});
it('times out closed rather than treating an unfinished admission as drained', async()=>{
  await expect(awaitSource(async()=>({phase:'draining',active:1}),s=>s.phase==='frozen',{timeoutMs:0})).rejects.toThrow('keep maintenance closed');
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureSoftwareBackup } from '../../scripts/lib/software-backup.mjs';
it('rejects mismatched source identities and a resumed source generation during capture',async()=>{
  const sourceId='0123456789abcdef';
  for(const mismatch of [true,false]) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'source-capture-test-'));let storeReads=0;
    const request=async(service:string,route:string,p:any)=>{
      if(p.action==='info') {
        if(service==='store')storeReads++;
        return Response.json({version:1,checkpoint,schema:3,paidCheckoutEnabled:false,
          counts:{grants:0,installs:0,coverage:0,releases:0},
          source:{sourceId:mismatch && service==='licensing'?'fedcba9876543210':sourceId,phase:'frozen',active:0,checkpoint,generation:service==='store'?storeReads:1}});
      }
      return Response.json({version:1,checkpoint,records:[],objects:[],cursor:null});
    };
    try {
      await expect(captureSoftwareBackup(dir,{checkpoint,request,sourceId})).rejects.toThrow(mismatch?'matching checkpoint':'Store changed');
      expect(fs.existsSync(path.join(dir,'software/manifest.json'))).toBe(false);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});

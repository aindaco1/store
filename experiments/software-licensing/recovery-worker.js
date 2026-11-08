// Synthetic rehearsal entry only; never a production Worker.
import worker, { storeWorker } from '../../worker/src/index.js';
import { withStoreSource, sourceCheckpointEnv } from '../../worker/src/software-source.js';
    import { StoreInventoryCoordinator as Base } from '../../worker/src/tier-inventory-do.js';
    import { callSoftwareBilling } from '../../worker/src/software-billing.js';
    import { callComplimentaryLicenses } from '../../worker/src/software-licenses.js';
    import { fixtureStripe, order, orderToken } from './recovery-fixture.mjs';
    export class StoreInventoryCoordinator extends Base {
      constructor(ctx,env) {
        super(ctx,env,{billingStripe:fixtureStripe()});
        const alarm=this.checkout.alarm;
        this.checkout.alarm=async()=>{
          if(await ctx.storage.get('fixture:alarm')) {
            await env.STORE_STATE.put('fixture:alarm-started','true');
            await new Promise(resolve=>setTimeout(resolve,1500));
            await env.STORE_STATE.put('fixture:alarm-finished','true');
            await ctx.storage.delete('fixture:alarm');
          }
          return alarm();
        };
      }
      async fetch(request) {
        if(new URL(request.url).pathname==='/fixture-schedule' && this.env.APP_MODE==='test' && this.env.SOFTWARE_RECOVERY_SOURCE_ID) {
          await this.ctx.storage.put('fixture:alarm',true);await this.ctx.storage.setAlarm(Date.now()+1);return reply({scheduled:true});
        }
        return super.fetch(request);
      }
    }
    const reply = value => Response.json(value,{headers:{'Cache-Control':'private, no-store'}});
const fixtureWorker = {async fetch(request,env,ctx) {
      if(env.APP_MODE!=='test' || env.SOFTWARE_CHECKOUT_ENABLED!=='false' || env.STORE_EMAIL_DRY_RUN!=='true') return new Response('disabled',{status:503});
      const path=new URL(request.url).pathname;
      const admin=request.headers.get('Authorization')==='Bearer '+env.ADMIN_SECRET;
      if(path==='/admin/store/recovery/software' && env.SOFTWARE_RECOVERY_SOURCE_ID) {
        const p=await request.clone().json();
        if(['fixture-storage','fixture-scheduled'].includes(p.action)) {
          const readOnly=request.headers.get('Authorization')==='Bearer '+env.SOFTWARE_BACKUP_READ_SECRET;
          if(!admin && (!readOnly || p.action!=='fixture-storage')) return new Response('forbidden',{status:403});
          let frozen;try {frozen=await sourceCheckpointEnv(env);}catch{return new Response('not drained',{status:503});}
          if(p.checkpoint!==frozen.SOFTWARE_RECOVERY_CHECKPOINT)return new Response('mismatch',{status:409});
          if(p.action==='fixture-scheduled') {await worker.scheduled({},env,ctx);return reply({blocked:true});}
          const kv={};let cursor;
          do {const page=await env.STORE_STATE.list({limit:1000,...(cursor?{cursor}:{})});for(const {name} of page.keys)kv[name]={value:await env.STORE_STATE.get(name)};cursor=page.list_complete?null:page.cursor;}while(cursor);
          const download=await env.STORE_DOWNLOADS.get('downloads/restore-drill.txt');
          return reply({kv,download:await download.text(),source:frozen.SOFTWARE_RECOVERY_SOURCE_STATE});
        }
      }
      if(path==='/fixture/storage' && admin) {
        const p=await request.json();for(const [key,entry] of Object.entries(p.kv))await env.STORE_STATE.put(key,entry.value);
        await env.STORE_DOWNLOADS.put('downloads/restore-drill.txt',p.download);return reply({seeded:true});
      }
      if(path==='/fixture/alarm' && admin) {
        const ns=env.STORE_INVENTORY_COORDINATOR;return ns.get(ns.idFromName('source-alarm-probe')).fetch(new Request('https://inventory/fixture-schedule',{method:'POST'}));
      }
      if(path==='/fixture/alarm-state' && admin)return reply({started:await env.STORE_STATE.get('fixture:alarm-started')==='true'});
      if(path==='/fixture/hold' && admin) {
        ctx.waitUntil(new Promise(resolve=>setTimeout(resolve,3000)).then(()=>env.STORE_STATE.put('fixture:deferred','done')));
        await new Promise(resolve=>setTimeout(resolve,1000));await env.STORE_STATE.put('fixture:inflight','done');return reply({finished:true});
      }
      if(new URL(request.url).pathname==='/fixture/replay' && !env.SOFTWARE_RECOVERY_CHECKPOINT && request.headers.get('Authorization')==='Bearer '+env.ADMIN_SECRET) {
        const expected=await request.json();
        const call=async(action,p={})=>callSoftwareBilling(env,orderToken,action,p);
        const recovered=await call('recover',{lineId:'software'});
        await call('invoice',{invoiceId:'in_first',eventId:'evt_replayed'});await call('drain');
        return reply({sameKey:recovered.key===expected.key,queuedMail:(await env.STORE_STATE.list({prefix:'email-outbox:v1:'})).keys.length});
      }

      if(new URL(request.url).pathname==='/fixture/seed' && !env.SOFTWARE_RECOVERY_CHECKPOINT && request.headers.get('Authorization')==='Bearer '+env.ADMIN_SECRET) {
        await env.STORE_STATE.put('orders:'+orderToken,JSON.stringify(order));
        const call=async(action,p={})=>callSoftwareBilling(env,orderToken,action,p);
        await call('register',{order}); await call('invoice',{invoiceId:'in_first',eventId:'evt_first'});
        await call('invoice',{invoiceId:'in_next',eventId:'evt_prepare'}); await call('invoice',{invoiceId:'in_next',eventId:'evt_next'});
        for(let i=0;i<4;i++)await call('drain');
        await call('refund',{id:'refund',paymentId:'in_next',allocations:[{lineId:'software',amountCents:1000}],actor:'operator@example.invalid'});
        for(let i=0;i<4;i++)await call('drain');
        for(let i=0;i<27;i++) await callComplimentaryLicenses(env,'issue',{id:'comp-'+i,email:'restore@example.invalid',product:'ascii-vj-remix',seats:1,policy:{kind:'lifetime'}});
        for(let i=0;i<2;i++)await callComplimentaryLicenses(env,'drain');
        return reply(await call('recover',{lineId:'software'}));
      }
      return storeWorker.fetch(request,env,ctx);
    }, scheduled:(event,env,ctx)=>storeWorker.scheduled(event,env,ctx)};

export default withStoreSource(fixtureWorker);

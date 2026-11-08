// Synthetic rehearsal entry only; never a production Worker.
import worker from '../../worker/src/index.js';
    import { StoreInventoryCoordinator as Base } from '../../worker/src/tier-inventory-do.js';
    import { callSoftwareBilling } from '../../worker/src/software-billing.js';
    import { callComplimentaryLicenses } from '../../worker/src/software-licenses.js';
    import { fixtureStripe, order, orderToken } from './recovery-fixture.mjs';
    export class StoreInventoryCoordinator extends Base { constructor(ctx,env) {super(ctx,env,{billingStripe:fixtureStripe()});} }
    export default {async fetch(request,env,ctx) {
      if(env.APP_MODE!=='test' || env.SOFTWARE_CHECKOUT_ENABLED!=='false' || env.STORE_EMAIL_DRY_RUN!=='true') return new Response('disabled',{status:503});
      if(new URL(request.url).pathname==='/fixture/replay' && !env.SOFTWARE_RECOVERY_CHECKPOINT && request.headers.get('Authorization')==='Bearer '+env.ADMIN_SECRET) {
        const expected=await request.json();
        const call=async(action,p={})=>callSoftwareBilling(env,orderToken,action,p);
        const recovered=await call('recover',{lineId:'software'});
        await call('invoice',{invoiceId:'in_first',eventId:'evt_replayed'});await call('drain');
        return Response.json({sameKey:recovered.key===expected.key,queuedMail:(await env.STORE_STATE.list({prefix:'email-outbox:v1:'})).keys.length});
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
        return Response.json(await call('recover',{lineId:'software'}));
      }
      return worker.fetch(request,env,ctx);
    }};

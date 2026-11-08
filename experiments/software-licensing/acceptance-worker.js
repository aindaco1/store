// Nonshipping entry: real Store handlers/providers, fixed synthetic ownership.
import worker from '../../worker/src/index.js';
import { StoreInventoryCoordinator as Base } from '../../worker/src/tier-inventory-do.js';
import { softwarePayments } from '../../worker/src/software-checkout.js';
import { softwareStripe } from '../../worker/src/software-stripe.js';
import { callSoftwareBilling } from '../../worker/src/software-billing.js';
import { processEmailOutbox, EMAIL_OUTBOX_PREFIX, EMAIL_DELIVERY_PREFIX } from '../../worker/src/email-outbox.js';
import { verifyStripeSignature } from '../../worker/src/stripe.js';
import { acceptanceEnv, acceptanceAuthorized, acceptanceOwnsEvent, acceptanceMailAllowed } from './acceptance-policy.mjs';

export class StoreInventoryCoordinator extends Base {
  constructor(ctx,raw) {
    const env=acceptanceEnv(raw), stripe=softwareStripe(env);
    const customers={...stripe.customers,create:(p,o)=>stripe.customers.create({...p,test_clock:env.ACCEPTANCE_CLOCK},o)};
    super(ctx,env,{payments:softwarePayments(env,{...stripe,customers})});
  }
}
const reply=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});
async function records(env,prefix) {
  const page=await env.STORE_STATE.list({prefix,limit:100});
  if(!page.list_complete)throw new Error('Acceptance record bound exceeded');
  return Promise.all(page.keys.map(async ({name})=>({key:name,...await env.STORE_STATE.get(name,{type:'json'})})));
}
export default {async fetch(request,raw,ctx) {
  let env;try{env=acceptanceEnv(raw);}catch{return reply({error:'disabled'},503);}
  const url=new URL(request.url),path=url.pathname;
  if(path==='/acceptance/login') {
    if(request.method==='GET')return new Response('<!doctype html><html lang="en"><meta name="robots" content="noindex,nofollow"><title>Private licensing acceptance</title><h1>Private licensing acceptance</h1><form method="post"><label>Acceptance access code <input name="code" type="password" autocomplete="off" required></label><button type="submit">Open test environment</button></form></html>',{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'private, no-store'}});
    if(request.method!=='POST'||request.headers.get('Origin')!==url.origin)return reply({error:'origin'},403);
    const body=await request.text();
    if(body.length>256||new URLSearchParams(body).get('code')!==env.ACCEPTANCE_SECRET)return reply({error:'access code'},403);
    return new Response(null,{status:303,headers:{Location:'/acceptance/','Set-Cookie':`acceptance=${env.ACCEPTANCE_SECRET}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600`,'Cache-Control':'private, no-store'}});
  }
  if(path==='/webhooks/stripe') {
    const body=await request.clone().text();
    if(body.length>1024*1024)return reply({error:'oversized'},413);
    const verified=await verifyStripeSignature(body,request.headers.get('stripe-signature'),env.STRIPE_WEBHOOK_SECRET_TEST);
    if(!verified.valid)return reply({error:'signature'},401);
    let event;try{event=JSON.parse(body);}catch{return reply({error:'invalid'},400);}
    if(!acceptanceOwnsEvent(event,env.ACCEPTANCE_ORDER))return reply({ignored:true});
    const response=await worker.fetch(request,env,ctx);
    const result=response.ok ? null : await response.clone().json().catch(()=>null);
    const error=typeof result?.error==='string' && /^[A-Za-z0-9 _:-]{1,160}$/.test(result.error) ? result.error : undefined;
    await env.STORE_STATE.put(`acceptance:event:${event.id}`,JSON.stringify({id:event.id,type:event.type,status:response.status,objectId:event.data.object.id,receivedAt:Date.now(),...(error?{error}:{})}),{expirationTtl:86400});
    return response;
  }
  if(!acceptanceAuthorized(request,env))return reply({error:'private acceptance'},403);
  if(path==='/acceptance/state') {
    const order=await env.STORE_STATE.get('orders:'+env.ACCEPTANCE_ORDER,{type:'json'});
    const billing=order?.status==='confirmed' ? await callSoftwareBilling(env,env.ACCEPTANCE_ORDER,'status') : null;
    return reply({order,billing,events:await records(env,'acceptance:event:'),mail:await records(env,EMAIL_DELIVERY_PREFIX),queued:(await records(env,EMAIL_OUTBOX_PREFIX)).map(({kind,jobId,status,payload,orderToken})=>({kind,jobId,status,event:payload?.event,orderToken}))});
  }
  if(path==='/acceptance/config')return reply({orderToken:env.ACCEPTANCE_ORDER,publishableKey:env.STRIPE_PUBLISHABLE_KEY_TEST,email:env.ACCEPTANCE_EMAIL,clock:env.ACCEPTANCE_CLOCK});
  if(path==='/acceptance/mail' && request.method==='POST') {
    const jobs=await records(env,EMAIL_OUTBOX_PREFIX);
    const selected=jobs.filter(job=>acceptanceMailAllowed(job,env));
    const delivered=await records(env,EMAIL_DELIVERY_PREFIX);
    const planned=new Set([...delivered.map(job=>job.jobId),...selected.map(job=>job.jobId)]);
    if(planned.size>4)return reply({error:'Mail run limit'},409);
    const allowed=new Set(selected.map(job=>job.key)),kv=env.STORE_STATE;
    const state=new Proxy(kv,{get(target,name){
      if(name==='list')return async options=>options?.prefix===EMAIL_OUTBOX_PREFIX ? {keys:[...allowed].map(name=>({name})),list_complete:false} : kv.list(options);
      if(name==='put')return async(key,value,options)=>{if(key.startsWith(EMAIL_OUTBOX_PREFIX)&&!acceptanceMailAllowed(JSON.parse(value),env))throw Error('Unsafe acceptance recipient');return kv.put(key,value,options);};
      const value=Reflect.get(target,name,target);return typeof value==='function'?value.bind(target):value;
    }});
    return reply(await processEmailOutbox({...env,STORE_STATE:state}));
  }
  if(path==='/acceptance/drain' && request.method==='POST') {await callSoftwareBilling(env,env.ACCEPTANCE_ORDER,'drain');return reply({ok:true});}
  if(path==='/api/checkout/intent' || path==='/api/checkout/hold') {
    const p=await request.clone().json();
    if(`store-order-${p.attemptId}`!==env.ACCEPTANCE_ORDER || (path.endsWith('/intent') && p.email!==env.ACCEPTANCE_EMAIL))return reply({error:'fixture ownership'},403);
  }
  if(path==='/order-success/' || path==='/acceptance/' || path.startsWith('/acceptance-assets/'))return env.ASSETS.fetch(new Request(new URL(path==='/order-success/'?'/acceptance/':path,request.url),request));
  const orderPath=`/api/orders/${env.ACCEPTANCE_ORDER}`;
  if(['/api/checkout/intent','/api/checkout/hold'].includes(path) || path===orderPath || path.startsWith(orderPath+'/'))return worker.fetch(request,env,ctx);
  return reply({error:'not found'},404);
}};

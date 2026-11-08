import {describe,it,expect} from 'vitest';
import {acceptanceEnv,acceptanceAuthorized,acceptanceOwnsEvent,acceptanceMailAllowed} from '../../experiments/software-licensing/acceptance-policy.mjs';
import {validateSoftwarePreviewConfig} from '../../scripts/lib/software-preview-workers.mjs';
const env={APP_MODE:'test',SOFTWARE_CHECKOUT_ENABLED:'false',ACCEPTANCE_ID:'a'.repeat(16),ACCEPTANCE_SECRET:'b'.repeat(64),ACCEPTANCE_ORDER:'store-order-'+'c'.repeat(64),ACCEPTANCE_EMAIL:'approved@example.test',STRIPE_SECRET_KEY_TEST:'sk_test_fixture',PLATFORM_NAME:'[TEST] Store'};
describe('isolated provider acceptance',()=>{
  it('keeps deployed sales disabled and limits checkout override to a valid test fixture',()=>{
    expect(acceptanceEnv(env).SOFTWARE_CHECKOUT_ENABLED).toBe('true');expect(env.SOFTWARE_CHECKOUT_ENABLED).toBe('false');
    for(const bad of [{APP_MODE:'live'},{SOFTWARE_CHECKOUT_ENABLED:'true'},{STRIPE_SECRET_KEY_TEST:'sk_live_fixture'},{STRIPE_SECRET_KEY:'sk_live_fixture'},{ACCEPTANCE_SECRET:''},{ACCEPTANCE_EMAIL:''},{PLATFORM_NAME:'Store'},{SOFTWARE_RECOVERY_TARGET:'empty'}])expect(()=>acceptanceEnv({...env,...bad})).toThrow();
  });
  it('requires the exact private capability',()=>{
    expect(acceptanceAuthorized(new Request('https://example.test'),env)).toBe(false);
    expect(acceptanceAuthorized(new Request('https://example.test',{headers:{Cookie:`other=1; acceptance=${env.ACCEPTANCE_SECRET}`}}),env)).toBe(true);
    expect(acceptanceAuthorized(new Request('https://example.test',{headers:{Cookie:`acceptance=${env.ACCEPTANCE_SECRET}wrong`}}),env)).toBe(false);
  });
  it('accepts only the fixed order and test-mode webhook namespace',()=>{
    const event={livemode:false,data:{object:{metadata:{orderToken:env.ACCEPTANCE_ORDER}}}};
    expect(acceptanceOwnsEvent(event,env.ACCEPTANCE_ORDER)).toBe(true);
    expect(acceptanceOwnsEvent({...event,livemode:true},env.ACCEPTANCE_ORDER)).toBe(false);
    expect(acceptanceOwnsEvent(event,'unrelated')).toBe(false);
    expect(acceptanceOwnsEvent({livemode:false,data:{object:{parent:{subscription_details:{metadata:{orderToken:env.ACCEPTANCE_ORDER}}}}}},env.ACCEPTANCE_ORDER)).toBe(true);
  });
  it('rejects nonlicensing mail, different orders/recipients and hidden recipients',()=>{
    const job={kind:'software_license',orderToken:env.ACCEPTANCE_ORDER,payload:{email:env.ACCEPTANCE_EMAIL}};
    expect(acceptanceMailAllowed(job,env)).toBe(true);
    for(const bad of [{kind:'store_order'},{orderToken:'other'},{payload:{email:'other@example.test'}},{providerPayload:{to:[env.ACCEPTANCE_EMAIL,'other@example.test'],subject:'[TEST]'}},{providerPayload:{to:env.ACCEPTANCE_EMAIL,subject:'[TEST]',bcc:'other@example.test'}},{providerPayload:{to:env.ACCEPTANCE_EMAIL,subject:'unlabeled'}}])expect(acceptanceMailAllowed({...job,...bad},env)).toBe(false);
  });
  it('rejects preview configurations that could attach production or scheduled work',()=>{
    const name='dw-recovery-'+'a'.repeat(16)+'-store',config={name,vars:{APP_MODE:'test',SOFTWARE_CHECKOUT_ENABLED:'false'}};
    expect(()=>validateSoftwarePreviewConfig(config,name)).not.toThrow();
    for(const bad of [{name:'store-worker'},{route:'shop.example.test/*'},{routes:['shop.example.test/*']},{triggers:{crons:['* * * * *']}},{vars:{APP_MODE:'test',SOFTWARE_CHECKOUT_ENABLED:'true'}}])expect(()=>validateSoftwarePreviewConfig({...config,...bad},name)).toThrow();
  });
});

import acceptanceWorker from '../../experiments/software-licensing/acceptance-worker.js';
import storeWorker from '../../worker/src/index.js';
import {vi} from 'vitest';
import {createHmac} from 'node:crypto';
import {MemoryKV} from './helpers/memory-kv';
it('keeps unsigned and unrelated webhooks outside the real Store handler',async()=>{
  const raw={...env,STRIPE_WEBHOOK_SECRET_TEST:'test-signature',STORE_STATE:new MemoryKV()};
  const handler=vi.spyOn(storeWorker,'fetch').mockResolvedValue(Response.json({ok:true}));
  try{
    expect((await acceptanceWorker.fetch(new Request('https://fixture.test/acceptance/state'),raw,{})).status).toBe(403);
    expect((await acceptanceWorker.fetch(new Request('https://fixture.test/webhooks/stripe',{method:'POST',body:'{}'}),raw,{})).status).toBe(401);
    const body=JSON.stringify({id:'evt_other',livemode:false,data:{object:{metadata:{orderToken:'unrelated'}}}}),at=Math.floor(Date.now()/1000);
    const signature=createHmac('sha256','test-signature').update(`${at}.${body}`).digest('hex');
    const response=await acceptanceWorker.fetch(new Request('https://fixture.test/webhooks/stripe',{method:'POST',headers:{'stripe-signature':`t=${at},v1=${signature}`},body}),raw,{});
    expect(await response.json()).toEqual({ignored:true});expect(handler).not.toHaveBeenCalled();
  }finally{handler.mockRestore();}
});

it('requires a same-origin access code and issues a private short-lived cookie',async()=>{
  const send=(body:string,origin='https://fixture.test')=>acceptanceWorker.fetch(new Request('https://fixture.test/acceptance/login',{method:'POST',headers:{Origin:origin},body}),env,{});
  expect((await send('code=wrong')).status).toBe(403);
  expect((await send('code='+env.ACCEPTANCE_SECRET,'https://unrelated.test')).status).toBe(403);
  const response=await send('code='+env.ACCEPTANCE_SECRET);
  expect(response.status).toBe(303);expect(response.headers.get('Location')).toBe('/acceptance/');
  expect(response.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});

it('does not forward a different order sharing the fixture token prefix',async()=>{
  const handler=vi.spyOn(storeWorker,'fetch');
  try{
    const request=new Request(`https://fixture.test/api/orders/${env.ACCEPTANCE_ORDER}extra`,{headers:{Authorization:`Bearer ${env.ACCEPTANCE_SECRET}`}});
    expect((await acceptanceWorker.fetch(request,env,{})).status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  }finally{handler.mockRestore();}
});

it('records a fresh public delivery receipt only after the signed owned event reaches Store',async()=>{
  const raw={...env,STRIPE_WEBHOOK_SECRET_TEST:'test-signature',STORE_STATE:new MemoryKV()};
  const handler=vi.spyOn(storeWorker,'fetch').mockResolvedValue(Response.json({received:true}));
  try{
    const event={id:'evt_owned',type:'invoice.paid',livemode:false,data:{object:{id:'in_owned',metadata:{orderToken:env.ACCEPTANCE_ORDER}}}};
    const body=JSON.stringify(event),at=Math.floor(Date.now()/1000),before=Date.now();
    const signature=createHmac('sha256','test-signature').update(`${at}.${body}`).digest('hex');
    const response=await acceptanceWorker.fetch(new Request('https://fixture.test/webhooks/stripe',{method:'POST',headers:{'stripe-signature':`t=${at},v1=${signature}`},body}),raw,{});
    expect(response.status).toBe(200);expect(handler).toHaveBeenCalledOnce();
    const receipt=await raw.STORE_STATE.get('acceptance:event:evt_owned',{type:'json'});
    expect(receipt.status).toBe(200);expect(receipt.receivedAt).toBeGreaterThanOrEqual(before);
    expect(receipt).not.toHaveProperty('data');
  }finally{handler.mockRestore();}
});

it('bounds the entire fixture mail run before calling the provider',async()=>{
  const kv=new MemoryKV();
  for(let i=0;i<4;i++)await kv.put('email-delivery:v1:'+i,JSON.stringify({jobId:String(i),providerId:'sent-'+i}));
  await kv.put('email-outbox:v1:extra',JSON.stringify({jobId:'extra',kind:'software_license',orderToken:env.ACCEPTANCE_ORDER,payload:{email:env.ACCEPTANCE_EMAIL}}));
  const request=new Request('https://fixture.test/acceptance/mail',{method:'POST',headers:{Authorization:`Bearer ${env.ACCEPTANCE_SECRET}`}});
  const response=await acceptanceWorker.fetch(request,{...env,STORE_STATE:kv},{});
  expect(response.status).toBe(409);expect(await response.json()).toEqual({error:'Mail run limit'});
});

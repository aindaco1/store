#!/usr/bin/env node
// Manual browser acceptance. All credentials/state remain outside the checkout.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {parse as parseToml} from 'smol-toml';
import {withSoftwarePreview} from '../../scripts/lib/software-preview-workers.mjs';
import {DEFAULT_STRIPE_API_VERSION} from '../../worker/src/stripe.js';

const arg=name=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
assert.ok(process.argv.includes('--test-mode'),'Explicit --test-mode required');
const root=fileURLToPath(new URL('../..',import.meta.url));
const licensing=path.resolve(process.env.LICENSING_REPO||path.join(root,'../dust-wave-licensing'));
const stateFile=path.resolve(arg('state')||'');
assert.ok(arg('state')&&!stateFile.startsWith(root+path.sep),'Private --state path must be outside the checkout');
assert.ok(!fs.existsSync(stateFile),'Use a new state path for each run');
const checkoutOnly=process.argv.includes('--checkout-only');
const recipient=arg('recipient');assert.match(recipient||'',/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
assert.match(process.env.CLOUDFLARE_ACCOUNT_ID||'',/^[a-f0-9]{32}$/);
const credentials=parseEnv(fs.readFileSync(arg('credentials'),'utf8'));
const secretKey=credentials.STRIPE_SECRET_KEY_TEST || credentials.STRIPE_SECRET_KEY;
assert.ok(secretKey?.startsWith('sk_test_')&&credentials.STRIPE_PUBLISHABLE_KEY_TEST?.startsWith('pk_test_'),'Stripe test keys required');
assert.ok(credentials.RESEND_API_KEY,'Existing Resend key required');
const require=createRequire(path.join(root,'package.json')),{build}=require('esbuild');
const storeConfig=parseToml(fs.readFileSync(path.join(root,'worker/wrangler.toml'),'utf8')).vars;
const nonce=()=>randomBytes(32).toString('hex');
const secret=nonce(),orderToken='store-order-'+nonce();
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'software-provider-acceptance-'));
const evidenceFile=stateFile+'.evidence.json';
const report={ok:false,testMode:true,productionWrites:false,paidCheckoutEnabled:false,scheduledCaptureEnabled:false,scope:checkoutOnly?'checkout-webhook-followup':'full-provider-acceptance',checks:[],mail:[],cleanup:{},providerCleanup:{ok:false}};
const emit=()=>fs.writeFileSync(evidenceFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
let stopped=false,clock,endpoint,order,base,setupState;
process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
async function api(method,route,fields={}) {
  const response=await fetch('https://api.stripe.com/v1'+route,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+secretKey,'Stripe-Version':DEFAULT_STRIPE_API_VERSION,'Content-Type':'application/x-www-form-urlencoded'},...(method==='GET'?{}:{body:new URLSearchParams(fields)})});
  const data=await response.json();if(!response.ok)throw Error(`Stripe ${method} ${route.split('?')[0].split('/')[1]} ${response.status} ${data.error?.code||''}`);
  assert.notEqual(data.livemode,true,'Live provider object rejected');return data;
}
async function list(route) {
  const items=[];let after='';
  for(;;){const page=await api('GET',route+(route.includes('?')?'&':'?')+'limit=100'+(after?'&starting_after='+after:''));items.push(...page.data);if(!page.has_more)return items;assert.ok(page.data.length,'Invalid pagination');after=page.data.at(-1).id;}
}
async function waitFor(fn,label,seconds=180) {
  const end=Date.now()+seconds*1000;
  while(Date.now()<end){if(stopped||fs.existsSync(stateFile+'.abort'))throw Error('Acceptance interrupted');const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,1000));}
  throw Error('Timed out: '+label);
}
async function call(route,payload) {
  const response=await fetch(base+route,{method:payload===undefined?'GET':'POST',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+secret,Origin:base,'Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
  const data=await response.json();assert.ok(response.ok,`Fixture ${route}: ${response.status} ${data.error||''}`);return data;
}
function phase(name,extra={}) {setupState={...setupState,phase:name,...extra};fs.writeFileSync(stateFile,JSON.stringify(setupState,null,2),{mode:0o600});console.log('Browser acceptance phase:',name);}
async function signal(name) {await waitFor(()=>fs.existsSync(stateFile+'.'+name),'browser '+name,1800);}
async function sendMail() {
  const before=await call('/acceptance/state');assert.ok(before.queued.some(j=>j.kind.startsWith('software_')),'Expected licensing outbox job');
  const first=await call('/acceptance/mail',{});assert.ok(first.sent>0,'Expected provider acceptance');
  const retry=await call('/acceptance/mail',{});assert.equal(retry.sent,0,'Duplicate outbox drain resent email');
  const state=await waitFor(async()=>{const s=await call('/acceptance/state');return s.mail.filter(m=>m.providerId).length>=report.mail.length+first.sent?s:false;},'outbox receipt visibility');
  for(const m of state.mail)if(!report.mail.some(x=>x.id===m.providerId))report.mail.push({id:m.providerId,kind:m.kind});
  assert.ok(report.mail.length<=4,'Bounded test mail count');emit();
}
async function replay(event) {
  execFileSync('stripe',['events','resend',event.id,'--webhook-endpoint',endpoint.id],{env:{...process.env,STRIPE_API_KEY:secretKey},stdio:'pipe',timeout:30000});
  const receipt=await waitFor(async()=>{const s=await call('/acceptance/state');return s.events.find(e=>e.id===event.id&&e.status===200&&e.receivedAt>event.receivedAt);},'redelivered public webhook receipt');
  report.replay={eventId:event.id,before:event.receivedAt,after:receipt.receivedAt,status:receipt.status};emit();
}
const account=await api('GET','/account');assert.equal(account.id,arg('account'),'Unexpected Stripe account');
try {
  clock=await api('POST','/test_helpers/test_clocks',{frozen_time:Math.floor(Date.now()/1000),name:'licensing-browser-'+orderToken.slice(-16)});
  await withSoftwarePreview({secret,readSecret:nonce(),temp},{root,licensing,cli:path.join(licensing,'node_modules/wrangler/bin/wrangler.js'),report,emit,evidenceFile,includeObjects:false,
    configure:async({configs,secrets,directory,previewId})=>{
      const assets=path.join(directory,'assets');fs.mkdirSync(path.join(assets,'acceptance-assets'),{recursive:true});fs.mkdirSync(path.join(assets,'acceptance'));
      fs.copyFileSync(path.join(root,'experiments/software-licensing/acceptance.html'),path.join(assets,'acceptance/index.html'));
      const messages=JSON.parse(execFileSync('ruby',['-ryaml','-rjson','-e','puts JSON.generate(YAML.load_file(ARGV[0]))',path.join(root,'_data/i18n/en.yml')],{encoding:'utf8'}));
      fs.writeFileSync(path.join(assets,'acceptance-assets/messages.js'),'window.STORE_CONFIG='+JSON.stringify({i18n:{messages:{software:messages.software}}})+';');
      await build({entryPoints:[path.join(root,'experiments/software-licensing/acceptance-browser.js')],bundle:true,format:'esm',platform:'browser',outfile:path.join(assets,'acceptance-assets/browser.js')});
      const product=(id,price,type,extra={})=>({id,sku:id,name:'[TEST] '+id,price_cents:price,currency:'USD',fulfillment_type:type,status:'active',...extra});
      const catalog={version:1,source:'private-provider-acceptance',products:[product('shirt',2500,'physical',{inventory_tracking:true,inventory:2}),product('ticket',1500,'ticket',{inventory_tracking:true,inventory:2}),product('monthly',1000,'digital',{software_license:{product:'ascii-vj-remix',seats:1,billing:'month'}})]};
      configs.licensing.vars={APP_MODE:'test',SOFTWARE_CHECKOUT_ENABLED:'false'};
      configs.store.main=path.join(root,'experiments/software-licensing/acceptance-worker.js');
      configs.store.assets={directory:assets,binding:'ASSETS',run_worker_first:true};
      const mailMessages=Object.fromEntries(['software_license','software_billing','footer'].filter(k=>messages.email[k]).map(k=>[k,messages.email[k]]));
      configs.store.vars={APP_MODE:'test',SOFTWARE_CHECKOUT_ENABLED:'false',SOFTWARE_LICENSING_ENABLED:'true',ACCEPTANCE_ID:previewId,ACCEPTANCE_ORDER:orderToken,ACCEPTANCE_CLOCK:clock.id,PLATFORM_NAME:'[TEST] Dust Wave licensing',STORE_CATALOG_JSON:JSON.stringify(catalog),I18N_CATALOG_JSON:JSON.stringify({en:{email:mailMessages}}),EMAIL_OUTBOX_ENABLED:'true',STORE_EMAIL_DRY_RUN:'false',ORDERS_EMAIL_FROM:storeConfig.ORDERS_EMAIL_FROM,SUPPORT_EMAIL:storeConfig.SUPPORT_EMAIL,TAX_PROVIDER:'flat',SALES_TAX_RATE:'0.10',USPS_ENABLED:'false',SHIPPING_FALLBACK_FLAT_RATE:'5',DEFAULT_PLATFORM_TIP_PERCENT:'0',OBSERVABILITY_SAMPLE_RATE:'0'};
      secrets.licensing={ADMIN_SECRET:secret,TOKEN_SECRET:nonce()};
      secrets.store={ACCEPTANCE_SECRET:secret,ACCEPTANCE_EMAIL:recipient,LICENSING_ADMIN_SECRET:secret,LICENSING_KEY_SECRET:nonce(),STORE_FULFILLMENT_SECRET:nonce(),STRIPE_SECRET_KEY_TEST:secretKey,STRIPE_PUBLISHABLE_KEY_TEST:credentials.STRIPE_PUBLISHABLE_KEY_TEST,RESEND_API_KEY:credentials.RESEND_API_KEY};
    }},async resource=>{
      base=resource.bases.storeBase;
      resource.configs.store.vars={...resource.configs.store.vars,SITE_BASE:base,WORKER_BASE:base,CORS_ALLOWED_ORIGIN:base};resource.write('store',resource.configs.store);resource.deploy('store');
      endpoint=await api('POST','/webhook_endpoints',{url:base+'/webhooks/stripe',api_version:DEFAULT_STRIPE_API_VERSION,description:'Disposable licensing acceptance '+orderToken.slice(-16),...Object.fromEntries(['payment_intent.succeeded','payment_intent.payment_failed','invoice.created','invoice.paid','invoice.payment_failed','checkout.session.completed','customer.subscription.updated','customer.subscription.deleted'].map((v,i)=>[`enabled_events[${i}]`,v]))});
      const webhookFile=path.join(resource.directory,'webhook.json');fs.writeFileSync(webhookFile,JSON.stringify({STRIPE_WEBHOOK_SECRET_TEST:endpoint.secret}),{mode:0o600});resource.run(['secret','bulk',webhookFile,'--config',resource.configPaths.store]);fs.rmSync(webhookFile);
      assert.equal((await fetch(base+'/acceptance/state')).status,403);assert.equal((await fetch(base+'/webhooks/stripe',{method:'POST',body:'{}'})).status,401);
      setupState={base,secret,orderToken,recipient};phase('decline-and-sca');await signal('payment');
      const confirmed=await waitFor(async()=>{const s=await call('/acceptance/state');return s.order?.status==='confirmed'&&s.billing?.payments?.length===1?s:false;},'public webhook fulfillment');order=confirmed.order;
      assert.ok(confirmed.events.some(e=>e.type==='payment_intent.succeeded'&&e.status===200));
      const decline=confirmed.events.find(e=>e.type==='payment_intent.payment_failed');
      assert.equal(decline?.status,200,'Initial decline must reach the authority despite KV propagation');
      report.initialDecline={status:decline.status,receivedAt:decline.receivedAt};
      assert.equal(confirmed.billing.payments.length,1);assert.equal(order.totalCents??order.totals?.totalCents??confirmed.billing.payments[0].receipt.amountCents,6000);
      const intent=await api('GET','/payment_intents/'+confirmed.billing.payments[0].receipt.paymentIntentId+'?expand[]=latest_charge');
      const sca=intent.latest_charge.payment_method_details?.card?.three_d_secure;
      assert.equal(sca?.result,'authenticated');assert.equal(sca?.authentication_flow,'challenge');
      report.sca={result:sca.result,flow:sca.authentication_flow,version:sca.version};
      report.checks.push('browser initial payment and signed public webhook','one mixed-cart initial settlement','early declined-payment webhook accepted');emit();
      if(checkoutOnly) {
        await replay(decline);assert.equal((await call('/acceptance/state')).billing.payments.length,1);
        report.checks.push('fresh failed-payment replay receipt; no extra fulfillment');report.ok=true;phase('complete');emit();return;
      }
      await sendMail();
      phase('declining-card-setup');await signal('setup');
      const sub=await api('GET','/subscriptions/'+order.payment.billing.subscriptionId);
      const pm=await api('GET','/payment_methods/'+sub.default_payment_method);assert.equal(pm.card.last4,'0341');
      await waitFor(async()=>{const s=await call('/acceptance/state');return s.events.some(e=>e.type==='checkout.session.completed'&&e.status===200);},'hosted setup webhook receipt');
      assert.equal(sub.pause_collection.behavior,'keep_as_draft');report.checks.push('hosted setup completed and applied to the original subscription');emit();
      const boundary=Math.min(...sub.items.data.map(i=>i.current_period_end));
      await api('POST','/test_helpers/test_clocks/'+clock.id+'/advance',{frozen_time:boundary+60});await waitFor(async()=>((await api('GET','/test_helpers/test_clocks/'+clock.id)).status==='ready'),'clock advance');
      const renewal=await waitFor(async()=>{const p=await api('GET','/invoices?subscription='+sub.id+'&limit=10');return p.data.find(i=>i.id!==order.payment.billing.initialInvoiceId&&i.status==='open'&&i.attempted);},'failed renewal through public invoice webhook');
      assert.equal(renewal.amount_due,1100);assert.equal(renewal.auto_advance,false);
      await waitFor(async()=>{const s=await call('/acceptance/state');return s.events.some(e=>e.type==='invoice.payment_failed'&&e.status===200)&&s.queued.some(j=>j.kind==='software_billing');},'failure email queued');
      report.checks.push('renewal recalculated tax and excluded one-time items','failed renewal arrived through public webhook');emit();await sendMail();
      phase('recover-original-invoice',{invoiceId:renewal.id});await signal('recovered');
      const recoveredSub=await api('GET','/subscriptions/'+sub.id);
      assert.equal((await api('GET','/payment_methods/'+recoveredSub.default_payment_method)).card.last4,'4242');
      const paid=await waitFor(async()=>{const p=await api('GET','/invoices/'+renewal.id);return p.status==='paid'?p:false;},'original invoice paid');assert.equal(paid.id,renewal.id);
      await waitFor(async()=>{const s=await call('/acceptance/state');return s.billing?.payments?.length===2?s:false;},'paid renewal fulfilled');
      assert.equal((await api('GET','/invoices?subscription='+sub.id+'&limit=10')).data.length,2);
      report.checks.push('hosted recovery paid original invoice without a second charge','paid renewal webhook fulfilled once');
      await waitFor(async()=>{const s=await call('/acceptance/state');return s.queued.some(j=>j.kind==='software_billing'&&j.event==='renewed');},'renewal confirmation queued');
      await sendMail();
      assert.equal(report.mail.length,3,'Expected license, failure and renewal messages');
      const event=await waitFor(async()=>{const s=await call('/acceptance/state');return s.events.find(e=>e.type==='invoice.paid'&&e.objectId===renewal.id&&e.status===200);},'paid renewal webhook receipt');
      await replay(event);
      assert.equal((await call('/acceptance/state')).billing.payments.length,2);assert.equal((await call('/acceptance/mail',{})).sent,0);
      report.checks.push('provider redelivery preserved payment and mail deduplication');
      for(const mail of report.mail){
        const delivered=await waitFor(async()=>{const r=await fetch('https://api.resend.com/emails/'+mail.id,{headers:{Authorization:'Bearer '+credentials.RESEND_API_KEY}});assert.ok(r.ok);const m=await r.json();return m.last_event==='delivered'?m:false;},'Resend delivery');
        assert.deepEqual(delivered.to,[recipient]);assert.ok(delivered.subject.includes('[TEST]'));assert.ok(delivered.text&&delivered.html&&delivered.reply_to?.length);assert.ok(delivered.html.includes(base+'/order-success/'));mail.delivered=true;
      }
      report.checks.push('existing Resend templates delivered with text, reply-to and private management links');report.ok=true;phase('complete');emit();
    });
} catch(error) {report.ok=false;report.error=String(error.message).replace(/(?:sk_test_|re_)[A-Za-z0-9_-]+/g,'[redacted]');throw new Error(report.error);}
finally {
  const failures=[];
  if(endpoint)try{assert.equal((await api('DELETE','/webhook_endpoints/'+endpoint.id)).deleted,true);}catch{failures.push('test webhook');}
  try{for(const item of (await list('/products')).filter(p=>p.metadata?.orderToken===orderToken)){for(const price of await list('/prices?product='+item.id))assert.equal((await api('POST','/prices/'+price.id,{active:false})).active,false);assert.equal((await api('POST','/products/'+item.id,{active:false})).active,false);}}catch{failures.push('test catalog');}
  if(clock)try{assert.equal((await api('DELETE','/test_helpers/test_clocks/'+clock.id)).deleted,true);}catch{failures.push('test clock/customer');}
  report.providerCleanup={ok:failures.length===0,failures};if(failures.length)report.ok=false;emit();fs.rmSync(temp,{recursive:true,force:true});
  console.log('Acceptance finished:',report.ok?'passed':'incomplete','; provider cleanup:',report.providerCleanup.ok);
}

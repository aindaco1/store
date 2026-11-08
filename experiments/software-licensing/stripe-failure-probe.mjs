import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createStripeClient, DEFAULT_STRIPE_API_VERSION } from '../../shared/dust-wave-platform/packages/worker-core/src/stripe.js';
import { planCombinedInvoice } from './checkout-plan.mjs';
if (!process.argv.includes('--test-mode') || !process.argv[2]) throw new Error('Explicit --test-mode and local env path required');
const key = parseEnv(await readFile(process.argv[2],'utf8')).STRIPE_SECRET_KEY;
if (!/^(sk|rk)_test_/.test(key||'')) throw new Error('Only Stripe test keys are accepted');
const stripe=createStripeClient(key), run=`failure_${randomUUID().replaceAll('-','')}`;
const options=step=>({idempotencyKey:`${run}:${step}`});
const report={run,testMode:true,apiVersion:DEFAULT_STRIPE_API_VERSION,startedAt:new Date().toISOString(),cases:[],cleanupErrors:[]};
const customers=[],subscriptions=[],prices=new Set();let product;
async function raw(method,path,data,step) {
 const response=await fetch(`https://api.stripe.com/v1/${path}`,{method,headers:{Authorization:`Bearer ${key}`,'Stripe-Version':DEFAULT_STRIPE_API_VERSION,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`${run}:${step}`},body:method==='GET'?undefined:new URLSearchParams(data),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Object.assign(new Error(`Probe operation failed: ${step} HTTP ${response.status}`),{statusCode:response.status});return response.json();
}
try {
 product=await stripe.products.create({name:'Synthetic combined-checkout failure probe',metadata:{feasibility_run:run}},options('product'));
 for(const [name,method,expected] of [['decline','pm_card_chargeDeclined','requires_payment_method'],['sca','pm_card_authenticationRequired','requires_action']]) {
  const customer=await stripe.customers.create({name:'Synthetic failure fixture',metadata:{feasibility_run:run}},options(`customer-${name}`));customers.push(customer.id);
  const plan=planCombinedInvoice({id:`${run}_${name}`,currency:'usd',lines:[{id:'ticket',kind:'ticket',unitAmount:1500,quantity:1,product:product.id},{id:'merch',kind:'merch',unitAmount:2500,quantity:1,product:product.id},{id:'license',kind:'license',unitAmount:1000,quantity:1,interval:'month',product:product.id}]});
  const subscription=await stripe.subscriptions.create({...plan.subscription,customer:customer.id,expand:['latest_invoice.confirmation_secret']},options(`subscription-${name}`));subscriptions.push(subscription.id);for(const item of subscription.items.data)prices.add(item.price.id);
  assert.equal(subscription.livemode,false);assert.equal(subscription.status,'incomplete');
  const invoice=subscription.latest_invoice;assert.ok(invoice.confirmation_secret?.client_secret,'Elements-compatible confirmation secret');
  const payments=await stripe.invoicePayments.list({invoice:invoice.id,limit:10});assert.equal(payments.data.length,1);
  const piId=payments.data[0].payment.payment_intent;
  try {await raw('POST',`payment_intents/${piId}/confirm`,{payment_method:method,return_url:'https://example.test/return',use_stripe_sdk:'true'},`confirm-${name}`);}catch(e){if(e.status!==402 && e.statusCode!==402)throw e;}
  const intent=await stripe.paymentIntents.retrieve(piId);assert.equal(intent.status,expected);assert.equal(intent.amount,5000);
  const canceled=await stripe.subscriptions.cancel(subscription.id,{invoice_now:false,prorate:false},options(`cancel-${name}`));assert.ok(['canceled','incomplete_expired'].includes(canceled.status));
  let after=await stripe.paymentIntents.retrieve(piId);
  const afterSubscriptionCancel=after.status;
  if(after.status!=='canceled') await raw('POST',`invoices/${invoice.id}/void`,{},`void-${name}`);
  after=await stripe.paymentIntents.retrieve(piId);assert.equal(after.status,'canceled','capacity may release only after payment is nonpayable');
  report.cases.push({name,subscription:subscription.id,invoice:invoice.id,paymentIntent:piId,amount:5000,observedStatus:intent.status,afterSubscriptionCancel,afterVoid:after.status,hasElementsConfirmationSecret:true});
 }
 report.status='passed';
}catch(error){report.status='failed';report.error={name:error.name,message:error.message,code:error.code,status:error.status,statusCode:error.statusCode};process.exitCode=1;}
finally{
 for(const id of subscriptions)try{const s=await stripe.subscriptions.retrieve(id);if(s.status!=='canceled')await stripe.subscriptions.cancel(id,{invoice_now:false,prorate:false},options(`cleanup-${id}`));}catch(e){if(e.statusCode!==404)report.cleanupErrors.push(e.message);}
 for(const id of customers)try{await raw('DELETE',`customers/${id}`,{},`cleanup-${id}`);}catch(e){report.cleanupErrors.push(e.message);}
 for(const id of prices)try{const price=await stripe.prices.retrieve(id);if(price.active)await raw('POST',`prices/${id}`,{active:'false'},`cleanup-${id}`);}catch(e){report.cleanupErrors.push(e.message);}
 if(product)try{await raw('POST',`products/${product.id}`,{active:'false'},'cleanup-product');}catch(e){report.cleanupErrors.push(e.message);}
 report.finishedAt=new Date().toISOString();await writeFile(new URL('./stripe-failure-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.cleanupErrors.length)process.exitCode=1;
}

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {StoreInventoryCoordinator} from '../../worker/src/tier-inventory-do.js';
import {softwarePayments} from '../../worker/src/software-checkout.js';
import {Storage} from './helpers/storage';
import {MemoryKV} from './helpers/memory-kv';
let coordinator:any,storage:Storage,kv:MemoryKV,status:string,created:number,keys:string[],cancelFails:boolean,loseResponse:boolean;
const id='c'.repeat(64),other='d'.repeat(64);
const snapshot={id:'order',currency:'usd',lines:[{id:'ticket',kind:'ticket',unitAmount:1500,quantity:1,product:'prod_test'},{id:'license',kind:'license',unitAmount:1000,quantity:1,interval:'month',product:'prod_test'}]};
const call=async(action:string,body:any={})=>(await coordinator.fetch(new Request(`https://inventory/checkout-${action}`,{method:'POST',body:JSON.stringify({attemptId:id,scope:'store',...body})}))).json();
const hold=(attemptId=id)=>call('hold',{attemptId,inventory:{ticket:{limit:1,claimed:0}},counts:{ticket:1},selection:'frozen-cart'});
const pay=()=>call('pay',{counts:{ticket:1},selection:'frozen-cart',params:{metadata:{orderToken:`store-order-${id}`,orderHash:'frozen'}},publishableKey:'pk_test_fixture',order:{orderToken:`store-order-${id}`,orderHash:'frozen',status:'draft',orderDraft:{orderToken:`store-order-${id}`,currency:'USD',customer:{email:'buyer@example.test'},items:[{name:'Ticket',fulfillmentType:'ticket',quantity:1,discountedSubtotalCents:1500,subtotalCents:1500},{name:'ASCII',quantity:1,discountedSubtotalCents:1000,subtotalCents:1000,softwareLicense:{product:'ascii-vj-remix',billing:'month',seats:1}}],totals:{totalCents:2500}},payment:{required:true}}});
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));storage=new Storage();kv=new MemoryKV();status='requires_action';created=0;keys=[];cancelFails=false;loseResponse=false;
 const stripe:any={customers:{create:async()=>({id:'cus_test'})},products:{create:async()=>({id:'prod_test'})},extra:async(path:string)=>{if(path.endsWith('/void'))status='canceled';return {};},subscriptions:{create:async(_p:any,o:any)=>{created++;keys.push(o.idempotencyKey);if(loseResponse){loseResponse=false;throw new Error('Lost response after subscription commit');}return {id:'sub_test',latest_invoice:'in_test',items:{data:[{id:'si_test',metadata:{order_line_id:'line-1'}}]}};},cancel:async()=>{if(cancelFails)throw new Error('timeout');return {status:'canceled'};}},invoices:{retrieve:async()=>({id:'in_test',amount_due:2500,currency:'usd',livemode:false})},invoicePayments:{list:async()=>({has_more:false,data:[{payment:{type:'payment_intent',payment_intent:'pi_test'}}]})},paymentIntents:{retrieve:async()=>({id:'pi_test',status,livemode:false,amount:2500,currency:'usd',client_secret:'pi_test_secret_test'})}};
 stripe.subscriptions.update=async()=>({pause_collection:{behavior:'keep_as_draft'}});
 const payments=softwarePayments({},stripe);
 coordinator=new StoreInventoryCoordinator({storage} as never,{APP_MODE:'test',SOFTWARE_LICENSING_ENABLED:'true',STORE_STATE:kv,STORE_INVENTORY_COORDINATOR:{idFromName:(name:string)=>name,get:()=>({fetch:async()=>Response.json({registered:true})})}} as never,{payments});
});
afterEach(()=>vi.useRealTimers());
describe('subscription provider in Store inventory coordinator',()=>{
 it('persists invoice/item correlation before exposing Elements secret and cancels the invoice before freeing stock',async()=>{
  await hold();expect(await pay()).toMatchObject({success:true,clientSecret:'pi_test_secret_test'});
  const order=await kv.get(`orders:store-order-${id}`,{type:'json'});expect(order.payment.billing).toMatchObject({subscriptionId:'sub_test',initialInvoiceId:'in_test',items:[{id:'si_test'}]});
  expect(await hold(other)).toMatchObject({success:false});
  expect(await call('release')).toMatchObject({success:true,phase:'released'});expect(status).toBe('canceled');expect(await hold(other)).toMatchObject({success:true});
 });
 it('retains scarce stock after ambiguous cancellation or a late successful payment',async()=>{
  await hold();await pay();cancelFails=true;expect(await call('release')).toMatchObject({code:'payment_resolving'});expect(await hold(other)).toMatchObject({success:false});
  cancelFails=false;status='succeeded';expect(await call('release')).toMatchObject({code:'payment_resolving'});expect(await hold(other)).toMatchObject({success:false});
  expect(await call('confirm')).toMatchObject({confirmed:true});expect(await call('confirm')).toMatchObject({confirmed:true});
 });
 it('retries lost creation with one provider key and never creates a second initial payment',async()=>{
  await hold();loseResponse=true;expect(await pay()).toMatchObject({code:'payment_resolving'});expect(await hold(other)).toMatchObject({success:false});
  vi.setSystemTime(Date.now()+31000);expect(await pay()).toMatchObject({success:true});expect(created).toBe(2);expect(new Set(keys).size).toBe(1);
 });
});

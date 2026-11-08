// Synthetic provider only. This fixture never contacts Stripe or Resend.
export const orderToken = `store-order-${'a'.repeat(64)}`;
const lines = [
  {id:'shirt',kind:'merch',name:'Shirt',unitAmount:2500,quantity:1,purchasedQuantity:1},
  {id:'ticket',kind:'ticket',name:'Ticket',unitAmount:1500,quantity:1,purchasedQuantity:1},
  {id:'software',kind:'license',name:'ASCII',unitAmount:800,renewalAmount:1000,quantity:1,purchasedQuantity:1,interval:'month',taxable:true,offer:{product:'ascii-vj-remix',seats:1,billing:'month'}}
];
export const order = {orderToken,orderHash:'synthetic-frozen-order',status:'confirmed',orderDraft:{customer:{email:'restore@example.invalid'},preferredLang:'en',billingAddress:null},
  payment:{paymentIntentId:'pi_first',billing:{snapshot:{id:orderToken,currency:'usd',total:4800,lines},customerId:'cus_restore',subscriptionId:'sub_restore',initialInvoiceId:'in_first',items:[{id:'si_software',metadata:{order_line_id:'software'}}]}}};
export const invoice = (id,initial=false,draft=false) => ({id,status:draft?'draft':'paid',livemode:false,customer:'cus_restore',currency:'usd',parent:{subscription_details:{subscription:'sub_restore'}},amount_due:initial?4800:1100,amount_paid:initial?4800:1100,status_transitions:{paid_at:1793793600},lines:{has_more:false,data:initial ? lines.map(line=>({id:`il_${line.id}`,currency:'usd',quantity:1,amount:line.interval?1000:line.unitAmount,discount_amounts:line.interval?[{amount:200}]:[],metadata:{order_line_id:line.id},...(line.interval?{parent:{subscription_item_details:{subscription_item:'si_software'}},period:{start:100,end:200}}:{})})) : [{id:'il_renewal',currency:'usd',quantity:1,amount:1000,parent:{subscription_item_details:{subscription_item:'si_software'}},period:{start:300,end:400}},...(draft?[]:[{currency:'usd',quantity:1,amount:100,metadata:{order_line_id:'tax'}}])]}});
export const intent = id => ({id,customer:'cus_restore',livemode:false,status:'succeeded',currency:'usd',amount:id==='pi_first'?4800:1100,amount_received:id==='pi_first'?4800:1100,metadata:{orderToken,orderHash:order.orderHash}});
export const refund = {id:'re_restore',payment_intent:'pi_next',amount:1000,currency:'usd',status:'succeeded',created:1793793600};
export function fixtureStripe() {
  let draft=true;
  return {invoices:{retrieve:async id=>invoice(id,id==='in_first',id==='in_next'&&draft),list:async()=>({has_more:false,data:[invoice('in_first',true),invoice('in_next')]}),pay:async()=>{draft=false;return invoice('in_next');}},
    invoicePayments:{list:async ({invoice:id})=>({has_more:false,data:[{payment:{type:'payment_intent',payment_intent:id==='in_first'?'pi_first':'pi_next'}}]})},
    paymentIntents:{retrieve:async id=>intent(id)},extra:async()=>({id:'ii_fixture'}),
    refunds:{create:async()=>refund,retrieve:async()=>refund}};
}
export async function stripeRead(route) {
  const url=new URL(route,'https://fixture.invalid');
  if (url.pathname.startsWith('/payment_intents/')) return intent(url.pathname.split('/').at(-1));
  if (url.pathname==='/refunds') return {has_more:false,data:url.searchParams.get('payment_intent')==='pi_next'?[refund]:[]};
  if (url.pathname==='/invoices') return {has_more:false,data:[invoice('in_first',true),invoice('in_next')]};
  throw new Error('Unexpected read-only provider request');
}

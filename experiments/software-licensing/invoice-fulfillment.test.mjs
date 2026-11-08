import {test} from 'node:test';
import assert from 'node:assert/strict';
import {invoiceFulfillment,itemRefundIntent} from './invoice-fulfillment.mjs';
const snapshot={currency:'usd',lines:[{id:'merch',kind:'merch',unitAmount:2500,quantity:1},{id:'ticket',kind:'ticket',unitAmount:1500,quantity:1},{id:'license',kind:'license',unitAmount:1000,quantity:1,interval:'month'},{id:'annual',kind:'license',unitAmount:10000,quantity:1,interval:'year'}]};
const billing={subscriptionId:'sub_test',initialInvoiceId:'in_first',items:[{id:'si_month',metadata:{order_line_id:'license'}},{id:'si_year',metadata:{order_line_id:'annual'}}]};
const lines=snapshot.lines.map((s,i)=>({amount:s.unitAmount,currency:'usd',quantity:1,metadata:{order_line_id:s.id},...(s.interval?{parent:{subscription_item_details:{subscription_item:i===2?'si_month':'si_year'}},period:{start:100,end:i===2?200:1300}}:{})}));
const invoice=(id='in_first',data=lines)=>({id,status:'paid',currency:'usd',parent:{subscription_details:{subscription:'sub_test'}},amount_paid:data.reduce((s,l)=>s+l.amount,0),lines:{has_more:false,data}});
test('replay and stale-event reconciliation produce stable per-item fulfillment IDs',()=>{
 const first=invoiceFulfillment(invoice(),snapshot,billing),replay=invoiceFulfillment(invoice(),snapshot,billing);
 assert.deepEqual(replay,first);assert.equal(new Set([...first,...replay].map(i=>i.id)).size,4);
 const renewal=invoiceFulfillment(invoice('in_next',[{...lines[2],period:{start:200,end:300}}]),snapshot,billing);
 assert.equal(renewal.length,1);assert.equal(renewal[0].kind,'license');assert.equal(renewal[0].coverage.end,300000);
 // Coverage is keyed by paid invoice. Receiving an older paid invoice cannot
 // overwrite or shorten the newer invoice's interval.
 const ledger=new Map([...renewal,...first,...renewal].map(i=>[i.id,i]));assert.equal(ledger.get('in_next:license').coverage.end,300000);
 assert.throws(()=>invoiceFulfillment({...invoice(),status:'open'},snapshot,billing));
});
test('wrong amounts, identities, missing initial lines and repeated merch on renewal fail closed',()=>{
 for(const altered of [invoice('in_first',lines.slice(1)),invoice('in_next',lines),invoice('in_first',[...lines,{...lines[0]}]),{...invoice(),amount_paid:1}])assert.throws(()=>invoiceFulfillment(altered,snapshot,billing));
});
test('item refunds cannot revoke unrelated software or invent partial-period rules',()=>{
 const issued=invoiceFulfillment(invoice(),snapshot,billing);
 assert.equal(itemRefundIntent({invoiceId:'in_first',orderLineId:'ticket',amountCents:1500,cumulativeRefundCents:1500},issued).entitlementAction,'none');
 assert.equal(itemRefundIntent({invoiceId:'in_first',orderLineId:'license',amountCents:500,cumulativeRefundCents:500},issued).entitlementAction,'review');
 assert.equal(itemRefundIntent({invoiceId:'in_first',orderLineId:'license',amountCents:500,cumulativeRefundCents:1000},issued).entitlementAction,'revoke_invoice_coverage');
 assert.throws(()=>itemRefundIntent({invoiceId:'in_first',orderLineId:'license',amountCents:1001,cumulativeRefundCents:1001},issued));
});

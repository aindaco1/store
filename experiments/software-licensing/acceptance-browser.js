import { mountCustomer } from '../../assets/js/software-management.js';
const status=document.querySelector('[role=status]');
const json=async response=>{const value=await response.json();if(!response.ok)throw Error(value.error||`Request failed (${response.status})`);return value;};
const config=await json(await fetch('/acceptance/config'));
const post=(path,data)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(json);
const stripe=window.Stripe(config.publishableKey),elements=stripe.elements(),card=elements.create('card');card.mount('#card');
async function management(){
  const value=await json(await fetch(`/api/orders/${config.orderToken}`));
  if(!value.software?.token)return false;
  mountCustomer(document.querySelector('#customer'),{orderToken:config.orderToken,token:value.software.token,workerBase:location.origin});
  document.querySelector('#purchase').hidden=true;return true;
}
await management().catch(()=>false);
document.querySelector('#pay').addEventListener('click',async()=>{
  const button=document.querySelector('#pay');button.disabled=true;status.textContent='Preparing test payment…';
  try{
    const attemptId=config.orderToken.slice('store-order-'.length),items=['shirt','ticket','monthly'].map(id=>({id,quantity:1}));
    await post('/api/checkout/hold',{attemptId,items});
    const address={name:'Licensing acceptance test',line1:'1 Test Street',city:'Albuquerque',state:'NM',postalCode:'87102',country:'US'};
    const checkout=await post('/api/checkout/intent',{attemptId,items,email:config.email,tipPercent:0,shippingAddress:address,billingAddress:address});
    const result=await stripe.confirmCardPayment(checkout.clientSecret,{payment_method:{card,billing_details:{name:'Licensing acceptance test',email:config.email}}});
    if(result.error)throw Error(result.error.message);
    status.textContent='Payment accepted; waiting for the signed provider webhook…';
    for(let i=0;i<90;i++){if(await management()){status.textContent='Test order confirmed through the provider webhook.';return;}await new Promise(r=>setTimeout(r,1000));}
    throw Error('Provider confirmation is still pending. Reload to check without paying again.');
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
});

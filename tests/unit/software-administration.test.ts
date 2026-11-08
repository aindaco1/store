import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {manageLicense} from '../../worker/src/software-administration.js';
import {complimentaryKey} from '../../worker/src/software-licenses.js';
import {softwareBilling} from '../../worker/src/software-billing.js';
import {Storage} from './helpers/storage';
const secret='synthetic-key-secret-at-least-32-bytes';
const hash=(key:string)=>createHash('sha256').update(key).digest('hex');
const envFor=(fetch:any)=>({APP_MODE:'test',SOFTWARE_LICENSING_ENABLED:'true',LICENSING_KEY_SECRET:secret,LICENSING_ADMIN_SECRET:secret,LICENSING_SERVICE:{fetch}});
describe('Store license administration',()=>{
  it('derives the current authority key without changing original fulfillment identity or leaking it through status',async()=>{
    let state:any;
    const service=vi.fn(async()=>Response.json(state)),env=envFor(service);
    const grant={id:'gift',product:'ascii-vj-remix',key:await complimentaryKey(env,'gift')};
    state={keyVersion:'',keyHash:hash(grant.key),generation:1,seats:1,installations:[],revoked:false};
    expect((await manageLicense(env,grant,'complimentary','recover')).key).toBe(grant.key);
    const replacement=await complimentaryKey(env,'gift','complimentary:replacement:rotation-one');
    state={...state,keyVersion:'rotation-one',keyHash:hash(replacement),generation:2};
    expect((await manageLicense(env,grant,'complimentary','recover')).key).toBe(replacement);
    expect(grant.key).not.toBe(replacement);
    expect(await manageLicense(env,grant,'complimentary','status')).toEqual({generation:2,seats:1,installations:[],revoked:false});
    await expect(manageLicense({...env,LICENSING_KEY_SECRET:'incorrect-secret-with-at-least-32-bytes'},grant,'complimentary','recover')).rejects.toThrow('Original licensing key');
  });
  it('retries replacement with the exact same command after an ambiguous response',async()=>{
    const commands:any[]=[];
    const env=envFor(async(request:Request)=>{commands.push(await request.json());if(commands.length===1)throw Error('lost response');return Response.json({operation:'one',action:'replace',actor:'admin',at:1,generation:2,target:'gift'});});
    const grant={id:'gift',product:'ascii-vj-remix'},p={id:'one',generation:1,actor:'admin'};
    await expect(manageLicense(env,grant,'complimentary','replace',p)).rejects.toThrow('lost response');
    const result=await manageLicense(env,grant,'complimentary','replace',p);
    expect(commands[0]).toEqual(commands[1]);expect(commands[0].key).toMatch(/^DW-/);
    expect(result).not.toHaveProperty('key');expect(result).not.toHaveProperty('target');
  });
  it('rejects another line before reaching the authority and bounds operator history without duplicates',async()=>{
    const storage=new Storage(),service=vi.fn(),env=envFor(service),billing=softwareBilling({storage},env);
    await storage.put('billing-order',{orderToken:'order',snapshot:{lines:[]}});
    expect(await billing.handle('administration',{lineId:'other',action:'replace'})).toMatchObject({status:404});
    expect(await billing.handle('administration',{lineId:'other',action:'recover'})).toMatchObject({status:400});
    expect(service).not.toHaveBeenCalled();
    for(let i=0;i<130;i++)await storage.put(`billing-payment:${String(i).padStart(3,'0')}`,{receipt:{id:i}});
    const seen:number[]=[];let cursor='';
    do {const page=await billing.handle('history',{kind:'payments',cursor});expect(page.entries.length).toBeLessThanOrEqual(25);seen.push(...page.entries.map((r:any)=>r.receipt.id));cursor=page.cursor;}while(cursor);
    expect(seen).toHaveLength(130);expect(new Set(seen).size).toBe(130);
    expect(await billing.handle('history',{kind:'constructor'})).toMatchObject({status:400});
    expect(await billing.handle('history',{kind:'order'})).toMatchObject({status:400});
    expect(await billing.handle('history',{kind:'payments',cursor:'../billing-license'})).toMatchObject({status:400});
  });
  it('scopes invoice pagination to the original subscription, rejecting a foreign cursor',async()=>{
    const storage=new Storage(),env=envFor(vi.fn());
    await storage.put('billing-order',{billing:{customerId:'cus_one',subscriptionId:'sub_one'}});
    const stripe={invoices:{retrieve:vi.fn(async()=>({livemode:false,customer:'cus_other',parent:{subscription_details:{subscription:'sub_other'}}})),list:vi.fn(async()=>({data:[],has_more:false}))}};
    const billing=softwareBilling({storage},env,stripe);
    expect(await billing.handle('invoices',{cursor:'in_other'})).toMatchObject({status:403});expect(stripe.invoices.list).not.toHaveBeenCalled();
    stripe.invoices.retrieve.mockResolvedValue({livemode:false,customer:'cus_one',parent:{subscription_details:{subscription:'sub_one'}}});
    expect(await billing.handle('invoices',{cursor:'in_owned'})).toMatchObject({invoices:[],invoicesCursor:null});
    expect(stripe.invoices.list).toHaveBeenCalledWith({subscription:'sub_one',limit:25,starting_after:'in_owned'});
  });
});

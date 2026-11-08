import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreInventoryCoordinator } from '../../worker/src/tier-inventory-do.js';
import { complimentaryKey } from '../../worker/src/software-licenses.js';
import { processEmailOutbox, EMAIL_OUTBOX_PREFIX } from '../../worker/src/email-outbox.js';
import { Storage } from './helpers/storage';
import { MemoryKV } from './helpers/memory-kv';

let storage: Storage, kv: MemoryKV, env: any, coordinator: StoreInventoryCoordinator;
let grantCalls: number, loseResponse: boolean, providerGrants: Map<string, string>;
const payload = (id='gift-one') => ({ id, email:'buyer@example.test', product:'ascii-vj-remix', seats:1, policy:{kind:'lifetime'} });
const call = async (action: string, body: any = {}) => (await coordinator.fetch(new Request(`https://inventory/license-${action}`, { method:'POST', body:JSON.stringify(body) }))).json() as Promise<any>;
beforeEach(() => {
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
 storage=new Storage();kv=new MemoryKV();grantCalls=0;loseResponse=false;providerGrants=new Map();
 env={APP_MODE:'test',SOFTWARE_LICENSING_ENABLED:'true',LICENSING_ADMIN_SECRET:'synthetic',LICENSING_KEY_SECRET:'synthetic-key-with-at-least-32-bytes',STORE_STATE:kv,
 RESEND_API_KEY:'re_test',SITE_BASE:'https://shop.test',PLATFORM_NAME:'Dust Wave',SUPPORT_EMAIL:'info@shop.test',ORDERS_EMAIL_FROM:'Dust Wave <orders@shop.test>',I18N_CATALOG_JSON:JSON.stringify({en:{email:{}}}),
 LICENSING_SERVICE:{fetch:async (request:Request)=>{
   grantCalls++;const p=await request.json() as any;const old=providerGrants.get(p.id);if(old && old!==JSON.stringify(p))return Response.json({error:'conflict'},{status:409});
   providerGrants.set(p.id,JSON.stringify(p));if(loseResponse){loseResponse=false;throw new Error('Lost after commit');}return Response.json({id:p.id});
 }}};
 coordinator=new StoreInventoryCoordinator({storage} as never,env);
 env.STORE_INVENTORY_COORDINATOR={idFromName:(s:string)=>s,get:()=>coordinator};
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('complimentary license handoff',()=>{
 it('paginates operator status without exposing keys or internal hashes',async()=>{
  for(let i=0;i<30;i++)await call('issue',payload(`page-${String(i).padStart(2,'0')}`));
  const first=await call('list');expect(first.grants).toHaveLength(25);
  const second=await call('list',{cursor:first.cursor});expect(second.grants).toHaveLength(5);expect(second.cursor).toBeNull();
  expect(new Set([...first.grants,...second.grants].map((g:any)=>g.id)).size).toBe(30);
  expect(JSON.stringify(first)).not.toContain('keyHash');expect(JSON.stringify(first)).not.toContain('DW-');
 });
 it('commits one grant, queues one email, and delivers with the existing Resend outbox',async()=>{
  const issues=await Promise.all(Array.from({length:12},()=>call('issue',payload())));
  expect(issues.filter(r=>!r.replayed)).toHaveLength(1);
  expect(await call('issue',{...payload(),seats:2})).toMatchObject({status:409});
  await call('drain');await call('drain');expect(grantCalls).toBe(1);expect(providerGrants.size).toBe(1);
  const recovered=await call('recover',{id:payload().id});expect(recovered.key).toBe(await complimentaryKey(env,payload().id));
  const jobs=[...kv.store].filter(([k])=>k.startsWith(EMAIL_OUTBOX_PREFIX));expect(jobs).toHaveLength(1);expect(jobs[0][1]).not.toContain(recovered.key);
  const fetchMock=vi.fn(async()=>Response.json({id:'synthetic-mail'}));vi.stubGlobal('fetch',fetchMock);
  expect((await processEmailOutbox(env)).sent).toBe(1);
  const mail=JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body));
  expect(mail.html).toContain(recovered.key);expect(mail.text).toContain(recovered.key);expect(mail.reply_to).toBe('info@shop.test');
  await call('issue',payload());await call('drain');await processEmailOutbox(env);expect(fetchMock).toHaveBeenCalledTimes(1);
 });
 it('replays an ambiguous committed grant without inventing a new key',async()=>{
  await call('issue',payload());loseResponse=true;await call('drain');expect(providerGrants.size).toBe(1);
  vi.setSystemTime(Date.now()+3000);await call('drain');expect(grantCalls).toBe(2);expect(providerGrants.size).toBe(1);expect((await call('recover',{id:'gift-one'})).state).toBe('queued');
 });
 it('retains the issued grant when email persistence fails and retries only the handoff',async()=>{
  await call('issue',payload());const put=kv.put.bind(kv);kv.put=async()=>{throw new Error('KV unavailable');};await call('drain');
  expect((await call('recover',{id:'gift-one'})).state).toBe('granted');expect(grantCalls).toBe(1);
  kv.put=put;vi.setSystemTime(Date.now()+3000);await call('drain');expect(grantCalls).toBe(1);expect((await call('recover',{id:'gift-one'})).state).toBe('queued');
 });
 it('does not starve new work behind more than a hundred completed grants',async()=>{
  for(let i=0;i<105;i++)await call('issue',payload(`gift-${i}`));
  for(let i=0;i<5;i++)await call('drain');expect(providerGrants.size).toBe(105);
  await call('issue',payload('last'));await call('drain');expect((await call('recover',{id:'last'})).state).toBe('queued');
 });
 it('fails closed after an accidental key-secret change without sending a wrong key',async()=>{
  await call('issue',payload());await call('drain');env.LICENSING_KEY_SECRET='different-secret-with-at-least-32-bytes';
  expect(await call('recover',{id:'gift-one'})).toMatchObject({status:503});
  vi.stubGlobal('fetch',vi.fn());await processEmailOutbox(env);expect(fetch).not.toHaveBeenCalled();
 });
 it('validates policy and configuration before creating durable intent',async()=>{
  expect(await call('issue',{...payload(),policy:{kind:'term',start:200,end:100}})).toMatchObject({status:400});
  env.APP_MODE='live';expect(await call('issue',payload())).toMatchObject({status:503});expect(storage.data.size).toBe(0);
 });
});

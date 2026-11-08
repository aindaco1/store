import { describe, it, expect } from 'vitest';
import { Storage } from './helpers/storage';
import { softwareJournalRecovery, recoveryBlocked, RECOVERY_KEY } from '../../worker/src/software-backup.js';
import { StoreInventoryCoordinator } from '../../worker/src/tier-inventory-do.js';
import worker from '../../worker/src/index.js';
import { MemoryKV } from './helpers/memory-kv';
import { parseBackupArgs, validateBackupSafety } from '../../scripts/store-backup.mjs';
const checkpoint='synthetic-checkpoint-123';
const env={APP_MODE:'test',SOFTWARE_RECOVERY_CHECKPOINT:checkpoint,SOFTWARE_RECOVERY_TARGET:'empty'};
const recover=(storage:Storage,p:any)=>softwareJournalRecovery(storage,env,{checkpoint,...p});
describe('software logical recovery',()=>{
  it('requires encryption even without remote KV flags and never permits production recovery',async()=>{
    expect(parseBackupArgs(['--software-licensing','--software-checkpoint='+checkpoint])).toMatchObject({softwareLicensing:true,softwareCheckpoint:checkpoint});
    expect(validateBackupSafety({softwareLicensing:true},'/tmp/recovery')).toMatchObject({ok:false,sensitive:true});
    await expect(softwareJournalRecovery(new Storage(),{...env,APP_MODE:'production'},{checkpoint,action:'export'})).rejects.toThrow('unavailable');
    await expect(recover(new Storage(),{checkpoint:'wrong',action:'export'})).rejects.toThrow('unavailable');
  });
  it('paginates journals past excluded keys and rejects unknown future billing state',async()=>{
    const storage=new Storage();
    for(let i=0;i<30;i++)await storage.put('billing-due:'+String(i).padStart(2,'0'),'job');
    await storage.put('billing-payment:one',{receipt:{id:'one'}});
    const first=await recover(storage,{action:'export'});expect(first.records).toEqual([]);expect(first.cursor).toBeTruthy();
    const second=await recover(storage,{action:'export',cursor:first.cursor});expect(second.records).toHaveLength(1);expect(second.cursor).toBeNull();
    await storage.put('billing-future:new',{version:2});await expect(recover(storage,{action:'export',cursor:first.cursor})).rejects.toThrow('Unknown recovery journal');
  });
  it('imports only into an empty target, rejects partial/unbalanced pages atomically, and is replay safe',async()=>{
    const storage=new Storage();await storage.put('inventory',{stock:1});await expect(recover(storage,{action:'begin',count:2})).rejects.toThrow('not empty');await storage.delete('inventory');
    await recover(storage,{action:'begin',count:2});
    await expect(recover(storage,{action:'import',records:[['billing-order',{orderToken:'synthetic'}],['billing-ledger:bad',{postings:[{cents:12}]}]]})).rejects.toThrow('Unbalanced');
    expect(await storage.get('billing-order')).toBeUndefined();
    await expect(recover(storage,{action:'finish'})).rejects.toThrow('incomplete');
    const records=[['billing-order',{orderToken:'synthetic'}],['billing-refunded:one:line',100]];
    await recover(storage,{action:'import',records});await recover(storage,{action:'import',records});
    await expect(recover(storage,{action:'import',records:[['billing-refunded:one:line',101]]})).rejects.toThrow('conflict');
    expect(await recover(storage,{action:'finish'})).toMatchObject({complete:true,count:2});
    expect(await recoveryBlocked(storage,{APP_MODE:'test'})).toBe(true);
    expect(await recoveryBlocked(storage,{APP_MODE:'test',SOFTWARE_RECOVERY_ACCEPTED:checkpoint})).toBe(false);
    expect(await storage.getAlarm()).toBeNull();expect(await storage.get(RECOVERY_KEY)).toMatchObject({complete:true});
  });
  it('does not restore notification schedules, card sessions or inventory holds',async()=>{
    const storage=new Storage();await recover(storage,{action:'begin',count:1});
    for(const key of ['billing-due:old','billing-card-setup','complimentary-due:v1:old','checkout:old','inventory']) {
      await expect(recover(storage,{action:'import',records:[[key,{old:true}]]})).rejects.toThrow('Invalid');
    }
    await recover(storage,{action:'import',records:[['billing-work:old',{type:'refund',done:false,leaseUntil:1}]]});
    await recover(storage,{action:'finish'});
    const owner=new StoreInventoryCoordinator({storage},env);await owner.alarm();expect(await storage.getAlarm()).toBeNull();
    const response=await owner.fetch(new Request('https://owner/billing-drain',{method:'POST',body:'{}'}));expect(response.status).toBe(503);
  });
  it('uses the existing maintenance bearer and blocks ordinary traffic during a checkpoint',async()=>{
    const config={...env,ADMIN_MAINTENANCE_SECRET:'synthetic-maintenance-secret',RATELIMIT:new MemoryKV()};
    const request=(authorization?:string)=>new Request('https://store/admin/store/recovery/software',{method:'POST',headers:{'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},body:JSON.stringify({checkpoint,action:'info'})});
    expect((await worker.fetch(request(),config,{})).status).toBe(401);
    expect((await worker.fetch(request('Bearer incorrect'),config,{})).status).toBe(401);
    expect((await worker.fetch(request(),{...config,APP_MODE:'production'},{})).status).toBe(503);
    expect((await worker.fetch(new Request('https://store/api/products'),config,{})).status).toBe(503);
    const readConfig={...config,SOFTWARE_BACKUP_READ_SECRET:'synthetic-read-secret',LICENSING_KEY_SECRET:'synthetic-key-at-least-thirty-two-bytes'};
    expect((await worker.fetch(request('Bearer synthetic-read-secret'),readConfig,{})).status).toBe(200);
    const mutation=new Request('https://store/admin/store/recovery/software',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-read-secret'},body:JSON.stringify({checkpoint,action:'begin',owner:'software-licenses',count:0})});
    expect((await worker.fetch(mutation,readConfig,{})).status).toBe(403);
    const rotating={...readConfig,SOFTWARE_BACKUP_READ_SECRET:'new-read-secret',SOFTWARE_BACKUP_READ_SECRET_PREVIOUS:'synthetic-read-secret',SOFTWARE_BACKUP_READ_SECRET_PREVIOUS_UNTIL:String(Math.floor(Date.now()/1000)+3600)};
    expect((await worker.fetch(request('Bearer synthetic-read-secret'),rotating,{})).status).toBe(200);
    const oldWrite=new Request('https://store/admin/store/recovery/software',{method:'POST',headers:{Authorization:'Bearer synthetic-read-secret','Content-Type':'application/json'},body:JSON.stringify({checkpoint,action:'begin',owner:'software-licenses',count:0})});
    expect((await worker.fetch(oldWrite,rotating,{})).status).toBe(403);
    expect((await worker.fetch(request('Bearer synthetic-read-secret'),{...rotating,SOFTWARE_BACKUP_READ_SECRET_PREVIOUS_UNTIL:'1'},{})).status).toBe(401);
    const exportRequest=new Request('https://store/admin/store/recovery/software',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-read-secret'},body:JSON.stringify({checkpoint,action:'export',owner:'software-licenses'})});
    const namespace={idFromName:(name:string)=>name,get:()=>({fetch:async()=>Response.json({version:1,records:[],cursor:null})})};
    const response=await worker.fetch(exportRequest,{...readConfig,STORE_INVENTORY_COORDINATOR:namespace},{});
    expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
  });
});

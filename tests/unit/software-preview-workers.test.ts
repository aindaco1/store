import {afterEach, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {withSoftwarePreview} from '../../scripts/lib/software-preview-workers.mjs';

vi.mock('node:child_process',()=>({execFileSync:vi.fn()}));
afterEach(()=>vi.resetAllMocks());

it('activates rotated secrets in existing objects before returning and cleans up failed updates',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'preview-rotation-test-'));
  const workers=new Map<string,any>();let namespace=false,failUpdate=false;
  // The provider stores secret updates immediately, but active objects retain
  // their old environment until an immediate deployment replaces the instance.
  vi.mocked(execFileSync).mockImplementation((_bin,args:any)=>{
    const command=args.slice(1),option=(key:string)=>command[command.indexOf(key)+1];
    if(command[0]==='kv') {
      if(command[2]==='list')return JSON.stringify(namespace?[{id:'a'.repeat(32)}]:[]);
      namespace=command[2]==='create';return JSON.stringify({id:'a'.repeat(32)});
    }
    const name=option('--name');
    if(command[0]==='deployments') {
      if(workers.has(name))return 'exists';
      throw Object.assign(new Error('absent'),{stderr:'code: 10007'});
    }
    if(command[0]==='delete'){workers.delete(name);return '';}
    const config=JSON.parse(fs.readFileSync(option('--config'),'utf8'));
    const worker=workers.get(config.name)||{stored:{},active:{}};
    if(command[0]==='deploy') {
      expect(option('--durable-objects-code-update-mode')).toBe('immediate');
      worker.active={...worker.stored};workers.set(config.name,worker);
      return `https://${config.name}.test.workers.dev`;
    }
    if(command[0]==='secret') {
      if(failUpdate)throw new Error('provider unavailable');
      worker.stored=JSON.parse(fs.readFileSync(command[2],'utf8'));return '';
    }
    throw new Error('Unexpected provider command');
  });
  const report:any={};
  try {
    await withSoftwarePreview({temp,secret:'original',readSecret:'read',keySecret:'root',tokenSecrets:{TOKEN_SECRET:'signer'},checkpoint:'test',publicKey:'public'},
      {root:temp,licensing:temp,cli:'fixture-cli',report,emit:()=>{},includeObjects:false},async({prefix,secrets,installSecrets,directory}:any)=>{
        for(const role of ['store','licensing']) {
          const worker=workers.get(`${prefix}-${role}`);
          expect(worker.active.ADMIN_SECRET).toBe('original');
          secrets[role].ADMIN_SECRET='replacement';installSecrets(role);
          expect(worker.active.ADMIN_SECRET).toBe('replacement');
          expect(fs.existsSync(path.join(directory,`${role}-secrets.json`))).toBe(false);
        }
        failUpdate=true;
        expect(()=>installSecrets('store')).toThrow('Preview provider command failed');
        expect(fs.existsSync(path.join(directory,'store-secrets.json'))).toBe(false);
      });
    expect(report.cleanup).toEqual({ok:true,failures:[]});
    expect(workers.size).toBe(0);expect(namespace).toBe(false);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

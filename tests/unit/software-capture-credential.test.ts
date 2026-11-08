import {describe,it,expect} from 'vitest';
import {softwareCaptureCredential} from '../../worker/src/software-backup.js';

describe('software capture credential rotation',()=>{
  const env={SOFTWARE_BACKUP_READ_SECRET:'current',SOFTWARE_BACKUP_READ_SECRET_PREVIOUS:'previous',SOFTWARE_BACKUP_READ_SECRET_PREVIOUS_UNTIL:'200'};
  it('accepts the current key and retires the previous key at the exact deadline',()=>{
    expect(softwareCaptureCredential(env,'current',200000)).toBe(true);
    expect(softwareCaptureCredential(env,'previous',199999)).toBe(true);
    expect(softwareCaptureCredential(env,'previous',200000)).toBe(false);
    expect(softwareCaptureCredential(env,'unknown',100000)).toBe(false);
  });
  it('fails closed for partial configuration and absent current credentials',()=>{
    expect(()=>softwareCaptureCredential({...env,SOFTWARE_BACKUP_READ_SECRET_PREVIOUS_UNTIL:''},'current')).toThrow();
    expect(()=>softwareCaptureCredential({...env,SOFTWARE_BACKUP_READ_SECRET_PREVIOUS_UNTIL:'never'},'current')).toThrow();
    expect(softwareCaptureCredential({},'')).toBe(false);
  });
});

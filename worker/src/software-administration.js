import { complimentaryKey } from './software-licenses.js';
import { licensingRequest } from './software-service.js';

const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
export async function authorityAdministration(env,payload) {
  const response=await licensingRequest(env,'administration',payload);
  const result=await response.json();
  if(!response.ok)fail(result.error || 'License administration unavailable',response.status);
  return result;
}
export const isLicenseAdministrationAction=action=>['status','history','replace','deactivate','reset'].includes(action);
const publicReceipt=({operation,action,actor,at,generation,installation})=>({operation,action,actor,at,generation,installation});
// Original keys still authenticate immutable grant/coverage commands. Only the
// authority owns the active key version; Store needs no second rotation journal.
export async function manageLicense(env,grant,purpose,action,p={}) {
  const scope={target:grant.id,product:grant.product};
  if(action==='recover') {
    const state=await authorityAdministration(env,{...scope,action:'status'});
    const key=state.keyVersion ? await complimentaryKey(env,grant.id,`${purpose}:replacement:${state.keyVersion}`) : grant.key;
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))].map(v=>v.toString(16).padStart(2,'0')).join('');
    if(hash!==state.keyHash)fail('Original licensing key secret required',503);
    return {...grant,key};
  }
  if(!isLicenseAdministrationAction(action))fail('Invalid license action',400);
  const result=await authorityAdministration(env,{...scope,action,actor:p.actor,actorRef:p.actorRef,operation:p.id,generation:p.generation,installation:p.installation,revision:p.revision,cursor:p.cursor,
    ...(action==='replace'?{key:await complimentaryKey(env,grant.id,`${purpose}:replacement:${p.id}`)}:{})});
  if(action==='status')return {generation:result.generation,seats:result.seats,revoked:result.revoked,installations:result.installations};
  if(action==='history')return {...result,entries:result.entries.map(publicReceipt)};
  return publicReceipt(result);
}

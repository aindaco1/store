import { isValidEmail } from './validation.js';
import { enqueueEmailOutbox } from './email-outbox.js';
import { manageLicense, isLicenseAdministrationAction } from './software-administration.js';

const RECORD_PREFIX = 'complimentary:v1:';
const DUE_PREFIX = 'complimentary-due:v1:';
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const terminal = state => ['queued', 'failed', 'reconcile'].includes(state);
const hex = buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
const keyHash = async key => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
const dueKey = record => `${DUE_PREFIX}${String(record.nextAt).padStart(13, '0')}:${record.payload.id}`;

export function softwareLicensingEnabled(env) {
  return env.APP_MODE === 'test' && env.SOFTWARE_LICENSING_ENABLED === 'true';
}
export async function complimentaryKey(env, id, purpose = 'complimentary') {
  if (!validId(id) || String(env.LICENSING_KEY_SECRET || '').length < 32) throw new Error('Licensing key configuration unavailable');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.LICENSING_KEY_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'DW-' + hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${purpose}:v1:${id}`)));
}
function normalizePolicy(policy) {
  if (!policy || typeof policy !== 'object') return null;
  const keys = Object.keys(policy).sort().join(',');
  if (policy.kind === 'lifetime' && keys === 'kind') return { kind: 'lifetime' };
  if (policy.kind === 'major' && keys === 'kind,major' && Number.isSafeInteger(policy.major) && policy.major >= 1) return { kind: 'major', major: policy.major };
  if (policy.kind === 'term' && keys === 'end,kind,start' && Number.isSafeInteger(policy.start) && Number.isSafeInteger(policy.end) && policy.start < policy.end) return { kind: 'term', start: policy.start, end: policy.end };
  return null;
}
export async function callComplimentaryLicenses(env, action, payload = {}) {
  if (!softwareLicensingEnabled(env) || !env.STORE_INVENTORY_COORDINATOR) return { status: 503, error: 'Licensing is not configured' };
  const namespace = env.STORE_INVENTORY_COORDINATOR;
  const response = await namespace.get(namespace.idFromName('software-licenses')).fetch(new Request(`https://inventory/license-${action}`, { method: 'POST', body: JSON.stringify(payload) }));
  if (!response.ok) throw new Error('Licensing coordinator unavailable');
  return response.json();
}

// Store owns the grant-to-email handoff. This uses a distinct named instance of
// the existing DO class; it never shares alarms or inventory with checkout.
export function complimentaryLicenses(ctx, env) {
  async function verifiedKey(record) {
    const key = await complimentaryKey(env, record.payload.id);
    if (await keyHash(key) !== record.keyHash) throw new Error('Licensing key changed; restore the original secret');
    return key;
  }
  async function issue(p) {
    if (!softwareLicensingEnabled(env) || !env.LICENSING_SERVICE || !env.LICENSING_ADMIN_SECRET || String(env.LICENSING_KEY_SECRET || '').length < 32) return { status: 503, error: 'Licensing is not configured' };
    const policy = normalizePolicy(p?.policy);
    if (!validId(p?.id) || typeof p.email !== 'string' || p.email.length > 254 || !isValidEmail(p.email) || p.product !== 'ascii-vj-remix' || !Number.isSafeInteger(p.seats) || p.seats < 1 || p.seats > 100 || !policy) return { status: 400, error: 'Invalid complimentary grant' };
    const payload = { id: p.id, email: p.email.trim().toLowerCase(), product: p.product, seats: p.seats, policy, preferredLang: p.preferredLang === 'es' ? 'es' : 'en' };
    const digest = await keyHash(await complimentaryKey(env, p.id));
    return ctx.storage.transaction(async storage => {
      const old = await storage.get(RECORD_PREFIX + p.id);
      if (old) return JSON.stringify(old.payload) === JSON.stringify(payload) && old.keyHash === digest ? { id: p.id, state: old.state, replayed: true } : { status: 409, error: 'Grant conflict' };
      const record = { payload, keyHash: digest, state: 'pending', attempts: 0, nextAt: Date.now(), createdAt: new Date().toISOString() };
      await storage.put(RECORD_PREFIX + p.id, record);
      await storage.put(dueKey(record), p.id);
      await storage.setAlarm(Date.now() + 1000);
      return { id: p.id, state: record.state, replayed: false };
    });
  }
  async function drain() {
    if (!softwareLicensingEnabled(env)) return;
    // Ordered due keys bound each pass without starving work behind completed
    // grants or grants whose next retry lies in the future.
    const rows = await ctx.storage.list({ prefix: DUE_PREFIX, limit: 25 });
    let next = Infinity;
    for (const [index, id] of rows) {
      const key = RECORD_PREFIX + id;
      const lease = await ctx.storage.transaction(async storage => {
        const value = await storage.get(key);
        if (!value || terminal(value.state)) { await storage.delete(index); return null; }
        if (value.nextAt > Date.now() || value.leaseUntil > Date.now()) {
          next = Math.min(next, Math.max(value.nextAt, value.leaseUntil || 0)); return null;
        }
        value.leaseUntil = Date.now() + 30000;
        await storage.put(key, value); return value;
      });
      if (!lease) continue;
      try {
        const p = lease.payload;
        const licenseKey = await verifiedKey(lease);
        if (!lease.grantedAt) {
          const response = await env.LICENSING_SERVICE.fetch(new Request('https://licensing/internal/grant', {
            method: 'POST', headers: { Authorization: `Bearer ${env.LICENSING_ADMIN_SECRET}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: p.id, key: licenseKey, product: p.product, seats: p.seats, policy: p.policy }), signal: AbortSignal.timeout(15000)
          }));
          if (!response.ok) {
            if ([400, 409].includes(response.status)) lease.state = 'failed';
            throw new Error('Grant delivery failed');
          }
          const receipt = await response.json();
          if (receipt.id !== p.id) throw new Error('Grant receipt mismatch');
          lease.state = 'granted'; lease.grantedAt = new Date().toISOString();
          await ctx.storage.put(key, lease);
        }
        const queued = await enqueueEmailOutbox(env, { kind: 'software_license', dedupeKey: `complimentary:${p.id}`, payload: { email: p.email, grantId: p.id, preferredLang: p.preferredLang } });
        if (queued.queued || queued.sent) lease.state = 'queued';
        else if (queued.deduped) lease.state = 'reconcile';
        else throw new Error('Email handoff unavailable');
      } catch {
        lease.attempts += 1;
        lease.nextAt = Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(lease.attempts, 12));
      }
      delete lease.leaseUntil;
      await ctx.storage.transaction(async storage => {
        await storage.put(key, lease); await storage.delete(index);
        if (!terminal(lease.state)) await storage.put(dueKey(lease), id);
      });
      if (!terminal(lease.state)) next = Math.min(next, lease.nextAt);
    }
    if (rows.size === 25) next = Math.min(next, Date.now() + 1000);
    if (Number.isFinite(next)) await ctx.storage.setAlarm(next);
  }
  async function recover(id) {
    if (!softwareLicensingEnabled(env)) return { status: 503, error: 'Licensing is not configured' };
    if (!validId(id)) return { status: 400, error: 'Invalid grant' };
    const record = await ctx.storage.get(RECORD_PREFIX + id);
    if (!record?.grantedAt) return { status: 404, error: 'Issued license not found' };
    try { return { ...await manageLicense(env,{id,key:await verifiedKey(record),product:record.payload.product},'complimentary','recover'), email: record.payload.email, state: record.state }; }
    catch { return { status: 503, error: 'Original licensing key secret required' }; }
  }
  async function list({ cursor = '' } = {}) {
    if (!softwareLicensingEnabled(env) || (cursor && !validId(cursor))) return { status: 400, error: 'Invalid license list' };
    const rows = [...(await ctx.storage.list({ prefix: RECORD_PREFIX, ...(cursor ? { startAfter: RECORD_PREFIX + cursor } : {}), limit: 26 })).values()];
    return { grants: rows.slice(0,25).map(record => ({ ...record.payload, state: record.state, grantedAt: record.grantedAt || null })),
      cursor: rows.length > 25 ? rows[24].payload.id : null };
  }
  async function administer(p) {
    if(!softwareLicensingEnabled(env) || !validId(p.grantId) || !isLicenseAdministrationAction(p.action))return {status:400,error:'Invalid license'};
    const record=await ctx.storage.get(RECORD_PREFIX+p.grantId);
    if(!record?.grantedAt)return {status:404,error:'Issued license not found'};
    try {await verifiedKey(record);return await manageLicense(env,{id:p.grantId,product:record.payload.product},'complimentary',p.action,{...p,actor:'admin'});}
    catch(error){return {status:error.status||503,error:error.message};}
  }
  return { issue, drain, recover, list, administer };
}

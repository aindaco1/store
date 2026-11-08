// Test-source maintenance only. Abandoned admissions never expire into a false checkpoint.
import { validCheckpoint } from './software-backup.js';
const key = 'software-source:v1';
export function assertSource(env) {
  if (env.APP_MODE !== 'test' || env.SOFTWARE_CHECKOUT_ENABLED !== 'false' ||
      !/^[a-f0-9]{16}$/.test(env.SOFTWARE_RECOVERY_SOURCE_ID || '') ||
      env.SOFTWARE_RECOVERY_SOURCE_ID !== env.SOFTWARE_RECOVERY_PREVIEW_ID || env.SOFTWARE_RECOVERY_TARGET)
    throw new Error('Source maintenance requires an isolated test source with sales disabled');
}
export async function sourceControl(storage, env, p) {
  assertSource(env);
  return storage.transaction(async tx => {
    const state = await tx.get(key) || { generation: 0, checkpoint: null, lastCheckpoint: null, active: [] };
    if (p.sourceId !== env.SOFTWARE_RECOVERY_SOURCE_ID) throw new Error('Source identity mismatch');
    if (p.action === 'enter') {
      if (!/^[a-f0-9-]{36}$/.test(p.ticket || '')) throw new Error('Invalid admission');
      if (state.checkpoint || state.active.length >= 128) return { admitted: false };
      if (!state.active.includes(p.ticket)) state.active.push(p.ticket);
    } else if (p.action === 'leave') state.active = state.active.filter(ticket => ticket !== p.ticket);
    else if (p.action === 'pause') {
      if (!validCheckpoint(p.checkpoint) || (state.checkpoint && state.checkpoint !== p.checkpoint) ||
          (!state.checkpoint && state.lastCheckpoint === p.checkpoint)) throw new Error('Checkpoint conflict');
      if (!state.checkpoint) { state.checkpoint = p.checkpoint; state.generation++; }
    } else if (p.action === 'resume') {
      if (!state.checkpoint && state.lastCheckpoint === p.checkpoint) return {version:1,sourceId:p.sourceId,phase:'open',checkpoint:null,generation:state.generation,active:state.active.length,paidCheckoutEnabled:false};
      if (state.checkpoint !== p.checkpoint || state.active.length) throw new Error('Source is not drained at this checkpoint');
      state.lastCheckpoint = state.checkpoint; state.checkpoint = null; state.generation++;
    } else if (p.action !== 'status') throw new Error('Unknown source action');
    if (p.action !== 'status') await tx.put(key, state);
    return { version: 1, sourceId: p.sourceId, checkpoint: state.checkpoint, generation: state.generation,
      phase: state.checkpoint ? (state.active.length ? 'draining' : 'frozen') : 'open', active: state.active.length,
      paidCheckoutEnabled: false, ...(p.action === 'enter' ? { admitted: true } : {}) };
  });
}
export async function sourceCommand(env, p) {
  assertSource(env);
  const ns = env.STORE_INVENTORY_COORDINATOR;
  const response = await ns.get(ns.idFromName('software-source-control')).fetch(new Request('https://inventory/software-source', {
    method: 'POST', body: JSON.stringify({ ...p, sourceId: env.SOFTWARE_RECOVERY_SOURCE_ID })
  }));
  if (!response.ok) throw new Error('Source maintenance rejected');
  return response.json();
}
export async function sourceCheckpointEnv(env) {
  if (!env.SOFTWARE_RECOVERY_SOURCE_ID) return env;
  const source = await sourceCommand(env, { action: 'status' });
  if (source.phase !== 'frozen') throw new Error('Source checkpoint is not drained');
  return { ...env, SOFTWARE_RECOVERY_CHECKPOINT: source.checkpoint, SOFTWARE_RECOVERY_SOURCE_STATE: source };
}
export async function sourceWork(env, ctx, work) {
  if (!env.SOFTWARE_RECOVERY_SOURCE_ID) return work(ctx);
  const ticket = crypto.randomUUID();
  if (!(await sourceCommand(env, { action: 'enter', ticket })).admitted) return null;
  const pending = [];
  const tracked = new Proxy(ctx || {}, { get(target, name) {
    if (name === 'waitUntil') return promise => pending.push(Promise.resolve(promise).then(() => null, () => null));
    const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value;
  }});
  try { return await work(tracked); }
  finally {
    while (pending.length) await Promise.all(pending.splice(0));
    await sourceCommand(env, { action: 'leave', ticket });
  }
}
const unavailable = () => Response.json({ error: 'Recovery maintenance' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
export function withStoreSource(worker) {
  return {
    async fetch(request, env, ctx) {
      const path = new URL(request.url).pathname;
      if (!env.SOFTWARE_RECOVERY_SOURCE_ID || ['/admin/store/recovery/source', '/admin/store/recovery/software'].includes(path)) return worker.fetch(request, env, ctx);
      try { return await sourceWork(env, ctx, tracked => worker.fetch(request, env, tracked)) || unavailable(); }
      catch { return unavailable(); }
    },
    async scheduled(event, env, ctx) { await sourceWork(env, ctx, tracked => worker.scheduled(event, env, tracked)); }
  };
}

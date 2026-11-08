// Consumer-owned logical recovery. No inventory holds, alarms or sessions are imported.
import { timingSafeEqual } from '../../shared/dust-wave-platform/packages/worker-core/src/crypto.js';

export function softwareCaptureCredential(env,credential,now=Date.now()) {
  const current=env.SOFTWARE_BACKUP_READ_SECRET;
  if(!current) return false;
  const previous=env.SOFTWARE_BACKUP_READ_SECRET_PREVIOUS,until=env.SOFTWARE_BACKUP_READ_SECRET_PREVIOUS_UNTIL;
  if(!!previous!==!!until || previous && (!/^\d{1,12}$/.test(String(until)) || Number(until)<=0)) throw new Error('Invalid capture credential rotation');
  return timingSafeEqual(credential,current) || !!previous && now<Number(until)*1000 && timingSafeEqual(credential,previous);
}
export const OWNER_PREFIX = 'billing-owner:v1:';
export const RECOVERY_KEY = 'software-recovery:v1';
export const JOURNAL_PREFIXES = ['billing-order', 'billing-payment:', 'billing-ledger:', 'billing-tax:',
  'billing-license:', 'billing-refund:', 'billing-refunded:', 'billing-refund-settled:',
  'billing-refund-provider:', 'billing-work:', 'billing-review:', 'billing-cancellation',
  'complimentary:v1:', OWNER_PREFIX];
const exact = new Set(['billing-order', 'billing-cancellation']);
export const journalKey = key => typeof key === 'string' && key.length <= 512 && JOURNAL_PREFIXES.some(prefix => exact.has(prefix) ? key === prefix : key.startsWith(prefix));
export const validCheckpoint = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(value);
export function recoveryMode(env) { return env.APP_MODE === 'test' && !!env.SOFTWARE_RECOVERY_CHECKPOINT; }
export async function recoveryBlocked(storage, env) {
  if (recoveryMode(env)) return true;
  const state = await storage.get(RECOVERY_KEY);
  return !!state && (!state.complete || env.SOFTWARE_RECOVERY_ACCEPTED !== state.checkpoint);
}
export function validateSoftwareJournalRecord([key, value]) {
  if (!journalKey(key) || value === null || value === undefined || Array.isArray(value)) throw new Error('Invalid recovery record');
  if (key.startsWith('billing-refunded:') || key.startsWith('billing-refund-settled:')) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid refund balance');
  } else if (key.startsWith('billing-refund-provider:')) {
    if (typeof value !== 'string' || value.length > 100) throw new Error('Invalid refund identity');
  } else if (typeof value !== 'object') throw new Error('Invalid recovery record');
  if (key.startsWith('billing-ledger:') && (!Array.isArray(value.postings) || !value.postings.length ||
      !value.postings.every(p => Number.isSafeInteger(p.cents)) || value.postings.reduce((sum, p) => sum + p.cents, 0) !== 0)) throw new Error('Unbalanced recovery ledger');
  if (key.startsWith(OWNER_PREFIX) && key !== OWNER_PREFIX + value.orderToken) throw new Error('Invalid billing owner');
  if (key.startsWith('complimentary:v1:') && key !== 'complimentary:v1:' + value.payload?.id) throw new Error('Invalid grant identity');
}
export async function softwareJournalRecovery(storage, env, p) {
  if (!recoveryMode(env) || !validCheckpoint(p.checkpoint) || p.checkpoint !== env.SOFTWARE_RECOVERY_CHECKPOINT) throw new Error('Recovery checkpoint unavailable');
  if (p.action === 'export') {
    const cursor = p.cursor || '';
    if (typeof cursor !== 'string' || cursor.length > 512) throw new Error('Invalid recovery cursor');
    // Scan every key, including excluded transient data, so pagination cannot hide later journals.
    const page = [...await storage.list({ prefix: '', ...(cursor ? { startAfter: cursor } : {}), limit: 25 })];
    for (const [key] of page) if (/^(billing-|complimentary)/.test(key) && !journalKey(key) &&
      !key.startsWith('billing-due:') && !key.startsWith('complimentary-due:v1:') &&
      !['billing-card-setup','billing-invoice-cursor'].includes(key)) throw new Error('Unknown recovery journal');
    const records = page.filter(([key]) => journalKey(key));
    records.forEach(validateSoftwareJournalRecord);
    return { version: 1, checkpoint: p.checkpoint, records, cursor: page.length === 25 ? page.at(-1)[0] : null };
  }
  if (env.SOFTWARE_RECOVERY_TARGET !== 'empty') throw new Error('Restore requires an isolated empty target');
  return storage.transaction(async tx => {
    let state = await tx.get(RECOVERY_KEY);
    if (p.action === 'begin') {
      if (!Number.isSafeInteger(p.count) || p.count < 0 || p.count > 1000000) throw new Error('Invalid recovery count');
      if (state) {
        if (state.checkpoint !== p.checkpoint || state.expected !== p.count) throw new Error('Recovery conflict');
        return { ready: true };
      }
      if ((await tx.list({ prefix: '', limit: 1 })).size) throw new Error('Recovery destination is not empty');
      state = { checkpoint: p.checkpoint, expected: p.count, count: 0, complete: false };
    } else {
      if (!state || state.checkpoint !== p.checkpoint) throw new Error('Recovery not begun');
      if (p.action === 'import') {
        if (!Array.isArray(p.records) || !p.records.length || p.records.length > 25) throw new Error('Invalid recovery page');
        for (const record of p.records) {
          if (!Array.isArray(record) || record.length !== 2) throw new Error('Invalid recovery record');
          validateSoftwareJournalRecord(record);
          const [key, value] = record, old = await tx.get(key);
          if (old !== undefined) {
            if (JSON.stringify(old) !== JSON.stringify(value)) throw new Error('Recovery record conflict');
          } else {
            if (state.complete) throw new Error('Recovery already complete');
            await tx.put(key, value); state.count++;
          }
        }
        if (state.count > state.expected) throw new Error('Recovery count exceeded');
      } else if (p.action === 'finish') {
        if (state.count !== state.expected) throw new Error('Recovery is incomplete');
        // Due indexes and alarms are deliberately absent. Pending work remains evidence.
        state.complete = true;
      } else throw new Error('Unknown recovery action');
    }
    await tx.put(RECOVERY_KEY, state);
    return { count: state.count, complete: state.complete };
  });
}

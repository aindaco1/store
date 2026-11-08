import { softwareLicensingEnabled } from './software-licenses.js';

export async function licensingRequest(env, action, payload, headers = {}) {
  if (!softwareLicensingEnabled(env) || !env.LICENSING_SERVICE || !env.LICENSING_ADMIN_SECRET) throw new Error('Licensing unavailable');
  return env.LICENSING_SERVICE.fetch(new Request(`https://licensing/internal/${action}`, { method: 'POST',
    headers: { ...headers, Authorization: `Bearer ${env.LICENSING_ADMIN_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), ...(action === 'customer-download' ? {} : { signal: AbortSignal.timeout(15000) }) }));
}

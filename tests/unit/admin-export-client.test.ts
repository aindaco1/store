import { describe, expect, it, vi } from 'vitest';

import {
  exchangeAdminLoginToken,
  fetchAdminExport
} from '../../scripts/lib/admin-export-client.mjs';

describe('admin export client', () => {
  it('refuses to send one-time admin credentials over non-local HTTP', async () => {
    const fetchImpl = vi.fn();
    await expect(exchangeAdminLoginToken({
      workerBase: 'http://worker.example.com',
      token: 'one-time-token',
      fetchImpl
    })).rejects.toThrow(/HTTPS/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows loopback HTTP and keeps the exchanged session in memory', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      csrfToken: 'csrf-token',
      user: { role: 'super_admin' }
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'store_admin_session=session-token; HttpOnly; Path=/'
      }
    }));
    const session = await exchangeAdminLoginToken({
      workerBase: 'http://127.0.0.1:8989',
      token: 'one-time-token',
      fetchImpl
    });
    expect(session).toEqual({
      cookie: 'store_admin_session=session-token',
      csrfToken: 'csrf-token',
      role: 'super_admin'
    });
  });

  it('rejects normalized paths that escape the admin namespace', async () => {
    const fetchImpl = vi.fn();
    await expect(fetchAdminExport({
      workerBase: 'https://worker.example.com',
      session: { cookie: 'store_admin_session=session-token' },
      path: '/admin/../api/orders',
      fetchImpl
    })).rejects.toThrow(/under \/admin\//i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

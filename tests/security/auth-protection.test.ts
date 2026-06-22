import { describe, expect, it } from 'vitest';
import { expectStatusIn, securityFetch } from './helpers';

describe('Store auth protection', () => {
  it('requires an admin session for Store admin reads', async () => {
    const endpoints = [
      '/admin/settings',
      '/admin/plan-usage',
      '/admin/dashboard/summary',
      '/admin/store/health',
      '/admin/store/orders',
      '/admin/store/products',
      '/admin/store/downloads',
      '/admin/store/inventory'
    ];

    for (const endpoint of endpoints) {
      const res = await securityFetch(endpoint);
      expectStatusIn(res, [401, 403], endpoint);
    }
  });

  it('requires an admin session before Store admin writes', async () => {
    const endpoints = [
      ['/admin/settings/publish', { changes: [] }],
      ['/admin/users', { users: [] }],
      ['/admin/store/products/publish', { productId: 't-shirt-2' }],
      ['/admin/store/products/bulk-publish', { intent: 'bulk_publish', productIds: ['t-shirt-2'], fields: { status: 'draft' } }],
      ['/admin/store/downloads/upload', { productId: 'download-1', content: 'data:text/plain;base64,AA==' }],
      ['/admin/store/inventory', { action: 'set', productId: 't-shirt-2', inventory: 1 }],
      ['/admin/store/orders/download-access', { orderToken: 'fake', itemId: 'fake', action: 'expire' }],
      ['/admin/store/orders/check-in', { orderToken: 'fake', itemId: 'fake', checkedIn: true, quantity: 1 }]
    ] as const;

    for (const [endpoint, payload] of endpoints) {
      const res = await securityFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      expectStatusIn(res, [401, 403, 429], endpoint);
    }
  });

  it('does not expose legacy campaign routes', async () => {
    const endpoints = [
      '/votes?token=dev-token&decisions=poster',
      '/pledge?token=fake',
      '/pledges?token=fake',
      '/stats/hand-relations',
      '/launch-reminders'
    ];

    for (const endpoint of endpoints) {
      const res = await securityFetch(endpoint);
      expect(res.status).toBe(404);
    }
  });
});

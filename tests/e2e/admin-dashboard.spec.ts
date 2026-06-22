import { test, expect } from '@playwright/test';
import path from 'node:path';

const WORKER_BASE = 'http://127.0.0.1:8989';
const SITE_BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4002';
const JSON_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': SITE_BASE,
  'access-control-allow-credentials': 'true'
};
const axePath = path.resolve(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');

type AdminRole = 'super_admin' | 'limited_admin';

const SUPER_ADMIN_EMAIL = 'admin@example.com';
const LIMITED_ADMIN_EMAIL = 'creator@example.com';
const OTHER_ADMIN_EMAIL = 'other-admin@example.com';
const NEW_ADMIN_EMAIL = 'editor@example.com';
const TICKET_ORDER_TOKEN = 'store-order-ticket-e2e';
const DIGITAL_ORDER_TOKEN = 'store-order-digital-e2e';
const TICKET_BUYER_NAME = 'Ticket Buyer';
const TICKET_BUYER_EMAIL = 'ticket-buyer@example.com';
const DIGITAL_BUYER_NAME = 'Download Buyer';
const DIGITAL_BUYER_EMAIL = 'download-buyer@example.com';
const TICKET_ITEM_ID = 'fronteras-ticket-general';
const DIGITAL_ITEM_ID = 'fronteras-download';
const RSVP_ITEM_ID = 'rsvp-1';

function withFieldHelp<T extends { label: string; help?: string }>(row: T): T {
  return {
    ...row,
    help: row.help || `Explains the ${row.label} field.`
  };
}

function settingsRow(row: Record<string, any>) {
  return withFieldHelp(row as { label: string; help?: string });
}

async function runAxe(page: any) {
  await page.route('**/__axe-core.js', async (route: any) => {
    await route.fulfill({
      path: axePath,
      contentType: 'application/javascript'
    });
  });
  await page.addScriptTag({ url: '/__axe-core.js' });
  return page.evaluate(async () => {
    return (window as any).axe.run(document, {
      rules: {
        'color-contrast': { enabled: false }
      }
    });
  });
}

async function expectNoAxeViolations(page: any) {
  const results = await runAxe(page);
  expect(
    results.violations,
    results.violations.map((violation: any) => `${violation.id}: ${violation.help}`).join('\n')
  ).toEqual([]);
}

async function routeAdminWorker(page: any, options: { role?: AdminRole } = {}) {
  const role = options.role || 'super_admin';
  const calls: Record<string, any[]> = {
    authStart: [],
    authExchange: [],
    summary: [],
    settings: [],
    settingsPreview: [],
    settingsPublish: [],
    logoUploads: [],
    imageUploads: [],
    adminUsersSave: [],
    addOnInventory: [],
    storeHealth: [],
    planUsage: [],
    storeAnalytics: [],
    storeMarketingReferrals: [],
    storeMarketingAbandonedHealth: [],
    storeMarketingAbandonedSuppression: [],
    storeMarketingDrafts: [],
    auditCsv: [],
    storeReconciliationCsv: [],
    storeOrders: [],
    storeOrderCsv: [],
    storeAttendeeCsv: [],
    storeOrderCheckIns: [],
    storeOrderDownloadAccesses: [],
    storeProducts: [],
    storeProductMedia: [],
    storeProductPreviews: [],
    storeProductPublishes: [],
    storeProductBulkPublishes: [],
    storeDownloads: [],
    storeDownloadUploads: [],
    storeInventoryWrites: []
  };
  const user = {
    email: role === 'super_admin' ? SUPER_ADMIN_EMAIL : LIMITED_ADMIN_EMAIL,
    role,
    accessScopes: role === 'super_admin' ? [] : ['store']
  };

  await page.route(`${WORKER_BASE}/admin/**`, async (route: any) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData() || '{}') : {};
    const fulfillJson = (payload: Record<string, any>, status = 200, extraHeaders: Record<string, string> = {}) => route.fulfill({
      status,
      headers: { ...JSON_HEADERS, ...extraHeaders },
      body: JSON.stringify(payload)
    });

    if (url.pathname === '/admin/session') {
      return fulfillJson({ error: 'Unauthorized' }, 401);
    }
    if (url.pathname === '/admin/auth/start') {
      calls.authStart.push(body);
      return fulfillJson({ success: true, sent: false, loginUrl: `${SITE_BASE}/admin/?admin_login=test-token` });
    }
    if (url.pathname === '/admin/auth/exchange') {
      calls.authExchange.push(body);
      return fulfillJson({
        success: true,
        user,
        csrfToken: 'csrf-test-token',
        expiresAt: '2026-06-11T23:00:00.000Z'
      }, 200, {
        'set-cookie': 'store_admin_session=session-test; Path=/admin; HttpOnly; SameSite=Lax'
      });
    }
    if (url.pathname === '/admin/dashboard/summary') {
      calls.summary.push({ method });
      return fulfillJson({
        user,
        scope: 'store',
        totals: {
          orders: 1,
          products: 1,
          inventoryRows: 1
        },
        writeBudget: { readOnly: true, kvWritesExpected: 0 }
      });
    }
    if (url.pathname === '/admin/store/health' && method === 'GET') {
      calls.storeHealth.push({ method });
      return fulfillJson(storeHealthPayload());
    }
    if (url.pathname === '/admin/plan-usage' && method === 'GET') {
      calls.planUsage.push({ method });
      return fulfillJson(planUsagePayload());
    }
    if (url.pathname === '/admin/store/analytics' && method === 'GET') {
      calls.storeAnalytics.push(Object.fromEntries(url.searchParams.entries()));
      return fulfillJson(storeAnalyticsPayload());
    }
    if (url.pathname === '/admin/store/marketing/referrals' && method === 'GET') {
      calls.storeMarketingReferrals.push({ method });
      return fulfillJson({
        scope: 'store',
        referrals: [{
          code: 'flyer-crew',
          name: 'Flyer Crew',
          referrer: 'Flyer Crew',
          url: `${SITE_BASE}/?utm_source=dustwave&utm_medium=social&utm_campaign=shop&ref=flyer-crew`,
          path: '/',
          utmSource: 'dustwave',
          utmMedium: 'social',
          utmCampaign: 'shop',
          utmContent: '',
          qrCode: { format: 'qr-code', url: `${SITE_BASE}/?ref=flyer-crew` },
          createdAt: '2026-06-11T12:00:00.000Z'
        }],
        writeBudget: { readOnly: true, kvWritesExpected: 0 }
      });
    }
    if (url.pathname === '/admin/store/marketing/abandoned-checkout/health' && method === 'GET') {
      calls.storeMarketingAbandonedHealth.push({ method });
      return fulfillJson({
        scope: 'store',
        queue: {
          hasPending: true,
          nextDueAt: '2026-06-21T12:00:00.000Z',
          updatedAt: '2026-06-21T06:00:00.000Z'
        },
        totals: {
          queued: 2,
          pending: 1,
          sent: 1,
          skipped: 0,
          failed: 0,
          suppressed: 1,
          completed: 1,
          alreadySent: 0,
          invalid: 0
        },
        recentOutcomes: [{
          at: '2026-06-21T06:30:00.000Z',
          type: 'suppressed',
          reason: 'admin_suppression',
          email: 'buyer@example.com',
          emailHash: 'a'.repeat(64)
        }],
        writeBudget: { readOnly: true, kvWritesExpected: 0 }
      });
    }
    if (url.pathname === '/admin/store/marketing/abandoned-checkout/suppression' && (method === 'POST' || method === 'DELETE')) {
      calls.storeMarketingAbandonedSuppression.push({ method, body });
      return fulfillJson({
        success: true,
        suppressed: method === 'POST',
        emailHash: body.emailHash || 'b'.repeat(64),
        writeBudget: { readOnly: false, kvWritesExpected: 2 }
      });
    }
    if (url.pathname === '/admin/store/marketing/referrals' && method === 'POST') {
      calls.storeMarketingReferrals.push({ method, body });
      return fulfillJson({
        success: true,
        scope: 'store',
        referrals: [{
          code: body.code,
          name: body.referrer,
          referrer: body.referrer,
          url: body.url,
          path: body.path,
          utmSource: body.utmSource,
          utmMedium: body.utmMedium,
          utmCampaign: body.utmCampaign,
          utmContent: body.utmContent,
          qrCode: { format: 'qr-code', url: body.url },
          createdAt: '2026-06-11T12:00:00.000Z'
        }],
        writeBudget: { readOnly: false, kvWritesExpected: 1 }
      });
    }
    if (url.pathname === '/admin/store/marketing/referrals' && method === 'DELETE') {
      calls.storeMarketingReferrals.push({ method, body });
      return fulfillJson({
        success: true,
        scope: 'store',
        deletedCode: body.code,
        referrals: [],
        writeBudget: { readOnly: false, kvWritesExpected: 1 }
      });
    }
    if (url.pathname === '/admin/store/marketing/draft' && method === 'GET') {
      calls.storeMarketingDrafts.push({ method });
      return fulfillJson({
        scope: 'store',
        draft: null,
        ttlSeconds: 604800,
        writeBudget: { readOnly: true, kvWritesExpected: 0 }
      });
    }
    if (url.pathname === '/admin/store/marketing/draft' && method === 'POST') {
      calls.storeMarketingDrafts.push({ method, body });
      return fulfillJson({
        success: true,
        scope: 'store',
        draft: {
          draft: body.draft,
          revision: 'draft-revision',
          updatedAt: '2026-06-11T12:00:00.000Z',
          updatedBy: SUPER_ADMIN_EMAIL,
          expiresAt: '2026-06-18T12:00:00.000Z'
        },
        writeBudget: { readOnly: false, kvWritesExpected: 1 }
      });
    }
    if (url.pathname === '/admin/store/marketing/draft' && method === 'DELETE') {
      calls.storeMarketingDrafts.push({ method, body });
      return fulfillJson({
        success: true,
        scope: 'store',
        draft: null,
        writeBudget: { readOnly: false, kvWritesExpected: 1 }
      });
    }
    if (url.pathname === '/admin/audit.csv' && method === 'GET') {
      calls.auditCsv.push(Object.fromEntries(url.searchParams.entries()));
      return route.fulfill({
        status: 200,
        headers: {
          ...JSON_HEADERS,
          'content-type': 'text/csv',
          'content-disposition': 'attachment; filename="admin-audit-2026-06-11.csv"'
        },
        body: `key,created_at,action,admin_email\nadmin-audit:2026-06-11:store_order:check_in:test,2026-06-11T12:00:00.000Z,store_order:check_in,${SUPER_ADMIN_EMAIL}\n`
      });
    }
    if (url.pathname === '/admin/store/reconciliation.csv' && method === 'GET') {
      calls.storeReconciliationCsv.push(Object.fromEntries(url.searchParams.entries()));
      return route.fulfill({
        status: 200,
        headers: {
          ...JSON_HEADERS,
          'content-type': 'text/csv',
          'content-disposition': 'attachment; filename="store-reconciliation-2026-06-11.csv"'
        },
        body: `order_token,status,total_cents,payment_amount_cents,needs_review\n${TICKET_ORDER_TOKEN},confirmed,1200,1200,no\n`
      });
    }
    if (url.pathname === '/admin/settings') {
      calls.settings.push({ method });
      return fulfillJson({
        user,
        scope: role === 'super_admin' ? 'platform' : 'store',
        campaigns: [],
        sections: role === 'super_admin' ? storeSettingsSections() : [],
        writeBudget: { readOnly: true, kvWritesExpected: 0 }
      });
    }
    if (url.pathname === '/admin/settings/preview') {
      calls.settingsPreview.push(body);
      return fulfillJson({ valid: true, errors: [], warnings: [], writeBudget: { readOnly: true, kvWritesExpected: 0 } });
    }
    if (url.pathname === '/admin/settings/publish') {
      calls.settingsPublish.push(body);
      return fulfillJson({ success: true, deployNotice: 'Settings published. Deploy started.', writeBudget: { readOnly: false, kvWritesExpected: 1 } });
    }
    if (url.pathname === '/admin/settings/logo-upload') {
      calls.logoUploads.push(body);
      return fulfillJson({
        success: true,
        path: '/assets/images/defaults/logo-e2e.png',
        githubPath: 'assets/images/defaults/logo-e2e.png',
        contentType: body.contentType,
        bytes: 128,
        writeBudget: { readOnly: false, kvWritesExpected: 0 }
      });
    }
    if (url.pathname === '/admin/settings/image-upload') {
      calls.imageUploads.push(body);
      return fulfillJson({
        success: true,
        path: '/assets/images/products/product-fronteras-poster-big-e2e.png',
        githubPath: 'assets/images/products/product-fronteras-poster-big-e2e.png',
        contentType: body.contentType,
        bytes: 256,
        writeBudget: { readOnly: false, kvWritesExpected: 0 }
      });
    }
    if (url.pathname === '/admin/users') {
      calls.adminUsersSave.push(body);
      return fulfillJson({ success: true, emailed: [], writeBudget: { readOnly: false, kvWritesExpected: 1 } });
    }
    if (url.pathname === '/admin/add-ons/inventory') {
      calls.addOnInventory.push({ method, body });
      return fulfillJson({
        rows: [{
          productId: 'dust-wave-sticker',
          variantId: '',
          label: 'DUST WAVE Sticker',
          configuredInventory: 50,
          inventory: 50,
          sold: 2,
          remaining: 48,
          hasOverride: false
        }],
        writeBudget: { readOnly: method === 'GET', kvWritesExpected: method === 'GET' ? 0 : 1 }
      });
    }
    if (url.pathname === '/admin/store/orders' && method === 'GET') {
      calls.storeOrders.push(Object.fromEntries(url.searchParams.entries()));
      return fulfillJson(storeOrdersPayload());
    }
    if (url.pathname === '/admin/store/orders.csv' && method === 'GET') {
      calls.storeOrderCsv.push(Object.fromEntries(url.searchParams.entries()));
      return route.fulfill({
        status: 200,
        headers: {
          ...JSON_HEADERS,
          'content-type': 'text/csv',
          'content-disposition': 'attachment; filename="store-orders-2026-06-11.csv"'
        },
        body: `order,item,quantity\n${TICKET_ORDER_TOKEN},Fronteras Screening,1\n`
      });
    }
    if (url.pathname === '/admin/store/attendees.csv' && method === 'GET') {
      calls.storeAttendeeCsv.push(Object.fromEntries(url.searchParams.entries()));
      return route.fulfill({
        status: 200,
        headers: {
          ...JSON_HEADERS,
          'content-type': 'text/csv',
          'content-disposition': 'attachment; filename="store-attendees-2026-06-11.csv"'
        },
        body: `event,item,order,customer_email,quantity,checked_in\nFronteras Screening,Fronteras Screening,${TICKET_ORDER_TOKEN},${TICKET_BUYER_EMAIL},1,no\n`
      });
    }
    if (url.pathname === '/admin/store/orders/check-in' && method === 'POST') {
      calls.storeOrderCheckIns.push(body);
      return fulfillJson({
        success: true,
        mutation: {
          orderToken: body.orderToken,
          itemId: body.itemId,
          checkedIn: body.checkedIn,
          quantity: body.quantity
        },
        writeBudget: { readOnly: false, kvWritesExpected: 1 }
      });
    }
    if (url.pathname === '/admin/store/orders/download-access' && method === 'POST') {
      calls.storeOrderDownloadAccesses.push(body);
      return fulfillJson({
        success: true,
        message: body.action === 'expire' ? 'Download access expired.' : 'Download access reissued.',
        mutation: {
          orderToken: body.orderToken,
          itemId: body.itemId,
          action: body.action,
          expiresHours: body.expiresHours || 72,
          expiresAt: '2026-06-14T12:00:00.000Z'
        },
        writeBudget: { readOnly: false, kvWritesExpected: 2 }
      });
    }
    if (url.pathname === '/admin/store/products' && method === 'GET') {
      calls.storeProducts.push({ method });
      return fulfillJson(storeProductsPayload());
    }
    if (url.pathname === '/admin/store/products/media' && method === 'GET') {
      calls.storeProductMedia.push(Object.fromEntries(url.searchParams.entries()));
      return fulfillJson({
        scope: 'store',
        productId: url.searchParams.get('productId') || '',
        media: [{
          path: '/assets/images/fronteras-poster.png',
          label: 'Fronteras Poster (Big)',
          productId: 'fronteras-poster-big',
          currentProduct: true
        }],
        totals: { media: 1 },
        writeBudget: { readOnly: true, kvWritesExpected: 0 }
      });
    }
    if (url.pathname === '/admin/store/products/preview' && method === 'POST') {
      calls.storeProductPreviews.push(body);
      const image = body.fields?.image || '/assets/images/fronteras-poster.png';
      const previewImage = String(image).startsWith('/') ? `https://shop.dustwave.xyz${image}` : image;
      const previewName = body.fields?.name || 'Preview';
      const previewDescription = body.fields?.description || '';
      return fulfillJson({
        success: true,
        scope: 'store',
        productId: body.productId,
        preview: {
          html: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><base href="https://shop.dustwave.xyz/"><link rel="stylesheet" href="https://shop.dustwave.xyz/assets/main.css"></head><body class="admin-store-product-preview-body"><section class="storefront storefront--product admin-store-product-preview" data-admin-store-product-preview><div class="storefront__header storefront__header--compact"><p class="storefront__eyebrow">FRONTERAS</p><h1>${previewName}</h1></div><div class="storefront__product-detail"><article class="store-product-card" data-store-product-card><a class="store-product-card__media" href="#" tabindex="-1" aria-disabled="true"><img class="store-product-card__image" src="${previewImage}" alt="${previewName}"></a><div class="store-product-card__body"><div class="store-product-card__header"><p class="store-product-card__eyebrow">FRONTERAS</p><h2 class="store-product-card__title"><a href="#" tabindex="-1">${previewName}</a></h2></div><p class="store-product-card__description">${previewDescription}</p><div class="store-product-card__purchase"><p class="store-product-card__price">$35</p><p class="store-product-card__availability" data-store-inventory-state="none"></p><div class="store-product-card__controls store-product-card__controls--simple"><div class="store-product-card__field store-product-card__field--quantity"><label class="store-product-card__label">Quantity</label><div class="store-product-card__stepper"><button class="store-product-card__stepper-button" type="button" disabled>-</button><input class="store-product-card__qty" type="number" value="1" disabled><button class="store-product-card__stepper-button" type="button" disabled>+</button></div></div><button class="store-add-item store-product-card__button" type="button" disabled>Add to cart - $35</button></div></div></div></article><div class="storefront__product-copy"><p>${previewDescription}</p><p>Preview copy extends beyond the first fold so the admin iframe can scroll like the Pool preview surface.</p><p>Second preview paragraph.</p><p>Third preview paragraph.</p></div></div></section></body></html>`,
          generatedAt: '2026-06-11T12:00:00.000Z'
        },
        writeBudget: { readOnly: true, kvWritesExpected: 0 }
      });
    }
    if (url.pathname === '/admin/store/products/publish' && method === 'POST') {
      calls.storeProductPublishes.push(body);
      return fulfillJson({
        success: true,
        published: true,
        productId: body.productId,
        deployNotice: 'Product published. Deploy started.',
        writeBudget: { readOnly: false, kvWritesExpected: 0 }
      });
    }
    if (url.pathname === '/admin/store/products/bulk-publish' && method === 'POST') {
      calls.storeProductBulkPublishes.push(body);
      return fulfillJson({
        success: true,
        published: true,
        updated: body.productIds?.length || 0,
        skipped: 0,
        productIds: body.productIds || [],
        deployNotice: 'Bulk product publish committed changes to GitHub and started a deploy.',
        writeBudget: { readOnly: false, kvWritesExpected: 1 }
      });
    }
    if (url.pathname === '/admin/store/downloads' && method === 'GET') {
      calls.storeDownloads.push({ method });
      return fulfillJson(storeDownloadsPayload());
    }
    if (url.pathname === '/admin/store/downloads/upload' && method === 'POST') {
      calls.storeDownloadUploads.push(body);
      return fulfillJson({
        success: true,
        productId: body.productId,
        variantId: body.variantId,
        fileKey: DIGITAL_ITEM_ID,
        filename: body.filename,
        size: 24,
        writeBudget: { readOnly: false, kvWritesExpected: 0 }
      });
    }
    if (url.pathname === '/admin/store/inventory' && method === 'POST') {
      calls.storeInventoryWrites.push(body);
      return fulfillJson({
        success: true,
        mutation: {
          action: body.action,
          productId: body.productId,
          variantId: body.variantId,
          before: { inventory: 12 },
          after: { inventory: body.action === 'set' ? body.inventory : 14 }
        },
        writeBudget: { readOnly: false, kvWritesExpected: 1 }
      });
    }

    throw new Error(`Unexpected admin route: ${method} ${url.pathname}`);
  });

  return calls;
}

function storeSettingsSections() {
  return [{
    title: 'Platform',
    rows: [
      settingsRow({ label: 'Site title', value: 'Shop', rawValue: 'Shop', editable: true, path: 'title', type: 'string', input: 'text' }),
      settingsRow({ label: 'Name', value: 'Shop', rawValue: 'Shop', editable: true, path: 'platform.name', type: 'string', input: 'text' }),
      settingsRow({ label: 'Company', value: 'Dust Wave', rawValue: 'Dust Wave', editable: true, path: 'platform.company_name', type: 'string', input: 'text' }),
	      settingsRow({ label: 'Site author', value: 'Dust Wave', rawValue: 'Dust Wave', editable: true, path: 'author', type: 'string', input: 'text' }),
		      settingsRow({ label: 'Default timezone', value: 'America/Denver', rawValue: 'America/Denver', editable: true, path: 'platform.timezone', type: 'string', input: 'select', options: [{ value: 'America/Denver', label: 'America/Denver' }, { value: 'Europe/London', label: 'Europe/London' }] }),
		      settingsRow({ label: 'Add-ons Enabled', value: 'Yes', rawValue: true, editable: true, path: 'add_ons.enabled', type: 'boolean', input: 'boolean', layoutGroup: 'platform-addons' }),
		      settingsRow({ label: 'Add-on product count', value: '3', rawValue: 3, editable: true, path: 'add_ons.product_count', type: 'number', input: 'integer', min: 1, max: 5, step: 1, layoutGroup: 'platform-addons' }),
		      settingsRow({ label: 'App mode', value: 'test' })
		    ]
  }, {
    title: 'Brand & SEO',
    rows: [
      settingsRow({ label: 'Logo', value: '/assets/images/logo.svg', rawValue: '/assets/images/logo.svg', editable: true, path: 'platform.logo_path', type: 'string', input: 'image-upload', layoutGroup: 'brand-logo-footer-logo' }),
      settingsRow({ label: 'Footer logo', value: '/assets/images/logo.svg', rawValue: '/assets/images/logo.svg', editable: true, path: 'platform.footer_logo_path', type: 'string', input: 'image-upload', layoutGroup: 'brand-logo-footer-logo' }),
      settingsRow({ label: 'X handle', value: '', rawValue: '', editable: true, path: 'seo.x_handle', type: 'string', input: 'text' })
    ]
  }, {
    title: 'Canonical URLs',
    rows: [
      settingsRow({ label: 'Production site URL', value: 'https://shop.dustwave.xyz', rawValue: 'https://shop.dustwave.xyz', editable: true, path: 'platform.site_url', type: 'string', input: 'url' }),
      settingsRow({ label: 'Production Worker URL', value: 'https://checkout.dustwave.xyz', rawValue: 'https://checkout.dustwave.xyz', editable: true, path: 'platform.worker_url', type: 'string', input: 'url' })
    ]
  }, {
    title: 'Pricing',
    rows: [
      settingsRow({ label: 'Sales Tax Rate', value: '0.07625', rawValue: '0.07625', editable: true, path: 'pricing.sales_tax_rate', type: 'number', input: 'percent', min: 0, max: 1, step: 0.0001, displayMultiplier: 100, submitDivisor: 100 }),
      settingsRow({ label: 'Default Platform Tip Percent', value: '0', rawValue: '0', editable: true, path: 'pricing.default_tip_percent', type: 'number', input: 'percent', min: 0, max: 100, step: 1 })
    ]
  }, {
    title: 'Tax',
    rows: [
      settingsRow({
        label: 'Provider',
        value: 'nm_grt',
        rawValue: 'nm_grt',
        editable: true,
        path: 'tax.provider',
        type: 'string',
        input: 'select',
        options: [
          { value: 'flat', label: 'Flat rate' },
          { value: 'offline_rules', label: 'Offline rules' },
          { value: 'nm_grt', label: 'New Mexico GRT' },
          { value: 'zip_tax', label: 'ZIP.TAX' }
        ]
      }),
      settingsRow({ label: 'Origin country', value: 'US', rawValue: 'US', editable: true, path: 'tax.origin_country', type: 'string', input: 'select', options: [{ value: 'US', label: 'United States' }, { value: 'CA', label: 'Canada' }] }),
      settingsRow({ label: 'New Mexico GRT API base', value: 'https://grt.edacnm.org', rawValue: 'https://grt.edacnm.org', path: 'tax.nm_grt_api_base', visibleWhen: { path: 'tax.provider', value: 'nm_grt' } }),
      settingsRow({ label: 'ZIP.TAX API base', value: 'https://api.zip-tax.com', rawValue: 'https://api.zip-tax.com', path: 'tax.zip_tax_api_base', visibleWhen: { path: 'tax.provider', value: 'zip_tax' } })
    ]
  }, {
    title: 'Shipping',
    rows: [
      settingsRow({ label: 'Origin postal code', value: '87120', rawValue: '87120', editable: true, path: 'shipping.origin_zip', type: 'string', input: 'text' }),
      settingsRow({ label: 'Origin country', value: 'US', rawValue: 'US', editable: true, path: 'shipping.origin_country', type: 'string', input: 'select', options: [{ value: 'US', label: 'United States' }, { value: 'CA', label: 'Canada' }] }),
      settingsRow({ label: 'USPS enabled', value: 'Yes', rawValue: 'true', editable: true, path: 'shipping.usps.enabled', type: 'boolean', input: 'boolean' }),
      settingsRow({ label: 'USPS client ID', value: 'Not configured', rawValue: '', editable: true, path: 'shipping.usps.client_id', type: 'string', input: 'text', visibleWhen: { path: 'shipping.usps.enabled', value: 'true' } }),
      settingsRow({ label: 'USPS API base', value: 'Not configured', rawValue: '', editable: true, path: 'shipping.usps.api_base', type: 'string', input: 'url', placeholder: 'Default: https://apis.usps.com', visibleWhen: { path: 'shipping.usps.enabled', value: 'true' } })
    ]
  }, {
    title: 'Marketing',
    rows: [
      settingsRow({ label: 'Default UTM source', value: 'dustwave', rawValue: 'dustwave', editable: true, path: 'marketing.default_utm_source', type: 'string', input: 'text', layoutGroup: 'marketing-utm-defaults' }),
      settingsRow({ label: 'Default UTM medium', value: 'social', rawValue: 'social', editable: true, path: 'marketing.default_utm_medium', type: 'string', input: 'text', layoutGroup: 'marketing-utm-defaults' }),
      settingsRow({ label: 'Default UTM campaign', value: 'shop', rawValue: 'shop', editable: true, path: 'marketing.default_utm_campaign', type: 'string', input: 'text', layoutGroup: 'marketing-utm-defaults' }),
      settingsRow({ label: 'Default UTM content', value: '', rawValue: '', editable: true, path: 'marketing.default_utm_content', type: 'string', input: 'text', layoutGroup: 'marketing-utm-defaults' }),
      settingsRow({ label: 'Default referral code', value: '', rawValue: '', editable: true, path: 'marketing.default_ref', type: 'string', input: 'text', layoutGroup: 'marketing-link-defaults' }),
      settingsRow({ label: 'Landing page path', value: '/', rawValue: '/', editable: true, path: 'marketing.landing_page_path', type: 'string', input: 'url', layoutGroup: 'marketing-link-defaults' }),
      settingsRow({ label: 'Share title', value: 'Dust Wave Shop', rawValue: 'Dust Wave Shop', editable: true, path: 'marketing.share_title', type: 'string', input: 'text', layoutGroup: 'marketing-share-copy' }),
      settingsRow({ label: 'Share text', value: 'Dust Wave merch, prints, tickets, downloads, and event RSVPs.', rawValue: 'Dust Wave merch, prints, tickets, downloads, and event RSVPs.', editable: true, path: 'marketing.share_text', type: 'string', input: 'textarea' })
    ]
  }, {
    title: 'Design',
    rows: [
      settingsRow({ label: 'Layout max width', value: '1000px', rawValue: '1000px', editable: true, path: 'design.layout_max_width', type: 'string', input: 'text' }),
      settingsRow({ label: 'Body font', value: '"Inter", sans-serif', rawValue: '"Inter", sans-serif', editable: true, path: 'design.font_body', type: 'string', input: 'text', layoutGroup: 'design-fonts' }),
      settingsRow({ label: 'Heading font', value: '"gambado-sans", sans-serif', rawValue: '"gambado-sans", sans-serif', editable: true, path: 'design.font_display', type: 'string', input: 'text', layoutGroup: 'design-fonts' }),
      settingsRow({ label: 'Text Color', value: '#252930', rawValue: '#252930', editable: true, path: 'design.color_text', type: 'string', input: 'color', layoutGroup: 'design-colors' }),
      settingsRow({ label: 'Muted Color', value: '#5d6573', rawValue: '#5d6573', editable: true, path: 'design.color_text_muted', type: 'string', input: 'color', layoutGroup: 'design-colors' }),
      settingsRow({ label: 'Surface Color', value: '#f0f1ed', rawValue: '#f0f1ed', editable: true, path: 'design.color_surface_subtle', type: 'string', input: 'color', layoutGroup: 'design-colors' }),
      settingsRow({ label: 'Border Color', value: '#d2d7df', rawValue: '#d2d7df', editable: true, path: 'design.color_border', type: 'string', input: 'color', layoutGroup: 'design-colors' }),
      settingsRow({ label: 'Primary Color', value: '#101215', rawValue: '#101215', editable: true, path: 'design.color_primary', type: 'string', input: 'color', layoutGroup: 'design-colors' })
    ]
	  }, {
	    title: 'Store readiness',
    rows: [
      settingsRow({ label: 'Store readiness', value: '', rawValue: '', input: 'store-readiness', hideLabel: true })
    ]
  }, {
    title: 'Plan usage',
    rows: [
      settingsRow({ label: 'Plan usage', value: '', rawValue: '', input: 'plan-usage', hideLabel: true })
    ]
  }, {
    title: 'Users',
    rows: [
      settingsRow({
        label: 'Users',
        value: '3 users',
        rawValue: [
          { name: 'Admin User', email: SUPER_ADMIN_EMAIL, role: 'super_admin', accessScopes: [] },
          { name: 'Other Admin', email: OTHER_ADMIN_EMAIL, role: 'super_admin', accessScopes: [] },
          { name: 'Store User', email: LIMITED_ADMIN_EMAIL, role: 'limited_admin', accessScopes: ['store'] }
        ],
        editable: true,
        path: 'admin.users',
        type: 'admin_users',
        input: 'admin-users',
        accessOptions: [{ label: 'Store', value: 'store' }],
        currentUserEmail: SUPER_ADMIN_EMAIL
      })
    ]
  }, {
    title: 'Advanced performance',
    rows: [
      settingsRow({ label: 'Intent prefetch enabled', value: 'true', rawValue: 'true', editable: true, path: 'performance.intent_prefetch_enabled', type: 'boolean', input: 'boolean' }),
      settingsRow({ label: 'Intent prefetch delay ms', value: '90', rawValue: '90', editable: true, path: 'performance.intent_prefetch_delay_ms', type: 'number', input: 'integer', min: 0, step: 10 }),
      settingsRow({ label: 'Intent prefetch limit', value: '3', rawValue: '3', editable: true, path: 'performance.intent_prefetch_limit', type: 'number', input: 'integer', min: 0, step: 1 }),
      settingsRow({ label: 'Live inventory cache TTL seconds', value: '300', rawValue: '300', editable: true, path: 'cache.live_inventory_ttl_seconds', type: 'number', input: 'integer' })
    ]
  }, {
    title: 'Secrets & credentials',
    rows: [
      settingsRow({ label: 'Stripe secret key', value: 'Configured', layoutGroup: 'secrets-credentials' }),
      settingsRow({ label: 'Checkout intent secret', value: 'Configured', layoutGroup: 'secrets-credentials' }),
      settingsRow({ label: 'Magic link secret', value: 'Configured', layoutGroup: 'secrets-credentials' })
    ]
  }, {
    title: 'Runtime diagnostics',
    rows: [
      settingsRow({ label: 'Current site base', value: SITE_BASE }),
      settingsRow({ label: 'Current Worker base', value: WORKER_BASE }),
      settingsRow({ label: 'CORS allowed origin', value: SITE_BASE })
    ]
  }];
}

function storeOrdersPayload() {
  return {
    scope: 'store',
    totals: {
      orders: 2,
      fulfillmentRows: 2,
      physicalQuantity: 0,
      digitalQuantity: 1,
      ticketQuantity: 1,
      rsvpQuantity: 0,
      checkedInQuantity: 0
    },
    page: {
      cursor: 0,
      returned: 2,
      matched: 2,
      matchedOrders: 2,
      nextCursor: null
    },
    attendance: {
      totals: {
        eventCount: 1,
        orderCount: 1,
        quantity: 1,
        checkedInQuantity: 0,
        uncheckedQuantity: 1
      },
      events: [{
        productId: 'fronteras-ticket',
        variantId: 'general',
        itemName: 'Fronteras Screening',
        variantLabel: 'General Admission',
        fulfillmentType: 'ticket',
        eventStartsAt: '2026-07-01T01:00:00.000Z',
        eventVenue: 'Guild Cinema',
        eventAddress: '3405 Central Ave NE, Albuquerque, NM',
        quantity: 1,
        checkedInQuantity: 0,
        uncheckedQuantity: 1,
        checkedInRate: 0,
        orderCount: 1,
        rowCount: 1
      }]
    },
    fulfillments: [{
      orderToken: TICKET_ORDER_TOKEN,
      createdAt: '2026-06-11T12:00:00.000Z',
      customerName: TICKET_BUYER_NAME,
      customerEmail: TICKET_BUYER_EMAIL,
      itemId: TICKET_ITEM_ID,
      itemName: 'Fronteras Screening',
      variantLabel: 'General Admission',
      sku: TICKET_ITEM_ID,
      fulfillmentType: 'ticket',
      eventStartsAt: '2026-07-01T01:00:00.000Z',
      eventVenue: 'Guild Cinema',
      eventAddress: '3405 Central Ave NE, Albuquerque, NM',
      status: 'confirmed',
      paymentStatus: 'paid',
      totalCents: 1200,
      quantity: 1,
      checkInAvailable: true,
      checkedIn: false,
      checkedInQuantity: 0
    }, {
      orderToken: DIGITAL_ORDER_TOKEN,
      createdAt: '2026-06-11T12:05:00.000Z',
      confirmedAt: '2026-06-11T12:05:00.000Z',
      customerName: DIGITAL_BUYER_NAME,
      customerEmail: DIGITAL_BUYER_EMAIL,
      itemId: DIGITAL_ITEM_ID,
      itemName: 'Fronteras Download',
      variantLabel: '',
      sku: DIGITAL_ITEM_ID,
      fulfillmentType: 'digital',
      status: 'confirmed',
      paymentStatus: 'paid',
      totalCents: 500,
      quantity: 1,
      checkInAvailable: false,
      checkedIn: false,
      checkedInQuantity: 0,
      downloadAccessManageable: true,
      downloadAccessStatus: 'active',
      downloadAccessExpiresAt: '2026-06-14T12:05:00.000Z',
      downloadAccessExpiresHours: 72,
      downloadAccess: {
        itemId: DIGITAL_ITEM_ID,
        status: 'active',
        available: true,
        issuedAt: '2026-06-11T12:05:00.000Z',
        expiresAt: '2026-06-14T12:05:00.000Z',
        expiresInSeconds: 259200,
        expiresHours: 72
      }
    }],
    writeBudget: { readOnly: true, kvWritesExpected: 0 }
  };
}

function storeAnalyticsPayload() {
  return {
    scope: 'store',
    totals: {
      orders: 2,
      fulfillmentRows: 2,
      itemQuantity: 2,
      revenueCents: 1700,
      itemSubtotalCents: 1700,
      averageOrderCents: 850,
      physicalQuantity: 0,
      digitalQuantity: 1,
      ticketQuantity: 1,
      checkedInQuantity: 0,
      uncheckedQuantity: 1,
      checkedInRate: 0
    },
    breakdowns: {
      fulfillment: [
        { key: 'ticket', count: 1, quantity: 1, revenueCents: 1200 },
        { key: 'digital', count: 1, quantity: 1, revenueCents: 500 }
      ],
      status: [
        { key: 'confirmed', count: 2, quantity: 2, revenueCents: 1700 }
      ],
      payment: [
        { key: 'paid', count: 2, quantity: 2, revenueCents: 1700 }
      ],
      referral: [
        { key: 'flyer-crew', count: 1, quantity: 1, revenueCents: 1200 },
        { key: 'direct', count: 1, quantity: 1, revenueCents: 500 }
      ],
      utmSource: [
        { key: 'dustwave', count: 1, quantity: 1, revenueCents: 1200 }
      ],
      utmMedium: [
        { key: 'social', count: 1, quantity: 1, revenueCents: 1200 }
      ],
      utmCampaign: [
        { key: 'shop', count: 1, quantity: 1, revenueCents: 1200 }
      ],
      utmContent: [
        { key: 'none', count: 2, quantity: 2, revenueCents: 1700 }
      ],
      products: [
        { key: 'Fronteras Screening - General Admission', count: 1, quantity: 1, revenueCents: 1200 },
        { key: 'Fronteras Download', count: 1, quantity: 1, revenueCents: 500 }
      ]
    },
    referralLabels: {
      'flyer-crew': 'Flyer Crew'
    },
    generatedAt: '2026-06-11T12:10:00.000Z',
    writeBudget: { readOnly: true, kvWritesExpected: 0 }
  };
}

function storeHealthPayload() {
  return {
    scope: 'store',
    overallStatus: 'warning',
    totals: { total: 8, ok: 5, warning: 1, action: 0, info: 2 },
    checks: [{
      key: 'catalog-snapshot',
      label: 'Catalog snapshot',
      status: 'ok',
      detail: '27 products and 33 sellable rows loaded from _products.',
      meta: {
        products: 27,
        rows: 33,
        source: '_products',
        sourceHash: '1234567890abcdef',
        updatedAt: '2026-06-11T12:00:00.000Z'
      }
    }, {
      key: 'download-readiness',
      label: 'Download readiness',
      status: 'ok',
      detail: '1 of 1 download files are ready in R2.',
      meta: {
        count: 1,
        ready: 1,
        missing: 0,
        r2Ready: 1,
        updatedAt: '2026-06-11T12:00:00.000Z'
      }
    }, {
      key: 'inventory-baselines',
      label: 'Inventory baselines',
      status: 'warning',
      detail: '1 inventory row is at or below the launch warning threshold.',
      meta: {
        rows: 1,
        lowRows: 1,
        updatedAt: '2026-06-11T12:00:00.000Z'
      }
    }, {
      key: 'webhook-observability',
      label: 'Webhook activity',
      status: 'info',
      detail: 'No Stripe webhook activity has been recorded in the last 2 days.',
      meta: { received: 0, errorCount: 0 }
    }, {
      key: 'cron-heartbeat',
      label: 'Cron heartbeat',
      status: 'info',
      detail: 'No cron heartbeat has been recorded yet for this environment.',
      meta: { lastRun: '' }
    }, {
      key: 'secret-stripe-secret-key',
      label: 'Stripe secret key',
      status: 'ok',
      detail: 'Configured',
      meta: {}
    }, {
      key: 'secret-stripe-webhook-secret',
      label: 'Stripe webhook secret',
      status: 'ok',
      detail: 'Configured',
      meta: {}
    }, {
      key: 'secret-usps-client-secret',
      label: 'USPS client secret',
      status: 'ok',
      detail: 'Configured',
      meta: {}
    }],
    store: {
      catalog: { totals: { products: 27, rows: 33 }, catalog: { source: '_products', sourceHash: '1234567890abcdef' } },
      downloads: { bucketConfigured: true, totals: { count: 1, ready: 1, missing: 0, r2Ready: 1 } },
      inventory: { rows: 1, scanned: 1, indexed: 1, truncated: false },
      webhooks: { summaries: [], recent: [] },
      cron: { lastRun: '', lastError: null }
    },
    generatedAt: '2026-06-11T12:00:00.000Z',
    writeBudget: { readOnly: true, kvWritesExpected: 0 }
  };
}

function planUsagePayload() {
  return {
    thresholds: { warning: 80, critical: 95 },
    providers: [{
      id: 'cloudflare',
      name: 'Cloudflare',
      planName: 'Workers Paid',
      planKey: 'standard',
      status: 'ok',
      scope: 'Worker script: store-worker',
      upgradeUrl: 'https://dash.cloudflare.com/?to=/:account/workers/plans',
      metrics: [{
        id: 'cloudflare-workers-requests',
        label: 'Workers requests',
        period: 'monthly',
        used: 1200,
        limit: 10000000,
        unit: 'requests',
        percent: 0.012,
        severity: 'ok'
      }, {
        id: 'cloudflare-kv-reads',
        label: 'KV reads',
        period: 'monthly',
        used: 950,
        limit: 10000000,
        unit: 'operations',
        percent: 0.0095,
        severity: 'ok'
      }]
    }, {
      id: 'resend',
      name: 'Resend',
      planName: 'Pro',
      planKey: 'pro',
      status: 'ok',
      scope: 'Team email quota',
      upgradeUrl: 'https://resend.com/settings/billing',
      links: [{ label: 'Usage', url: 'https://resend.com/settings/usage' }],
      metrics: [{
        id: 'resend-monthly-emails',
        label: 'Monthly emails',
        period: 'monthly',
        used: 42,
        limit: 50000,
        unit: 'emails',
        percent: 0.084,
        severity: 'ok'
      }, {
        id: 'resend-daily-emails',
        label: 'Daily emails',
        period: 'daily',
        unlimited: true,
        unit: 'emails',
        severity: 'ok'
      }]
    }],
    generatedAt: '2026-06-11T12:00:00.000Z',
    writeBudget: { readOnly: true, kvWritesExpected: 0 }
  };
}

function storeProductsPayload() {
  return {
    scope: 'store',
    catalog: {
      version: 1,
      source: '_products',
      shippingPresets: ['tshirt', 'sticker', 'poster', 'parcel', 'mug', 'ticket']
    },
    totals: {
      products: 4,
      rows: 4,
      variants: 2,
      trackingInventory: 3,
      withOverrides: 0
    },
    rows: [{
      productId: 'fronteras-poster-big',
      variantId: '',
      sku: 'fronteras-poster-big',
      label: 'Fronteras Poster (Big)',
      fulfillmentType: 'physical',
      priceCents: 3500,
      status: 'active',
      image: '/assets/images/fronteras-poster.png',
      inventoryTracking: true,
      configuredInventory: 12,
      inventory: 12,
      sold: 0,
      remaining: 12,
      hasOverride: false,
      shippingPreset: 'poster'
    }, {
      productId: DIGITAL_ITEM_ID,
      variantId: '',
      sku: DIGITAL_ITEM_ID,
      label: 'DUST WAVE Digital Download',
      fulfillmentType: 'digital',
      priceCents: 500,
      status: 'active',
      public: false,
      launchTest: true,
      image: '/assets/images/default.png',
      inventoryTracking: false,
      inventory: 0,
      sold: 0,
      remaining: null,
      hasOverride: false,
      shippingPreset: 'ticket'
    }, {
      productId: 'ticket-1',
      variantId: '',
      sku: 'ticket-1',
      label: 'DUST WAVE Event Ticket',
      fulfillmentType: 'ticket',
      priceCents: 1200,
      priceMinCents: 1200,
      priceMaxCents: 2000,
      status: 'active',
      public: false,
      launchTest: true,
      image: '/assets/images/dancewave.png',
      inventoryTracking: true,
      configuredInventory: 0,
      inventory: 0,
      remaining: 0,
      hasOverride: false,
      variantCount: 2,
      shippingPreset: 'ticket'
    }, {
      productId: RSVP_ITEM_ID,
      variantId: '',
      sku: RSVP_ITEM_ID,
      label: 'DUST WAVE Free RSVP',
      fulfillmentType: 'rsvp',
      priceCents: 0,
      status: 'active',
      public: false,
      launchTest: true,
      image: '/assets/images/calendar-2026.png',
      inventoryTracking: true,
      configuredInventory: 0,
      inventory: 0,
      remaining: 0,
      hasOverride: false,
      shippingPreset: 'ticket'
    }],
    products: [{
      productId: 'fronteras-poster-big',
      name: 'Fronteras Poster (Big)',
      description: '18" X 24" super heavyweight matte poster. Butterflies are cool.',
      longContent: [{
        type: 'text',
        body: '18" X 24" super heavyweight matte poster. Butterflies are cool.',
        align: 'left'
      }],
      slug: 'fronteras-poster-big',
      sourcePath: '_products/fronteras-poster-big.md',
      priceCents: 3500,
      status: 'active',
      fulfillmentType: 'physical',
      image: '/assets/images/fronteras-poster.png',
      shippingPreset: 'poster',
      inventoryTracking: true,
      inventory: 12,
      variants: []
    }, {
      productId: DIGITAL_ITEM_ID,
      name: 'DUST WAVE Digital Download',
      description: 'A starter digital-download product for Store post-payment signed-link flow.',
      longContent: [],
      slug: 'dust-wave-digital-download',
      sourcePath: '_products/dust-wave-digital-download.md',
      priceCents: 500,
      status: 'active',
      public: false,
      launchTest: true,
      fulfillmentType: 'digital',
      image: '/assets/images/default.png',
      shippingPreset: 'ticket',
      inventoryTracking: false,
      inventory: 0,
      variants: []
    }, {
      productId: 'ticket-1',
      name: 'DUST WAVE Event Ticket',
      description: 'A starter paid ticket product.',
      longContent: [],
      slug: 'dust-wave-event-ticket',
      sourcePath: '_products/dust-wave-event-ticket.md',
      priceCents: 1200,
      status: 'active',
      public: false,
      launchTest: true,
      fulfillmentType: 'ticket',
      image: '/assets/images/dancewave.png',
      shippingPreset: 'ticket',
      inventoryTracking: true,
      inventory: 0,
      variantOptionName: 'Ticket Type',
      variants: [{
        id: 'general',
        label: 'General Admission',
        sku: 'ticket-1-general',
        priceCents: 1200,
        inventory: 0,
        status: 'active'
      }, {
        id: 'supporter',
        label: 'Supporter Ticket',
        sku: 'ticket-1-supporter',
        priceCents: 2000,
        inventory: 0,
        status: 'active'
      }]
    }, {
      productId: RSVP_ITEM_ID,
      name: 'DUST WAVE Free RSVP',
      description: "A starter free RSVP product for Store's no-payment, Turnstile-protected ticket flow.",
      longContent: [],
      slug: 'dust-wave-free-rsvp',
      sourcePath: '_products/dust-wave-free-rsvp.md',
      priceCents: 0,
      status: 'active',
      public: false,
      launchTest: true,
      fulfillmentType: 'rsvp',
      image: '/assets/images/calendar-2026.png',
      shippingPreset: 'ticket',
      inventoryTracking: true,
      inventory: 0,
      variants: []
    }],
    writeBudget: { readOnly: true, kvWritesExpected: 0 }
  };
}

function storeDownloadsPayload() {
  return {
    scope: 'store',
    bucketConfigured: true,
    totals: { count: 1, ready: 1, missing: 0 },
    rows: [{
      productId: DIGITAL_ITEM_ID,
      variantId: '',
      sku: DIGITAL_ITEM_ID,
      label: 'Fronteras Download',
      fileKey: DIGITAL_ITEM_ID,
      filename: 'fronteras-download.pdf',
      source: 'product',
      status: 'ready',
      ready: true,
      size: 2048,
      uploadedAt: '2026-06-10T12:00:00.000Z'
    }],
    writeBudget: { readOnly: true, kvWritesExpected: 0 }
  };
}

async function selectSettingsSection(page: any, name: string) {
  const tab = page.locator('#admin-settings-section-tabs button').filter({ hasText: name }).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
  } else {
    await page.locator('#admin-settings-section-tabs + .admin-mobile-tab-select select').selectOption({ label: name });
  }
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function selectAdminSection(page: any, name: string) {
  const tab = page.locator('[data-admin-tabs] > .admin-tabs__list button').filter({ hasText: name }).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
  } else {
    await page.locator('[data-admin-tabs] > .admin-mobile-tab-select select').selectOption({ label: name });
  }
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

test.describe('Admin Dashboard', () => {
  test('covers Store admin login, settings, readiness, plan usage, analytics, marketing, orders, products, downloads, and inventory', async ({ page }) => {
    const calls = await routeAdminWorker(page);
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto('/admin/');
    await expect(page.locator('#admin-auth-panel')).toBeVisible();
    await page.locator('#admin-email').fill(SUPER_ADMIN_EMAIL);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    await expect.poll(() => calls.authStart.length).toBe(1);
    expect(calls.authStart[0]).toMatchObject({ email: SUPER_ADMIN_EMAIL, preferredLang: 'en' });
    await expect(page.locator('#admin-auth-status')).toContainText('Local login link ready.');
    await expect(page.locator('#admin-auth-status a')).toHaveAttribute('href', `${SITE_BASE}/admin/?admin_login=test-token`);

    await page.locator('#admin-auth-status a').click();
    await expect.poll(() => calls.authExchange.length).toBe(1);
    await expect(page.locator('#admin-app')).toBeVisible();
    await expect(page.getByText(`Signed in as ${SUPER_ADMIN_EMAIL}`)).toBeVisible();
	    await expect(page.locator('[data-admin-tabs] > .admin-tabs__list').getByRole('tab')).toHaveText([
	      'Settings',
	      'Analytics',
	      'Marketing',
	      'Orders',
	      'Products',
	      'Downloads'
	    ]);
	    await expect.poll(() => calls.summary.length).toBeGreaterThan(0);
	    await expect.poll(() => calls.settings.length).toBeGreaterThan(0);
	    await expect(page.locator('#admin-settings-section-tabs [data-settings-section-label="Marketing"]')).toHaveCount(0);
	    await expect(page.locator('#admin-settings-section-tabs [data-settings-section-label="Analytics"]')).toHaveCount(0);
	    await expect(page.getByRole('button', { name: 'About Dashboard' })).toHaveCount(0);
	    await expect(page.locator('#admin-overview-title')).toHaveCSS('font-family', /gambado-sans/);

	    await selectSettingsSection(page, 'Platform');
	    await expect(page.locator('[data-settings-section-panel="Platform"] .admin-settings__section-title')).toHaveCount(0);
	    await expect(page.getByRole('button', { name: 'About Platform' })).toHaveCount(0);
	    await expect(page.getByRole('button', { name: 'About Site title' })).toBeVisible();
	    await expect(page.getByRole('button', { name: 'About Name' })).toBeVisible();
		    await expect(page.locator('[data-settings-path="title"]')).toHaveValue('Shop');
	    await expect(page.locator('[data-settings-path="platform.name"]')).toHaveValue('Shop');
	    await expect(page.locator('[data-settings-path="platform.company_name"]')).toHaveValue('Dust Wave');
	    await expect(page.locator('[data-settings-path="add_ons.enabled"]')).toHaveValue('true');
	    await expect(page.locator('[data-settings-path="add_ons.product_count"]')).toHaveValue('3');

    await selectSettingsSection(page, 'Brand & SEO');
    const brandPanel = page.locator('[data-settings-section-panel="Brand & SEO"]');
    await expect(brandPanel.locator('.admin-settings__field-grid')).toHaveCount(1);
    await expect(brandPanel.locator('.admin-settings__field-grid .admin-settings__field-grid-item')).toHaveCount(2);
    await expect(brandPanel.locator('.admin-settings__image-preview img')).toHaveCount(2);
    const logoRow = page.locator('[data-settings-row-label="Logo"]');
    await expect(page.locator('[data-settings-path="platform.logo_path"]')).toHaveValue('/assets/images/logo.svg');
    await expect(page.locator('[data-settings-path="platform.logo_path"]')).toBeHidden();
    await expect(logoRow.locator('input[type="text"]')).toHaveCount(0);
    await expect(logoRow.locator('.admin-settings__image-preview img')).toHaveAttribute('src', /\/assets\/images\/logo\.svg$/);
    await logoRow.locator('[data-logo-upload-input]').setInputFiles({
      name: 'logo-e2e.png',
      mimeType: 'image/png',
      buffer: Buffer.from('store logo e2e')
    });
    await expect.poll(() => calls.logoUploads.length).toBe(1);
    expect(calls.logoUploads[0]).toMatchObject({
      filename: 'logo-e2e.png',
      contentType: 'image/png',
      kind: 'logo',
      fieldPath: 'platform.logo_path'
    });
    await expect(page.locator('[data-settings-path="platform.logo_path"]')).toHaveValue('/assets/images/defaults/logo-e2e.png');
    await expect(logoRow.locator('.admin-settings__image-preview img')).toHaveAttribute('src', /logo-e2e\.png$/);
    await expect(page.locator('#admin-settings-publish')).toBeEnabled();
    await page.locator('#admin-settings-publish').click();
    await expect.poll(() => calls.settingsPublish.length).toBe(1);
    expect(calls.settingsPublish[0].changes).toContainEqual({
      path: 'platform.logo_path',
      value: '/assets/images/defaults/logo-e2e.png'
    });

    await selectSettingsSection(page, 'Canonical URLs');
    await expect(page.locator('#admin-settings-publish')).toBeVisible();
    const settingsHeaderHeight = await page.locator('#admin-panel-settings .admin-settings__header').evaluate((element: HTMLElement) => element.getBoundingClientRect().height);
    await expect(page.getByRole('button', { name: 'About Production Worker URL' })).toBeVisible();
    await expect(page.locator('label .admin-settings__help-button')).toHaveCount(0);
    await expect(page.locator('[data-settings-path="platform.site_url"]')).toHaveValue('https://shop.dustwave.xyz');
    await expect(page.locator('[data-settings-path="platform.worker_url"]')).toHaveValue('https://checkout.dustwave.xyz');
    await expect(page.locator('[data-settings-path="platform.worker_url"]')).toHaveAttribute('aria-describedby', /admin-setting-help-/);

    await selectSettingsSection(page, 'Runtime diagnostics');
    await expect(page.locator('#admin-settings-publish')).toBeHidden();
    await expect(page.locator('#admin-panel-settings .admin-settings__header')).toHaveJSProperty('offsetHeight', Math.round(settingsHeaderHeight));
    await expect(page.locator('#admin-settings-results')).toContainText('Current site base');
	    await expect(page.locator('#admin-settings-results')).toContainText(SITE_BASE);

	    await selectSettingsSection(page, 'Store readiness');
	    await expect(page.locator('[data-settings-section-panel="Store readiness"] .admin-settings__section-title')).toHaveCount(0);
	    await expect(page.getByRole('button', { name: 'About Store readiness' })).toHaveCount(0);
	    await expect.poll(() => calls.storeHealth.length).toBe(1);
    await expect(page.locator('[data-store-readiness-summary]')).toContainText('Overall');
    await expect(page.locator('[data-store-readiness-summary]')).toContainText('Watch');
    await expect(page.locator('[data-store-readiness-results]')).toContainText('Catalog snapshot');
    await expect(page.locator('[data-store-readiness-results]')).toContainText('Download readiness');
    await expect(page.locator('[data-store-readiness-results]')).toContainText('Webhook activity');
    await expect(page.locator('[data-store-readiness-results]')).toContainText('Stripe webhook secret');
    await page.getByRole('button', { name: 'Export audit' }).click();
    await expect.poll(() => calls.auditCsv.length).toBe(1);
    await expect(page.locator('[data-store-readiness-status]')).toContainText('Audit CSV download started.');
    await page.getByRole('button', { name: 'Export reconciliation' }).click();
    await expect.poll(() => calls.storeReconciliationCsv.length).toBe(1);
    await expect(page.locator('[data-store-readiness-status]')).toContainText('Reconciliation CSV download started.');

	    await selectSettingsSection(page, 'Plan usage');
	    await expect(page.locator('[data-settings-section-panel="Plan usage"] .admin-settings__section-title')).toHaveCount(0);
	    await expect(page.getByRole('button', { name: 'About Plan usage' })).toHaveCount(0);
	    await expect.poll(() => calls.planUsage.length).toBe(1);
    await expect(page.locator('[data-plan-usage-results]')).toContainText('Cloudflare');
    await expect(page.getByRole('button', { name: 'About Cloudflare' })).toBeVisible();
    await expect(page.locator('[data-plan-usage-results]')).toContainText('Workers requests');
    await expect(page.locator('[data-plan-usage-results]')).toContainText('Resend');
    await expect(page.getByRole('button', { name: 'About Resend' })).toBeVisible();
    await expect(page.locator('[data-plan-usage-results]')).toContainText('Monthly emails');
    await expect(page.locator('[data-plan-usage-results]')).toContainText('Manage plan');

    await selectAdminSection(page, 'Analytics');
    await expect(page.locator('#admin-store-analytics-load')).toHaveCount(0);
    await expect.poll(() => calls.storeAnalytics.length).toBe(1);
    await expect(page.locator('#admin-store-analytics-results')).toContainText('Revenue');
    await expect(page.locator('#admin-store-analytics-results')).toContainText('$17');
    await expect(page.locator('#admin-store-analytics-results')).toContainText('Fronteras Screening');
    await expect(page.locator('#admin-store-analytics-results')).toContainText('Referral codes');
    await expect(page.locator('#admin-store-analytics-results')).toContainText('Flyer Crew (flyer-crew)');
    await expect(page.getByRole('button', { name: 'About Fulfillment' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'About Top products' })).toBeVisible();
    const topProductsHeadingStyle = await page.locator('.admin-store-analytics__table-actions .admin-report-heading').filter({ hasText: 'Top products' }).first().evaluate((element: HTMLElement) => {
      const style = getComputedStyle(element);
      return {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
        textTransform: style.textTransform
      };
    });
    await page.locator('#admin-store-analytics-results').getByRole('button', { name: 'Export CSV' }).click();
    await expect(page.locator('#admin-store-analytics-status')).toContainText('Analytics CSV download started.');

    await selectAdminSection(page, 'Marketing');
    await expect.poll(() => calls.storeMarketingReferrals.length).toBeGreaterThan(0);
    await expect.poll(() => calls.storeMarketingAbandonedHealth.length).toBeGreaterThan(0);
    await expect(page.locator('#admin-store-marketing-defaults')).toHaveCount(0);
    await expect(page.locator('#admin-store-marketing-snippets')).toHaveCount(0);
    await expect(page.locator('#admin-store-marketing-load-draft')).toHaveCount(0);
    await expect(page.locator('#admin-store-marketing-save-draft')).toHaveCount(0);
    await expect(page.locator('#admin-store-marketing-clear-draft')).toHaveCount(0);
    await expect(page.locator('#admin-store-marketing-path')).toHaveAttribute('placeholder', '/');
    await expect(page.locator('#admin-store-marketing-source')).toHaveAttribute('placeholder', 'dustwave');
    await expect(page.locator('#admin-store-marketing-medium')).toHaveAttribute('placeholder', 'social');
    await expect(page.locator('#admin-store-marketing-campaign')).toHaveAttribute('placeholder', 'shop');
    await expect(page.locator('#admin-store-marketing-source')).toHaveValue('');
    await expect(page.locator('#admin-store-marketing-url')).not.toHaveValue(/utm_source=dustwave/);
    await expect(page.locator('#admin-store-marketing-url')).not.toHaveValue(/utm_medium=social/);
    await expect(page.locator('#admin-store-marketing-url')).not.toHaveValue(/utm_campaign=shop/);
    await expect(page.locator('#admin-store-marketing-qr-preview canvas')).toBeVisible();
    await expect(page.locator('#admin-store-marketing-referrals')).toContainText('Flyer Crew');
    await expect(page.getByRole('button', { name: 'About QR code' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'About Saved referrals' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'About Abandoned-checkout reminders' })).toBeVisible();
    await expect(page.locator('#admin-store-marketing-abandoned-health')).toContainText('Queued');
    await expect(page.locator('#admin-store-marketing-abandoned-health')).toContainText('Reminder suppression');
    await expect(page.locator('#admin-store-marketing-abandoned-health')).toContainText('buyer@example.com');
    await page.locator('#admin-store-abandoned-suppression-email').fill('second@example.com, third@example.com,');
    await expect(page.locator('#admin-store-marketing-abandoned-health .admin-settings__email-token')).toHaveText([
      'second@example.comx',
      'third@example.comx'
    ]);
    await page.locator('#admin-store-marketing-abandoned-health').getByRole('button', { name: 'Suppress', exact: true }).click();
    await expect.poll(() => calls.storeMarketingAbandonedSuppression.length).toBe(2);
    expect(calls.storeMarketingAbandonedSuppression[0]).toMatchObject({
      method: 'POST',
      body: { email: 'second@example.com' }
    });
    expect(calls.storeMarketingAbandonedSuppression[1]).toMatchObject({
      method: 'POST',
      body: { email: 'third@example.com' }
    });
    const savedReferralsHeadingStyle = await page.locator('#admin-store-marketing-referrals .admin-report-heading').filter({ hasText: 'Saved referrals' }).first().evaluate((element: HTMLElement) => {
      const style = getComputedStyle(element);
      return {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
        textTransform: style.textTransform
      };
    });
    expect(savedReferralsHeadingStyle).toEqual(topProductsHeadingStyle);
    await page.locator('#admin-store-marketing-referrer').fill('Flyer Crew');
    await expect(page.locator('#admin-store-marketing-ref')).toHaveValue('flyer-crew');
    await expect(page.locator('#admin-store-marketing-url')).toHaveValue(/ref=flyer-crew/);
    await page.locator('#admin-store-marketing-save-referral').click();
    await expect(page.locator('#admin-store-marketing-status')).toContainText('Referral saved.');
    await page.locator('#admin-store-marketing-reset').click();
    await expect(page.locator('#admin-store-marketing-ref')).toHaveValue('');
    await expect(page.locator('#admin-store-marketing-source')).toHaveValue('');

    await selectAdminSection(page, 'Settings');
    await selectSettingsSection(page, 'Tax');
    await expect(page.locator('[data-settings-path="tax.provider"]')).toHaveValue('nm_grt');
    await expect(page.locator('[data-settings-path="tax.provider"] option')).toHaveText(['Flat rate', 'Offline rules', 'New Mexico GRT', 'ZIP.TAX']);
    await expect(page.locator('[data-settings-row-label="New Mexico GRT API base"]')).toBeVisible();
    await expect(page.locator('[data-settings-row-label="ZIP.TAX API base"]')).toBeHidden();
    await page.locator('[data-settings-path="tax.provider"]').selectOption('zip_tax');
    await expect(page.locator('[data-settings-row-label="New Mexico GRT API base"]')).toBeHidden();
    await expect(page.locator('[data-settings-row-label="ZIP.TAX API base"]')).toBeVisible();

    await selectSettingsSection(page, 'Pricing');
    await expect(page.locator('[data-settings-path="pricing.sales_tax_rate"]')).toHaveValue('7.625');

    await selectSettingsSection(page, 'Shipping');
    await expect(page.locator('[data-settings-path="shipping.origin_country"]')).toHaveValue('US');
    await expect(page.locator('[data-settings-row-label="USPS client ID"]')).toBeVisible();
    await expect(page.locator('[data-settings-row-label="USPS API base"]')).toBeVisible();
    await expect(page.locator('[data-settings-path="shipping.usps.api_base"]')).toHaveValue('');
    await expect(page.locator('[data-settings-path="shipping.usps.api_base"]')).toHaveAttribute('placeholder', 'Default: https://apis.usps.com');
    await page.locator('[data-settings-path="shipping.usps.enabled"]').selectOption('false');
    await expect(page.locator('[data-settings-row-label="USPS API base"]')).toBeHidden();

    await selectSettingsSection(page, 'Design');
    const designPanel = page.locator('[data-settings-section-panel="Design"]');
    await expect(page.locator('[data-settings-path="design.layout_max_width"]')).toHaveValue('1000px');
    await expect(designPanel.locator('.admin-settings__field-grid')).toHaveCount(2);
    await expect(designPanel.locator('.admin-settings__field-grid .admin-settings__field-grid-item')).toHaveCount(7);
    const overlappingColorFields = await designPanel.locator('.admin-settings__color-field').evaluateAll((fields) => {
      return fields.map((field) => {
        const row = field as HTMLElement;
        const picker = row.querySelector('input[type="color"]') as HTMLElement | null;
        const text = row.querySelector('input[type="text"]') as HTMLInputElement | null;
        if (!picker || !text) return null;
        const rowRect = row.getBoundingClientRect();
        const pickerRect = picker.getBoundingClientRect();
        const textRect = text.getBoundingClientRect();
        const tolerance = 1;
        const overlaps = pickerRect.right > textRect.left - tolerance;
        const overflows = textRect.right > rowRect.right + tolerance || row.scrollWidth > row.clientWidth + tolerance;
        return overlaps || overflows ? text.dataset.settingsPath || text.value : null;
      }).filter(Boolean);
    });
    expect(overlappingColorFields).toEqual([]);
    const textColorRow = page.locator('[data-settings-row-label="Text Color"]');
    await expect(textColorRow.locator('input[type="color"]')).toHaveValue('#252930');
    await expect(page.locator('[data-settings-path="design.color_text"]')).toHaveValue('#252930');
    await textColorRow.locator('input[type="color"]').fill('#123456');
    await expect(page.locator('[data-settings-path="design.color_text"]')).toHaveValue('#123456');

    await selectSettingsSection(page, 'Advanced performance');
    await expect(page.locator('[data-settings-path="performance.intent_prefetch_enabled"]')).toHaveValue('true');
    await expect(page.locator('[data-settings-path="performance.intent_prefetch_delay_ms"]')).toHaveValue('90');
    await expect(page.locator('[data-settings-path="performance.intent_prefetch_limit"]')).toHaveValue('3');

    await selectSettingsSection(page, 'Users');
    const adminUsersEditor = page.locator('[data-settings-path="admin.users"]');
    await expect(adminUsersEditor).toBeVisible();
    await expect(adminUsersEditor.locator('[data-admin-user-card]')).toHaveCount(3);
    const selfAdminUser = adminUsersEditor.locator('[data-admin-user-card]').first();
    await expect(selfAdminUser.locator('[data-admin-user-field="email"]')).toHaveValue(SUPER_ADMIN_EMAIL);
    await expect(selfAdminUser.locator('[data-admin-user-field="email"]')).toHaveAttribute('readonly', '');
    await expect(selfAdminUser.locator('[data-admin-user-field="role"]')).toBeDisabled();
    await expect(selfAdminUser.getByRole('button', { name: new RegExp(`Delete admin user ${SUPER_ADMIN_EMAIL}`) })).toBeDisabled();
    const otherAdminUser = adminUsersEditor.locator('[data-admin-user-card]').nth(1);
    await otherAdminUser.locator('[data-admin-user-field="role"]').selectOption('limited_admin');
    await otherAdminUser.locator('[data-admin-user-access-scope="store"]').check();
    await adminUsersEditor.getByRole('button', { name: 'Add user' }).click();
    const newAdminUser = adminUsersEditor.locator('[data-admin-user-card]').first();
    await newAdminUser.locator('[data-admin-user-field="name"]').fill('Store Editor');
    await newAdminUser.locator('[data-admin-user-field="email"]').fill(NEW_ADMIN_EMAIL);
    await newAdminUser.locator('[data-admin-user-field="role"]').selectOption('limited_admin');
    await newAdminUser.locator('[data-admin-user-access-scope="store"]').check();
    await adminUsersEditor.getByRole('button', { name: 'Save users' }).click();
    await expect.poll(() => calls.adminUsersSave.length).toBe(1);
    expect(calls.adminUsersSave[0].users[0]).toMatchObject({
      name: 'Store Editor',
      email: NEW_ADMIN_EMAIL,
      role: 'limited_admin',
      accessScopes: ['store']
    });
    await expect(adminUsersEditor.locator('[data-admin-users-status]')).toContainText('Users saved');
    await expectNoAxeViolations(page);

    await selectSettingsSection(page, 'Secrets & credentials');
    const secretsPanel = page.locator('[data-settings-section-panel="Secrets & credentials"]');
    const secretsGrid = secretsPanel.locator('.admin-settings__field-grid');
    await expect(secretsGrid).toHaveCount(1);
    await expect(secretsGrid.locator('.admin-settings__field-grid-item')).toHaveCount(3);
    const secretsGridColumns = await secretsGrid.evaluate((grid: HTMLElement) => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    expect(secretsGridColumns).toBe(2);
    await expect(page.locator('#admin-settings-publish')).toBeHidden();
    await selectSettingsSection(page, 'Platform');
    await expect(page.locator('#admin-settings-publish')).toBeVisible();

    await selectAdminSection(page, 'Orders');
    await expect(page.locator('#admin-panel-store-orders')).toBeVisible();
    await expect.poll(() => calls.storeOrders.length).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#admin-store-orders-results')).toContainText(TICKET_ORDER_TOKEN);
    await expect(page.locator('#admin-store-orders-results')).toContainText('Fronteras Download');
    await expect(page.locator('#admin-store-orders-summary')).toContainText('Checked in');
    await expect(page.locator('#admin-store-orders-attendance')).toContainText('Attendance');
    await expect(page.getByRole('button', { name: 'About Attendance' })).toBeVisible();
    await expect(page.locator('#admin-store-orders-attendance')).toContainText('Guild Cinema');
    await page.locator('#admin-store-orders-results').getByRole('button', { name: 'Check in' }).click();
    await expect.poll(() => calls.storeOrderCheckIns.length).toBe(1);
    expect(calls.storeOrderCheckIns[0]).toMatchObject({
      orderToken: TICKET_ORDER_TOKEN,
      itemId: TICKET_ITEM_ID,
      checkedIn: true,
      quantity: 1
    });
    await expect(page.locator('#admin-store-orders-status')).toContainText('Check-in saved.');
    const digitalRow = page.locator('#admin-store-orders-results tbody tr').filter({ hasText: 'Fronteras Download' });
    await expect(digitalRow).toContainText('Expires');
    await digitalRow.getByRole('button', { name: 'Reissue 72h' }).click();
    await expect.poll(() => calls.storeOrderDownloadAccesses.length).toBe(1);
    expect(calls.storeOrderDownloadAccesses[0]).toMatchObject({
      orderToken: DIGITAL_ORDER_TOKEN,
      itemId: DIGITAL_ITEM_ID,
      action: 'reissue',
      expiresHours: 72
    });
    await expect(page.locator('#admin-store-orders-status')).toContainText('Download access reissued.');
    await digitalRow.getByRole('button', { name: 'Expire now' }).click();
    await expect.poll(() => calls.storeOrderDownloadAccesses.length).toBe(2);
    expect(calls.storeOrderDownloadAccesses[1]).toMatchObject({
      orderToken: DIGITAL_ORDER_TOKEN,
      itemId: DIGITAL_ITEM_ID,
      action: 'expire'
    });
    await expect(page.locator('#admin-store-orders-status')).toContainText('Download access expired.');
    await page.locator('#admin-store-order-query').fill(TICKET_BUYER_NAME);
    await expect.poll(() => calls.storeOrders.some((call) => call.q === TICKET_BUYER_NAME)).toBe(true);
    await page.locator('#admin-store-attendees-export').click();
    await expect.poll(() => calls.storeAttendeeCsv.length).toBe(1);
    expect(calls.storeAttendeeCsv[0]).toMatchObject({ q: TICKET_BUYER_NAME });
    await expect(page.locator('#admin-store-orders-status')).toContainText('Attendee CSV download started.');
    await page.locator('#admin-store-orders-export').click();
    await expect.poll(() => calls.storeOrderCsv.length).toBe(1);
    await expect(page.locator('#admin-store-orders-status')).toContainText('Order CSV download started.');

    await selectAdminSection(page, 'Products');
    await expect(page.locator('#admin-store-products-load')).toHaveCount(0);
    await expect.poll(() => calls.storeProducts.length).toBe(1);
    const productsResults = page.locator('#admin-store-products-results');
    await expect(productsResults).toContainText('Fronteras Poster (Big)');
    await expect(productsResults).toContainText('DUST WAVE Digital Download');
    await expect(productsResults).toContainText('DUST WAVE Event Ticket');
    await expect(productsResults).toContainText('DUST WAVE Free RSVP');
    await expect(page.locator('#admin-store-products-summary .admin-store-products__card')).toHaveCount(3);
    await expect(page.locator('#admin-store-products-summary')).not.toContainText('Rows');
    await expect(productsResults.getByText('Set status', { exact: true })).toHaveCount(0);
    await expect(productsResults.getByRole('button', { name: 'Clear' })).toHaveCount(0);
    await expect(productsResults.getByLabel('Bulk product status')).toBeVisible();
    const productListRows = productsResults.locator('tbody > tr:not(.admin-store-products__editor-row)');
    const posterRow = productListRows.filter({ hasText: 'Fronteras Poster (Big)' });
    const digitalProductRow = productListRows.filter({ hasText: 'DUST WAVE Digital Download' });
    const ticketProductRow = productListRows.filter({ hasText: 'DUST WAVE Event Ticket' });
    const rsvpProductRow = productListRows.filter({ hasText: 'DUST WAVE Free RSVP' });
    await expect(ticketProductRow).toHaveCount(1);
    await expect(ticketProductRow).toContainText('2 variants');
    await expect(ticketProductRow).toContainText('$12-$20');
    await expect(ticketProductRow.locator('[data-store-product-inventory-controls]')).toHaveCount(0);
    await expect(ticketProductRow).toContainText('Edit variants to manage inventory.');
    await expect(posterRow.locator('.admin-store-products__thumb img')).toHaveAttribute('src', /fronteras-poster\.png$/);
    await expect(rsvpProductRow.locator('.admin-store-products__thumb img')).toHaveAttribute('src', /calendar-2026\.png$/);
    await expect(digitalProductRow.locator('.admin-store-products__status')).toContainText('Test fixture');
    await expect(digitalProductRow.locator('.admin-store-products__status')).toContainText('not public');
    await expect(productsResults.getByRole('button', { name: 'Restock', exact: true })).toHaveCount(0);
    await page.evaluate(() => {
      const original = Element.prototype.scrollIntoView;
      (window as any).__storeProductOriginalScrollIntoView = original;
      (window as any).__storeProductScrollCalls = [];
      Element.prototype.scrollIntoView = function(options?: boolean | ScrollIntoViewOptions) {
        const normalized = typeof options === 'object' && options ? options : {};
        (window as any).__storeProductScrollCalls.push({
          editor: (this as HTMLElement).dataset.storeProductEditor || '',
          block: (normalized as ScrollIntoViewOptions).block || '',
          inline: (normalized as ScrollIntoViewOptions).inline || '',
          behavior: (normalized as ScrollIntoViewOptions).behavior || ''
        });
      };
    });
    await digitalProductRow.getByRole('button', { name: 'Edit' }).click();
    const digitalEditor = page.locator(`[data-store-product-editor="${DIGITAL_ITEM_ID}"]`);
    await expect(digitalEditor).toBeVisible();
    await expect(digitalEditor.locator('[data-store-product-variants]')).toBeHidden();
    await expect.poll(async () => page.evaluate((productId) => {
      return ((window as any).__storeProductScrollCalls || []).some((call: { editor: string; block: string }) => {
        return call.editor === productId && call.block === 'start';
      });
    }, DIGITAL_ITEM_ID)).toBe(true);
    await page.evaluate(() => {
      if ((window as any).__storeProductOriginalScrollIntoView) {
        Element.prototype.scrollIntoView = (window as any).__storeProductOriginalScrollIntoView;
      }
    });
    await expect(productsResults.locator('.admin-store-products__editor-row')).toHaveAttribute('data-store-product-editor-row', DIGITAL_ITEM_ID);
    expect(await productsResults.evaluate(() => {
      return Array.from(document.querySelectorAll('#admin-store-products-results tbody > tr')).map((row) => {
        if (row.classList.contains('admin-store-products__editor-row')) {
          return `editor:${row.getAttribute('data-store-product-editor-row') || ''}`;
        }
        const editButton = row.querySelector('[data-store-product-edit]');
        return `product:${editButton ? editButton.getAttribute('data-store-product-edit') || '' : ''}`;
      });
    })).toEqual([
      'product:fronteras-poster-big',
      `product:${DIGITAL_ITEM_ID}`,
      `editor:${DIGITAL_ITEM_ID}`,
      'product:ticket-1',
      `product:${RSVP_ITEM_ID}`
    ]);
    await digitalEditor.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('[data-store-product-editor]')).toHaveCount(0);
    await rsvpProductRow.getByRole('button', { name: 'Edit' }).click();
    const rsvpEditor = page.locator(`[data-store-product-editor="${RSVP_ITEM_ID}"]`);
    await expect(rsvpEditor).toBeVisible();
    await expect(rsvpEditor.locator('[data-store-product-field="image"]')).toHaveValue('/assets/images/calendar-2026.png');
    await expect(rsvpEditor.locator('.admin-store-products__image-preview img')).toHaveAttribute('src', /calendar-2026\.png$/);
    await expect.poll(async () => rsvpEditor.frameLocator('[data-store-product-preview-frame]').locator('img').evaluate((image: HTMLImageElement) => image.src)).toBe(`${SITE_BASE}/assets/images/calendar-2026.png`);
    await expect.poll(async () => rsvpEditor.frameLocator('[data-store-product-preview-frame]').locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await rsvpEditor.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('[data-store-product-editor]')).toHaveCount(0);
    await ticketProductRow.getByRole('button', { name: 'Edit' }).click();
    const ticketEditor = page.locator('[data-store-product-editor="ticket-1"]');
    await expect(ticketEditor).toBeVisible();
    await expect(productsResults.locator('.admin-store-products__editor-row')).toHaveAttribute('data-store-product-editor-row', 'ticket-1');
    await expect(ticketEditor.locator('[data-store-product-variants]')).toBeVisible();
    await expect(ticketEditor.locator('[data-store-product-variant]')).toHaveCount(2);
    await expect(ticketEditor.locator('[data-store-product-variant="general-admission"] [data-store-variant-field="label"]')).toHaveValue('General Admission');
    await expect(ticketEditor.locator('[data-store-product-variant="supporter-ticket"] [data-store-variant-field="price"]')).toHaveValue('20');
    await expect(ticketEditor.locator('[data-store-product-variants-enabled]')).toHaveValue('true');
    await expect(ticketEditor.getByRole('button', { name: 'Publish product' })).toBeDisabled();
    await ticketEditor.locator('[data-store-product-variants-enabled]').selectOption('false');
    await expect(ticketEditor.locator('[data-store-product-variants]')).toBeHidden();
    await expect(ticketEditor.getByRole('button', { name: 'Publish product' })).toBeEnabled();
    await ticketEditor.locator('[data-store-product-variants-enabled]').selectOption('true');
    await expect(ticketEditor.locator('[data-store-product-variants]')).toBeVisible();
    await expect(ticketEditor.getByRole('button', { name: 'Publish product' })).toBeDisabled();
    await ticketEditor.locator('[data-store-product-variants-enabled]').selectOption('false');
    await expect(ticketEditor.locator('[data-store-product-variants]')).toBeHidden();
    await expect(ticketEditor.getByRole('button', { name: 'Publish product' })).toBeEnabled();
    await ticketEditor.getByRole('button', { name: 'Publish product' }).click();
    await expect.poll(() => calls.storeProductPublishes.length).toBe(1);
    expect(calls.storeProductPublishes[0]).toMatchObject({
      intent: 'publish',
      productId: 'ticket-1',
      variants: []
    });
    await expect(page.locator('#admin-store-products-status')).toContainText('Product published. Deploy started.');
    const productInventoryControls = posterRow.locator('[data-store-product-inventory-controls]');
    await expect(productInventoryControls).toContainText('Current 12');
    await expect(productInventoryControls).toContainText('Remaining 12');
    await productInventoryControls.locator('[data-store-product-inventory-input]').fill('14');
    await productInventoryControls.getByRole('button', { name: 'Set', exact: true }).click();
    await expect.poll(() => calls.storeInventoryWrites.length).toBe(1);
    expect(calls.storeInventoryWrites[0]).toMatchObject({
      action: 'set',
      productId: 'fronteras-poster-big',
      variantId: '',
      inventory: 14
    });
    await expect(page.locator('#admin-store-products-status')).toContainText('Inventory updated.');
    await posterRow.getByRole('button', { name: 'Edit' }).click();
    const productEditor = page.locator('[data-store-product-editor="fronteras-poster-big"]');
    await expect(productEditor).toBeVisible();
    await expect(productEditor.getByRole('button', { name: 'About Fronteras Poster (Big)' })).toHaveCount(0);
    await expect(productEditor.getByRole('button', { name: 'About Name' })).toHaveCount(0);
    await expect(productEditor.locator('.admin-store-products__field-label').filter({ hasText: 'Price (USD)' })).toBeVisible();
    await expect(productEditor.locator('[data-store-product-field="price"]')).toHaveAttribute('type', 'number');
    await expect(productEditor.getByRole('button', { name: 'About Price (USD)' })).toBeVisible();
    await expect(productEditor.getByRole('button', { name: 'About Shipping preset' })).toBeVisible();
    await expect(productEditor.getByRole('button', { name: 'About Variant Based' })).toBeVisible();
    await expect(productEditor.getByRole('button', { name: 'About Image' })).toBeVisible();
    await expect(productEditor.getByRole('button', { name: 'About Description' })).toBeVisible();
    await expect(productEditor.getByRole('button', { name: 'About Preview' })).toBeVisible();
    await productEditor.locator('[data-store-product-field-wrapper="shippingPreset"] .admin-settings__help-button').hover();
    const shippingPresetTooltipBounds = await productEditor.locator('[data-store-product-field-wrapper="shippingPreset"] .admin-settings__help-tooltip').evaluate((tooltip: HTMLElement) => {
      const rect = tooltip.getBoundingClientRect();
      const styles = getComputedStyle(tooltip);
      return {
        display: styles.display,
        left: Math.floor(rect.left),
        right: Math.ceil(rect.right),
        viewport: window.innerWidth,
        whiteSpace: styles.whiteSpace,
        width: Math.round(rect.width)
      };
    });
    expect(shippingPresetTooltipBounds.display).toBe('block');
    expect(shippingPresetTooltipBounds.left).toBeGreaterThanOrEqual(0);
    expect(shippingPresetTooltipBounds.right).toBeLessThanOrEqual(shippingPresetTooltipBounds.viewport);
    expect(shippingPresetTooltipBounds.whiteSpace).toBe('normal');
    expect(shippingPresetTooltipBounds.width).toBeLessThanOrEqual(360);
    await productEditor.locator('[data-store-product-field-wrapper="fulfillmentType"] .admin-settings__help-button').hover();
    expect(await productEditor.locator('[data-store-product-field-wrapper="fulfillmentType"] .admin-settings__help-tooltip').evaluate((tooltip: HTMLElement) => {
      const rect = tooltip.getBoundingClientRect();
      return {
        display: getComputedStyle(tooltip).display,
        left: Math.floor(rect.left),
        right: Math.ceil(rect.right),
        width: Math.round(rect.width),
        viewport: window.innerWidth
      };
    })).toMatchObject({
      display: 'block'
    });
    const fulfillmentTooltipBounds = await productEditor.locator('[data-store-product-field-wrapper="fulfillmentType"] .admin-settings__help-tooltip').evaluate((tooltip: HTMLElement) => {
      const rect = tooltip.getBoundingClientRect();
      return {
        left: Math.floor(rect.left),
        right: Math.ceil(rect.right),
        width: Math.round(rect.width),
        viewport: window.innerWidth
      };
    });
    expect(fulfillmentTooltipBounds.left).toBeGreaterThanOrEqual(0);
    expect(fulfillmentTooltipBounds.right).toBeLessThanOrEqual(fulfillmentTooltipBounds.viewport);
    expect(fulfillmentTooltipBounds.width).toBeGreaterThan(120);
    expect(await productEditor.evaluate((editor) => {
      const tracker = editor.querySelector('[data-store-product-field-wrapper="inventoryTracking"] .admin-store-products__field-label');
      const inventory = editor.querySelector('[data-store-product-field-wrapper="inventory"] .admin-store-products__field-label');
      if (!(tracker instanceof HTMLElement) || !(inventory instanceof HTMLElement)) return 0;
      const trackerRect = tracker.getBoundingClientRect();
      const inventoryRect = inventory.getBoundingClientRect();
      return Math.round(inventoryRect.left - trackerRect.right);
    })).toBeGreaterThanOrEqual(8);
    await expect(productEditor.getByRole('button', { name: 'Refresh preview' })).toHaveCount(0);
    await expect(productEditor.locator('[data-store-product-field="image"]')).toHaveValue('/assets/images/fronteras-poster.png');
    const productPublish = productEditor.getByRole('button', { name: 'Publish product' });
    await expect(productPublish).toBeDisabled();
    await productEditor.locator('[data-store-product-field="name"]').fill('Fronteras Poster (Big) Draft');
    await expect(productPublish).toBeEnabled();
    await productEditor.locator('[data-store-product-field="name"]').fill('Fronteras Poster (Big)');
    await expect(productPublish).toBeDisabled();
    const shippingPreset = productEditor.locator('select[data-store-product-field="shippingPreset"]');
    await expect(shippingPreset).toHaveValue('poster');
    await expect(shippingPreset.locator('option')).toHaveText(['None', 'T-shirt', 'Sticker', 'Poster', 'Parcel', 'Mug', 'Ticket / digital']);
    await expect(productEditor.locator('.admin-store-products__image-preview img')).toHaveAttribute('src', /fronteras-poster\.png$/);
    const descriptionEditor = productEditor.locator('[data-store-product-description-editor]');
    await expect(descriptionEditor).toBeVisible();
    await expect(productEditor.locator('[data-store-product-variants]')).toBeHidden();
    await expect(productEditor.locator('.admin-store-products__editor-section--media-description')).toBeVisible();
    await expect(productEditor.locator('.admin-store-products__editor-section--media-description .admin-store-products__field--image')).toBeVisible();
    await expect(productEditor.locator('.admin-store-products__editor-section--media-description [data-store-product-description-editor]')).toBeVisible();
    expect(await productEditor.evaluate((editor) => {
      const media = editor.querySelector('.admin-store-products__editor-section--media-description');
      const image = editor.querySelector('.admin-store-products__field--image');
      const description = editor.querySelector('[data-store-product-description-editor]');
      const variants = editor.querySelector('[data-store-product-variants]');
      const preview = editor.querySelector('.admin-store-products__preview');
      const previewFrame = editor.querySelector('[data-store-product-preview-frame]');
      const follows = (first: Element | null, second: Element | null) => {
        return Boolean(first && second && (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING));
      };
      return {
        mediaHasDescription: Boolean(media && description && media.contains(description)),
        mediaHasImage: Boolean(media && image && media.contains(image)),
        descriptionBeforeVariants: follows(description, variants),
        variantsBeforePreview: follows(variants, preview),
        previewContainsFrame: Boolean(preview && previewFrame && preview.contains(previewFrame))
      };
    })).toEqual({
      mediaHasDescription: true,
      mediaHasImage: true,
      descriptionBeforeVariants: true,
      variantsBeforePreview: true,
      previewContainsFrame: true
    });
    expect(await productEditor.evaluate((editor) => {
      const header = editor.querySelector('.admin-store-products__description-header');
      const description = editor.querySelector('[data-store-product-description-editor]');
      if (!header || !description) return Number.POSITIVE_INFINITY;
      return Math.round(description.getBoundingClientRect().top - header.getBoundingClientRect().bottom);
    })).toBeLessThanOrEqual(12);
    await expect(descriptionEditor).toContainText('Butterflies are cool.');
    await expect(descriptionEditor.locator('.admin-content-block')).toHaveCount(1);
    await expect(descriptionEditor.getByLabel('Block type').first()).toHaveValue('text');
    await descriptionEditor.locator('[contenteditable="true"][data-content-field="body"]').first().click();
    await expect(descriptionEditor.getByRole('button', { name: 'Bold' }).first()).toBeVisible();
    await expect(descriptionEditor.getByRole('button', { name: 'Unordered list' }).first()).toBeVisible();
    await expect(productEditor.locator('[data-store-product-preview-frame]')).toBeVisible();
    await expect.poll(() => calls.storeProductPreviews.length).toBeGreaterThan(0);
    await expect(productEditor.frameLocator('[data-store-product-preview-frame]').locator('img')).toHaveAttribute('src', /fronteras-poster\.png$/);
    await expect.poll(async () => productEditor.frameLocator('[data-store-product-preview-frame]').locator('img').evaluate((image: HTMLImageElement) => image.src)).toBe(`${SITE_BASE}/assets/images/fronteras-poster.png`);
    await expect.poll(async () => productEditor.frameLocator('[data-store-product-preview-frame]').locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(productEditor.frameLocator('[data-store-product-preview-frame]').locator('.storefront--product.admin-store-product-preview')).toBeVisible();
    await expect(productEditor.frameLocator('[data-store-product-preview-frame]').locator('.storefront__product-detail')).toBeVisible();
    await expect(productEditor.frameLocator('[data-store-product-preview-frame]').locator('.store-product-card')).toBeVisible();
    await expect(productEditor.frameLocator('[data-store-product-preview-frame]').locator('.store-product-card__button')).toContainText('Add to cart');
    await expect.poll(async () => productEditor.frameLocator('[data-store-product-preview-frame]').locator('body').evaluate(() => {
      return document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1;
    })).toBe(true);
    await expect.poll(async () => productEditor.frameLocator('[data-store-product-preview-frame]').locator('body').evaluate(() => {
      return getComputedStyle(document.body).overflowY;
    })).toBe('auto');
    expect(await productEditor.locator('[data-store-product-preview-frame]').evaluate((frame: HTMLIFrameElement) => Math.round(frame.getBoundingClientRect().height))).toBeGreaterThanOrEqual(360);
    const fulfillmentSelect = productEditor.locator('select[data-store-product-field="fulfillmentType"]');
    const taxCategory = productEditor.locator('select[data-store-product-field="taxCategory"]');
    await expect(taxCategory).toHaveValue('standard');
    await expect(taxCategory.locator('option')).toHaveText([
      'Standard taxable item',
      'Digital download',
      'Ticket / admission',
      'Tax exempt'
    ]);
    await fulfillmentSelect.selectOption('digital');
    await expect(taxCategory).toHaveValue('digital');
    await expect(shippingPreset).toBeHidden();
    await expect(productEditor.locator('[data-store-product-field="inventoryTracking"]')).toBeHidden();
    await expect(productEditor.locator('[data-store-product-field="inventory"]')).toBeHidden();
    await productEditor.locator('[data-store-product-variants-enabled]').selectOption('true');
    await expect(productEditor.locator('[data-store-product-variants]')).toBeVisible();
    await expect(productEditor.locator('[data-store-variant-field="inventory"]')).toBeHidden();
    await productEditor.locator('[data-store-product-variants-enabled]').selectOption('false');
    await expect(productEditor.locator('[data-store-product-variants]')).toBeHidden();
    await fulfillmentSelect.selectOption('physical');
    await expect(taxCategory).toHaveValue('standard');
    await expect(shippingPreset).toBeVisible();
    await expect(productEditor.locator('[data-store-product-field="inventoryTracking"]')).toBeVisible();
    await expect(productEditor.locator('[data-store-product-field="inventory"]')).toBeVisible();
    await expect(productPublish).toBeDisabled();
    const previewCountBeforeVariantToggles = calls.storeProductPreviews.length;
    await productEditor.locator('[data-store-product-variants-enabled]').selectOption('true');
    await expect(productEditor.locator('[data-store-product-variants]')).toBeVisible();
    await expect(productEditor.locator('[data-store-product-field="inventory"]')).toBeHidden();
    await productEditor.locator('[data-store-product-field="inventoryTracking"]').selectOption('false');
    await expect(productEditor.locator('[data-store-product-field="inventory"]')).toBeHidden();
    await expect(productEditor.locator('[data-store-variant-field="inventory"]')).toBeHidden();
    await productEditor.locator('[data-store-product-field="inventoryTracking"]').selectOption('true');
    await expect(productEditor.locator('[data-store-variant-field="inventory"]')).toBeVisible();
    await productEditor.locator('[data-store-product-variants-enabled]').selectOption('false');
    await expect(productEditor.locator('[data-store-product-variants]')).toBeHidden();
    await expect(productPublish).toBeDisabled();
    await productEditor.locator('[data-store-product-variants-enabled]').selectOption('true');
    await expect(productEditor.locator('[data-store-product-variants]')).toBeVisible();
    await productEditor.locator('[data-store-product-variants-enabled]').selectOption('false');
    await expect(productEditor.locator('[data-store-product-variants]')).toBeHidden();
    await expect.poll(() => calls.storeProductPreviews.length).toBeGreaterThan(previewCountBeforeVariantToggles);
    expect(calls.storeProductPreviews.slice(previewCountBeforeVariantToggles).every((call) => {
      return call.fields?.image === '/assets/images/fronteras-poster.png';
    })).toBe(true);
    await expect.poll(async () => productEditor.frameLocator('[data-store-product-preview-frame]').locator('img').evaluate((image: HTMLImageElement) => image.src)).toBe(`${SITE_BASE}/assets/images/fronteras-poster.png`);
    await expect.poll(async () => productEditor.frameLocator('[data-store-product-preview-frame]').locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await descriptionEditor.locator('[data-content-action="insert-block"]').last().click({ force: true });
    await expect(descriptionEditor.locator('.admin-content-block')).toHaveCount(2);
    await descriptionEditor.getByLabel('Block type').last().selectOption('image');
    const imageBlock = descriptionEditor.locator('.admin-content-block').last();
    await imageBlock.getByRole('button', { name: 'Media settings' }).click();
    await imageBlock.getByRole('button', { name: 'Choose existing image' }).click();
    await expect.poll(() => calls.storeProductMedia.length).toBe(1);
    await productEditor.locator('.admin-store-products__media-item').first().click();
    await expect(descriptionEditor.locator('.content-block--image img')).toHaveAttribute('src', /fronteras-poster\.png$/);
    await expect(productEditor.locator('[data-store-product-field="description"]')).toHaveValue(/!\[Fronteras Poster \(Big\)\]\(\/assets\/images\/fronteras-poster\.png\)/);
    await expect(productEditor.locator('[data-store-product-field="longContent"]')).toHaveValue(/"type":"image"/);
    await productEditor.locator('[data-store-product-image-upload="true"]').setInputFiles({
      name: 'poster-e2e.png',
      mimeType: 'image/png',
      buffer: Buffer.from('poster image e2e')
    });
    await expect.poll(() => calls.imageUploads.length).toBe(1);
    expect(calls.imageUploads[0]).toMatchObject({
      filename: 'poster-e2e.png',
      contentType: 'image/png',
      kind: 'store-product',
      productId: 'fronteras-poster-big'
    });
    await expect(productEditor.locator('[data-store-product-field="image"]')).toHaveValue('/assets/images/products/product-fronteras-poster-big-e2e.png');
    await productEditor.locator('[data-store-product-field="name"]').fill('Fronteras Poster (Big) Updated');
    await productEditor.locator('[data-store-product-field="price"]').fill('36');
    await expect(productEditor.locator('[data-store-product-variants-enabled]')).toHaveValue('false');
    await productEditor.locator('[data-store-product-variants-enabled]').selectOption('true');
    await expect(productEditor.locator('.admin-store-products__variants-table th')).toHaveText([
      'Label',
      'ID',
      'SKU',
      'Price (USD)',
      'Inventory',
      'Status',
      ''
    ]);
    await expect(productEditor.locator('[data-store-product-variant]')).toHaveCount(1);
    const generatedVariant = productEditor.locator('[data-store-product-variant]').first();
    await generatedVariant.locator('[data-store-variant-field="label"]').fill('Standard');
    await expect(generatedVariant.locator('[data-store-variant-field="id"]')).toHaveValue('standard');
    await expect(generatedVariant.locator('[data-store-variant-field="sku"]')).toHaveValue('fronteras-poster-big-standard');
    await generatedVariant.locator('[data-store-variant-field="price"]').fill('36');
    await generatedVariant.locator('[data-store-variant-field="inventory"]').fill('14');
    await productEditor.getByRole('button', { name: 'Add variant' }).click();
    await expect(productEditor.locator('[data-store-product-variant]')).toHaveCount(2);
    const addedVariant = productEditor.locator('[data-store-product-variant]').last();
    await addedVariant.locator('[data-store-variant-field="label"]').fill('Deluxe');
    await expect(addedVariant.locator('[data-store-variant-field="id"]')).toHaveValue('deluxe');
    await expect(addedVariant.locator('[data-store-variant-field="sku"]')).toHaveValue('fronteras-poster-big-deluxe');
    await addedVariant.locator('[data-store-variant-field="price"]').fill('40');
    await addedVariant.locator('[data-store-variant-field="inventory"]').fill('3');
    await generatedVariant.getByRole('button', { name: 'Remove' }).click();
    await expect(productEditor.locator('[data-store-product-variant]')).toHaveCount(1);
    await productEditor.getByRole('button', { name: 'Publish product' }).click();
    await expect.poll(() => calls.storeProductPublishes.length).toBe(2);
    expect(calls.storeProductPublishes[1]).toMatchObject({
      intent: 'publish',
      productId: 'fronteras-poster-big',
      fields: {
        name: 'Fronteras Poster (Big) Updated',
        price: 36
      },
      variants: [{
        id: 'deluxe',
        label: 'Deluxe',
        sku: 'fronteras-poster-big-deluxe',
        price: 40,
        inventory: 3,
        status: 'active'
      }]
    });
    expect(calls.storeProductPublishes[1].fields.longContent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'text',
        body: expect.stringContaining('Butterflies are cool.')
      }),
      expect.objectContaining({
        type: 'image',
        src: '/assets/images/fronteras-poster.png',
        alt: 'Fronteras Poster (Big)'
      })
    ]));
    await expect(page.locator('#admin-store-products-status')).toContainText('Product published. Deploy started.');

    const bulkApply = page.locator('[data-store-products-bulk-apply]');
    const bulkStatus = page.locator('[data-store-products-bulk-status]');
    await expect(bulkApply).toBeDisabled();
    await page.locator('[data-store-product-select="fronteras-poster-big"]').check();
    await expect(bulkApply).toBeDisabled();
    await bulkStatus.selectOption('draft');
    await expect(bulkApply).toBeEnabled();
    await bulkStatus.selectOption('');
    await expect(bulkApply).toBeDisabled();
    await bulkStatus.selectOption('draft');
    await expect(bulkApply).toBeEnabled();
    await bulkApply.click();
    await expect.poll(() => calls.storeProductBulkPublishes.length).toBe(1);
    expect(calls.storeProductBulkPublishes[0]).toMatchObject({
      intent: 'bulk_publish',
      productIds: ['fronteras-poster-big'],
      fields: { status: 'draft' }
    });
    await expect(page.locator('#admin-store-products-status')).toContainText('Bulk product publish committed changes to GitHub and started a deploy.');

    await selectAdminSection(page, 'Downloads');
    await expect(page.locator('#admin-store-downloads-load')).toHaveCount(0);
    await expect.poll(() => calls.storeDownloads.length).toBe(1);
    await expect(page.locator('#admin-store-downloads-results')).toContainText('fronteras-download.pdf');
    await page.locator('[data-store-download-upload="true"]').setInputFiles({
      name: 'fronteras-download-updated.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% Store E2E download\n')
    });
    await expect.poll(() => calls.storeDownloadUploads.length).toBe(1);
    expect(calls.storeDownloadUploads[0]).toMatchObject({
      productId: DIGITAL_ITEM_ID,
      variantId: '',
      filename: 'fronteras-download-updated.pdf',
      contentType: 'application/pdf'
    });
    expect(calls.storeDownloadUploads[0].content).toMatch(/^data:application\/pdf;base64,/);
    await expect(page.locator('#admin-store-downloads-status')).toContainText('fronteras-download-updated.pdf uploaded.');

	    await page.locator('#admin-tab-settings').focus();
	    await page.keyboard.press('ArrowRight');
	    await expect(page.getByRole('tab', { name: 'Analytics', exact: true })).toHaveAttribute('aria-selected', 'true');
	    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Marketing', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Orders', exact: true })).toHaveAttribute('aria-selected', 'true');
  });

  test('loads the Spanish admin route and keeps limited admins in Store-only areas', async ({ page }) => {
    const calls = await routeAdminWorker(page, { role: 'limited_admin' });

    await page.goto('/es/admin/?admin_login=creator-token');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('#admin-app')).toBeVisible();
	    await expect(page.locator('#admin-session-summary')).toContainText(LIMITED_ADMIN_EMAIL);
	    await expect(page.locator('#admin-tab-settings')).toBeHidden();
	    await expect(page.locator('#admin-tab-addons')).toHaveCount(0);
    await expect(page.locator('#admin-tab-store-orders')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#admin-panel-store-orders')).toBeVisible();
    await expect(page.locator('#admin-tab-store-analytics')).toBeVisible();
	    await expect(page.locator('#admin-tab-store-marketing')).toBeVisible();
	    await expect(page.locator('#admin-tab-store-products')).toBeVisible();
	    await expect(page.locator('#admin-tab-store-downloads')).toBeVisible();
	    await expect(page.locator('#admin-tab-inventory')).toHaveCount(0);
    await expect.poll(() => calls.storeOrders.length).toBe(1);
    await expect(page.locator('#admin-store-orders-results')).toContainText(TICKET_ORDER_TOKEN);
  });

  test('keeps Spanish admin tabs compact on tablet viewports', async ({ page }) => {
    const calls = await routeAdminWorker(page);
    await page.setViewportSize({ width: 912, height: 1368 });

    await page.goto('/es/admin/?admin_login=admin-token-es-tablet');
    await expect(page.locator('#admin-app')).toBeVisible();
    await expect.poll(() => calls.summary.length).toBeGreaterThan(0);

    const tabs = page.locator('[data-admin-tabs] > .admin-tabs__list');
    await expect(tabs).toBeVisible();
    await expect.poll(() => tabs.evaluate((element: HTMLElement) => {
      return element.scrollWidth <= element.clientWidth + 1;
    })).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
    await expect(page.locator('#admin-tab-settings')).toHaveAttribute('aria-label', 'Configuración');
    await expect(page.locator('#admin-tab-campaigns')).toHaveCount(0);
	    const expectedCompactLabels = [
	      ['#admin-tab-settings', 'Config.'],
	      ['#admin-tab-store-analytics', 'Datos'],
	      ['#admin-tab-store-marketing', 'Mktg'],
	      ['#admin-tab-store-orders', 'Pedidos'],
	      ['#admin-tab-store-products', 'Productos'],
	      ['#admin-tab-store-downloads', 'Descargas']
	    ];
    for (const [selector, label] of expectedCompactLabels) {
      await expect.poll(() => page.locator(selector).evaluate((element: HTMLElement) => {
        return window.getComputedStyle(element, '::after').content.replace(/^"|"$/g, '');
      })).toBe(label);
    }
  });
});

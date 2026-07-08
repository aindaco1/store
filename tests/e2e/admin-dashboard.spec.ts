import { test, expect } from '@playwright/test';
import path from 'node:path';
import { expectNoHorizontalOverflow } from './helpers/mobile';

const WORKER_BASE = process.env.PLAYWRIGHT_WORKER_BASE_URL || 'http://127.0.0.1:8989';
const SITE_BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4002';
const JSON_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': SITE_BASE,
  'access-control-allow-credentials': 'true'
};
const axePath = path.resolve(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');

async function applyTextScale(page: any, percent = 200) {
  const stylesheetPath = `/__store-text-scale-${percent}.css`;
  await page.route(`**${stylesheetPath}`, async (route: any) => {
    await route.fulfill({
      contentType: 'text/css',
      body: `:root { font-size: ${percent}% !important; }`
    });
  });
  await page.addStyleTag({ url: stylesheetPath });
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  });
}

type AdminRole = 'super_admin' | 'limited_admin';

const SUPER_ADMIN_EMAIL = 'admin@example.com';
const LIMITED_ADMIN_EMAIL = 'creator@example.com';
const OTHER_ADMIN_EMAIL = 'other-admin@example.com';
const NEW_ADMIN_EMAIL = 'editor@example.com';
const TICKET_ORDER_TOKEN = 'store-order-ticket-e2e';
const DIGITAL_ORDER_TOKEN = 'store-order-digital-e2e';
const DEMO_ORDER_TOKEN = 'store-order-local-demo-all';
const TICKET_BUYER_NAME = 'Ticket Buyer';
const TICKET_BUYER_EMAIL = 'ticket-buyer@example.com';
const DIGITAL_BUYER_NAME = 'Download Buyer';
const DIGITAL_BUYER_EMAIL = 'download-buyer@example.com';
const DEMO_BUYER_NAME = 'Demo Customer';
const DEMO_BUYER_EMAIL = 'demo@example.com';
const TICKET_ITEM_ID = 'fronteras-ticket-general';
const DIGITAL_ITEM_ID = 'fronteras-download';
const DEMO_DIGITAL_ITEM_ID = 'demo-digital-download';
const DEMO_TICKET_ITEM_ID = 'demo-ticket-general';
const DEMO_RSVP_ITEM_ID = 'demo-rsvp';
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
    storeSnipcartImports: [],
    storeOrderCheckIns: [],
    storeOrderDownloadAccesses: [],
    storeProducts: [],
    storeCoupons: [],
    storeProductMedia: [],
    storeProductPreviews: [],
    storeProductPublishes: [],
    storeProductBulkPublishes: [],
    storeProductOrders: [],
    storeDownloads: [],
    storeDownloadUploads: [],
    storeDownloadCreates: [],
    storeDownloadDeletes: [],
    storeInventoryWrites: []
  };
  const user = {
    email: role === 'super_admin' ? SUPER_ADMIN_EMAIL : LIMITED_ADMIN_EMAIL,
    role,
    accessScopes: role === 'super_admin' ? [] : ['store']
  };
  const checkIns: Record<string, any> = {};

  await page.route(/^http:\/\/127\.0\.0\.1:(8989|8787)\/admin\//, async (route: any) => {
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
      const params = Object.fromEntries(url.searchParams.entries());
      calls.settings.push({ method, params });
      return fulfillJson({
        user,
        scope: role === 'super_admin' ? 'platform' : 'store',
        campaigns: [],
        sections: role === 'super_admin' ? storeSettingsSections(params.preferredLang || 'en') : [],
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
      const params = Object.fromEntries(url.searchParams.entries());
      calls.storeOrders.push(params);
      return fulfillJson(storeOrdersPayload(params, checkIns));
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
    if (url.pathname === '/admin/store/orders/import-snipcart' && method === 'POST') {
      calls.storeSnipcartImports.push(body);
      return fulfillJson({
        success: true,
        message: 'Imported 1 Snipcart order.',
        filename: body.filename,
        rowCount: 2,
        parsedOrderCount: 1,
        importedOrderCount: 1,
        skippedOrderCount: 0,
        failedOrderCount: 0,
        warnings: [],
        writeBudget: { readOnly: false, kvWritesExpected: 2, kvListExpected: 1 }
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
      checkIns[`${body.orderToken}:${body.itemId}`] = {
        checkedIn: body.checkedIn,
        quantity: body.quantity
      };
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
        message: body.action === 'revoke' ? 'Download access revoked.' : 'Download access refreshed.',
        mutation: {
          orderToken: body.orderToken,
          itemId: body.itemId,
          action: body.action,
          revokedAt: body.action === 'revoke' ? '2026-06-14T12:00:00.000Z' : '',
          linkTtlSeconds: 259200
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
          html: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><base href="https://shop.dustwave.xyz/"><link rel="stylesheet" href="https://shop.dustwave.xyz/assets/main.css"><script>window.__storePreviewHeadScriptRan = true;</script></head><body class="admin-store-product-preview-body"><section class="storefront storefront--product admin-store-product-preview" data-admin-store-product-preview onclick="window.__storePreviewInlineHandlerRan = true"><div class="storefront__header storefront__header--compact"><h1>${previewName}</h1></div><div class="storefront__product-detail"><article class="store-product-card store-product-card--purchase-only" data-store-product-card><a class="store-product-card__media" href="javascript:window.__storePreviewHrefRan=true" tabindex="-1" aria-disabled="true"><img class="store-product-card__image" src="${previewImage}" alt="${previewName}" loading="eager" decoding="async" fetchpriority="high"></a><div class="store-product-card__body"><div class="store-product-card__purchase"><p class="store-product-card__price">$35</p><p class="store-product-card__availability" data-store-inventory-state="none"></p><div class="store-product-card__controls store-product-card__controls--simple"><div class="store-product-card__field store-product-card__field--quantity"><label class="store-product-card__label">Quantity</label><div class="store-product-card__stepper"><button class="store-product-card__stepper-button" type="button" disabled>-</button><input class="store-product-card__qty" type="number" value="1" disabled><button class="store-product-card__stepper-button" type="button" disabled>+</button></div></div><button class="store-add-item store-product-card__button" type="button" disabled>Add to cart - $35</button></div></div></div></article><div class="storefront__product-copy"><p>${previewDescription}</p><p>Preview copy extends beyond the first fold so the admin iframe can scroll like the Store preview surface.</p><p>Second preview paragraph.</p><p>Third preview paragraph.</p></div></div></section><script>window.__storePreviewBodyScriptRan = true;</script></body></html>`,
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
        created: body.createProduct === true,
        productId: body.productId,
        deployNotice: body.createProduct === true ? 'Product created. Deploy started.' : 'Product published. Deploy started.',
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
    if (url.pathname === '/admin/store/products/order' && method === 'POST') {
      calls.storeProductOrders.push(body);
      return fulfillJson({
        success: true,
        published: true,
        updated: body.productIds?.length || 0,
        productIds: body.productIds || [],
        order: (body.productIds || []).map((productId: string, index: number) => ({
          productId,
          order: (index + 1) * 10
        })),
        deployNotice: 'Product order saved in GitHub and deploy started.',
        writeBudget: { readOnly: false, kvWritesExpected: 1 }
      });
    }
    if (url.pathname === '/admin/store/coupons' && method === 'GET') {
      calls.storeCoupons.push({ method });
      return fulfillJson(storeCouponsPayload());
    }
    if (url.pathname === '/admin/store/coupons' && method === 'POST') {
      calls.storeCoupons.push({ method, body });
      const coupon = body.coupon || body || {};
      return fulfillJson({
        success: true,
        coupon: {
          id: String(coupon.code || '').toLowerCase(),
          code: String(coupon.code || '').toUpperCase(),
          description: coupon.description || '',
          status: coupon.status || 'draft',
          discountType: coupon.discountType || 'percent',
          percentOff: Number(coupon.percentOff || 0),
          amountOffCents: Number(coupon.amountOffCents || 0),
          appliesTo: coupon.appliesTo || 'cart',
          productIds: Array.isArray(coupon.productIds) ? coupon.productIds : []
        },
        coupons: storeCouponsPayload().coupons,
        products: storeCouponsPayload().products,
        writeBudget: { readOnly: false, kvWritesExpected: 1 }
      });
    }
    if (url.pathname === '/admin/store/coupons/delete' && method === 'POST') {
      calls.storeCoupons.push({ method, body, delete: true });
      return fulfillJson({
        success: true,
        deleted: body.code,
        coupons: [],
        products: storeCouponsPayload().products,
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
    if (url.pathname === '/admin/store/downloads/create' && method === 'POST') {
      calls.storeDownloadCreates.push(body);
      const fileKey = body.fileKey || String(body.filename || 'store-download')
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '') || 'store-download';
      return fulfillJson({
        success: true,
        uploaded: true,
        fileKey,
        filename: body.filename,
        writeBudget: { readOnly: false, kvWritesExpected: 1, r2WritesExpected: 1 }
      });
    }
    if (url.pathname === '/admin/store/downloads/delete' && method === 'POST') {
      calls.storeDownloadDeletes.push(body);
      return fulfillJson({
        success: true,
        deleted: true,
        fileKey: body.fileKey,
        filename: body.filename || body.fileKey,
        writeBudget: { readOnly: false, kvWritesExpected: 1, r2WritesExpected: 1 }
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

const ES_BRAND_SEO_SETTING_LABELS: Record<string, string> = {
  'platform.favicon_path': 'Favicon',
  'platform.default_social_image_path': 'Imagen social predeterminada',
  'seo.x_handle': 'Usuario de X',
  'seo.default_social_image_alt': 'Texto alternativo de imagen social',
  'seo.same_as': 'Enlaces same-as',
  'seo.merchant_return_policy.applicable_country': 'Pais de politica de devoluciones',
  'seo.merchant_return_policy.return_policy_category': 'Tipo de politica de devoluciones',
  'seo.merchant_return_policy.merchant_return_days': 'Dias para devoluciones',
  'seo.merchant_return_policy.return_fees': 'Costos de devolucion',
  'seo.merchant_return_policy.return_method': 'Metodo de devolucion'
};

const ES_BRAND_SEO_OPTION_LABELS: Record<string, string> = {
  US: 'Estados Unidos',
  CA: 'Canada',
  'https://schema.org/MerchantReturnFiniteReturnWindow': 'Ventana de devolucion finita',
  'https://schema.org/MerchantReturnNotPermitted': 'No se permiten devoluciones',
  'https://schema.org/ReturnFeesCustomerResponsibility': 'Cliente cubre envio de devolucion',
  'https://schema.org/FreeReturn': 'Devoluciones gratis',
  'https://schema.org/ReturnByMail': 'Devolucion por correo',
  'https://schema.org/ReturnInStore': 'Devolucion en tienda'
};

function localizeStoreSettingsSections(sections: any[], lang = 'en') {
  if (!String(lang || '').toLowerCase().startsWith('es')) return sections;
  return sections.map((section) => ({
    ...section,
    title: section.title === 'Brand & SEO' ? 'Marca y SEO' : section.title,
    rows: (section.rows || []).map((row: any) => {
      const label = ES_BRAND_SEO_SETTING_LABELS[row.path] || row.label;
      return {
        ...row,
        label,
        options: Array.isArray(row.options)
          ? row.options.map((option: any) => ({
            ...option,
            label: ES_BRAND_SEO_OPTION_LABELS[String(option.value)] || option.label
          }))
          : row.options
      };
    })
  }));
}

function storeSettingsSections(lang = 'en') {
  const sections = [{
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
      settingsRow({ label: 'Logo', value: '/assets/images/defaults/dust-wave-square.png', rawValue: '/assets/images/defaults/dust-wave-square.png', editable: true, path: 'platform.logo_path', type: 'string', input: 'image-upload', layoutGroup: 'brand-logo-footer-logo' }),
      settingsRow({ label: 'Footer logo', value: '/assets/images/defaults/dust-wave-square.png', rawValue: '/assets/images/defaults/dust-wave-square.png', editable: true, path: 'platform.footer_logo_path', type: 'string', input: 'image-upload', layoutGroup: 'brand-logo-footer-logo' }),
      settingsRow({ label: 'Favicon', value: '/assets/icons/favicon.png', rawValue: '/assets/icons/favicon.png', editable: true, path: 'platform.favicon_path', type: 'string', input: 'image-upload', layoutGroup: 'brand-favicon-social-image' }),
      settingsRow({ label: 'Default social image', value: '/assets/images/defaults/dust-wave-square.png', rawValue: '/assets/images/defaults/dust-wave-square.png', editable: true, path: 'platform.default_social_image_path', type: 'string', input: 'image-upload', layoutGroup: 'brand-favicon-social-image' }),
      settingsRow({ label: 'X handle', value: '', rawValue: '', editable: true, path: 'seo.x_handle', type: 'string', input: 'text', layoutGroup: 'brand-x-social-alt' }),
      settingsRow({ label: 'Default social image alt', value: 'Dust Wave Shop', rawValue: 'Dust Wave Shop', editable: true, path: 'seo.default_social_image_alt', type: 'string', input: 'text', layoutGroup: 'brand-x-social-alt' }),
      settingsRow({ label: 'Same-as links', value: '', rawValue: [], editable: true, path: 'seo.same_as', type: 'list', input: 'url-list' }),
      settingsRow({ label: 'Return policy country', value: 'US', rawValue: 'US', editable: true, path: 'seo.merchant_return_policy.applicable_country', type: 'string', input: 'select', layoutGroup: 'brand-return-policy', options: [{ value: 'US', label: 'United States' }, { value: 'CA', label: 'Canada' }] }),
      settingsRow({ label: 'Return policy type', value: 'Finite return window', rawValue: 'https://schema.org/MerchantReturnFiniteReturnWindow', editable: true, path: 'seo.merchant_return_policy.return_policy_category', type: 'string', input: 'select', layoutGroup: 'brand-return-policy', options: [{ value: 'https://schema.org/MerchantReturnFiniteReturnWindow', label: 'Finite return window' }, { value: 'https://schema.org/MerchantReturnNotPermitted', label: 'Returns not permitted' }] }),
      settingsRow({ label: 'Return window days', value: '14', rawValue: 14, editable: true, path: 'seo.merchant_return_policy.merchant_return_days', type: 'number', input: 'integer', min: 1, max: 3650, step: 1, layoutGroup: 'brand-return-policy', visibleWhen: { path: 'seo.merchant_return_policy.return_policy_category', value: 'https://schema.org/MerchantReturnFiniteReturnWindow' } }),
      settingsRow({ label: 'Return fees', value: 'Customer handles return shipping', rawValue: 'https://schema.org/ReturnFeesCustomerResponsibility', editable: true, path: 'seo.merchant_return_policy.return_fees', type: 'string', input: 'select', layoutGroup: 'brand-return-policy', options: [{ value: 'https://schema.org/ReturnFeesCustomerResponsibility', label: 'Customer handles return shipping' }, { value: 'https://schema.org/FreeReturn', label: 'Free returns' }] }),
      settingsRow({ label: 'Return method', value: 'Return by mail', rawValue: 'https://schema.org/ReturnByMail', editable: true, path: 'seo.merchant_return_policy.return_method', type: 'string', input: 'select', layoutGroup: 'brand-return-policy', options: [{ value: 'https://schema.org/ReturnByMail', label: 'Return by mail' }, { value: 'https://schema.org/ReturnInStore', label: 'Return in store' }] })
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
  return localizeStoreSettingsSections(sections, lang);
}

function storeOrdersPayload(params: Record<string, string> = {}, checkIns: Record<string, any> = {}) {
  const allOrders = [{
      orderToken: DEMO_ORDER_TOKEN,
      status: 'confirmed',
      createdAt: '2026-06-11T12:10:00.000Z',
      confirmedAt: '2026-06-11T12:10:00.000Z',
      customer: {
        name: DEMO_BUYER_NAME,
        email: DEMO_BUYER_EMAIL
      },
      totals: {
        totalCents: 13505
      },
      payment: {
        status: 'paid'
      },
      fulfillmentTypes: ['digital', 'physical', 'rsvp', 'ticket'],
      items: [{
        id: 'demo-shirt',
        name: 'Demo Physical Shirt',
        variantLabel: 'Black / M',
        quantity: 1,
        fulfillmentType: 'physical'
      }, {
        id: DEMO_DIGITAL_ITEM_ID,
        name: 'Demo Digital Download',
        variantLabel: '',
        quantity: 1,
        fulfillmentType: 'digital'
      }, {
        id: DEMO_TICKET_ITEM_ID,
        name: 'Demo Event Ticket',
        variantLabel: 'General Admission',
        quantity: 2,
        fulfillmentType: 'ticket'
      }, {
        id: DEMO_RSVP_ITEM_ID,
        name: 'Demo RSVP',
        variantLabel: '',
        quantity: 1,
        fulfillmentType: 'rsvp'
      }]
    }, {
      orderToken: TICKET_ORDER_TOKEN,
      status: 'confirmed',
      createdAt: '2026-06-11T12:00:00.000Z',
      confirmedAt: '2026-06-11T12:00:00.000Z',
      customer: {
        name: TICKET_BUYER_NAME,
        email: TICKET_BUYER_EMAIL
      },
      totals: {
        totalCents: 1200
      },
      payment: {
        status: 'paid'
      },
      fulfillmentTypes: ['ticket'],
      items: [{
        id: TICKET_ITEM_ID,
        name: 'Fronteras Screening',
        variantLabel: 'General Admission',
        quantity: 1,
        fulfillmentType: 'ticket'
      }]
    }, {
      orderToken: DIGITAL_ORDER_TOKEN,
      status: 'confirmed',
      createdAt: '2026-06-11T12:05:00.000Z',
      confirmedAt: '2026-06-11T12:05:00.000Z',
      customer: {
        name: DIGITAL_BUYER_NAME,
        email: DIGITAL_BUYER_EMAIL
      },
      totals: {
        totalCents: 500
      },
      payment: {
        status: 'paid'
      },
      fulfillmentTypes: ['digital'],
      items: [{
        id: DIGITAL_ITEM_ID,
        name: 'Fronteras Download',
        variantLabel: '',
        quantity: 1,
        fulfillmentType: 'digital'
      }]
    }];
  const rawFulfillments = [{
      orderToken: DEMO_ORDER_TOKEN,
      createdAt: '2026-06-11T12:10:00.000Z',
      confirmedAt: '2026-06-11T12:10:00.000Z',
      customerName: DEMO_BUYER_NAME,
      customerEmail: DEMO_BUYER_EMAIL,
      itemId: DEMO_DIGITAL_ITEM_ID,
      itemName: 'Demo Digital Download',
      variantLabel: '',
      sku: DEMO_DIGITAL_ITEM_ID,
      fulfillmentType: 'digital',
      status: 'confirmed',
      paymentStatus: 'paid',
      totalCents: 1200,
      quantity: 1,
      checkInAvailable: false,
      checkedIn: false,
      checkedInQuantity: 0,
      downloadAccessManageable: true,
      downloadAccessStatus: 'active',
      downloadAccessExpiresAt: '',
      downloadAccessExpiresHours: 0,
      downloadAccess: {
        itemId: DEMO_DIGITAL_ITEM_ID,
        status: 'active',
        available: true,
        issuedAt: '2026-06-11T12:10:00.000Z',
        expiresAt: '',
        expiresInSeconds: 0,
        expiresHours: 0
      }
    }, {
      orderToken: DEMO_ORDER_TOKEN,
      createdAt: '2026-06-11T12:10:00.000Z',
      confirmedAt: '2026-06-11T12:10:00.000Z',
      customerName: DEMO_BUYER_NAME,
      customerEmail: DEMO_BUYER_EMAIL,
      itemId: DEMO_TICKET_ITEM_ID,
      itemName: 'Demo Event Ticket',
      variantLabel: 'General Admission',
      sku: DEMO_TICKET_ITEM_ID,
      fulfillmentType: 'ticket',
      eventStartsAt: '2026-07-01T01:00:00.000Z',
      eventVenue: 'Guild Cinema',
      eventAddress: '3405 Central Ave NE, Albuquerque, NM',
      status: 'confirmed',
      paymentStatus: 'paid',
      totalCents: 2400,
      quantity: 2,
      checkInAvailable: true,
      checkedIn: false,
      checkedInQuantity: 0
    }, {
      orderToken: DEMO_ORDER_TOKEN,
      createdAt: '2026-06-11T12:10:00.000Z',
      confirmedAt: '2026-06-11T12:10:00.000Z',
      customerName: DEMO_BUYER_NAME,
      customerEmail: DEMO_BUYER_EMAIL,
      itemId: DEMO_RSVP_ITEM_ID,
      itemName: 'Demo RSVP',
      variantLabel: '',
      sku: DEMO_RSVP_ITEM_ID,
      fulfillmentType: 'rsvp',
      eventStartsAt: '2026-07-01T01:00:00.000Z',
      eventVenue: 'Guild Cinema',
      eventAddress: '3405 Central Ave NE, Albuquerque, NM',
      status: 'confirmed',
      paymentStatus: 'not_required',
      totalCents: 0,
      quantity: 1,
      checkInAvailable: true,
      checkedIn: false,
      checkedInQuantity: 0
    }, {
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
      downloadAccessExpiresAt: '',
      downloadAccessExpiresHours: 0,
      downloadAccess: {
        itemId: DIGITAL_ITEM_ID,
        status: 'active',
        available: true,
        issuedAt: '2026-06-11T12:05:00.000Z',
        expiresAt: '',
        expiresInSeconds: 0,
        expiresHours: 0
      }
    }];
  const allFulfillments = rawFulfillments.map((row) => {
    const checkIn = checkIns[`${row.orderToken}:${row.itemId}`];
    if (!checkIn) return row;
    const quantity = Math.max(0, Number(row.quantity || 0) || 0);
    const checkedIn = checkIn.checkedIn === true;
    const checkedInQuantity = checkedIn
      ? Math.min(quantity, Math.max(1, Number(checkIn.quantity || quantity) || quantity))
      : 0;
    return {
      ...row,
      checkedIn,
      checkedInQuantity,
      checkedInAt: checkedIn ? '2026-06-11T12:15:00.000Z' : '',
      checkedInBy: checkedIn ? SUPER_ADMIN_EMAIL : ''
    };
  });
  const query = String(params.q || '').trim().toLowerCase();
  const rowsByToken = new Map<string, typeof allFulfillments>();
  for (const row of allFulfillments) {
    const rows = rowsByToken.get(row.orderToken) || [];
    rows.push(row);
    rowsByToken.set(row.orderToken, rows);
  }
  const orders = query
    ? allOrders.filter((order) => JSON.stringify([order, rowsByToken.get(order.orderToken) || []]).toLowerCase().includes(query))
    : allOrders;
  const orderTokens = new Set(orders.map((order) => order.orderToken));
  const fulfillments = allFulfillments.filter((row) => orderTokens.has(row.orderToken));
  const ticketRows = fulfillments.filter((row) => row.fulfillmentType === 'ticket');
  const fronterasCheckedInQuantity = ticketRows
    .filter((row) => row.itemId === TICKET_ITEM_ID)
    .reduce((sum, row) => sum + Math.max(0, Number(row.checkedInQuantity || 0) || 0), 0);
  const checkedInQuantity = fulfillments
    .filter((row) => row.checkInAvailable)
    .reduce((sum, row) => sum + Math.max(0, Number(row.checkedInQuantity || 0) || 0), 0);
  const attendance = ticketRows.length
    ? {
        totals: {
          eventCount: 1,
          orderCount: 1,
          quantity: 1,
          checkedInQuantity: fronterasCheckedInQuantity,
          uncheckedQuantity: Math.max(0, 1 - fronterasCheckedInQuantity)
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
          checkedInQuantity: fronterasCheckedInQuantity,
          uncheckedQuantity: Math.max(0, 1 - fronterasCheckedInQuantity),
          checkedInRate: fronterasCheckedInQuantity > 0 ? 100 : 0,
          orderCount: 1,
          rowCount: 1
        }]
      }
    : {
        totals: {
          eventCount: 0,
          orderCount: 0,
          quantity: 0,
          checkedInQuantity: 0,
          uncheckedQuantity: 0
        },
        events: []
      };
  return {
    scope: 'store',
    orders,
    totals: {
      orders: orders.length,
      fulfillmentRows: fulfillments.length,
      physicalQuantity: 0,
      digitalQuantity: fulfillments.filter((row) => row.fulfillmentType === 'digital').reduce((sum, row) => sum + row.quantity, 0),
      ticketQuantity: ticketRows.reduce((sum, row) => sum + row.quantity, 0),
      rsvpQuantity: 0,
      checkedInQuantity
    },
    page: {
      cursor: 0,
      returned: orders.length,
      matched: fulfillments.length,
      matchedOrders: orders.length,
      nextCursor: null
    },
    attendance,
    fulfillments,
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

function storeDownloadFilesPayload() {
  return [{
    fileKey: DIGITAL_ITEM_ID,
    filename: 'fronteras-download.pdf',
    contentType: 'application/pdf',
    source: 'r2',
    status: 'r2_ready',
    ready: true,
    size: 2048,
    uploadedAt: '2026-06-10T12:00:00.000Z',
    attachedTo: [{
      productId: DIGITAL_ITEM_ID,
      variantId: '',
      label: 'DUST WAVE Digital Download',
      sku: DIGITAL_ITEM_ID
    }]
  }];
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
    downloads: {
      bucketConfigured: true,
      totals: { count: 1, ready: 1, missing: 0, r2Ready: 1, files: 1 },
      files: storeDownloadFilesPayload(),
      updatedAt: '2026-06-10T12:00:00.000Z'
    },
    rows: [{
      productId: 'fronteras-poster-big',
      variantId: '',
      sku: 'fronteras-poster-big',
      label: 'Fronteras Poster (Big)',
      fulfillmentType: 'physical',
      order: 10,
      collection: 'fronteras',
      storefrontCategory: 'prints',
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
      order: 20,
      collection: 'dustwave',
      storefrontCategory: 'downloads',
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
      shippingPreset: 'ticket',
      downloadFileKey: DIGITAL_ITEM_ID,
      downloadFilename: 'fronteras-download.pdf'
    }, {
      productId: 'ticket-1',
      variantId: '',
      sku: 'ticket-1',
      label: 'DUST WAVE Event Ticket',
      fulfillmentType: 'ticket',
      order: 30,
      collection: 'dustwave',
      storefrontCategory: 'event-access',
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
      order: 40,
      collection: 'dustwave',
      storefrontCategory: 'event-access',
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
      sku: 'poster-1',
      name: 'Fronteras Poster (Big)',
      description: '18" X 24" super heavyweight matte poster. Butterflies are cool.',
      longContent: [{
        type: 'text',
        body: '18" X 24" super heavyweight matte poster. Butterflies are cool.',
        align: 'left'
      }],
      slug: 'fronteras-poster-big',
      sourcePath: '_products/fronteras-poster-big.md',
      order: 10,
      priceCents: 3500,
      status: 'active',
      fulfillmentType: 'physical',
      image: '/assets/images/fronteras-poster.png',
      collection: 'fronteras',
      storefrontCategory: 'prints',
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
      order: 20,
      priceCents: 500,
      status: 'active',
      public: false,
      launchTest: true,
      fulfillmentType: 'digital',
      image: '/assets/images/default.png',
      collection: 'dustwave',
      storefrontCategory: 'downloads',
      shippingPreset: 'ticket',
      inventoryTracking: false,
      inventory: 0,
      downloadFileKey: DIGITAL_ITEM_ID,
      downloadFilename: 'fronteras-download.pdf',
      variants: []
    }, {
      productId: 'ticket-1',
      name: 'DUST WAVE Event Ticket',
      description: 'A starter paid ticket product.',
      longContent: [],
      slug: 'dust-wave-event-ticket',
      sourcePath: '_products/dust-wave-event-ticket.md',
      order: 30,
      priceCents: 1200,
      status: 'active',
      public: false,
      launchTest: true,
      fulfillmentType: 'ticket',
      image: '/assets/images/dancewave.png',
      collection: 'dustwave',
      storefrontCategory: 'event-access',
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
      order: 40,
      priceCents: 0,
      status: 'active',
      public: false,
      launchTest: true,
      fulfillmentType: 'rsvp',
      image: '/assets/images/calendar-2026.png',
      collection: 'dustwave',
      storefrontCategory: 'event-access',
      shippingPreset: 'ticket',
      inventoryTracking: true,
      inventory: 0,
      variants: []
    }],
    writeBudget: { readOnly: true, kvWritesExpected: 0 }
  };
}

function storeCouponsPayload() {
  return {
    scope: 'store',
    coupons: [{
      id: 'save10',
      code: 'SAVE10',
      description: 'Ten percent off the whole cart.',
      status: 'active',
      discountType: 'percent',
      percentOff: 10,
      amountOffCents: 0,
      appliesTo: 'cart',
      productIds: [],
      createdAt: '2026-06-10T12:00:00.000Z',
      updatedAt: '2026-06-10T12:00:00.000Z'
    }, {
      id: 'poster5',
      code: 'POSTER5',
      description: 'Five dollars off the Fronteras poster.',
      status: 'draft',
      discountType: 'amount',
      percentOff: 0,
      amountOffCents: 500,
      appliesTo: 'products',
      productIds: ['fronteras-poster-big'],
      createdAt: '2026-06-10T12:00:00.000Z',
      updatedAt: '2026-06-10T12:00:00.000Z'
    }],
    products: [{
      productId: 'fronteras-poster-big',
      name: 'Fronteras Poster (Big)',
      status: 'active',
      fulfillmentType: 'physical',
      collection: 'fronteras',
      category: 'prints'
    }, {
      productId: DIGITAL_ITEM_ID,
      name: 'DUST WAVE Digital Download',
      status: 'active',
      fulfillmentType: 'digital',
      collection: 'dustwave',
      category: 'downloads'
    }],
    totals: {
      coupons: 2,
      active: 1,
      draft: 1
    },
    updatedAt: '2026-06-10T12:00:00.000Z',
    writeBudget: { readOnly: true, kvWritesExpected: 0 }
  };
}

function storeDownloadsPayload() {
  return {
    scope: 'store',
    bucketConfigured: true,
    totals: { count: 1, ready: 1, missing: 0, files: 1 },
    rows: [{
      productId: DIGITAL_ITEM_ID,
      variantId: '',
      sku: DIGITAL_ITEM_ID,
      label: 'DUST WAVE Digital Download',
      fileKey: DIGITAL_ITEM_ID,
      filename: 'fronteras-download.pdf',
      source: 'product',
      status: 'ready',
      ready: true,
      size: 2048,
      uploadedAt: '2026-06-10T12:00:00.000Z'
    }],
    files: storeDownloadFilesPayload(),
    writeBudget: { readOnly: true, kvWritesExpected: 0 }
  };
}

async function selectSettingsSection(page: any, name: string) {
  const tab = page.locator('#admin-settings-section-tabs button').filter({ hasText: name }).first();
  const mobileSelect = page.locator('#admin-settings-section-tabs + .admin-mobile-tab-select select');
  await expect.poll(async () => {
    const tabVisible = await tab.isVisible().catch(() => false);
    const selectVisible = await mobileSelect.isVisible().catch(() => false);
    return tabVisible || selectVisible;
  }).toBe(true);
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
  } else {
    await mobileSelect.selectOption({ label: name });
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
    const sandboxScriptErrors: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (text.includes('Blocked script execution')) sandboxScriptErrors.push(text);
    });
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
	      'Products',
	      'Coupons',
	      'Downloads',
	      'Orders',
	      'Analytics',
	      'Marketing'
	    ]);
	    await expect.poll(() => calls.summary.length).toBeGreaterThan(0);
	    await expect.poll(() => calls.settings.length).toBeGreaterThan(0);
	    await expect(page.locator('#admin-settings-section-tabs [data-settings-section-label="Marketing"]')).toHaveCount(0);
	    await expect(page.locator('#admin-settings-section-tabs [data-settings-section-label="Analytics"]')).toHaveCount(0);
	    await expect(page.getByRole('button', { name: 'About Dashboard' })).toHaveCount(0);
	    await expect(page.locator('#admin-overview-title')).toHaveCSS('font-family', /gambado-sans/);
	    await expect(calls.settings[0].params).toMatchObject({ preferredLang: 'en' });

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
    await expect(brandPanel.locator('.admin-settings__field-grid')).toHaveCount(4);
    await expect(brandPanel.locator('.admin-settings__field-grid .admin-settings__field-grid-item')).toHaveCount(11);
    await expect(brandPanel.locator('.admin-settings__image-preview img')).toHaveCount(4);
    const logoRow = page.locator('[data-settings-row-label="Logo"]');
    await expect(page.locator('[data-settings-path="platform.logo_path"]')).toHaveValue('/assets/images/defaults/dust-wave-square.png');
    await expect(page.locator('[data-settings-path="platform.logo_path"]')).toBeHidden();
    await expect(page.locator('[data-settings-path="platform.favicon_path"]')).toHaveValue('/assets/icons/favicon.png');
    await expect(page.locator('[data-settings-path="platform.default_social_image_path"]')).toHaveValue('/assets/images/defaults/dust-wave-square.png');
    await expect(page.locator('[data-settings-path="seo.default_social_image_alt"]')).toHaveValue('Dust Wave Shop');
    await expect(page.locator('[data-settings-path="seo.merchant_return_policy.applicable_country"]')).toHaveValue('US');
    await expect(page.locator('[data-settings-path="seo.merchant_return_policy.return_policy_category"]')).toHaveValue('https://schema.org/MerchantReturnFiniteReturnWindow');
    await expect(page.locator('[data-settings-path="seo.merchant_return_policy.merchant_return_days"]')).toHaveValue('14');
    await expect(page.locator('[data-settings-path="seo.merchant_return_policy.return_fees"]')).toHaveValue('https://schema.org/ReturnFeesCustomerResponsibility');
    await expect(page.locator('[data-settings-path="seo.merchant_return_policy.return_method"]')).toHaveValue('https://schema.org/ReturnByMail');
    await expect(logoRow.locator('input[type="text"]')).toHaveCount(0);
    await expect(logoRow.locator('.admin-settings__image-preview img')).toHaveAttribute('src', /\/assets\/images\/defaults\/dust-wave-square\.png$/);
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
    await expect(page.getByRole('button', { name: 'About Import Snipcart CSV' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'About Status' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'About Fulfillment' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'About Search' })).toBeVisible();
    await expect.poll(() => calls.storeOrders.length).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#admin-store-orders-results')).toContainText(DEMO_ORDER_TOKEN);
    await expect(page.locator('#admin-store-orders-results')).toContainText(TICKET_ORDER_TOKEN);
    await expect(page.locator('#admin-store-orders-results')).toContainText('Fronteras Download');
    await expect(page.locator('#admin-store-orders-summary')).toContainText('Checked in');
    await expect(page.locator('#admin-store-orders-attendance')).toContainText('Attendance');
    await expect(page.getByRole('button', { name: 'About Attendance' })).toBeVisible();
    await expect(page.locator('#admin-store-orders-attendance')).toContainText('Guild Cinema');
    const demoRow = page.locator('#admin-store-orders-results tbody tr').filter({ hasText: DEMO_ORDER_TOKEN });
    await expect(demoRow).not.toContainText('3 item actions');
    await expect(demoRow).toContainText('Demo Digital Download');
    await expect(demoRow.getByRole('button', { name: 'Refresh download access for Demo Digital Download' })).toBeVisible();
    await expect(demoRow.getByRole('button', { name: 'Revoke download access for Demo Digital Download' })).toBeVisible();
    await expect(demoRow.getByRole('button', { name: 'Check in' })).toHaveCount(2);
    await expect.poll(() => demoRow.locator('.admin-store-orders__actions .btn').evaluateAll((buttons: HTMLElement[]) => {
      return buttons.every((button) => {
        var style = getComputedStyle(button);
        return style.whiteSpace === 'nowrap' && button.scrollWidth <= button.clientWidth + 1;
      });
    })).toBe(true);
    const ticketRow = page.locator('#admin-store-orders-results tbody tr').filter({ hasText: TICKET_ORDER_TOKEN });
    const storeOrdersBeforeCheckIn = calls.storeOrders.length;
    await ticketRow.getByRole('button', { name: 'Check in' }).click();
    await expect.poll(() => calls.storeOrderCheckIns.length).toBe(1);
    expect(calls.storeOrderCheckIns[0]).toMatchObject({
      orderToken: TICKET_ORDER_TOKEN,
      itemId: TICKET_ITEM_ID,
      checkedIn: true,
      quantity: 1
    });
    await expect.poll(() => calls.storeOrders.length).toBeGreaterThan(storeOrdersBeforeCheckIn);
    await expect(page.locator('#admin-store-orders-status')).toContainText('Check-in saved.');
    await expect.poll(() => page.locator('#admin-store-orders-summary .admin-stat-card').filter({ hasText: 'Checked in' }).innerText()).toContain('1');
    const attendanceRow = page.locator('#admin-store-orders-attendance tbody tr').filter({ hasText: 'Fronteras Screening' });
    await expect(attendanceRow).toContainText('1 / 1');
    await expect(attendanceRow).toContainText('100%');
    const digitalRow = page.locator('#admin-store-orders-results tbody tr').filter({ hasText: 'Fronteras Download' });
    await expect(digitalRow).toContainText('Active entitlement');
    await expect(digitalRow.getByRole('button', { name: 'Apply' })).toHaveCount(0);
    await expect(digitalRow.getByRole('button', { name: 'Refresh download access for Fronteras Download' })).toBeVisible();
    await expect(digitalRow.getByRole('button', { name: 'Revoke download access for Fronteras Download' })).toBeVisible();
    await digitalRow.getByRole('button', { name: 'Refresh download access for Fronteras Download' }).click();
    await expect.poll(() => calls.storeOrderDownloadAccesses.length).toBe(1);
    expect(calls.storeOrderDownloadAccesses[0]).toMatchObject({
      orderToken: DIGITAL_ORDER_TOKEN,
      itemId: DIGITAL_ITEM_ID,
      action: 'reissue'
    });
    expect(calls.storeOrderDownloadAccesses[0]).not.toHaveProperty('expiresHours');
    await expect(page.locator('#admin-store-orders-status')).toContainText('Download access refreshed.');
    await digitalRow.getByRole('button', { name: 'Revoke download access for Fronteras Download' }).click();
    await expect.poll(() => calls.storeOrderDownloadAccesses.length).toBe(2);
    expect(calls.storeOrderDownloadAccesses[1]).toMatchObject({
      orderToken: DIGITAL_ORDER_TOKEN,
      itemId: DIGITAL_ITEM_ID,
      action: 'revoke'
    });
    await expect(page.locator('#admin-store-orders-status')).toContainText('Download access revoked.');
    await page.locator('#admin-store-order-query').fill(TICKET_BUYER_NAME);
    await expect.poll(() => calls.storeOrders.some((call) => call.q === TICKET_BUYER_NAME)).toBe(true);
    await expect(page.locator('#admin-store-orders-results')).toContainText(TICKET_ORDER_TOKEN);
    await expect(page.locator('#admin-store-orders-results')).not.toContainText(DIGITAL_ORDER_TOKEN);
    const storeOrderCallsAfterSearch = calls.storeOrders.length;
    await page.locator('#admin-store-order-query').fill(TICKET_BUYER_NAME);
    await page.waitForTimeout(450);
    expect(calls.storeOrders).toHaveLength(storeOrderCallsAfterSearch);
    await page.locator('#admin-store-attendees-export').click();
    await expect.poll(() => calls.storeAttendeeCsv.length).toBe(1);
    expect(calls.storeAttendeeCsv[0]).toMatchObject({ q: TICKET_BUYER_NAME });
    await expect(page.locator('#admin-store-orders-status')).toContainText('Attendee CSV download started.');
    await page.locator('#admin-store-orders-export').click();
    await expect.poll(() => calls.storeOrderCsv.length).toBe(1);
    await expect(page.locator('#admin-store-orders-status')).toContainText('Order CSV download started.');
    await page.locator('#admin-store-orders-snipcart-file').setInputFiles({
      name: 'snipcart-orders.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Invoice number,Token,Customer email,Item name\nSNIP-1,legacy-token,buyer@example.com,DUST WAVE Sticker\n')
    });
    await expect(page.locator('#admin-store-orders-snipcart-file-name')).toContainText('snipcart-orders.csv');
    await page.locator('#admin-store-orders-snipcart-import').click();
    await expect.poll(() => calls.storeSnipcartImports.length).toBe(1);
    expect(calls.storeSnipcartImports[0]).toMatchObject({
      filename: 'snipcart-orders.csv'
    });
    expect(calls.storeSnipcartImports[0].csv).toContain('SNIP-1');
    await expect(page.locator('#admin-store-orders-status')).toContainText('Imported 1 Snipcart order.');
    await expect(page.locator('#admin-store-orders-import-summary')).toContainText('2 CSV rows / 1 legacy order');

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
    await expect(productsResults.locator('thead')).not.toContainText('Order');
    await expect(productsResults.getByLabel('Bulk product status')).toBeVisible();
    await expect(page.locator('.admin-store-products__header #admin-store-product-create')).toHaveCount(0);
    await expect(productsResults.locator('.admin-store-products__bulk-actions #admin-store-product-create')).toBeVisible();
    expect(await productsResults.locator('.admin-store-products__bulk-actions').evaluate((row) => {
      const apply = row.querySelector('[data-store-products-bulk-apply]');
      const save = row.querySelector('[data-store-products-order-save]');
      const create = row.querySelector('[data-store-product-create]');
      if (!(apply instanceof HTMLElement) || !(save instanceof HTMLElement) || !(create instanceof HTMLElement)) return false;
      const applyRect = apply.getBoundingClientRect();
      const saveRect = save.getBoundingClientRect();
      const createRect = create.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const leftGap = saveRect.left - applyRect.right;
      const rightGap = createRect.left - saveRect.right;
      const createRightInset = rowRect.right - createRect.right;
      return leftGap >= 16
        && rightGap >= 16
        && Math.abs(leftGap - rightGap) <= 2
        && createRightInset >= 0
        && createRightInset <= 14
        && rowRect.height <= 72;
    })).toBe(true);
    const productListRows = productsResults.locator('tbody > tr:not(.admin-store-products__editor-row)');
    const posterRow = productListRows.filter({ hasText: 'Fronteras Poster (Big)' });
    const digitalProductRow = productListRows.filter({ hasText: 'DUST WAVE Digital Download' });
    const ticketProductRow = productListRows.filter({ hasText: 'DUST WAVE Event Ticket' });
    const rsvpProductRow = productListRows.filter({ hasText: 'DUST WAVE Free RSVP' });
    await expect(ticketProductRow).toHaveCount(1);
    await expect(ticketProductRow).toContainText('2 variants');
    await expect(ticketProductRow).toContainText('$12-$20');
    await expect(ticketProductRow.locator('[data-store-product-inventory-controls]')).toHaveCount(0);
    await expect(ticketProductRow).not.toContainText('Edit variants to manage inventory.');
    await expect(posterRow.locator('.admin-store-products__thumb img')).toHaveAttribute('src', /fronteras-poster\.png$/);
    await expect(rsvpProductRow.locator('.admin-store-products__thumb img')).toHaveAttribute('src', /calendar-2026\.png$/);
    await expect(digitalProductRow.locator('.admin-store-products__status')).toContainText('Test fixture');
    await expect(digitalProductRow.locator('.admin-store-products__status')).toContainText('not public');
    await expect(productsResults.getByRole('button', { name: 'Restock', exact: true })).toHaveCount(0);
    const currentProductOrder = async () => productsResults.evaluate(() => {
      return Array.from(document.querySelectorAll('#admin-store-products-results tbody > tr[data-store-product-order-row]'))
        .map((row) => row.getAttribute('data-store-product-order-row') || '');
    });
    const saveOrder = productsResults.locator('[data-store-products-order-save]');
    await expect(saveOrder).toBeDisabled();
    await digitalProductRow.getByRole('button', { name: 'Edit' }).click();
    const reorderDigitalEditor = productsResults.locator(`[data-store-product-editor][data-store-product-editor="${DIGITAL_ITEM_ID}"]`);
    await expect(reorderDigitalEditor).toBeVisible();
    await expect.poll(() => calls.storeProductPreviews.length).toBeGreaterThan(0);
    const previewsBeforeReorder = calls.storeProductPreviews.length;
    const publishesBeforeReorder = calls.storeProductPublishes.length;
    const bulkPublishesBeforeReorder = calls.storeProductBulkPublishes.length;
    const orderPublishesBeforeReorder = calls.storeProductOrders.length;
    await expect(posterRow).toHaveAttribute('draggable', 'true');
    await posterRow.focus();
    await page.keyboard.press('ArrowDown');
    await expect(saveOrder).toBeEnabled();
    expect(calls.storeProductOrders).toHaveLength(orderPublishesBeforeReorder);
    expect(calls.storeProductPublishes).toHaveLength(publishesBeforeReorder);
    expect(calls.storeProductBulkPublishes).toHaveLength(bulkPublishesBeforeReorder);
    expect(calls.storeProductPreviews).toHaveLength(previewsBeforeReorder);
    expect(await currentProductOrder()).toEqual([
      DIGITAL_ITEM_ID,
      'fronteras-poster-big',
      'ticket-1',
      RSVP_ITEM_ID
    ]);
    await saveOrder.click();
    await expect.poll(() => calls.storeProductOrders.length).toBe(1);
    expect(calls.storeProductOrders[0]).toEqual({
      intent: 'order_publish',
      productIds: [
        DIGITAL_ITEM_ID,
        'fronteras-poster-big',
        'ticket-1',
        RSVP_ITEM_ID
      ]
    });
    await expect(page.locator('#admin-store-products-status')).toContainText('Product order saved in GitHub and deploy started.');
    await expect(saveOrder).toBeDisabled();
    expect(await currentProductOrder()).toEqual([
      'fronteras-poster-big',
      DIGITAL_ITEM_ID,
      'ticket-1',
      RSVP_ITEM_ID
    ]);
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
    await expect(digitalEditor.locator('[data-store-product-field="downloadFileKey"]')).toBeVisible();
    await expect(digitalEditor.locator('[data-store-product-field="downloadFileKey"]')).toHaveValue(DIGITAL_ITEM_ID);
    await expect(digitalEditor.locator('[data-store-product-field="downloadFileKey"] option')).toContainText([
      'No file selected',
      `fronteras-download.pdf (${DIGITAL_ITEM_ID})`
    ]);
    await expect(digitalEditor.locator('[data-store-product-field-wrapper="shippingPreset"]')).toBeHidden();
    await expect(digitalEditor.locator('[data-store-product-variants]')).toBeHidden();
    await digitalEditor.locator('[data-store-product-variants-enabled]').selectOption('true');
    await expect(digitalEditor.locator('[data-store-product-field="downloadFileKey"]')).toBeHidden();
    await expect(digitalEditor.locator('[data-store-product-variants]')).toBeVisible();
    await expect(digitalEditor.locator('[data-store-product-variant]')).toHaveCount(1);
    await expect(digitalEditor.locator('.admin-store-products__variants-table th:not([hidden])')).toHaveText([
      'Label',
      'ID',
      'SKU',
      'File',
      'Price (USD)',
      'Status',
      ''
    ]);
    await expect(digitalEditor.locator('[data-store-variant-field="downloadFileKey"]')).toBeVisible();
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
      return Array.from(document.querySelectorAll('#admin-store-products-results .admin-store-products__table > tbody > tr')).map((row) => {
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
    await expect(productEditor.locator('[data-store-product-readonly-field="sku"]')).toHaveValue('poster-1');
    await expect(productEditor.locator('[data-store-product-readonly-field="sku"]')).toHaveAttribute('readonly', '');
    await expect(productEditor.getByRole('button', { name: 'About SKU' })).toBeVisible();
    expect(await productEditor.evaluate((editor) => {
      const sku = editor.querySelector('[data-store-product-field-wrapper="sku"]');
      const shipping = editor.querySelector('[data-store-product-field-wrapper="shippingPreset"]');
      if (!sku || !shipping) return false;
      return Boolean(sku.compareDocumentPosition(shipping) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    await expect(productEditor.locator('.admin-store-products__field-label').filter({ hasText: 'Price (USD)' })).toBeVisible();
    await expect(productEditor.locator('[data-store-product-field="price"]')).toHaveAttribute('type', 'number');
    await expect(productEditor.getByRole('button', { name: 'About Price (USD)' })).toBeVisible();
    await expect(productEditor.getByRole('button', { name: 'About Shipping preset' })).toBeVisible();
    await expect(productEditor.getByRole('button', { name: 'About Variant Based' })).toBeVisible();
    await expect(productEditor.getByRole('button', { name: 'About Image' })).toBeVisible();
    await expect(productEditor.getByRole('button', { name: 'About Product page content' })).toBeVisible();
    await expect(productEditor.getByRole('button', { name: 'About SEO description' })).toBeVisible();
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
    expect(await productEditor.evaluate((editor) => {
      const inventory = editor.querySelector('[data-store-product-field-wrapper="inventory"]');
      if (!(inventory instanceof HTMLElement) || inventory.hidden) return false;
      const editorRect = editor.getBoundingClientRect();
      const inventoryRect = inventory.getBoundingClientRect();
      return inventoryRect.left >= editorRect.left && inventoryRect.right <= editorRect.right;
    })).toBe(true);
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
    await expect(productEditor.frameLocator('[data-store-product-preview-frame]').locator('script')).toHaveCount(0);
    await expect.poll(async () => productEditor.frameLocator('[data-store-product-preview-frame]').locator('[data-admin-store-product-preview]').evaluate((section: HTMLElement) => {
      return {
        inlineHandler: section.getAttribute('onclick'),
        headScriptRan: (section.ownerDocument.defaultView as any).__storePreviewHeadScriptRan === true,
        bodyScriptRan: (section.ownerDocument.defaultView as any).__storePreviewBodyScriptRan === true,
        javascriptHref: section.querySelector('.store-product-card__media')?.getAttribute('href') || ''
      };
    })).toEqual({
      inlineHandler: null,
      headScriptRan: false,
      bodyScriptRan: false,
      javascriptHref: ''
    });
    expect(sandboxScriptErrors).toEqual([]);
    await expect(productEditor.frameLocator('[data-store-product-preview-frame]').locator('.storefront--product.admin-store-product-preview')).toBeVisible();
    await expect(productEditor.frameLocator('[data-store-product-preview-frame]').locator('.storefront__eyebrow')).toHaveCount(0);
    await expect(productEditor.frameLocator('[data-store-product-preview-frame]').locator('.store-product-card__eyebrow')).toHaveCount(0);
    await expect(productEditor.frameLocator('[data-store-product-preview-frame]').locator('.storefront__product-detail')).toBeVisible();
    await expect(productEditor.frameLocator('[data-store-product-preview-frame]').locator('.store-product-card')).toBeVisible();
    await expect(productEditor.frameLocator('[data-store-product-preview-frame]').locator('.store-product-card')).toHaveClass(/store-product-card--purchase-only/);
    await expect(productEditor.frameLocator('[data-store-product-preview-frame]').locator('.store-product-card__title')).toHaveCount(0);
    await expect(productEditor.frameLocator('[data-store-product-preview-frame]').locator('.store-product-card__description')).toHaveCount(0);
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
      'Standard',
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
    await expect(productEditor.locator('.admin-store-products__variants-table th:not([hidden])')).toHaveText([
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
    expect(calls.storeProductPublishes[1].fields).not.toHaveProperty('sku');
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

    await page.locator('#admin-store-product-create').click();
    await expect(productsResults.locator('.admin-store-products__editor-row').first()).toHaveAttribute('data-store-product-editor-row', '__new_store_product__');
    const createEditor = page.locator('[data-store-product-editor="__new_store_product__"]');
    await expect(createEditor).toBeVisible();
    await expect(createEditor.locator('.admin-store-products__editor-title')).toHaveText('Create product');
    await expect(createEditor.locator('[data-store-product-field="status"]')).toHaveValue('draft');
    await expect(createEditor.locator('[data-store-product-readonly-field="sku"]')).toHaveValue('new-product');
    await expect(createEditor.locator('.admin-store-products__preview-header .admin-store-products__preview-status')).toHaveCount(0);
    await expect(createEditor.locator('.admin-store-products__preview > .admin-store-products__preview-status')).toHaveCount(1);
    await expect(createEditor.locator('.admin-store-products__preview-header')).not.toContainText('Request failed.');
    await expect(createEditor.getByRole('button', { name: 'Create product' })).toBeEnabled();
    await createEditor.locator('[data-store-product-field="inventoryTracking"]').selectOption('true');
    await expect(createEditor.locator('[data-store-product-field-wrapper="inventory"]')).toBeVisible();
    expect(await createEditor.evaluate((editor) => {
      const inventory = editor.querySelector('[data-store-product-field-wrapper="inventory"]');
      if (!(inventory instanceof HTMLElement) || inventory.hidden) return false;
      const editorRect = editor.getBoundingClientRect();
      const inventoryRect = inventory.getBoundingClientRect();
      return inventoryRect.left >= editorRect.left && inventoryRect.right <= editorRect.right;
    })).toBe(true);
    await createEditor.locator('[data-store-product-field="name"]').fill('DUST WAVE New Zine');
    await expect(createEditor.locator('[data-store-product-readonly-field="sku"]')).toHaveValue('dust-wave-new-zine');
    await createEditor.locator('[data-store-product-field="price"]').fill('8');
    await createEditor.locator('[data-store-product-field="shippingPreset"]').selectOption('sticker');
    await createEditor.locator('[data-store-product-image-upload="true"]').setInputFiles({
      name: 'zine-e2e.png',
      mimeType: 'image/png',
      buffer: Buffer.from('zine image e2e')
    });
    await expect.poll(() => calls.imageUploads.length).toBe(2);
    expect(calls.imageUploads[1]).toMatchObject({
      filename: 'zine-e2e.png',
      contentType: 'image/png',
      kind: 'store-product',
      productId: 'dust-wave-new-zine',
      filenameBase: 'DUST WAVE New Zine',
      createProduct: true
    });
    await createEditor.locator('[data-store-product-variants-enabled]').selectOption('true');
    const createVariant = createEditor.locator('[data-store-product-variant]').first();
    await createVariant.locator('[data-store-variant-field="label"]').fill('Signed');
    await expect(createVariant.locator('[data-store-variant-field="id"]')).toHaveValue('signed');
    await expect(createVariant.locator('[data-store-variant-field="sku"]')).toHaveValue('dust-wave-new-zine-signed');
    await createVariant.locator('[data-store-variant-field="price"]').fill('10');
    await createEditor.getByRole('button', { name: 'Create product' }).click();
    await expect.poll(() => calls.storeProductPublishes.length).toBe(3);
    expect(calls.storeProductPublishes[2]).toMatchObject({
      intent: 'publish',
      createProduct: true,
      productId: 'dust-wave-new-zine',
      fields: {
        name: 'DUST WAVE New Zine',
        price: 8,
        status: 'draft',
        image: '/assets/images/products/product-fronteras-poster-big-e2e.png',
        shippingPreset: 'sticker'
      },
      variants: [{
        id: 'signed',
        label: 'Signed',
        sku: 'dust-wave-new-zine-signed',
        price: 10,
        status: 'active'
      }]
    });
    await expect(page.locator('#admin-store-products-status')).toContainText('Product created. Deploy started.');

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
    await expect(page.locator('#admin-store-downloads-results th')).toContainText(['File', 'Status', 'Attached to', 'Uploaded', 'Actions']);
    await expect(page.locator('#admin-store-downloads-results').getByRole('button', { name: 'Replace', exact: true })).toBeVisible();
    await expect(page.locator('#admin-store-downloads-results').getByRole('button', { name: 'Delete fronteras-download.pdf' })).toBeVisible();
    await page.locator('[data-store-download-upload="true"]').setInputFiles({
      name: 'fronteras-download-updated.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% Store E2E download\n')
    });
    await expect.poll(() => calls.storeDownloadCreates.length).toBe(1);
    expect(calls.storeDownloadCreates[0]).toMatchObject({
      fileKey: DIGITAL_ITEM_ID,
      filename: 'fronteras-download-updated.pdf',
      contentType: 'application/pdf'
    });
    expect(calls.storeDownloadCreates[0].content).toMatch(/^data:application\/pdf;base64,/);
    await expect(page.locator('#admin-store-downloads-status')).toContainText('fronteras-download-updated.pdf uploaded.');
    await page.locator('#admin-store-downloads-results').getByRole('button', { name: 'Delete fronteras-download.pdf' }).click();
    await expect.poll(() => calls.storeDownloadDeletes.length).toBe(1);
    expect(calls.storeDownloadDeletes[0]).toMatchObject({ fileKey: DIGITAL_ITEM_ID, filename: 'fronteras-download.pdf' });
    await expect(page.locator('#admin-store-downloads-status')).toContainText('fronteras-download.pdf deleted.');

    const createDownloadForm = page.locator('[data-store-download-create]');
    await expect(createDownloadForm.locator('[data-store-download-create-field="name"]')).toHaveCount(0);
    await expect(createDownloadForm.locator('[data-store-download-create-field="productId"]')).toHaveCount(0);
    await expect(createDownloadForm.locator('[data-store-download-create-field="price"]')).toHaveCount(0);
    await expect(createDownloadForm.locator('[data-store-download-create-field="description"]')).toHaveCount(0);
    await createDownloadForm.locator('[data-store-download-create-field="file"]').setInputFiles({
      name: 'dust-wave-new-download.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% Store new download\n')
    });
    await createDownloadForm.getByRole('button', { name: 'Upload file', exact: true }).click();
    await expect.poll(() => calls.storeDownloadCreates.length).toBe(2);
    expect(calls.storeDownloadCreates[1]).toMatchObject({
      filename: 'dust-wave-new-download.pdf',
      contentType: 'application/pdf'
    });
    expect(calls.storeDownloadCreates[1]).not.toHaveProperty('productId');
    expect(calls.storeDownloadCreates[1]).not.toHaveProperty('price');
    expect(calls.storeDownloadCreates[1]).not.toHaveProperty('status');
    expect(calls.storeDownloadCreates[1]).not.toHaveProperty('description');
    expect(calls.storeDownloadCreates[1].content).toMatch(/^data:application\/pdf;base64,/);
    await expect(page.locator('#admin-store-downloads-status')).toContainText('dust-wave-new-download.pdf uploaded.');

	    await page.locator('#admin-tab-settings').focus();
	    await page.keyboard.press('ArrowRight');
	    await expect(page.getByRole('tab', { name: 'Products', exact: true })).toHaveAttribute('aria-selected', 'true');
	    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Coupons', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => calls.storeCoupons.length).toBe(1);
	    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Downloads', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Orders', exact: true })).toHaveAttribute('aria-selected', 'true');
  });

  test('keeps Store orders single-action buttons inside the desktop table', async ({ page }) => {
    await routeAdminWorker(page);
    await page.setViewportSize({ width: 1366, height: 768 });

    await page.goto('/admin/?admin_login=admin-token-orders-desktop');
    await expect(page.locator('#admin-app')).toBeVisible();

    await selectAdminSection(page, 'Orders');
    const ordersResults = page.locator('#admin-store-orders-results');
    await expect(ordersResults).toContainText(TICKET_ORDER_TOKEN);

    const ticketRow = ordersResults.locator('tbody tr').filter({ hasText: TICKET_ORDER_TOKEN });
    await expect.poll(() => ticketRow.locator('.admin-store-orders__actions').evaluate((cell: HTMLElement) => {
      const button = cell.querySelector('.btn') as HTMLElement | null;
      const root = cell.closest('#admin-store-orders-results') as HTMLElement | null;
      if (!button || !root) return false;
      const cellRect = cell.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      return (
        getComputedStyle(cell).containerType === 'inline-size' &&
        button.scrollWidth <= button.clientWidth + 1 &&
        buttonRect.left >= cellRect.left - 1 &&
        buttonRect.right <= cellRect.right + 1 &&
        cellRect.right <= rootRect.right + 1
      );
    })).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
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

  test('restores the last admin tab and settings section after an authenticated reload', async ({ page }) => {
    await routeAdminWorker(page);

    await page.goto('/admin/?admin_login=persist-token-orders');
    await expect(page.locator('#admin-app')).toBeVisible();
    await selectAdminSection(page, 'Orders');
    await expect(page.locator('#admin-panel-store-orders')).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('store-admin-dashboard-state:v1') || '{}').tab)).toBe('store-orders');

    await page.goto('/admin/?admin_login=persist-token-orders-refresh');
    await expect(page.locator('#admin-app')).toBeVisible();
    await expect(page.locator('#admin-tab-store-orders')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#admin-panel-store-orders')).toBeVisible();

    await selectAdminSection(page, 'Settings');
    await selectSettingsSection(page, 'Shipping');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('store-admin-dashboard-state:v1') || '{}'))).toMatchObject({
      tab: 'settings',
      settingsSection: expect.any(Number)
    });

    await page.goto('/admin/?admin_login=persist-token-settings-refresh');
    await expect(page.locator('#admin-app')).toBeVisible();
    await expect(page.locator('#admin-tab-settings')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#admin-settings-section-tabs [data-settings-section-label="Shipping"]')).toHaveAttribute('aria-selected', 'true');

    await page.goto('/admin/?admin_login=persist-token-products&tab=store-products');
    await expect(page.locator('#admin-app')).toBeVisible();
    await expect(page.locator('#admin-tab-store-products')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#admin-panel-store-products')).toBeVisible();
  });

  test('keeps Spanish admin tabs compact on tablet viewports', async ({ page }) => {
    const calls = await routeAdminWorker(page);
    await page.setViewportSize({ width: 912, height: 1368 });

    await page.goto('/es/admin/?admin_login=admin-token-es-tablet');
    await expect(page.locator('#admin-app')).toBeVisible();
    await expect.poll(() => calls.summary.length).toBeGreaterThan(0);
    await expect.poll(() => calls.settings.length).toBeGreaterThan(0);
    await expect(calls.settings[0].params).toMatchObject({ preferredLang: 'es' });

    await selectSettingsSection(page, 'Marca y SEO');
    await expect(page.locator('[data-settings-row-label="Imagen social predeterminada"]')).toBeVisible();
    await expect(page.locator('[data-settings-row-label="Pais de politica de devoluciones"]')).toBeVisible();
    await expect(page.locator('[data-settings-path="seo.merchant_return_policy.return_policy_category"] option')).toHaveText([
      'Ventana de devolucion finita',
      'No se permiten devoluciones'
    ]);
    await expect(page.getByRole('button', { name: 'Acerca de Pais de politica de devoluciones' })).toBeVisible();

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
	      ['#admin-tab-store-products', 'Productos'],
	      ['#admin-tab-store-downloads', 'Descargas'],
	      ['#admin-tab-store-orders', 'Pedidos'],
	      ['#admin-tab-store-analytics', 'Datos'],
	      ['#admin-tab-store-marketing', 'Mktg']
	    ];
    for (const [selector, label] of expectedCompactLabels) {
      await expect.poll(() => page.locator(selector).evaluate((element: HTMLElement) => {
        return window.getComputedStyle(element, '::after').content.replace(/^"|"$/g, '');
      })).toBe(label);
    }
  });

  test('keeps Store products admin usable on mobile viewports', async ({ page }) => {
    const calls = await routeAdminWorker(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('/admin/?admin_login=admin-token-products-mobile');
    await expect(page.locator('#admin-app')).toBeVisible();
    await expect.poll(() => calls.summary.length).toBeGreaterThan(0);

    await selectAdminSection(page, 'Products');
    await expect.poll(() => calls.storeProducts.length).toBe(1);
    const productsResults = page.locator('#admin-store-products-results');
    await expect(productsResults).toContainText('Fronteras Poster (Big)');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
    await expect.poll(() => productsResults.locator('.admin-store-products__table').evaluate((table: HTMLElement) => {
      return getComputedStyle(table).display === 'block' && table.scrollWidth <= table.clientWidth + 2;
    })).toBe(true);
    await expect.poll(() => productsResults.locator('.admin-store-products__table thead').evaluate((thead: HTMLElement) => {
      return getComputedStyle(thead).display;
    })).toBe('none');

    const productListRows = productsResults.locator('tbody > tr[data-store-product-order-row]');
    await expect(productListRows).toHaveCount(4);
    await expect.poll(() => productListRows.first().evaluate((row: HTMLElement) => {
      return getComputedStyle(row).display === 'grid' && row.getBoundingClientRect().right <= window.innerWidth + 1;
    })).toBe(true);
    await expect.poll(() => productsResults.locator('[data-store-products-bulk-status]').evaluate((select: HTMLSelectElement) => {
      const styles = getComputedStyle(select);
      return styles.appearance === 'none' && styles.backgroundImage !== 'none' && select.getBoundingClientRect().right <= window.innerWidth + 1;
    })).toBe(true);

    const ticketProductRow = productListRows.filter({ hasText: 'DUST WAVE Event Ticket' });
    await ticketProductRow.getByRole('button', { name: 'Edit' }).click();
    const ticketEditor = page.locator('[data-store-product-editor="ticket-1"]');
    await expect(ticketEditor).toBeVisible();
    await expect(ticketEditor.locator('[data-store-product-variants]')).toBeVisible();
    const variantsTable = ticketEditor.locator('.admin-store-products__variants-table');
    await expect.poll(() => variantsTable.evaluate((table: HTMLElement) => {
      return getComputedStyle(table).display === 'block' && table.scrollWidth <= table.clientWidth + 2;
    })).toBe(true);
    await expect.poll(() => variantsTable.locator('thead').evaluate((thead: HTMLElement) => {
      return getComputedStyle(thead).display;
    })).toBe('none');
    await expect.poll(() => variantsTable.locator('tbody > tr').first().evaluate((row: HTMLElement) => {
      return row.getBoundingClientRect().right <= window.innerWidth + 1;
    })).toBe(true);
    await expect.poll(() => variantsTable.locator('tbody > tr').first().evaluate((row: HTMLElement) => {
      return Array.from(row.querySelectorAll('td')).map((cell) => (cell as HTMLElement).dataset.label || '');
    })).toEqual(['Label', 'ID', 'SKU', 'File', 'Price (USD)', 'Inventory', 'Status', 'Actions']);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
    await expect.poll(() => ticketEditor.locator('select[data-store-product-field="taxCategory"]').evaluate((select: HTMLSelectElement) => {
      const styles = getComputedStyle(select);
      return styles.appearance === 'none' && styles.backgroundImage !== 'none' && select.getBoundingClientRect().right <= window.innerWidth + 1;
    })).toBe(true);
  });

  test('keeps Store orders admin rows usable on mobile viewports', async ({ page }) => {
    const calls = await routeAdminWorker(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('/admin/?admin_login=admin-token-orders-mobile');
    await expect(page.locator('#admin-app')).toBeVisible();
    await expect.poll(() => calls.summary.length).toBeGreaterThan(0);

    await selectAdminSection(page, 'Orders');
    await expect.poll(() => calls.storeOrders.length).toBeGreaterThanOrEqual(1);
    const ordersResults = page.locator('#admin-store-orders-results');
    await expect(ordersResults).toContainText(TICKET_ORDER_TOKEN);
    await expect(ordersResults).toContainText('Fronteras Download');
    await expect(page.locator('#admin-store-orders-attendance')).toContainText('Attendance');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);

    await expect.poll(() => ordersResults.locator('.admin-store-orders__table').evaluate((table: HTMLElement) => {
      return getComputedStyle(table).display === 'block' && table.scrollWidth <= table.clientWidth + 2;
    })).toBe(true);
    await expect.poll(() => ordersResults.locator('.admin-store-orders__table thead').evaluate((thead: HTMLElement) => {
      return getComputedStyle(thead).display;
    })).toBe('none');

    const orderRows = ordersResults.locator('tbody > tr');
    await expect(orderRows).toHaveCount(3);
    await expect.poll(() => orderRows.first().evaluate((row: HTMLElement) => {
      return getComputedStyle(row).display === 'grid' && row.getBoundingClientRect().right <= window.innerWidth + 1;
    })).toBe(true);
    await expect.poll(() => orderRows.first().evaluate((row: HTMLElement) => {
      return Array.from(row.querySelectorAll('td')).map((cell) => (cell as HTMLElement).dataset.label || '');
    })).toEqual(['Order', 'Customer', 'Item', 'Status', 'Total', 'Actions']);
    const demoMobileRow = orderRows.filter({ hasText: DEMO_ORDER_TOKEN });
    await expect.poll(() => demoMobileRow.locator('.admin-store-orders__actions .btn').evaluateAll((buttons: HTMLElement[]) => {
      return buttons.every((button) => {
        var style = getComputedStyle(button);
        return style.whiteSpace === 'nowrap' && button.scrollWidth <= button.clientWidth + 1;
      });
    })).toBe(true);

    const attendance = page.locator('#admin-store-orders-attendance');
    await expect.poll(() => attendance.locator('.admin-store-orders__attendance-table').evaluate((table: HTMLElement) => {
      return getComputedStyle(table).display === 'block' && table.scrollWidth <= table.clientWidth + 2;
    })).toBe(true);
    await expect.poll(() => attendance.locator('.admin-store-orders__attendance-table thead').evaluate((thead: HTMLElement) => {
      return getComputedStyle(thead).display;
    })).toBe('none');
    await expect.poll(() => attendance.locator('tbody > tr').first().evaluate((row: HTMLElement) => {
      return Array.from(row.querySelectorAll('td')).map((cell) => (cell as HTMLElement).dataset.label || '');
    })).toEqual(['Event', 'Venue', 'Orders', 'Checked in', 'Rate']);

    const ticketRow = ordersResults.locator('tbody > tr').filter({ hasText: TICKET_ORDER_TOKEN });
    await ticketRow.getByRole('button', { name: 'Check in' }).click();
    await expect.poll(() => calls.storeOrderCheckIns.length).toBe(1);
    await expect(page.locator('#admin-store-orders-status')).toContainText('Check-in saved.');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
  });

  test('keeps Store downloads admin usable on mobile viewports', async ({ page }) => {
    const calls = await routeAdminWorker(page);
    await page.setViewportSize({ width: 390, height: 844 });
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto('/admin/?admin_login=admin-token-downloads-mobile');
    await expect(page.locator('#admin-app')).toBeVisible();
    await expect.poll(() => calls.summary.length).toBeGreaterThan(0);

    await selectAdminSection(page, 'Downloads');
    await expect.poll(() => calls.storeDownloads.length).toBe(1);
    const downloadsResults = page.locator('#admin-store-downloads-results');
    await expect(downloadsResults).toContainText('fronteras-download.pdf');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
    await expect.poll(() => downloadsResults.locator('.admin-store-downloads__table').evaluate((table: HTMLElement) => {
      return getComputedStyle(table).display === 'block' && table.scrollWidth <= table.clientWidth + 2;
    })).toBe(true);
    await expect.poll(() => downloadsResults.locator('.admin-store-downloads__table thead').evaluate((thead: HTMLElement) => {
      return getComputedStyle(thead).display;
    })).toBe('none');

    const downloadRows = downloadsResults.locator('tbody > tr');
    await expect(downloadRows).toHaveCount(1);
    await expect.poll(() => downloadRows.first().evaluate((row: HTMLElement) => {
      return getComputedStyle(row).display === 'grid' && row.getBoundingClientRect().right <= window.innerWidth + 1;
    })).toBe(true);
    await expect.poll(() => downloadRows.first().evaluate((row: HTMLElement) => {
      return Array.from(row.querySelectorAll('td')).map((cell) => (cell as HTMLElement).dataset.label || '');
    })).toEqual(['File', 'Status', 'Attached to', 'Uploaded', 'Actions']);
    await expect(downloadRows.first().getByRole('button', { name: 'Replace', exact: true })).toBeVisible();
    await expect(downloadRows.first().getByRole('button', { name: 'Delete fronteras-download.pdf' })).toBeVisible();
    await expect.poll(() => downloadsResults.locator('[data-store-download-upload="true"]').evaluate((input: HTMLInputElement) => {
      return input.getBoundingClientRect().right <= window.innerWidth + 1 && getComputedStyle(input).width !== 'auto';
    })).toBe(true);
    const createDownloadForm = page.locator('[data-store-download-create]');
    await createDownloadForm.getByRole('button', { name: 'About File' }).hover();
    const downloadFileTooltipBounds = await createDownloadForm.locator('.admin-settings__help-tooltip').evaluate((tooltip: HTMLElement) => {
      const rect = tooltip.getBoundingClientRect();
      const styles = getComputedStyle(tooltip);
      return {
        bottom: Math.ceil(rect.bottom),
        display: styles.display,
        left: Math.floor(rect.left),
        position: styles.position,
        right: Math.ceil(rect.right),
        top: Math.floor(rect.top),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth
      };
    });
    expect(downloadFileTooltipBounds.display).toBe('block');
    expect(downloadFileTooltipBounds.position).toBe('fixed');
    expect(downloadFileTooltipBounds.left).toBeGreaterThanOrEqual(0);
    expect(downloadFileTooltipBounds.right).toBeLessThanOrEqual(downloadFileTooltipBounds.viewportWidth);
    expect(downloadFileTooltipBounds.top).toBeGreaterThanOrEqual(0);
    expect(downloadFileTooltipBounds.bottom).toBeLessThanOrEqual(downloadFileTooltipBounds.viewportHeight);
    await downloadRows.first().getByRole('button', { name: 'Delete fronteras-download.pdf' }).click();
    await expect.poll(() => calls.storeDownloadDeletes.length).toBe(1);
    expect(calls.storeDownloadDeletes[0]).toMatchObject({
      fileKey: DIGITAL_ITEM_ID,
      filename: 'fronteras-download.pdf'
    });
    await expect(page.locator('#admin-store-downloads-status')).toContainText('fronteras-download.pdf deleted.');

    await downloadsResults.locator('[data-store-download-upload="true"]').setInputFiles({
      name: 'fronteras-download-mobile.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% Store mobile download\n')
    });
    await expect.poll(() => calls.storeDownloadCreates.length).toBe(1);
    await expect(page.locator('#admin-store-downloads-status')).toContainText('fronteras-download-mobile.pdf uploaded.');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
  });

  test('keeps Store admin release surfaces usable with 200% text scaling', async ({ page }) => {
    const calls = await routeAdminWorker(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto('/admin/?admin_login=admin-token-text-scale');
    await expect(page.locator('#admin-app')).toBeVisible();
    await applyTextScale(page);
    await expect.poll(() => calls.summary.length).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(page);

    await selectAdminSection(page, 'Products');
    await expect.poll(() => calls.storeProducts.length).toBe(1);
    await expect(page.locator('#admin-store-products-results')).toContainText('Fronteras Poster (Big)');
    await expectNoHorizontalOverflow(page);

    await selectAdminSection(page, 'Orders');
    await expect.poll(() => calls.storeOrders.length).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#admin-store-orders-results')).toContainText(TICKET_ORDER_TOKEN);
    await expectNoHorizontalOverflow(page);

    await selectAdminSection(page, 'Downloads');
    await expect.poll(() => calls.storeDownloads.length).toBe(1);
    await expect(page.locator('#admin-store-downloads-results')).toContainText('fronteras-download.pdf');
    await expectNoHorizontalOverflow(page);

    await selectAdminSection(page, 'Marketing');
    await expect(page.locator('#admin-store-marketing-builder')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

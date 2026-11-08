import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { expectNoHorizontalOverflow } from './helpers/mobile';

const orderToken = `store-order-${'a'.repeat(64)}`;
const now = Date.UTC(2026, 10, 4);
const key = 'DW-TEST-KEY-FIXTURE';
const base = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4002';
const worker = process.env.PLAYWRIGHT_WORKER_BASE_URL || 'http://127.0.0.1:8989';
const headers = { 'content-type': 'application/json', 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type,x-store-admin-csrf' };

async function fixture(page: Page, options: { paid?: boolean; enabled?: boolean; lostRefund?: boolean } = {}) {
  const calls: { path: string; body: any; csrf?: string }[] = [];
  let cancelled = false, refund: any, grant: any;
  await page.route(`${worker}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = request.postDataJSON() || {};
    calls.push({ path: url.pathname, body, csrf: request.headers()['x-store-admin-csrf'] });
    const json = (data: any, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(data) });
    const action = url.pathname.split('/').at(-1);
    if (url.pathname === `/api/orders/${orderToken}`) return json({ orderToken, status: 'confirmed', fulfillmentReady: true, totals: {totalCents:1000,currency:'USD'}, items: [{name:'ASCII VJ Remix',quantity:1,subtotalCents:1000,fulfillmentType:'digital'}], ...(options.enabled === false ? {} : {software:{token:'private-management-token'}}) });
    if (url.pathname.includes('/software/')) {
      if (action === 'status') return json({ licenses: [{name:'ASCII VJ Remix',lineId:'software',offer:{seats:2},issued:true,coverage:[{kind:'term',start:0,end:now+86400000}],releases:[{id:'build-2',version:'2.0.0',platform:'darwin-aarch64',url:`${worker}/api/orders/${orderToken}/software/download?token=private-download-token`}]}],renewal:{status:'active',cancelled},invoices:[{id:'in_due',status:'open',amountCents:1000,createdAt:now,payable:true}] });
      if (action === 'recover') return json({key});
      if (action === 'cancel') { cancelled = true; return json({cancelled:true}); }
      if (action === 'card-complete') return json({updated:true});
      if (action === 'card-setup') return json({url:'https://checkout.stripe.com/c/pay/fixture'});
      if (action === 'invoice-page') return json({url:'https://invoice.stripe.com/i/fixture'});
    }
    if (url.pathname === '/admin/session') return json({user:{email:'operator@example.test',role:options.paid === false ? 'limited_admin' : 'super_admin',accessScopes:['store']},csrfToken:'csrf-management-test'});
    if (url.pathname.includes('/admin/store/licenses/')) {
      if (action === 'config') return json({enabled:options.enabled !== false,paidActions:options.paid !== false});
      if (action === 'billing') return json({ lines:[{id:'software',name:'ASCII VJ Remix',interval:'month',offer:{seats:1}}],payments:[{receipt:{id:'in_paid',paidAt:now,amountCents:1000},items:[{orderLineId:'software',amountCents:1000}]}],work:[],reviews:[],refunds:refund ? [{request:refund,amountCents:1000,state:'pending'}] : [],cancellation:null });
      if (action === 'refunds') {
        if (options.lostRefund && !refund) { refund=body; return route.abort('failed'); }
        refund=body; return json({state:'pending'});
      }
      if (action === 'complimentary') { grant=body; return json({id:body.id,state:'pending'},202); }
      if (action === 'list') return json({grants:grant ? [{...grant,state:'queued',grantedAt:now}] : [],cursor:''});
      if (action === 'recover' || action === 'paid-recover') return json({key});
      return json({ok:true});
    }
    return json({rows:[],orders:[],products:[],totals:{},pagination:{hasMore:false}});
  });
  return calls;
}
async function axe(page: Page, selector: string) {
  await page.route('**/__management-axe.js', route => route.fulfill({path:path.resolve('node_modules/axe-core/axe.min.js'),contentType:'application/javascript'}));
  await page.addScriptTag({url:'/__management-axe.js'});
  const violations = await page.evaluate(async selector => (await (window as any).axe.run(document.querySelector(selector), {rules:{'color-contrast':{enabled:false}}})).violations,selector);
  expect(violations).toEqual([]);
}
for (const lang of ['en','es']) test(`private order license controls, scoped download and explicit cancellation (${lang})`, async ({page}, testInfo) => {
  await page.setViewportSize({width:390,height:844});
  const calls = await fixture(page);
  await page.goto(`${lang === 'es' ? '/es' : ''}/order-success/?orderToken=${orderToken}`,{waitUntil:'domcontentloaded'});
  const root = page.locator('.store-software');
  await expect(root.getByRole('heading',{name:'ASCII VJ Remix'})).toBeVisible();
  await expect(root.locator('[name="license-key"]')).toHaveCount(0);
  await root.getByRole('button',{name:lang === 'en' ? 'Show license key' : 'Mostrar clave de licencia',exact:true}).click();
  await expect(root.locator('[name="license-key"]')).toHaveValue(key);
  await root.getByRole('button',{name:lang === 'en' ? 'Hide license key' : 'Ocultar clave de licencia'}).click();
  await expect(root.locator('[name="license-key"]')).toHaveCount(0);
  await expect(root.getByRole('link',{name:/2.0.0/})).toHaveAttribute('href',/private-download-token/);
  await root.locator('summary').click();
  expect(calls.filter(call => call.path.endsWith('/cancel'))).toHaveLength(0);
  await root.getByRole('button',{name:lang === 'en' ? 'Confirm' : 'Confirmar',exact:true}).click();
  await expect(root.locator('details')).toHaveCount(0);
  expect(calls.find(call => call.path.endsWith('/cancel'))?.body.token).toBe('private-management-token');
  await axe(page,'.store-software'); await expectNoHorizontalOverflow(page);
  await page.screenshot({path:testInfo.outputPath('customer.png'),fullPage:true});
});
test('hosted setup returns through verified completion and existing invoice recovery',async ({page}, testInfo) => {
  const calls=await fixture(page);
  await page.goto(`/order-success/?orderToken=${orderToken}&billing_session=cs_test_complete`,{waitUntil:'domcontentloaded'});
  await expect(page.locator('.store-software h3').first()).toHaveText('ASCII VJ Remix');
  expect(calls.find(call=>call.path.endsWith('/card-complete'))?.body.sessionId).toBe('cs_test_complete');
  expect(page.url()).not.toContain('billing_session');
  await page.route('https://invoice.stripe.com/**',route=>route.fulfill({body:'Hosted invoice fixture'}));
  await page.getByRole('button',{name:'Review and pay securely'}).click();
  await expect(page).toHaveURL('https://invoice.stripe.com/i/fixture');
  expect(calls.find(call=>call.path.endsWith('/invoice-page'))?.body.invoiceId).toBe('in_due');
});
test('operator refund retries preserve money request identity and complimentary issuance is explicit',async ({page}, testInfo)=>{
  const calls=await fixture(page,{lostRefund:true});
  await page.goto('/admin/?tab=store-orders',{waitUntil:'domcontentloaded'});
  const root=page.locator('#admin-software-management'); await expect(root).toBeVisible(); await root.locator(':scope > summary').click();
  await root.getByLabel('Order token',{exact:true}).fill(orderToken); await root.getByRole('button',{name:'Load order',exact:true}).click();
  await expect(root.getByRole('heading',{name:'License fulfillment'})).toBeVisible();
  await root.locator('details').filter({hasText:'in_paid'}).locator('summary').click();
  await root.getByLabel('Refund amount (USD)',{exact:true}).fill('10'); await root.getByRole('checkbox').first().check();
  await root.getByRole('button',{name:'Refund',exact:true}).click();
  await expect(root.getByRole('status')).toContainText('Unable');
  await root.getByRole('button',{name:'Refund',exact:true}).click();
  await expect(root.getByRole('status')).toHaveText('Up to date.');
  const refunds=calls.filter(call=>call.path.endsWith('/refunds'));expect(refunds).toHaveLength(2);expect(refunds[0].body).toEqual(refunds[1].body);expect(refunds[0].csrf).toBe('csrf-management-test');
  await root.getByLabel('Recipient email',{exact:true}).fill('recipient@example.test');
  await root.getByRole('checkbox').last().check(); await root.getByRole('button',{name:'Issue license',exact:true}).click();
  await expect(root.getByRole('heading',{name:'recipient@example.test'})).toBeVisible();
  expect(calls.find(call=>call.path.endsWith('/complimentary'))?.body.policy).toEqual({kind:'lifetime'});
  await axe(page,'#admin-software-management');await expectNoHorizontalOverflow(page);
  await page.screenshot({path:testInfo.outputPath('admin.png'),fullPage:true});
});
test('limited operator sees complimentary actions only and disabled pilot stays hidden',async ({page}, testInfo)=>{
  await fixture(page,{paid:false});await page.goto('/admin/?tab=store-orders',{waitUntil:'domcontentloaded'});
  const root=page.locator('#admin-software-management');await expect(root).toBeVisible();await root.locator('summary').click();
  await expect(root.getByRole('heading',{name:'Issue a complimentary license'})).toBeVisible();await expect(root.getByLabel('Order token',{exact:true})).toHaveCount(0);
  await page.unroute(`${worker}/**`);await fixture(page,{enabled:false});await page.reload({waitUntil:'domcontentloaded'});await expect(root).toBeHidden();
  await page.goto(`/order-success/?orderToken=${orderToken}`,{waitUntil:'domcontentloaded'});await expect(page.locator('[data-store-order-body]')).toBeVisible();await expect(page.locator('.store-software')).toHaveCount(0);
});

import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { expectNoHorizontalOverflow } from './helpers/mobile';

const orderToken = `store-order-${'a'.repeat(64)}`;
const now = Date.UTC(2026, 10, 4);
const key = 'DW-TEST-KEY-FIXTURE';
const base = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4002';
const worker = process.env.PLAYWRIGHT_WORKER_BASE_URL || 'http://127.0.0.1:8989';
const headers = { 'content-type': 'application/json', 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type,x-store-admin-csrf' };

async function fixture(page: Page, options: { paid?: boolean; enabled?: boolean; lostRefund?: boolean; lostAdministration?: boolean; paginated?: boolean; lostWithdrawal?: boolean } = {}) {
  const calls: { path: string; body: any; csrf?: string }[] = [];
  let cancelled = false, refund: any, grant: any, currentKey=key, generation=1, devices=[{installation:'test-mac',revision:0}];
  const operations=new Map<string,any>();
  let withdrawn=false;
  await page.route(`${worker}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = request.postDataJSON() || {};
    calls.push({ path: url.pathname, body, csrf: request.headers()['x-store-admin-csrf'] });
    const json = (data: any, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(data) });
    const action = url.pathname.split('/').at(-1);
    if (url.pathname === `/api/orders/${orderToken}`) return json({ orderToken, status: 'confirmed', fulfillmentReady: true, totals: {totalCents:1000,currency:'USD'}, items: [{name:'ASCII VJ Remix',quantity:1,subtotalCents:1000,fulfillmentType:'digital'}], ...(options.enabled === false ? {} : {software:{token:'private-management-token'}}) });
    if(action==='administration') {
      if(body.action==='status')return json({generation,seats:2,revoked:false,installations:devices});
      if(body.action==='history')return json({entries:[...operations.values()],cursor:null});
      if(!operations.has(body.id)) {
        if(body.action==='replace'){currentKey='DW-REPLACED-KEY';generation++;}
        if(body.action==='reset'){devices=[];generation++;}
        if(body.action==='deactivate')devices=devices.filter(d=>d.installation!==body.installation);
        operations.set(body.id,{operation:body.id,action:body.action,at:now,actor:'customer'});
        if(options.lostAdministration)return route.abort('failed');
      }
      return json(operations.get(body.id));
    }
    if (url.pathname.includes('/software/')) {
      if (action === 'status') return json({ licenses: [{name:'ASCII VJ Remix',lineId:'software',offer:{seats:2},issued:true,coverage:[{kind:'term',start:0,end:now+86400000}],releases:[{id:'build-2',version:'2.0.0',platform:'darwin-aarch64',url:`${worker}/api/orders/${orderToken}/software/download?token=private-download-token`}]}],renewal:{status:'active',cancelled},invoices:[{id:'in_due',status:'open',amountCents:1000,createdAt:now,payable:true}],invoicesCursor:options.paginated?'in_due':null });
      if (action === 'invoices') return json({invoices:[{id:'in_older',status:'paid',amountCents:900,createdAt:now-86400000,payable:false}],invoicesCursor:null});
      if (action === 'recover') return json({key:currentKey});
      if (action === 'cancel') { cancelled = true; return json({cancelled:true}); }
      if (action === 'card-complete') return json({updated:true});
      if (action === 'card-setup') return json({url:'https://checkout.stripe.com/c/pay/fixture'});
      if (action === 'invoice-page') return json({url:'https://invoice.stripe.com/i/fixture'});
    }
    if (url.pathname === '/admin/session') return json({user:{email:'operator@example.test',role:options.paid === false ? 'limited_admin' : 'super_admin',accessScopes:['store']},csrfToken:'csrf-management-test'});
    if (url.pathname.includes('/admin/store/licenses/')) {
      if (action === 'config') return json({enabled:options.enabled !== false,paidActions:options.paid !== false});
      if (action === 'billing') return json({ lines:[{id:'software',name:'ASCII VJ Remix',interval:'month',offer:{seats:1}}],payments:[{receipt:{id:'in_paid',paidAt:now,amountCents:1000},items:[{orderLineId:'software',amountCents:1000}]}],work:[],reviews:[],refunds:refund ? [{request:refund,amountCents:1000,state:'pending'}] : [],cancellation:null,cursors:options.paginated?{payments:'payment:in_paid'}:{} });
      if (action === 'history') return json({entries:[{receipt:{id:'in_older',paidAt:now-86400000,amountCents:900},items:[]}],cursor:null});
      if (action === 'releases') {
        if(body.action==='withdraw') {
          if(!withdrawn){withdrawn=true;if(options.lostWithdrawal)return route.abort('failed');}
          return json({operation:body.id,action:'withdraw'});
        }
        return json({releases:body.cursor?[{id:'build-1',version:'1.0.0',platform:'darwin-aarch64',withdrawn:true}]:[{id:'build-2',version:'2.0.0',platform:'darwin-aarch64',withdrawn}],cursor:body.cursor?null:'build-2'});
      }
      if (action === 'refunds') {
        if (options.lostRefund && !refund) { refund=body; return route.abort('failed'); }
        refund=body; return json({state:'pending'});
      }
      if (action === 'complimentary') { grant=body; return json({id:body.id,state:'pending'},202); }
      if (action === 'list') return json({grants:grant ? [{...grant,state:'queued',grantedAt:now}] : [],cursor:''});
      if (action === 'recover' || action === 'paid-recover') return json({key:currentKey});
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
  await page.goto('/admin/?tab=store-licenses',{waitUntil:'domcontentloaded'});
  const root=page.locator('#admin-software-management'); await expect(root).toBeVisible();
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
test('operator withdrawal retries preserve identity and history pages append',async ({page})=>{
  const calls=await fixture(page,{paginated:true,lostWithdrawal:true});
  await page.goto('/admin/?tab=store-licenses',{waitUntil:'domcontentloaded'});
  const root=page.locator('#admin-software-management');
  await root.getByLabel('Order token',{exact:true}).fill(orderToken);await root.getByRole('button',{name:'Load order',exact:true}).click();
  await root.getByRole('button',{name:'Load more payments',exact:true}).click();
  await expect(root.locator('summary').filter({hasText:'in_older'})).toBeVisible();
  expect(calls.find(c=>c.path.endsWith('/history'))?.body).toEqual({orderToken,kind:'payments',cursor:'payment:in_paid'});
  await root.getByRole('button',{name:'Load releases',exact:true}).click();
  await root.getByRole('button',{name:'Load more',exact:true}).click();
  await expect(root.getByText('1.0.0 · darwin-aarch64',{exact:true})).toBeVisible();
  await root.locator('summary').filter({hasText:'Withdraw release'}).click();
  await root.getByRole('button',{name:'Confirm',exact:true}).click();
  await expect(root.getByRole('status')).toContainText('Unable');
  await root.getByRole('button',{name:'Confirm',exact:true}).click();
  await expect(root.getByRole('status')).toHaveText('Up to date.');
  await expect(root.getByText('Withdrawn',{exact:true})).toBeVisible();
  const attempts=calls.filter(c=>c.path.endsWith('/releases')&&c.body.action==='withdraw');
  expect(attempts).toHaveLength(2);expect(attempts[0].body).toEqual(attempts[1].body);expect(attempts[0].csrf).toBe('csrf-management-test');
});
test('customer invoice history appends without replacing current billing',async ({page})=>{
  const calls=await fixture(page,{paginated:true});
  await page.goto(`/order-success/?orderToken=${orderToken}`,{waitUntil:'domcontentloaded'});
  const root=page.locator('.store-software');await root.getByRole('button',{name:'Load more',exact:true}).click();
  await expect(root.locator('.store-software__invoice')).toHaveCount(2);
  await expect(root.getByRole('button',{name:'Load more',exact:true})).toHaveCount(0);
  expect(calls.find(c=>c.path.endsWith('/invoices'))?.body.cursor).toBe('in_due');
  await expect(root.getByRole('button',{name:'Review and pay securely'})).toBeVisible();
});
test('limited operator sees complimentary actions only and disabled licensing has no controls',async ({page}, testInfo)=>{
  await fixture(page,{paid:false});await page.goto('/admin/?tab=store-licenses',{waitUntil:'domcontentloaded'});
  const root=page.locator('#admin-software-management');await expect(root).toBeVisible();
  await expect(root.getByRole('heading',{name:'Issue a complimentary license'})).toBeVisible();await expect(root.getByLabel('Order token',{exact:true})).toHaveCount(0);
  await page.unroute(`${worker}/**`);await fixture(page,{enabled:false});await page.reload({waitUntil:'domcontentloaded'});await expect(root).toContainText('License management is not enabled');await expect(root.getByRole('button')).toHaveCount(0);
  await page.goto(`/order-success/?orderToken=${orderToken}`,{waitUntil:'domcontentloaded'});await expect(page.locator('[data-store-order-body]')).toBeVisible();await expect(page.locator('.store-software')).toHaveCount(0);
});

for(const lang of ['en','es'])test(`key replacement retry and device administration (${lang})`,async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  const calls=await fixture(page,{lostAdministration:true});
  await page.goto(`${lang==='es'?'/es':''}/order-success/?orderToken=${orderToken}`,{waitUntil:'domcontentloaded'});
  const root=page.locator('.store-software');
  const manage=()=>root.getByRole('button',{name:lang==='en'?'Manage devices and key':'Administrar dispositivos y clave'}).click();
  await manage();await expect(root.getByText('test-mac',{exact:true})).toBeVisible();
  const replace=root.locator('details').filter({has:page.locator('summary',{hasText:lang==='en'?'Replace license key':'Reemplazar clave de licencia'})});
  await replace.locator('summary').click();
  const confirm=replace.getByRole('button',{name:lang==='en'?'Confirm':'Confirmar',exact:true});
  await confirm.click();await expect(root.getByRole('status')).toContainText(lang==='en'?'Unable':'No se');
  await confirm.click();
  const mutations=calls.filter(c=>c.body.action==='replace');expect(mutations).toHaveLength(2);expect(mutations[0].body.id).toBe(mutations[1].body.id);
  await root.getByRole('button',{name:lang==='en'?'Show license key':'Mostrar clave de licencia',exact:true}).click();
  await expect(root.locator('[name="license-key"]')).toHaveValue('DW-REPLACED-KEY');
  await root.getByRole('button',{name:lang==='en'?'Hide license key':'Ocultar clave de licencia'}).click();
  await manage();
  const remove=root.locator('details').filter({has:page.locator('summary',{hasText:lang==='en'?'Deactivate this installation':'Desactivar esta instalación'})});
  await remove.locator('summary').click();await remove.getByRole('button',{name:lang==='en'?'Confirm':'Confirmar',exact:true}).click();
  await remove.getByRole('button',{name:lang==='en'?'Confirm':'Confirmar',exact:true}).click();
  await manage();await expect(root.getByText('test-mac',{exact:true})).toHaveCount(0);
  await root.getByRole('button',{name:lang==='en'?'Show license history':'Mostrar historial de licencia'}).click();
  await expect(root.getByText(lang==='en'?/Key replaced/:/Clave reemplazada/)).toBeVisible();
  await expectNoHorizontalOverflow(page);await axe(page,'.store-software');
  await page.screenshot({path:testInfo.outputPath(`license-administration-${lang}.png`),fullPage:true});
});

for(const lang of ['en','es'])test(`licenses have a dedicated tab and dashboard help (${lang})`,async({page},testInfo)=>{
  await fixture(page);
  await page.goto(`${lang==='es'?'/es':''}/admin/?tab=store-licenses`,{waitUntil:'domcontentloaded'});
  const root=page.locator('#admin-software-management');
  await expect(page.locator('#admin-tab-store-licenses')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#admin-panel-store-orders #admin-software-management')).toHaveCount(0);
  await expect(root.getByRole('heading',{name:lang==='es'?'Licencias de software':'Software licenses',exact:true})).toBeVisible();
  const help=root.getByRole('button',{name:lang==='es'?'Acerca de Cobertura de actualizaciones':'About Update coverage',exact:true});
  await help.click();
  const tooltipId=await help.getAttribute('aria-describedby');
  await expect(page.locator('#'+tooltipId)).toBeVisible();
  await expect(page.locator('#'+tooltipId)).toContainText(lang==='es'?'Nunca desactiva':'never disables');
  await help.press('Escape');await expect(page.locator('#'+tooltipId)).toBeHidden();await expect(help).toBeFocused();
  await root.getByLabel(lang==='es'?'Token del pedido':'Order token',{exact:true}).fill(orderToken);
  await root.getByRole('button',{name:lang==='es'?'Cargar pedido':'Load order',exact:true}).click();
  await axe(page,'#admin-panel-store-licenses');await expectNoHorizontalOverflow(page);
  await page.setViewportSize({width:390,height:844});
  await expect(root).toBeVisible();await expectNoHorizontalOverflow(page);
  const mobileTabs=page.locator('.admin-mobile-tab-select select').first();
  await mobileTabs.selectOption('store-orders');await expect(root).toBeHidden();
  await mobileTabs.selectOption('store-licenses');await expect(root).toBeVisible();
  await page.screenshot({path:testInfo.outputPath(`licenses-${lang}.png`),fullPage:true});
});

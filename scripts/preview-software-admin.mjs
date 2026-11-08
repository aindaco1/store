#!/usr/bin/env node
// Disposable, loopback-only preview of the real dashboard and Workers. Never
// reads .dev.vars, contacts providers, or changes a deployed environment.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createAdminLoginUrl} from '../worker/src/admin-auth.js';
import {orderToken} from '../experiments/software-licensing/recovery-fixture.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const licensing=path.resolve(process.env.LICENSING_REPO || path.join(root,'../dust-wave-licensing'));
const require=createRequire(path.join(licensing,'package.json'));
const {Miniflare,convertV4MiniflareOptions}=require('miniflare'),{buildSync}=require('esbuild');
const port=Number(process.env.SOFTWARE_ADMIN_PREVIEW_PORT || 8899);
assert.ok(Number.isInteger(port) && port>=1024 && port<=65535);
const origin=`http://127.0.0.1:${port}`,secret=()=>randomBytes(32).toString('hex');
const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'store-licensing-admin-')));
const site=path.join(temp,'site');await fs.chmod(temp,0o700);
const adminSecret=secret(),email='operator@example.invalid';
const bindings={APP_MODE:'test',SOFTWARE_LICENSING_ENABLED:'true',SOFTWARE_CHECKOUT_ENABLED:'false',ADMIN_SECRET:adminSecret,LICENSING_ADMIN_SECRET:adminSecret,LICENSING_KEY_SECRET:secret(),ADMIN_SESSION_SECRET:secret(),ADMIN_USERS_JSON:JSON.stringify([{email,role:'super_admin'}]),SITE_BASE:origin,CANONICAL_SITE_BASE:origin,WORKER_BASE:origin,CORS_ALLOWED_ORIGIN:origin,TAX_PROVIDER:'flat',SALES_TAX_RATE:'0.10',STORE_EMAIL_DRY_RUN:'true',RESEND_API_KEY:'dry-run',OBSERVABILITY_SAMPLE_RATE:'0'};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon'};
async function staticFile(url) {
  if(url.origin!==origin) return null;
  let filename;
  try {
    filename=path.resolve(site,'.'+decodeURIComponent(url.pathname));
    if((await fs.stat(filename)).isDirectory())filename=path.join(filename,'index.html');
    filename=await fs.realpath(filename);
    if(!filename.startsWith(site+path.sep))return null;
    return new Response(await fs.readFile(filename),{headers:{'Content-Type':types[path.extname(filename)] || 'application/octet-stream','Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});
  } catch{return null;}
}
let mf,server,closing=false;
async function close(){if(closing)return;closing=true;server?.close();await mf?.dispose();await fs.rm(temp,{recursive:true,force:true});}
process.once('SIGINT',()=>close().then(()=>process.exit(0)));
process.once('SIGTERM',()=>close().then(()=>process.exit(0)));
try {
  const config=path.join(temp,'config.yml');
  await fs.writeFile(config,JSON.stringify({url:origin,baseurl:'',platform:{site_url:origin,worker_url:origin},admin:{production_site_url:origin,production_worker_url:origin,turnstile_site_key:''},admin_production_site_url:origin,admin_production_worker_url:origin}),{mode:0o600});
  execFileSync('bundle',['exec','jekyll','build','--quiet','--config',path.join(root,'_config.yml')+','+config,'--destination',site],{cwd:root,stdio:'pipe',timeout:180000});
  const script=(entry,node=false)=>buildSync({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:node?'node':'browser',...(node?{banner:{js:'import {createRequire} from "node:module"; const require=createRequire("/worker.js");'}}:{})}).outputFiles[0].text;
  const {signingFixture}=await import(pathToFileURL(path.join(licensing,'test/signature-fixture.mjs')));const signer=signingFixture();
  const outbound=async request=>await staticFile(new URL(request.url)) || new Response('External provider disabled in local preview',{status:503});
  mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',resourcePersistencePath:path.join(temp,'storage'),workers:[
    {name:'store',modules:true,script:script(path.join(root,'experiments/software-licensing/recovery-worker.js'),true),compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat'],bindings,kvNamespaces:['STORE_STATE','RATELIMIT'],durableObjects:{STORE_INVENTORY_COORDINATOR:{className:'StoreInventoryCoordinator',useSQLite:true}},serviceBindings:{LICENSING_SERVICE:'licensing'},outboundService:outbound},
    {name:'licensing',modules:true,script:script(path.join(licensing,'src/worker.js')),compatibilityDate:'2026-10-30',bindings:{APP_MODE:'test',ADMIN_SECRET:adminSecret,TOKEN_SECRET:secret(),TOKEN_KEY_ID:'preview',UPDATER_PUBLIC_KEY:signer.publicKey},durableObjects:{PUBLISHER:{className:'Publisher',useSQLite:true}},r2Buckets:['ARTIFACTS'],outboundService:outbound}
  ]}));
  const post=async(worker,route,data)=>{
    const result=await worker.fetch(origin+route,{method:'POST',headers:{Authorization:'Bearer '+adminSecret,'Content-Type':'application/json'},body:JSON.stringify(data)});
    assert.ok(result.ok,`Synthetic seed failed: ${route} (${result.status})`);return result.json();
  };
  const store=await mf.getWorker('store'),authority=await mf.getWorker('licensing');
  const license=await post(store,'/fixture/seed',{});
  const bytes=Buffer.from('Synthetic preview artifact. This is not an application release.');
  await(await mf.getR2Bucket('ARTIFACTS','licensing')).put('preview.tar.gz',bytes);
  for(const [id,version,at] of [['preview-covered','1.0.0',150000],['preview-refunded','1.1.0',350000]])await post(authority,'/internal/publish',{id,product:'ascii-vj-remix',key:'preview.tar.gz',major:1,releasedAt:at,update:{version,platform:'darwin-aarch64',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),signature:signer.sign(bytes)}});
  await post(authority,'/v1/activate',{key:license.key,installation:'synthetic-mac'});
  bindings.STORE_STATE=await mf.getKVNamespace('STORE_STATE','store');
  server=createServer(async(req,res)=>{
    try {
      if(req.headers.host!==new URL(origin).host){res.writeHead(403);return res.end();}
      const url=new URL(req.url,origin);
      if(req.method==='GET' && ['/','/preview/start'].includes(url.pathname)) {
        const login=await createAdminLoginUrl(bindings,{email,params:{tab:'store-orders'}});assert.ok(login);
        res.writeHead(302,{'Location':login,'Cache-Control':'no-store'});return res.end();
      }
      const response=(req.method==='GET' && await staticFile(url)) || await store.fetch(new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})}));
      const headers=Object.fromEntries(response.headers);if(response.headers.getSetCookie().length)headers['set-cookie']=response.headers.getSetCookie();
      res.writeHead(response.status,headers);if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
    } catch {res.writeHead(500);res.end('Local preview failed');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  console.log(JSON.stringify({ready:true,url:origin+'/preview/start',orderToken,synthetic:true,paidCheckoutEnabled:false,scheduledLicensingCapture:false,realEmails:0,livePayments:0}));
} catch(error){await close();console.error(error.message);process.exitCode=1;}

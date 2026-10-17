import {test as base,expect,_electron as electron,chromium,firefox,webkit} from '@playwright/test';
import {mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
export * from '@playwright/test';
export {expect};
const output=process.env.ACCEPTANCE_ISTANBUL_OUTPUT!;
const fixtureRequire=createRequire(join(process.cwd(),'package.json'));
const contexts=new WeakSet<any>();
const browsers=new WeakSet<any>();
const browserTypes=new WeakSet<any>();
const pages=new Set<any>();
function store(payload:any,runtime='chromium'){
  if(!payload||!/^[a-zA-Z0-9-]+$/.test(payload.document_id))throw Error('Invalid coverage document');
  mkdirSync(output,{recursive:true});
  const file=join(output,`page-${process.pid}-${payload.document_id}.json`);
  writeFileSync(file+'.tmp',JSON.stringify({schema:'istanbul-runtime-snapshot-v1',runtime,
    versions:{playwright:fixtureRequire('@playwright/test/package.json').version},captured_at:new Date().toISOString(),...payload}));
  renameSync(file+'.tmp',file);
}
function init(){
  const g=globalThis as any;
  if(g.__acceptanceIstanbulDocument)return;
  g.__acceptanceIstanbulDocument=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  let pending:Promise<any>|undefined;
  let periodicSnapshots=0;
  g.__acceptanceIstanbulSave=async(force=false)=>{
    if(pending){await pending;if(!force)return;}
    if(!force)periodicSnapshots++;
    pending=g.__acceptanceIstanbulBinding({document_id:g.__acceptanceIstanbulDocument,periodic_snapshots:periodicSnapshots,
      coverage:g.__coverage__||{},url:location.href,user_agent:navigator.userAgent,
      phase:force?'explicit-flush':'periodic'});
    try{await pending;}finally{pending=undefined;}
  };
  setInterval(()=>{g.__acceptanceIstanbulSave().catch(()=>{});},10000);
  addEventListener('pagehide',()=>{g.__acceptanceIstanbulSave(true).catch(()=>{});});
}
async function flush(page:any){
  if(page.isClosed())return;
  for(const frame of page.frames()){
    try{await frame.evaluate(async()=>{await (globalThis as any).__acceptanceIstanbulSave?.(true);});}
    catch(e:any){if(!/detached|destroyed|closed|navigat/i.test(e.message))throw e;}
  }
}
async function trackPage(page:any){
  if(pages.has(page))return;pages.add(page);
  page.on('close',()=>pages.delete(page));
  for(const method of ['close','reload','goto','goBack','goForward']){
    const original=page[method].bind(page);
    page[method]=async(...args:any[])=>{await flush(page);return original(...args);};
  }
  await page.evaluate(init).catch(()=>{});
}
async function trackContext(ctx:any,runtime='chromium'){
  if(contexts.has(ctx))return ctx;contexts.add(ctx);
  await ctx.exposeBinding('__acceptanceIstanbulBinding',(_source:any,payload:any)=>store(payload,runtime));
  await ctx.addInitScript(init);
  ctx.on('page',(page:any)=>{trackPage(page).catch(()=>{});});
  for(const page of ctx.pages())await trackPage(page);
  const close=ctx.close.bind(ctx);ctx.close=async(...args:any[])=>{for(const p of ctx.pages())await flush(p);return close(...args);};
  return ctx;
}
async function trackBrowser(browser:any){
  if(browsers.has(browser))return browser;browsers.add(browser);
  const runtime=browser.browserType().name();
  const newContext=browser.newContext.bind(browser);browser.newContext=async(...args:any[])=>trackContext(await newContext(...args),runtime);
  const newPage=browser.newPage.bind(browser);browser.newPage=async(...args:any[])=>{const page=await newPage(...args);await trackContext(page.context(),runtime);return page;};
  for(const ctx of browser.contexts())await trackContext(ctx,runtime);
  const close=browser.close.bind(browser);browser.close=async(...args:any[])=>{for(const ctx of browser.contexts())for(const p of ctx.pages())await flush(p);return close(...args);};
  return browser;
}
function trackBrowserTypes(playwright:any){
  for(const name of ['chromium','firefox','webkit']){
    const type=playwright[name];if(browserTypes.has(type))continue;browserTypes.add(type);
    for(const method of ['launch','connect','connectOverCDP']){
      if(typeof type[method]!=='function')continue;
      const original=type[method].bind(type);type[method]=async(...args:any[])=>trackBrowser(await original(...args));
    }
    const persistent=type.launchPersistentContext.bind(type);
    type.launchPersistentContext=async(...args:any[])=>trackContext(await persistent(...args),name);
  }
}
trackBrowserTypes({chromium,firefox,webkit});
export const test=base.extend<{}, {coverageRuntime:void}>({
  coverageRuntime:[async({playwright},use)=>{trackBrowserTypes(playwright);await use();for(const p of pages)await flush(p);},{scope:'worker',auto:true}],
  browser:[async({browser,coverageRuntime},use)=>{await trackBrowser(browser);await use(browser);for(const p of pages)await flush(p);},{scope:'worker'}]
});
export const _electron={...electron,launch:async(...args:Parameters<typeof electron.launch>)=>{
  const opts={...args[0],args:['-r',process.env.ACCEPTANCE_ISTANBUL_HOOK!,...(args[0]?.args||[])]};
  const app=await electron.launch(opts);
  await trackContext(app.context(),'electron-renderer');
  const close=app.close.bind(app);app.close=async()=>{
    try{
      for(const p of app.windows())await flush(p);
      await app.evaluate(async()=>{await (globalThis as any).__acceptanceIstanbulNativeFlush?.();});
    }catch(error:any){console.warn('COVERAGE_COLLECTOR_GAP: native final snapshot: '+error.message);}
    return close();
  };
  return app;
}};

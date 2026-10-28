// Exercise the real adapters with synthetic code only, before product-case replay.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import instrument from 'istanbul-lib-instrument';
import {tools,sha} from './provider.mjs';
const [project,output,electronExecutable]=process.argv.slice(2),dir=path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'package.json'),JSON.stringify({type:'module',private:true}));
const req=createRequire(path.join(project,'package.json'));
const cli=path.join(path.dirname(req.resolve('@playwright/test/package.json')),'cli.js');
const electron=electronExecutable || req('electron');
const source='function probe(a,b,v){if(a){if(b){return v ?? 7;}return 2;}return 3;} probe(true,true,null);probe(true,true,4);probe(true,false,1);probe(false,false,1);';
function code(name,input=source){const tool=instrument.createInstrumenter(tools().options);return tool.instrumentSync(input,'/__acceptance_source__/'+name);}
fs.writeFileSync(path.join(output,'node.cjs'),code('node.js'));
fs.writeFileSync(path.join(output,'worker.cjs'),code('worker.js')+'\nsetTimeout(()=>{},1000);');
fs.writeFileSync(path.join(output,'node-workers.cjs'),`const {Worker}=require('node:worker_threads');\n${code('node-workers.js')}\nfor(let i=0;i<4;i++)new Worker(${JSON.stringify(path.join(output,'worker.cjs'))});`);
const nodeProbe=spawnSync(process.execPath,['-r',path.join(dir,'node-hook.cjs'),path.join(output,'node.cjs')],{env:{...process.env,ACCEPTANCE_ISTANBUL_OUTPUT:path.join(output,'raw')},encoding:'utf8'});
const workerProbe=spawnSync(process.execPath,['-r',path.join(dir,'node-hook.cjs'),path.join(output,'node-workers.cjs')],{env:{...process.env,ACCEPTANCE_ISTANBUL_OUTPUT:path.join(output,'raw')},encoding:'utf8'});
fs.symlinkSync(path.join(project,'node_modules'),path.join(output,'node_modules'));
fs.copyFileSync(path.join(dir,'playwright-fixture.ts'),path.join(output,'fixture.ts'));
const stress='function stress(v){let n=0;'+Array.from({length:4000},()=> 'n += v ? 1 : 2;').join('\n')+'return n;} stress(true);stress(false);';
const html='<html><body>coverage probe<script>'+code('renderer.js')+'\n'+code('stress.js',stress)+'</script></body></html>';
fs.writeFileSync(path.join(output,'probe.html'),html);
fs.writeFileSync(path.join(output,'connected-probe.html'),html);
fs.writeFileSync(path.join(output,'standalone-probe.html'),html);
const htmlURL=pathToFileURL(path.join(output,'probe.html')).href;
fs.writeFileSync(path.join(output,'preload.cjs'),code('preload.js')+'\n'+fs.readFileSync(path.join(dir,'preload-footer.cjs'),'utf8'));
fs.writeFileSync(path.join(output,'main.cjs'),code('main.js')+`\nconst {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const win=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(path.join(output,'preload.cjs'))},sandbox:true,contextIsolation:true}});win.loadURL(${JSON.stringify(htmlURL)});});`);
fs.writeFileSync(path.join(output,'probe.spec.ts'),`import {test,expect,_electron} from './fixture';
test('browser source counters survive reload and nested branches',async({page})=>{
 await page.goto(${JSON.stringify(htmlURL)});
 expect(await page.evaluate(()=>Object.keys((globalThis as any).__coverage__||{}))).toContain('/__acceptance_source__/renderer.js');
 await page.goto(${JSON.stringify(htmlURL+'?navigation=second')});
 await page.reload();
 expect(await page.evaluate(()=>Object.keys((globalThis as any).__coverage__||{}))).toContain('/__acceptance_source__/renderer.js');
});
test('explicit browser server connection is captured',async({playwright})=>{
 const server=await playwright.chromium.launchServer({channel:'chrome'});
 const browser=await playwright.chromium.connect(server.wsEndpoint());
 try{const context=await browser.newContext();const page=await context.newPage();
 await page.goto(${JSON.stringify(pathToFileURL(path.join(output,'connected-probe.html')).href)});
 expect(await page.evaluate(()=>Object.keys((globalThis as any).__coverage__||{}))).toContain('/__acceptance_source__/renderer.js');
 await context.close();
 }finally{await browser.close();await server.close();}
});
test('native main, sandbox preload and renderer counters',async()=>{
 const app=await _electron.launch({executablePath:${JSON.stringify(electron)},args:[${JSON.stringify(path.join(output,'main.cjs'))}]});
 try{const page=await app.firstWindow();await page.waitForLoadState();
 expect(await page.evaluate(()=>Object.keys((globalThis as any).__coverage__||{}))).toContain('/__acceptance_source__/renderer.js');
 expect((await page.content()).includes('coverage probe')).toBe(true);
 await page.screenshot({path:${JSON.stringify(path.join(output,'native-large-report.png'))},fullPage:true,timeout:5000});
 const started=Date.now();
 while(Date.now()-started<12000){const readStarted=Date.now();await page.content();expect(Date.now()-readStarted).toBeLessThan(5000);await page.screenshot({timeout:5000});}
 }finally{await app.close();}
});`);
fs.writeFileSync(path.join(output,'playwright.config.ts'),`import {defineConfig} from '@playwright/test';export default defineConfig({testDir:${JSON.stringify(output)},testMatch:'probe.spec.ts',workers:1,retries:0,timeout:30000,outputDir:${JSON.stringify(path.join(output,'results'))},use:{headless:true,channel:'chrome'}});`);
const result=spawnSync(process.execPath,[cli,'test','--config',path.join(output,'playwright.config.ts')],{cwd:project,env:{...process.env,ACCEPTANCE_ISTANBUL_OUTPUT:path.join(output,'raw'),ACCEPTANCE_ISTANBUL_HOOK:path.join(dir,'node-hook.cjs')},encoding:'utf8'});
fs.writeFileSync(path.join(output,'standalone.ts'),`import {chromium} from './fixture.ts';
const browser=await chromium.launch({channel:'chrome'});
try{const context=await browser.newContext();const page=await context.newPage();
await page.goto(${JSON.stringify(pathToFileURL(path.join(output,'standalone-probe.html')).href)});
await context.close();}finally{await browser.close();}`);
const standalone=spawnSync(process.execPath,[path.join(output,'standalone.ts')],{cwd:project,env:{...process.env,ACCEPTANCE_ISTANBUL_OUTPUT:path.join(output,'raw')},encoding:'utf8'});
fs.writeFileSync(path.join(output,'standalone.log'),standalone.stdout+standalone.stderr);
fs.writeFileSync(path.join(output,'execution.log'),result.stdout+result.stderr);
const snapshots=fs.existsSync(path.join(output,'raw'))?fs.readdirSync(path.join(output,'raw')).filter(n=>n.endsWith('.json')).map(n=>({file:n,data:JSON.parse(fs.readFileSync(path.join(output,'raw',n)))})):[];
const runtimes=[...new Set(snapshots.map(s=>s.data.runtime))];
const expected=['node','chromium','electron-main','electron-preload','electron-renderer'];
const missing=expected.filter(r=>!runtimes.includes(r));
const coverage=(await import('istanbul-lib-coverage')).default;
const checks=snapshots.filter(s=>Object.keys(s.data.coverage).length).map(s=>({runtime:s.data.runtime,summary:coverage.createCoverageMap(s.data.coverage).getCoverageSummary().toJSON()}));
const countersComplete=checks.every(c=>c.summary.lines.covered===c.summary.lines.total&&c.summary.branches.covered===c.summary.branches.total);
const workerSnapshots=snapshots.filter(s=>s.data.thread_id>0&&Object.keys(s.data.coverage).some(n=>n.endsWith('/worker.js')));
const workersComplete=workerSnapshots.length===4;
const largePayload=checks.some(c=>c.summary.branches.total>8000),periodic=snapshots.some(s=>s.data.runtime==='electron-renderer'&&s.data.periodic_snapshots>0);
const customConnection=snapshots.some(s=>s.data.runtime==='chromium'&&s.data.url?.includes('connected-probe.html')&&Object.keys(s.data.coverage).length>0);
const standaloneVerified=standalone.status===0&&snapshots.some(s=>s.data.runtime==='chromium'&&s.data.url?.includes('standalone-probe.html')&&Object.keys(s.data.coverage).length>0);
const report={schema:'coverage-runtime-probe-v1',status:nodeProbe.status===0&&workerProbe.status===0&&workersComplete&&largePayload&&periodic&&customConnection&&standaloneVerified&&result.status===0&&!missing.length&&countersComplete?'verified':'failed',exit_code:result.status,node_exit_code:nodeProbe.status,worker_exit_code:workerProbe.status,worker_snapshots:workerSnapshots.length,large_payload_verified:largePayload,periodic_transport_verified:periodic,custom_connection_verified:customConnection,standalone_browser_verified:standaloneVerified,tools:tools(),runtimes,missing,counters_complete:countersComplete,checks,evidence:snapshots.map(s=>({path:path.join(output,'raw',s.file),sha256:sha(path.join(output,'raw',s.file))})),product_tests_executed:false};
fs.writeFileSync(path.join(output,'probe.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,exit_code:result.status,runtimes,missing,countersComplete}));
process.exitCode=report.status==='verified'?0:1;

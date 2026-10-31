// Supported Istanbul APIs own instrumentation, zero units, merging and summaries.
// This adapter only binds evidence, checks compatibility and selects tool-owned units.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import instrument from 'istanbul-lib-instrument';
import coverage from 'istanbul-lib-coverage';
const dir=path.dirname(fileURLToPath(import.meta.url)), req=createRequire(import.meta.url);
const options={esModules:true,parserPlugins:['typescript','jsx'],compact:false,preserveComments:true,
  produceSourceMap:true,coverageGlobalScope:'globalThis',coverageGlobalScopeFunc:false};
export const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
export const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const write=(p,x)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(x,null,2)+'\n');};
export function tools(){return {provider:'istanbul-source-v1',instrumenter:{name:'istanbul-lib-instrument',version:req('istanbul-lib-instrument/package.json').version},statistics:{name:'istanbul-lib-coverage',version:req('istanbul-lib-coverage/package.json').version},options,
  implementation:Object.fromEntries(['provider.mjs','probe.mjs','node-hook.cjs','preload-footer.cjs','playwright-fixture.ts','package-lock.json'].map(n=>[n,sha(path.join(dir,n))]))};}
const units=fc=>({statementMap:fc.statementMap,fnMap:fc.fnMap,branchMap:fc.branchMap});
function countsValid(fc){
  for(const kind of ['s','f'])for(const value of Object.values(fc[kind]||{}))if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid counter');
  for(const [id,values] of Object.entries(fc.b||{}))if(!Array.isArray(values)||values.length!==fc.branchMap[id]?.locations.length||values.some(v=>!Number.isSafeInteger(v)||v<0))throw Error('Invalid branch counter');
  if(Object.keys(fc.s||{}).length!==Object.keys(fc.statementMap||{}).length||Object.keys(fc.f||{}).length!==Object.keys(fc.fnMap||{}).length||Object.keys(fc.b||{}).length!==Object.keys(fc.branchMap||{}).length)throw Error('Missing coverage counters');
}
export function loadPrepared(folder,{currentTools=true}={}){
  const p=read(path.join(folder,'prepared.json'));
  if(p.schema!=='istanbul-prepared-v1')throw Error('Unsupported coverage preparation');
  if(currentTools&&digest(p.tools)!==digest(tools()))throw Error('Coverage toolchain changed; prepare/probe again');
  for(const [name,hash] of Object.entries(p.evidence))if(sha(path.join(folder,name))!==hash)throw Error('Prepared coverage evidence changed: '+name);
  const probe=read(path.join(folder,'toolchain-probe.json'));
  if(probe.status!=='verified'||probe.tools_fingerprint!==digest(p.tools))throw Error('Toolchain probe absent or incompatible');
  const runtime=read(path.join(folder,'runtime-probe.json'));
  if(runtime.status!=='verified'||digest(runtime.tools)!==digest(p.tools))throw Error('Runtime adapters not verified with this toolchain');
  for(const role of p.spec.required_runtimes||[])if(!runtime.runtimes.includes(role))throw Error('Unverified runtime '+role);
  for(const evidence of runtime.evidence)if(sha(evidence.path)!==evidence.sha256)throw Error('Runtime probe evidence changed');
  return p;
}
export function prepare(specPath,folder){
  if(fs.existsSync(path.join(folder,'prepared.json')))throw Error('Preparation exists; immutable attempts required');
  const spec=read(specPath), root=path.resolve(spec.project_root);
  const scope=new Set(spec.source_paths), dispositions=spec.dispositions||{};
  if(scope.size!==spec.source_paths.length||Object.keys(dispositions).some(p=>!scope.has(p)))throw Error('Invalid complete source inventory');
  const baseline={},files={},unsupported=[],excluded=[];
  for(const relative of scope){
    const source=path.resolve(root,relative);
    if(!source.startsWith(root+path.sep)||sha(source)!==spec.source_hashes[relative])throw Error('Source inventory hash mismatch '+relative);
    const disposition=dispositions[relative];
    if(disposition){
      if(!['non_executable','unsupported'].includes(disposition.kind)||!disposition.reason)throw Error('Invalid source disposition '+relative);
      (disposition.kind==='unsupported'?unsupported:excluded).push({path:relative,reason:disposition.reason});continue;
    }
    const original=fs.readFileSync(source,'utf8'), tool=instrument.createInstrumenter(options);
    // Stable virtual filename is the tool's identity across isolated checkouts.
    const canonical='/__acceptance_source__/'+relative;
    let generated=tool.instrumentSync(original,canonical);
    const data=tool.lastFileCoverage();
    countsValid(data);baseline[canonical]=data;
    if((spec.preload_paths||[]).includes(relative))generated+='\n'+fs.readFileSync(path.join(dir,'preload-footer.cjs'),'utf8');
    const target=path.join(folder,'instrumented',relative), backup=path.join(folder,'original',relative);
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,generated);
    fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,original);
    write(path.join(folder,'maps',relative+'.json'),tool.lastSourceMap());
    files[relative]={original_sha256:sha(backup),instrumented_sha256:sha(target),units_sha256:digest(units(data)),canonical};
  }
  write(path.join(folder,'baseline.json'),baseline);
  const actualTools=tools();
  // Synthetic nested condition + nullish expression: executes tool output, never product code.
  const synthetic='function probe(a,b,v){if(a){if(b){return v ?? 7;}return 2;}return 3;} probe(true,true,null);probe(true,true,4);probe(true,false,1);probe(false,false,1);';
  const tool=instrument.createInstrumenter(options), code=tool.instrumentSync(synthetic,'/__acceptance_source__/toolchain-probe.js');
  const context={};vm.runInNewContext(code,context);
  const summary=coverage.createCoverageMap(context.__coverage__).getCoverageSummary().toJSON();
  if(summary.lines.covered!==summary.lines.total||summary.branches.covered!==summary.branches.total||summary.branches.total<6)throw Error('Dedicated tool nested-branch probe failed');
  write(path.join(folder,'toolchain-probe.json'),{status:'verified',tools_fingerprint:digest(actualTools),synthetic_source:synthetic,synthetic_instrumented_sha256:digest(code),summary,node_versions:process.versions,product_code_executed:false});
  if(!spec.runtime_probe_path)throw Error('Runtime adapter probe required before preparation');
  fs.copyFileSync(spec.runtime_probe_path,path.join(folder,'runtime-probe.json'));
  const evidence={'baseline.json':sha(path.join(folder,'baseline.json')),'toolchain-probe.json':sha(path.join(folder,'toolchain-probe.json')),'runtime-probe.json':sha(path.join(folder,'runtime-probe.json'))};
  for(const relative of Object.keys(files))for(const prefix of ['original','instrumented','maps']){const name=prefix+'/'+relative+(prefix==='maps'?'.json':'');evidence[name]=sha(path.join(folder,name));}
  write(path.join(folder,'prepared.json'),{schema:'istanbul-prepared-v1',created_at:new Date().toISOString(),spec,spec_sha256:sha(specPath),tools:actualTools,compatibility_key:digest({source_hashes:spec.source_hashes,tools:{instrumenter:actualTools.instrumenter,statistics:actualTools.statistics,options},units:Object.fromEntries(Object.entries(files).map(([n,f])=>[n,f.units_sha256]))}),files,unsupported,excluded,evidence});
  return loadPrepared(folder);
}
export function mergeRuntime(prepared,folder){
  const p=loadPrepared(prepared), baseline=read(path.join(prepared,'baseline.json'));
  const map=coverage.createCoverageMap(baseline),snapshots=[];
  for(const name of fs.readdirSync(folder).filter(n=>n.endsWith('.json')).sort()){
    const file=path.join(folder,name),raw=read(file);
    if(raw.schema!=='istanbul-runtime-snapshot-v1'||!raw.runtime||!raw.captured_at)throw Error('Unsupported raw coverage evidence');
    for(const [canonical,fc] of Object.entries(raw.coverage)){
      if(!baseline[canonical]||fc.path!==canonical||digest(units(fc))!==digest(units(baseline[canonical])))throw Error('Incompatible coverage source/units '+canonical);
      countsValid(fc);
    }
    map.merge(raw.coverage);
    snapshots.push({path:file,sha256:sha(file),runtime:raw.runtime,versions:raw.versions,user_agent:raw.user_agent,phase:raw.phase});
  }
  if(!snapshots.length)throw Error('No runtime collector receipt; absence is not zero coverage');
  return {p,map,snapshots};
}
export function summaries(map,inventory,prepared){
  const missing=prepared.unsupported;
  const result={};
  for(const scope of ['project','changed_files','changed_lines']){
    const changes=new Map((inventory?.files||[]).map(f=>[f.path,new Set(f.changed_lines||[])]));
    const paths=scope==='project'?null:new Set(inventory?.changed_source_paths||[]);
    const selected=coverage.createCoverageMap({});
    for(const filename of map.files()){
      const relative=filename.replace('/__acceptance_source__/','');if(paths&&!paths.has(relative))continue;
      const data=structuredClone(map.fileCoverageFor(filename).toJSON());
      if(scope==='changed_lines'){
        const lines=changes.get(relative)||new Set();
        // Select tool-provided anchors only. Istanbul computes the resulting statistics.
        for(const [id,loc] of Object.entries(data.statementMap))if(!lines.has(loc.start.line)){delete data.statementMap[id];delete data.s[id];}
        for(const [id,loc] of Object.entries(data.fnMap))if(!lines.has(loc.loc.start.line)){delete data.fnMap[id];delete data.f[id];}
        for(const [id,loc] of Object.entries(data.branchMap))if(!lines.has(loc.line??loc.loc.start.line)){delete data.branchMap[id];delete data.b[id];if(data.bT)delete data.bT[id];}
      }
      selected.addFileCoverage(data);
    }
    const gaps=missing.filter(f=>!paths||paths.has(f.path));
    const summary=selected.getCoverageSummary().toJSON();
    result[scope]={status:gaps.length?'incomplete':'measured',covered:summary.lines.covered,total:summary.lines.total,pct:summary.lines.pct,
      line:{status:gaps.length?'incomplete':'measured',...summary.lines},branch:{status:gaps.length?'incomplete':'measured',...summary.branches},missing_paths:gaps.map(f=>f.path),limitations:gaps};
  }
  return result;
}
export function finish(prepared,rawFolder,receiptPath,output,inventoryPath){
  const {p,map,snapshots}=mergeRuntime(prepared,rawFolder);
  const receipt=read(receiptPath);
  if(snapshots.some(s=>Date.parse(read(s.path).captured_at)<Date.parse(receipt.start_utc)))throw Error('Coverage snapshot predates execution');
  const runtimes=new Set(snapshots.map(s=>s.runtime));
  const limitations=[...p.unsupported];
  if(runtimes.has('electron-main')&&!runtimes.has('electron-preload'))limitations.push({path:'electron-preload',reason:'Electron was started but no preload snapshot was received'});
  const reportPath=path.join(output,'istanbul.json');write(reportPath,map.toJSON());
  const scopes=summaries(map,inventoryPath?read(inventoryPath):null,{...p,unsupported:limitations});
  const summary=map.getCoverageSummary().toJSON();
  const line_files=map.files().map(n=>{const lc=map.fileCoverageFor(n).getLineCoverage();return {path:n.replace('/__acceptance_source__/',''),executable_lines:Object.keys(lc).map(Number),hit_lines:Object.entries(lc).filter(([,c])=>c>0).map(([n])=>Number(n))};});
  const result={schema:'dedicated-coverage-result-v1',provider:'istanbul-source-v1',status:limitations.length?'incomplete':'measured',prepared:path.resolve(prepared),prepared_sha256:sha(path.join(prepared,'prepared.json')),compatibility_key:p.compatibility_key,
    execution_sha256:sha(receiptPath),receipt_path:path.resolve(receiptPath),collection_relation:'same_run',tools:p.tools,raw_evidence:snapshots,
    line_raw_path:reportPath,line_raw_sha256:sha(reportPath),istanbul_path:reportPath,istanbul_sha256:sha(reportPath),line_files,summary,scopes,scope_limitations:limitations,
    case_exit_code:receipt.exit_code,scene_id:receipt.coverage_scene_id,review_note:'按用户要求仅执行并采集，不做独立复审',capture_end:receipt.end_utc};
  write(path.join(output,'coverage-report.json'),result);return result;
}
export function verifyReport(filename){
  const r=read(filename),p=loadPrepared(r.prepared);
  if(r.schema!=='dedicated-coverage-result-v1'||r.provider!=='istanbul-source-v1'||r.prepared_sha256!==sha(path.join(r.prepared,'prepared.json'))||r.compatibility_key!==p.compatibility_key||digest(r.tools)!==digest(p.tools))throw Error('Coverage provenance/compatibility invalid');
  if(sha(r.receipt_path)!==r.execution_sha256||sha(r.istanbul_path)!==r.istanbul_sha256)throw Error('Coverage receipt/report changed');
  for(const f of r.raw_evidence)if(sha(f.path)!==f.sha256)throw Error('Frozen raw evidence changed');
  // Recompute from frozen raw with the registered provider; supplied numbers are never trusted.
  const rawFolder=path.dirname(r.raw_evidence[0].path),{map}=mergeRuntime(r.prepared,rawFolder);
  if(digest(map.toJSON())!==digest(read(r.istanbul_path))||digest(map.getCoverageSummary().toJSON())!==digest(r.summary))throw Error('Coverage statistics do not match dedicated tool output');
  return r;
}
const [command,...args]=process.argv.slice(2);
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  let result;
  if(command==='prepare')result=prepare(...args);
  else if(command==='verify-preparation')result=loadPrepared(args[0]);
  else if(command==='finish')result=finish(...args);
  else if(command==='verify')result=verifyReport(args[0]);
  else if(command==='summarize'){
    const spec=read(args[0]),reports=spec.reports.map(verifyReport);
    if(new Set(reports.map(r=>r.compatibility_key)).size>1)throw Error('Incompatible source/tool/units cannot be merged');
    if(!reports.length)throw Error('No compatible scene reports');
    const map=coverage.createCoverageMap({});for(const r of reports)map.merge(read(r.istanbul_path));
    result={schema:'dedicated-coverage-summary-v1',tools:reports[0].tools,scenes:reports.map(r=>r.scene_id),scopes:summaries(map,spec.inventory,loadPrepared(reports[0].prepared))};
    write(args[1],result);
  }else throw Error('Unknown provider command');
  console.log(JSON.stringify({status:'verified',command,files:Object.keys(result.files||{}).length,summary:result.summary,scopes:result.scopes}));
}

// Language-neutral execution/binding only. Every count comes from the project's
// mature tool; this module never discovers executable units or computes totals.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {performance} from 'node:perf_hooks';
import {read,sha,json} from './artifacts.mjs';
import {locations,ownedAbsolute} from './store.mjs';
import {validateRuntime} from './runtime.mjs';

const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,json(value),{flag:'wx'});};
function bound(file,digest,mapping={}){
  if(fs.existsSync(file)&&fs.statSync(file).isFile()&&sha(file)===digest)return file;
  const alias=mapping[file+'#'+digest]??mapping[file];
  if(alias?.sha256===digest&&sha(alias.path)===digest)return alias.path;
  throw Error('Coverage probe bound artifact missing or changed: '+file);
}
function runtime(file,digest,verify=true,mapping){
  const actual=bound(file,digest,mapping);
  if(verify)validateRuntime(actual);
  const value=read(actual);
  if(value.schema!=='project-runtime-preparation-v1'||value.status!=='ready')throw Error('Invalid coverage runtime manifest');
  return value;
}
function counts(value,expected){
  if(value.schema!=='coverage-probe-normalized-v1'||!Array.isArray(value.components))throw Error('Coverage probe normalized output missing');
  const seen=new Set(),measured=new Set(),metrics=[];
  for(const component of value.components){
    if(!component.id||!Array.isArray(component.source_paths)||!component.source_paths.length||!component.metrics||Array.isArray(component.metrics))throw Error('Coverage probe component incomplete');
    for(const source of component.source_paths){if(!expected.includes(source))throw Error('Coverage probe reported source outside route');seen.add(source);}
    for(const metric of Object.values(component.metrics)){
      if(metric.status==='measured'){
        if(!Number.isSafeInteger(metric.covered)||!Number.isSafeInteger(metric.total)||metric.covered<0||metric.total<metric.covered)throw Error('Coverage probe counts invalid');
        if(metric.total>0)for(const source of component.source_paths)measured.add(source);metrics.push(metric);
      }else if(metric.status==='unavailable'){if(!metric.reason)throw Error('Coverage probe unavailable metric lacks reason');}
      else throw Error('Coverage probe metric status invalid');
    }
  }
  if(!isDeepStrictEqual([...seen].sort(),[...new Set(expected)].sort()))throw Error('Coverage probe omitted route source');
  if(!isDeepStrictEqual([...measured].sort(),[...new Set(expected)].sort()))throw Error('Coverage probe has no measured units for a declared source');
  return metrics;
}
function nativeSnapshot(root){
  const result={};
  function visit(folder){for(const entry of fs.readdirSync(folder).sort()){
    const file=path.join(folder,entry),stat=fs.lstatSync(file);
    if(stat.isSymbolicLink())throw Error('Native coverage data must not use symlinks');
    if(stat.isDirectory())visit(file);else if(stat.isFile())result[file]=sha(file);
  }}visit(root);return result;
}
function execute(argv,runtime,substitutions,output){
  if(!Array.isArray(argv)||!argv.length||argv.some(x=>typeof x!=='string'||!x))throw Error('Coverage probe command must be an argv array');
  const command=argv.map(part=>part.replace(/\{([^{}]+)\}/g,(_match,key)=>{
    if(!(key in substitutions))throw Error('Unknown coverage probe placeholder: '+key);return substitutions[key];
  }));
  const allowed=new Set(runtime.executables.flatMap(item=>[item.path,item.resolved_path].filter(Boolean).map(file=>fs.realpathSync(file))));
  if(!allowed.has(fs.realpathSync(command[0])))throw Error('Coverage probe bypasses prepared runtime executable');
  fs.mkdirSync(output,{recursive:true});
  const stdout=path.join(output,'stdout.txt'),stderr=path.join(output,'stderr.txt');
  const out=fs.openSync(stdout,'wx'),err=fs.openSync(stderr,'wx'),started_at=new Date().toISOString(),started=performance.now();let result;
  try{result=spawnSync(command[0],command.slice(1),{cwd:runtime.workspace,stdio:['ignore',out,err],timeout:180000});}
  finally{fs.closeSync(out);fs.closeSync(err);}
  const receipt={command,cwd:runtime.workspace,exit_code:result.status,
    started_at,finished_at:new Date().toISOString(),seconds:(performance.now()-started)/1000,
    stdout:{path:stdout,sha256:sha(stdout)},stderr:{path:stderr,sha256:sha(stderr)},
    ...(result.error?{error:result.error.code??result.error.message}:{}),...(result.signal?{signal:result.signal}:{})};
  write(path.join(output,'receipt.json'),receipt);return receipt;
}
function probe(mode,route,runtime,output){
  const folder=path.join(output,route.id,mode),raw=path.join(folder,'raw');fs.mkdirSync(path.dirname(raw),{recursive:true});fs.mkdirSync(raw);
  const commands=route[mode],substitutions={raw_dir:raw,probe_dir:folder,workspace:runtime.workspace};
  if(isDeepStrictEqual(commands.adapter,commands.direct))throw Error('Adapter and direct-tool probes must use distinct commands');
  const receipts={};let native;
  for(const name of ['collect','adapter','direct']){
    receipts[name]=execute(commands[name],runtime,substitutions,path.join(folder,name));
    if(name!=='collect'){
      const after=nativeSnapshot(raw),before=native;
      // Each reader retains its own immutable integrity observation.
      write(path.join(folder,'native-integrity-'+name+'.json'),{reader:name,before,after,added:Object.keys(after).filter(x=>!(x in before)),removed:Object.keys(before).filter(x=>!(x in after)),changed:Object.keys(before).filter(x=>x in after&&before[x]!==after[x])});
      if(!isDeepStrictEqual(before,after))throw Error('Coverage probe readers changed native data');
    }
    if(receipts[name].exit_code!==0)throw Error('Coverage '+name+' probe failed: '+JSON.stringify({route:route.id,mode,
      receipt:path.join(folder,name,'receipt.json'),command:receipts[name].command,exit_code:receipts[name].exit_code,
      signal:receipts[name].signal,error:receipts[name].error,
      stderr:fs.readFileSync(receipts[name].stderr.path,'utf8').slice(-4000),stdout:fs.readFileSync(receipts[name].stdout.path,'utf8').slice(-1000)}));
    if(name==='collect'){
      native=nativeSnapshot(raw);
      if(!Object.keys(native).length||!Object.keys(native).some(file=>fs.statSync(file).size>0))throw Error('Coverage probe produced no nonempty native data');
    }
  }
  const adapter=read(receipts.adapter.stdout.path),direct=read(receipts.direct.stdout.path),metrics=counts(adapter,route.source_paths);counts(direct,route.source_paths);
  if(!isDeepStrictEqual(adapter,direct))throw Error('Coverage adapter differs from direct tool result');
  if(mode==='zero'&&metrics.some(x=>x.covered!==0))throw Error('Zero-hit native probe reported covered units');
  if(mode==='nonzero'&&!metrics.some(x=>x.covered>0))throw Error('Nonzero probe did not exercise measured source');
  return {status:'passed',receipts:Object.fromEntries(Object.keys(receipts).map(name=>{const file=path.join(folder,name,'receipt.json');return [name,{path:file,sha256:sha(file)}];})),
    native:Object.entries(native).sort(([a],[b])=>a.localeCompare(b)).map(([file,digest])=>({path:file,sha256:digest})),normalized_sha256:receipts.adapter.stdout.sha256};
}
export function runProbePlan(planPath,output){
  const planFile=fs.realpathSync(planPath),plan=read(planFile);
  if(plan.schema!=='project-coverage-probe-plan-v1'||!Array.isArray(plan.routes))throw Error('Invalid coverage probe plan');
  const current=runtime(plan.runtime_manifest,plan.runtime_sha256),{local}=locations(current.acceptance.project_root,current.acceptance.id);
  ownedAbsolute(path.join(local,'workflows'),planFile);
  const destination=ownedAbsolute(path.join(local,'workflows'),path.resolve(output));
  if(fs.realpathSync(plan.workspace)!==fs.realpathSync(current.workspace)||plan.revision!==current.revision)throw Error('Coverage probe is bound to another runtime workspace/revision');
  if(fs.existsSync(destination))throw Error('Coverage probe output already exists');
  fs.mkdirSync(destination,{recursive:true});
  const report={schema:'project-coverage-probe-report-v1',plan:planFile,plan_sha256:sha(planFile),runtime_manifest:plan.runtime_manifest,runtime_sha256:plan.runtime_sha256,
    workspace:plan.workspace,revision:plan.revision,routes:[],status:plan.routes.length?'ready':'partial'},seen=new Set();
  for(const route of plan.routes){
    if(typeof route.id!=='string'||!route.id||!/^[-_\p{L}\p{N}]+$/u.test(route.id)||seen.has(route.id)||!Array.isArray(route.source_paths)||!route.source_paths.length)throw Error('Coverage route ID/source paths invalid');
    seen.add(route.id);const item={id:route.id,source_paths:route.source_paths,probes:{}};
    for(const mode of ['zero','nonzero'])try{item.probes[mode]=probe(mode,route,current,destination);}catch(error){item.probes[mode]={status:'failed',reason:error.message};report.status='partial';}
    report.routes.push(item);
  }
  write(path.join(destination,'coverage-probes.json'),report);return report;
}
export function verifyProbeReport(reportPath,runtimeManifest,runtimeSha,measuredSources,{verifyRuntime=true,mapping={}}={}){
  const report=read(reportPath),current=runtime(runtimeManifest,runtimeSha,verifyRuntime,mapping);
  if(report.schema!=='project-coverage-probe-report-v1'||report.runtime_sha256!==runtimeSha)throw Error('Coverage probe report/runtime binding invalid');
  if(path.resolve(report.workspace)!==path.resolve(current.workspace)||report.revision!==current.revision)throw Error('Coverage probe report binds another workspace/revision');
  bound(report.plan,report.plan_sha256,mapping);const covered=new Set();let allPassed=Boolean(report.routes?.length);
  for(const route of report.routes??[]){
    if(['zero','nonzero'].every(mode=>route.probes[mode]?.status==='passed'))for(const source of route.source_paths)covered.add(source);else allPassed=false;
    for(const [mode,result] of Object.entries(route.probes)){
      if(result.status!=='passed')continue;
      for(const ref of [...Object.values(result.receipts),...result.native])bound(ref.path,ref.sha256,mapping);
      const receipts=Object.fromEntries(Object.entries(result.receipts).map(([name,ref])=>[name,read(bound(ref.path,ref.sha256,mapping))]));
      if(!isDeepStrictEqual(Object.keys(receipts).sort(),['adapter','collect','direct'])||Object.values(receipts).some(item=>item.exit_code!==0))throw Error('Coverage probe command receipt is incomplete');
      for(const receipt of Object.values(receipts))for(const ref of [receipt.stdout,receipt.stderr])bound(ref.path,ref.sha256,mapping);
      const adapter=read(bound(receipts.adapter.stdout.path,receipts.adapter.stdout.sha256,mapping)),direct=read(bound(receipts.direct.stdout.path,receipts.direct.stdout.sha256,mapping));
      const metrics=counts(adapter,route.source_paths);counts(direct,route.source_paths);
      if(!isDeepStrictEqual(adapter,direct)||result.normalized_sha256!==receipts.adapter.stdout.sha256)throw Error('Coverage probe direct-tool comparison changed');
      if(mode==='zero'&&metrics.some(x=>x.covered!==0))throw Error('Coverage zero-hit probe changed');
      if(mode==='nonzero'&&!metrics.some(x=>x.covered>0))throw Error('Coverage nonzero probe changed');
    }
  }
  if(report.status!==(allPassed?'ready':'partial'))throw Error('Coverage probe status differs from route evidence');
  const missing=measuredSources.filter(source=>!covered.has(source));
  if(missing.length)throw Error('Measured source lacks passing zero/nonzero route probes: '+JSON.stringify({sources:missing,
    failures:(report.routes??[]).flatMap(route=>Object.entries(route.probes).filter(([,probe])=>probe.status!=='passed').map(([mode,probe])=>({route:route.id,mode,reason:probe.reason})))}));
  return report;
}

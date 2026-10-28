import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {locations,inside,requireCurrent,ownedAbsolute} from './store.mjs';
import {read,sha,packageRoot} from './artifacts.mjs';
import {git} from './workspace.mjs';
import {validateStore} from './validation.mjs';
import {isDeepStrictEqual as equal} from 'node:util';

export function runtimeEnvironment(manifest){
  const value=manifest.execution_env??{};
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.entries(value).some(([key,item])=>!key||key.includes('=')||key.includes('\0')||typeof item!=='string'||item.includes('\0')))throw Error('Invalid frozen project execution environment');
  return {...value};
}
export function projectEnvironment(catalog){
  if(!catalog.runtime)return {};
  const file=catalog.runtime.manifest??catalog.runtime.runtime_manifest;
  if(!file||sha(file)!==catalog.runtime.sha256)throw Error('Project runtime environment binding missing or changed');
  return runtimeEnvironment(read(file));
}

export function observeRuntime(item){
  if(!Array.isArray(item.command)||!item.command.length||item.command.some(x=>typeof x!=='string'||!x)||!item.cwd||
    !item.env||Array.isArray(item.env)||Object.values(item.env).some(x=>typeof x!=='string')||!Number.isInteger(item.timeout_seconds)||item.timeout_seconds<1||item.timeout_seconds>1800)throw Error('Invalid frozen runtime command');
  // A real file descriptor combines stdout/stderr in native write order, as the
  // former Python subprocess did. No persistent log or frozen receipt changes.
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'acceptance-runtime-observe-')),log=path.join(temporary,'combined.log'),fd=fs.openSync(log,'wx');
  let result;
  try{result=spawnSync(item.command[0],item.command.slice(1),{cwd:item.cwd,env:{...process.env,...item.env},stdio:['ignore',fd,fd],timeout:item.timeout_seconds*1000});}
  finally{fs.closeSync(fd);}
  try{
    let raw=fs.readFileSync(log),exit_code=result.status;
    if(result.error?.code==='ETIMEDOUT'){raw=Buffer.concat([raw,Buffer.from('\nTIMEOUT\n')]);exit_code=124;}
    else if(result.error)throw result.error;
    return {raw,exit_code};
  }finally{fs.rmSync(log);fs.rmdirSync(temporary);}
}
function receipt(record){
  if(sha(record.log)!==record.output_sha256)throw Error('Runtime execution receipt/log changed: '+record.log);
  if(record.exit_code!==0)throw Error('Runtime command did not succeed: '+record.log);
}
export function validateRuntime(manifestPath,{expectedAcceptance,resmoke=true}={}){
  const manifest=read(manifestPath);
  if(manifest.schema!=='project-runtime-preparation-v1'||manifest.status!=='ready')throw Error('Runtime manifest is not ready');
  const binding=manifest.acceptance,{root,local}=locations(binding.project_root,binding.id);requireCurrent(root,binding.id);
  const manifestFile=ownedAbsolute(inside(local,'workflows'),path.resolve(manifestPath));
  if(validateStore(root,binding.id,{checkKnowledge:false}).scope.sha256!==binding.scope_sha256)throw Error('Runtime acceptance scope changed');
  ownedAbsolute(inside(local,'workflows'),manifestFile);
  if(path.basename(manifestFile)!=='runtime.json')throw Error('Runtime manifest must be runtime.json under this acceptance workflow');
  if(expectedAcceptance&&['project_root','id','scope_sha256'].some(key=>binding[key]!==expectedAcceptance[key]))throw Error('Runtime manifest belongs to another acceptance or scope');
  const workspace=inside(local,'workspace'),runtimeRoot=path.join(path.dirname(manifestFile),'runtime');
  if(manifest.workspace!==workspace||!fs.statSync(workspace).isDirectory())throw Error('Runtime workspace is missing or belongs to another acceptance');
  if(manifest.runtime_root!==runtimeRoot||!fs.statSync(runtimeRoot).isDirectory())throw Error('Runtime root is missing or changed');
  if(git(workspace,'rev-parse','HEAD').trim()!==manifest.revision)throw Error('Runtime source revision changed');
  for(const component of manifest.components??[])if(git(inside(workspace,component.path),'rev-parse','HEAD').trim()!==component.revision)throw Error('Runtime component revision changed: '+component.path);
  if(manifest.platform.system!==os.type()||manifest.platform.machine!==os.machine())throw Error('Runtime was prepared on another platform');
  for(const [name,digest] of Object.entries(manifest.dependency_hashes))if(sha(inside(workspace,name))!==digest)throw Error('Runtime dependency changed: '+name);
  for(const changed of git(workspace,'diff','--name-only','-z','HEAD').split('\0').filter(Boolean))if(!(manifest.test_roots??[]).some(name=>changed.startsWith(name.replace(/\/$/,'')+'/')))throw Error('Runtime product source changed: '+changed);
  ownedAbsolute(inside(local,'knowledge-reads'),manifest.knowledge_receipt);
  if(sha(manifest.knowledge_receipt)!==manifest.knowledge_read_sha256)throw Error('Runtime knowledge read receipt changed');
  ownedAbsolute(local,manifest.spec_path);if(sha(manifest.spec_path)!==manifest.spec_sha256)throw Error('Runtime frozen Agent spec changed');
  const spec=read(manifest.spec_path),expected=Object.fromEntries(Object.entries(spec.execution_env??{}).map(([key,value])=>[key,value.replaceAll('{workspace}',workspace).replaceAll('{runtime_root}',runtimeRoot)]));
  if(!equal(runtimeEnvironment(manifest),expected))throw Error('Runtime execution environment differs from its frozen spec');
  if(manifest.recipe_candidate!==path.join(path.dirname(manifestFile),'recipe-candidate.md')||sha(manifest.recipe_candidate)!==manifest.recipe_candidate_sha256)throw Error('Runtime reusable recipe candidate changed');
  for(const item of manifest.setup){ownedAbsolute(path.dirname(manifestFile),item.log);receipt(item);}
  for(const item of manifest.executables){
    fs.accessSync(item.path,fs.constants.X_OK);
    if(fs.realpathSync(item.path)!==item.resolved_path||sha(item.resolved_path)!==item.sha256)throw Error('Runtime executable changed: '+item.name);
    ownedAbsolute(path.dirname(manifestFile),item.version_receipt.log);receipt(item.version_receipt);
    if(item.version_command[0]!==item.path)throw Error('Runtime version command no longer binds executable');
    const actual=observeRuntime({command:item.version_command,cwd:workspace,env:runtimeEnvironment(manifest),timeout_seconds:30});
    if(actual.exit_code!==0||actual.raw.toString('utf8').trim()!==item.version_output)throw Error('Runtime executable version changed: '+item.name);
  }
  ownedAbsolute(path.dirname(manifestFile),manifest.smoke.log);receipt(manifest.smoke);
  if(resmoke){const result=observeRuntime(manifest.smoke);if(result.exit_code!==0)throw Error('Runtime smoke no longer passes (exit '+result.exit_code+'): '+result.raw.toString('utf8').slice(-2000));}
  return {status:'ready',runtime_manifest:manifestFile,runtime_sha256:sha(manifestFile),workspace,revision:manifest.revision};
}

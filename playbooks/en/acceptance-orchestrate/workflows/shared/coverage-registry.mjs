import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {spawnSync} from 'node:child_process';
import {read,atomicJson} from './store.mjs';
import {digest} from './definitions.mjs';
import {protocol,coveragePreparation,verifyCoverageReport,summarizeCoverage} from './coverage.mjs';
import {guard} from './validation.mjs';
import {locations,inside} from './store.mjs';
export function policyPath(root){
  const result=spawnSync('git',['rev-parse','--absolute-git-dir'],{cwd:root,encoding:'utf8'});
  return result.status===0?path.join(result.stdout.trim(),'delivery-acceptance-coverage.json'):null;
}
export function projectCoverage(root,declared){
  const file=policyPath(root);if(!file||!fs.existsSync(file))return declared;
  const policy=read(file),active=policy.coverage;
  if(policy.schema==='project-coverage-policy-v2'&&active.policy==='off'){
    const head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
    if(head.status!==0||head.stdout.trim()!==policy.revision)throw Error('Explicit coverage policy belongs to another product revision; record the new decision');
    if(declared&&declared.policy!=='off')throw Error('Coverage policy changed explicitly; rebind the current catalog before execution');
    return {...declared,...active};
  }
  if(active.protocol!==protocol)throw Error('Legacy coverage preparation is historical; prepare a new project-owned profile before execution');
  const result=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
  if(result.status!==0||result.stdout.trim()!==policy.revision)throw Error('Project coverage requires new preparation for this revision');
  coveragePreparation(active,{runCheck:false});
  if(declared){
    if(declared.policy!=='required')throw Error('Active project cannot downgrade required coverage; rebind latest catalog');
    for(const key of ['protocol','prepared','prepared_sha256','required_test_files','acceptance'])if(Object.hasOwn(declared,key)&&!equal(declared[key],active[key]))throw Error('Scene cannot replace project coverage binding: '+key);
  }
  return {...active,...declared};
}
export function setCoverageOff(root,acceptance,basis,output){
  guard({acceptance,source_checkout:root},[output]);
  const {local}=locations(acceptance.project_root,acceptance.id),claim=read(inside(local,'workspace.lock.d/owner.json'));
  if(claim.runtime!=='node'||claim.pid!==process.pid||claim.acceptance_id!==acceptance.id)throw Error('Explicit coverage policy change requires this host workspace claim');
  if(typeof basis!=='string'||!basis.trim())throw Error('Explicit user decision basis required');
  const policy=policyPath(root);if(!policy||fs.realpathSync(gitRoot(root))!==fs.realpathSync(root))throw Error('Coverage policy needs the exact prepared workspace Git root');
  let previous=null,previousHash=null;
  if(fs.existsSync(policy)){
    if(fs.lstatSync(policy).isSymbolicLink())throw Error('Coverage policy cannot use a symlink');previous=read(policy);previousHash=digest(policy);
    if(!['project-required-coverage-v1','project-coverage-policy-v2'].includes(previous.schema)||!previous.coverage)throw Error('Unknown current coverage policy; inspect before replacing it');
    if(previous.coverage.acceptance?.id&&previous.coverage.acceptance.id!==acceptance.id)throw Error('Coverage policy belongs to another acceptance');
    fs.copyFileSync(policy,path.join(output,'coverage-policy.previous.json'),fs.constants.COPYFILE_EXCL);
  }
  const version=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});if(version.status!==0)throw Error('Cannot bind explicit coverage policy to actual revision');
  const coverage={policy:'off',reason:basis,acceptance},value={schema:'project-coverage-policy-v2',coverage,revision:version.stdout.trim(),workspace:fs.realpathSync(root),decision:'explicit_user_off',created_at:new Date().toISOString()};
  atomicJson(policy,value);fs.copyFileSync(policy,path.join(output,'coverage-policy.applied.json'),fs.constants.COPYFILE_EXCL);
  const result={policy_path:policy,policy_sha256:digest(policy),previous_sha256:previousHash,previous_policy:previous?.coverage?.policy??null,coverage};atomicJson(path.join(output,'coverage-policy-change.json'),result);return result;
}
function gitRoot(root){const result=spawnSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8'});if(result.status!==0)throw Error('No exact Git workspace root');return result.stdout.trim();}
export function coveragePaths(prepared){
  const profile=read(path.join(prepared,'prepared.json'));if(profile.schema!=='project-coverage-preparation-v1')throw Error('Legacy coverage profile cannot become active in new execution');
  return {profile,registry:profile.spec.registry_path,view:path.join(path.dirname(profile.spec.registry_path),'coverage-view.json')};
}
export function ensureActive(prepared){
  const {profile,registry}=coveragePaths(prepared);
  if(!fs.existsSync(registry)||read(registry).active_profile!==digest(path.join(prepared,'prepared.json')))throw Error('Coverage preparation is not active');
  if(read(registry).active_inventory_sha256!==digest(profile.spec.inventory_path))throw Error('Frozen coverage scope inventory changed');
}
function registryLock(registry,operation){
  fs.mkdirSync(path.dirname(registry),{recursive:true});const claim=registry.replace(/\.[^.\/]+$/,'')+'.lock.d',owner=path.join(claim,'owner.json'),token=randomUUID();
  try{fs.mkdirSync(claim,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw Error('Coverage registry is busy or uncertain; inspect before retrying');throw error;}
  try{fs.writeFileSync(owner,JSON.stringify({schema:'coverage-registry-claim-v1',pid:process.pid,token}),{flag:'wx'});return operation();}
  finally{if(fs.existsSync(owner)&&read(owner).token!==token)throw Error('Coverage registry owner changed');if(fs.existsSync(owner))fs.unlinkSync(owner);fs.rmdirSync(claim);}
}
export function activateCoverage(prepared,catalogFile){
  const {profile,registry,view}=coveragePaths(prepared),binding=catalogFile?read(catalogFile):{},config={policy:'required',protocol,prepared:fs.realpathSync(prepared),prepared_sha256:digest(path.join(prepared,'prepared.json')),inventory_path:profile.spec.inventory_path,required_test_files:binding.coverage_test_files??profile.adapter_files,...(binding.acceptance?{acceptance:binding.acceptance}:{})};
  if(binding.acceptance)guard({acceptance:binding.acceptance,source_checkout:profile.spec.project_root},[prepared]);
  coveragePreparation(config);
  return registryLock(registry,()=>{
    const data=fs.existsSync(registry)?read(registry):{schema:'project-coverage-index-v1',entries:[]};
    if(data.active_profile===config.prepared_sha256&&data.active_inventory_sha256!==digest(config.inventory_path))throw Error('Cannot change frozen coverage inventory');
    Object.assign(data,{active_profile:config.prepared_sha256,active_prepared:config.prepared,active_inventory_sha256:digest(config.inventory_path)});atomicJson(registry,data);
    if(!fs.existsSync(view)||read(view).profile!==config.prepared_sha256)atomicJson(view,{profile:config.prepared_sha256,tools:profile.tools,entries:[],summary:null});
    const policy=policyPath(profile.spec.project_root);if(policy)atomicJson(policy,{schema:'project-required-coverage-v1',coverage:config,revision:profile.spec.revision,catalog:catalogFile??null});return config;
  });
}
export function registerCoverage(reportPath){
  const receiptFile=path.join(path.dirname(reportPath),'execution.json'),report=verifyCoverageReport(reportPath,receiptFile),{profile,registry,view}=coveragePaths(report.prepared);ensureActive(report.prepared);
  const receipt=read(receiptFile),item={scene_id:report.scene_id,profile:report.prepared_sha256,report:fs.realpathSync(reportPath),report_sha256:digest(reportPath),ended_at:receipt.end_utc,exit_code:receipt.exit_code};
  return registryLock(registry,()=>{
    const data=read(registry);if(data.active_profile!==item.profile)throw Error('Coverage profile changed during collection');
    const same=data.entries.find(entry=>entry.report===item.report);if(same&&!equal(same,item))throw Error('Immutable coverage report changed');if(!same)data.entries.push(item);
    const latest=new Map();for(const entry of data.entries)if(entry.profile===item.profile&&(!latest.has(entry.scene_id)||entry.ended_at>latest.get(entry.scene_id).ended_at))latest.set(entry.scene_id,entry);
    const summary=summarizeCoverage([...latest.values()].map(entry=>entry.report),read(profile.spec.inventory_path));atomicJson(registry,data);atomicJson(view,{profile:item.profile,prepared:report.prepared,tools:profile.tools,entries:[...latest.values()],summary});return item;
  });
}

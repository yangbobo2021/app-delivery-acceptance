import fs from 'node:fs';import path from 'node:path';import {isDeepStrictEqual as equal} from 'node:util';
import {locations,inside,read,atomicJson,requireCurrent,ownedAbsolute} from '../shared/store.mjs';
import {digest} from '../shared/definitions.mjs';import {validateKnowledge} from '../shared/knowledge.mjs';import {validateRuntime} from '../shared/runtime.mjs';import {workspaceMetadataLock} from '../shared/workspace.mjs';import {noSecrets} from '../archive/stage.mjs';
export function publishKnowledge(input){
 const allowed=['project_root','acceptance_id','request_id','basis','runtime','files'];if(!input||Object.keys(input).some(k=>!allowed.includes(k))||!String(input.basis??'').trim()||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(input.request_id??'')||!Array.isArray(input.files)||!input.files.length)throw Error('Explicit reviewed knowledge files, runtime evidence and publication basis required');
 const {root,local}=locations(input.project_root,input.acceptance_id);requireCurrent(root,input.acceptance_id);const folder=inside(local,'workflows/knowledge/'+input.request_id),base=inside(root,'.acceptance/knowledge');
 if(fs.existsSync(path.join(folder,'result.json'))){if(!equal(read(path.join(folder,'input.json')),input))throw Error('Knowledge publication identity conflict');const result=read(path.join(folder,'result.json'));return {...result,reused:true,current:input.files.every(f=>fs.existsSync(inside(base,f.path))&&digest(inside(base,f.path))===result.published[f.path])};}
 if(!input.runtime?.manifest||digest(ownedAbsolute(local,input.runtime.manifest))!==input.runtime.sha256)throw Error('Knowledge needs immutable verified runtime evidence');validateRuntime(input.runtime.manifest,{resmoke:true});validateKnowledge(root);
 return workspaceMetadataLock(root,input.acceptance_id,()=>{
  const lock=inside(root,'.acceptance/knowledge-publish.lock.d');try{fs.mkdirSync(lock);}catch(e){if(e.code==='EEXIST')throw Error('Knowledge publication active or uncertain');throw e;}
  let swapped=false,retained=false;const stage=path.join(folder,'candidate'),previous=path.join(folder,'previous');
  try{
   fs.mkdirSync(folder,{recursive:true});atomicJson(path.join(folder,'input.json'),input);atomicJson(path.join(lock,'owner.json'),{pid:process.pid,attempt:folder});fs.cpSync(base,stage,{recursive:true,errorOnExist:true,force:false});const names=new Set();
   for(const item of input.files){if(!item||Object.keys(item).some(k=>!['path','base_sha256','text'].includes(k))||typeof item.path!=='string'||!item.path.endsWith('.md')||!String(item.text??'').trim()||names.has(item.path))throw Error('Unique explicit Markdown knowledge assets and indexes required');names.add(item.path);const target=inside(base,item.path),destination=inside(stage,item.path),before=fs.existsSync(target)?digest(target):null;if(before!==item.base_sha256)throw Error('Knowledge asset changed or missing explicit base SHA: '+item.path);if(/\/Users\/|\/private\/var\/|\/var\/folders\/|\.acceptance-local\/|runtime_root|knowledge-receipt|execution\.json/.test(item.text))throw Error('Portable knowledge cannot embed local installations, receipt paths or machine state');fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,item.text);noSecrets(destination);}
   const candidate=validateKnowledge(root,{stagedBase:stage});atomicJson(path.join(folder,'candidate-inventory.json'),candidate);fs.renameSync(base,previous);retained=true;try{fs.renameSync(stage,base);swapped=true;}catch(error){fs.renameSync(previous,base);retained=false;throw error;}
   const result={schema:'acceptance-knowledge-result-v1',status:'published',basis:input.basis,published:Object.fromEntries(input.files.map(f=>[f.path,digest(inside(base,f.path))])),runtime:input.runtime,previous_snapshot:previous,business_judgment:'not_created',recipe_claim:'Verified environment method; applicability and limitations remain as explicitly reviewed text.'};atomicJson(path.join(folder,'result.json'),result);return result;
  }finally{
   // If publication was swapped but its result could not be committed, retain
   // the claim and both versions for explicit inspection rather than guessing.
   if(!swapped||fs.existsSync(path.join(folder,'result.json'))){fs.rmSync(lock,{recursive:true});if(!retained&&fs.existsSync(stage))fs.rmSync(stage,{recursive:true});}
  }
 });
}

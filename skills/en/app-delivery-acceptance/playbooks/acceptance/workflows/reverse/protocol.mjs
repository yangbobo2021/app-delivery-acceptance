import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {locations,read,requireCurrent,ownedAbsolute} from '../shared/store.mjs';
import {guard,validateStore} from '../shared/validation.mjs';
import {readKnowledge} from '../shared/knowledge.mjs';
import {currentBinding,digest,verifyStage,loadBinding} from '../shared/definitions.mjs';
import {canonical,cloneJson} from '../shared/json.mjs';
const write=(file,value,exclusive=false)=>fs.writeFileSync(file,canonical(value)+'\n',exclusive?{flag:'wx'}:undefined);
const git=(root,...args)=>execFileSync('git',args,{cwd:root,maxBuffer:24*1024*1024}).toString().trim();
export function prepareReverse(value,folder){
 const {root,shared}=locations(value.project_root,value.acceptance_id);requireCurrent(root,value.acceptance_id);validateStore(root,value.acceptance_id);
 const definitions=currentBinding(root,value.acceptance_id);if(definitions.sha256!==value.definitions_sha256)throw Error('reverse definitions changed');
 const current=read(path.join(shared,'scenarios.json')),knowledge=readKnowledge(root,value.acceptance_id,value.knowledge_paths??[]);
 const fields=['base_revision','head_revision','source_paths','test_paths','noncode_paths','deleted_source_paths','submodule_paths','contract_files','context_files','pr_requirement_ids','test_modes','confirmed_contract_paths','confirmation_basis'];
 const request=Object.fromEntries(fields.filter(k=>Object.hasOwn(value,k)).map(k=>[k,cloneJson(value[k])]));
 Object.assign(request,{project_root:root,acceptance:knowledge.acceptance,definitions,requirements:{items:current.requirements,context:current.context},existing_rules:current.reverse_rules});
 if(request.confirmed_contract_paths?.length&&!String(request.confirmation_basis??'').trim())throw Error('modified independent contract needs actual confirmation_basis');
 guard(request,[folder]);write(path.join(folder,'request.frozen.json'),request,true);return {request,knowledge:knowledge.contents};
}
export function reverseCandidate(folder){
 const request=read(path.join(folder,'request.frozen.json'));guard(request,[folder]);verifyStage(request);const current=loadBinding(request,{required:true}),draft=read(path.join(folder,'draft.current.json')),existing=new Set(current.reverse_rules.map(r=>r.id));
 for(const rule of draft.reverse_rules)if(!existing.has(rule.id))current.reverse_rules.push({...rule,origin:{kind:'commit-reverse',reference:path.join(folder,'reverse-result.json')},external_refs:[]});
 for(const k of ['acceptance_id','scope_sha256','updated_at','definition_record','definition_version','previous_catalog_sha256','change'])delete current[k];
 const candidate=path.join(folder,'candidate-definitions.json');write(candidate,current);return {candidate};
}
export function changedNewLines(patch){const lines=new Set();for(const line of patch.split(/\r?\n/))if(line.startsWith('@@ ')){const m=line.match(/\+(\d+)(?:,(\d+))?/);if(m)for(let n=+m[1],end=n+(m[2]===undefined?1:+m[2]);n<end;n++)lines.add(n);}return [...lines].sort((a,b)=>a-b);}
export function buildInventory(request){
 const root=fs.realpathSync(request.project_root),base_ref=request.base_revision,head=git(root,'rev-parse',request.head_revision),target_revision=git(root,'rev-parse',base_ref),base=git(root,'merge-base',base_ref,head);
 if(git(root,'rev-parse','HEAD')!==head)throw Error('checkout HEAD differs from frozen change head');
 const req=new Set((request.requirements?.items??[]).map(x=>x.id)),ids=request.pr_requirement_ids,modes=request.test_modes;
 if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(x=>!req.has(x)))throw Error('PR requirement IDs must be an explicit unique subset of confirmed requirements');
 if(!Array.isArray(modes)||!modes.length||new Set(modes).size!==modes.length||modes.some(x=>!['BLACK_BOX','WHITE_BOX'].includes(x)))throw Error('PR test modes must explicitly select BLACK_BOX and/or WHITE_BOX');
 const groups=Object.fromEntries(['source_paths','test_paths','noncode_paths','deleted_source_paths'].map(k=>[k,request[k]??[]])),submodules=request.submodule_paths??[];
 if(!Array.isArray(submodules)||submodules.some(p=>typeof p!=='string'||!p||p.includes('/')||['.','..'].includes(p)))throw Error('submodule_paths must name direct repository gitlinks');
 if(new Set(submodules).size!==submodules.length)throw Error('submodule_paths contains duplicates');
 const classes=new Map();for(const [group,kind]of [['source_paths','source'],['deleted_source_paths','source'],['test_paths','test'],['noncode_paths','noncode']]){
  const names=groups[group];if(!Array.isArray(names)||names.some(p=>typeof p!=='string'||!p))throw Error('path inventories must be arrays of nonempty strings');
  for(const name of names){if(classes.has(name))throw Error('path classified twice: '+name);classes.set(name,kind);}
 }
 const source_hashes={};for(const name of groups.source_paths){let file;try{file=ownedAbsolute(root,path.resolve(root,name));if(!fs.statSync(file).isFile())throw Error();}catch{throw Error('project source missing/outside checkout: '+name);}
 const owner=submodules.find(p=>name.startsWith(p+'/'));git(owner?path.join(root,owner):root,'ls-files','--error-unmatch','--',owner?name.slice(owner.length+1):name);source_hashes[name]=digest(file);}
 const files=[],gitlinks=[];
 function names(repo,from,to){const values=execFileSync('git',['diff','--name-status','-z','--find-renames',from,to],{cwd:repo,maxBuffer:24*1024*1024}).toString().split('\0'),out=[];for(let i=0;i<values.length&&values[i];){const status=values[i++],old=values[i++],name=/^[RC]/.test(status)?values[i++]:old;out.push({status,old,name});}return out;}
 function checksum(name){try{const file=ownedAbsolute(root,path.resolve(root,name));return fs.statSync(file).isFile()?digest(file):null;}catch{return null;}}
 function entry(repo,from,to,item,prefix=''){const name=prefix+item.name,old=prefix+item.old,patch=execFileSync('git',['diff','--no-ext-diff','--unified=0',from,to,'--',item.name],{cwd:repo,maxBuffer:24*1024*1024}).toString();return {path:name,old_path:old!==name?old:null,status:item.status,kind:classes.get(name)??classes.get(old)??'unknown',sha256:checksum(name),changed_lines:changedNewLines(patch),...(prefix?{repo_root:prefix.slice(0,-1),repo_relative_path:item.name}:{})};}
 for(const item of names(root,base,head)){
  if(!submodules.includes(item.name)){files.push(entry(root,base,head,item));continue;}
  if(item.old!==item.name||!['M','A','D'].includes(item.status[0]))throw Error('renamed/added/deleted submodule needs an explicit checkout: '+item.name);
  const child=ownedAbsolute(root,path.join(root,item.name));if(!fs.statSync(child).isDirectory())throw Error('submodule checkout missing: '+item.name);
  const from=git(root,'rev-parse',`${base}:${item.name}`),to=git(root,'rev-parse',`${head}:${item.name}`);if(git(child,'rev-parse','HEAD')!==to)throw Error('submodule HEAD differs from parent gitlink: '+item.name);git(child,'cat-file','-e',from+'^{commit}');
  gitlinks.push({path:item.name,base_revision:from,head_revision:to});files.push({path:item.name,old_path:null,status:item.status,kind:'submodule',sha256:null,changed_lines:[],base_revision:from,head_revision:to});
  for(const childItem of names(child,from,to))files.push(entry(child,from,to,childItem,item.name+'/'));
 }
 return {schema:'change-inventory-v1',project_root:root,base_ref,target_revision,base_revision:base,head_revision:head,pr_requirement_ids:ids,test_modes:modes,source_paths:groups.source_paths,source_hashes,files,gitlinks,changed_source_paths:files.filter(x=>x.kind==='source'&&x.sha256).map(x=>x.path),unclassified_paths:files.filter(x=>x.kind==='unknown').map(x=>x.path)};
}

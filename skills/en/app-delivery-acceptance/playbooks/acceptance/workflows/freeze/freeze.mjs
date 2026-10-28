import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {locations,inside,read,requireCurrent,lifecycleLock} from '../shared/store.mjs';
import {workspaceMetadataLock} from '../shared/workspace.mjs';
import {validateStore} from '../shared/validation.mjs';
import {collections,object,versioned,compareDefinitions,digest,fingerprint} from '../shared/definitions.mjs';
import {canonical,cloneJson,copyNumbers} from '../shared/json.mjs';
const generated=new Set(['acceptance_id','scope_sha256','updated_at','definition_record','definition_version','previous_catalog_sha256','change']);
const allowed=new Set(['project_root','acceptance_id','request_id','basis','definitions','scope','base_definitions_sha256','mode','replace_basis','assessment']);
function save(file,value,exclusive=false){
  fs.mkdirSync(path.dirname(file),{recursive:true});const raw=canonical(value)+'\n';
  if(exclusive){fs.writeFileSync(file,raw,{flag:'wx'});return;}
  const temporary=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temporary,raw,{flag:'wx'});fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function candidateFor(request,previous,manifest,root){
  const supplied=request.definitions,mode=request.mode??'append';
  if(!object(supplied)||Object.keys(supplied).some(k=>generated.has(k)))throw Error('definitions must be an object without generated publication fields');
  if((supplied.schema??'acceptance-catalog-v2')!=='acceptance-catalog-v2')throw Error('freeze accepts complete v2 definitions, not implicit legacy adoption');
  if(!['append','replace'].includes(mode))throw Error('mode must be append or replace');
  if(mode==='replace'&&!(typeof request.replace_basis==='string'&&request.replace_basis.trim()))throw Error('replace requires its explicit scope/removal decision basis');
  if(previous&&previous.schema!=='acceptance-catalog-v2')throw Error('legacy catalog needs the explicit adoption route first');
  const candidate=mode==='replace'?{}:copyNumbers(previous??{},Object.fromEntries(Object.entries(cloneJson(previous??{})).filter(([k])=>!generated.has(k))));
  for(const [key,value]of Object.entries(supplied))if(!collections.includes(key)&&key!=='context')candidate[key]=cloneJson(value);
  copyNumbers(supplied,candidate);candidate.schema='acceptance-catalog-v2';candidate.project??={id:manifest.project_id,root};
  if(!object(supplied.context??{}))throw Error('context object required');
  candidate.context=mode==='replace'?{}:cloneJson(previous?.context??{});
  Object.assign(candidate.context,cloneJson(supplied.context??{}));copyNumbers(supplied.context??{},candidate.context);
  for(const group of collections){
    const additions=supplied[group]??[];
    if(!Array.isArray(additions))throw Error('definition collection must be an array: '+group);
    const ids=additions.map(i=>i?.id);
    if(ids.some(id=>typeof id!=='string'||!id.trim())||new Set(ids).size!==ids.length)throw Error('duplicate or invalid definition IDs: '+group);
    const merged=new Map((mode==='replace'?[]:previous?.[group]??[]).map(item=>[item.id,cloneJson(item)]));
    for(const item of additions){const copy=cloneJson(item);delete copy.version;delete copy.content_sha256;merged.set(item.id,copy);}candidate[group]=[...merged.values()];
  }
  candidate.basis=request.basis;versioned(candidate,previous);compareDefinitions(previous,candidate,request.assessment);return candidate;
}
export function freezeAcceptance(request){
  if(!object(request)||Object.keys(request).some(k=>!allowed.has(k)))throw Error('freeze request object with declared fields required');
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(request.request_id??''))throw Error('stable request_id required');
  if(typeof request.basis!=='string'||!request.basis.trim())throw Error('actual user adoption/change basis required');
  if(!Object.hasOwn(request,'base_definitions_sha256'))throw Error('base_definitions_sha256 required; use null only before first freeze');
  if(typeof request.project_root!=='string'||!path.isAbsolute(request.project_root))throw Error('absolute user project_root required');
  const {root,shared,local}=locations(request.project_root,request.acceptance_id),attempt=inside(local,'workflows/freeze/'+request.request_id),latest=inside(shared,'scenarios.json');
  return lifecycleLock(root,()=>{
    requireCurrent(root,request.acceptance_id);const state=validateStore(root,request.acceptance_id,{requireScope:false});
    if(fs.existsSync(attempt)){
      const original=read(inside(attempt,'request.frozen.json'));
      if(fingerprint(original)!==fingerprint(request))throw Error('request_id already belongs to a different freeze request');
      const receipt=read(inside(attempt,'result.json'));
      if(receipt.schema!=='acceptance-freeze-result-v1'||receipt.request_sha256!==fingerprint(request))throw Error('invalid or incomplete freeze receipt');
      for(const [relative,expected]of Object.entries(receipt.immutable_files))if(digest(inside(root,relative))!==expected)throw Error('frozen history changed or missing: '+relative);
      return {...receipt,status:'already_frozen',applicability:fs.existsSync(latest)&&digest(latest)===receipt.definitions.sha256?'current':'superseded'};
    }
    if((fs.existsSync(latest)?digest(latest):null)!==request.base_definitions_sha256)throw Error('frozen definitions changed; read current snapshot before freezing');
    const previous=fs.existsSync(latest)?read(latest):null,candidate=candidateFor(request,previous,state.manifest,root),currentScope=state.scope?read(inside(shared,state.scope.path)).scope:null;
    let scope=request.scope??currentScope;
    if(scope===null||(!Object.hasOwn(request,'scope')&&currentScope?.kind==='definition-targets')){
      const targets=collections.flatMap(group=>candidate[group].map(item=>item.id));if(!targets.length)throw Error('a real requirement, rule or adopted scenario is required before freezing');scope={kind:'definition-targets',targets};
    }
    if(!object(scope)||!Object.keys(scope).length)throw Error('nonempty real scope required');
    return workspaceMetadataLock(root,request.acceptance_id,()=>{
      const records=inside(shared,'records');fs.mkdirSync(records,{recursive:true});
      const beforeRecords=new Set(fs.readdirSync(records).filter(n=>n.endsWith('.json'))),scopePath=inside(shared,'scope.json'),beforeScope=fs.existsSync(scopePath)?fs.readFileSync(scopePath):null,beforeCatalog=fs.existsSync(latest)?fs.readFileSync(latest):null;
      fs.mkdirSync(attempt,{recursive:true});save(inside(attempt,'request.frozen.json'),request,true);
      try{
        let pointer=state.scope;
        if(!equal(scope,currentScope)){
          const version=(state.scope?.version??0)+1,name='scope-'+String(version).padStart(4,'0')+'.json',file=inside(records,name);
          save(file,{schema:'acceptance-scope-v1',acceptance_id:request.acceptance_id,version,previous_sha256:state.scope?.sha256??null,created_at:new Date().toISOString(),basis:request.basis,scope},true);
          pointer={version,path:'records/'+name,sha256:digest(file)};save(scopePath,pointer);
        }
        const frozen=versioned(candidate,previous),change=compareDefinitions(previous,frozen,request.assessment),history=inside(records,'catalog-'+randomUUID().replaceAll('-','')+'.json');
        Object.assign(frozen,{definition_record:path.relative(shared,history),definition_version:(previous?.definition_version??0)+1,previous_catalog_sha256:previous?digest(latest):null,change:{...change,decision:'adopted',basis:request.basis},acceptance_id:request.acceptance_id,scope_sha256:pointer.sha256,updated_at:new Date().toISOString()});
        save(history,frozen,true);save(latest,frozen);
        const files=[inside(attempt,'request.frozen.json'),history,inside(shared,pointer.path)],receipt={schema:'acceptance-freeze-result-v1',status:'frozen',project_root:root,acceptance_id:request.acceptance_id,request_id:request.request_id,request_sha256:fingerprint(request),scope:pointer,definitions:{path:history,sha256:digest(history)},definition_version:frozen.definition_version,change:frozen.change,counts:Object.fromEntries(collections.map(group=>[group,frozen[group].length])),stopped_after:'freeze',applicability:'current',receipt_path:inside(attempt,'result.json'),immutable_files:Object.fromEntries(files.map(file=>[path.relative(root,file),digest(file)])),runtime:{storage_tool:'Node complete v2 definition protocol'}};
        save(receipt.receipt_path,receipt,true);return receipt;
      }catch(error){
        for(const [file,raw]of [[scopePath,beforeScope],[latest,beforeCatalog]]){if(raw===null){if(fs.existsSync(file))fs.unlinkSync(file);}else fs.writeFileSync(file,raw);}
        for(const name of fs.readdirSync(records))if(name.endsWith('.json')&&!beforeRecords.has(name))fs.unlinkSync(inside(records,name));
        throw error;
      }
    });
  });
}

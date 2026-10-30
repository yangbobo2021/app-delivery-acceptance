import {toolCommand} from './tool-command.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {fileURLToPath} from 'node:url';
import {read,inside,ownedAbsolute,atomicJson} from './store.mjs';
import {digest,verifyCase,object} from './definitions.mjs';
import {validateDiscovery} from './case-contract.mjs';
import {preflightIdentity} from './identity.mjs';
import {guard} from './validation.mjs';
import {requireWorkspaceLease} from './guard.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>execFileSync('git',args,{cwd:root,maxBuffer:64*1024*1024});
const cli=fileURLToPath(new URL('../../tools/case.mjs',import.meta.url));
export function reuseInventory(catalog){
  const root=fs.realpathSync(catalog.project_root),files={};
  for(const prefix of ['',...(catalog.components??[]).map(item=>item.path)]){
    const repo=inside(root,prefix),dirty=new Set(git(repo,'diff','--name-only','-z').toString().split('\0')),tracked={};
    for(const row of git(repo,'ls-files','--stage','-z').toString().split('\0').filter(Boolean)){
      const tab=row.indexOf('\t'),[mode,blob,stage]=row.slice(0,tab).split(' '),name=row.slice(tab+1);if(mode==='160000')continue;if(stage!=='0')throw Error('Resolve test/source merge conflicts before reuse discovery');tracked[name]={repo:prefix,blob,mode};
    }
    const names=new Set([...Object.keys(tracked),...git(repo,'ls-files','--others','--exclude-standard','-z').toString().split('\0').filter(Boolean)]);
    for(const name of names){
      const file=path.join(repo,name),key=prefix?prefix+'/'+name:name,stat=fs.lstatSync(file,{throwIfNoEntry:false});
      if(!dirty.has(name)&&tracked[name]&&!stat?.isSymbolicLink())files[key]=tracked[name];
      else if(stat?.isFile())files[key]={bytes:fs.readFileSync(file).toString('base64'),mode:stat.mode&0o777};else files[key]={unavailable:true};
    }
  }
  return {root,files};
}
export function originalBytes(baseline,name){
  const item=baseline.files[name];if(!item||item.unavailable)throw Error('Reuse source was not an available file at Agent startup: '+name);
  return item.bytes!==undefined?Buffer.from(item.bytes,'base64'):git(inside(baseline.root,item.repo),'cat-file','blob',item.blob);
}
export function reuseCheckpoint(answer,input,catalog,baseline,output){
  if(!equal(reuseInventory(catalog),baseline))throw Error('Reuse discovery checkpoint must precede project/test edits');
  const root=fs.realpathSync(catalog.project_root),candidate={...structuredClone(answer),status:'not_executed',observations:[],evidence_paths:[]},discovery=candidate.case_discovery??{},names=new Set([...(candidate.test_files??[]),...(discovery.evidence??[]).map(x=>x.file??''),...(discovery.excluded_candidates??[]).map(x=>x.file??'')]);
  for(const scope of discovery.search_scope??[]){const file=inside(root,scope.path??'');if(fs.statSync(file).isFile())names.add(scope.path);}
  const hashes=Object.fromEntries([...names].map(name=>[name,{sha256:hash(originalBytes(baseline,name))}])),canonical=validateDiscovery(candidate,input,root,{files:hashes},{discoveryOnly:true}),snapshot=path.join(output,'reuse-sources');
  for(const name of names){const file=inside(snapshot,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,originalBytes(baseline,name),{flag:'wx'});}
  for(const scope of discovery.search_scope){const file=inside(snapshot,scope.path);if(fs.statSync(inside(root,scope.path)).isDirectory())fs.mkdirSync(file,{recursive:true});}fs.mkdirSync(snapshot,{recursive:true});
  return {schema:'case-reuse-checkpoint-v1',discovery:canonical,source_hashes:hashes};
}
function span(root,item){
  const loc=item.source,file=inside(root,loc.file);if(!fs.statSync(file).isFile())throw Error('Final case source is outside workspace or missing');
  const lines=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n').replace(/\n$/,'').split('\n'),start=loc.line_start,end=loc.line_end;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||start>end||end>lines.length)throw Error('Final case needs its actual source range');
  const body=lines.slice(start-1,end).join('\n');if(typeof loc.title!=='string'||!loc.title||(!body.includes(loc.title)&&![loc.file,path.basename(file)].includes(loc.title)))throw Error('Final case title is not in its source range');return body;
}
export function validateReuse(answer,input,catalog,captured,output){
  const root=fs.realpathSync(catalog.project_root),original=validateDiscovery(captured.discovery,input,path.join(output,'reuse-sources'),{files:captured.source_hashes},{discoveryOnly:true}),existing=new Map(original.case_descriptions.map(c=>[c.id,c])),obligations=new Set(original.case_discovery.obligations.map(o=>o.id)),plan=answer.case_reuse;
  if(!object(plan)||plan.schema!=='case-reuse-plan-v1')throw Error('Missing mandatory case reuse decisions');
  const cases=answer.case_descriptions??[];if(!Array.isArray(cases)||cases.some(c=>!object(c)||!c.id))throw Error('Invalid final case descriptions');const final=new Map(cases.map(c=>[c.id,c]));if(final.size!==cases.length)throw Error('Duplicate final case IDs');
  const decisions=plan.decisions,unused=plan.not_selected,limits=plan.limitations;
  if(![decisions,unused,limits].every(Array.isArray))throw Error('Reuse decisions, not_selected and limitations must be lists');
  if(limits.length>10||limits.some(x=>typeof x!=='string'||![...x].length||[...x].length>600))throw Error('Invalid reuse limitations');
  const seen=new Set(),selected=new Set();
  for(const choice of decisions){
    const id=choice.case_id;if(!final.has(id)||seen.has(id)||!['reuse','extend','new'].includes(choice.action))throw Error('Each final case needs exactly one valid reuse decision');seen.add(id);
    const targets=choice.obligation_ids,prior=choice.existing_case_ids;
    if(!Array.isArray(targets)||!targets.length||new Set(targets).size!==targets.length||targets.some(id=>!obligations.has(id)))throw Error('Reuse decision refers to an unknown/current-scene target');
    if(!Array.isArray(prior)||new Set(prior).size!==prior.length||prior.some(id=>!existing.has(id)))throw Error('Reuse decision refers to an unknown existing case');
    if(typeof choice.reason!=='string'||!choice.reason.trim()||[...choice.reason.trim()].length>600)throw Error('Reuse/new decision requires a concrete reason');
    const item=final.get(id),source=item.source,body=span(root,item);if(!answer.test_files?.includes(source.file))throw Error('Final case file missing from test_files');
    if(choice.action==='new'){if(prior.length||source.origin!=='generated')throw Error('New tests must be generated, with no invented existing identity');}
    else{
      if(!prior.length||source.origin!=='existing')throw Error('Reuse/extend must retain actual existing case identities');
      for(const oldId of prior){const old=existing.get(oldId);if(source.file!==old.source.file||source.title!==old.source.title)throw Error('Reuse/extend changed existing declaration identity');if(choice.action==='reuse'&&body.trim()!==span(path.join(output,'reuse-sources'),old).trim())throw Error('Changed test body must not be labelled unchanged reuse');selected.add(oldId);}
    }
  }
  if(seen.size!==final.size)throw Error('Final case list and reuse decisions differ');
  if(['passed_local','product_failure','host_ready'].includes(answer.status)&&!final.size)throw Error('Ready implementation must describe its actual adopted cases');
  const excluded=new Set();for(const item of unused){const id=item.case_id;if(!existing.has(id)||excluded.has(id)||selected.has(id)||typeof item.reason!=='string'||!item.reason.trim())throw Error('Found but unselected cases need unique reasons: '+id+'; expected checkpoint IDs, not filenames or excluded_candidates');excluded.add(id);}
  if([...existing.keys()].some(id=>!selected.has(id)&&!excluded.has(id)))throw Error('Existing associated cases disappeared without a selection reason');
  return {schema:'case-reuse-description-v1',status:'available',discovery:original.case_discovery,existing_cases:original.case_descriptions,decisions:structuredClone(decisions),not_selected:structuredClone(unused),limitations:structuredClone(limits)};
}
export function reuseOperation(mode,catalogFile,inputFile,output,requestFile){
  const catalog=read(catalogFile),input=read(inputFile);output=fs.realpathSync(output);guard(catalog,[output]);requireWorkspaceLease(catalog,{output});verifyCase(input);
  const binding={input_sha256:digest(inputFile),catalog_sha256:digest(catalogFile)},baselineFile=path.join(output,'reuse-baseline.json'),capturedFile=path.join(output,'case-reuse-discovery.json');
  if(mode==='start'){
    if(fs.existsSync(baselineFile)){if(!equal(read(baselineFile).binding,binding))throw Error('Reuse startup binding changed');}else atomicJson(baselineFile,{...reuseInventory(catalog),binding});
    return {schema:'case-reuse-tools-v1',checkpoint:[...toolCommand(cli,output),'reuse-checkpoint',path.resolve(catalogFile),path.resolve(inputFile),output],request_path:path.join(output,'reuse-discovery-request.json'),record_path:capturedFile,final_check:[...toolCommand(cli,output),'reuse-check',path.resolve(catalogFile),path.resolve(inputFile),output],final_request_path:path.join(output,'final-candidate.json')};
  }
  const baseline=read(baselineFile);if(!equal(baseline.binding,binding))throw Error('Reuse startup binding differs');delete baseline.binding;
  if(mode==='checkpoint'){
    requestFile=ownedAbsolute(output,requestFile);const requestSha=digest(requestFile);
    if(fs.existsSync(capturedFile)){const prior=read(capturedFile);if(!equal(prior.binding,binding)||prior.request_sha256!==requestSha)throw Error('Reuse checkpoint is frozen; preserve it instead of replacing it');return {status:'already_captured',record_path:capturedFile};}
    const value={...reuseCheckpoint(read(requestFile),input,catalog,baseline,output),binding,request_sha256:requestSha};atomicJson(capturedFile,value);return {status:'captured',record_path:capturedFile,existing_cases:value.discovery.case_descriptions.length};
  }
  if(mode==='check'){
    requestFile=ownedAbsolute(output,requestFile);const captured=read(capturedFile);if(!equal(captured.binding,binding))throw Error('Reuse checkpoint input/catalog changed');const candidate=read(requestFile);validateReuse(candidate,input,catalog,captured,output);preflightIdentity(catalog,candidate);return {status:'valid',read_only:true,candidate_sha256:digest(requestFile),meaning:'Structural/source reference preflight only; final submission is checked again'};
  }
  if(mode==='verify'){
    const answerFile=path.join(output,'answer.json'),answer=read(answerFile);let report;
    if(!fs.existsSync(capturedFile)&&['blocked','needs_contract'].includes(answer.status))report={schema:'case-reuse-description-v1',status:'unavailable',reason:'用例阶段未就绪，未完成已有用例检查。'};
    else{const captured=read(capturedFile);if(!equal(captured.binding,binding))throw Error('Reuse checkpoint input/catalog changed');report=validateReuse(answer,input,catalog,captured,output);}
    report.binding={...binding,answer_sha256:digest(answerFile)};atomicJson(path.join(output,'case-reuse.json'),report);return {status:report.status,record_path:path.join(output,'case-reuse.json')};
  }
  throw Error('Expected start, checkpoint, check or verify');
}

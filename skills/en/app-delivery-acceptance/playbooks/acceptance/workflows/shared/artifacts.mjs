import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {requireCurrent} from './store.mjs';
import {parseJson,canonical} from './json.mjs';

export {packageRoot} from '../../root.mjs';
export const read=p=>parseJson(fs.readFileSync(p,'utf8'));
export const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
export const json=x=>JSON.stringify(sorted(x),null,2)+'\n';
export function owned(root,relative){
  if(path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..'))throw Error('owned relative path required');
  let p=root;for(const part of relative.split('/')){p=path.join(p,part);try{if(fs.lstatSync(p).isSymbolicLink())throw Error('symlink is not allowed: '+p);}catch(e){if(e.code!=='ENOENT')throw e;}}return p;
}
export function verify(root,files){for(const [relative,expected]of Object.entries(files)){if(sha(owned(root,relative))!==expected)throw Error('artifact changed: '+relative);}}
function acquire(folder){
  const lock=path.join(folder,'active.lock.d');try{fs.mkdirSync(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw Error('attempt has an active/uncertain owner; inspect before recovery');throw e;}
  fs.writeFileSync(path.join(lock,'owner.json'),json({pid:process.pid,created_at:new Date().toISOString()}),{flag:'wx',mode:0o600});
}
export function release(spec){
  if(!spec?.folder)return;const lock=path.join(spec.folder,'active.lock.d');
  if(fs.existsSync(lock)&&read(path.join(lock,'owner.json')).pid===process.pid){fs.unlinkSync(path.join(lock,'owner.json'));fs.rmdirSync(lock);}
}
export function begin(input,kind,allowed){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))throw Error(kind+' request has unknown fields');
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(input.request_id??''))throw Error('stable request_id required');
  if(typeof input.project_root!=='string'||!path.isAbsolute(input.project_root)||!/^AT-[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(input.acceptance_id??''))throw Error('absolute project_root and stable AT identity required');
  if(!/^[0-9a-f]{64}$/.test(input.definitions_sha256??''))throw Error('current definitions_sha256 required');
  const normalized={...input,project_root:fs.realpathSync(input.project_root)},root=normalized.project_root;
  requireCurrent(root,normalized.acceptance_id);
  const folder=owned(root,'.acceptance-local/'+normalized.acceptance_id+'/workflows/'+kind+'/'+normalized.request_id);
  const current=owned(root,'.acceptance/'+normalized.acceptance_id+'/scenarios.json');
  if(fs.existsSync(folder)){
    if(fs.readFileSync(owned(folder,'input.json'),'utf8')!==json(normalized))throw Error('request_id conflicts with its frozen input');
    if(fs.existsSync(owned(folder,'result.json'))){const result=read(path.join(folder,'result.json'));verify(root,result.immutable_files);return {completed:{...result,reused:true,source_definitions_match_current:sha(current)===normalized.definitions_sha256}};}
    if(fs.existsSync(path.join(folder,'active.lock.d')))throw Error('attempt has an active/uncertain owner; inspect before recovery');
    if(sha(current)!==normalized.definitions_sha256)throw Error('definitions changed');
    const prepared=read(owned(folder,'prepared.json'));verify(root,prepared.immutable_files);
    const answer=owned(folder,'answer.txt'),anchor=owned(folder,'answer-receipt.json');
    if(!fs.existsSync(answer)||!fs.existsSync(anchor)||read(anchor).answer_sha256!==sha(answer)||read(anchor).input_sha256!==sha(path.join(folder,'input.json')))throw Error('saved original answer is missing or changed; preserve it and use a new attempt');
    acquire(folder);return {...prepared,savedAnswer:fs.readFileSync(answer,'utf8')};
  }
  if(sha(current)!==normalized.definitions_sha256)throw Error('definitions changed');
  fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'input.json'),json(normalized),{flag:'wx'});acquire(folder);
  return {normalized,folder,kind};
}
export function prepared(spec,prompt,data,extraFiles=['request.frozen.json']){
  fs.writeFileSync(path.join(spec.folder,'prompt.txt'),prompt,{flag:'wx'});
  const root=spec.normalized.project_root,files=['input.json','prompt.txt',...extraFiles];
  const value={...spec,prompt,data,immutable_files:Object.fromEntries(files.map(name=>[path.relative(root,path.join(spec.folder,name)),sha(path.join(spec.folder,name))]))};
  fs.writeFileSync(path.join(spec.folder,'prepared.json'),json(value),{flag:'wx'});return value;
}
export function answerValue(spec,answer){
  verify(spec.normalized.project_root,spec.immutable_files);
  if(typeof answer!=='string'||!answer.trim())throw Error('role returned no answer');
  const file=path.join(spec.folder,'answer.txt'),anchor=path.join(spec.folder,'answer-receipt.json');
  if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8').trim()!==answer.trim())throw Error('saved answer changed');}
  else fs.writeFileSync(file,answer+'\n',{flag:'wx'});
  const binding={answer_sha256:sha(file),input_sha256:sha(path.join(spec.folder,'input.json'))};
  if(fs.existsSync(anchor)){if(json(read(anchor))!==json(binding))throw Error('saved answer receipt changed');}
  else fs.writeFileSync(anchor,json(binding),{flag:'wx'});
  const raw=answer.trim();return JSON.parse(raw.startsWith('```')?raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''):raw);
}
export function complete(spec,fields,files){
  const root=spec.normalized.project_root;
  const value={schema:'acceptance-'+spec.kind+'-result-v1',acceptance_id:spec.normalized.acceptance_id,
    request_id:spec.normalized.request_id,receipt_path:path.join(spec.folder,'result.json'),
    ...fields,immutable_files:Object.fromEntries(['input.json',...files].map(name=>[path.relative(root,path.join(spec.folder,name)),sha(path.join(spec.folder,name))]))};
  fs.writeFileSync(path.join(spec.folder,'result.json'),json(value),{flag:'wx'});release(spec);return value;
}
export function failure(spec,error,fields={}){
  const result={status:'blocked',reason:String(error),...fields};
  if(spec?.folder){const file=path.join(spec.folder,'failure.json');if(!fs.existsSync(file))fs.writeFileSync(file,json(result));release(spec);}return result;
}
export function freezeMessage(spec,candidate,basis){
  const message={project_root:spec.normalized.project_root,acceptance_id:spec.normalized.acceptance_id,request_id:spec.normalized.request_id+'-adopt',
    base_definitions_sha256:spec.normalized.definitions_sha256,mode:'replace',basis,
    replace_basis:'采用完整校验后的候选，保留未涉及的定义和原始来源。',definitions:candidate};
  const file=path.join(spec.folder,'freeze-command.txt');fs.writeFileSync(file,'/acceptance-freeze '+canonical(message)+'\n');return file;
}

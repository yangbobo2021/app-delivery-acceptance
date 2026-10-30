import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {projectRoot,inside} from '../create/initialize.mjs';
import {parseJson} from './json.mjs';
export {projectRoot,inside};
export function ownedAbsolute(base,file){
  if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Absolute owned artifact path required');
  const lexical=path.resolve(file),index=base.indexOf(path.sep+'.acceptance-local'+path.sep);
  const anchor=index>=0?base.slice(0,index):base;
  let prefix=path.parse(lexical).root,relative;
  for(const part of lexical.slice(prefix.length).split(path.sep)){
    prefix=path.join(prefix,part);
    try{if(fs.realpathSync(prefix)===anchor){relative=path.relative(prefix,lexical);break;}}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}
  }
  if(relative===undefined)throw Error('Artifact belongs to another acceptance: '+file);
  const result=inside(anchor,relative);
  if(result!==base&&!result.startsWith(base+path.sep))throw Error('Artifact belongs to another acceptance: '+file);
  return result;
}
const ID=/^AT-[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
export const read=file=>{
  const value=parseJson(fs.readFileSync(file,'utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('JSON object required: '+file);
  return value;
};
export function locations(project,id){
  if(!ID.test(id??''))throw Error('acceptance ID must use the stable AT- prefix');
  const root=projectRoot(project);
  return {root,shared:inside(root,'.acceptance/'+id),local:inside(root,'.acceptance-local/'+id)};
}
export function current(project){
  const root=projectRoot(project),file=inside(root,'.acceptance-local/current.json');
  if(!fs.existsSync(file))return null;
  const pointer=read(file);
  if(Object.keys(pointer).length!==1||!ID.test(pointer.acceptance_id??''))throw Error('current.json must contain only a stable acceptance_id');
  const {shared}=locations(root,pointer.acceptance_id),manifest=read(path.join(shared,'manifest.json'));
  if(manifest.schema!=='acceptance-manifest-v1'||manifest.acceptance_id!==pointer.acceptance_id)throw Error('current.json points to an invalid acceptance manifest');
  return pointer.acceptance_id;
}
export function requireCurrent(project,id){
  const active=current(project);
  if(!active)throw Error('no current acceptance; explicitly start the intended ID before startup or resume');
  if(active!==id)throw Error('current acceptance mismatch: '+active+', not '+id+'; cannot silently switch');
  return active;
}
export function lifecycleLock(project,operation){
  const root=projectRoot(project),directory=inside(root,'.acceptance-local/current.lock.d');
  fs.mkdirSync(path.dirname(directory),{recursive:true,mode:0o700});
  try{fs.mkdirSync(directory,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw Error('acceptance lifecycle is busy; inspect current.lock.d before recovery');throw error;}
  try{
    fs.writeFileSync(path.join(directory,'owner.json'),JSON.stringify({pid:process.pid,created_at:new Date().toISOString()}),{flag:'wx',mode:0o600});
    return operation(root);
  }finally{fs.unlinkSync(path.join(directory,'owner.json'));fs.rmdirSync(directory);}
}
export function atomicJson(file,value){
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}
  finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
export function start(project,id){
  const {root,shared}=locations(project,id);
  return lifecycleLock(root,()=>{
    const active=current(root);
    if(active&&active!==id)throw Error('current acceptance is '+active+'; finish it before starting '+id);
    const manifest=read(inside(shared,'manifest.json'));
    if(manifest.schema!=='acceptance-manifest-v1'||manifest.acceptance_id!==id||!manifest.project_id||!manifest.title||!manifest.owner)throw Error('invalid acceptance manifest');
    if(!active)atomicJson(inside(root,'.acceptance-local/current.json'),{acceptance_id:id});
    return {acceptance_id:id,status:'current'};
  });
}
export function finish(project,id){
  const {root,shared}=locations(project,id);
  return lifecycleLock(root,()=>{
    const active=current(root);
    if(!active){if(read(inside(shared,'manifest.json')).acceptance_id!==id)throw Error('unknown acceptance ID');return {acceptance_id:id,status:'already_finished'};}
    requireCurrent(root,id);fs.unlinkSync(inside(root,'.acceptance-local/current.json'));
    return {acceptance_id:id,status:'finished'};
  });
}

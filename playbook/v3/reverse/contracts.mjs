import {readFileSync,existsSync} from 'node:fs';
import {resolve,isAbsolute,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(root,path)=>{const rel=relative(root,path);return rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)};
const sourcePathValid=path=>typeof path==='string'&&path.length>0&&!isAbsolute(path)&&
 path.split('/').every(part=>part&&part!=='.'&&part!=='..');

export function contractPath(file,project){
 if(file.source_repo){
  if(!isAbsolute(file.path))throw Error('External contract snapshot needs an absolute path');
  return resolve(file.path);
 }
 const path=resolve(project,file.path);
 if(!within(resolve(project),path))throw Error('Contract missing/outside project: '+file.path);
 return path;
}

export function verifyContract(file,project){
 const path=contractPath(file,project);
 if(!existsSync(path))throw Error('Independent contract missing: '+file.path);
 const bytes=readFileSync(path);
 if(sha(bytes)!==file.sha256)throw Error('Independent contract drift: '+file.path);
 if(file.source_repo){
  if(!isAbsolute(file.source_repo)||!sourcePathValid(file.source_path)||
     !/^[0-9a-f]{40}$/.test(file.source_ref))throw Error('External contract provenance incomplete');
  const repo=resolve(file.source_repo);
  const kind=execFileSync('git',['cat-file','-t',file.source_ref],{cwd:repo,encoding:'utf8'}).trim();
  if(kind!=='commit')throw Error('External contract source ref is not a commit');
  const original=execFileSync('git',['show',`${file.source_ref}:${file.source_path}`],{cwd:repo,maxBuffer:20_000_000});
  if(sha(original)!==file.sha256)throw Error('External contract snapshot differs from declared Git source: '+file.path);
 }
 return bytes;
}

export function freezeContract(input,project){
 if(typeof input==='string'){
  const path=contractPath({path:input},project);
  const bytes=readFileSync(path);
  return {path:input,sha256:sha(bytes),content:bytes.length<=12000?bytes.toString('utf8'):null};
 }
 if(!input||typeof input!=='object'||typeof input.path!=='string'||
    typeof input.source_repo!=='string'||typeof input.source_ref!=='string'||
    typeof input.source_path!=='string')throw Error('External contract needs path, source_repo, source_ref and source_path');
 const path=contractPath(input,project);
 const bytes=readFileSync(path);
 const file={path:input.path,sha256:sha(bytes),content:bytes.length<=12000?bytes.toString('utf8'):null,
  source_repo:resolve(input.source_repo),source_ref:input.source_ref,source_path:input.source_path};
 if(input.sha256&&input.sha256!==file.sha256)throw Error('External contract declared hash differs');
 verifyContract(file,project);
 return file;
}

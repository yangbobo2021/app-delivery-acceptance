import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
import {read,inside,atomicJson} from './store.mjs';
import {digest} from './definitions.mjs';
import {git} from './workspace.mjs';
import {verifyIdentity} from './identity.mjs';
export function snapshotExisting(catalog){
  const root=fs.realpathSync(catalog.project_root),files={},revisions={};
  for(const prefix of ['',...(catalog.components??[]).map(item=>item.path)]){
    const repo=inside(root,prefix);revisions[prefix]=git(repo,'rev-parse','HEAD').trim();
    const names=new Set(git(repo,'ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean));
    for(const name of names){const file=path.join(repo,name),key=prefix?prefix+'/'+name:name;let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT'){files[key]={missing:true};continue;}throw error;}
      if(stat.isSymbolicLink())files[key]={symlink:fs.readlinkSync(file)};else if(stat.isFile())files[key]={sha256:digest(file),mode:stat.mode&0o777};
    }
  }
  return {root,revisions,files};
}
export function verifyExisting(catalog,baseline,answer){
  const expected=structuredClone(baseline);
  if(answer?.case_identity){const report=verifyIdentity(answer,catalog.project_root);for(const [name,patch]of Object.entries(report.patches)){
    const item=expected.files[name];if(!item||item.sha256!==patch.before_sha256||item.mode!==patch.mode)throw Error('ID annotation does not match finder startup bytes/mode');item.sha256=patch.after_sha256;
  }}
  if(!equal(snapshotExisting(catalog),expected))throw Error('existing_only forbids source/test changes, additions or deletions');
  for(const name of answer?.test_files??[])if(!baseline.files[name]||baseline.files[name].missing)throw Error('existing_only test file was not present at startup: '+name);
}
export function verifyExistingDebug(output,answer){
  if(!['passed_local','product_failure'].includes(answer.status))return;
  const receipts=[];function visit(directory){if(!fs.existsSync(directory))return;for(const name of fs.readdirSync(directory)){const candidate=path.join(directory,name),stat=fs.lstatSync(candidate);if(stat.isSymbolicLink())continue;const file=inside(directory,name);if(stat.isDirectory())visit(file);else if(stat.isFile()&&name==='execution.json')receipts.push(read(file));}}visit(path.join(output,'debug'));
  if(!receipts.length||(answer.status==='passed_local'&&!receipts.some(r=>r.exit_code===0)))throw Error('existing_only local observations require an actual debug execution receipt');
}
export function existingPolicy(operation,catalog,output){
  const file=path.join(output,'existing-files.json');
  if(operation==='start'){if(fs.existsSync(file))verifyExisting(catalog,read(file));else atomicJson(file,snapshotExisting(catalog));}
  else if(operation==='verify'){const answerFile=path.join(output,'answer.json'),answer=fs.existsSync(answerFile)?read(answerFile):undefined;verifyExisting(catalog,read(file),answer);if(answer)verifyExistingDebug(output,answer);}
  else throw Error('Expected start or verify');return {status:'valid'};
}

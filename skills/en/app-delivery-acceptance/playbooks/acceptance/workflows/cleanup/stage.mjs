import {createHash} from 'node:crypto';
import {noSecrets} from '../archive/stage.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual as equal} from 'node:util';
import {locations,inside,ownedAbsolute,read,current} from '../shared/store.mjs';
import {digest} from '../shared/definitions.mjs';
import {validateStore} from '../shared/validation.mjs';
import {workspaceMetadataLock,workspaceSnapshot,git} from '../shared/workspace.mjs';
import {filesUnder,inspectProcesses,assertQuiescent} from '../shared/recovery.mjs';
export function cleanupAcceptance(input){
 const allowed=['project_root','acceptance_id','request_id','basis','assets','archive_record','missing_attachment_limits','candidate_test_roots'];if(!input||Object.keys(input).some(k=>!allowed.includes(k))||!String(input.basis??'').trim()||!Array.isArray(input.assets)||!input.assets.length||new Set(input.assets).size!==input.assets.length||!Array.isArray(input.missing_attachment_limits)||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(input.request_id??''))throw Error('Explicit selected local assets, cleanup identity, basis and attachment limits required');
 const {root,shared,local}=locations(input.project_root,input.acceptance_id);validateStore(root,input.acceptance_id,{requireScope:false});if(current(root)===input.acceptance_id)throw Error('Finish the matching acceptance before cleaning its local assets');
 const recordFile=inside(shared,'records/lifecycle/cleanup-'+input.request_id+'.json');if(fs.existsSync(recordFile)){const previous=read(recordFile);if(!equal(previous.input,input))throw Error('Cleanup request identity conflict');return {status:'already_cleaned',record:recordFile};}
 const archive=ownedAbsolute(inside(shared,'records'),input.archive_record),publication=read(path.join(archive,'record.json'));if(publication.acceptance_id!==input.acceptance_id||publication.schema!=='acceptance-evidence-record-v1')throw Error('Cleanup requires a valid matching evidence archive');for(const [name,hash]of Object.entries(publication.files))if(digest(inside(archive,name))!==hash)throw Error('Recoverable archive changed');
 const destinations=input.assets.map(name=>{if(typeof name!=='string'||!name||name==='.'||!['workspace','workflows','runtime','env'].includes(name.split('/')[0]))throw Error('Only explicit workspace/workflow/runtime/env assets of this AT may be removed');const file=inside(local,name);if(file===local||['workspace.lock.d','recovery.lock.d','workspace-owner.json'].includes(path.basename(file)))throw Error('Ownership metadata cannot be bypassed by cleanup');return file;});
 for(const file of destinations)assertQuiescent(inspectProcesses(file));
 return workspaceMetadataLock(root,input.acceptance_id,()=>{
  if(fs.existsSync(inside(local,'workspace-owner.json')))throw Error('A scene still owns this workspace; finish/reconcile it before cleanup');
  const backup={},removed=[],commands=[];
  for(const asset of destinations){if(!fs.existsSync(asset))continue;if(asset===inside(local,'workspace')){
    const state=workspaceSnapshot(asset),files={},roots=input.candidate_test_roots;
    if(!Array.isArray(roots)||!roots.length||roots.some(r=>typeof r!=='string'||!r||r==='.'||path.isAbsolute(r)||r.split('/').some(p=>['..','.git','.acceptance','.acceptance-local'].includes(p))))throw Error('Workspace cleanup requires explicit candidate test roots');
    for(const prefix of Object.keys(state.revisions)){const repo=inside(asset,prefix),names=new Set([...git(repo,'diff','--name-only','HEAD','-z').split('\0'),...git(repo,'ls-files','--others','--exclude-standard','-z').split('\0')].filter(Boolean));for(const relative of names){const name=prefix?prefix+'/'+relative:relative;if(!roots.some(r=>name===r||name.startsWith(r.replace(/\/$/,'')+'/')))throw Error('Unintegrated change outside authorized candidate test roots: '+name);const file=inside(asset,name),hash=state.files[name];if(hash==='missing'){files[name]={missing:true};continue;}if(hash?.startsWith('symlink:'))throw Error('Candidate symlink needs explicit recovery handling');noSecrets(file);files[name]={base64:fs.readFileSync(file).toString('base64'),mode:fs.statSync(file).mode&0o777,sha256:hash};}}
    backup.workspace={snapshot:state,files};
   }else{
    for(const file of filesUnder(asset)){const original=publication.original_paths[file],archived=original?inside(archive,original):null;if(/(?:answer\.json|execution\.json|result\.json|request\.frozen\.json|case-identities\.json)$/.test(file)&&(!archived||digest(archived)!==digest(file))&&!input.missing_attachment_limits.length)throw Error('Selected local result lacks recoverable publication or explicit missing-attachment limitation');}
   }
  }
  const backupFile=inside(shared,'records/lifecycle/cleanup-'+input.request_id+'-candidates.json');fs.mkdirSync(path.dirname(backupFile),{recursive:true});fs.writeFileSync(backupFile,JSON.stringify({schema:'acceptance-cleanup-backup-v1',acceptance_id:input.acceptance_id,created_at:new Date().toISOString(),backup},null,2)+'\n',{flag:'wx'});
  // Verify the durable copy before any removal; shared records never enter destinations.
  for(const [name,item]of Object.entries(read(backupFile).backup.workspace?.files??{}))if(!item.missing&&createHash('sha256').update(Buffer.from(item.base64,'base64')).digest('hex')!==item.sha256||!item.missing&&digest(inside(local,'workspace/'+name))!==item.sha256)throw Error('Candidate backup verification failed');
  for(const asset of destinations){if(!fs.existsSync(asset))continue;if(asset===inside(local,'workspace')){
    const parts=backup.workspace.snapshot.revisions;for(const prefix of Object.keys(parts).filter(Boolean).sort((a,b)=>b.length-a.length)){const child=inside(asset,prefix),common=git(child,'rev-parse','--path-format=absolute','--git-common-dir').trim(),p=spawnSync('git',['--git-dir',common,'worktree','remove','--force',child],{cwd:root,encoding:'utf8'});commands.push({argv:['git','worktree','remove','--force',child],exit_code:p.status,stdout:p.stdout,stderr:p.stderr});if(p.status!==0)throw Error('Component checkout removal failed; candidate backup remains');}
    const p=spawnSync('git',['worktree','remove','--force',asset],{cwd:root,encoding:'utf8'});commands.push({argv:['git','worktree','remove','--force',asset],exit_code:p.status,stdout:p.stdout,stderr:p.stderr});if(p.status!==0)throw Error('Git worktree removal failed; candidate backup remains');
   }else fs.rmSync(asset,{recursive:true});removed.push(path.relative(local,asset));
  }
  const value={schema:'acceptance-cleanup-record-v1',acceptance_id:input.acceptance_id,input,cleaned_at:new Date().toISOString(),removed,commands,candidate_backup:{path:backupFile,sha256:digest(backupFile)},archive_record:archive,missing_attachment_limits:input.missing_attachment_limits,recompute_policy:'Only explicitly preserved native coverage dependencies can be recomputed.'};fs.writeFileSync(recordFile,JSON.stringify(value,null,2)+'\n',{flag:'wx'});return {status:'cleaned',record:recordFile,candidate_backup:backupFile,removed};
 });
}

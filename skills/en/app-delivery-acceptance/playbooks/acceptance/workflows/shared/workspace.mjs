import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {acceptanceGuard} from './guard.mjs';
import {locations,inside,read,atomicJson,ownedAbsolute} from './store.mjs';

export function workspacePath(config){
  const {root,local}=locations(config.acceptance.project_root,config.acceptance.id),workspace=inside(local,'workspace');
  if((config.workspace_policy??'single-acceptance-v1')!=='single-acceptance-v1')throw Error('Only the single acceptance workspace is supported');
  if(config.workspace&&path.resolve(config.workspace)!==workspace)throw Error('Workspace belongs to another acceptance');
  return {root,local,workspace};
}
function checkRecovery(local){
  const gate=inside(local,'recovery.lock.d');if(fs.existsSync(gate)&&read(path.join(gate,'owner.json')).pid!==process.pid)throw Error('Acceptance recovery is active or uncertain; do not start another workspace operation');
}
function ownedOutput(local,output){
  const workflowRoot=inside(local,'workflows'),canonical=ownedAbsolute(workflowRoot,path.resolve(output));
  if(!canonical.startsWith(workflowRoot+path.sep))throw Error('Workspace output must belong to this acceptance workflows');
  return inside(workflowRoot,path.relative(workflowRoot,canonical));
}
export function workspaceMetadataLock(project,id,operation){
  const {local}=locations(project,id);checkRecovery(local);const marker=inside(local,'workspace-lock-protocol.json'),legacy=inside(local,'workspace.lock'),claim=inside(local,'workspace.lock.d');
  if(fs.existsSync(legacy)&&!fs.existsSync(marker))throw Error('Legacy workspace lock needs a verified quiescent protocol upgrade before Node ownership');
  if(fs.existsSync(marker)){const value=read(marker);if(value.schema!=='acceptance-workspace-lock-protocol-v2'||value.acceptance_id!==id)throw Error('Workspace lock protocol identity mismatch');}
  try{fs.mkdirSync(claim,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw Error('Acceptance workspace stage is running or has an uncertain claim; inspect before freezing');throw error;}
  const token=randomUUID(),file=path.join(claim,'owner.json');
  try{
    fs.writeFileSync(file,JSON.stringify({schema:'acceptance-workspace-claim-v2',runtime:'node',pid:process.pid,token,acceptance_id:id}),{flag:'wx',mode:0o600});
    if(!fs.existsSync(marker))atomicJson(marker,{schema:'acceptance-workspace-lock-protocol-v2',acceptance_id:id});
    return operation();
  }finally{if(fs.existsSync(file)&&read(file).token!==token)throw Error('Workspace claim changed; preserve it for inspection');if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(claim);}
}
export async function workspaceLease(config,output,operation,{scene=false}={}){
  acceptanceGuard(config,[output]);
  const {local,workspace}=workspacePath(config),target=ownedOutput(local,output);checkRecovery(local);
  const marker=inside(local,'workspace-lock-protocol.json'),oldLock=inside(local,'workspace.lock');
  if(fs.existsSync(oldLock)&&!fs.existsSync(marker))throw Error('Legacy workspace lock needs a verified quiescent protocol upgrade before Node ownership; preserve the old attempt');
  if(fs.existsSync(marker)){
    const value=read(marker);
    if(value.schema!=='acceptance-workspace-lock-protocol-v2'||value.acceptance_id!==config.acceptance.id)throw Error('Workspace lock protocol identity mismatch');
  }
  const claim=inside(local,'workspace.lock.d');
  try{fs.mkdirSync(claim,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw Error('Acceptance workspace has an active or uncertain claim; inspect before recovery');throw error;}
  const token=randomUUID(),ownerFile=inside(local,'workspace-owner.json');
  try{
    const owner={schema:'acceptance-workspace-claim-v2',runtime:'node',pid:process.pid,token,acceptance_id:config.acceptance.id,output_dir:target,created_at:new Date().toISOString()};
    fs.writeFileSync(path.join(claim,'owner.json'),JSON.stringify(owner,null,2)+'\n',{flag:'wx',mode:0o600});
    acceptanceGuard(config,[output]);
    if(!fs.existsSync(marker))atomicJson(marker,{schema:'acceptance-workspace-lock-protocol-v2',acceptance_id:config.acceptance.id});
    const prior=fs.existsSync(ownerFile)?read(ownerFile):null;
    if(prior&&(!scene||prior.output_dir!==target))throw Error('Another scene owns this workspace; resume/reconcile it first');
    if(scene&&!prior)atomicJson(ownerFile,{schema:'acceptance-workspace-owner-v1',acceptance_id:config.acceptance.id,output_dir:target});
    return await operation({workspace,output:target,env:{...process.env,ACCEPTANCE_WORKSPACE_LEASE:target,ACCEPTANCE_WORKSPACE_CLAIM:token}});
  }finally{
    const file=path.join(claim,'owner.json');
    if(fs.existsSync(file)&&read(file).token!==token)throw Error('Workspace claim ownership changed; preserve it for inspection');
    if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(claim);
  }
}
export function finishScene(config,output){
  const {local}=workspacePath(config),file=inside(local,'workspace-owner.json'),target=ownedOutput(local,output);
  const claim=read(inside(local,'workspace.lock.d/owner.json'));
  if(claim.runtime!=='node'||claim.pid!==process.pid||claim.acceptance_id!==config.acceptance.id)throw Error('Finish scene requires this host to hold its Node workspace lease');
  if(!fs.existsSync(file)||read(file).output_dir!==target)throw Error('Workspace scene ownership changed');
  fs.unlinkSync(file);
}

export function git(root,...args){
  const result=spawnSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('Cannot inspect frozen Git workspace: '+result.stderr.trim());
  return result.stdout;
}
export function ensureWorkspace(config,source,revision,components=[],componentSources={},observations=[]){
  const {local,workspace}=workspacePath(config),claim=read(inside(local,'workspace.lock.d/owner.json'));
  if(claim.runtime!=='node'||claim.pid!==process.pid||claim.acceptance_id!==config.acceptance.id)throw Error('Workspace preparation requires this Node host to hold its claim');
  source=fs.realpathSync(source);if(git(source,'rev-parse','HEAD').trim()!==revision)throw Error('source revision differs from frozen catalog/spec');
  const common=fs.realpathSync(git(source,'rev-parse','--path-format=absolute','--git-common-dir').trim());
  function add(origin,destination,ref){
    const args=['worktree','add','--detach',destination,ref],started_at=new Date().toISOString(),result=spawnSync('git',args,{cwd:origin,encoding:'utf8',maxBuffer:32*1024*1024});observations.push({program:'git',args,cwd:origin,started_at,finished_at:new Date().toISOString(),exit_code:result.status,stdout:result.stdout,stderr:result.stderr});
    if(result.error)throw result.error;if(result.status!==0)throw Error('Workspace creation failed: '+result.stderr);
  }
  if(fs.existsSync(workspace)){
    if(!fs.existsSync(inside(workspace,'.git'))||fs.realpathSync(git(workspace,'rev-parse','--show-toplevel').trim())!==workspace)throw Error('Workspace exists but is not its registered Git checkout; never overwrite it');
    if(git(workspace,'rev-parse','HEAD').trim()!==revision)throw Error('Workspace revision changed; freeze a new version/catalog under the same acceptance ID');
    if(fs.realpathSync(git(workspace,'rev-parse','--path-format=absolute','--git-common-dir').trim())!==common)throw Error('Workspace belongs to another Git repository');
  }else add(source,workspace,revision);
  for(const item of components){
    const part=inside(workspace,item.path);if(part===workspace)throw Error('Component must be beneath workspace');
    if(fs.existsSync(inside(part,'.git'))){if(fs.realpathSync(git(part,'rev-parse','--show-toplevel').trim())!==part)throw Error('Invalid component checkout');}
    else{
      if(fs.existsSync(part)){if(!fs.statSync(part).isDirectory()||fs.readdirSync(part).length)throw Error('Component destination is not empty; never overwrite it');fs.rmdirSync(part);}
      const origin=fs.realpathSync(componentSources[item.path]??path.join(source,item.path));if(git(origin,'rev-parse','HEAD').trim()!==item.revision)throw Error('Component source revision mismatch');add(origin,part,item.revision);
    }
    if(git(part,'rev-parse','HEAD').trim()!==item.revision)throw Error('Component revision changed; prepare the new version explicitly');
  }
  return workspace;
}
export function workspaceSnapshot(root,components=[]){
  const files={},revisions={};
  for(const prefix of ['',...components.map(item=>item.path)]){
    const repo=inside(root,prefix);revisions[prefix]=git(repo,'rev-parse','HEAD').trim();
    const names=new Set(git(repo,'ls-files','-z','--cached','--others','--exclude-standard').split('\0').filter(Boolean));
    for(const name of names){
      const key=prefix?prefix+'/'+name:name,file=path.join(repo,name);
      if(!path.resolve(file).startsWith(root+path.sep))throw Error('Git path escapes workspace');
      let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT'){files[key]='missing';continue;}throw error;}
      if(stat.isSymbolicLink()){files[key]='symlink:'+fs.readlinkSync(file);continue;}
      if(!stat.isFile())continue;
      const hash=createHash('sha256'),buffer=Buffer.alloc(256*1024),fd=fs.openSync(file,'r');
      try{for(;;){const size=fs.readSync(fd,buffer,0,buffer.length,null);if(!size)break;hash.update(buffer.subarray(0,size));}}finally{fs.closeSync(fd);}
      files[key]=hash.digest('hex');
    }
  }
  return {files,revisions};
}
export function verifyAllowedChanges(root,before,allowedRoots,components=[]){
  if(!Array.isArray(allowedRoots)||allowedRoots.some(name=>typeof name!=='string'||!name||name==='.'||path.isAbsolute(name)||name.split('/').some(part=>['..','.git','.acceptance','.acceptance-local'].includes(part))))throw Error('Explicit test-only write roots are required');
  const after=workspaceSnapshot(root,components);
  if(JSON.stringify(before.revisions)!==JSON.stringify(after.revisions))throw Error('Agent changed a product or component revision');
  const changes=[...new Set([...Object.keys(before.files),...Object.keys(after.files)])].filter(name=>before.files[name]!==after.files[name]);
  for(const name of changes){
    if(!allowedRoots.some(scope=>name===scope.replace(/\/$/,'')||name.startsWith(scope.replace(/\/$/,'')+'/')))throw Error('Workspace change outside declared test roots: '+name);
    if(after.files[name]?.startsWith('symlink:'))throw Error('New or modified test symlinks are not allowed: '+name);
  }
  return {changes,after};
}

// Short deterministic stages use the same exclusive claim without an async gap.
export function workspaceLeaseSync(config,output,operation){
  acceptanceGuard(config,[output]);const {root,local,workspace}=workspacePath(config),target=ownedOutput(local,output);
  return workspaceMetadataLock(root,config.acceptance.id,()=>{
    const ownerFile=inside(local,'workspace-owner.json');if(fs.existsSync(ownerFile))throw Error('Another scene owns this workspace; resume/reconcile it first');
    const claimFile=inside(local,'workspace.lock.d/owner.json'),claim=read(claimFile);atomicJson(claimFile,{...claim,output_dir:target});acceptanceGuard(config,[output]);
    return operation({workspace,output:target});
  });
}

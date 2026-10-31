#!/usr/bin/env node
// Dependency-free bootstrap for the Playbook package's own locked Node environment.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export function ensureRuntime({packageRoot=fileURLToPath(new URL('..',import.meta.url)),env=process.env,npmExecutable='npm',lockWaitMs=30000}={}){
  if(!['darwin','linux','win32'].includes(process.platform))throw Error('This Playbook package has no verified runtime preparation for this host');
  if(Number(process.versions.node.split('.')[0])<22)throw Error('Node.js >=22 is required');
  const root=fs.realpathSync(packageRoot),modules=path.join(root,'node_modules');
  try{if(fs.lstatSync(modules).isSymbolicLink())throw Error('Playbook package node_modules must be a local directory');}catch(error){if(error.code!=='ENOENT')throw error;}
  const processEnv={...env};delete processEnv.NODE_PATH;
  for(const key of Object.keys(processEnv))if(['npm_config_prefix','npm_config_global','npm_config_package_lock','npm_config_omit'].includes(key.toLowerCase()))delete processEnv[key];
  const pathKey=process.platform==='win32'?(Object.keys(processEnv).find(key=>key.toLowerCase()==='path')??'Path'):'PATH';
  processEnv[pathKey]=path.dirname(process.execPath)+path.delimiter+(processEnv[pathKey]??'');
  const run=(program,args,timeout=60000)=>{
    const result=spawnSync(program,args,{cwd:root,env:processEnv,encoding:'utf8',timeout,maxBuffer:8*1024*1024});
    if(result.error)throw result.error;
    if(result.status!==0)throw Error(program+' failed ('+result.status+'): '+(result.stderr??'').slice(-5000));
    return result.stdout.trim();
  };
  const npmCommand=process.platform==='win32'&&npmExecutable==='npm'
    ? [process.execPath,path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')]
    : [npmExecutable];
  const runNpm=(args,timeout)=>run(npmCommand[0],[...npmCommand.slice(1),...args],timeout);
  run('git',['--version']);const npm=runNpm(['--version']);
  const manifest=fs.readFileSync(path.join(root,'package.json')),lock=fs.readFileSync(path.join(root,'npm-shrinkwrap.json'));
  const identity={node:process.version,node_path:fs.realpathSync(process.execPath),platform:process.platform,arch:process.arch,npm};
  const fingerprint=createHash('sha256').update(manifest).update('\0').update(lock).update('\0').update(JSON.stringify(identity)).digest('hex');
  const claim=path.join(root,'.runtime-install.lock.d'),receipt=path.join(modules,'.acceptance-node-runtime.json');
  if(!Number.isSafeInteger(lockWaitMs)||lockWaitMs<0||lockWaitMs>60000)throw Error('Runtime lock wait must be 0..60000 milliseconds');
  const token=randomUUID(),started=Date.now(),deadline=started+lockWaitMs,sleeper=new Int32Array(new SharedArrayBuffer(4));let missingSince=null;
  const busy=()=>Error('Playbook package runtime preparation is busy or uncertain; inspect .runtime-install.lock.d before retrying');
  for(;;){
    try{fs.mkdirSync(claim,{mode:0o700});break;}catch(error){if(error.code!=='EEXIST')throw error;}
    let owner;try{owner=JSON.parse(fs.readFileSync(path.join(claim,'owner.json'),'utf8'));}catch{}
    if(!fs.existsSync(claim))continue;
    if(owner){
      missingSince=null;
      if(owner.schema!=='acceptance-node-runtime-claim-v1'||owner.package_root!==root||typeof owner.token!=='string'||!owner.token||!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw busy();
      try{process.kill(owner.pid,0);}catch(error){if(error.code!=='EPERM')throw busy();}
    }else{missingSince??=Date.now();if(Date.now()-missingSince>=250)throw busy();}
    if(Date.now()>=deadline)throw busy();
    Atomics.wait(sleeper,0,0,Math.min(25,Math.max(1,deadline-Date.now())));
  }
  try{
    fs.writeFileSync(path.join(claim,'owner.json'),JSON.stringify({schema:'acceptance-node-runtime-claim-v1',pid:process.pid,package_root:root,token,created_at:new Date().toISOString()}),{flag:'wx',mode:0o600});
    const probe=()=>JSON.parse(run(process.execPath,[path.join(root,'runtime/verify-dependencies.mjs')]));
    let saved;try{saved=JSON.parse(fs.readFileSync(receipt));}catch{}
    if(saved?.fingerprint===fingerprint){try{return {...saved,status:'reused',probe:probe()};}catch{}}
    let status='validated_existing',verified;
    try{verified=probe();}catch{
      status='installed';
      runNpm(['ci','--prefix',root,'--global=false','--include=dev','--include=optional','--include=peer','--no-audit','--no-fund'],1800000);
      verified=probe();
    }
    const value={schema:'acceptance-node-runtime-v1',fingerprint,install_id:randomUUID(),validated_at:new Date().toISOString(),package_root:root,environment:identity,probe:verified};
    const temporary=receipt+'.'+randomUUID()+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,receipt);
    return {...value,status};
  }finally{const ownerFile=path.join(claim,'owner.json');if(fs.existsSync(ownerFile)){if(JSON.parse(fs.readFileSync(ownerFile,'utf8')).token!==token)throw Error('Runtime claim ownership changed; preserve it for inspection');fs.unlinkSync(ownerFile);}fs.rmdirSync(claim);}
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(ensureRuntime()));}catch(error){console.error('[acceptance-runtime] '+error.message);process.exitCode=1;}
}

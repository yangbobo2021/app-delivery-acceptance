import fs from'node:fs';import path from'node:path';import os from'node:os';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';import{packageFiles}from'../skills/en/app-delivery-acceptance/playbooks/acceptance/runtime/spex-skill-cache.mjs';
const skill=fileURLToPath(new URL('../skills/en/app-delivery-acceptance/',import.meta.url)),root=fs.mkdtempSync(path.join(os.tmpdir(),'acceptance-portable-setup-')),before=packageFiles(skill),hostPath=process.env.PATH;
const script=path.join(skill,'scripts',process.platform==='win32'?'setup.ps1':'setup.sh');
const command=process.platform==='win32'?['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',script]:['sh',script];
function invoke(env={}){const result=spawnSync(command[0],command.slice(1),{env:{...process.env,...env},encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});assert.ifError(result.error);return result;}
const first=invoke(),second=invoke();assert.equal(first.status,0,first.stderr);assert.equal(second.status,0,second.stderr);
const ready=JSON.parse(first.stdout),again=JSON.parse(second.stdout);assert(path.isAbsolute(ready.node));assert(path.isAbsolute(ready.playbook));assert.equal(again.preparation.status,'reused');assert.equal(ready.preparation.install_id,again.preparation.install_id);assert.equal(process.env.PATH,hostPath);assert.deepEqual(packageFiles(skill),before);
if(process.platform!=='win32'){
 const cache=path.join(root,'poisoned-runtime');fs.mkdirSync(path.join(cache,'downloads'),{recursive:true});const name='node-v24.22.2-'+process.platform+'-'+process.arch+'.tar.gz';fs.writeFileSync(path.join(cache,'downloads',name),'deliberately invalid archive bytes');
 const refused=invoke({ACCEPTANCE_RUNTIME_CACHE:cache,ACCEPTANCE_BOOTSTRAP_FORCE_NODE:'1'});assert.notEqual(refused.status,0);assert.match(refused.stderr,/checksum mismatch/);assert.deepEqual(packageFiles(skill),before);
 fs.writeFileSync(path.join(root,'rejected-cache.json'),JSON.stringify({exitCode:refused.status,stderr:refused.stderr},null,2));
}
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({status:'passed',platform:process.platform,preparation:first.stdout,reuse:second.stdout,sourceUnchanged:true,parentEnvironmentUnchanged:true},null,2));console.log('passed native platform setup, cache reuse, managed source and parent environment; evidence: '+root);

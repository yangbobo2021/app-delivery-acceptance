import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {ensureRuntime} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/runtime/dependencies.mjs';
const args=process.argv.slice(2),index=args.indexOf('--output');
const output=index<0?fs.mkdtempSync(path.join(os.tmpdir(),'node-bootstrap-proof-')):path.resolve(args[index+1]);fs.mkdirSync(output,{recursive:true});
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'node-bootstrap-project-')),results=[];
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
function fixture(name){
  const root=path.join(temporary,name);fs.mkdirSync(root);
  fs.writeFileSync(path.join(root,'package.json'),'{"private":true}');fs.writeFileSync(path.join(root,'npm-shrinkwrap.json'),'{"lockfileVersion":3}');
  fs.mkdirSync(path.join(root,'runtime'));
  fs.writeFileSync(path.join(root,'runtime/verify-dependencies.mjs'),'import fs from "node:fs";if(!fs.existsSync("node_modules/ready"))process.exit(1);console.log(JSON.stringify({ready:true}));');
  const npm=path.join(root,'fixture-npm');
  fs.writeFileSync(npm,'#!'+process.execPath+'\n'+`const fs=require('node:fs');if(process.argv[2]==='--version'){console.log('fixture-1');process.exit(0);}fs.appendFileSync('calls.jsonl',JSON.stringify({argv:process.argv.slice(2),prefix:process.env.npm_config_prefix??null,global:process.env.npm_config_global??null})+'\\n');if(process.env.FAIL_FIXTURE_INSTALL==='1')process.exit(7);fs.mkdirSync('node_modules',{recursive:true});fs.writeFileSync('node_modules/ready','installed');`);
  fs.chmodSync(npm,0o755);return {root,npm};
}
function test(id,purpose,body){try{results.push({id,purpose,status:'passed',...(body()??{})});}catch(error){results.push({id,purpose,status:'failed',error:error.stack});process.exitCode=1;}save('results.json',results);console.log(results.at(-1).status+' '+id+' '+purpose);}
const f=fixture('install'),env={...process.env,npm_config_prefix:'/must-not-use',npm_config_global:'true'};
let first;
test('BOOT-01','缺依赖时真实启动受控安装进程，只向 Skill 包根执行锁定 ci',()=>{
  first=ensureRuntime({packageRoot:f.root,npmExecutable:f.npm,env});assert.equal(first.status,'installed');
  const calls=fs.readFileSync(path.join(f.root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length,1);assert.deepEqual(calls[0].argv.slice(0,4),['ci','--prefix',fs.realpathSync(f.root),'--global=false']);assert.equal(calls[0].prefix,null);assert.equal(calls[0].global,null);return {receipt:first,controlled_installer_calls:calls};
});
test('BOOT-02','重复准备只复核，不重装、不改安装回执',()=>{
  const receipt=path.join(f.root,'node_modules/.acceptance-node-runtime.json'),before=fs.readFileSync(receipt);
  const result=ensureRuntime({packageRoot:f.root,npmExecutable:f.npm,env});assert.equal(result.status,'reused');assert.equal(result.install_id,first.install_id);assert.deepEqual(fs.readFileSync(receipt),before);
  assert.equal(fs.readFileSync(path.join(f.root,'calls.jsonl'),'utf8').trim().split('\n').length,1);
});
test('BOOT-03','依赖损坏后重新安装并验证，不沿用旧就绪回执',()=>{
  fs.unlinkSync(path.join(f.root,'node_modules/ready'));const result=ensureRuntime({packageRoot:f.root,npmExecutable:f.npm,env});assert.equal(result.status,'installed');assert.notEqual(result.install_id,first.install_id);
});
test('BOOT-04','失败安装不发布就绪状态，保留失败后允许新调用恢复',()=>{
  const broken=fixture('broken');assert.throws(()=>ensureRuntime({packageRoot:broken.root,npmExecutable:broken.npm,env:{...env,FAIL_FIXTURE_INSTALL:'1'}}),/failed/);
  assert.equal(fs.existsSync(path.join(broken.root,'node_modules/.acceptance-node-runtime.json')),false);
  assert.equal(fs.existsSync(path.join(broken.root,'.runtime-install.lock.d')),false);
  assert.equal(ensureRuntime({packageRoot:broken.root,npmExecutable:broken.npm,env}).status,'installed');
});
test('BOOT-05','活跃或未知安装归属保留，Node 不夺取已有安装锁',()=>{
  const claim=path.join(f.root,'.runtime-install.lock.d');fs.mkdirSync(claim);fs.writeFileSync(path.join(claim,'owner.json'),'{"pid":123}');
  assert.throws(()=>ensureRuntime({packageRoot:f.root,npmExecutable:f.npm,env}),/busy or uncertain/);assert.equal(fs.readFileSync(path.join(claim,'owner.json'),'utf8'),'{"pid":123}');
});
test('BOOT-06','拒绝有效和悬空的外部 node_modules 链接，不触碰外部资产',()=>{
  for(const exists of [true,false]){const linked=fixture('link-'+exists),external=path.join(temporary,'external-'+exists);if(exists)fs.mkdirSync(external);
    fs.symlinkSync(external,path.join(linked.root,'node_modules'));assert.throws(()=>ensureRuntime({packageRoot:linked.root,npmExecutable:linked.npm,env}),/local directory/);
    assert.equal(fs.existsSync(path.join(linked.root,'calls.jsonl')),false);}
});
const concurrent=fixture('concurrent');
fs.writeFileSync(path.join(concurrent.root,'runtime/verify-dependencies.mjs'),'import fs from "node:fs";Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);if(!fs.existsSync("node_modules/ready"))process.exit(1);console.log(JSON.stringify({ready:true}));');
const launch=()=>new Promise(resolve=>{const child=spawn(process.execPath,['--input-type=module','-e',`import {ensureRuntime} from ${JSON.stringify(new URL('../skills/en/app-delivery-acceptance/playbooks/acceptance/runtime/dependencies.mjs',import.meta.url).href)};console.log(JSON.stringify(ensureRuntime(${JSON.stringify({packageRoot:concurrent.root,npmExecutable:concurrent.npm})})));`],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.once('close',exit_code=>resolve({exit_code,stdout,stderr}));child.once('error',error=>resolve({exit_code:null,stdout,stderr:error.message}));});
const processes=await Promise.all(Array.from({length:6},launch));
test('BOOT-07','六个真实 Node 进程并发准备同一环境，仅一个安装，其余有界等候后复核同一回执',()=>{
 for(const r of processes)assert.equal(r.exit_code,0,r.stderr);const receipts=processes.map(r=>JSON.parse(r.stdout));assert.equal(new Set(receipts.map(v=>v.install_id)).size,1);assert.equal(receipts.filter(v=>v.status==='installed').length,1);assert.equal(fs.readFileSync(path.join(concurrent.root,'calls.jsonl'),'utf8').trim().split('\n').length,1);assert.equal(fs.existsSync(path.join(concurrent.root,'.runtime-install.lock.d')),false);save('concurrent-processes.json',processes);return {install_id:receipts[0].install_id};
});
test('BOOT-08','有界等待仍活动的合法归属超时后保留原声明，不夺取安装权',()=>{
 const claim=path.join(concurrent.root,'.runtime-install.lock.d');fs.mkdirSync(claim);const file=path.join(claim,'owner.json'),original=JSON.stringify({schema:'acceptance-node-runtime-claim-v1',package_root:fs.realpathSync(concurrent.root),token:'live-test-owner',pid:process.pid});fs.writeFileSync(file,original);const started=Date.now();try{assert.throws(()=>ensureRuntime({packageRoot:concurrent.root,npmExecutable:concurrent.npm,lockWaitMs:100}),/busy or uncertain/);assert.ok(Date.now()-started<2000);assert.equal(fs.readFileSync(file,'utf8'),original);}finally{fs.unlinkSync(file);fs.rmdirSync(claim);}
});
save('summary.json',{output,temporary,fixture_boundary:'安装命令使用明确标记的受控进程夹具，非 npm 线上安装成功声明；生产锁包另以真实安装及验证记录核对。',passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,results});

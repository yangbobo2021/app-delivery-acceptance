// Real subprocess/integrity tests of the generic protocol, not product coverage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {materializeCoverageEntry} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/coverage/protocol/materialize.mjs';

const args=process.argv.slice(2),index=args.indexOf('--output');
const output=index<0?fs.mkdtempSync(path.join(os.tmpdir(),'coverage-entry-evidence-')):path.resolve(args[index+1]);
fs.mkdirSync(output,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'coverage-entry-project-')),testRoot=path.join(root,'tests');fs.mkdirSync(testRoot);
const backend=path.join(testRoot,'backend.mjs'),sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
fs.writeFileSync(backend,`import fs from 'node:fs';
const [op,input,output]=process.argv.slice(2),r=JSON.parse(fs.readFileSync(input));
if(op==='tools')fs.writeFileSync(output,JSON.stringify({tools:[{name:'node-protocol-fixture',version:process.version,role:'English diagnostic description'}]}));
else if(op==='run'){process.stdout.write('BUSINESS_STDOUT\\n');process.stderr.write('BUSINESS_STDERR\\n');fs.writeFileSync(output,JSON.stringify({exit_code:7,tools:r.tools,received_tools:r.tools,execution_env:process.env.PROJECT_EXECUTION_ENV??null}));process.exitCode=7;}
else if(op==='read'){process.stderr.write('AssertionError\\n');process.exitCode=2;}
else fs.writeFileSync(output,JSON.stringify({status:'valid',tools:r.tools,received_tools:r.tools}));
`);
const tools=[{name:'node-protocol-fixture',version:process.version,role:'中文用途描述：仅验证协议，不生成产品覆盖率'}];
let sequence=0;const commands=[],results=[];
function materialize(expected=tools){return materializeCoverageEntry({workspace:root,testRoots:['tests'],attempt:path.join(output,'attempt-'+(++sequence)),entry:[process.execPath,backend],tools:expected,adapterFiles:{'tests/backend.mjs':sha(backend)}});}
const entry=materialize();
function run(label,operation,request={},target=entry){
  const input=path.join(output,label+'.request.json'),response=path.join(output,label+'.response.json');write(input,request);
  const argv=[...target.entry.slice(1),operation,input,response],started_at=new Date().toISOString();
  const child=spawnSync(target.entry[0],argv,{encoding:'utf8',timeout:15000});
  const receipt={label,operation,command:[target.entry[0],...argv],started_at,finished_at:new Date().toISOString(),exit_code:child.status,signal:child.signal,stdout:child.stdout,stderr:child.stderr,error:child.error?.message};
  commands.push(receipt);write(path.join(output,'commands.json'),commands);
  return {...receipt,response,value:fs.existsSync(response)?JSON.parse(fs.readFileSync(response)):null};
}
function test(id,purpose,body){try{body();results.push({id,purpose,status:'passed'});}catch(error){results.push({id,purpose,status:'failed',error:error.stack});process.exitCode=1;}write(path.join(output,'results.json'),results);console.log(results.at(-1).status+' '+id+' '+purpose);}
test('ENTRY-01','实际子进程版本相同、用途描述语言不同时通过并输出唯一元数据',()=>{const r=run('descriptions','tools');assert.equal(r.exit_code,0,r.stderr);assert.deepEqual(r.value.tools,tools);});
test('ENTRY-02','真实版本不符时拒绝并保留预期、实际及命令',()=>{const wrong=materialize([{...tools[0],version:'0.invalid'}]);const r=run('version-mismatch','tools',{},wrong);assert.equal(r.exit_code,2);assert.match(r.stderr,/expected=.*0.invalid/);assert.match(r.stderr,/actual=.*node-protocol-fixture/);assert.equal(JSON.parse(fs.readFileSync(r.response+'.failure.json')).backend.exit_code,0);});
test('ENTRY-03','准备核验由固定入口完成，后端没有 verify-preparation 操作',()=>{const profile=path.join(output,'prepared.json');write(profile,{tools:[{...tools[0],role:'another description'}],adapter_files:{'tests/backend.mjs':sha(backend)}});const r=run('prepare','verify-preparation',{prepared:profile});assert.equal(r.exit_code,0,r.stderr);assert.equal(r.value.status,'valid');});
test('ENTRY-04','真实业务非零退出码及 stdout/stderr 原样透传',()=>{const r=run('business-failure','run');assert.equal(r.exit_code,7);assert.equal(r.stdout,'BUSINESS_STDOUT\n');assert.equal(r.stderr,'BUSINESS_STDERR\n');assert.equal(r.value.exit_code,7);});
test('ENTRY-05','后端收到唯一工具元数据，执行响应保持同一来源',()=>{const r=run('handoff','run');assert.equal(r.exit_code,7,r.stderr);assert.deepEqual(r.value.received_tools,tools);assert.deepEqual(r.value.tools,tools);});
test('ENTRY-06','原生重算的空断言仍保留操作、命令、退出码和原始错误',()=>{
  const raw=path.join(output,'diagnostic-native.json'),report=path.join(output,'diagnostic-report.json'),prepared=path.join(output,'diagnostic-prepared');
  fs.mkdirSync(prepared);write(raw,{fixture:true});write(path.join(prepared,'prepared.json'),{tools,adapter_files:{'tests/backend.mjs':sha(backend)},spec:{revision:'fixture',source_hashes:{}}});
  write(report,{empty_failure:true,prepared,prepared_sha256:sha(path.join(prepared,'prepared.json')),revision:'fixture',source_hashes:{},tools,raw_evidence:[{path:raw,sha256:sha(raw)}]});
  const r=run('empty-diagnostic','verify-report',{report});assert.equal(r.exit_code,2);const failure=JSON.parse(fs.readFileSync(r.response+'.failure.json'));
  assert.equal(failure.backend.exit_code,2);assert.equal(failure.backend.operation,'verify-report');assert.equal(failure.backend.backend_operation,'read');assert.equal(failure.backend.stderr,'AssertionError\n');assert.ok(failure.backend.command.includes(backend));assert.match(failure.message,/read/);
});
test('ENTRY-07','后端字节漂移被拒绝，恢复后原入口仍可用',()=>{const original=fs.readFileSync(backend);try{fs.appendFileSync(backend,'\n// drift\n');const r=run('drift','tools');assert.equal(r.exit_code,2);assert.match(r.stderr,/artifact missing or changed/);}finally{fs.writeFileSync(backend,original);}assert.equal(run('restored','tools').exit_code,0);});
test('ENTRY-08','拒绝覆盖旧响应及未冻结的后端',()=>{const r=run('preserved','tools'),before=sha(r.response);const again=spawnSync(entry.entry[0],[...entry.entry.slice(1),'tools',path.join(output,'preserved.request.json'),r.response],{encoding:'utf8'});assert.equal(again.status,2);assert.equal(sha(r.response),before);assert.throws(()=>materializeCoverageEntry({workspace:root,testRoots:['tests'],attempt:output,entry:[process.execPath,'/unbound/backend.mjs'],tools,adapterFiles:{'tests/backend.mjs':sha(backend)}}),/frozen project adapter/);});
test('ENTRY-09','归档入口不依赖原 Skill 路径，可从同哈希离线后端调用',()=>{const archive=path.join(output,'archive'),mapping={};fs.mkdirSync(archive);function copy(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())copy(file);else{const dest=path.join(archive,path.relative(root,file));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(file,dest);mapping[file]={path:dest,sha256:sha(file)};}}}copy(testRoot);fs.renameSync(root,root+'.offline');try{const target={entry:[process.execPath,path.join(archive,path.relative(root,entry.entry[1]))]};const r=run('offline','tools',{artifact_map:mapping},target);assert.equal(r.exit_code,0,r.stderr);assert.deepEqual(r.value.tools,tools);}finally{fs.renameSync(root+'.offline',root);}});
test('ENTRY-10','冻结项目环境传入实际后端子进程，不依赖外层 shell export',()=>{
  assert.equal(process.env.PROJECT_EXECUTION_ENV,undefined);
  const target=materializeCoverageEntry({workspace:root,testRoots:['tests'],attempt:path.join(output,'env-attempt'),entry:[process.execPath,backend],tools,adapterFiles:{'tests/backend.mjs':sha(backend)},executionEnv:{PROJECT_EXECUTION_ENV:'from-frozen-runtime'}});
  const result=run('frozen-project-env','run',{},target);assert.equal(result.exit_code,7,result.stderr);assert.equal(result.value.execution_env,'from-frozen-runtime');
});
write(path.join(output,'summary.json'),{boundary:'Protocol subprocess tests only; no product coverage claims.',passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,results,project:root});
console.log('Evidence: '+output);

import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {harness,read,sha} from './official_workflow_harness.mjs';
import {recordExecution} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/recorder.mjs';
import {collectDebugEvidence} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/cases/debug-evidence.mjs';
const h=harness('debug-evidence',[]),root=h.project('project'),debug=path.join(h.temporary,'debug');fs.mkdirSync(debug);
fs.writeFileSync(path.join(root,'actual.mjs'),'console.log("ACTUAL_DEBUG_COMMAND");process.exitCode=Number(process.argv[2]??0);\n');
h.run('init','git',['init','-q',root]);h.run('add','git',['-C',root,'add','.']);assert.equal(h.run('commit','git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@local','commit','-qm','Real debug receipt fixture']).exit_code,0);
async function execute(name,{code=0,complete=true,nested=false}={}){
 const attempt=path.join(debug,name),output=path.join(attempt,'execution');fs.mkdirSync(attempt);
 const receipt=await recordExecution({cwd:root,output:nested?path.join(output,'command'):output,command:[process.execPath,'actual.mjs',String(code)],files:['actual.mjs'],env:{}});
 if(nested)for(const file of ['execution.json','execution.log'])fs.copyFileSync(path.join(output,'command',file),path.join(output,file));
 if(complete)fs.writeFileSync(path.join(attempt,'debug-observation.json'),JSON.stringify({status:'observed',exit_code:receipt.exit_code,receipt:path.join(output,'execution.json'),product_verdict:'not_performed'}));
 return attempt;
}
const successful=await execute('completed',{nested:true});
h.test('DEBUG-EVIDENCE-01','真实命令的外层与包装层回执只计一次，完成标记关联实际日志',()=>{const value=collectDebugEvidence(debug);assert.equal(value.attempts,1);assert.equal(value.completed.length,1);assert.equal(value.incomplete,0);assert.equal(value.completed[0].receipt.exit_code,0);});
await execute('unfinished-wrapper',{complete:false,nested:true});
h.test('DEBUG-EVIDENCE-02','包装命令成功但没有完成调试标记时不成为 passed_local 的执行依据',()=>{const value=collectDebugEvidence(debug);assert.equal(value.attempts,2);assert.equal(value.completed.length,1);assert.equal(value.incomplete,1);});
await execute('observed-failure',{code:7});
h.test('DEBUG-EVIDENCE-03','真实非零调试保留失败状态，不转换为通过',()=>{const value=collectDebugEvidence(debug);assert.equal(value.attempts,3);assert.equal(value.completed.length,2);assert.ok(value.completed.some(item=>item.receipt.exit_code===7));});
h.test('DEBUG-EVIDENCE-04','完成标记不能借用另一次执行收据，恢复后原字节有效',()=>{const file=path.join(successful,'debug-observation.json'),bytes=fs.readFileSync(file),value=JSON.parse(bytes);try{value.receipt=path.join(debug,'observed-failure/execution/execution.json');fs.writeFileSync(file,JSON.stringify(value));assert.throws(()=>collectDebugEvidence(debug),/own execution receipt/);}finally{fs.writeFileSync(file,bytes);}assert.equal(collectDebugEvidence(debug).completed.length,2);});
h.test('DEBUG-EVIDENCE-05','调试日志漂移被拒绝，不接受只有完成标签的自述',()=>{const file=path.join(successful,'execution/execution.log'),bytes=fs.readFileSync(file);try{fs.appendFileSync(file,'tampered');assert.throws(()=>collectDebugEvidence(debug),/receipt or log changed/);}finally{fs.writeFileSync(file,bytes);}});
h.test('DEBUG-EVIDENCE-06','required 收尾报告缺失时不能以包装退出0与手工完成标签冒充完整调试',()=>{const file=path.join(successful,'execution/execution.json'),bytes=fs.readFileSync(file),value=JSON.parse(bytes);try{value.coverage_session_path=path.join(successful,'coverage-request.json');fs.writeFileSync(file,JSON.stringify(value));assert.throws(()=>collectDebugEvidence(debug),/ENOENT|coverage/);}finally{fs.writeFileSync(file,bytes);}assert.equal(collectDebugEvidence(debug).completed.length,2);});
h.save('actual-completed-observations.json',collectDebugEvidence(debug));
h.finish(['workflows/cases/debug-evidence.mjs','workflows/cases/stage.mjs','tests/debug_evidence.integration.mjs']);

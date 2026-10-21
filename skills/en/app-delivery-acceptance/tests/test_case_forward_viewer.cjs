// Independent probes for current case/task facts and reviewed coverage boundaries.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const View=require('../assets/ledger-viewer/results.js');
function sample(){
 const procedure={steps:[{action:'尝试取消他人预订',expected:'拒绝并保留记录'}],scenario_checks:[{scenario_id:'S',criterion:'A B C',scope:'A B C',covered_point_ids:['A','B','C'],step_numbers:[1]}]};
 const binding={manual_operations:[{id:'task',name:'人工检查取消',procedure}],case_design:{standard:'case-design-v1',items:[{criterion:'A B C',check_points:['A','B','C'].map(id=>({id,text:'检查'+id}))}]}};
 const scene={id:'S',acceptance:{criteria:['A B C']}};
 const progress={scenario_id:'S',attempt:1,phase:'completed',binding,result_sha256:'current-hash'};
 const result={scenario_id:'S',attempt:1,binding,case_results:[{association_key:'manual:task',status:'passed',summary:'本轮实测记录保持',step_results:[{step_number:1,actual:'返回拒绝且原记录保留',evidence:['current.json']}],evidence:['current.json']}]};
 const contribution={association_key:'manual:task',covered_point_ids:['A','B','C'],step_numbers:[1],reason:'独立核对三个实际检查'};
 const verdict={scenario_id:'S',result_sha256:'current-hash',assessment:{case_coverage:{standard:'case-design-v1',status:'sufficient',items:[{criterion:'A B C',status:'covered',reason:'三个检查均定位到真实操作',contributions:[contribution]}]}}};
 const run={execution_schema:2,progress:[progress],results:[result],scenario_reviews:[verdict],attempt_history:[]};
 const record={id:'RUN',documents:{'run.json':run,'scenarios.snapshot.json':{items:[scene]}}};
 return {binding,scene,progress,result,contribution,verdict,run,record};
}
test('repeated A B contributions cannot display sufficient without C',()=>{
 const f=sample();assert.equal(View.caseCoverageStatus(f.record,f.scene,f.binding),'sufficient');
 f.verdict.assessment.case_coverage.items[0].contributions=[{...f.contribution,covered_point_ids:['A','B']},{...f.contribution,covered_point_ids:['A','B']}];
 assert.equal(View.caseCoverageStatus(f.record,f.scene,f.binding),'invalid');
 f.verdict.assessment.case_coverage.status='partial';f.verdict.assessment.case_coverage.items[0].status='partial';
 assert.equal(View.caseCoverageStatus(f.record,f.scene,f.binding),'partial');
});
test('case coverage is unavailable for a different binding or prior observation hash',()=>{
 const f=sample();const changed=structuredClone(f.binding);changed.manual_operations[0].id='different-task';
 assert.equal(View.caseCoverageStatus(f.record,f.scene,changed),'invalid');
 f.verdict.result_sha256='prior-hash';assert.equal(View.caseCoverageStatus(f.record,f.scene,f.binding),'invalid');
});
test('repaired attempt displays only live task facts and excludes archived facts',()=>{
 const f=sample();f.run.attempt_history.push({scenario_id:'S',attempt:1,observation:f.result,review:f.verdict});
 f.run.results=[];f.run.scenario_reviews=[];f.progress.attempt=2;f.progress.phase='executing';delete f.progress.result_sha256;
 assert.equal(View.caseResult(f.record,f.scene,'manual:task'),undefined);
 assert.equal(View.caseCoverageStatus(f.record,f.scene,f.binding),null);
 f.progress.case_results=[{association_key:'manual:task',status:'failed',summary:'第2次发现实际越权',evidence:['attempt-2.json']}];
 assert.equal(View.caseResult(f.record,f.scene,'manual:task').summary,'第2次发现实际越权');
});

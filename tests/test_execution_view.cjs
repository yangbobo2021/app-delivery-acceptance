const {test}=require('node:test');
const assert=require('node:assert/strict');
const View=require('../assets/ledger-viewer/results.js');
test('structured operation plans retain authored steps without parsing raw prose',()=>{
 const operation_plan={objective:'验收证据边界',preconditions:['正常引用'],steps:['打开需求','切换异常引用'],criteria:['拒绝外部正文'],evidence_expected:['截图']};
 const record={documents:{'methods.snapshot.json':{items:[]}}};
 assert.deepEqual(View.plan(record,{method_ids:[]},{operation_plan,operation:'UNRELATED TECHNICAL TEXT'}).plans,[operation_plan]);
});
test('acceptance fallback uses only the frozen complete scenario without changing authored instructions',()=>{
 const acceptance={description:'目标',preconditions:['前置'],actions:['动作一','动作二'],criteria:['完整判据。不要自动拆句。'],evidence_expected:['截图']};
 const record={documents:{'scenarios.snapshot.json':{items:[{id:'S',acceptance}]},'scenarios.json':{items:[{id:'S',acceptance:{...acceptance,description:'CURRENT CHANGED'}}]}}};
 const original=JSON.stringify(record),p=View.plan(record,{id:'S',acceptance:{description:'CURRENT CHANGED'}},{operation:'RAW'});
 assert.equal(p.plans[0].objective,'目标');assert.deepEqual(p.plans[0].steps,['动作一','动作二']);assert.deepEqual(p.plans[0].criteria,acceptance.criteria);assert.equal(JSON.stringify(record),original);
 assert.equal(View.plan({documents:{'scenarios.json':record.documents['scenarios.json']}},{id:'S',acceptance},{operation:'RAW'}).plans.length,0);
});
test('evidence is isolated by scenario and attempt; disk files do not become observed proof',()=>{
 const run={attempt_history:[{scenario_id:'A',observation:{attempt:1,evidence:['evidence/A/attempt-1/old.png']}}],results:[{scenario_id:'A',attempt:2,evidence:['evidence/A/attempt-2/new.png'],evidence_details:[{path:'evidence/A/attempt-2/new.png',name:'拒绝截图',step:'2',captured_at:'2026-10-10T05:00:00Z',criterion:'拒绝外部正文'}]}]};
 const files=['evidence/A/attempt-1/old.png','evidence/A/attempt-2/new.png','evidence/A/attempt-2/pending.log','evidence/B/attempt-2/other.png','preparation/A/inputs.json'].map(path=>({path:'runs/R/'+path}));
 const groups=View.evidenceGroups(run,{scenario_id:'A',attempt:2},files,'R');
 assert.deepEqual(groups.map(g=>[g.attempt,g.observed,g.items.length]),[[2,true,1],[1,true,1],[2,false,1]]);
 assert.equal(groups[1].items[0].captured_at,null);assert.equal(groups[0].items[0].criterion,'拒绝外部正文');assert.equal(groups[0].current,true);assert.equal(groups[1].current,false);
 assert.equal(groups[2].items[0].path,'evidence/A/attempt-2/pending.log');
});
test('artifact references cannot escape a run or link to other runs',()=>{
 for(const path of ['../x','/absolute','a/../../b','file://x','a\\b','a//b'])assert.equal(View.relative(path,'R'),null);
 assert.equal(View.relative('runs/OTHER/proof.txt','R'),'runs/R/runs/OTHER/proof.txt');
 assert.equal(View.relative('evidence/A/a.png','R'),'runs/R/evidence/A/a.png');
});
test('review sections are authored records; legacy reason is not parsed into a summary or checks',()=>{
 const verdict={scenario_id:'A',status:'passed',reason:'RAW LONG REASON. Several sentences.',evidence:['evidence/A/real.txt']};
 const record={documents:{'run.json':{scenario_reviews:[verdict],attempt_history:[{scenario_id:'B',attempt:1,review:{reason:'OTHER SCENE'}}]}}};
 const before=JSON.stringify(record),data=View.reviewData(record,{id:'A'});
 assert.equal(data.verdict,verdict);assert.deepEqual(data.assessment,{});assert.equal(data.previous.length,0);
 assert.equal(data.summary,'产出不完整：缺少独立判定摘要。');assert.equal(JSON.stringify(record),before);
 verdict.summary='独立核对冲突结果。';verdict.assessment={scope:['冲突'],checks:[{criterion:'拒绝冲突',expected:'False',actual:'False',status:'passed',evidence:verdict.evidence}],basis:['读取输出'],limitations:[]};
 const structured=View.reviewData(record,{id:'A'});assert.equal(structured.summary,verdict.summary);assert.deepEqual(structured.assessment,verdict.assessment);
});
test('archived repair reviews remain distinct from the current attempt verdict',()=>{
 const record={documents:{'run.json':{scenario_reviews:[],attempt_history:[{scenario_id:'A',attempt:1,review:{status:'repair_required',reason:'补充证据'}}]}}};
 let data=View.reviewData(record,{id:'A'});assert.equal(data.verdict,null);assert.equal(data.previous[0].attempt,1);
 record.documents['run.json'].scenario_reviews=[{scenario_id:'A',status:'passed',summary:'重测完成。'}];
 data=View.reviewData(record,{id:'A'});assert.equal(data.verdict.status,'passed');assert.equal(data.previous[0].verdict.status,'repair_required');
});
test('progress follows the frozen queue and never substitutes current scenario titles or priority',()=>{
 const record={documents:{'execution-plan.json':{ordered_scenario_ids:['B','A']},'scenarios.snapshot.json':{items:[{id:'A',title:'旧标题',priority:'P1'},{id:'B',priority:'P0'},{id:'C',priority:'P3'}]},'scenarios.json':{items:[{id:'A',title:'新标题',priority:'P0'}]}}};
 const items=['C','A','B'].map(scenario_id=>({scenario_id})),original=JSON.stringify(record);
 assert.deepEqual(View.orderedProgress(record,items).map(v=>v.scenario_id),['B','A','C']);
 assert.equal(View.sceneOf(record,'A').title,'旧标题');assert.equal(View.sceneOf(record,'A').priority,'P1');
 assert.equal(View.sceneOf({documents:{'scenarios.json':record.documents['scenarios.json']}},'A').title,undefined);
 assert.equal(JSON.stringify(record),original);assert.deepEqual(items.map(v=>v.scenario_id),['C','A','B']);
});
test('phase counts distinguish pending, not-run, evaluation and missing phase',()=>{
 const record={documents:{'run.json':{execution_schema:2,progress:[{scenario_id:'A',phase:'pending'},{scenario_id:'B',phase:'evaluating'},{scenario_id:'C',phase:'not_run'},{scenario_id:'D'}]}}};
 const c=View.phaseCounts(record);assert.equal(c.pending,1);assert.equal(c.not_run,1);assert.equal(c.evaluating,1);assert.equal(c.completed,0);assert.equal(c.unrecorded,1);
 assert.equal(View.progressOf({documents:{'run.json':{results:[{scenario_id:'A',status:'passed'}]}}},'A').phase,undefined);
});
test('execution observations keep current results, archived attempts and repairs distinct without parsing actual',()=>{
 const observation={scenario_id:'A',actual:'LONG RAW. Do not turn into summary.',evidence:Array.from({length:2444},(_,i)=>'evidence/A/'+i+'.log')};
 const record={documents:{'run.json':{results:[observation],attempt_history:[{scenario_id:'A',attempt:1,observation:{actual:'OLD'}},{scenario_id:'B',observation:{actual:'OTHER'}}],execution_repairs:[{scenario_id:'A',attempt:1}],issues:[]}}};
 const data=View.observationData(record,{id:'A'});assert.equal(data.observation,observation);assert.equal(data.observation.evidence.length,2444);assert.equal(data.previous.length,1);assert.equal(data.repairs.length,1);assert.deepEqual(data.steps,[]);assert.equal(data.summary,'产出不完整：缺少业务结果摘要。');
 assert.equal(View.evidenceGroups({results:[observation]},{scenario_id:'A'},[{path:'runs/R/evidence/A/attempt-1/not-observed.log'}],'R').length,1);
});
test('legacy assessment source is preserved, while schema-2 requires a per-scene verdict',()=>{
 const verdict={scenario_id:'A',status:'passed',reason:'OLD REASON'};
 const record={documents:{'run.json':{results:[]},'review.json':{results:[verdict]}}};
 assert.equal(View.reviewData(record,{id:'A'}).verdict,verdict);
 record.documents['run.json'].execution_schema=2;
 assert.equal(View.reviewData(record,{id:'A'}).verdict,null);
});
test('artifact references normalize only the selected run, rejecting cross-run and escaped paths',()=>{
 const r={id:'R'};
 assert.equal(View.artifactReference(r,'runs/R/evidence/A.txt'),'runs/R/evidence/A.txt');
 for(const path of ['runs/OTHER/A.txt','runs/R/../OTHER/A.txt','/outside/A.txt','http://example.com'])assert.equal(View.artifactReference(r,path),null);
 assert.equal(View.artifactReference(r,'evidence/A.txt'),'runs/R/evidence/A.txt');
});

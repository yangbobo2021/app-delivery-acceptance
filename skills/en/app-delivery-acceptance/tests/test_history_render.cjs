const AcceptanceScope=require('../assets/ledger-viewer/scope.js');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Trace=require('../assets/ledger-viewer/traceability.js');
const CoverageView=require('../assets/ledger-viewer/coverage.js');
const {addWhite,partial}=require('./white_design_fixture.cjs');

// Render the actual history function with a small DOM, inspecting visible content only.
class Node {
 constructor(tag='',value=''){this.tag=tag;this.value=value;this.children=[];this.dataset={};this.attributes={};}
 get childNodes(){return this.children;}
 append(...children){this.children.push(...children.map(v=>v instanceof Node?v:new Node('#text',String(v))));}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(){}
}
function visible(node){
 if(node.tag==='#text')return node.value;
 const children=node.tag==='details'&&!node.open?node.children.slice(0,1):node.children;
 return children.map(visible).join('\n');
}
function render(data, expression = 'state.data=fixture; historyView()', expandDetails = false){
 const context=vm.createContext({AcceptanceScope,Node,document:{createElement:t=>new Node(t),createTextNode:v=>new Node('#text',v)},AcceptanceTrace:Trace,CoverageView,fixture:data});
 const assets=path.resolve(__dirname,'../assets/ledger-viewer');
 vm.runInContext(fs.readFileSync(path.join(assets,'results.js'),'utf8'),context);
 const source=fs.readFileSync(path.join(assets,'viewer.js'),'utf8');
 vm.runInContext(source.slice(0,source.indexOf('let loadingLedger = false;')),context);
 const output=vm.runInContext(expression,context);
 if(expandDetails){const expand=n=>{if(n.tag==='details')n.open=true;n.children.forEach(expand);};output.forEach(expand);}
 return output.map(visible).join('\n');
}
test('coverage report explains all intent scopes and missing denominator without substituting file metrics',()=>{
 const base={ledger_match:'current',plan_match:'current',read_consistent:true,documents:{'run.json':{coverage_policy:{mode:'required'},progress:[],results:[],scenario_reviews:[]}},execution_coverage:{projects:[],subjects:[]}};
 const expression='state.data=fixture;[executionCoveragePanel(fixture.record)]';
 const absent=render({record:base},expression);
 assert.match(absent,/尚未根据测试意图确定并冻结覆盖率分母范围/);
 for(const [kind,label] of Object.entries({project:'整个项目',directories:'指定目录',files:'指定文件',commit_changes:'提交修改',pr_changes:'PR修改'})){
  const record=structuredClone(base);
  record.execution_coverage.subjects=[{kind,status:'measured',intent:'验收指定对象',basis:'用户确认的被测范围',project_label:'预订服务',revision:'frozen',source_paths:['booking.py'],metrics:{lines:{covered:1,total:2},branches:{covered:0,total:0}},scenario_ids:['A'],reason:'只累计本轮独立评估完成的场景'}];
  const text=render({record},expression,true);
  assert.ok(!text.split('\n').includes('null'));
  for(const expected of [label,'50.0%','1 / 2','不适用','用户确认的被测范围','booking.py'])assert.ok(text.includes(expected),expected);
  assert.ok(text.includes(['commit_changes','pr_changes'].includes(kind)?'修改行覆盖率':'行覆盖率'));
  record.execution_coverage.subjects[0]={...record.execution_coverage.subjects[0],status:'incomplete',metrics:null,missing_paths:['unvisited.py'],reason:'完整分母缺少源码计数'};
  const missing=render({record},expression);assert.match(missing,/完整分母缺少源码计数/);assert.match(missing,/unvisited.py/);assert.ok(!missing.includes('50.0%'));
 }
});
test('background verification explains pending metrics while progress remains available',()=>{
 const record={ledger_match:'current',plan_match:'current',read_consistent:true,documents:{'run.json':{coverage_policy:{mode:'required'},progress:[],results:[],scenario_reviews:[]}},execution_coverage:{projects:[],subjects:[],verification_state:'pending',verification_reason:'覆盖率及证据正在后台核验，执行进度可先查看；核验完成后自动更新指标。'}};
 const text=render({record},'state.data=fixture;[executionCoveragePanel(fixture.record)]');
 assert.match(text,/后台核验/);assert.ok(!text.includes('尚未根据测试意图确定'));assert.ok(!text.includes('%'));
});
test('new completed scenes retain earlier verified coverage and explicitly remain uncounted during verification',()=>{
 const record={ledger_match:'current',plan_match:'current',read_consistent:true,documents:{'run.json':{coverage_policy:{mode:'required'},progress:[],results:[],scenario_reviews:[]}},execution_coverage:{projects:[],subjects:[{project_label:'预订服务',kind:'files',status:'measured',metrics:{lines:{covered:4,total:10},branches:{covered:2,total:8}},scenario_ids:['A'],reason:'仅计已核验场景'}],verification_state:'updating',verification_reason:'当前显示此前已核验的 1 个场景的累计覆盖率；新增已完成场景正在核验，尚未计入。'}};
 const text=render({record},'state.data=fixture;[executionCoveragePanel(fixture.record)]');
 assert.match(text,/40.0%/);assert.match(text,/25.0%/);assert.match(text,/新增已完成场景正在核验，尚未计入/);
 assert.ok(!text.includes('尚未根据测试意图确定'));
});
test('cumulative coverage hides scene collection bookkeeping while retaining decision metrics',()=>{
 const scene={id:'A',title:'采集表中的场景标题',priority:'P0'};
 const record={id:'R',ledger_match:'current',plan_match:'current',read_consistent:true,documents:{'run.json':{coverage_policy:{mode:'required'},progress:[{scenario_id:'A',phase:'executing'}]},'scenarios.snapshot.json':{items:[scene]}},execution_coverage:{projects:[],subjects:[{project_label:'预订服务',kind:'files',status:'measured',metrics:{lines:{covered:4,total:10},branches:{covered:2,total:8}},scenario_ids:['B'],reason:'仅计已核验场景'}],collection:Array.from({length:100},(_,i)=>({scenario_id:'A',project_label:'预订服务',status:i%2?'measured':'collecting',metrics:{lines:{covered:3,total:10},branches:{covered:1,total:8}},reason:'SCENE COLLECTION RECEIPT',scope:{basis:'COLLECTION INTERNAL DETAILS'}})),issues:['A：旧尝试或观察绑定已变化，未计入','A：旧尝试或观察绑定已变化，未计入']}};
 const text=render({record,documents:{'scenarios.json':{items:[scene]}}},'state.data=fixture;[executionCoveragePanel(fixture.record)]',true);
 for(const expected of ['40.0%','25.0%','P0 1 个','预订服务'])assert.ok(text.includes(expected),expected);
 for(const hidden of ['覆盖率采集状态','原因与影响范围','本场景实测','查看影响范围与尝试记录','采集表中的场景标题','SCENE COLLECTION RECEIPT','COLLECTION INTERNAL DETAILS','旧尝试或观察绑定已变化'])assert.ok(!text.includes(hidden),hidden);
 assert.ok(!text.includes('覆盖率限制'));
});
test('unavailable collection explains concrete limitations once per tested object without scene rows',()=>{
 const reason='运行环境不支持分支插桩，无法取得分支执行数据。';
 const record={ledger_match:'current',plan_match:'current',read_consistent:true,documents:{'run.json':{coverage_policy:{mode:'required'}}},execution_coverage:{projects:[],subjects:[{project_label:'桌面客户端',kind:'files',status:'incomplete',reason:'暂不能计算完整覆盖率'}],collection:[{scenario_id:'A',project_label:'桌面客户端',status:'unavailable',reason},{scenario_id:'B',project_label:'桌面客户端',status:'unavailable_pending',reason},{scenario_id:'C',project_label:'服务端',status:'invalid',reason:'采集数据的源码版本与被测版本不一致。'}]}};
 const text=render({record},'state.data=fixture;[executionCoveragePanel(fixture.record)]',true);
 assert.match(text,/覆盖率限制/);assert.match(text,/桌面客户端：运行环境不支持分支插桩/);assert.equal(text.split(reason).length-1,1);
 assert.match(text,/服务端：采集数据的源码版本与被测版本不一致/);assert.ok(!text.includes('覆盖率采集状态'));assert.ok(!text.includes('%'));
});
test('history keeps compact rows, frozen queue and real string gate-issue counts with thousands of evidence files',()=>{
 const scenes=[{id:'A',title:'一般场景',priority:'P1',method_ids:['M']},{id:'B',title:'重要场景',priority:'P0',method_ids:['M']}];
 const run={execution_schema:2,lifecycle:'running',progress:[{scenario_id:'A',phase:'pending'},{scenario_id:'B',phase:'completed',attempt:2}],results:[{scenario_id:'B',status:'passed',actual:'ORIGINAL FULL RESULT MUST BE COLLAPSED',method_ids:['M'],evidence:Array.from({length:2444},(_,i)=>'evidence/B/'+i+'.log')}],scenario_reviews:[{scenario_id:'B',status:'passed',reason:'ORIGINAL REVIEW MUST BE COLLAPSED'}],execution_repairs:[{scenario_id:'B',attempt:1,problem_kind:'evidence',reason:'ORIGINAL REPAIR MUST BE COLLAPSED'}]};
 const data={runs:[{id:'R',ledger_match:'current',documents:{'run.json':run,'scenarios.snapshot.json':{items:scenes},'execution-plan.json':{ordered_scenario_ids:['B','A']},'gate-report.json':{status:'blocked',gates:{execution:{status:'blocked',issues:['First gate issue','Second gate issue']}}}}}],history:[]};
 const output=render(data);
 assert.ok(output.indexOf('重要场景')<output.indexOf('一般场景'));assert.match(output,/按本轮冻结执行计划排列/);assert.match(output,/第 2 次尝试/);assert.match(output,/2 项问题/);assert.match(output,/查看执行详情/);
 for(const hidden of ['ORIGINAL FULL RESULT','ORIGINAL REVIEW','ORIGINAL REPAIR','evidence/B/0.log','First gate issue'])assert.ok(!output.includes(hidden),hidden);
});
test('legacy history retains original and current verification labels without exposing long reason or file paths',()=>{
 const scene={id:'A',title:'冻结历史标题',priority:'P1',method_ids:['M']};
 const data={documents:{'scenarios.json':{items:[{...scene,title:'CURRENT TITLE MUST NOT BE USED'}]}},runs:[{id:'OLD',ledger_match:'stale',documents:{'run.json':{results:[{scenario_id:'A',status:'passed',method_ids:['M'],actual:'OLD ACTUAL',evidence:['evidence/A/old.log']}]},'scenarios.snapshot.json':{items:[scene]},'review.json':{results:[{scenario_id:'A',status:'passed',reason:'OLD REVIEW REASON',evidence:['evidence/A/old.log']}]}}}],history:[]};
 const output=render(data);assert.match(output,/冻结历史标题/);assert.match(output,/原始评估：通过/);assert.match(output,/当前核验/);assert.match(output,/未证明/);assert.match(output,/旧记录未提供/);assert.match(output,/1 份登记证据/);
 for(const hidden of ['CURRENT TITLE MUST NOT BE USED','OLD ACTUAL','OLD REVIEW REASON','evidence/A/old.log'])assert.ok(!output.includes(hidden),hidden);
});
test('repair preparation and AI exceptions stay distinct from a completed pass or product BUG',()=>{
 const scenes=[{id:'A',title:'修正中场景',priority:'P0',method_ids:['M']},{id:'B',title:'AI异常场景',priority:'P1',method_ids:['M']}];
 const run={execution_schema:2,lifecycle:'running',progress:[{scenario_id:'A',phase:'preparing',attempt:2},{scenario_id:'B',phase:'completed',attempt:1}],results:[{scenario_id:'B',status:'execution_error',actual:'RAW AI FAILURE',evidence:['evidence/B/error.log']}],scenario_reviews:[{scenario_id:'B',status:'execution_error',reason:'RAW AI REVIEW'}],execution_repairs:[{scenario_id:'A',attempt:1,problem_kind:'test_design',reason:'RAW REPAIR'}],issues:[{scenario_id:'B',kind:'ai_execution_error',attempt:1,actual:'RAW ISSUE'}]};
 const output=render({runs:[{id:'R',ledger_match:'current',documents:{'run.json':run,'scenarios.snapshot.json':{items:scenes}}}],history:[]});
 assert.match(output,/修正执行问题中/);assert.match(output,/第 2 次尝试/);assert.match(output,/用例设计修正/);assert.match(output,/AI 无法完成执行/);assert.match(output,/AI 执行异常/);assert.ok(!output.includes('执行通过'));assert.ok(!output.includes('RAW AI FAILURE'));
});

test('scene execution panel exposes named evidence and business summary without repeating raw text',()=>{
 const scene={id:'A',title:'拒绝冲突预订',method_ids:['M'],priority:'P0'};
 const observation={scenario_id:'A',status:'passed',summary:'重复申请被拒绝，原预订保留。',actual:'RAW FULL TECHNICAL RESULT',method_ids:['M'],evidence:['evidence/A/log.txt'],binding:{mode:'existing_case',summary:'提交重复申请并比较原记录。'}};
 const run={execution_schema:2,progress:[{scenario_id:'A',phase:'completed',attempt:1}],results:[observation],scenario_reviews:[{scenario_id:'A',status:'passed',summary:'拒绝提示与存储对照符合冲突判据。',evidence:observation.evidence,reason:'RAW FULL REVIEW'}]};
 const record={id:'R',ledger_match:'current',documents:{'run.json':run,'scenarios.snapshot.json':{items:[scene]}}};
 const output=render({runs:[record],documents:{}},'state.data=fixture;state.trace={record:fixture.runs[0]};[executionPanel(fixture.runs[0].documents["scenarios.snapshot.json"].items[0])]');
 assert.match(output,/关联用例／手动测试/);assert.match(output,/场景最终结论/);assert.match(output,/拒绝提示与存储对照/);assert.ok(!output.includes('查看执行证据'));assert.ok(!output.includes('RAW FULL TECHNICAL RESULT'));assert.ok(!output.includes('RAW FULL REVIEW'));
});

test('result labels are dialog buttons routing to the same run independent argument, or facts before review',()=>{
 const scene={id:'A',title:'取消权限',method_ids:['M']},p={scenario_id:'A',phase:'completed',attempt:1};
 const r={id:'R',documents:{'run.json':{results:[{scenario_id:'A',status:'failed',summary:'Bob移除了Alice记录。'}],scenario_reviews:[{scenario_id:'A',status:'failed',summary:'取消违反权限。'}]}}};
 const fixture={runs:[r],scene,p};
 const output=render(fixture,'state.data=fixture;[el("pre","",JSON.stringify([ExecutionView.renderObservation(fixture.runs[0],fixture.scene,fixture.p,{}),ExecutionView.renderReview(fixture.runs[0],fixture.scene,fixture.p,{})].map(n=>n.children.find(c=>c.tag==="button")).map(b=>({label:visibleLabel(b),dataset:b.dataset,attrs:b.attributes}))))]'.replace('visibleLabel(b)','b.children.map(c=>c.value).join("")'));
 const buttons=JSON.parse(output);assert.equal(buttons[0].label,'失败');assert.equal(buttons[1].label,'发现 BUG');
 for(const b of buttons){assert.equal(b.dataset.executionKey,'R/A');assert.equal(b.dataset.executionTab,'review');assert.equal(b.attrs['aria-haspopup'],'dialog');}
 const reviewRow=render(fixture,'state.data=fixture;[ExecutionView.renderReview(fixture.runs[0],fixture.scene,fixture.p,{})]');
 assert.match(reviewRow,/发现 BUG/);assert.match(reviewRow,/取消违反权限/);assert.ok(!reviewRow.includes('查看评估详情'));
 const reviewButtonCount=render(fixture,'state.data=fixture;[el("pre","",String(ExecutionView.renderReview(fixture.runs[0],fixture.scene,fixture.p,{}).children.filter(n=>n.tag==="button").length))]');
 assert.equal(reviewButtonCount,'1');
 r.documents['run.json'].scenario_reviews=[];
 const pending=render(fixture,'state.data=fixture;[el("pre","",JSON.stringify(ExecutionView.renderObservation(fixture.runs[0],fixture.scene,fixture.p,{}).children.find(c=>c.tag==="button").dataset))]');
 assert.equal(JSON.parse(pending).executionTab,'observation');
});
test('complete independent argument presents requirement, facts, decisive proof and credibility, with failures first',()=>{
 const refs=['evidence/A/state.json'],checks=[{criterion:'本人取消',expected:'本人移除',actual:'本人记录移除',status:'passed',evidence:refs},{criterion:'他人取消',expected:'原记录保留',actual:'Alice记录消失',status:'failed',evidence:refs}];
 const verdict={scenario_id:'A',status:'failed',summary:'权限错误。',evidence:refs,assessment:{checks,limitations:['API样例，不含UI'],explanation:{conclusion:'Bob能删除Alice预订。',requirements:[{id:'R3',text:'只能取消本人预订',source:'确认需求v1'}],preconditions:['Alice与Bob各有预订'],actions:['Bob取消Alice编号1'],reasoning:['实际越权删除违反R3'],decisive_evidence:[{path:refs[0],locator:'/records/0/after',observation:'Alice编号1从结果消失',supports:['他人取消']}]},execution_audit:{status:'passed',checks:[{aspect:'test_implementation',subject:'tests/test_cancel.py',finding:'调用真实cancel且检查完整记录',status:'passed',evidence:refs}],issues:[]}}};
 const r={id:'R',documents:{'run.json':{results:[{scenario_id:'A',evidence_details:[{path:refs[0],name:'前后预订状态'}]}]}}};
 const output=render({r,verdict},'state.data=fixture;ExecutionView.reviewSections(fixture.r,{id:"A"},fixture.verdict,"current")');
 for(const text of ['场景验收结论及依据','只能取消本人预订','确认需求v1','Bob取消Alice编号1','Alice记录消失','/records/0/after','实际越权删除违反R3','API样例，不含UI','测试执行可信性核查','tests/test_cancel.py'])assert.ok(output.includes(text),text);
 assert.ok(output.indexOf('他人取消')<output.indexOf('本人取消'));assert.ok(output.indexOf('场景验收结论及依据')<output.indexOf('测试执行可信性核查'));
});

function completeAcceptance(){return {description:'检查预订及保存',preconditions:['原预订存在'],actions:['提交相接时段'],criteria:['新预订保存且原记录保持'],evidence_expected:['前后预订记录']};}
function checklistFixture() {
 const cover={id:'C1',condition:'11:00相接开始',expected:'允许并保留原预订',identification_basis:'需求明确允许两段时间刚好接上，防止错误拒绝',check_points:[{id:'save',text:'新预订实际保存'},{id:'keep',text:'原预订保持'}],scenario_ids:['S1','S2'],method_ids:['M1','M2']};
 const review={requirement_id:'R1',verdict:'sufficient',reason:'设计足够',criteria_checks:[{criterion:'method_discrimination',status:'passed',reason:'INTERNAL METHOD REASON'}],coverage_results:[{coverage_id:'C1',status:'covered',reason:'REVIEW METHOD DETAIL',scenario_coverage:[{scenario_id:'S1',method_ids:['M1'],covered_point_ids:['save'],reason:'M1检查新预订保存'},{scenario_id:'S2',method_ids:['M2'],covered_point_ids:['keep'],reason:'M2检查原预订保持'}]}],findings:[],scope:['时间关系'],limitations:['不证明产品实测通过'],operation_modes:[],user_states:[],fault_probes:[],uncovered_paths:[]};
 return {documents:{'requirements.json':{items:[{id:'R1',text:'相接时段允许'}]},'scenarios.json':{design_standard:'design-quality-v3',design_basis:[{requirement_id:'R1',scope:['时间关系'],exclusions:[],limitations:[],techniques:[{name:'边界值分析',reason:'区分相接与交叠'}],coverage_items:[cover]}],items:[{acceptance:completeAcceptance(),id:'S1',kind:'black_box',title:'相接预订必须实际保存',requirement_ids:['R1'],method_ids:['M1']},{acceptance:completeAcceptance(),id:'S2',kind:'black_box',title:'相接后原预订必须保持',requirement_ids:['R1'],method_ids:['M2']}]},'coverage_review.json':{design_standard:'design-quality-v3',items:[review]}},review_freshness:{status:'current'}};
}
const reviewExpression='state.data=fixture;reviewView(fixture.documents["coverage_review.json"].items[0])';
test('review main content exposes check mapping and complete titles; technical arguments stay expandable',()=>{
 const d=checklistFixture(),compact=render(d,reviewExpression);
 for(const text of ['11:00相接开始','完整覆盖','需求明确允许两段时间刚好接上','相接预订必须实际保存','相接后原预订必须保持'])assert.ok(compact.includes(text),text);
 for(const hidden of ['INTERNAL METHOD REASON','REVIEW METHOD DETAIL','边界值分析'])assert.ok(!compact.includes(hidden));
 const full=render(d,reviewExpression,true);for(const text of ['INTERNAL METHOD REASON','REVIEW METHOD DETAIL','边界值分析'])assert.ok(full.includes(text));
});
test('unlisted requirement gap appears in the main checklist with missing scenario; full counterexample retained',()=>{
 const d=checklistFixture(),r=d.documents['coverage_review.json'].items[0];r.verdict='gap';r.findings=[{kind:'coverage_gap',requirement_basis:'结束后可以马上开始下一场',condition:'缺少右侧相接检查',escaping_fault:'把所有相接误拒绝',why_existing_misses:'当前没有右侧输入',expected_detection:'增加右侧相接成功与原记录保持',scenario_ids:[]}];
 const compact=render(d,reviewExpression);for(const text of ['缺少右侧相接检查','未覆盖','缺少对应场景','增加右侧相接成功与原记录保持'])assert.ok(compact.includes(text));
 const full=render(d,reviewExpression,true);for(const text of ['把所有相接误拒绝','当前没有右侧输入'])assert.ok(full.includes(text));
});
test('partial and overlapping coverage belongs to check-item cell; scenario cell only contains titles and IDs',()=>{
 const d=checklistFixture(),r=d.documents['coverage_review.json'].items[0].coverage_results[0];r.status='partial';r.scenario_coverage[1].covered_point_ids=['save'];
 const nodes=(()=>{const context=vm.createContext({AcceptanceScope,Node,document:{createElement:t=>new Node(t),createTextNode:v=>new Node('#text',v)},AcceptanceTrace:Trace,fixture:d});const source=fs.readFileSync(path.resolve(__dirname,'../assets/ledger-viewer/viewer.js'),'utf8');vm.runInContext(source.slice(0,source.indexOf('let loadingLedger = false;')),context);return vm.runInContext('state.data=fixture;designChecklist(fixture.documents["coverage_review.json"].items[0])',context);})();
 const walk=n=>[n,...n.children.flatMap(walk)],cells=walk(nodes).filter(n=>n.tag==='td');
 assert.match(visible(cells[0]),/部分覆盖/);assert.match(visible(cells[0]),/原预订保持/);assert.match(visible(cells[0]),/重复检查/);
 assert.match(visible(cells[2]),/相接预订必须实际保存/);assert.match(visible(cells[2]),/相接后原预订必须保持/);
 assert.ok(!walk(cells[2]).some(n=>n.className?.includes('badge') && visible(n).includes('部分覆盖')));assert.ok(!visible(cells[2]).includes('部分覆盖'));
});

test('complete scenario shows its own acceptance sections and hides internal probes even in expanded raw data',()=>{
 const d=checklistFixture(),scene=d.documents['scenarios.json'].items[0];
 scene.expected='新增预订保存，原记录不变';
 d.documents['coverage_review.json'].items[0].fault_probes=[{plausible_fault:'INTERNAL PROBE SECRET',scenario_ids:['S1']}];
 const output=render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture);scenarioView(fixture.documents["scenarios.json"].items[0])',true);
 for(const text of ['场景说明','前置条件','检查操作','预期结果','证据要求','提交相接时段'])assert.ok(output.includes(text),text);
 const review=render(d,reviewExpression,true);
 for(const hidden of ['INTERNAL PROBE SECRET','fault_probes','故障探针'])assert.ok(!review.includes(hidden),hidden);
 assert.ok(!output.includes('关联方法'));
});

function organize(d) {
 const reqs=d.documents['requirements.json'].items, rules=d.documents['white_box_rules.json']?.items||[];
 const checks=reqs.map(r=>({id:'C-'+r.id,requirement_id:r.id,behavior:r.text,source_quote:r.text,disposition:'included'}));
 d.documents['acceptance-plan.json']={version:1,business_context:{objective:'预订可靠保存'},checks,units:[...reqs.map(r=>({id:'U-'+r.id,title:r.id+'预订验收',requirement_ids:[r.id],check_ids:['C-'+r.id],rule_ids:[]})),...rules.map(r=>({id:'U-'+r.id,title:r.title,requirement_ids:[],check_ids:[],rule_ids:[r.id]}))]};
 d.documents['design-progress.json']={units:d.documents['acceptance-plan.json'].units.map(u=>({unit_id:u.id,status:'generated'}))};
 for(const scene of d.documents['scenarios.json'].items){const id=scene.requirement_ids?.[0]||scene.reverse_rule_ids?.[0];scene.generation_unit_id='U-'+id;scene.scope={unit_ids:['U-'+id],criteria:(scene.acceptance?.criteria||[]).map(criterion=>({criterion,check_ids:checks.filter(c=>c.requirement_id===id).map(c=>c.id),rule_ids:scene.reverse_rule_ids||[]}))};}
 return d;
}
function freeze(d,record) {
 record.scope_snapshot_valid=true;record.file_hashes={};record.documents['run.json'].ledger_hashes={};
 for(const name of ['requirements.json','white_box_rules.json','acceptance-plan.json','scenarios.json','design-progress.json']){if(!d.documents[name])continue;const file=name.replace('.json','.snapshot.json');record.documents[file]=structuredClone(d.documents[name]);record.file_hashes[file]='HASH-'+name;record.documents['run.json'].ledger_hashes[name]='HASH-'+name;}
}
function traceFixture(){
 const d=checklistFixture();d.documents['requirements.json'].items[0].package='R1';
 Object.assign(d.documents['scenarios.json'].items[0],{priority:'P1'});Object.assign(d.documents['scenarios.json'].items[1],{priority:'P0'});
 organize(d);
 const scenes=d.documents['scenarios.json'].items;
 d.runs=[{id:'CURRENT',ledger_match:'current',documents:{'scenarios.snapshot.json':{items:scenes},'run.json':{execution_schema:2,lifecycle:'running',progress:[{scenario_id:'S1',phase:'pending'},{scenario_id:'S2',phase:'completed',attempt:1}],results:[{scenario_id:'S2',status:'failed',summary:'取消他人记录成功，原记录消失。',evidence:['evidence/S2/state.json']}],scenario_reviews:[{scenario_id:'S2',status:'failed',summary:'越权删除违反本人取消规则。',evidence:['evidence/S2/state.json']}]}}}];
 return d;
}
const traceExpression='state.data=fixture;state.run="CURRENT";state.trace=AcceptanceTrace.build(fixture,state.run);traceView(state.trace.requirements)';
test('coverage view groups each organization once, shows prioritized scene titles and a single run pending/BUG state',()=>{
 const d=traceFixture(),output=render(d,traceExpression);
 assert.ok(output.indexOf('相接后原预订必须保持')<output.indexOf('相接预订必须实际保存'));
 for(const content of ['P0','P1','待执行','用例尚未设计','发现 BUG','尚未确定测试方式'])assert.ok(output.includes(content),content);
 assert.match(output,/验收组织与场景追踪/);assert.match(output,/需求来源及承担内容/);assert.ok(!output.includes('充分性依据'));assert.ok(!output.includes('S1'));assert.ok(!output.includes('S2'));
 const metadata=render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture,"CURRENT");(()=>{const output=traceView(state.trace.requirements),walk=n=>[n,...n.children.flatMap(walk)];return [el("pre","",JSON.stringify(output.flatMap(walk).filter(n=>n.attributes.rowspan||n.dataset.designReview).map(n=>({tag:n.tag,attributes:n.attributes,dataset:n.dataset}))))];})()');
 const nodes=JSON.parse(metadata);assert.equal(nodes.find(n=>n.tag==='td').attributes.rowspan,'2');assert.equal(nodes.filter(n=>n.tag==='td').length,2);
});
test('coverage view does not substitute an older pass for a pending scene and labels absent scenarios',()=>{
 const d=traceFixture(),old=structuredClone(d.runs[0]);old.id='OLD';old.documents['run.json'].results=[{scenario_id:'S1',status:'passed',summary:'OLD PASS MUST NOT BE USED'}];d.runs.push(old);
 assert.ok(!render(d,traceExpression).includes('OLD PASS MUST NOT BE USED'));
 d.runs[0].documents['scenarios.snapshot.json'].items=d.runs[0].documents['scenarios.snapshot.json'].items.filter(s=>s.id!=='S1');
 d.runs[0].documents['run.json'].progress=d.runs[0].documents['run.json'].progress.filter(s=>s.scenario_id!=='S1');
 assert.match(render(d,traceExpression),/该轮未包含此场景/);
});
test('old selected results are identified as historical and never claim current design acceptance',()=>{
 const d=traceFixture();freeze(d,d.runs[0]);d.runs[0].ledger_match='stale';const output=render(d,traceExpression);
 assert.match(output,/旧版本或版本未确认/);assert.match(output,/不能据此认定最新测试设计已通过/);assert.match(output,/发现 BUG/);
});

test('current scenario detail remains readable when the selected older run does not contain it',()=>{
 const d=traceFixture();d.documents['scenarios.json'].items.push({id:'NEW',title:'新增场景',kind:'black_box',priority:'P1',requirement_ids:['R1'],acceptance:completeAcceptance()});
 const output=render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture,"CURRENT");scenarioView(fixture.documents["scenarios.json"].items[2])');
 assert.match(output,/新增场景/);assert.match(output,/该轮未包含此场景/);assert.match(output,/场景说明/);
});

test('coverage includes white-box scenes with a priority label under their actual requirement',()=>{
 const d=traceFixture();d.documents['scenarios.json'].items.push({id:'W',title:'检查删除编号复用隔离',kind:'white_box',priority:'P0',requirement_ids:['R1']});
 organize(d);const output=render(d,traceExpression);assert.match(output,/检查删除编号复用隔离/);assert.match(output,/白盒场景/);assert.ok(output.indexOf('检查删除编号复用隔离')<output.indexOf('相接预订必须实际保存'));
});


test('shared badges expose reviewer reasons in design and current runs, but frozen reasons in stale runs',()=>{
 const scene={id:'A',kind:'black_box',priority:'P0',priority_reason:'FROZEN REASON'};
 const d={scene,documents:{'coverage_review.json':{priority_reviews:[{scenario_id:'A',priority:'P0',verdict:'appropriate',reason:'CURRENT REVIEW'}]}},record:{id:'R',ledger_match:'stale'}};
 const expr='state.data=fixture;[el("pre","",JSON.stringify([priorityBadge(fixture.scene).dataset,priorityBadge(fixture.scene,fixture.record).dataset,priorityInfo(fixture.scene,fixture.record).notes]))]';
 let value=JSON.parse(render(d,expr));assert.equal(value[0].priorityReason,'CURRENT REVIEW');assert.equal(value[1].priorityReason,'FROZEN REASON');assert.match(value[2][0],/冻结场景/);
 d.record.ledger_match='current';value=JSON.parse(render(d,expr));assert.equal(value[1].priorityReason,'CURRENT REVIEW');assert.deepEqual(value[2],[]);
 d.review_freshness={status:'stale'};value=JSON.parse(render(d,expr));assert.match(value[2][0],/已过期/);
});
test('scenario details omit the dedicated priority basis panel while preserving a focusable shared badge',()=>{
 const d=checklistFixture();d.documents['scenarios.json'].items[0].priority='P1';d.documents['scenarios.json'].items[0].priority_reason='失败会误拒绝正常预订';
 const output=render(d,'state.data=fixture;state.trace={record:null};scenarioView(fixture.documents["scenarios.json"].items[0])');
 assert.match(output,/P1/);assert.ok(!output.includes('重要度依据'));assert.ok(!output.includes('查看独立分级审查记录'));
 const badge=JSON.parse(render(d,'state.data=fixture;let n=priorityBadge(fixture.documents["scenarios.json"].items[0]);[el("pre","",JSON.stringify({tabIndex:n.tabIndex,label:n.attributes["aria-label"],dataset:n.dataset}))]'));
 assert.equal(badge.tabIndex,0);assert.match(badge.label,/失败会误拒绝正常预订/);
});


test('scenario detail leads with its authored explanation and one acceptance plan, without repeated design analysis',()=>{
 const d=checklistFixture(),scene=d.documents['scenarios.json'].items[0];
 scene.expected='STANDALONE EXPECTED MUST STAY IN DATA';scene.acceptance.description='会议室已有预订，检查相接时段是否能保存，防止错误拒绝。';
 d.documents['coverage_review.json'].items[0].reason='DESIGN REVIEW BELONGS TO COVERAGE';
 const before=JSON.stringify(d),output=render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture);scenarioView(fixture.documents["scenarios.json"].items[0])');
 for(const value of [scene.acceptance.description,...scene.acceptance.preconditions,...scene.acceptance.actions,...scene.acceptance.criteria,...scene.acceptance.evidence_expected,'执行结果与证据审查'])assert.ok(output.includes(value),value);
 for(const hidden of ['STANDALONE EXPECTED MUST STAY IN DATA','DESIGN REVIEW BELONGS TO COVERAGE','关联需求与充分性依据','生成时的覆盖分析'])assert.ok(!output.includes(hidden),hidden);
 assert.ok(output.indexOf(scene.acceptance.description)<output.indexOf(scene.acceptance.preconditions[0]));
 assert.ok(!output.includes('怎样验收这个场景'));
 assert.ok(output.indexOf('场景说明')<output.indexOf('执行结果与证据审查')); 
 assert.equal(JSON.stringify(d),before);assert.ok(render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture);scenarioView(fixture.documents["scenarios.json"].items[0])',true).includes('STANDALONE EXPECTED MUST STAY IN DATA'));
});

test('requirement links locate one requirement in coverage while an all-requirements action remains available',()=>{
 const d=traceFixture();d.documents['requirements.json'].items.push({id:'R2',text:'第二条需求正文',package:'R2'});organize(d);
 const output=render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture);state.view="trace";state.selected="R1";traceView(records())');
 assert.match(output,/1 \/ 2 个验收组织/);assert.match(output,/查看全部验收组织/);assert.match(output,/相接时段允许/);assert.ok(!output.includes('第二条需求正文'));
 const all=render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture);state.view="trace";state.selected="";traceView(records())');
 assert.match(all,/2 \/ 2 个验收组织/);assert.ok(!all.includes('查看全部验收组织'));
});

test('coverage renders reverse rules by stable ID and keeps pending policy distinct from complete design',()=>{
 const d={documents:{'requirements.json':{items:[]},'scenarios.json':{items:[{id:'W1',title:'错误来源拒绝修改',kind:'white_box',priority:'P0',priority_reason:'数据修改入口保护',requirement_ids:[],reverse_rule_ids:['WR1']}]},'white_box_rules.json':{version:1,items:[{id:'WR1',title:'来源限制',text:'缺少标记拒绝写入',status:'needs_confirmation'}]},'coverage_review.json':{white_box_priority_review:{rule_reviews:[{rule_id:'WR1',verdict:'needs_confirmation',reason:'业务尚未确认',coverage_checks:[{check_id:'C1',status:'covered',scenario_ids:['W1'],reason:'操作与判据齐全'}]}]}}},white_box_rule_freshness:{status:'current'},runs:[]};
 addWhite(d);organize(d);
 const output=render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture);traceView(requirementRows())');
 for(const t of ['白盒逆向','规则待确认','错误来源拒绝修改','P0'])assert.ok(output.includes(t),t);
 assert.ok(!output.includes('执行通过'));
 const modal=render(d,'state.data=fixture;reverseRuleView(AcceptanceTrace.ruleRows(fixture)[0])');
 assert.ok(modal.includes('规则待确认'));assert.ok(modal.includes('规则覆盖充分'));
});

test('reverse rule detail labels concrete actions and expectations without a false complete badge for partial coverage',()=>{
 const r={id:'WR1',text:'合法来源方可修改',status:'supported',rationale:'入口错误放行风险',basis:'真实接口契约',check_items:[{id:'C1',operation:'发送错误来源请求',expected:'拒绝且无写入',identification_basis:'异常来源边界',scenario_ids:['W1']}],code_sources:[]};
 const d={documents:{'requirements.json':{items:[]},'scenarios.json':{items:[{id:'W1',kind:'white_box',priority:'P0',title:'来源校验',reverse_rule_ids:['WR1']}]},'white_box_rules.json':{items:[r]},'coverage_review.json':{white_box_priority_review:{rule_reviews:[{rule_id:'WR1',verdict:'gap',reason:'仍缺数据保持判据',coverage_checks:[{check_id:'C1',status:'partial',scenario_ids:['W1'],reason:'只断言返回码'}]}]}}},white_box_rule_freshness:{status:'current'}};
 addWhite(d);partial(d);
 const output=render(d,'state.data=fixture;reverseRuleView(AcceptanceTrace.ruleRows(fixture)[0])');
 for(const t of ['检查操作','预期结果','部分覆盖','尚缺检查','原记录保持且无写入','来源校验','查看规则来源与代码依据'])assert.ok(output.includes(t),t);
 assert.ok(!output.includes('完整覆盖'));
});

test('white and black review use the same checklist layout and fold technical reasons',()=>{
 const d=addWhite({documents:{'requirements.json':{items:[]},'scenarios.json':{items:[{id:'W1',kind:'white_box',priority:'P0',title:'拒绝错误来源',reverse_rule_ids:['WR1']}]},'white_box_rules.json':{items:[{id:'WR1',text:'错误来源不得写入',status:'supported',basis:'SOURCE CONTRACT DETAIL',rationale:'来源限制失效风险',code_sources:[]}]},'coverage_review.json':{white_box_priority_review:{rule_reviews:[{rule_id:'WR1',verdict:'accepted',reason:'SOURCE REVIEW DETAIL'}]}}},white_box_rule_freshness:{status:'current'}});
 const output=render(d,'state.data=fixture;reverseRuleView(AcceptanceTrace.ruleRows(fixture)[0])');
 for(const t of ['需求检查项与测试场景对应关系','为什么需要检查','对应场景','查看核验记录','查看完整审查过程与专业核验记录','P0','完整覆盖'])assert.ok(output.includes(t),t);
 for(const t of ['SOURCE CONTRACT DETAIL','SOURCE REVIEW DETAIL','场景检查来源拒绝及原记录保持'])assert.ok(!output.includes(t),t);
 const expanded=render(d,'state.data=fixture;reverseRuleView(AcceptanceTrace.ruleRows(fixture)[0])',true);assert.ok(expanded.includes('SOURCE CONTRACT DETAIL'));assert.ok(expanded.includes('场景检查来源拒绝及原记录保持'));
});

test('organization trace owns each scene once and shows many-to-many sources plus concrete cross-check references',()=>{
 const d=organize(checklistFixture());d.documents['requirements.json'].items.push({id:'R2',text:'预览不改保存内容'});organize(d);
 const plan=d.documents['acceptance-plan.json'];plan.units[0].requirement_ids.push('R2');plan.units[0].check_ids.push('C-R2');
 const scene=d.documents['scenarios.json'].items[0];scene.scope.unit_ids.push('U-R2');scene.scope.criteria[0].check_ids.push('C-R2');
 const output=render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture);traceView()',true);
 for(const value of ['需求来源及承担内容','R1','R2','其他组织场景的关联覆盖','生成责任组织','映射检查：预览不改保存内容'])assert.ok(output.includes(value),value);
 assert.equal(output.split('\n').filter(t=>t==='本组织生成').length,2,'two scene records are not duplicated by cross-organization references');
 assert.ok(output.includes('暂无本组织生成的场景；有其他组织的关联场景。'));
 const before=JSON.stringify(d);render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture);traceView()',true);assert.equal(JSON.stringify(d),before);
});
test('reverse lookup exposes exact checks, owners, actual mappings and explicitly excluded checks',()=>{
 const d=organize(checklistFixture()),plan=d.documents['acceptance-plan.json'];plan.checks.push({id:'OUT',requirement_id:'R1',behavior:'明确排除旧团队授权',disposition:'excluded'});
 const output=render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture);state.selected="R1";traceView()',true);
 for(const value of ['按来源反查 · R1','R1预订验收','已记录判据映射','明确排除旧团队授权','用户排除 · 未验证','此项不进入本轮测试。'])assert.ok(output.includes(value),value);
 assert.ok(!output.includes('尚无有效判据映射'));
});
test('analysis and unfinished generation do not manufacture uncovered or sufficient conclusions',()=>{
 const d=checklistFixture();d.documents['scenarios.json'].items=[];
 let output=render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture);traceView()');
 assert.match(output,/当前尚无组织追踪数据/);assert.ok(!output.includes('未关联场景'));assert.ok(!output.includes('覆盖充分'));
 organize(d);const saved=d.documents['design-progress.json'];delete d.documents['design-progress.json'];
 output=render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture);state.selected="R1";traceView()');assert.match(output,/生成进度不可核验/);assert.ok(!output.includes('未关联场景'));
 d.documents['design-progress.json']=saved;d.documents['design-progress.json'].units[0].status='in_progress';
 output=render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture);state.selected="R1";traceView()');
 assert.match(output,/场景生成中/);assert.match(output,/尚未生成完成/);assert.ok(!output.includes('未关联场景'));assert.ok(!output.includes('覆盖充分'));
 d.documents['design-progress.json'].units[0].status='generated';output=render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture);state.selected="R1";traceView()');assert.match(output,/尚无有效判据映射/);
});
test('historical organization trace uses pinned original and scene definitions and refuses a damaged snapshot',()=>{
 const d=traceFixture(),record=d.runs[0];freeze(d,record);record.ledger_match='stale';
 d.documents['scenarios.json'].items[0].title='CURRENT TITLE MUST NOT MIX';d.documents['requirements.json'].items[0].text='CURRENT REQUIREMENT MUST NOT MIX';d.documents['acceptance-plan.json'].units[0].title='CURRENT UNIT MUST NOT MIX';
 let output=render(d,traceExpression,true);for(const value of ['CURRENT TITLE MUST NOT MIX','CURRENT REQUIREMENT MUST NOT MIX','CURRENT UNIT MUST NOT MIX'])assert.ok(!output.includes(value),value);
 assert.match(output,/相接预订必须实际保存/);assert.match(output,/相接时段允许/);
 record.file_hashes['scenarios.snapshot.json']='damaged';output=render(d,traceExpression,true);
 assert.match(output,/场景快照不可核验/);assert.ok(!output.includes('相接预订必须实际保存'));assert.ok(!output.includes('CURRENT TITLE MUST NOT MIX'));
});
test('cross-unit links with no criterion mapping remain references without a false coverage claim',()=>{
 const d=traceFixture();d.documents['acceptance-plan.json'].units.push({id:'U2',title:'未映射的关联组织',requirement_ids:['R1'],check_ids:['C-R1'],rule_ids:[]});
 d.documents['scenarios.json'].items[0].scope.unit_ids.push('U2');d.documents['scenarios.json'].items[0].scope.criteria=[];
 const output=render(d,traceExpression,true);assert.match(output,/未提供本组织的具体检查项映射/);assert.ok(!output.includes('映射检查：'));
});
test('supplemental rule reverse lookup lists its responsible organization and exact authored criteria',()=>{
 const d=checklistFixture();d.documents['white_box_rules.json']={items:[{id:'WR',title:'来源限制',text:'错误来源拒绝保存',status:'supported',applicability:{status:'in_scope'}}]};
 const scene=d.documents['scenarios.json'].items[0];scene.requirement_ids=[];scene.reverse_rule_ids=['WR'];organize(d);
 const output=render(d,'state.data=fixture;state.trace=AcceptanceTrace.build(fixture);state.selected="WR";traceView()',true);
 for(const value of ['按来源反查 · WR','来源限制','错误来源拒绝保存','新预订保存且原记录保持','规则判据已映射'])assert.ok(output.includes(value),value);
});

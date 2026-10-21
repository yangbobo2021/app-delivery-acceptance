// Independent review probes: authored procedures stay scoped to the clicked case/task.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assets = path.resolve(__dirname, '../assets/ledger-viewer');
const View = require('../assets/ledger-viewer/results.js');
const Trace = require('../assets/ledger-viewer/traceability.js');
const CoverageView = require('../assets/ledger-viewer/coverage.js');
class Node {
  constructor(tag='', value='') {this.tag=tag;this.value=value;this.children=[];this.dataset={};this.attributes={};this.listeners={};this.style={};this.classList={toggle:()=>true};this.scrollTop=0;}
  get childNodes(){return this.children;}
  get textContent(){return this.tag==='#text'?this.value:this.children.map(n=>n.textContent).join('');}
  set textContent(value){this.children=[new Node('#text',String(value))];}
  append(...children){this.children.push(...children.filter(v=>v!=null).map(v=>v instanceof Node?v:new Node('#text',String(v))));}
  replaceChildren(...children){this.children=[];this.append(...children);}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,v){this.listeners[k]=v;}
  querySelectorAll(selector){return walk(this).slice(1).filter(n=>{if(selector==='button')return n.tag==='button';if(selector==='dialog')return n.tag==='dialog';if(selector==='[data-execution-key]')return n.dataset.executionKey!=null;const m=selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);return m&&n.dataset[m[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]!=null&&(m[2]==null||n.dataset[m[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]===m[2]);});}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
  scrollIntoView(){this.scrolled=true;}
  focus(){} showModal(){this.open=true;} close(){this.open=false;this.listeners.close?.();} remove(){} getBoundingClientRect(){return {left:0,right:100,top:0,bottom:100};}
}
function walk(n){return [n,...n.children.flatMap(walk)];}
function visible(n){return n.hidden?'':n.tag==='#text'?n.value:(n.tag==='details'&&!n.open?n.children.slice(0,1):n.children).map(visible).join('\n');}
function run(fixture,expression){
  const body=new Node('body');
  const document={body,createElement:t=>new Node(t),createTextNode:v=>new Node('#text',v),querySelectorAll:s=>body.querySelectorAll(s)};
  const ctx=vm.createContext({Node,document,window:{scrollY:0,scrollTo(){}},AcceptanceTrace:Trace,CoverageView,fixture});
  vm.runInContext(fs.readFileSync(path.join(assets,'results.js'),'utf8'),ctx);
  const source=fs.readFileSync(path.join(assets,'viewer.js'),'utf8');
  vm.runInContext(source.slice(0,source.indexOf('let loadingLedger = false;')),ctx);
  const nodes=vm.runInContext('state.data=fixture;'+expression,ctx);
  return {nodes,body};
}
const C1='第一条精确场景判据';
const C2='第二条精确场景判据';
function procedure(marker,scene='S',criterion=C1){return {objective:marker+'检查目的',preconditions:[marker+'全新独立对象'],test_data:[marker+'用户甲、会议室X、9至10'],steps:[{action:marker+'提交指定输入',expected:marker+'预期保存输入一致记录'},{action:marker+'重新读取状态',expected:marker+'预期原非目标字段保持'}],scenario_checks:[{scenario_id:scene,criterion,scope:marker+'仅承担此判据的独立输入组'}]};}
function binding(){return {mode:'combined',reason:'分别核查两个方法和一个实际API任务',summary:'场景级摘要不得混入单用例说明',operation_plan:{objective:'SCENE_PLAN_ONLY',preconditions:['SCENE_PRECONDITION_ONLY'],steps:['SCENE_ACTION_ONLY'],criteria:['SCENE_CRITERION_ONLY']},cases:[{name:'已有方法甲',origin:'existing_case',path:'tests/shared.py',selector:'Shared.test_a',command:'python tests/shared.py Shared.test_a',sha256:'same-hash',revision:'same-revision',procedure:procedure('CASE_A')},{name:'本轮新增方法乙',origin:'new_case',path:'tests/shared.py',selector:'Shared.test_b',command:'python tests/shared.py Shared.test_b',sha256:'same-hash',revision:'same-revision',procedure:procedure('CASE_B','S',C2)}],manual_operations:[{id:'read-api',name:'实际API读回任务',tool:'interactive Python PTY',entry_point:'booking.Booking.items',procedure:procedure('MANUAL_API','S',C2)}]};}
function fixture(b=binding()){
 const scene={id:'S',title:'冻结场景',priority:'P0',acceptance:{description:'SCENE_FALLBACK_ONLY',criteria:[C1,C2],actions:['SCENE_FALLBACK_ACTION_ONLY']}};
 const progress={scenario_id:'S',phase:'executing',attempt:1,binding:b};
 const record={id:'RUN',ledger_match:'current',documents:{'run.json':{execution_schema:2,lifecycle:'running',progress:[progress],results:[],scenario_reviews:[]},'scenarios.snapshot.json':{items:[scene]}}};
 return {binding:b,scene,progress,record,runs:[record],documents:{}};
}
function selected(f,key){const r=run({...f,target:key},'ExecutionView.associationView(fixture.binding,fixture.target,fixture.scene,fixture.record)');return r.nodes.map(visible).join('\n');}
test('same-file methods have distinct click identities and independently authored procedures',()=>{
 const f=fixture(),before=JSON.stringify(f),items=View.associations(f.binding);
 assert.equal(items.length,3);assert.equal(items[0].key,'case:tests/shared.py:Shared.test_a');assert.equal(items[1].key,'case:tests/shared.py:Shared.test_b');assert.equal(items[2].key,'manual:read-api');
 for(const [index,marker] of [[0,'CASE_A'],[1,'CASE_B'],[2,'MANUAL_API']]){
  const output=selected(f,items[index].key);
  for(const value of Object.values(items[index].procedure).flatMap(v=>typeof v==='string'?[v]:v.flatMap(x=>typeof x==='string'?[x]:Object.entries(x).filter(([k])=>k!=='scenario_id').map(([,v])=>v))))assert.ok(output.includes(value),value);
  for(const other of ['CASE_A','CASE_B','MANUAL_API'].filter(x=>x!==marker))assert.ok(!output.includes(other),other);
  for(const forbidden of ['SCENE_PLAN_ONLY','SCENE_ACTION_ONLY','SCENE_FALLBACK_ONLY'])assert.ok(!output.includes(forbidden),forbidden);
 }
 assert.equal(JSON.stringify(f),before);
});
test('steps explicitly remain actions and expected results; the procedure invents no observed pass',()=>{
 const f=fixture();f.record.documents['run.json'].results=[{scenario_id:'S',status:'passed',summary:'OBSERVED_RESULT_ONLY',step_results:[{step:'记录',actual:'OBSERVED_FACT_ONLY'}]}];f.record.documents['run.json'].scenario_reviews=[{scenario_id:'S',status:'passed',summary:'FINAL_VERDICT_ONLY'}];
 const output=selected(f,View.associations(f.binding)[0].key);
 assert.match(output,/操作|步骤/);assert.match(output,/预期/);assert.match(output,/判据/);assert.match(output,/目的/);assert.match(output,/前置/);assert.match(output,/数据/);
 assert.ok(output.includes('CASE_A预期保存输入一致记录'));
 for(const label of ['OBSERVED_RESULT_ONLY','OBSERVED_FACT_ONLY','FINAL_VERDICT_ONLY'])assert.ok(!output.includes(label),label);
});
test('missing procedure or target discloses the gap with no scenario or sibling fallback',()=>{
 const f=fixture();delete f.binding.cases[0].procedure;
 for(const target of ['case:tests/shared.py:Shared.test_a','case:missing.py:no_such_case']){
  const output=selected(f,target);assert.match(output,/未记录|缺少|不存在|不可|没有关联记录/);
  for(const forbidden of ['SCENE_FALLBACK_ONLY','SCENE_PLAN_ONLY','CASE_B','MANUAL_API'])assert.ok(!output.includes(forbidden),forbidden);
 }
});
test('actual AI task uses the same procedure sections and its own tool and entry point',()=>{
 const f=fixture(),rendered=run(f,'ExecutionView.associationView(fixture.binding,"manual:read-api",fixture.scene,fixture.record)'),output=rendered.nodes.map(visible).join('\n'),technical=rendered.nodes.map(n=>n.textContent).join('\n');
 for(const value of ['interactive Python PTY','booking.Booking.items'])assert.ok(technical.includes(value),value);
 for(const value of ['MANUAL_API检查目的','MANUAL_API提交指定输入','MANUAL_API预期保存输入一致记录'])assert.ok(output.includes(value),value);
 const clicked=run(f,'[ExecutionView.renderAssociation(fixture.record,fixture.scene,fixture.progress,fixture.binding)]');clicked.nodes.flatMap(walk).find(n=>n.className==='association-title'&&n.dataset.associationKey==='manual:read-api').listeners.click();assert.equal(walk(clicked.body).find(n=>n.tag==='h2').textContent,'实际API读回任务');
 assert.ok(!output.includes('tests/shared.py'));assert.ok(!output.includes('Shared.test_a'));assert.ok(!output.includes('Shared.test_b'));
});
test('association click opens only the precise item, without scenario tabs or sibling names',()=>{
 const f=fixture(),{nodes,body}=run(f,'[ExecutionView.renderAssociation(fixture.record,fixture.scene,fixture.progress,fixture.binding)]');
 const buttons=nodes.flatMap(walk).filter(n=>n.className==='association-title');assert.equal(buttons.length,3);
 assert.equal(buttons[1].dataset.associationKey,'case:tests/shared.py:Shared.test_b');
 buttons[1].listeners.click();const dialog=body.querySelector('dialog');assert.ok(dialog);
 const output=visible(dialog);assert.ok(output.includes('CASE_B检查目的'));assert.ok(!output.includes('CASE_A'));assert.ok(!output.includes('MANUAL_API'));
 for(const label of ['准备记录','执行记录','已收集证据','操作方案'])assert.ok(!output.includes(label),label);
 assert.equal(walk(dialog).filter(n=>n.attributes.role==='tab').length,0);
});
test('one exact case can disclose multiple actual scenario checks, excluding another case/version/run',()=>{
 const f=fixture();const second=structuredClone(f.binding);second.cases=second.cases.slice(0,1);second.cases[0].procedure=procedure('CASE_A','S2','另一个场景精确判据');second.manual_operations=[];
 const third=structuredClone(second);third.cases[0].sha256='different-version';third.cases[0].procedure.scenario_checks[0]={scenario_id:'S3',criterion:'OTHER_VERSION_CRITERION',scope:'OTHER_VERSION_SCOPE'};
 f.record.documents['run.json'].progress.push({scenario_id:'S2',binding:second},{scenario_id:'S3',binding:third});
 f.record.documents['scenarios.snapshot.json'].items.push({id:'S2',title:'第二关联场景',acceptance:{criteria:['另一个场景精确判据']}});
 const output=selected(f,'case:tests/shared.py:Shared.test_a');
 assert.ok(output.includes(C1));assert.ok(output.includes('另一个场景精确判据'));assert.ok(output.includes('第二关联场景'));assert.ok(!output.includes(C2));assert.ok(!output.includes('OTHER_VERSION_CRITERION'));
});
test('procedure table cells retain operation/expected and criterion/scope labels for narrow screens',()=>{
 const f=fixture();
 for(const target of ['case:tests/shared.py:Shared.test_a','manual:read-api']){
  const {nodes}=run({...f,target},'ExecutionView.associationView(fixture.binding,fixture.target,fixture.scene,fixture.record)');
  const tables=nodes.flatMap(walk).filter(n=>n.tag==='table');assert.equal(tables.length,2);
  for(const [index,labels] of [[0,['操作步骤','预期结果']],[1,['场景检查项','本用例承担的范围']]]){
   const body=walk(tables[index]).find(n=>n.tag==='tbody');
   for(const row of body.children){assert.equal(row.children.length,2);row.children.forEach((cell,i)=>{assert.equal(cell.attributes['data-label'],labels[i]);assert.ok(visible(cell).trim());});}
  }
 }
});

function coverageFixture(){
 const f=fixture(),run=f.record.documents['run.json'];f.progress.phase='evaluating';f.progress.result_sha256='hash';
 f.binding.case_design={standard:'case-design-v1',items:[C1,C2].map(criterion=>({criterion,check_points:[{id:'point',text:criterion+'具体状态检查'}]}))};
 for(const task of View.associations(f.binding)){for(const c of task.procedure.scenario_checks){c.covered_point_ids=['point'];c.step_numbers=[2];}}
 run.results=[{scenario_id:'S',binding:f.binding,case_results:[{association_key:'case:tests/shared.py:Shared.test_a',status:'passed',summary:'甲的实际结果',evidence:['A.json'],step_results:[{step_number:1,actual:'A实际新增正确记录',evidence:['A.json']},{step_number:2,actual:'A原记录保持',evidence:['A.json']}]},{association_key:'case:tests/shared.py:Shared.test_b',status:'failed',summary:'乙的实际失败',evidence:['B.json'],step_results:[{step_number:1,actual:'B实际错误结果',evidence:['B.json']}]}]}];
 run.scenario_reviews=[{scenario_id:'S',result_sha256:'hash',assessment:{case_coverage:{standard:'case-design-v1',status:'sufficient',items:[C1,C2].map((criterion,i)=>({criterion,status:'covered',reason:'独立检查实现对应判据',contributions:[{association_key:'case:tests/shared.py:Shared.test_'+(i?'b':'a'),covered_point_ids:['point'],step_numbers:[2],reason:'代码在重新读取后核对状态'}]}))}}}];return f;
}
test('case coverage badge rejects wrong union and wrong attempt hash',()=>{
 const f=coverageFixture();assert.equal(View.caseCoverageStatus(f.record,f.scene,f.binding),'sufficient');
 f.record.documents['run.json'].scenario_reviews[0].assessment.case_coverage.items[1].contributions=[];
 assert.equal(View.caseCoverageStatus(f.record,f.scene,f.binding),'invalid');
 const g=coverageFixture();g.record.documents['run.json'].scenario_reviews[0].result_sha256='older-hash';assert.equal(View.caseCoverageStatus(g.record,g.scene,g.binding),'invalid');
});
test('case dialog isolates actual facts and evidence from failed sibling case',()=>{
 const f=coverageFixture(),text=selected(f,'case:tests/shared.py:Shared.test_a');
 assert.match(text,/实际执行与证据/);assert.match(text,/A实际新增正确记录/);assert.match(text,/A.json/);assert.ok(!text.includes('B实际错误结果'));assert.ok(!text.includes('B.json'));assert.ok(!text.includes('乙的实际失败'));
});
test('live completed case remains visible before whole scene observation',()=>{
 const f=coverageFixture();f.progress.case_results=f.record.documents['run.json'].results[0].case_results;f.record.documents['run.json'].results=[];
 assert.equal(View.caseResult(f.record,f.scene,'case:tests/shared.py:Shared.test_a').summary,'甲的实际结果');
 assert.equal(View.caseCoverageStatus(f.record,f.scene,f.binding),'invalid');
});

test('unavailable coverage retains its cause without exposing collection workflow or fabricated metrics',()=>{
 const f=fixture();f.record.plan_match='current';f.record.read_consistent=true;
 f.record.documents['run.json'].coverage_policy={mode:'required'};
 f.record.documents['execution-plan.json']={ordered_scenario_ids:['S']};
 f.record.execution_coverage={projects:[],collection:[{scenario_id:'S',project_label:'真实Shell规则',status:'unavailable',reason:'当前收据适配器不支持此项目实际生成的Shell计数格式',scope:{targets:['rule.sh'],basis:'本次测试实际Shell产品文件',exclusions:[]},recovery_attempts:[{action:'尝试实际coverage.py采集',result:'原始解析记录显示Shell语法不受支持'}]}],issues:[]};
 const {nodes}=run(f,'[executionCoveragePanel(fixture.record)]');const all=nodes[0].textContent;
 assert.match(all,/真实Shell规则：当前收据适配器不支持/);assert.match(all,/覆盖率限制/);
 assert.doesNotMatch(all,/0\.0%|100\.0%|rule.sh|尝试实际coverage.py采集|查看影响范围与尝试记录/);
});
test('missing collection affects report limitations while individual pending stages stay out of the report',()=>{
 for(const status of ['missing','pending_review']){
  const f=fixture();f.record.ledger_match='current';f.record.plan_match='current';f.record.read_consistent=true;f.record.documents['run.json'].coverage_policy={mode:'required'};
  f.record.execution_coverage={projects:[],collection:[{scenario_id:'S',status,reason:'已完成场景没有提供覆盖率收据'}],issues:[]};
  const {nodes}=run(f,'[executionCoveragePanel(fixture.record)]');const all=nodes[0].textContent;
  assert.equal(all.includes('已完成场景没有提供覆盖率收据'),status==='missing');assert.doesNotMatch(all,/\d+\.\d%|覆盖率采集状态|等待独立核验/);
 }
});
test('individual scene counters never replace cumulative tested scope metrics',()=>{
 const f=fixture();f.record.documents['run.json'].coverage_policy={mode:'required'};
 f.record.execution_coverage={projects:[],collection:[{scenario_id:'S',status:'measured',reason:'独立核对原始SQLite与产品源码',scope:{targets:['booking.py'],basis:'原始产品模块',exclusions:[]},metrics:{lines:{covered:11,total:13},branches:{covered:2,total:4}}}],issues:[]};
 const {nodes}=run(f,'[executionCoveragePanel(fixture.record)]');
 assert.match(visible(nodes[0]),/尚未根据测试意图确定并冻结覆盖率分母范围/);
 assert.doesNotMatch(nodes[0].textContent,/11 \/ 13|SQLite|booking.py|\d+\.\d%/);
});

test('compact case rows show origin then individual status then title, with facts only in the dialog',()=>{
 const f=fixture();
 f.progress.case_results=[{association_key:'case:tests/shared.py:Shared.test_a',status:'passed',summary:'CASE_A_EXECUTION_FACTS',step_results:[]},{association_key:'case:tests/shared.py:Shared.test_b',status:'failed',summary:'CASE_B_EXECUTION_FACTS',step_results:[]}];
 const {nodes,body}=run(f,'[ExecutionView.renderAssociation(fixture.record,fixture.scene,fixture.progress,fixture.binding)]');
 const rows=walk(nodes[0]).filter(n=>n.className==='execution-association');assert.equal(rows.length,3);
 for(const [index,origin,label,state] of [[0,'已','已有用例','通过'],[1,'新','本轮新建用例','失败'],[2,'人工','AI模拟人工操作','待记录']]){
  const [source,status,title]=rows[index].children;
  assert.equal(source.textContent,origin);assert.equal(source.title,label);assert.equal(source.attributes['aria-label'],label);
  assert.equal(status.textContent,state);assert.equal(title.className,'association-title');
  assert.equal(status.dataset.associationKey,title.dataset.associationKey);
  assert.equal(status.dataset.executionKey,title.dataset.executionKey);
 }
 assert.ok(!visible(nodes[0]).includes('EXECUTION_FACTS'));
 rows[0].children[1].listeners.click();
 const dialog=body.querySelector('dialog');assert.match(visible(dialog),/CASE_A_EXECUTION_FACTS/);assert.ok(!visible(dialog).includes('CASE_B_EXECUTION_FACTS'));
 assert.ok(walk(dialog).some(n=>n.dataset.executionSection==='case-execution'&&n.scrolled));
});
test('unrecorded case origin and absent results never acquire a sibling pass or a guessed execution state',()=>{
 const f=fixture();delete f.binding.cases[0].origin;f.progress.phase='preparing';
 const {nodes}=run(f,'[ExecutionView.renderAssociation(fixture.record,fixture.scene,fixture.progress,fixture.binding)]');
 const row=walk(nodes[0]).find(n=>n.className==='execution-association');assert.equal(row.children[0].textContent,'？');assert.equal(row.children[0].title,'来源未记录');
 assert.equal(row.children[1].textContent,'待执行');assert.ok(!visible(nodes[0]).includes('通过'));
});

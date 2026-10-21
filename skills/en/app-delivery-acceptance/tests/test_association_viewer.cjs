const AcceptanceScope=require('../assets/ledger-viewer/scope.js');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const View = require('../assets/ledger-viewer/results.js');
const Trace = require('../assets/ledger-viewer/traceability.js');
const CoverageView = require('../assets/ledger-viewer/coverage.js');
const assets = path.resolve(__dirname, '../assets/ledger-viewer');
class Node {
 constructor(tag='', value='') {this.tag=tag;this.value=value;this.children=[];this.dataset={};this.attributes={};}
 get childNodes(){return this.children;}
 append(...children){this.children.push(...children.map(v=>v instanceof Node?v:new Node('#text',String(v))));}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(){}
}
function walk(n){return [n,...n.children.flatMap(walk)];}
function visible(n){return n.tag==='#text'?n.value:(n.tag==='details'&&!n.open?n.children.slice(0,1):n.children).map(visible).join('\n');}
function render(fixture,expression){
 const ctx=vm.createContext({AcceptanceScope,Node,document:{createElement:t=>new Node(t),createTextNode:v=>new Node('#text',v)},AcceptanceTrace:Trace,CoverageView,fixture});
 vm.runInContext(fs.readFileSync(path.join(assets,'results.js'),'utf8'),ctx);
 const source=fs.readFileSync(path.join(assets,'viewer.js'),'utf8');
 vm.runInContext(source.slice(0,source.indexOf('let loadingLedger = false;')),ctx);
 return vm.runInContext('state.data=fixture;'+expression,ctx);
}
function caseBinding(mode='existing_case'){
 return {mode,reason:'检查同一时段取消后的记录保持',cases:[{name:'两位用户分别取消选中预订',path:'tests/test_cancel.py',selector:'test_cancel.Owner.test_exact_target',command:'python3 -B -m unittest test_cancel.Owner.test_exact_target',revision:'committed-test-revision',sha256:'current-test-hash'}]};
}
function fixture(binding=caseBinding()){
 const scene={id:'S',title:'当前取消场景',kind:'black_box',priority:'P0',requirement_ids:['R'],acceptance:{description:'检查目标取消和其他记录保护',preconditions:['三条原预订'],actions:['取消指定目标'],criteria:['目标删除，其他保持'],evidence_expected:['前后状态']}};
 const record={id:'CURRENT',ledger_match:'current',documents:{'run.json':{execution_schema:2,lifecycle:'running',progress:[{scenario_id:'S',phase:'executing',attempt:2,binding}],results:[],scenario_reviews:[]},'scenarios.snapshot.json':{items:[scene]}}};
 return {scene,record,documents:{'requirements.json':{items:[{id:'R',text:'仅能取消自己的预订'}]},'scenarios.json':{items:[scene]}},runs:[record]};
}
test('case association preserves every exact binding and distinguishes reuse from newly created cases',()=>{
 for(const [mode,label] of [['existing_case','已有用例'],['new_case','本轮新建用例']]){
  const binding=caseBinding(mode),before=JSON.stringify(binding),items=View.associations(binding);
  assert.equal(items[0].origin,mode);assert.equal(items[0].label,label);
  for(const key of ['name','path','selector','command','revision','sha256'])assert.equal(items[0][key],binding.cases[0][key]);
  assert.equal(JSON.stringify(binding),before);
  const rendered=render({binding},'ExecutionView.associationView(fixture.binding,ExecutionView.associations(fixture.binding)[0].key)');
  const output=rendered.flatMap(walk).filter(n=>n.tag==='#text').map(n=>n.value).join('\n');
  for(const value of [label,...Object.entries(binding.cases[0]).filter(([k])=>k!=='name').map(([,v])=>v)])assert.ok(output.includes(value),value);
 }
});
test('combined associations require a per-case origin; uncertainty is never called a newly created case',()=>{
 const b=caseBinding('combined');b.cases.push({...b.cases[0],name:'明确新建的第二个用例',origin:'new_case'});
 const items=View.associations(b);
 assert.equal(items[0].origin,'unrecorded');assert.equal(items[0].label,'来源未记录');
 assert.equal(items[1].origin,'new_case');assert.equal(items[1].label,'本轮新建用例');
 assert.equal(items[2].kind,'manual');
});
test('AI manual operation has the actual API tool and entry point, and never fabricates an automated case',()=>{
 const binding={mode:'human_simulation',cases:[],reason:'人工逐组调用并读回真实API状态',operation_name:'逐组提交相接、分离及异室预订',operation_plan:{technical:{tool:'exec_command interactive Python PTY',entry_point:'booking.Booking.reserve and items'}}};
 const items=View.associations(binding);assert.equal(items.length,1);assert.equal(items[0].kind,'manual');
 assert.equal(items[0].tool,binding.operation_plan.technical.tool);assert.equal(items[0].entry_point,binding.operation_plan.technical.entry_point);
 assert.equal(items[0].path,undefined);assert.equal(items[0].selector,undefined);
 const output=render({binding},'ExecutionView.associationView(fixture.binding,ExecutionView.associations(fixture.binding)[0].key)').flatMap(walk).filter(n=>n.tag==='#text').map(n=>n.value).join('\n');
 for(const value of ['AI模拟人工操作','未关联自动化测试用例',items[0].tool,items[0].entry_point])assert.ok(output.includes(value),value);
 assert.ok(!output.includes('已有用例'));assert.ok(!output.includes('本轮新建用例'));
});
test('association label opens the same selected run, scene and current attempt detail',()=>{
 const d=fixture(),nodes=render(d,'[ExecutionView.renderAssociation(fixture.record,fixture.scene,fixture.record.documents["run.json"].progress[0],fixture.record.documents["run.json"].progress[0].binding)]');
 const link=nodes.flatMap(walk).find(n=>n.className==='association-title');
 assert.equal(visible(link),d.record.documents['run.json'].progress[0].binding.cases[0].name);
 assert.equal(link.dataset.executionKey,'CURRENT/S');assert.equal(link.dataset.executionTab,'association');assert.equal(link.attributes['aria-haspopup'],'dialog');
});
test('coverage rows have three scene cells for executed, design-only, absent and pending-rule scenarios',()=>{
 const d=fixture();const expectedLabel='已';
 let nodes=render(d,'state.trace=AcceptanceTrace.build(fixture,"CURRENT");traceScenarioCells(fixture.scene,fixture.record)');
 assert.equal(nodes.length,3);assert.ok(visible(nodes[1]).includes(expectedLabel));
 nodes=render(d,'traceScenarioCells(fixture.scene,null)');assert.equal(nodes.length,3);assert.match(visible(nodes[1]),/尚未确定测试方式/);
 d.record.documents['scenarios.snapshot.json'].items=[];d.record.documents['run.json'].progress=[];
 nodes=render(d,'traceScenarioCells(fixture.scene,fixture.record)');assert.equal(nodes.length,3);assert.match(visible(nodes[1]),/该轮未包含/);
 d.scene.reverse_rule_ids=['WR'];d.documents['white_box_rules.json']={items:[{id:'WR',status:'needs_confirmation'}]};
 nodes=render(d,'traceScenarioCells(fixture.scene,fixture.record)');assert.equal(nodes.length,3);assert.match(visible(nodes[1]),/确认后再准备用例/);
});
test('pending current scene does not inherit association from an older executed run',()=>{
 const d=fixture();const old=structuredClone(d.record);old.id='OLD';old.documents['run.json'].results=[{scenario_id:'S',binding:caseBinding(),status:'passed',summary:'旧执行'}];d.runs.push(old);
 delete d.record.documents['run.json'].progress[0].binding;d.record.documents['run.json'].progress[0].phase='pending';
 const nodes=render(d,'state.trace=AcceptanceTrace.build(fixture,"CURRENT");traceScenarioCells(fixture.scene,fixture.record)');
 assert.match(visible(nodes[1]),/尚未确定测试方式/);assert.ok(!nodes.map(visible).join('\n').includes('两位用户分别取消选中预订'));
});
test('navigation removes four obsolete tabs while the report renders a test association column',()=>{
 const html=fs.readFileSync(path.join(assets,'index.html'),'utf8');
 const nav=html.match(/<nav[\s\S]*?<\/nav>/)[0];
 for(const text of ['执行与历史','代码覆盖率','补测与轮次','报告与证据'])assert.ok(!nav.includes(text),text);
 const d=fixture();d.scene.generation_unit_id='U';d.scene.scope={unit_ids:['U']};d.documents['acceptance-plan.json']={version:1,checks:[],units:[{id:'U',title:'预订验收',requirement_ids:d.scene.requirement_ids,check_ids:[],rule_ids:[]}]};
 const nodes=render(d,'state.trace=AcceptanceTrace.build(fixture,"CURRENT");traceView(state.trace.requirements)');
 const output=nodes.map(visible).join('\n');assert.match(output,/验收组织与场景追踪/);assert.match(output,/关联用例／手动测试/);assert.match(output,/已\n待记录/);assert.match(output,/两位用户分别取消选中预订/);
 const header=nodes.flatMap(walk).find(n=>n.tag==='thead');assert.equal(walk(header).filter(n=>n.tag==='th').length,5);
});

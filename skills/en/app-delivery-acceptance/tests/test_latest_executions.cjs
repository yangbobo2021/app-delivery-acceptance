const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Trace = require('../assets/ledger-viewer/traceability.js');
const Scope = require('../assets/ledger-viewer/scope.js');
const CoverageView = require('../assets/ledger-viewer/coverage.js');
const assets = path.resolve(__dirname, '../assets/ledger-viewer');
function scene(id, kind='black_box') {
 return {id,title:id+'当前场景',kind,priority:'P1',requirement_ids:['R'],generation_unit_id:'U',scope:{unit_ids:['U']},
  acceptance:{description:'检查保存后记录保持',preconditions:['原记录存在'],actions:['保存并读回'],criteria:['原记录保持'],evidence_expected:['前后状态']}};
}
function record(id, s, at, status='passed') {
 const binding={mode:'existing_case',reason:'验证记录保持',cases:[{name:id+'精确用例',path:'tests/keep.py',selector:s.id,command:'python keep.py '+s.id,revision:'case-revision',sha256:'case-hash',procedure:{objective:id+'检查目的',preconditions:['原记录存在'],test_data:['用户甲'],steps:[{action:'保存并读回',expected:'原记录保持'}],scenario_checks:[{scenario_id:s.id,criterion:'原记录保持',scope:'保存前后'}]}}]};
 const observation={scenario_id:s.id,status,attempt:1,observed_at:at,actual:id+'实际结果',summary:id+'观察摘要',binding,evidence:['evidence/'+s.id+'.json']};
 const review={scenario_id:s.id,status,summary:id+'独立结论',reason:'已核对记录保持与实际证据',reviewer_kind:'independent_ai',review_reference:'review/'+id,evidence:observation.evidence};
 return {id,ledger_match:'current',documents:{'run.json':{execution_schema:2,lifecycle:'completed',created_at:at,revision:'product',progress:[{scenario_id:s.id,phase:'completed',attempt:1,binding}],results:[observation],scenario_reviews:[review]},'scenarios.snapshot.json':{items:[s]}}};
}
function fixture() {
 const a=scene('A'), b=scene('B'), w=scene('W','white_box');
 return {assets:'/test-ledger',documents:{'source-analysis.json':{stage:'acceptance'},'requirements.json':{items:[{id:'R',text:'保存后原记录保持'}]},'scenarios.json':{items:[a,b,w]},'acceptance-plan.json':{version:1,checks:[{id:'C',requirement_id:'R',disposition:'included',behavior:'保存后原记录保持'}],units:[{id:'U',title:'保存验收',requirement_ids:['R'],check_ids:['C'],rule_ids:[]}]}},
  runs:[record('FIRST',a,'2026-10-14T01:00:00Z'),record('SECOND',b,'2026-10-14T02:00:00Z'),record('WHITE',w,'2026-10-14T03:00:00Z')]};
}
class Node {
 constructor(tag='',value=''){this.tag=tag;this.value=value;this.children=[];this.dataset={};this.attributes={};this.listeners={};this.style={};this.classList={toggle:()=>true};this.scrollTop=0;}
 get childNodes(){return this.children;}
 get textContent(){return this.tag==='#text'?this.value:this.children.map(n=>n.textContent).join('');}
 set textContent(v){this.children=[new Node('#text',String(v))];}
 append(...children){this.children.push(...children.filter(v=>v!=null).map(v=>v instanceof Node?v:new Node('#text',String(v))));}
 replaceChildren(...children){this.children=[];this.append(...children);}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(k,v){this.listeners[k]=v;}
 querySelectorAll(selector){return walk(this).slice(1).filter(n=>selector==='button'?n.tag==='button':selector==='dialog'?n.tag==='dialog':selector==='[data-execution-key]'?n.dataset.executionKey!=null:false);}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
 focus(){} showModal(){this.open=true;} close(){this.open=false;this.listeners.close?.();} remove(){} getBoundingClientRect(){return {left:0,right:100,top:0,bottom:100};}
}
function walk(n){return [n,...n.children.flatMap(walk)];}
function visible(n){return n.hidden?'':n.tag==='#text'?n.value:(n.tag==='details'&&!n.open?n.children.slice(0,1):n.children).map(visible).join('\n');}
function render(fixture,expression='traceView()') {
 const body=new Node('body'),document={body,createElement:t=>new Node(t),createTextNode:v=>new Node('#text',v),querySelectorAll:s=>body.querySelectorAll(s)};
 const ctx=vm.createContext({Node,document,window:{scrollY:0,scrollTo(){}},AcceptanceTrace:Trace,AcceptanceScope:Scope,CoverageView,fixture});
 vm.runInContext(fs.readFileSync(path.join(assets,'results.js'),'utf8'),ctx);
 const source=fs.readFileSync(path.join(assets,'viewer.js'),'utf8');
 vm.runInContext(source.slice(0,source.indexOf('let loadingLedger = false;')),ctx);
 const nodes=vm.runInContext('state.data=fixture;state.trace=AcceptanceTrace.buildLatest(fixture);'+expression,ctx);
 return {nodes,body,ctx,output:nodes.map(visible).join('\n')};
}
test('separate partial executions retain every scene result with its own evidence source and consistent statistics',()=>{
 const d=fixture(),before=JSON.stringify(d),t=Trace.buildLatest(d);
 assert.equal(t.record,null);assert.equal(t.byScenario.get('A').record.id,'FIRST');assert.equal(t.byScenario.get('B').record.id,'SECOND');assert.equal(t.byScenario.get('W').record.id,'WHITE');
 assert.equal(t.executionStats.passed,3);assert.equal(t.evidenceStats.reviewed,3);assert.equal(t.packages[0].executed,3);
 assert.equal(Trace.prioritySummary(d,null,t.latest).byPriority.P1.reviewed,3);
 assert.equal(JSON.stringify(d),before,'latest display is read-only');
});
test('pending, first preparation, explicit not_run and snapshot-only entries never erase prior execution',()=>{
 for(const phase of ['pending','preparing','not_run']){
  const d=fixture(),newer=record('NEW',d.documents['scenarios.json'].items[0],'2026-10-14T04:00:00Z');
  newer.documents['run.json'].progress[0].phase=phase;newer.documents['run.json'].results=phase==='not_run'?[{scenario_id:'A',status:'not_run'}]:[];newer.documents['run.json'].scenario_reviews=[];
  d.runs.unshift(newer);assert.equal(Trace.buildLatest(d).byScenario.get('A').record.id,'FIRST',phase);
 }
 const d=fixture(),newer=record('SNAPSHOT',d.documents['scenarios.json'].items[0],'2026-10-14T04:00:00Z');newer.documents['run.json'].progress=[];newer.documents['run.json'].results=[];d.runs.unshift(newer);
 assert.equal(Trace.latestExecutions(d).get('A').record.id,'FIRST');
});
test('newer failure or stale execution wins over an older current pass, without recertification',()=>{
 const d=fixture(),later=record('FAIL',d.documents['scenarios.json'].items[0],'2026-10-14T05:00:00Z','failed');later.ledger_match='stale';d.runs.unshift(later);
 let value=Trace.buildLatest(d).byScenario.get('A');assert.equal(value.record.id,'FAIL');assert.equal(value.status,'failed');assert.equal(value.reviewStatus,'failed');
 later.documents['run.json'].results[0].status='passed';later.documents['run.json'].scenario_reviews[0].status='passed';
 value=Trace.buildLatest(d).byScenario.get('A');assert.equal(value.record.id,'FAIL');assert.equal(value.reviewStatus,'unproven');
 const output=render(d).output;assert.match(output,/旧版本 \/ 版本未确认/);assert.match(output,/A当前场景/);
});
test('chronology follows scene observations, not filename, active lifecycle, unrelated updates or late reviews',()=>{
 const d=fixture(),older=d.runs[0],later=record('AAA',d.documents['scenarios.json'].items[0],'2026-10-14T05:00:00Z','failed');
 older.id='ZZZ';older.documents['run.json'].lifecycle='running';older.documents['run.json'].updated_at='2026-10-14T08:00:00Z';older.documents['run.json'].scenario_reviews[0].evaluated_at='2026-10-14T09:00:00Z';d.runs.push(later);
 assert.equal(Trace.latestExecutions(d).get('A').record.id,'AAA');
 delete later.documents['run.json'].results[0].observed_at;delete older.documents['run.json'].results[0].observed_at;
 assert.equal(Trace.latestExecutions(d).get('A').record.id,'AAA','legacy fallback uses creation before unrelated updated_at');
});
test('a new execution and same-scene repair do not display the previous completed pass',()=>{
 for(const phase of ['executing','evaluating','preparing']){
  const d=fixture(),later=record('ACTIVE',d.documents['scenarios.json'].items[0],'2026-10-14T05:00:00Z');const run=later.documents['run.json'];run.lifecycle='running';run.progress[0].phase=phase;run.progress[0].started_at=run.created_at;run.results=[];run.scenario_reviews=[];
  if(phase==='preparing')run.attempt_history=[{scenario_id:'A',attempt:1,observation:{status:'passed',observed_at:run.created_at},review:{status:'repair_required'}}];
  d.runs.unshift(later);const value=Trace.buildLatest(d).byScenario.get('A');assert.equal(value.record.id,'ACTIVE',phase);assert.equal(value.reviewStatus,'unreviewed');
  assert.ok(!render(d).output.includes('FIRST精确用例'));
 }
});
test('missing timestamps stay deterministic without inventing chronology and duplicate records remain invalid',()=>{
 const d=fixture();delete d.runs[0].documents['run.json'].created_at;delete d.runs[0].documents['run.json'].results[0].observed_at;
 const tie=structuredClone(d.runs[0]);tie.id='ZZZZ';d.runs.push(tie);assert.equal(Trace.latestExecutions(d).get('A').record.id,'FIRST');assert.equal(Trace.latestExecutions(d).get('A').timeKnown,false);
 const later=record('DUP',d.documents['scenarios.json'].items[0],'2026-10-14T05:00:00Z');later.documents['run.json'].results.push(later.documents['run.json'].results[0]);d.runs.push(later);
 assert.equal(Trace.buildLatest(d).byScenario.get('A').status,'invalid');
});
test('coverage rows, scene details and case dialogs use the same per-scene execution without RUN controls or identities',()=>{
 const d=fixture(),r=render(d);
 for(const name of ['FIRST精确用例','SECOND精确用例','WHITE精确用例'])assert.ok(r.output.includes(name),name);
 for(const key of ['FIRST/A','SECOND/B','WHITE/W'])assert.ok(r.nodes.flatMap(walk).some(n=>n.dataset.executionKey===key),key);
 const aLink=r.nodes.flatMap(walk).find(n=>n.className==='association-title'&&n.dataset.executionKey==='FIRST/A');aLink.listeners.click();
 const dialog=visible(r.body);assert.match(dialog,/FIRST检查目的/);assert.ok(!dialog.includes('运行 FIRST'));assert.ok(!dialog.includes('SECOND检查目的'));
 const detail=render(d,'scenarioView(fixture.documents["scenarios.json"].items[0])');assert.match(detail.output,/FIRST精确用例/);assert.ok(!detail.output.includes('运行 FIRST'));
 const html=fs.readFileSync(path.join(assets,'index.html'),'utf8');assert.ok(!html.includes('id="run"'));assert.ok(!html.includes('id="run-control"'));
});
test('current organization stays visible even when the last execution has a different frozen design',()=>{
 const d=fixture();d.runs[0].ledger_match='stale';d.runs[0].documents['scenarios.snapshot.json'].items[0]={...scene('A'),title:'A旧场景'};
 const r=render(d);assert.match(r.output,/A当前场景/);assert.match(r.output,/保存验收/);assert.match(r.output,/FIRST精确用例/);
 assert.ok(!r.output.includes('A旧场景'));assert.match(r.output,/旧版本 \/ 版本未确认/);
});

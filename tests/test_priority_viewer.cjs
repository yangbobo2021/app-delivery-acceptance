const { test } = require('node:test');
const assert = require('node:assert/strict');
const Trace = require('../assets/ledger-viewer/traceability.js');
const scenario = (id,priority,kind='black_box') => ({id,priority,kind,priority_reason:'失败会影响业务',method_ids:['M']});
function fixture() {
  const scenarios=[scenario('P2','P2'),scenario('P0','P0'),scenario('P1','P1','white_box'),scenario('P0-second','P0'),scenario('P3','P3'),scenario('old',undefined)];
  const run={revision:'abc',results:[{scenario_id:'P0',status:'passed',method_ids:['M'],actual:'观察符合预期',evidence:['proof.txt']},{scenario_id:'P1',status:'blocked',actual:'环境不可用'},{scenario_id:'P2',status:'not_run',not_run_reason:'outside_priority_scope',reason:'范围之外'}]};
  const review={revision:'abc',reviewer_kind:'independent_ai',review_reference:'independent',results:[{scenario_id:'P0',status:'passed',reason:'证据支持',evidence:['proof.txt']}]};
  const record={id:'r',ledger_match:'current',documents:{'run.json':run,'review.json':review}};
  return {documents:{'scenarios.json':{items:scenarios}},runs:[record]};
}
test('stable priority order includes both scenario kinds and keeps unclassified history visible',()=>{
  const d=fixture();assert.deepEqual(Trace.ordered(d.documents['scenarios.json'].items).map(s=>s.id),['P0','P0-second','P1','P2','P3','old']);
  assert.equal(Trace.priorityOf({priority:'P4'}),'unclassified');
});
test('per-grade counts cover all scenarios and distinguish not-run, blocked and independently reviewed',()=>{
  const d=fixture(),summary=Trace.prioritySummary(d,d.runs[0]);
  assert.equal(summary.byPriority.P0.total,2);assert.equal(summary.byPriority.P0.passed,1);assert.equal(summary.byPriority.P0.reviewed,1);
  assert.equal(summary.byPriority.P0.not_executed,1);assert.equal(summary.byPriority.P1.blocked,1);assert.equal(summary.byPriority.P2.not_executed,1);
  assert.equal(summary.byPriority.unclassified.total,1);assert.equal(summary.remainingRisks.length,5);assert.equal(summary.p0RiskUnresolved,true);
});
test('different runs and stale evidence cannot remove remaining high-priority risks',()=>{
  const d=fixture();d.runs[0].ledger_match='stale';
  assert.equal(Trace.prioritySummary(d,d.runs[0]).byPriority.P0.reviewed,0);
  const noRun=Trace.prioritySummary(d,null);assert.equal(noRun.byPriority.P0.not_executed,2);assert.equal(noRun.byPriority.P0.reviewed,0);
});
test('a passed review cannot prove a not-run scenario or a duplicate result',()=>{
  const d=fixture(),r=d.runs[0];r.documents['run.json'].results[0].status='not_run';
  assert.equal(Trace.prioritySummary(d,r).byPriority.P0.reviewed,0);
  r.documents['run.json'].results.push({...r.documents['run.json'].results[0],status:'passed'});
  assert.equal(Trace.prioritySummary(d,r).byPriority.P0.invalid,1);assert.equal(Trace.prioritySummary(d,r).byPriority.P0.reviewed,0);
});


test('importance explanation prefers a unique independent judgment and separates black/white reviews',()=>{
 const s={id:'A',kind:'black_box',priority:'P0',priority_reason:'AUTHOR'};
 const documents={'coverage_review.json':{priority_reviews:[{scenario_id:'A',priority:'P0',verdict:'appropriate',reason:'BLACK REVIEW'}],white_box_priority_review:{items:[{scenario_id:'A',priority:'P0',verdict:'appropriate',reason:'WHITE REVIEW'}]}}};
 assert.equal(Trace.priorityBasis(s,documents).reason,'BLACK REVIEW');
 assert.equal(Trace.priorityBasis({...s,kind:'white_box'},documents).reason,'WHITE REVIEW');
 assert.equal(Trace.priorityBasis(s).reason,'AUTHOR');
 documents['coverage_review.json'].priority_reviews[0].reason='  ';
 assert.equal(Trace.priorityBasis(s,documents).reason,'AUTHOR');
});
test('ambiguous or mismatched grades do not invent approval or silently change the scene grade',()=>{
 const s={id:'A',priority:'P1',priority_reason:'AUTHOR'},r={scenario_id:'A',priority:'P0',verdict:'gap',reason:'REVIEW DISAGREES'};
 const documents={'coverage_review.json':{priority_reviews:[r]}};
 const info=Trace.priorityBasis(s,documents);assert.equal(info.priority,'P1');assert.equal(info.reason,'REVIEW DISAGREES');assert.equal(info.notes.length,2);
 documents['coverage_review.json'].priority_reviews.push({...r});
 const ambiguous=Trace.priorityBasis(s,documents);assert.equal(ambiguous.reason,'AUTHOR');assert.match(ambiguous.notes[0],/多条/);
 assert.equal(Trace.priorityBasis({...s,priority:undefined},documents).priority,'unclassified');
 assert.equal(Trace.priorityBasis({id:'missing'}).reason,'此场景尚未记录分级理由。');
});
test('aggregate grade tooltips explain grade standards without posing as scenario reasons',()=>{
 for(const priority of ['P0','P1','P2','P3']){const value=Trace.priorityBasis({priority});assert.equal(value.source,'等级标准');assert.ok(value.reason.length>10);}
 assert.match(Trace.priorityBasis({priority:'unclassified'}).reason,/不能推断/);
});

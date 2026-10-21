const {test}=require('node:test');
const assert=require('node:assert/strict');
const Trace=require('../assets/ledger-viewer/traceability.js');
function fixture(){
 const scenarios=['A','B','C'].map(id=>({id,method_ids:['M']}));
 const run={revision:'old',results:[{scenario_id:'A',status:'passed',actual:'observed',method_ids:['M'],evidence:['a.log']},{scenario_id:'B',status:'not_run',reason:'scope'}]};
 const record={id:'old',ledger_match:'current',documents:{'run.json':run,'scenarios.snapshot.json':{items:scenarios},'execution-plan.json':{ordered_scenario_ids:['B','A','C']},'review.json':{revision:'old',reviewer_kind:'independent_ai',review_reference:'independent',results:[{scenario_id:'A',status:'passed',reason:'proof inspected',evidence:['a.log']}]}}};
 return {documents:{'scenarios.json':{items:[...scenarios,{id:'NEW'}]}},runs:[record]};
}
test('legacy progress preserves its frozen scope and distinguishes missing from explicit not-run',()=>{
 const d=fixture(),before=JSON.stringify(d),p=Trace.legacyProgress(d,d.runs[0]);
 assert.deepEqual(p.items.map(v=>v.scenario_id),['B','A','C']);
 assert.equal(p.total,3);assert.equal(p.recorded,1);assert.equal(p.notRun,1);assert.equal(p.missing,1);assert.equal(p.reviewRecorded,1);assert.equal(p.reviewed,1);
 assert.equal(p.items.some(v=>'phase' in v),false);assert.equal(JSON.stringify(d),before);
});
test('failed or stale legacy observations cannot become independently passed',()=>{
 const d=fixture();d.runs[0].documents['run.json'].results[0].status='failed';
 assert.equal(Trace.legacyProgress(d,d.runs[0]).reviewRecorded,1);assert.equal(Trace.legacyProgress(d,d.runs[0]).reviewed,0);
 d.runs[0].documents['run.json'].results[0].status='passed';d.runs[0].ledger_match='stale';
 assert.equal(Trace.legacyProgress(d,d.runs[0]).reviewed,0);
});
test('unknown historical scope does not add current scenes to a stale run',()=>{
 const d=fixture(),r=d.runs[0];delete r.documents['scenarios.snapshot.json'];delete r.documents['execution-plan.json'];r.ledger_match='stale';
 const p=Trace.legacyProgress(d,r);assert.equal(p.scopeKnown,false);assert.equal(p.total,2);assert.equal(p.missing,0);
});
test('duplicate and malformed observations remain invalid and do not create false passes',()=>{
 const d=fixture();d.runs[0].documents['run.json'].results.push(null,{...d.runs[0].documents['run.json'].results[0]});
 const p=Trace.legacyProgress(d,d.runs[0]);assert.equal(p.items.find(v=>v.scenario_id==='A').status,'invalid');assert.equal(p.reviewed,0);
});
test('live runs precede newer historical runs and historical runs sort by recorded creation time',()=>{
 const make=(id,date,lifecycle)=>({id,documents:{'run.json':{created_at:date,lifecycle}}});
 const runs=[make('old','2020-01-01'),make('new','2026-01-01'),make('live','2019-01-01','running'),make('unknown','bad')];
 assert.deepEqual(Trace.historyRuns({runs}).map(v=>v.id),['live','new','old','unknown']);assert.equal(runs[0].id,'old');
});

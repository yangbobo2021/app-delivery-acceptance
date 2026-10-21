const assert = require('node:assert/strict');
const scope = require('../assets/ledger-viewer/scope.js');
const value = {version:2,checks:[{requirement_id:'R1',disposition:'included'},{requirement_id:'R2',disposition:'context'},{requirement_id:'R3',disposition:'excluded'}],units:[{id:'U1',title:'One journey',requirement_ids:['R1'],check_ids:['C1']}]};
const data = {documents:{'acceptance-plan.json':value}};
assert.equal(scope.disposition(value,'R2'),'context');
assert.equal(scope.disposition(value,'R3'),'excluded');
assert.equal(scope.disposition(null,'R1'),'legacy');
assert.equal(scope.matches(value,{id:'R2'},'U1',false),false);
assert.equal(scope.matches(value,{scope:{unit_ids:['U1']}},'U1',true),true);
assert.equal(scope.plan(data,{ledger_match:'stale',documents:{}}),null);
const frozen = {...value,version:1};
assert.equal(scope.plan(data,{ledger_match:'stale',scope_snapshot_valid:true,documents:{'acceptance-plan.snapshot.json':frozen}}).version,1);
assert.equal(scope.plan(data,{ledger_match:'current'}).version,2);
console.log('Scope view separates original context, excluded checks, unit selection and verified history.');
const trace = require('../assets/ledger-viewer/traceability.js');
const whiteData = {documents:{
 'source-analysis.json':{stage:'white-box'},
 'requirements.json':{items:[{id:'R1',text:'Preserve saved note'}]},
 'acceptance-plan.json':{checks:[{requirement_id:'R1',disposition:'included'}]},
 'white_box_rules.json':{items:[{id:'OUT',status:'needs_confirmation',applicability:{status:'out_of_scope'}}]},
 'scenarios.json':{items:[{id:'W1',kind:'white_box',requirement_ids:['R1'],scope:{unit_ids:['U1']},acceptance:{description:'Inspect saved note',preconditions:['Saved note'],actions:['Preview'],criteria:['Unchanged'],evidence_expected:['State']}}]},
 'coverage_review.json':{items:[]}},runs:[]};
const whiteTrace=trace.build(whiteData);
assert.equal(whiteTrace.requirementStats.linked,1,'pure white-box original requirements must not appear untested because black-box scenes are absent');
assert.equal(whiteTrace.entries[0].scenarios[0].id,'W1');
assert.equal(whiteTrace.entries[1].status,'out_of_scope');
assert.equal(whiteTrace.packages.find(p=>p.name==='白盒逆向规则').attention,0,'unrelated discovered rules remain visible without becoming acceptance gaps');
assert.equal(scope.matches({units:[{id:'U1',requirement_ids:[],rule_ids:['IN']}]},{id:'IN'},'U1',false),true);
console.log('White-box design uses original-to-unit-to-white-scene links and excludes nonblocking candidates from gap counts.');
const organized={checks:[{id:'C1',requirement_id:'R1',disposition:'included'},{id:'C2',requirement_id:'R2',disposition:'included'},{id:'OUT',requirement_id:'R2',disposition:'excluded'}],units:[{id:'U1',check_ids:['C1'],rule_ids:[]},{id:'U2',check_ids:['C2','OUT'],rule_ids:['WR']}]};
const shared={id:'S',generation_unit_id:'U1',scope:{unit_ids:['U1','U2'],criteria:[{criterion:'保存且预览',check_ids:['C1','C2','OUT'],rule_ids:['WR']},{criterion:'虚构判据',check_ids:['C2'],rule_ids:[]}]},acceptance:{criteria:['保存且预览']}};
const groups=scope.organizationTrace(organized,[shared]);
assert.equal(groups[0].owned.length,1);assert.equal(groups[1].owned.length,0);assert.equal(groups[1].references.length,1);
assert.deepEqual(scope.mapping(organized,organized.units[1],shared),[{criterion:'保存且预览',check_ids:['C2'],rule_ids:['WR']}]);
assert.deepEqual(scope.mapping(organized,organized.units[1],{...shared,scope:{unit_ids:['U2'],criteria:[]}}),[],'unit links alone never claim check coverage');
assert.deepEqual(scope.mapping(organized,organized.units[1],{...shared,scope:{...shared.scope,unit_ids:['U1']}}),[],'source IDs do not grant an unlinked unit coverage');
const run={read_consistent:true,file_hashes:{'scenarios.snapshot.json':'old'},documents:{'run.json':{ledger_hashes:{'scenarios.json':'old'}},'scenarios.snapshot.json':{items:[shared]}}};
assert.equal(scope.snapshot(run,'scenarios.json').items[0].id,'S');run.file_hashes['scenarios.snapshot.json']='changed';assert.equal(scope.snapshot(run,'scenarios.json'),null);
console.log('Owner/reference grouping admits only actual scoped criteria and independently pinned historical snapshots.');
assert.equal(scope.plan(data,{ledger_match:'stale',read_consistent:false,scope_snapshot_valid:true,documents:{'acceptance-plan.snapshot.json':frozen}}),null,'a concurrent read cannot certify even a matching plan snapshot');

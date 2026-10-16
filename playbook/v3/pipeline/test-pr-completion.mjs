import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=mkdtempSync(join(tmpdir(),'pr-completion-'));
const put=(name,value)=>{const path=join(root,name);writeFileSync(path,JSON.stringify(value,null,2)+'\n');return path};
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const scenes=put('scenes.json',{scenarios:[{id:'S1',requirement_id:'R1'}]});
const review=put('review.json',{status:'approved',requirement_id:'R1',scenarios_sha256:hash(scenes)});
const terminal=put('case.json',{final_state:'product_bug',finished_at:'2026-10-15T00:00:00Z'});
put('trace.json',{revision:'head',scenarios:[{id:'S1'}],judgment:{status:'product_bug'}});
const targets=put('targets.json',{schema:'pr-targets-v1',head_revision:'head',targets:[{id:'R1'}],unresolved:[]});
const spec={schema:1,jobs:[{id:'case-s1',depends_on:[],inputs:[],command:[],terminal:{file:'case.json',accept:['product_bug'],artifacts:['trace.json']},external_pin_sha256:hash(terminal)}],
 pr_completion:{targets_file:'targets.json',targets:[{id:'R1',scenarios_file:'scenes.json',review_file:'review.json',case_jobs:[{scenario_id:'S1',job_id:'case-s1',trace_file:'trace.json'}]}]}};
const specFile=put('spec.json',spec),runner=resolve(import.meta.dirname,'orchestrator.mjs');
let result=spawnSync(process.execPath,[runner,specFile,join(root,'ledger-ok')],{encoding:'utf8'});
assert.equal(result.status,0,result.stderr+result.stdout);
assert.equal(JSON.parse(readFileSync(join(root,'ledger-ok','ledger.json'))).final_state,'bugs_found');
put('targets.json',{schema:'pr-targets-v1',head_revision:'head',targets:[{id:'R1'}],unresolved:[{id:'B2'}]});
result=spawnSync(process.execPath,[runner,specFile,join(root,'ledger-unresolved')],{encoding:'utf8'});
assert.equal(result.status,0,result.stderr+result.stdout);
assert.equal(JSON.parse(readFileSync(join(root,'ledger-unresolved','ledger.json'))).final_state,'blocked');
put('scenes.json',{scenarios:[{id:'S1',requirement_id:'R1'},{id:'S2',requirement_id:'R1'}]});
const altered=put('review.json',{status:'approved',requirement_id:'R1',scenarios_sha256:hash(scenes)});
assert.equal(altered,review);
result=spawnSync(process.execPath,[runner,specFile,join(root,'ledger-missing')],{encoding:'utf8'});
assert.notEqual(result.status,0);
assert.equal(JSON.parse(readFileSync(join(root,'ledger-missing','ledger.json'))).final_state,'blocked');
assert.match(JSON.parse(readFileSync(join(root,'ledger-missing','ledger.json'))).final_reason,/missing\/extra scenario execution/);
const approved=put('approved.json',{schema:'commit-reverse-v1',status:'approved',
 change:{inventory:{pr_requirement_ids:['R1','R2'],test_modes:['BLACK_BOX','WHITE_BOX'],unclassified_paths:[]},inventory_sha256:'frozen',base_revision:'base',head_revision:'head'},
 draft:{behavior_impacts:[{id:'B1',coverage:'requirement',target_ids:['R1']},{id:'B2',coverage:'new_rule',target_ids:['RULE-X']}],reverse_rules:[]},
 review:{status:'approved',behavior_reviews:[{behavior_id:'B1',verdict:'accepted'},{behavior_id:'B2',verdict:'accepted'}]}});
const planner=resolve(import.meta.dirname,'pr-targets.mjs'),planned=join(root,'planned.json');
result=spawnSync(process.execPath,[planner,approved,planned],{encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
assert.deepEqual(JSON.parse(readFileSync(planned)).targets.map(x=>x.key),
 ['BLACK_BOX:R1','BLACK_BOX:R2','WHITE_BOX:R1','WHITE_BOX:RULE-X']);
console.log('PR completion gates passed');

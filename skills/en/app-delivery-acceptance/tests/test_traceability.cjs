const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../assets/ledger-viewer/traceability.js');

function acceptance() { return {description:'核对真实预订结果',preconditions:['原预订存在'],actions:['提交预订申请'],criteria:['拒绝冲突且保留原记录'],evidence_expected:['原始请求和前后记录']}; }
function fixture() {
  const scenarios = [
    { acceptance: acceptance(), id: 'S1', kind: 'black_box', requirement_ids: ['R1', 'R2', 'R2'], method_ids: ['M1'] },
    { acceptance: acceptance(), id: 'S2', kind: 'black_box', requirement_ids: ['R1'], method_ids: ['M2'] },
    { id: 'S3', kind: 'black_box', requirement_ids: ['R9'], method_ids: ['M9'] },
    { id: 'W1', kind: 'white_box', requirement_ids: ['R3'], method_ids: ['M3'] }
  ];
  const run = {
    revision: 'revision-a', environment: 'test', results: [
      { scenario_id: 'S1', status: 'passed', method_ids: ['M1'], actual: '正确拒绝', evidence: ['evidence/denied.png'] },
      { scenario_id: 'S2', status: 'failed', method_ids: ['M2'], actual: '错误接受', evidence: ['evidence/accepted.log'] }
    ]
  };
  const review = {
    revision: 'revision-a', reviewer_kind: 'independent_ai', review_reference: 'review/session-a',
    results: [
      { scenario_id: 'S1', status: 'passed', reason: '证据显示请求被拒绝', evidence: ['evidence/denied.png'] },
      { scenario_id: 'S2', status: 'passed', reason: '错误地忽略失败', evidence: ['evidence/accepted.log'] }
    ]
  };
  const record = { id: 'run-a', ledger_match: 'current', documents: { 'run.json': run, 'review.json': review } };
  return {
    documents: {
      'requirements.json': { items: [{ id: 'R1', package: 'one' }, { id: 'R2', package: 'two' }, { id: 'R3', package: 'two' }] },
      'scenarios.json': { items: scenarios },
      'methods.json': { items: [{ id: 'M1' }, { id: 'M2' }, { id: 'M3' }] },
      'coverage_review.json': { items: [
        { requirement_id: 'R1', verdict: 'sufficient', fault_probes: [{ scenario_ids: ['S1'] }, { scenario_ids: ['S2'] }] },
        { requirement_id: 'R2', verdict: 'gap', fault_probes: [{ scenario_ids: ['S1'] }] }
      ] }
    }, review_freshness: { status: 'current' }, runs: [record]
  };
}

test('many-to-many black-box coverage is deduplicated and broken references stay visible', () => {
  const result = build(fixture());
  assert.equal(result.scenarios.length, 3);
  assert.equal(result.edges, 3);
  assert.equal(result.requirementStats.linked, 2);
  assert.equal(result.requirementStats.unlinked, 1); // White-box links cannot fill black-box gaps.
  assert.equal(result.requirementStats.sufficient, 1);
  assert.equal(result.requirementStats.gap, 1);
  assert.equal(result.requirementStats.unreviewed, 1);
  assert.equal(result.usedMethods, undefined);
  assert.equal(result.faults.length, 2);
  assert.equal(result.probes, undefined);
  assert.equal(result.entries[0].scenarios.length, 2);
  assert.equal(result.entries[1].scenarios.length, 1);
  assert.equal(result.packages[0].scenarios, 2);
  assert.equal(result.packages[1].scenarios, 1);
});

test('stale review never counts as current sufficient coverage', () => {
  const data = fixture();
  data.review_freshness.status = 'stale';
  const result = build(data);
  assert.equal(result.requirementStats.sufficient, 0);
  assert.equal(result.requirementStats.stale, 2);
  assert.equal(result.requirementStats.unreviewed, 1);
});

test('design-only records do not imply application execution or evidence approval', () => {
  const result = build(fixture());
  assert.equal(result.executionStats.not_executed, 3);
  assert.equal(result.executionStats.passed, 0);
  assert.equal(result.evidenceStats.reviewed, 0);
  assert.equal(result.entries[0].executed, 0);
});

test('a single selected run separates executed, passed and evidence-reviewed counts', () => {
  const result = build(fixture(), 'run-a');
  assert.equal(result.executionStats.passed, 1);
  assert.equal(result.executionStats.failed, 1);
  assert.equal(result.executionStats.not_executed, 1);
  assert.equal(result.evidenceStats.reviewed, 1);
  assert.equal(result.evidenceStats.unproven, 1); // Reviewer saying passed cannot override an execution failure.
  assert.equal(result.entries[0].executed, 2);
  assert.equal(result.entries[0].reviewed, 1);
});

test('different runs are not merged and old versions cannot prove current scenarios', () => {
  const data = fixture();
  const old = structuredClone(data.runs[0]);
  old.id = 'run-b'; old.ledger_match = 'stale';
  old.documents['run.json'].results = [old.documents['run.json'].results[0]];
  data.runs.push(old);
  const result = build(data, 'run-b');
  assert.equal(result.executionStats.passed, 1);
  assert.equal(result.executionStats.failed, 0);
  assert.equal(result.executionStats.not_executed, 2);
  assert.equal(result.evidenceStats.reviewed, 0);
  assert.equal(result.evidenceStats.unproven, 2);
});

test('an unsubstantiated evidence review is never counted as reviewed', () => {
  for (const change of [
    record => { record.documents['review.json'].results[0].evidence = ['wrong.png']; },
    record => { record.documents['review.json'].revision = 'different'; },
    record => { record.documents['review.json'].reviewer_kind = 'self'; },
    record => { record.ledger_match = 'stale'; },
    record => { record.documents['run.json'].results[0].actual = ''; },
    record => { record.documents['review.json'].results[0].reason = ''; }
  ]) {
    const data = fixture(); change(data.runs[0]);
    assert.equal(build(data, 'run-a').byScenario.get('S1').reviewStatus, 'unproven');
  }
});

test('duplicate execution or review records cannot silently turn into a pass', () => {
  const data = fixture(), record = data.runs[0];
  record.documents['run.json'].results.push(record.documents['run.json'].results[0]);
  let result = build(data, 'run-a');
  assert.equal(result.byScenario.get('S1').status, 'invalid');
  assert.equal(result.evidenceStats.reviewed, 0);
  record.documents['run.json'].results.pop();
  record.documents['review.json'].results.push(record.documents['review.json'].results[0]);
  result = build(data, 'run-a');
  assert.equal(result.byScenario.get('S1').reviewStatus, 'invalid');
  assert.equal(result.evidenceStats.reviewed, 0);
});

test('partially missing JSON yields zero-count views instead of invented coverage', () => {
  const result = build({ documents: {}, runs: [] });
  assert.equal(result.requirementStats.total, 0);
  assert.equal(result.edges, 0);
  assert.deepEqual(result.entries, []);
  assert.equal(result.evidenceStats.reviewed, 0);
});


test('live schema-2 verdicts are visible before aggregate review and AI exceptions count separately', () => {
  const data = fixture();
  const record = data.runs[0], run = record.documents['run.json'];
  run.execution_schema = 2;
  run.lifecycle = 'running';
  run.scenario_reviews = record.documents['review.json'].results.map(r => ({...r, reviewer_kind:'independent_ai', review_reference:'scene-review'}));
  delete record.documents['review.json'];
  run.results[1].status = 'execution_error';
  run.scenario_reviews[1].status = 'execution_error';
  const result = build(data, 'run-a');
  assert.equal(result.evidenceStats.reviewed, 1);
  assert.equal(result.evidenceStats.execution_error, 1);
  assert.equal(result.executionStats.execution_error, 1);
  assert.equal(result.executionStats.failed, 0);
  assert.equal(result.evidenceStats.invalid, 0);
});

test('clarification stays distinct from a coverage gap, and a blocked current design cannot show sufficient',()=>{
 const data=fixture();data.documents['coverage_review.json'].items[0].verdict='needs_clarification';
 let result=build(data);assert.equal(result.entries[0].status,'needs_clarification');assert.equal(result.requirementStats.needs_clarification,1);
 data.documents['coverage_review.json'].items[0].verdict='sufficient';data.current_check={gates:{coverage_review:{status:'blocked'}}};
 result=build(data);assert.equal(result.entries[0].status,'unavailable');assert.equal(result.requirementStats.sufficient,0);
});

test('another requirement gap does not erase a complete shared-standard review',()=>{
 const data=fixture(),item=data.documents['coverage_review.json'].items[0];
 data.documents['scenarios.json'].design_standard='design-quality-v3';data.documents['scenarios.json'].design_basis=[{requirement_id:'R1',coverage_items:[{id:'C1',identification_basis:'原需求的拒绝规则',check_points:[{id:'P1',text:'拒绝且保留记录'}],scenario_ids:['S1'],method_ids:['M1']}]}];
 data.documents['coverage_review.json'].design_standard='design-quality-v3';
 item.coverage_results=[{coverage_id:'C1',status:'covered',reason:'方法包含实际输入及拒绝判据',scenario_coverage:[{scenario_id:'S1',method_ids:['M1'],covered_point_ids:['P1'],reason:'明确提交并检查拒绝'}]}];item.findings=[];
 item.criteria_checks=['requirement_alignment','coverage_completeness','method_discrimination','fault_detection','scope_boundaries'].map(criterion=>({criterion,status:'passed',reason:'核对该需求的场景方法及覆盖判据'}));
 data.current_check={gates:{coverage_review:{status:'blocked',issues:['R2 has a gap']}}};
 assert.equal(build(data).entries[0].status,'sufficient');
 item.criteria_checks[0].status='gap';assert.equal(build(data).entries[0].status,'unavailable');
});


test('check coverage uses the union, exposes overlap, and does not count two scenes as two new boundaries',()=>{
 const {checkCoverage}=require('../assets/ledger-viewer/traceability.js');const data=fixture();
 const cover={id:'C',identification_basis:'需求要求三个条件',check_points:[{id:'A',text:'检查A'},{id:'B',text:'检查B'},{id:'C',text:'检查C'}],scenario_ids:['S1','S2'],method_ids:['M1','M2']};
 const result={coverage_id:'C',status:'covered',reason:'两场景合计三点',scenario_coverage:[{scenario_id:'S1',method_ids:['M1'],covered_point_ids:['A','B'],reason:'方法一查A和B'},{scenario_id:'S2',method_ids:['M2'],covered_point_ids:['A','C'],reason:'方法二查A和C'}]};
 let c=checkCoverage(data,cover,result,'R1');assert.equal(c.status,'covered');assert.deepEqual(c.overlap.map(p=>p.id),['A']);assert.equal(c.covered.length,3);
 result.scenario_coverage[1].covered_point_ids=['A','B'];result.status='partial';c=checkCoverage(data,cover,result,'R1');assert.equal(c.status,'partial');assert.deepEqual(c.missing.map(p=>p.id),['C']);
 result.status='covered';assert.equal(checkCoverage(data,cover,result,'R1').status,'unavailable');
 result.scenario_coverage=[];result.status='gap';assert.equal(checkCoverage(data,cover,result,'R1').status,'gap');
});
test('bad contribution IDs, unrelated and duplicate scenes cannot create a coverage pass',()=>{
 const {checkCoverage}=require('../assets/ledger-viewer/traceability.js'),data=fixture();
 const cover={id:'C',identification_basis:'明确拒绝规则',check_points:[{id:'A',text:'检查A'}],scenario_ids:['S1'],method_ids:['M1']};
 const result={coverage_id:'C',status:'covered',reason:'查了A',scenario_coverage:[{scenario_id:'S1',method_ids:['M1'],covered_point_ids:['A'],reason:'方法的真实A判据'}]};
 for(const change of [r=>r.scenario_coverage.push({...r.scenario_coverage[0]}),r=>r.scenario_coverage[0].covered_point_ids=['outside'],r=>r.scenario_coverage[0].scenario_id='S2',r=>delete r.scenario_coverage]){
  const r=structuredClone(result);change(r);assert.equal(checkCoverage(data,cover,r,'R1').status,'unavailable');
 }
});

test('a missing embedded acceptance cannot substantiate check-item coverage',()=>{
 const {checkCoverage}=require('../assets/ledger-viewer/traceability.js'),data=fixture();
 const cover={id:'C',identification_basis:'拒绝要求',check_points:[{id:'A',text:'保留原预订'}],scenario_ids:['S1']};
 const result={coverage_id:'C',status:'covered',reason:'逐点核对',scenario_coverage:[{scenario_id:'S1',covered_point_ids:['A'],reason:'判据检查保留'}]};
 assert.equal(checkCoverage(data,cover,result,'R1').status,'covered');
 data.documents['scenarios.json'].items[0].acceptance.actions=[];
 assert.equal(checkCoverage(data,cover,result,'R1').status,'unavailable');
});

test('automatic selection uses one active run, otherwise newest creation; manual selection is preserved',()=>{
 const {selectedRun}=require('../assets/ledger-viewer/traceability.js');
 const record=(id,date,lifecycle)=>({id,documents:{'run.json':{created_at:date,lifecycle}}});
 const data={runs:[record('latest','2026-10-10T11:00:00Z','completed'),record('active','2026-10-10T10:00:00Z','running'),record('old','2026-10-09T10:00:00Z','completed')]};
 assert.equal(selectedRun(data).id,'active');assert.equal(selectedRun(data,'old',false).id,'old');assert.equal(selectedRun(data,'',false),null);
 data.runs[1].documents['run.json'].lifecycle='completed';assert.equal(selectedRun(data).id,'latest');
 assert.equal(selectedRun({runs:[]}),null);
});

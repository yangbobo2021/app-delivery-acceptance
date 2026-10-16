const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, compare, counter, diffDesign } = require('../assets/ledger-viewer/coverage.js');
const hash = 'a'.repeat(64);
function fixture(id = 'r1', path = 'jobs/worker.go') {
  const hashes = Object.fromEntries(['project','requirements','resources','scenarios','coverage_review'].map(n => [n + '.json', hash]));
  const run = { acceptance_mode: 'coverage', revision: 'b'.repeat(40), environment: { runtime: 'fixture' }, ledger_hashes: hashes };
  const measurement = { status: 'measured', environment:run.environment, run_id: id, revision: run.revision, ledger_hashes: hashes, scope: { targets: [path], exclusions: [], basis: 'fixture scope' }, tools: [{ name:'native', version:'1', command:'fixture' }], sources: [{ path, sha256:hash, metrics:{ lines:{ covered:8,total:10 }, branches:{ covered:2,total:4 } } }] };
  return { id, ledger_match:'current', read_consistent:true, file_hashes:{ 'code-coverage/measurement.json':hash, 'scenarios.snapshot.json':hash, 'methods.snapshot.json':hash }, documents:{ 'run.json':run, 'code-coverage/measurement.json':measurement, 'code-coverage/review.json':{ run_id:id, revision:run.revision, ledger_hashes:hashes, measurement_sha256:hash, status:'sufficient', recommendations:[] }, 'scenarios.snapshot.json':{ items:[{ id:'S1', title:'old', kind:'black_box' }] }, 'methods.snapshot.json':{ items:[{ id:'M1', actions:'old' }] } } };
}
test('standard and absent mode ignore optional reports', () => {
  const r=fixture(); r.documents['run.json'].acceptance_mode='standard';
  r.documents['code-coverage/measurement.json']={ sources:[{ path:'wrong' }] };
  assert.equal(analyze(r).enabled,false); assert.deepEqual(analyze(r).totals,{});
  delete r.documents['run.json'].acceptance_mode; assert.equal(analyze(r).mode,'standard');
});
test('arbitrary project paths and weighted counts without percentage averaging', () => {
  for(const path of ['ui/components/Main.tsx','jobs/worker.go','src/native/lib.rs']) {
    const r=fixture('r1',path), m=r.documents['code-coverage/measurement.json'];
    m.sources.push({path:'support/large.py',sha256:hash,metrics:{lines:{covered:50,total:100},branches:{covered:0,total:0}}}); m.scope.targets.push('support/large.py');
    const c=analyze(r); assert.equal(c.issues.length,0); assert.equal(c.totals.lines.covered,58); assert.equal(c.totals.lines.total,110); assert.equal(c.sources[0].path,path);
  }
});
test('zero denominators and missing counters never mean 100 percent', () => {
  assert.equal(counter({covered:0,total:0}).percent,null); assert.equal(counter(null),null);
  const r=fixture(); r.documents['code-coverage/measurement.json'].sources[0].metrics.branches={covered:0,total:0};
  assert.equal(analyze(r).totals.branches.percent,null);
  delete r.documents['code-coverage/measurement.json'].sources[0].metrics.lines;
  assert.equal(analyze(r).totals.lines,null); assert.ok(analyze(r).issues.some(s=>s.includes('计数无效')));
});
test('invalid counters, duplicate files and missing records remain unavailable', () => {
  for(const metric of [{covered:3,total:2},{covered:true,total:2},{covered:1.5,total:2},{covered:1,total:-2}]) assert.equal(counter(metric),null);
  const r=fixture(),m=r.documents['code-coverage/measurement.json']; m.sources.push(m.sources[0]);
  assert.equal(analyze(r).totals.lines,null); assert.ok(analyze(r).issues.some(s=>s.includes('重复')));
  delete r.documents['code-coverage/measurement.json']; assert.ok(analyze(r).issues.length);
});
test('review hash, revision and read races prevent valid binding claims', () => {
  const r=fixture(); r.documents['code-coverage/review.json'].measurement_sha256='c'.repeat(64);
  assert.ok(analyze(r).issues.some(s=>s.includes('未绑定')));
  r.documents['code-coverage/measurement.json'].revision='different'; r.read_consistent=false;
  assert.ok(analyze(r).issues.some(s=>s.includes('修订'))); assert.ok(analyze(r).issues.some(s=>s.includes('读取期间')));
});
test('historical design never gets substituted by current scenario definitions', () => {
  const a=fixture('a'),b=fixture('b'); delete a.documents['scenarios.snapshot.json'];
  assert.equal(diffDesign(a,b,'scenarios').available,false);
  a.documents['scenarios.snapshot.json']={items:[{id:'S1'}]}; a.file_hashes['scenarios.snapshot.json']='wrong';
  assert.equal(diffDesign(a,b,'scenarios').available,false);
});
test('scenario additions, edits and removals use bound historical snapshots', () => {
  const a=fixture('a'),b=fixture('b');
  a.documents['scenarios.snapshot.json'].items.push({id:'REMOVED'});
  b.documents['scenarios.snapshot.json'].items=[{id:'S1',title:'changed',kind:'black_box'},{id:'S2',kind:'white_box'}];
  const d=diffDesign(a,b,'scenarios'); assert.equal(d.available,true); assert.deepEqual(d.added,['S2']); assert.deepEqual(d.changed,['S1']); assert.deepEqual(d.removed,['REMOVED']);
});
test('matching measurement inventories compare actual covered deltas', () => {
  const a=fixture('a'),b=fixture('b'); b.documents['code-coverage/measurement.json'].sources[0].metrics.lines.covered=9;
  a.ledger_match='stale'; const c=compare(a,b); assert.equal(c.comparable,true); assert.equal(c.metrics.lines.coveredDelta,1); assert.equal(c.metrics.lines.percentDelta,10);
});
test('different revision, scope, tool, source, environment or denominator are not comparable', () => {
  for(const change of [b=>b.documents['run.json'].revision='changed',b=>b.documents['code-coverage/measurement.json'].scope.exclusions.push({path:'x',reason:'ignored'}),b=>b.documents['code-coverage/measurement.json'].tools[0].version='2',b=>b.documents['code-coverage/measurement.json'].sources[0].sha256='d'.repeat(64),b=>b.documents['run.json'].environment={runtime:'other'},b=>b.documents['code-coverage/measurement.json'].sources[0].metrics.lines.total=11]) {
    const a=fixture('a'),b=fixture('b'); change(b); const c=compare(a,b); assert.equal(c.comparable,false); assert.deepEqual(c.metrics,{}); assert.ok(c.reasons.length);
  }
});
test('unknown optional metadata and recommendations are preserved without enabling modes', () => {
  const r=fixture(); r.documents['code-coverage/review.json'].recommendations=[{ custom:'test recovery' }];
  const c=analyze(r); assert.deepEqual(c.review.recommendations,[{custom:'test recovery'}]); assert.equal(c.recordedConclusion,'尚未记录收敛结论');
  r.documents['run.json'].acceptance_mode='mystery'; assert.equal(analyze(r).enabled,false); assert.ok(analyze(r).issues.length);
});
test('same run environment cannot mask different or missing measurement environments', () => {
  for(const change of [b=>b.documents['code-coverage/measurement.json'].environment={runtime:'different'},b=>delete b.documents['code-coverage/measurement.json'].environment]) {
    const a=fixture('a'),b=fixture('b'); change(b);
    const c=compare(a,b); assert.equal(c.comparable,false); assert.ok(c.reasons.some(s=>s.includes('采集环境')));
  }
});
test('mutable revisions, malformed environments and escaped source paths cannot compare', () => {
  for(const edit of [r=>{r.documents['run.json'].revision='main';r.documents['code-coverage/measurement.json'].revision='main'},r=>{r.documents['code-coverage/measurement.json'].environment=true},r=>{r.documents['code-coverage/measurement.json'].sources[0].path='../escape.py';r.documents['code-coverage/measurement.json'].scope.targets=['../escape.py']}]) {
    const a=fixture('a'),b=fixture('b');edit(a);edit(b);assert.equal(compare(a,b).comparable,false);
  }
});
test('explicit null mode is invalid rather than a legacy missing mode', () => {
  const r=fixture();r.documents['run.json'].acceptance_mode=null;
  const c=analyze(r);assert.equal(c.enabled,false);assert.equal(c.mode,null);assert.deepEqual(c.issues,['未知验收模式']);
});
test('equal aggregate totals cannot mask changed per-file metric denominators', () => {
  const a=fixture('a'),b=fixture('b');
  for(const r of [a,b]) {const m=r.documents['code-coverage/measurement.json'];m.sources.push({path:'other.py',sha256:hash,metrics:{lines:{covered:4,total:5},branches:{covered:0,total:0}}});m.scope.targets.push('other.py');}
  b.documents['code-coverage/measurement.json'].sources[0].metrics.lines.total=9;
  b.documents['code-coverage/measurement.json'].sources[1].metrics.lines.total=6;
  assert.equal(analyze(a).totals.lines.total,analyze(b).totals.lines.total);
  const c=compare(a,b);assert.equal(c.comparable,false);assert.ok(c.reasons.some(s=>s.includes('逐文件')));assert.deepEqual(c.metrics,{});
});

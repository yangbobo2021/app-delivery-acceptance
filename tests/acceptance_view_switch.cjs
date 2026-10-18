// Execute the actual generated view script with deferred HTTP responses.
// This verifies state switching/races without starting a project or a model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(process.argv[2], 'utf8');
assert.doesNotMatch(html, /id="project"|querySelector\('#project'\)/);
assert.equal((html.match(/<th>/g)||[]).length, 5);
assert.doesNotMatch(html, /<th>代码覆盖率<\/th>/);
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]).join('\n');
const nodes = new Map();
function node(selector) {
  if (!nodes.has(selector)) nodes.set(selector, {
    value: '', innerHTML: '', textContent: '', hidden: false, listeners: {},
    addEventListener(event, handler) { this.listeners[event] = handler; },
  });
  return nodes.get(selector);
}
const requests = [];
node('#coverageScope').value = 'project';
const context = vm.createContext({
  URL, console,
  window: {addEventListener() {}},
  location: {href: 'http://localhost/'},
  history: {replaceState() {}},
  document: {querySelector: node, querySelectorAll: () => []},
  setInterval() {},
  fetch(url) { return new Promise(resolve => requests.push({url, resolve})); },
});
const flush = () => new Promise(resolve => setImmediate(resolve));
const scene = (id, verdict) => ({
  project: {id: 'project'}, requirements: [{id: 'REQ-1', text: 'Fixture requirement'}],
  reverse_rules: [], scenarios: [{id, requirement_id: 'REQ-1', title: id, description: 'Fixture'}],
  generated_at: '2026-10-17', execution_known: true, stage: 'reviewed',
  bindings: [], case_results: [], judgment: {status: verdict, reason: 'Fixture'},
  current_links: {'Fixture evidence': '/evidence/fixture.txt'},
});
const payload = (id, verdict, pct) => ({
  acceptances: [{id: 'AT-a', title: 'A'}, {id: 'AT-b', title: 'B'}], acceptance_id: id,
  current_acceptance_id: 'AT-b', current_error: null,
  scope: {version: 1, basis: 'Fixture'}, denominator_complete: true,
  traces: [scene(id, verdict)], project_state: {traces: [scene(id, verdict)]},
  progress: {previews: [], stages: []},
  coverage: [{project_id: 'project', revision: 'fixture', tools: [{name: 'fixture-only'}],
    scopes: {project: {line: {total: 10, covered: pct / 10, pct}, branch: {total: 20, covered: pct / 5, pct}}}}],
});
function reply(index, data, ok = true) {
  requests[index].resolve({ok, json: async () => data});
}
(async () => {
  vm.runInContext(script, context);
  assert.equal(requests[0].url, '/api/acceptances');
  reply(0, {acceptances:payload().acceptances, acceptance_id:'AT-a', current_acceptance_id:'AT-b'});
  await flush();
  assert.match(node('#acceptanceId').innerHTML, /AT-a.*AT-b/);
  assert.match(node('#acceptanceListStatus').textContent, /共 2 项/);
  assert.equal(node('#acceptanceId').disabled, false);
  assert.match(requests[1].url, /acceptance_id=AT-a/);
  // Both IDs are already available while the heavy result request is pending.
  assert.doesNotMatch(node('#coverageSummary').innerHTML, /30%/);
  const first=payload('AT-a', 'passed', 30);
  first.coverage[0].last_capture_at='2026-10-18T05:00:00Z';
  first.coverage.push({project_id:'project',revision:'other-capture',last_capture_at:'2026-10-17T05:00:00Z',scenes_with_coverage:1,tools:[{name:'other tool',version:'2'}],scopes:{
    project:{line:{total:10,covered:8,pct:80},branch:{total:20,covered:10,pct:50}},
    changed_lines:{line:{total:2,covered:2,pct:100},branch:{total:4,covered:3,pct:75}}
  }});
  reply(1, first);
  await flush();
  assert.equal(node('#acceptanceId').value, 'AT-a');
  assert.equal(node('#currentAcceptance').textContent, '当前进行中：AT-b');
  assert.match(node('#coverageSummary').innerHTML, /30%/);
  assert.match(node('#resultBalance').textContent, /1 通过/);
  assert.match(node('#rows').innerHTML, /class="clamp conclusion-preview"/);
  assert.match(node('#rows').innerHTML, /data-more="展开查看更多" aria-expanded="false"/);
  assert.match(node('#rows').innerHTML, /href="\/evidence\/fixture.txt"/);
  assert.equal((node('#rows').innerHTML.match(/<td\b/g)||[]).length, 5);
  assert.equal((node('#coverageSummary').innerHTML.match(/class="metric"/g)||[]).length,2);
  assert.doesNotMatch(node('#coverageSummary').innerHTML,/80%/);
  node('#coverageVersion').value=JSON.stringify(['project','other-capture']);
  node('#coverageVersion').listeners.change();
  assert.match(node('#coverageSummary').innerHTML,/80%/);
  assert.match(node('#coverageSummary').innerHTML,/50%/);
  assert.match(node('#coverageSummary').innerHTML,/other tool 2/);
  vm.runInContext('coverageRows.reverse();renderCoverage()',context);
  assert.match(node('#coverageSummary').innerHTML,/other-capture/);
  assert.match(node('#coverageSummary').innerHTML,/80%/);
  node('#coverageScope').value='changed_lines';node('#coverageScope').listeners.change();
  assert.match(node('#coverageSummary').innerHTML,/100%/);
  assert.match(node('#coverageSummary').innerHTML,/75%/);
  assert.doesNotMatch(node('#coverageSummary').innerHTML,/80%/);
  node('#coverageScope').value='project';node('#coverageScope').listeners.change();

  node('#acceptanceId').value = 'AT-b';
  node('#acceptanceId').listeners.change();
  assert.doesNotMatch(node('#coverageSummary').innerHTML, /30%/);
  assert.match(requests[2].url, /acceptance_id=AT-b/);
  reply(2, payload('AT-b', 'accepted_risk', 60));
  await flush();
  assert.match(node('#coverageSummary').innerHTML, /60%/);
  assert.match(node('#resultBalance').textContent, /0 通过/);
  assert.match(node('#resultBalance').textContent, /1 接受风险/);
  assert.doesNotMatch(node('#rows').innerHTML, /AT-a/);
  assert.equal(node('#currentAcceptance').textContent, '当前进行中：AT-b');

  // Two quick switches: a slower old response must not overwrite the new ID.
  node('#acceptanceId').value = 'AT-a';
  node('#acceptanceId').listeners.change();
  node('#acceptanceId').value = 'AT-b';
  node('#acceptanceId').listeners.change();
  reply(4, payload('AT-b', 'accepted_risk', 60));
  await flush();
  reply(3, payload('AT-a', 'passed', 30));
  await flush();
  assert.equal(node('#acceptanceId').value, 'AT-b');
  assert.match(node('#coverageSummary').innerHTML, /60%/);

  // A failed switch clears the previous result and leaves ID choices available.
  node('#acceptanceId').value = 'AT-a';
  node('#acceptanceId').listeners.change();
  reply(5, {...payload('AT-a', 'passed', 30), reason: 'broken index'}, false);
  await flush();
  assert.doesNotMatch(node('#coverageSummary').innerHTML, /60%/);
  assert.match(node('#acceptanceWarning').textContent, /broken index/);
  assert.match(node('#acceptanceId').innerHTML, /AT-b/);
  console.log('Acceptance ID switch, metrics, evidence row isolation and stale-response checks passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});

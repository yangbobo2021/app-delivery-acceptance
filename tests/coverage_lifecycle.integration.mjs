// Real coverage.py, real subprocesses and the copied public Node entry.
// No model calls, original benchmark edits or full business workflow retries.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {materializeCoverageEntry} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/coverage/protocol/materialize.mjs';
import {runLifecycleGate, verifyLifecycleGate} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/coverage/protocol/lifecycle.mjs';

const args = process.argv.slice(2), option = name => {const index = args.indexOf(name);return index < 0 ? undefined : args[index + 1];};
const output = args.includes('--output') ? path.resolve(option('--output')) : fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-lifecycle-evidence-'));
const python = path.resolve(option('--python') ?? '/opt/miniconda3/bin/python3');
fs.mkdirSync(output, {recursive: true});
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file));
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', {flag: 'wx'});
const tool = spawnSync(python, ['-c', 'import coverage; print(coverage.__version__)'], {encoding: 'utf8'});
assert.equal(tool.status, 0, tool.stderr);
const tools = [{name: 'coverage.py', version: tool.stdout.trim(), role: '中文用途描述'}];
const results = [], started = performance.now();
function fixture(label, behavior = 'normal', expectedExit = 0, sharedFlags = [], launcher = 'python') {
  const root = path.join(output, label), tests = path.join(root, 'tests'), prepared = path.join(root, 'candidate');
  for (const name of ['src', 'tests/hook', 'candidate']) fs.mkdirSync(path.join(root, name), {recursive: true});
  fs.writeFileSync(path.join(root, 'src/calc.py'), 'import sys\ndef classify(value):\n    if value > 0:\n        return "positive"\n    return "nonpositive"\nif __name__ == "__main__":\n    print(classify(int(sys.argv[1])))\n');
  fs.writeFileSync(path.join(tests, 'hook/sitecustomize.py'), 'import coverage\ncoverage.process_startup()\n');
  fs.writeFileSync(path.join(tests, 'route.py'), 'import os, subprocess, sys\nassert os.environ.get("PROJECT_EXECUTION_ENV") == "lifecycle-runtime-default"\nif sys.argv[1] == "nonzero":\n    env = dict(os.environ)\n    if env.get("FIXTURE_DROP_CHILD"): env.pop("COVERAGE_PROCESS_START", None)\n    result = subprocess.run([sys.executable, "-B", "src/calc.py", "1"], env=env)\n    assert result.returncode == 0\nprint("REAL_ROUTE_" + sys.argv[1])\nif sys.argv[1] == "nonzero": sys.exit(' + expectedExit + ')\n');
  fs.copyFileSync(fileURLToPath(new URL('./fixtures/coverage/python/backend_v2.py', import.meta.url)), path.join(tests, 'backend.py'));
  fs.copyFileSync(fileURLToPath(new URL('./fixtures/coverage/python/oracle_v2.py', import.meta.url)), path.join(tests, 'oracle.py'));
  write(path.join(tests, 'settings.json'), {root, behavior});
  const names=['tests/backend.py', 'tests/oracle.py', 'tests/settings.json', 'tests/route.py', 'tests/hook/sitecustomize.py'];
  let backendEntry=[python,...sharedFlags,path.join(tests,'backend.py')],oracleEntry=[python,...sharedFlags,path.join(tests,'oracle.py')];
  if(launcher==='node-import'){
    fs.writeFileSync(path.join(tests,'common-loader.mjs'),'export const loaderIdentity = "shared-non-statistical-runtime-loader";\n');
    names.push('tests/common-loader.mjs');
    for(const name of ['backend','oracle']){
      const wrapper='tests/'+name+'-wrapper.mjs';names.push(wrapper);
      fs.writeFileSync(path.join(root,wrapper),`import {spawnSync} from 'node:child_process';const result=spawnSync(${JSON.stringify(python)},[${JSON.stringify(path.join(tests,name+'.py'))},...process.argv.slice(2)],{stdio:'inherit'});process.exit(result.status??2);\n`);
    }
    backendEntry=[process.execPath,'--import',path.join(tests,'common-loader.mjs'),path.join(tests,'backend-wrapper.mjs')];
    oracleEntry=[process.execPath,'--import',path.join(tests,'common-loader.mjs'),path.join(tests,'oracle-wrapper.mjs')];
  }
  const files = Object.fromEntries(names.map(name => [name, sha(path.join(root, name))]));
  const materialized = materializeCoverageEntry({workspace: root, testRoots: ['tests'], attempt: root, entry: backendEntry, tools, adapterFiles: files,
    sourceHashes: {'src/calc.py': sha(path.join(root, 'src/calc.py'))}, revision: 'fixture-revision', executionEnv:{PROJECT_EXECUTION_ENV:'lifecycle-runtime-default'}});
  for (const name of materialized.paths) files[name] = sha(path.join(root, name));
  const runtimeFile = path.join(root, 'runtime.json'), inventory = path.join(root, 'inventory.json');
  write(runtimeFile, {workspace: root, revision: 'fixture-revision', executables: [{path: python},{path:process.execPath}],execution_env:{PROJECT_EXECUTION_ENV:'lifecycle-runtime-default'}});
  write(inventory, {source_hashes: {'src/calc.py': sha(path.join(root, 'src/calc.py'))}});
  const plan = {workspace: root, revision: 'fixture-revision', runtime_sha256: sha(runtimeFile),
    routes: [{id: 'python-cli-subprocess', source_paths: ['src/calc.py'], lifecycle: Object.fromEntries(['zero', 'nonzero'].map(mode => [mode,
      {command: [python, '-B', path.join(tests, 'route.py'), mode], env: {PYTHONDONTWRITEBYTECODE: '1'}, expected_exit_code: mode === 'nonzero' ? expectedExit : 0}]))}]};
  plan.routes[0].lifecycle.direct = [...oracleEntry, '{request}'];
  const planFile = path.join(root, 'plan.json');write(planFile, plan);
  const profile = {schema: 'project-coverage-preparation-v1', protocol_revision: 2, entry: materialized.entry,
    adapter_files: files, tools, source_dispositions: {'src/calc.py': {kind: 'measured', reason: 'Actual coverage.py native sources'}},
    preparation_status: 'ready', preparation_evidence: [{path: planFile, sha256: sha(planFile)}],
    spec: {project_root: root, revision: 'fixture-revision', source_hashes: read(inventory).source_hashes,
      runtime_manifest: runtimeFile, runtime_sha256: sha(runtimeFile), inventory_path: inventory, inventory_sha256: sha(inventory)}};
  write(path.join(prepared, 'prepared.json'), profile);
  return {root, prepared, profile, plan: planFile, output: path.join(root, 'gate')};
}
function test(id, purpose, body) {
  const start = performance.now();
  try {results.push({id, purpose, status: 'passed', ...body(), seconds: (performance.now() - start) / 1000});}
  catch (error) {results.push({id, purpose, status: 'failed', error: error.stack});process.exitCode = 1;}
  writeResult();console.log(results.at(-1).status + ' ' + id + ' ' + purpose);
}
function writeResult() {
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({boundary: 'Bounded real-tool protocol tests, no autonomous Agent/full business acceptance claim', tools,
    passed: results.filter(x => x.status === 'passed').length, failed: results.filter(x => x.status === 'failed').length,
    seconds: (performance.now() - started) / 1000, results}, null, 2) + '\n');
}
let normal;
test('LIFECYCLE-SHARED-LOADER', '真实独立后端与读取器共用冻结运行时加载文件，不将加载器误认作主程序', () => {
  const value=fixture('shared-loader','normal',0,[],'node-import');
  const gate=runLifecycleGate(value);assert.equal(gate.status,'passed');
  return {gate:path.join(value.output,'lifecycle-gate.json')};
});
test('LIFECYCLE-SHARED-FLAGS', '独立真实读取器与后端共用解释器参数时不误判为同一后端', () => {
  const value = fixture('shared-flags', 'normal', 0, ['-B']);
  const gate = runLifecycleGate(value);assert.equal(gate.status, 'passed');
  return {gate: path.join(value.output, 'lifecycle-gate.json')};
});
for(const spelling of ['absolute','relative','alias'])test('LIFECYCLE-SAME-BACKEND-'+spelling, '主后端直接启动无法满足实际独立读取协议，保留原始失败：'+spelling, () => {
  const value=fixture('same-backend-'+spelling,'normal',0,['-B']),plan=read(value.plan),backend=path.join(value.root,'tests/backend.py');
  const alias=path.join(value.root,'tests/backend-alias.py');if(spelling==='alias')fs.symlinkSync(backend,alias);
  plan.routes[0].lifecycle.direct=[python,spelling==='absolute'?backend:spelling==='relative'?'tests/backend.py':alias,'{request}'];
  fs.writeFileSync(value.plan,JSON.stringify(plan));
  assert.throws(()=>runLifecycleGate(value),/independent reader failed/);
  assert.equal(read(path.join(value.output,'failure.json')).status,'blocked');
});
test('LIFECYCLE-01', '真实零/非零 CLI 子进程完成采集、收尾、重复核验及汇总，描述和时间变化不误拒绝', () => {
  normal = fixture('normal');
  const gate = runLifecycleGate(normal);assert.equal(gate.status, 'passed');
  assert.equal(verifyLifecycleGate(path.join(normal.output, 'lifecycle-gate.json'), normal.profile).status, 'passed');
  const mode = path.join(normal.output, 'python-cli-subprocess/nonzero'), files = fs.readdirSync(mode).filter(name => name.endsWith('.backend.json')).map(name => read(path.join(mode, name)));
  const recounts = files.flatMap(file => file.calls).filter(call => call.backend_operation === 'read' && call.response?.tool_metadata);
  assert.ok(new Set(recounts.map(call => call.response.tool_metadata.timestamp)).size > 1);
  const report = read(gate.routes[0].nonzero.report.path);
  assert.ok(report.raw_evidence.filter(ref => ref.role === 'native').length >= 2, 'Actual child native snapshot missing');
  assert.ok(gate.routes[0].zero.metrics_tamper_rejected && gate.routes[0].nonzero.metrics_tamper_rejected);
  return {gate: path.join(normal.output, 'lifecycle-gate.json'), repeated_native_timestamps: recounts.map(call => call.response.tool_metadata.timestamp)};
});
for (const [behavior, pattern] of [
  ['drop-child', /did not establish nonzero/], ['missing', /finish omitted/], ['broken-finish', /lifecycle finish failed/],
  ['broken-summary', /lifecycle summarize failed/], ['echo', /native recount mismatch/], ['wrong-counts', /native recount mismatch/],
  ['mutate', /reader changed evidence/],
  ['zero-branch-mode', /zero\/nonzero metric availability or native denominator changed/],
]) test('LIFECYCLE-' + behavior, '阻止就绪：' + behavior, () => {
  const value = fixture(behavior, behavior);
  assert.throws(() => runLifecycleGate(value), pattern);
  assert.equal(fs.existsSync(path.join(value.output, 'lifecycle-gate.json')), false);
  assert.equal(read(path.join(value.output, 'failure.json')).status, 'blocked');
});
test('LIFECYCLE-NATIVE-METRIC', '原生数值指标可验证，不强制工具声明不支持的行或分支指标', () => {
  const value = fixture('native-metric', 'native-metric'), gate = runLifecycleGate(value);
  assert.equal(gate.status, 'passed');
  const component = read(gate.routes[0].nonzero.report.path).components[0];
  assert.equal(component.line.status, 'unavailable');assert.ok(component.statements.covered > 0);
});
test('LIFECYCLE-PARTIAL', '全部源码不支持时保留 partial，不能伪装为就绪或跳过测量路由', () => {
  const value = fixture('partial'), plan = read(value.plan);plan.routes = [];
  fs.writeFileSync(value.plan, JSON.stringify(plan));
  value.profile.preparation_status = 'partial';
  value.profile.source_dispositions['src/calc.py'] = {kind: 'unsupported', reason: 'Controlled unsupported-tool input'};
  fs.writeFileSync(path.join(value.prepared, 'prepared.json'), JSON.stringify(value.profile));
  const gate = runLifecycleGate(value);assert.equal(gate.status, 'partial');
  assert.equal(verifyLifecycleGate(path.join(value.output, 'lifecycle-gate.json'), value.profile).status, 'partial');
  const changed = structuredClone(value.profile);changed.preparation_status = 'ready';
  assert.throws(() => verifyLifecycleGate(path.join(value.output, 'lifecycle-gate.json'), changed), /missing, failed/);
  const measured = fixture('measured-without-route'), empty = read(measured.plan);empty.routes = [];
  fs.writeFileSync(measured.plan, JSON.stringify(empty));
  assert.throws(() => runLifecycleGate(measured), /without routes/);
});
test('LIFECYCLE-EXIT', '真实非零命令退出码保留，完整采集仍可通过准备验证', () => {
  const value = fixture('exit-seven', 'normal', 7), gate = runLifecycleGate(value);
  assert.equal(gate.routes[0].nonzero.expected_exit_code, 7);
});
test('LIFECYCLE-BINDING', '遗漏完整路由、改变绑定或证据不能复用就绪证明', () => {
  const value = fixture('missing-route'), plan = read(value.plan);delete plan.routes[0].lifecycle;
  fs.writeFileSync(value.plan, JSON.stringify(plan));
  assert.throws(() => runLifecycleGate(value), /requires exact/);
  const changed = structuredClone(normal.profile);changed.spec.revision = 'different';
  assert.throws(() => verifyLifecycleGate(path.join(normal.output, 'lifecycle-gate.json'), changed), /another preparation/);
  const gate = read(path.join(normal.output, 'lifecycle-gate.json')), ref = gate.files.find(item => item.path.endsWith('.txt'));
  const original = fs.readFileSync(ref.path);
  try {fs.appendFileSync(ref.path, 'tampered');assert.throws(() => verifyLifecycleGate(path.join(normal.output, 'lifecycle-gate.json'), normal.profile), /missing or changed/);}
  finally {fs.writeFileSync(ref.path, original);}
});
function publicCall(operation, input, label) {
  const folder = path.join(normal.root, 'public-checks');fs.mkdirSync(folder, {recursive: true});
  const request = path.join(folder, label + '-request.json'), response = path.join(folder, label + '-response.json');
  write(request, input);
  const result = spawnSync(normal.profile.entry[0], [...normal.profile.entry.slice(1), operation, request, response], {encoding: 'utf8', timeout: 30000});
  write(path.join(folder, label + '-command.json'), {operation, input, exit_code: result.status, stdout: result.stdout, stderr: result.stderr});
  return {result, response, failure: fs.existsSync(response + '.failure.json') ? read(response + '.failure.json') : null};
}
test('LIFECYCLE-PROVENANCE', '篡改源码绑定、原生文件或原生报告字节均被拒绝，原证据保持', () => {
  const gate = read(path.join(normal.output, 'lifecycle-gate.json')), original = read(gate.routes[0].nonzero.report.path);
  const folder = path.join(normal.root, 'negative-reports');fs.mkdirSync(folder);
  const changed = structuredClone(original);changed.source_hashes['src/calc.py'] = 'f'.repeat(64);
  const file = path.join(folder, 'source-binding.json');write(file, changed);
  assert.match(publicCall('verify-report', {report: file}, 'source-binding').failure.message, /source binding mismatch/);
  for (const role of ['native', 'native_report']) {
    const report = structuredClone(original), ref = report.raw_evidence.find(item => item.role === role);
    const copy = path.join(folder, role + '.data');fs.copyFileSync(ref.path, copy);fs.appendFileSync(copy, 'tampered');
    ref.path = copy;
    const file = path.join(folder, role + '.json');write(file, report);
    const check = publicCall('verify-report', {report: file}, role);
    assert.equal(check.result.status, 2);assert.match(check.failure.message, /evidence hash mismatch/);
  }
  assert.equal(publicCall('verify-report', {report: gate.routes[0].nonzero.report.path}, 'original-intact').result.status, 0);
});
test('LIFECYCLE-ARCHIVE', '完整准备证据可从离线同哈希副本复核，冻结入口的准备绑定保持', () => {
  const gateFile = path.join(normal.output, 'lifecycle-gate.json'), gate = read(gateFile), archive = path.join(normal.root, 'archive');
  fs.mkdirSync(archive);const mapping = {};
  for (const [index, ref] of gate.files.entries()) {
    const file = path.join(archive, String(index) + path.extname(ref.path));fs.copyFileSync(ref.path, file);
    mapping[ref.path] = {path: file, sha256: ref.sha256};
  }
  const archivedGate = path.join(archive, 'lifecycle-gate.json');fs.copyFileSync(gateFile, archivedGate);
  fs.renameSync(normal.output, normal.output + '-retired');
  try {
    assert.equal(verifyLifecycleGate(archivedGate, normal.profile, mapping).status, 'passed');
    const report = gate.routes[0].nonzero.report.path;
    const checked = publicCall('verify-report', {report, artifact_map: mapping}, 'offline-native-recount');
    assert.equal(checked.result.status, 0, checked.result.stderr);
    const summarized = publicCall('summarize', {reports: [report], inventory: read(normal.profile.spec.inventory_path), artifact_map: mapping}, 'offline-native-summary');
    assert.equal(summarized.result.status, 0, summarized.result.stderr);
  }
  finally {fs.renameSync(normal.output + '-retired', normal.output);}
});
writeResult();
if (process.exitCode) console.log('Review failures under ' + output);

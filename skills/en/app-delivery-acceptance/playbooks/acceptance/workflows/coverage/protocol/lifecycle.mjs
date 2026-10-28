// Bounded non-business checks of the exact frozen public entry. No Agent calls,
// coverage arithmetic, activation, registration or product judgment occurs here.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {assertToolIdentity} from './tools.mjs';
import {assertRecount, evidenceFiles, unchangedEvidence} from './report.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export function lifecycleBinding(profile) {
  const copy = structuredClone(profile);
  delete copy.spec.lifecycle_report;delete copy.spec.lifecycle_report_sha256;
  copy.preparation_evidence = copy.preparation_evidence.filter(item => item.role !== 'lifecycle_gate');
  return createHash('sha256').update(JSON.stringify(canonical(copy))).digest('hex');
}
function artifacts(directory) {
  const files = [];
  function visit(folder) {for (const item of fs.readdirSync(folder, {withFileTypes: true})) {
    const file = path.join(folder, item.name);
    if (item.isSymbolicLink()) throw Error('Coverage lifecycle evidence cannot use links');
    if (item.isDirectory()) visit(file);
    else if (item.isFile()) files.push({path: file, sha256: hash(file)});
  }}
  visit(directory);return files;
}
export function verifyLifecycleGate(file, profile, mapping = {}) {
  const report = read(file);
  const noMeasured = !Object.values(profile.source_dispositions).some(value => value.kind === 'measured');
  const partial = report.status === 'partial' && profile.preparation_status === 'partial' && noMeasured && report.routes?.length === 0;
  if (report.schema !== 'coverage-lifecycle-gate-v1' || !partial && (report.status !== 'passed' || !report.routes?.length) ||
      report.binding_sha256 !== lifecycleBinding(profile))
    throw Error('Coverage lifecycle gate missing, failed or bound to another preparation');
  if (report.routes.some(route => !['zero', 'zero_repeat', 'nonzero'].every(mode => route[mode]?.status === 'passed') ||
      !['zero', 'mixed'].every(mode => route.aggregates?.[mode]?.status === 'passed')))
    throw Error('Coverage lifecycle gate omitted a route check');
  for (const ref of report.files ?? []) {
    let actual = ref.path;
    if (!fs.existsSync(actual) || hash(actual) !== ref.sha256) {
      const alias = mapping[actual + '#' + ref.sha256] ?? mapping[actual];
      if (alias?.sha256 !== ref.sha256) throw Error('Coverage lifecycle evidence missing or changed: ' + actual);
      actual = alias.path;
    }
    if (hash(actual) !== ref.sha256) throw Error('Coverage lifecycle evidence missing or changed: ' + ref.path);
  }
  if (!report.files?.length) throw Error('Coverage lifecycle gate has no execution evidence');
  return report;
}
export function runLifecycleGate({prepared, plan: planPath, output}) {
  if (fs.existsSync(output)) throw Error('Coverage lifecycle output already exists; preserve the attempt');
  fs.mkdirSync(output, {recursive: true});
  const profileFile = path.join(prepared, 'prepared.json'), profile = read(profileFile), plan = read(planPath);
  const runtime = read(profile.spec.runtime_manifest), root = profile.spec.project_root, routes = [];
  const allowed = new Set(runtime.executables.flatMap(item => [item.path, item.resolved_path].filter(Boolean).map(file => fs.realpathSync(file))));
  let sequence = 0;
  const invoke = (operation, request, folder, expected = 0, cwd = root) => {
    const requestFile = path.join(folder, 'request-' + (++sequence) + '.json'), response = path.join(folder, operation === 'run' ? 'run-response.json' : 'response-' + sequence + '.json');
    write(requestFile, {...request, artifact_map: {}});
    const command = [...profile.entry, operation, requestFile, response], started_at = new Date().toISOString();
    const stdout = path.join(folder, 'stdout-' + sequence + '.txt'), stderr = path.join(folder, 'stderr-' + sequence + '.txt');
    const out = fs.openSync(stdout, 'wx'), err = fs.openSync(stderr, 'wx');let result;
    try {result = spawnSync(command[0], command.slice(1), {cwd, stdio: ['ignore', out, err], timeout: 30000});}
    finally {fs.closeSync(out);fs.closeSync(err);}
    const receipt = {operation, command, cwd, started_at, finished_at: new Date().toISOString(),
      exit_code: result.status, signal: result.signal, error: result.error?.message,
      stdout: {path: stdout, sha256: hash(stdout)}, stderr: {path: stderr, sha256: hash(stderr)}};
    const receiptFile = path.join(folder, 'command-' + sequence + '.json');write(receiptFile, receipt);
    if (result.error || result.signal || result.status !== expected) {
      const failureFile = response + '.failure.json';
      const reason = fs.existsSync(failureFile) ? read(failureFile).message : fs.readFileSync(stderr, 'utf8').slice(-1000);
      throw Error('Coverage lifecycle ' + operation + ' failed: ' + reason + '; ' +
        JSON.stringify({...receipt, detail: fs.readFileSync(stderr, 'utf8').slice(-4000)}));
    }
    return {file: response, value: fs.existsSync(response) ? read(response) : null, receipt, receiptFile};
  };
  const checkSources = () => {for (const [name, digest] of Object.entries({...profile.spec.source_hashes, ...profile.adapter_files}))
    if (hash(path.join(root, name)) !== digest) throw Error('Coverage lifecycle changed frozen source/adapter: ' + name);};
  const oracle = (route, reports, expected, folder, expectedStatus = 'measured') => {
    const snapshots = Object.assign({}, ...reports.map(file => evidenceFiles(file, read(file))));
    const query = path.join(folder, 'oracle-request.json'), derived = path.join(folder, 'oracle-output');fs.mkdirSync(derived);
    write(query, {groups: reports.map(file => {const report = read(file);return {status: report.status, raw_evidence: report.raw_evidence};}),
      sources: Object.fromEntries(Object.keys(profile.spec.source_hashes).map(name => [name, path.join(root, name)])),
      component_sources: expected.map(component => ({id: component.id, source_paths: component.source_paths,
        metric_names: Object.keys(component).filter(name => ['measured', 'incomplete', 'unavailable'].includes(component[name]?.status))})),
      project_root: root, inventory: read(profile.spec.inventory_path), output: derived});
    const command = route.lifecycle.direct?.map(value => value.replaceAll('{request}', query).replaceAll('{workspace}', root).replaceAll('{probe_dir}', folder));
    if (!command?.length || !allowed.has(fs.realpathSync(command[0]))) throw Error('Coverage lifecycle needs an independent native reader command');
    const backend = read(path.join(path.dirname(profile.entry[1]), 'binding.json')).entry;
    if (backend.slice(1).some(value => command.includes(value))) throw Error('Coverage oracle must not invoke the project backend');
    const started_at = new Date().toISOString(), result = spawnSync(command[0], command.slice(1), {cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024});
    const record = {command, started_at, finished_at: new Date().toISOString(), exit_code: result.status, signal: result.signal,
      stdout: result.stdout, stderr: result.stderr, error: result.error?.message};write(path.join(folder, 'oracle-command.json'), record);
    unchangedEvidence(snapshots);
    if (result.error || result.signal || result.status !== 0) throw Error('Coverage lifecycle independent reader failed: ' + JSON.stringify(record));
    const value = JSON.parse(result.stdout);
    if (value.schema !== 'coverage-native-oracle-v1') throw Error('Coverage lifecycle native reader schema missing');
    const facts = components => components.map(component => ({id: component.id, source_paths: component.source_paths,
      ...Object.fromEntries(Object.keys(component).filter(name => ['measured', 'incomplete', 'unavailable'].includes(component[name]?.status))
        .map(name => [name, Object.fromEntries(Object.entries(component[name]).filter(([key]) => ['status', 'covered', 'total', 'reason', 'tool_output'].includes(key)))]))}));
    assertRecount({status: expectedStatus, components: facts(expected)}, {...value, components: facts(value.components)});
  };
  try {
    if (profile.protocol_revision !== 2) throw Error('Complete lifecycle validation requires a new v2 preparation');
    if (plan.workspace !== root || plan.revision !== profile.spec.revision ||
        plan.runtime_sha256 !== profile.spec.runtime_sha256) throw Error('Coverage lifecycle plan binding differs');
    if (!plan.routes?.length) {
      if (profile.preparation_status !== 'partial' || Object.values(profile.source_dispositions).some(value => value.kind === 'measured'))
        throw Error('Coverage lifecycle cannot certify measured sources without routes');
      const report = {schema: 'coverage-lifecycle-gate-v1', status: 'partial', binding_sha256: lifecycleBinding(profile),
        routes: [], reason: 'No measured sources; no executable coverage route is certified',
        files: [{path: profileFile, sha256: hash(profileFile)}, {path: planPath, sha256: hash(planPath)}], business_tests: 'not_executed'};
      write(path.join(output, 'lifecycle-gate.json'), report);return report;
    }
    const routeIds = new Set();
    for (const route of plan.routes) {
      if (!/^[-_\p{L}\p{N}]+$/u.test(route.id ?? '') || routeIds.has(route.id) ||
          !Array.isArray(route.source_paths) || !route.source_paths.length ||
          route.source_paths.some(source => !Object.hasOwn(profile.spec.source_hashes, source)))
        throw Error('Coverage lifecycle route ID/source scope invalid');
      routeIds.add(route.id);
      const result = {id: route.id, source_paths: route.source_paths};
      for (const mode of ['zero', 'zero_repeat', 'nonzero']) {
        const commandSpec = route.lifecycle?.[mode === 'zero_repeat' ? 'zero' : mode], folder = path.join(output, route.id, mode);
        if (!commandSpec || !Array.isArray(commandSpec.command) || !commandSpec.command.length ||
            commandSpec.command.some(part => typeof part !== 'string' || !part) ||
            !allowed.has(fs.realpathSync(commandSpec.command[0])))
          throw Error('Coverage lifecycle route requires exact zero/nonzero commands from the verified runtime: ' + route.id);
        fs.mkdirSync(folder, {recursive: true});
        const substitute = text => text.replaceAll('{probe_dir}', folder).replaceAll('{workspace}', root);
        const env = Object.fromEntries(Object.entries(commandSpec.env ?? {}).map(([key, value]) => {
          if (typeof value !== 'string') throw Error('Coverage lifecycle environment must contain strings');
          return [key, substitute(value)];
        }));
        const session = {cwd: root, output: folder, scene_id: '__coverage_preparation__/' + route.id + '/' + mode,
          revision: profile.spec.revision, prepared, prepared_sha256: hash(profileFile),
          command: commandSpec.command.map(substitute), env, files: Object.keys(profile.adapter_files)};
        const sessionFile = path.join(folder, 'session.json');write(sessionFile, session);
        const expectedExit = commandSpec.expected_exit_code ?? 0;
        if (!Number.isInteger(expectedExit) || expectedExit < 0 || expectedExit > 255) throw Error('Invalid lifecycle command exit expectation');
        const run = invoke('run', session, folder, expectedExit);
        if (!run.value || run.value.exit_code !== expectedExit) throw Error('Coverage lifecycle run response/exit mismatch');
        const receiptFile = path.join(folder, 'execution.json');
        write(receiptFile, {...run.receipt, cwd: root, command: run.receipt.command,
          coverage_session_path: sessionFile, coverage_session_sha256: hash(sessionFile),
          head_before: profile.spec.revision, head_after: profile.spec.revision, exit_code: expectedExit});
        const finished = invoke('finish', {request: sessionFile, receipt: receiptFile, output: folder}, folder);
        const report = finished.value;
        const allowedStatus = profile.preparation_status === 'partial' ? ['measured', 'incomplete'] : ['measured'];
        if (!report || report.schema !== 'project-tool-coverage-report-v1' || !allowedStatus.includes(report.status) ||
            report.collection_relation !== 'same_run' || report.scene_id !== session.scene_id ||
            report.prepared !== prepared || report.prepared_sha256 !== session.prepared_sha256 ||
            report.receipt_path !== receiptFile || report.execution_sha256 !== hash(receiptFile) ||
            report.revision !== profile.spec.revision || !equal(report.source_hashes, profile.spec.source_hashes))
          throw Error('Coverage lifecycle finish omitted the real session/receipt/source binding');
        assertToolIdentity(report.tools, profile.tools);
        const selected = report.components.filter(component => component.source_paths.some(source => route.source_paths.includes(source)));
        if (route.source_paths.some(source => !selected.some(component => component.source_paths.includes(source))))
          throw Error('Coverage lifecycle report omitted route sources');
        const metrics = selected.flatMap(component => Object.values(component)).filter(metric =>
          metric?.status === 'measured' && Number.isSafeInteger(metric.covered) && Number.isSafeInteger(metric.total));
        if (!metrics.some(metric => metric.total > 0) ||
            (mode !== 'nonzero' ? metrics.some(metric => metric.covered !== 0) : !metrics.some(metric => metric.covered > 0)))
          throw Error('Coverage lifecycle real route did not establish ' + mode + ' collection');
        for (const ref of report.raw_evidence ?? [])
          if (![folder, prepared].some(base => ref.path.startsWith(base + path.sep))) throw Error('Lifecycle native evidence escapes its execution/preparation');
        for (let repeat = 0; repeat < 2; repeat++)
          if (invoke('verify-report', {report: finished.file}, folder, 0, repeat ? output : root).value?.status !== 'valid')
            throw Error('Coverage lifecycle report was not verified');
        oracle(route, [finished.file], report.components, folder, report.status);
        // This proves that recount is independent, rather than echoing the report.
        const tampered = structuredClone(report);
        const metric = tampered.components.flatMap(component => Object.values(component)).find(item =>
          item?.status === 'measured' && Number.isSafeInteger(item.covered) && Number.isSafeInteger(item.total));
        metric.total++;
        const badFile = path.join(folder, 'tampered-report.json');write(badFile, tampered);
        const rejected = invoke('verify-report', {report: badFile}, folder, 2);
        const failure = read(rejected.file + '.failure.json');
        if (!failure.message.startsWith('Coverage native recount mismatch'))
          throw Error('Coverage lifecycle did not independently reject changed metrics');
        const summary = invoke('summarize', {reports: [finished.file], inventory: read(profile.spec.inventory_path)}, folder).value;
        if (!summary?.scopes || !allowedStatus.includes(summary.scopes.project?.status) ||
            !['project', 'changed_files', 'changed_lines'].every(name => ['measured', 'incomplete', 'unavailable'].includes(summary.scopes[name]?.status)))
          throw Error('Coverage lifecycle summary omitted tool-owned scopes');
        checkSources();
        result[mode] = {status: 'passed', report: {path: finished.file, sha256: hash(finished.file)},
          command: session.command, expected_exit_code: expectedExit, metrics_tamper_rejected: true};
      }
      result.aggregates = {};
      for (const [name, modes] of [['zero', ['zero', 'zero_repeat']], ['mixed', ['zero', 'nonzero']]]) {
        const folder = path.join(output, route.id, 'aggregate-' + name);fs.mkdirSync(folder);
        const reports = modes.map(mode => result[mode].report.path);
        const summary = invoke('summarize', {reports, inventory: read(profile.spec.inventory_path)}, folder).value;
        const components = summary?.scopes?.project?.components;
        if (!components?.length) throw Error('Coverage lifecycle merge omitted native project components');
        oracle(route, reports, components, folder, summary.scopes.project.status);checkSources();
        result.aggregates[name] = {status: 'passed', reports};
      }
      routes.push(result);
    }
    const report = {schema: 'coverage-lifecycle-gate-v1', status: 'passed', binding_sha256: lifecycleBinding(profile),
      routes, files: [...artifacts(output), {path: profileFile, sha256: hash(profileFile)}], business_tests: 'not_executed'};
    write(path.join(output, 'lifecycle-gate.json'), report);return report;
  } catch (error) {
    write(path.join(output, 'failure.json'), {status: 'blocked', reason: error.message, routes});
    throw error;
  }
}

// Frozen standalone public protocol. Projects implement only tools/run/read.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual as equal} from 'node:util';
import {assertToolIdentity} from './tools.mjs';
import {assertRecount, evidenceFiles, unchangedEvidence} from './report.mjs';

const [operation, requestFile, output] = process.argv.slice(2);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
let childDiagnostic;
const backendCalls = [];
try {
  if (!['tools', 'verify-preparation', 'run', 'finish', 'verify-report', 'summarize'].includes(operation) || !requestFile || !output)
    throw Error('Expected operation, request JSON path and new response JSON path');
  if (fs.existsSync(output)) throw Error('Coverage response already exists; preserve the previous attempt: ' + output);
  const request = read(requestFile), binding = read(path.join(path.dirname(fileURLToPath(import.meta.url)), 'binding.json'));
  if (binding.schema !== 'project-coverage-backend-v2') throw Error('Invalid project coverage backend binding');
  const aliases = {...(request.artifact_map ?? {})};
  const bound = (file, expected) => {
    const item = aliases[file + '#' + expected] ?? aliases[file];
    if (item) {
      if (expected && item.sha256 !== expected || hash(item.path) !== item.sha256)
        throw Error('Coverage backend artifact missing or changed: ' + file);
      return item.path;
    }
    if (fs.existsSync(file) && fs.statSync(file).isFile() && (!expected || hash(file) === expected)) return file;
    throw Error('Coverage backend artifact missing or changed: ' + file);
  };
  for (const [name, expected] of Object.entries(binding.adapter_files)) {
    const file = path.join(binding.project_root, name);
    aliases[file] = {path: bound(file, expected), sha256: expected};
  }
  const argv = binding.entry.map(item => aliases[item]?.path ?? item);
  const directory = fs.mkdtempSync(path.join(path.dirname(output), '.coverage-backend-'));
  try {
    const invoke = (backendOperation, input) => {
      const index = backendCalls.length, backendRequest = path.join(directory, 'request-' + index + '.json'), response = path.join(directory, 'response-' + index + '.json');
      write(backendRequest, {...input, tools: binding.tools});
      const command = [...argv, backendOperation, backendRequest, response];
      const result = spawnSync(command[0], command.slice(1), {cwd: fs.existsSync(binding.project_root) ? binding.project_root : path.dirname(output), env: {...process.env,...binding.execution_env},
        encoding: 'utf8', ...(backendOperation === 'run' ? {stdio: 'inherit'} : {timeout: 30000, maxBuffer: 32 * 1024 * 1024})});
      childDiagnostic = {operation, backend_operation: backendOperation, command, request: backendRequest,
        exit_code: result.status, signal: result.signal, error: result.error?.message ?? null,
        stdout: result.stdout ?? '', stderr: result.stderr ?? ''};
      backendCalls.push(childDiagnostic);
      if (backendOperation !== 'run') {if (result.stdout) process.stdout.write(result.stdout);if (result.stderr) process.stderr.write(result.stderr);}
      if (result.error || result.signal) throw Error('Coverage backend process failed: ' + JSON.stringify(childDiagnostic));
      if (backendOperation === 'run') return {status: result.status, response};
      if (result.status !== 0) throw Error('Coverage backend rejected ' + backendOperation + ': ' + JSON.stringify(childDiagnostic));
      if (!fs.existsSync(response)) throw Error('Coverage backend omitted response for ' + backendOperation);
      const value = read(response);childDiagnostic.response = value;
      assertToolIdentity(value.tools, binding.tools, 'Actual coverage tool identity');
      return {...value, tools: binding.tools};
    };
    const profileFor = (prepared, digest) => {
      const file = bound(path.join(prepared, 'prepared.json'), digest), profile = read(file);
      assertToolIdentity(profile.tools, binding.tools, 'Prepared coverage tool identity');
      if (binding.revision && profile.spec?.revision !== binding.revision ||
          Object.keys(binding.source_hashes ?? {}).length && !equal(profile.spec?.source_hashes, binding.source_hashes))
        throw Error('Coverage report frozen source binding mismatch');
      for (const [name, digest] of Object.entries(profile.spec?.source_hashes ?? {})) {
        const source = path.resolve(binding.project_root, name);
        if (!source.startsWith(binding.project_root + path.sep)) throw Error('Coverage source escapes the project');
        bound(source, digest);
      }
      for (const [name, digest] of Object.entries(binding.adapter_files))
        if (profile.adapter_files[name] !== digest) throw Error('Prepared coverage backend binding differs: ' + name);
      return profile;
    };
    let toolsVerified = false;
    const verifyTools = () => {if (!toolsVerified) {invoke('tools', {});toolsVerified = true;}};
    const measure = (reports, profile, persist) => {
      verifyTools();
      const nativeOutput = persist ?? path.join(directory, 'read-' + backendCalls.length);
      fs.mkdirSync(nativeOutput);
      const groups = reports.map(report => ({status: report.status, raw_evidence: report.raw_evidence.map(ref =>
        ({...ref, original_path: ref.path, path: bound(ref.path, ref.sha256)}))}));
      const sources = Object.fromEntries(Object.entries(profile.spec.source_hashes).map(([name, digest]) =>
        [name, bound(path.join(binding.project_root, name), digest)]));
      const inventory = profile.spec.inventory_path ? read(bound(profile.spec.inventory_path, profile.spec.inventory_sha256)) : {};
      const value = invoke('read', {groups, sources, project_root: binding.project_root, inventory, output: nativeOutput});
      if (!['measured', 'incomplete'].includes(value.status) || groups.some(group => group.status === 'incomplete') && value.status !== 'incomplete')
        throw Error('Coverage native reader promoted incomplete collection');
      // Also validates the tool-owned metric shapes; no counts are computed.
      assertRecount(value, value);
      if (!value.scopes?.project?.components) throw Error('Coverage native reader omitted project components');
      assertRecount(value, {status: value.scopes.project.status, components: value.scopes.project.components});
      return value;
    };
    const verify = file => {
      const reportFile = bound(file), report = read(reportFile);
      assertToolIdentity(report.tools, binding.tools, 'Coverage report tool identity');
      if (!report.prepared || !report.prepared_sha256) throw Error('Coverage report preparation binding missing');
      const profile = profileFor(report.prepared, report.prepared_sha256);
      if (report.revision !== profile.spec?.revision || !equal(report.source_hashes, profile.spec?.source_hashes))
        throw Error('Coverage report frozen source binding mismatch');
      for (const component of report.components ?? [])
        if (component.source_paths?.some(name => !Object.hasOwn(report.source_hashes, name)))
          throw Error('Coverage report component escapes frozen source scope');
      const snapshots = evidenceFiles(reportFile, report, aliases);
      if (report.collector_response) bound(report.collector_response.path, report.collector_response.sha256);
      let value;
      try {value = measure([report], profile);}
      finally {unchangedEvidence(snapshots);}
      assertRecount(report, value);
      return {report, profile};
    };
    let value;
    if (operation === 'run') {
      const run = invoke('run', request);
      if (fs.existsSync(run.response)) fs.copyFileSync(run.response, output, fs.constants.COPYFILE_EXCL);
      process.exitCode = run.status;
    } else if (operation === 'verify-preparation') {
      profileFor(path.dirname(request.prepared), hash(request.prepared));verifyTools();
      value = {status: 'valid', tools: binding.tools};
    } else if (operation === 'verify-report') {
      verify(request.report);value = {status: 'valid', tools: binding.tools};
    } else if (operation === 'finish') {
      const session = read(request.request), profile = profileFor(session.prepared, session.prepared_sha256);
      if (path.resolve(session.output) !== path.resolve(request.output) || session.cwd !== profile.spec.project_root)
        throw Error('Coverage finish session/output binding mismatch');
      const collectorFile = path.join(session.output, 'run-response.json'), collector = read(collectorFile);
      if (!['complete', 'incomplete'].includes(collector.collection_status) || !equal(collector.exit_code, read(request.receipt).exit_code))
        throw Error('Coverage collector response/exit mismatch');
      for (const ref of collector.raw_evidence ?? [])
        if (!ref.path.startsWith(path.resolve(session.output) + path.sep)) throw Error('Coverage native evidence escapes its execution');
      const snapshots = evidenceFiles(collectorFile, collector, aliases);
      let measured;
      const nativeOutput = path.join(session.output, 'native-report');
      try {measured = measure([{...collector, status: collector.collection_status === 'complete' ? 'measured' : 'incomplete'}], profile, nativeOutput);}
      finally {unchangedEvidence(snapshots);}
      const derived = measured.derived_evidence ?? [];
      for (const ref of derived) {
        if (!ref.path.startsWith(nativeOutput + path.sep)) throw Error('Coverage derived report escapes its output');
        bound(ref.path, ref.sha256);
      }
      value = {schema: 'project-tool-coverage-report-v1', protocol: 'project-coverage-v1',
        prepared: session.prepared, prepared_sha256: session.prepared_sha256,
        scene_id: session.scene_id, revision: profile.spec.revision, source_hashes: profile.spec.source_hashes,
        tools: binding.tools, collection_relation: 'same_run', status: measured.status,
        receipt_path: request.receipt, execution_sha256: hash(request.receipt),
        collector_response: {path: collectorFile, sha256: hash(collectorFile)},
        raw_evidence: [...collector.raw_evidence, ...derived], components: measured.components};
    } else if (operation === 'summarize') {
      if (!Array.isArray(request.reports) || !request.reports.length) throw Error('Coverage summary needs reports');
      const checked = request.reports.map(verify), first = checked[0];
      if (checked.some(item => item.report.prepared_sha256 !== first.report.prepared_sha256 ||
          !equal(item.report.source_hashes, first.report.source_hashes))) throw Error('Incompatible coverage summary reports');
      if (request.inventory && !equal(request.inventory, read(bound(first.profile.spec.inventory_path, first.profile.spec.inventory_sha256))))
        throw Error('Coverage summary inventory differs from frozen preparation');
      const snapshots = Object.assign({}, ...request.reports.map(file => {
        const actual = bound(file);return evidenceFiles(actual, read(actual), aliases);
      }));
      let measured;
      try {measured = measure(checked.map(item => item.report), first.profile);}
      finally {unchangedEvidence(snapshots);}
      if (!measured.scopes || !['project', 'changed_files', 'changed_lines'].every(name =>
        ['measured', 'incomplete', 'unavailable'].includes(measured.scopes[name]?.status)))
        throw Error('Coverage native reader omitted summary scopes');
      value = {tools: binding.tools, scopes: measured.scopes};
    } else value = invoke('tools', request);
    if (value) write(output, value);
    write(output + '.backend.json', {operation, calls: backendCalls});
  } finally {fs.rmSync(directory, {recursive: true});}
} catch (error) {
  const failure = {schema: 'coverage-protocol-error-v1', operation, request: requestFile, response: output,
    message: error.message || error.name, stack: error.stack, ...(childDiagnostic ? {backend: childDiagnostic} : {}), calls: backendCalls};
  if (output && fs.existsSync(path.dirname(output))) {
    const file = output + '.failure.json';if (!fs.existsSync(file)) write(file, failure);
  }
  process.stderr.write(JSON.stringify(failure, null, 2) + '\n');process.exitCode = 2;
}

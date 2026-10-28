// Copied unchanged into the frozen project test tree. No Skill/package dependency.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertToolIdentity} from './tools.mjs';

const [operation, requestFile, output] = process.argv.slice(2);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
let childDiagnostic;
try {
  if (!['tools', 'verify-preparation', 'run', 'finish', 'verify-report', 'summarize'].includes(operation) || !requestFile || !output)
    throw Error('Expected operation, request JSON path and new response JSON path');
  if (fs.existsSync(output)) throw Error('Coverage response already exists; preserve the previous attempt: ' + output);
  const request = read(requestFile), binding = read(path.join(path.dirname(fileURLToPath(import.meta.url)), 'binding.json'));
  if (binding.schema !== 'project-coverage-backend-v1') throw Error('Invalid project coverage backend binding');
  const mapping = request.artifact_map ?? {};
  const bound = (file, expected) => {
    if (fs.existsSync(file) && hash(file) === expected) return file;
    const item = mapping[file + '#' + expected] ?? mapping[file];
    if (!item || item.sha256 !== expected || hash(item.path) !== expected)
      throw Error('Coverage backend artifact missing or changed: ' + file);
    return item.path;
  };
  const aliases = {...mapping};
  for (const [name, expected] of Object.entries(binding.adapter_files)) {
    const file = path.join(binding.project_root, name), actual = bound(file, expected);
    aliases[file] = {path: actual, sha256: expected};
  }
  const argv = binding.entry.map(item => aliases[item]?.path ?? item);
  if (operation === 'verify-preparation') {
    const profile = read(request.prepared);
    assertToolIdentity(profile.tools, binding.tools, 'Prepared coverage tool identity');
    for (const [name, expected] of Object.entries(binding.adapter_files))
      if (profile.adapter_files[name] !== expected) throw Error('Prepared coverage backend binding differs: ' + name);
  }
  const directory = fs.mkdtempSync(path.join(path.dirname(output), '.coverage-backend-'));
  try {
    const backendRequest = path.join(directory, 'request.json'), response = path.join(directory, 'response.json');
    write(backendRequest, {...request, tools: binding.tools, artifact_map: aliases});
    const backendOperation = operation === 'verify-preparation' ? 'tools' : operation;
    const command = [...argv, backendOperation, backendRequest, response];
    const result = spawnSync(command[0], command.slice(1), {cwd: fs.existsSync(binding.project_root) ? binding.project_root : path.dirname(output),
      encoding: 'utf8', ...(operation === 'run' ? {stdio: 'inherit'} : {timeout: 180000, maxBuffer: 32 * 1024 * 1024})});
    childDiagnostic = {operation, backend_operation: backendOperation, command, request: backendRequest,
      exit_code: result.status, signal: result.signal, error: result.error?.message ?? null,
      stdout: result.stdout ?? '', stderr: result.stderr ?? ''};
    if (operation !== 'run') {if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr);}
    if (result.error || result.signal) throw Error('Coverage backend process failed: ' + JSON.stringify(childDiagnostic));
    // A business assertion failure is a real result, not a protocol success.
    if (operation === 'run') {
      if (fs.existsSync(response)) fs.copyFileSync(response, output, fs.constants.COPYFILE_EXCL);
      process.exitCode = result.status;
    } else {
      if (result.status !== 0) throw Error('Coverage backend rejected ' + backendOperation + ': ' + JSON.stringify(childDiagnostic));
      if (!fs.existsSync(response)) throw Error('Coverage backend omitted response for ' + backendOperation);
      const value = read(response);
      if (['tools', 'verify-preparation', 'finish', 'summarize'].includes(operation))
        assertToolIdentity(value.tools, binding.tools, 'Actual coverage tool identity');
      if (operation === 'verify-preparation') write(output, {status: 'valid', tools: binding.tools});
      else write(output, value.tools ? {...value, tools: binding.tools} : value);
    }
  } finally {fs.rmSync(directory, {recursive: true});}
} catch (error) {
  const failure = {schema: 'coverage-protocol-error-v1', operation, request: requestFile, response: output,
    message: error.message || error.name, stack: error.stack, ...(childDiagnostic ? {backend: childDiagnostic} : {})};
  if (output && fs.existsSync(path.dirname(output))) {
    const file = output + '.failure.json';
    if (!fs.existsSync(file)) write(file, failure);
  }
  process.stderr.write(JSON.stringify(failure, null, 2) + '\n');
  process.exitCode = 2;
}

// Inspect real preparation artifacts, independently of the generated backend.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function auditChildNative({proof, python, sources, output}) {
  const value = read(proof), checks = [];
  for (const route of value.routes) {
    const report = read(route.nonzero.report.path), collector = read(report.collector_response.path);
    assert.equal(sha(report.collector_response.path), report.collector_response.sha256);
    const query = {files: collector.raw_evidence.map(ref => {assert.equal(sha(ref.path), ref.sha256);return ref.path;}),
      command: route.nonzero.command, sources};
    const code = `import ast, json, pathlib, sys
import coverage
request = json.load(sys.stdin)
scripts = [pathlib.Path(x) for x in request['command'][1:] if x.endswith('.py') and pathlib.Path(x).is_file()]
assert scripts, 'No actual Python parent script in lifecycle command'
parents = []
for script in scripts:
    text = script.read_text(); tree = ast.parse(text)
    imports = [node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]
    imports += [alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names]
    assert not any(name and (name == 'invoice' or name.startswith('invoice.')) for name in imports), 'Parent imports product internals'
    assert any(isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == 'subprocess' and node.func.attr in ('run', 'Popen', 'call', 'check_call', 'check_output') for node in ast.walk(tree)), 'Parent has no subprocess launch'
    literals = [node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)]
    assert '-m' in literals and 'invoice' in literals and '--input' in literals, 'Parent does not launch the real invoice module'
    parents.append({'path': str(script), 'imports': imports, 'text': text})
snapshots = []
for name in request['files']:
    file = pathlib.Path(name)
    if file.read_bytes()[:16] != b'SQLite format 3\\x00':
        continue
    data = coverage.CoverageData(basename=str(file)); data.read()
    hits = {source: data.lines(source) for source in data.measured_files() if any(source.endswith('/' + item) for item in request['sources']) and data.lines(source)}
    snapshots.append({'path': str(file), 'has_arcs': data.has_arcs(), 'product_hits': hits})
assert len(snapshots) >= 2, 'Separate native parent/child snapshots missing'
assert any(not snap['product_hits'] for snap in snapshots), 'Parent appears to execute product internals'
assert any(all(any(source.endswith('/' + item) for source in snap['product_hits']) for item in request['sources']) for snap in snapshots), 'No child snapshot hits both actual product modules'
print(json.dumps({'status': 'passed', 'coverage_version': coverage.__version__, 'parents': parents, 'snapshots': snapshots}))`;
    const result = spawnSync(python, ['-B', '-c', code], {input: JSON.stringify(query), encoding: 'utf8', timeout: 30000});
    const receipt = {command: [python, '-B', '-c', code], stdin: query, exit_code: result.status,
      stdout: result.stdout, stderr: result.stderr};
    checks.push({route: route.id, receipt, ...(result.status === 0 ? {audit: JSON.parse(result.stdout)} : {})});
    fs.writeFileSync(output, JSON.stringify({status: result.status === 0 ? 'passed' : 'failed', checks}, null, 2) + '\n');
    assert.equal(result.status, 0, result.stderr);
    for (const ref of collector.raw_evidence) assert.equal(sha(ref.path), ref.sha256);
  }
  return {status: 'passed', checks};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = process.argv[2], output = process.argv[3];
  auditChildNative({...read(file), output});console.log('Actual native CLI evidence audit passed: ' + output);
}

import {validArgv} from '../../shared/argv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {toolIdentities} from './tools.mjs';

export function materializeCoverageEntry({workspace, testRoots, attempt, entry, tools, adapterFiles, sourceHashes = {}, revision, executionEnv = {}}) {
  toolIdentities(tools);
  if (tools.some(tool => typeof tool.role !== 'string' || !tool.role.trim())) throw Error('Coverage tool purpose missing');
  if (!validArgv(entry)) throw Error('Coverage backend entry requires an executable and string arguments');
  if (!Object.keys(adapterFiles).length) throw Error('Coverage backend needs frozen project files');
  const root = path.resolve(workspace), testRoot = path.resolve(root, testRoots[0]);
  if (!testRoot.startsWith(root + path.sep) || !fs.realpathSync(testRoot).startsWith(fs.realpathSync(root) + path.sep))
    throw Error('Coverage protocol directory escapes the project test tree');
  const id = createHash('sha256').update(path.resolve(attempt)).digest('hex').slice(0, 20);
  const directory = path.join(testRoot, '.acceptance-coverage', id);
  fs.mkdirSync(path.dirname(directory), {recursive: true});
  if (!fs.realpathSync(path.dirname(directory)).startsWith(fs.realpathSync(testRoot) + path.sep))
    throw Error('Coverage protocol directory resolves outside its test root');
  fs.mkdirSync(directory);
  for (const name of ['entry.mjs', 'tools.mjs', 'report.mjs'])
    fs.copyFileSync(fileURLToPath(new URL(name, import.meta.url)), path.join(directory, name), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(directory, 'binding.json'), JSON.stringify({schema: 'project-coverage-backend-v2',
    project_root: root, entry, tools, adapter_files: adapterFiles, source_hashes: sourceHashes, revision, execution_env: executionEnv}, null, 2) + '\n', {flag: 'wx'});
  return {revision: 2, entry: [process.execPath, path.join(directory, 'entry.mjs')],
    paths: ['entry.mjs', 'tools.mjs', 'report.mjs', 'binding.json'].map(name => path.relative(root, path.join(directory, name)))};
}

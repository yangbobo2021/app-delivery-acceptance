// No bootstrap import here: the preparer uses this probe before marking an install ready.
import {readFileSync, realpathSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const root = dirname(fileURLToPath(import.meta.url));
const modules = realpathSync(join(root, 'node_modules'));
if (relative(root, modules) !== 'node_modules') throw Error('node_modules must be inside this Skill');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const versions = {};
for (const [name, expected] of Object.entries(manifest.dependencies)) {
  const folder = realpathSync(join(modules, name));
  const location = relative(modules, folder);
  if (location.startsWith('..') || location.startsWith('/')) throw Error(`Dependency escapes Skill: ${name}`);
  const installed = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
  if (installed.version !== expected) throw Error(`Dependency version mismatch: ${name}`);
  versions[name] = installed.version;
}
const {createActor} = await import('xstate');
const runtime = await import('@sublang/playbook/xstate-runtime');
const {createWorktreeHostCapabilities} = await import('@sublang/playbook/host-capabilities');
const {CodexAdapter} = await import('@sublang/cligent/adapters/codex');
const {Codex} = await import('@openai/codex-sdk');
if (![createActor, createWorktreeHostCapabilities, CodexAdapter, Codex].every(v => typeof v === 'function') || !Object.keys(runtime).length) {
  throw Error('Required runtime exports are unavailable');
}
const spex = join(modules, '@sublang/spex/dist/cli.js');
const spexHelp = execFileSync(process.execPath, [spex, '--help'], {encoding: 'utf8', timeout: 30000});
if (!spexHelp.includes('scaffold') || !spexHelp.includes('lint')) throw Error('SPEX CLI is unavailable');
const spexVersion = versions['@sublang/spex'];
// Resolve the CLI from the SDK's dependency tree, independently of PATH/global installs.
const sdkEntry = import.meta.resolve('@openai/codex-sdk');
const sdkRequire = createRequire(sdkEntry);
const cliManifest = sdkRequire.resolve('@openai/codex/package.json');
const cliPackage = JSON.parse(readFileSync(cliManifest, 'utf8'));
const codexEntry = join(dirname(cliManifest), cliPackage.bin.codex);
const codexVersion = execFileSync(process.execPath, [codexEntry, '--version'], {encoding: 'utf8', timeout: 30000}).trim();
console.log(JSON.stringify({versions, spexVersion, codexVersion, modules}));

// No bootstrap import here: the preparer uses this probe before marking an install ready.
import {readFileSync, realpathSync} from 'node:fs';
import {dirname, join, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {installedPackage} from './installed.mjs';

const root = fileURLToPath(new URL('..',import.meta.url));
const modules = join(root, 'node_modules');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const cliPaths={};
for(const [name,packageName]of [['playbook','@sublang/playbook'],['spex','@sublang/spex']]){
  const dependency=installedPackage(packageName),declared=typeof dependency.manifest.bin==='string'?dependency.manifest.bin:dependency.manifest.bin?.[name];
  const actual=realpathSync(join(modules,'.bin',name)),expected=realpathSync(join(dependency.root,declared));
  if(!actual.startsWith(realpathSync(modules)+sep)||actual!==expected)throw Error('Package CLI alias resolves outside its verified local dependency tree: '+name);
  cliPaths[name]=actual;
}
const versions = {};
const locked=JSON.parse(readFileSync(join(root,'npm-shrinkwrap.json'),'utf8'));
for (const [name, expected] of Object.entries(manifest.dependencies)) {
  const {manifest:installed} = installedPackage(name);
  if (installed.version !== (expected.startsWith('file:')?locked.packages['node_modules/'+name]?.version:expected)) throw Error(`Dependency version mismatch: ${name}`);
  versions[name] = installed.version;
}
const {createActor} = await import('xstate');
const runtime = await import('@sublang/playbook/xstate-runtime');
const {createWorktreeHostCapabilities} = await import('@sublang/playbook/host-capabilities');
const {CodexAdapter} = await import('@sublang/cligent/adapters/codex');
const {Codex} = await import('@openai/codex-sdk');
const {ClaudeCodeAdapter} = await import('@sublang/cligent/adapters/claude-code');
const {query} = await import('@anthropic-ai/claude-agent-sdk');
const {OpenCodeAdapter} = await import('@sublang/cligent/adapters/opencode');
const {createOpencodeClient} = await import('@opencode-ai/sdk/v2');
const {parse} = await import('smol-toml');
if (![createActor, createWorktreeHostCapabilities, CodexAdapter, Codex, ClaudeCodeAdapter, query, OpenCodeAdapter, createOpencodeClient, parse].every(v => typeof v === 'function') || !Object.keys(runtime).length) {
  throw Error('Required runtime exports are unavailable');
}
const spex = join(installedPackage('@sublang/spex').root, 'dist/cli.js');
const spexHelp = execFileSync(process.execPath, [spex, '--help'], {encoding: 'utf8', timeout: 30000});
if (!spexHelp.includes('scaffold') || !spexHelp.includes('lint')) throw Error('SPEX CLI is unavailable');
const spexVersion = versions['@sublang/spex'];
// Resolve the CLI from the SDK's dependency tree, independently of PATH/global installs.
const sdkEntry = import.meta.resolve('@openai/codex-sdk');
const sdkRequire = createRequire(sdkEntry);
const cliManifest = sdkRequire.resolve('@openai/codex/package.json');
const cliPackage = JSON.parse(readFileSync(cliManifest, 'utf8'));
const codexEntry = join(dirname(cliManifest), cliPackage.bin.codex);
const selectedAgent=process.env.ACCEPTANCE_AGENT;
if (selectedAgent&&!['codex','claude-code','opencode'].includes(selectedAgent)) throw Error('Unknown ACCEPTANCE_AGENT');
const codexVersion = selectedAgent==='codex' ? execFileSync(process.execPath, [codexEntry, '--version'], {encoding: 'utf8', timeout: 30000}).trim() : null;
let claudeVersion=null;
if (selectedAgent==='claude-code') {
  const musl=process.platform==='linux'&&!process.report.getReport().header.glibcVersionRuntime;
  const binary=join(installedPackage(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${musl?'-musl':''}`).root,'claude');
  claudeVersion=execFileSync(binary,['--version'],{encoding:'utf8',timeout:30000}).trim();
}
const opencodeVersion=selectedAgent==='opencode'?execFileSync('opencode',['--version'],{encoding:'utf8',timeout:30000}).trim():null;
console.log(JSON.stringify({versions, spexVersion, codexVersion, claudeVersion, opencodeVersion, selectedAgent:selectedAgent??null, modules,cliPaths}));

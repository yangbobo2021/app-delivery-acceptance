import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const candidates = [process.env.PLAYBOOK_PACKAGE_ROOT,
  resolve('node_modules/@sublang/playbook'),
  resolve(dirname(fileURLToPath(import.meta.url)),'node_modules/@sublang/playbook')].filter(Boolean);
let resolvedRoot = candidates.find(p => existsSync(join(p, 'package.json')));
if (!resolvedRoot) {
  try {const globalRoot=join(execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), '@sublang/playbook');
    if (existsSync(join(globalRoot, 'package.json'))) resolvedRoot=globalRoot;
  } catch {}
}
export const playbookRoot = resolvedRoot;
if (!playbookRoot) throw Error('Install @sublang/playbook 16 or set PLAYBOOK_PACKAGE_ROOT');
const require = createRequire(join(playbookRoot, 'package.json'));
export const xstate = require('xstate');
export const runtime = await import(pathToFileURL(join(playbookRoot, 'src/xstate-runtime.js')).href);
export const hostCapabilities = await import(pathToFileURL(join(playbookRoot, 'reference/sdlc/code.playbook/host-capabilities.js')).href);
export const cligent = await import(pathToFileURL(join(playbookRoot, 'node_modules/@sublang/cligent/dist/adapters/codex.js')).href);

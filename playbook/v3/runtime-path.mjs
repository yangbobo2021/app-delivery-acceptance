import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const skillRoot = fileURLToPath(new URL('../../', import.meta.url));
// Prepare before dynamic imports. Static external imports would fail before bootstrap runs.
execFileSync('python3', [join(skillRoot, 'scripts/ensure_runtime.py'), '--node', process.execPath], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
export const playbookRoot = dirname(dirname(fileURLToPath(import.meta.resolve('@sublang/playbook/xstate-runtime'))));
export const xstate = await import('xstate');
export const runtime = await import('@sublang/playbook/xstate-runtime');
export const hostCapabilities = await import('@sublang/playbook/host-capabilities');
export const cligent = await import('@sublang/cligent/adapters/codex');

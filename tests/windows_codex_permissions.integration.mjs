import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

// Live transport acceptance, separate from acceptance business orchestration.
// Run explicitly on Windows with real credentials and the selected model.
async function main() {
  if (process.platform !== 'win32') {
    console.log('not applicable: native Windows Codex permission acceptance');
    return;
  }
  const model = process.env.ACCEPTANCE_WINDOWS_CODEX_TEST_MODEL;
  assert.ok(model, 'Set ACCEPTANCE_WINDOWS_CODEX_TEST_MODEL to the actual selected model');
  const packageRoot = process.env.ACCEPTANCE_TEST_PACKAGE_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/en/app-delivery-acceptance/playbooks/acceptance');
  const require = createRequire(path.join(packageRoot, 'package.json'));
  const {CodexAdapter} = await import(pathToFileURL(require.resolve('@sublang/cligent/adapters/codex')));
  const {locateAgentExecutable} = await import(pathToFileURL(require.resolve('@sublang/cligent')));
  const executable = locateAgentExecutable('codex');
  assert.equal(executable.state, 'present');
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-windows-command-')));
  const nonce = 'READ_' + randomUUID();
  const readFile = path.join(fixture, 'read.txt');
  fs.writeFileSync(readFile, nonce + '\n', {flag: 'wx'});
  const digest = () => createHash('sha256').update(fs.readFileSync(readFile)).digest('hex');
  const before = digest();
  const permissions = {fileWrite: 'deny', shellExecute: 'allow', networkAccess: 'deny'};
  const events = [];
  let done;
  try {
    for await (const event of new CodexAdapter().run('Read read.txt using an actual command. Do not write files or request escalation. Return the exact contents actually read, or the actual error.', {
      cwd: fixture, model, effort: 'low', permissions, nativeSkills: false,
      abortSignal: AbortSignal.timeout(120_000),
    })) {
      if (!event.type.includes('thinking')) events.push(event);
      if (event.type === 'done') done = event.payload;
    }
    assert.equal(done?.status, 'success');
    const read = events.find(event => event.type === 'tool_result' && event.payload?.status === 'success' && event.payload.output?.exit_code === 0 && event.payload.output.aggregated_output?.trim() === nonce);
    assert.ok(read, 'The actual command must read the unpredictable fixture bytes');
    assert.equal(digest(), before);
    const args = ['-c', 'features.prefer_mxc=true', 'sandbox', '--permission-profile', ':read-only', '-C', fixture, '--', 'cmd.exe', '/d', '/c', 'echo NO> denied.txt'];
    const denied = spawnSync(executable.path, args, {cwd: fixture, encoding: 'utf8', timeout: 60_000, windowsHide: true});
    assert.ifError(denied.error);
    assert.notEqual(denied.status, 0, 'The native read-only boundary must reject writes');
    assert.equal(fs.existsSync(path.join(fixture, 'denied.txt')), false);
    assert.deepEqual(fs.readdirSync(fixture), ['read.txt']);
    fs.writeFileSync(path.join(fixture, 'receipt.json'), JSON.stringify({status: 'passed', model, permissions, executable: executable.path, before, after: digest(), events, denied: {exit_code: denied.status, stdout: denied.stdout, stderr: denied.stderr}}, null, 2));
    console.log(JSON.stringify({status: 'passed', fixture, realRead: true, nativeWriteRejected: true, permissionsRetained: true}));
  } catch (error) {
    fs.writeFileSync(path.join(fixture, 'failure.json'), JSON.stringify({error: String(error), model, permissions, events}, null, 2));
    throw error;
  }
}
await main();

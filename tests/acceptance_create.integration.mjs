import {current,lifecycleLock} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/store.mjs';
import {validateStore} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/shared/validation.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createAcceptance } from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';

const skill = process.env.ACCEPTANCE_PACKAGE_ROOT ?? fileURLToPath(new URL('../skills/en/app-delivery-acceptance/playbooks/acceptance/', import.meta.url));
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const output = option('--output');
const evidence = output ? path.resolve(output) : fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-create-evidence-'));
fs.mkdirSync(evidence, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-create-test-'));
const results = [], commands = [];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n');
function project(name) { const root = path.join(temporary, name); fs.mkdirSync(root); return root; }
function request(root, id = 'AT-create', requestId = 'request-' + path.basename(root)) {
  return { project_root: root, acceptance_id: id, request_id: requestId, user_request: '新建一个交付测试' };
}
function snapshot(root) {
  const found = {};
  function visit(folder) { for (const name of fs.readdirSync(folder).sort()) {
    const file = path.join(folder, name), stat = fs.lstatSync(file), relative = path.relative(root, file);
    if (stat.isDirectory()) visit(file);
    else found[relative] = stat.isSymbolicLink() ? 'symlink:' + fs.readlinkSync(file) : sha(fs.readFileSync(file));
  } }
  visit(root); return found;
}
function command(label, executable, argv, settings = {}) {
  const started = new Date().toISOString();
  const run = spawnSync(executable, argv, { encoding: 'utf8', timeout: 90000, ...settings });
  const receipt = { label, executable, argv, cwd: settings.cwd ?? process.cwd(),
    stdin: settings.input ?? null, started_at: started, finished_at: new Date().toISOString(),
    exit_code: run.status, signal: run.signal, stdout: run.stdout, stderr: run.stderr,
    error: run.error?.message ?? null };
  commands.push(receipt); save('commands.json', commands);
  return receipt;
}

function test(id, purpose, body) {
  try { const detail = body() ?? {}; results.push({ id, purpose, status: 'passed', ...detail }); }
  catch (error) { results.push({ id, purpose, status: 'failed', error: error.stack }); process.exitCode = 1; }
  save('results.json', { temporary, results });
  console.log(results.at(-1).status + ' ' + id + ' ' + purpose);
}

const root = project('empty-project'), input = request(root), before = snapshot(root);
let created;
test('CREATE-01', '空项目仅创建六个约定文件，不建立范围、定义、场景或测试', () => {
  created = createAcceptance(input);
  assert.equal(created.status, 'created');
  assert.equal(created.stopped_after, 'create');
  const after = snapshot(root);
  assert.deepEqual(Object.keys(after).sort(), [
    '.gitignore', '.acceptance/knowledge/INDEX.md', '.acceptance/AT-create/manifest.json',
    '.acceptance/AT-create/creation.json', '.acceptance-local/current.json',
    '.acceptance-local/AT-create/creation-result.json',
  ].sort());
  assert.equal(read(path.join(root, '.acceptance-local/current.json')).acceptance_id, 'AT-create');
  assert.equal(read(path.join(created.shared, 'creation.json')).user_request, input.user_request);
  assert.equal(created.scope_status, 'not_defined');
  save('create-before.json', before); save('create-after.json', after); save('create-receipt.json', created);
  return { input, output: created, before, after };
});
test('CREATE-02', '同请求重复调用保持文件字节和 AT 不变', () => {
  const before = snapshot(root), again = createAcceptance(input);
  assert.equal(again.status, 'already_created'); assert.deepEqual(snapshot(root), before);
  return { output: again.status, files_unchanged: true };
});
test('CREATE-03', '另一活动 AT 与同 ID 参数冲突均拒绝且不改文件', () => {
  const before = snapshot(root);
  assert.throws(() => createAcceptance(request(root, 'AT-other')), /current acceptance/);
  assert.throws(() => createAcceptance({ ...input, title: 'changed' }), /conflicts/);
  assert.deepEqual(snapshot(root), before);
});
test('CREATE-04', '只创建的容器可读取和检查，但依赖范围的严格门禁阻塞', () => {
  assert.equal(current(root),input.acceptance_id);
  assert.equal(validateStore(root,input.acceptance_id,{requireScope:false}).scope,null);
  assert.throws(()=>validateStore(root,input.acceptance_id),/no scope snapshot/);
});
test('CREATE-05','在同一 AT 补充真实需求冻结，不隐式生成场景',()=>{
 const frozen=freezeAcceptance({project_root:root,acceptance_id:input.acceptance_id,request_id:'follow-up',base_definitions_sha256:null,basis:'用户随后明确要求冻结此需求',definitions:{context:{business_goal:'验证先创建后冻结'},requirements:[{id:'R-create-followup',text:'用户随后可以在同一验收中冻结真实需求。',origin:{kind:'integration-fixture',reference:'follow-up:user'},external_refs:[]}]}});
 assert.equal(frozen.scope.version,1);validateStore(root,input.acceptance_id);assert.deepEqual(read(path.join(created.shared,'scenarios.json')).scenarios,[]);assert.equal(current(root),input.acceptance_id);
 const before=snapshot(root),again=createAcceptance(input);assert.equal(again.status,'already_created');assert.equal(again.scope_status,'defined');assert.deepEqual(snapshot(root),before);
});
test('CREATE-06', '已有 Git 忽略规则、知识内容及产品文件保持不变', () => {
  const root = project('git-project');
  command('git-init-fixture', 'git', ['init', '-q', root]);
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n.acceptance-local/\n');
  fs.writeFileSync(path.join(root, 'product.txt'), 'original product\n');
  fs.mkdirSync(path.join(root, '.acceptance/knowledge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.acceptance/knowledge/INDEX.md'), '# 已有项目知识\n');
  const before = snapshot(root); createAcceptance(request(root)); const after = snapshot(root);
  for (const name of Object.keys(before)) assert.equal(after[name], before[name], name);
  const ignore = command('verify-git-ignore', 'git', ['check-ignore', '--no-index', '.acceptance-local/current.json'], { cwd: root });
  assert.equal(ignore.exit_code, 0);
});
test('CREATE-07', '资料根的子目录被拒绝，拒绝前不创建锁或资料', () => {
  const nested = path.join(root, 'nested'); fs.mkdirSync(nested);
  assert.throws(() => createAcceptance(request(nested)), /belongs to user project root/);
  assert.deepEqual(snapshot(nested), {});
});
test('CREATE-08', '符号链接资料路径被拒绝，外部文件不被改写', () => {
  const root = project('symlink-project'), other = project('external');
  fs.writeFileSync(path.join(other, 'sentinel'), 'keep'); fs.symlinkSync(other, path.join(root, '.acceptance-local'));
  const before = snapshot(other);
  assert.throws(() => createAcceptance(request(root)), /symlink/);
  assert.deepEqual(snapshot(other), before);
});
test('CREATE-09', '身份文件损坏或未完成容器不能被重复创建掩盖', () => {
  const root = project('tampered-project'), req = request(root); const result = createAcceptance(req);
  fs.appendFileSync(path.join(result.shared, 'manifest.json'), ' '); const before = snapshot(root);
  assert.throws(() => createAcceptance(req), /identity changed/); assert.deepEqual(snapshot(root), before);
  const partial = project('partial-project'); fs.mkdirSync(path.join(partial, '.acceptance/AT-create'), { recursive: true });
  assert.throws(() => createAcceptance(request(partial)), /already exists/);
  assert.ok(!fs.existsSync(path.join(partial, '.acceptance-local/current.json')));
});
test('CREATE-10','生命周期互斥拒绝重入，不能自动删除状态不明的锁',()=>{
 const root=project('locked-project'),req=request(root);fs.mkdirSync(path.join(root,'.acceptance-local'),{recursive:true});
 lifecycleLock(root,()=>assert.throws(()=>createAcceptance(req),/lifecycle is busy/));assert.ok(!fs.existsSync(path.join(root,'.acceptance/AT-create')));
 const lock=path.join(root,'.acceptance-local/current.lock.d');fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner.json'),'{"pid":99999999}');assert.throws(()=>createAcceptance(req),/lifecycle is busy/);assert.ok(fs.existsSync(path.join(lock,'owner.json')));
});
test('CREATE-11', '不接受额外 scope 参数或非法身份，不产生资料', () => {
  const root = project('invalid-project');
  assert.throws(() => createAcceptance({ ...request(root), scope: { targets: ['R1'] } }), /unknown create-only field/);
  assert.throws(() => createAcceptance(request(root, '../escape')), /stable AT/);
  assert.deepEqual(snapshot(root), {});
});
test('CREATE-12', '真实 Git linked worktree 不能成为验收资料根', () => {
  const source = project('git-source'), checkout = path.join(temporary, 'linked-worktree');
  assert.equal(command('init-worktree-source', 'git', ['init', '-q', source]).exit_code, 0);
  assert.equal(command('fixture-empty-commit', 'git', ['-C', source, '-c', 'user.name=Integration Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']).exit_code, 0);
  assert.equal(command('fixture-worktree-add', 'git', ['-C', source, 'worktree', 'add', '--detach', checkout]).exit_code, 0);
  const before = snapshot(checkout);
  assert.throws(() => createAcceptance(request(checkout)), /isolated Git worktree/);
  assert.deepEqual(snapshot(checkout), before);
});

if (args.includes('--live-cli')) {
  const spex = path.join(temporary, 'cli-spex'); fs.mkdirSync(path.join(spex, 'config'), { recursive: true });
  const sessions = path.join(temporary, 'cli-sessions');
  const config = { captain: { adapter: 'codex', model: process.env.ACCEPTANCE_MODEL??'gpt-6.1-sol', ...(process.env.ACCEPTANCE_EFFORT?{effort:process.env.ACCEPTANCE_EFFORT}:{}) }, players: {},
    playbooks: { 'acceptance-create': { from: path.join(skill, 'workflows/create/registry.mjs'), roles: {} } }, sessions };
  fs.writeFileSync(path.join(spex, 'config/playbook.config.yaml'), JSON.stringify(config));
  save('live-cli-config.json', config);
  const root = project('live-cli-project'), input = request(root, 'AT-live-cli');
  const cli = path.join(skill, 'node_modules/@sublang/playbook/reference/sdlc/code.playbook/bin/playbook.js');
  function run(request, label) {
    const receipt = command(label, process.execPath, [cli, 'run', '--no-provision', '--json'],
      { cwd: root, env: { ...process.env, SPEX_HOME: spex }, input: '/acceptance-create ' + JSON.stringify(request) });
    assert.equal(receipt.exit_code, 0, receipt.stderr);
    const envelope = JSON.parse(receipt.stdout);
    const recordFile = path.join(sessions, envelope.sessionId + '.json');
    const replay = command(label+'-official-replay',process.execPath,[path.join(fileURLToPath(new URL('.',import.meta.url)), 'read_official_session.mjs'),sessions,envelope.sessionId]);
    assert.equal(replay.exit_code,0,replay.stderr);
    const records = JSON.parse(replay.stdout);
    const trace = records.filter(r => r.type === 'captain_telemetry').map(r => r.payload);
    save(label + '-session-records.json', records);
    return { envelope, trace, recordFile, command: receipt };
  }
  test('CREATE-13', '真实官方 Playbook CLI 进入注册工作流、创建文件并终止', () => {
    const before = snapshot(root), result = run(input, 'live-create');
    const receipt = read(path.join(root, '.acceptance-local/AT-live-cli/creation-result.json'));
    assert.equal(receipt.status, 'created'); assert.equal(receipt.scope_status, 'not_defined');
    const terminal = result.trace.find(t => t.playbookId === 'acceptance-create' && t.type === 'boss.input.settled');
    assert.ok(terminal, 'workflow settled trace missing');
    assert.ok(result.trace.some(t => t.playbookId === 'acceptance-create' && t.type === 'fsm.transition' && t.payload.to === 'created'));
    const after = snapshot(root); assert.equal(Object.keys(after).length, 6);
    save('live-before.json', before); save('live-after.json', after); save('live-creation-receipt.json', receipt);
    return { input, output: result.envelope, before, after,
      captain_calls: result.trace.filter(t => t.type === 'captain.call.started').length,
      player_calls: result.trace.filter(t => t.type === 'player.call.started').length };
  });
  test('CREATE-14', '真实 CLI 重试同一请求不重写文件', () => {
    const before = snapshot(root), result = run(input, 'live-idempotent');
    assert.deepEqual(snapshot(root), before);
    assert.ok(result.trace.some(t => t.playbookId === 'acceptance-create' && t.type === 'status.emitted' && t.payload.message.includes('already_created')));
    return { output: result.envelope, files_unchanged: true };
  });
  test('CREATE-15', '真实 CLI 冲突进入 blocked 终态；exit 0 不等于业务成功', () => {
    const before = snapshot(root), result = run(request(root, 'AT-conflicting', 'new-request'), 'live-conflict');
    assert.deepEqual(snapshot(root), before);
    assert.ok(result.trace.some(t => t.playbookId === 'acceptance-create' && t.type === 'fsm.transition' && t.payload.to === 'blocked'));
    return { output: result.envelope, expected_workflow_result: 'blocked', cli_exit_code: result.command.exit_code, files_unchanged: true };
  });
}

save('summary.json', { temporary, evidence, mode: args.includes('--live-cli') ? 'real-cli-and-deterministic-integration' : 'deterministic-integration',
  passed: results.filter(x => x.status === 'passed').length, failed: results.filter(x => x.status === 'failed').length,
  results, source: { skill, cli_version: '18.1.0', files: Object.fromEntries([
    'workflows/create/initialize.mjs', 'workflows/create/registry.mjs',
    'tests/acceptance_create.integration.mjs',
  ].map(name => [name, sha(fs.readFileSync(name.startsWith('tests/')?path.join(fileURLToPath(new URL('.',import.meta.url)),name.slice(6)):path.join(skill,name)))])) },
  limits: 'No business case execution, no product verdict, no migration of other workflow stages; CLI live tests use the real configured Codex service.' });
console.log('Evidence: ' + evidence);

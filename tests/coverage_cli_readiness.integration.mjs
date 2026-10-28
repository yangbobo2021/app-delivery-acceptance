// One real preparation workflow against the original comparison product.
// Runtime/freeze/inventory are deterministic setup, not business acceptance.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {harness, read, sha, snapshot} from './official_workflow_harness.mjs';
import {createAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/create/initialize.mjs';
import {freezeAcceptance} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/freeze/registry.mjs';
import {prepare, finalize} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/runtime/stage.mjs';
import {buildInventory} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/reverse/protocol.mjs';
import {prepareCoverage} from '../skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/coverage/stage.mjs';
const args = process.argv.slice(2), option = key => args[args.indexOf(key) + 1];
assert.ok(args.includes('--live-cli') && args.includes('--bundle') && args.includes('--python'));
const h = harness('coverage-cli-readiness', [['acceptance-coverage-prepare', 'coverage']]);
// Preserve the invoked interpreter: resolving a venv symlink changes sys.prefix.
const root = h.project('original-product'), python = path.resolve(option('--python'));
const revision = 'be952659c7d93018e26793daf2e58fa8321601f4', at = 'AT-cli-readiness';
assert.equal(h.run('clone-preserved-product', 'git', ['clone', '-q', path.resolve(option('--bundle')), root]).exit_code, 0);
assert.equal(h.run('checkout-frozen-product', 'git', ['-C', root, 'checkout', '-q', '--detach', revision]).exit_code, 0);
const baseline = snapshot(path.join(root, 'projects/python-cli'));
createAcceptance({project_root: root, acceptance_id: at, request_id: 'create', user_request: '只验证原 CSV CLI 项目覆盖率准备，不执行业务验收。'});
freezeAcceptance({project_root: root, acceptance_id: at, request_id: 'freeze', base_definitions_sha256: null,
  basis: '有界验证采集链，禁止业务验收及源文件修复。', definitions: {context: {business_goal: '验证真实 CLI 子进程的准备链路。'},
    requirements: [{id: 'R1', text: 'CLI 可以读取 CSV 并输出计算结果。', origin: {kind: 'fixture-user', reference: 'bounded-cli-readiness'}, external_refs: []}]}});
const local = path.join(root, '.acceptance-local', at), definitions = path.join(root, '.acceptance', at, 'scenarios.json');
const files = ['__init__.py', '__main__.py', 'totals.py'].map(file => 'projects/python-cli/invoice/' + file);
const runtime = prepare({project_root: root, acceptance_id: at, request_id: 'runtime', definitions_sha256: sha(definitions),
  source_checkout: root, revision, test_roots: ['projects/python-cli/tests'],
  inspection_files: ['projects/python-cli/README.md', ...files], available_executables: [{name: 'python', path: python}]});
const readyRuntime = finalize(runtime, JSON.stringify({dependency_files: [], knowledge_used: ['INDEX.md'],
  execution_env: {PYTHONDONTWRITEBYTECODE:'1'},
  setup_commands: [{command: [python, '-c', 'from pathlib import Path; Path("projects/python-cli/tests").mkdir(exist_ok=True)']}],
  executables: [{name: 'python', path: python, version_command: [python, '--version']}],
  smoke: {command: [python, '-B', '-m', 'invoice', '--help'], env: {PYTHONPATH: '{workspace}/projects/python-cli'}},
  recipe_candidate: '# Isolated CLI readiness fixture\nUse the existing project interpreter with coverage.py. Create only the isolated test root. Check the real invoice module help through PYTHONPATH. Do not run business tests or modify product sources.'}));
h.save('fixture-runtime.json', {boundary: 'Deterministic test setup; only coverage preparation uses a real model role.', readyRuntime});
const inventoryFile = path.join(local, 'workflows/inventory.json');
const inventory = buildInventory({project_root: readyRuntime.workspace, base_revision: revision, head_revision: revision,
  requirements: {items: []}, pr_requirement_ids: [], test_modes: ['BLACK_BOX'], source_paths: files, test_paths: [], noncode_paths: []});
fs.writeFileSync(inventoryFile, JSON.stringify(inventory, null, 2) + '\n');
const instructions = '只准备，不执行业务场景。后续测试进程是一个 Python 父进程，通过 subprocess.run([sys.executable, "-B", "-m", "invoice", "--input", CSV路径], env=...) 启动真正的 invoice CLI 子进程。请依据实际 README/源码确认 CLI 参数。覆盖率准备必须验证这个真实父→子进程路由，非零探针用最小合法 CSV；父进程禁止 import invoice 或调用产品内部函数来补覆盖。为每进程保存原始快照，独立工具应能确认子进程确实命中了 __main__.py/totals.py。零探针不得运行产品。只在冻结测试根内添加脚本/配置，不改产品或依赖清单。';
const input = {project_root: root, acceptance_id: at, request_id: 'prepare-child-cli', definitions_sha256: sha(definitions),
  policy: 'required', basis: '用户要求先修复并短测原失败拓扑，不进行完整重跑。', preparation_instructions: instructions,
  runtime_manifest: readyRuntime.runtime.manifest, runtime_sha256: readyRuntime.runtime.sha256,
  inventory_path: inventoryFile, inventory_sha256: sha(inventoryFile), source_hashes: inventory.source_hashes,
  test_roots: ['projects/python-cli/tests'], expected_measured_sources: files.filter(file => !file.endsWith('__init__.py'))};
h.save('input.json', input);
let result;
h.test('CLI-READINESS-01', '真实官方 CLI 准备原 CSV 产品的父→CLI 子进程覆盖率并通过全部收尾核验', () => {
  const cli = h.cli('acceptance-coverage-prepare', input, 'real-child-cli', root, {timeout: 1000000});
  h.settled(cli, 'acceptance-coverage-prepare', 'done');
  result = read(path.join(local, 'workflows/coverage/prepare-child-cli/result.json'));
  h.save('actual-result.json', result);assert.equal(result.status, 'ready');
  assert.equal(result.business_tests, 'not_executed');
  const profile = read(path.join(result.coverage.prepared, 'prepared.json')), proof = read(profile.spec.lifecycle_report);
  h.save('profile.json', profile);h.save('lifecycle-proof.json', proof);
  assert.equal(proof.status, 'passed');
  const frozen = read(path.join(local, 'workflows/coverage/prepare-child-cli/request.frozen.json'));
  assert.equal(frozen.preparation_instructions, instructions);
  const metrics = read(path.join(local, 'workflows/coverage/prepare-child-cli/preparation/metrics.json'));
  assert.equal(metrics.model, 'gpt-6-sol');assert.equal(metrics.effort, 'high');h.save('actual-role-metrics.json', metrics);
  assert.equal(sha(definitions), input.definitions_sha256);
  for (const [name, digest] of Object.entries(inventory.source_hashes)) assert.equal(sha(path.join(readyRuntime.workspace, name)), digest);
  // Preserve the actual generated code and original data for external audit.
  fs.cpSync(path.join(readyRuntime.workspace, 'projects/python-cli'), path.join(h.output, 'project-snapshot'), {recursive: true});
});
if (result?.status === 'ready') {
  const reused = await prepareCoverage(input);
  h.test('CLI-READINESS-02', '相同请求复用冻结准备，产品目录与原始 Git 基线保持一致', () => {
    assert.equal(reused.status, 'ready');assert.equal(reused.current_binding_verified, true);
    assert.deepEqual(snapshot(path.join(root, 'projects/python-cli')), baseline);
  });
}
h.finish(['workflows/coverage/stage.mjs', 'workflows/coverage/protocol/lifecycle.mjs', 'tests/coverage_cli_readiness.integration.mjs']);

/** Independent coverage-preparation Agent; project choices are checked by Python gates. */
import {readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, realpathSync, copyFileSync} from 'node:fs';
import {resolve, join, relative, isAbsolute, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createAgentRuntime} from '../v3/runtime-path.mjs';
import {acceptanceGuard, knowledgeContext} from '../acceptance-guard.mjs';

const [requestArg, outputArg] = process.argv.slice(2);
if (!requestArg || !outputArg) throw Error('usage: node run_coverage_preparation.mjs request.json new-output-dir');
const requestPath = resolve(requestArg), output = resolve(outputArg);
const request = JSON.parse(readFileSync(requestPath));
if (request.schema !== 'project-coverage-agent-request-v1') throw Error('Invalid coverage Agent request');
if (existsSync(output)) throw Error('Coverage output already exists; use a new workflow attempt');
for (const name of ['inventory_path', 'registry_path']) {
  if (typeof request[name] !== 'string' || !isAbsolute(request[name]))
    throw Error(`Coverage ${name} must be an absolute path usable from every execution directory`);
}
const runtimePath = resolve(request.runtime_manifest);
const runtimeBytes = readFileSync(runtimePath);
const hash = value => createHash('sha256').update(value).digest('hex');
if (hash(runtimeBytes) !== request.runtime_sha256) throw Error('Runtime manifest changed');
const runtime = JSON.parse(runtimeBytes);
if (!request.acceptance) throw Error('Coverage Agent needs a fresh read-knowledge acceptance binding');
for (const key of ['project_root', 'id', 'scope_sha256']) {
  if (request.acceptance[key] !== runtime.acceptance[key]) throw Error('Coverage runtime belongs to another acceptance/scope');
}
const binding = acceptanceGuard({acceptance: request.acceptance, source_checkout: runtime.workspace,
  test_roots: request.test_roots}, [output, dirname(resolve(request.registry_path))]);
const script = resolve(new URL('coverage_preparation.py', import.meta.url).pathname);
const runtimeCheck = resolve(new URL('../../scripts/runtime_preparation.py', import.meta.url).pathname);
const protocolGuide = resolve(new URL('../../references/project-coverage-protocol.md', import.meta.url).pathname);
const check = (program, args, stdout, stderr) => {
  const child = spawnSync(program, args, {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
  writeFileSync(stdout, child.stdout ?? ''); writeFileSync(stderr, child.stderr ?? '');
  if (child.status !== 0) throw Error(`Coverage stage gate failed (${child.status}): ${(child.stderr ?? '').slice(-1600)}`);
  return child;
};
const sourceHashes = request.source_hashes;
if (!sourceHashes || !Object.keys(sourceHashes).length) throw Error('Coverage request source inventory missing');
const expectedMeasuredSources = request.expected_measured_sources ?? [];
if (!Array.isArray(expectedMeasuredSources) ||
    expectedMeasuredSources.some(name => typeof name !== 'string' || !(name in sourceHashes)) ||
    new Set(expectedMeasuredSources).size !== expectedMeasuredSources.length)
  throw Error('Coverage expected_measured_sources must name distinct frozen source files');
if (!request.inventory_sha256 || hash(readFileSync(request.inventory_path)) !== request.inventory_sha256)
  throw Error('Coverage request scope inventory changed');
const gitHead = () => {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: runtime.workspace, encoding: 'utf8'});
  if (result.status !== 0) throw Error('Cannot read coverage project revision');
  return result.stdout.trim();
};
const verifyProduct = () => {
  if (gitHead() !== runtime.revision) throw Error('Coverage Agent changed product revision');
  if (hash(readFileSync(request.inventory_path)) !== request.inventory_sha256) throw Error('Coverage Agent changed scope inventory');
  for (const [name, digest] of Object.entries(sourceHashes)) {
    if (isAbsolute(name) || name.split('/').includes('..')) throw Error('Source path escapes project');
    const path = resolve(runtime.workspace, name);
    if (!relative(runtime.workspace, path) || relative(runtime.workspace, path).startsWith('..') || hash(readFileSync(path)) !== digest)
      throw Error('Coverage Agent changed frozen product source: ' + name);
  }
};
mkdirSync(output, {recursive: false});
check('python3', [runtimeCheck, 'verify', runtimePath], join(output, 'runtime-verify.stdout'), join(output, 'runtime-verify.stderr'));
if (request.workspace && resolve(request.workspace) !== resolve(runtime.workspace)) throw Error('Coverage request workspace differs from runtime');
if (request.revision && request.revision !== runtime.revision) throw Error('Coverage request revision differs from runtime');
verifyProduct();
const knowledge = knowledgeContext(binding);
const prompt = `你是独立的覆盖率准备 Agent。你的输入是**已经验证的本次验收运行环境**。只负责使后续测试用例可以复用可靠覆盖率采集；不要生成或执行任何业务验收场景，不要修改产品逻辑或制造覆盖率数字。先读取项目既有测试入口、现有测试文件、依赖清单、进程/构建路径和项目验收知识，再选择成熟的项目适用工具。覆盖率可选时此 Agent 才会运行。

项目工作区：${runtime.workspace}
运行环境 manifest：${runtimePath}，SHA256：${request.runtime_sha256}
运行环境执行器：${JSON.stringify(runtime.executables)}
项目覆盖率输入：${JSON.stringify(request)}
本次项目明确预期能采集的源码：${JSON.stringify(expectedMeasuredSources)}。这是项目目标，不是所有项目的通用覆盖率配额。先检查已有适配器为什么没达到这些目标，再尝试项目适用的替代采集/映射方法；零命中、定向命中和独立读取都须证明这些文件的真实分母与命中。还须轻量验证采集未发生时的状态传播：没有实际原生快照的来源不得把零基线标为实测 0%，收尾失败不能冒充完整采集；记录失败路径证据。不能因为第一次方案失败便停止探索并把目标文件标成 unsupported。若充分尝试后仍无法证明，就如实标 unsupported、保留失败证据和具体限制，不能声称本项目目标已完成。不要改动 partial 的通用含义。
适用项目知识：${JSON.stringify(knowledge)}
本次候选 SKILL 的覆盖率协议（优先于机器上另一个已安装版本）：${readFileSync(protocolGuide, 'utf8')}
本次实际调用的 SKILL 根目录：${resolve(new URL('../..', import.meta.url).pathname)}。宿主探针脚本：${script}。只按这份候选 SKILL 的协议与脚本准备；不要另找机器上同名的已安装 SKILL。
已保留的前次失败尝试（只读检查其错误收据和项目适配器快照，不能覆盖）：${JSON.stringify(request.prior_attempts ?? [])}
交付给宿主的 entry 必须能对本阶段新建的 project-coverage-preparation-v1 profile 执行 verify-preparation、run、finish、verify-report、summarize，尤其应读取 spec.runtime_manifest 与 spec.probe_report，不能假定旧适配器私有的 probe_comparison 等字段必然存在。entry 中的可执行文件和项目适配器路径必须是本次 workspace 中已存在的绝对路径；不要在 entry 留下 {workspace}、{runtime_root} 等仅供探针命令使用的占位符。宿主会在探针后立即调用 verify-preparation；探针自测通过不等于整份准备通过。

写入项目测试目录内的适配器/配置/探针助手（不可写产品源码），并只使用上面运行环境的已验证执行器调用轻量**非业务**探针。adapter_paths 必须列全这些项目脚本、配置和必要夹具，也必须包含本阶段修改过的全部受版本控制测试文件，即便其中某个文件只是自检助手；每个路径都必须位于请求声明的 test_roots 内；项目根目录的依赖清单或源码不能填入 adapter_paths，它们分别由运行环境和源码清单绑定。宿主会冻结适配器哈希及归档副本。**绝对不要修改 .acceptance/knowledge、任何 INDEX.md 或共享验收知识；只在回答中提出 knowledge_candidate，待探针与宿主核验通过后由宿主发布。**每条不同进程/测试入口路由分别准备零命中和非零命中探针。宿主在每个 collect 前已经创建 {raw_dir}，collect 只能向其中写入原生数据，不得再用 exist_ok=False 创建它。adapter/direct 必须只读 {raw_dir}，所有派生文件只能写到 {probe_dir} 的其他位置或 stdout；宿主会检查 raw 目录在两个 reader 后逐字节不变。零命中必须有非空原生数据及非零分母而 covered=0；非零命中须有 covered>0。每个探针先采集原生数据，再让项目适配器与专用工具直接从同一原生数据独立输出规范化 JSON，二者源码路径、指标、数值须一致。直接工具读取命令不得调用适配器。若某部分无法验证，标记 unsupported 并给出真实尝试依据，不能把它称为 measured。保留首次异常和重试原始资料；探针只证明采集链路，不得算业务覆盖率。

先逐条读取适用项目知识，检查已有项目测试适配器是否仍适用于本次 runtime 和源码版本；可复用时沿用并做最小修正，不重复探索已经有依据的工具路线或安装方法。你只需用一条最小命令确认适配器可启动；完整的各路由零/非零探针由宿主在你回答后统一执行并独立复核，不要在 Agent 内提前重复跑整套探针。若现有资料失效，记录具体差异，再做必要探索。

最后只输出 JSON 对象，形如：{"adapter_paths":["项目相对路径"],"entry":["执行器","项目适配器"],"tools":[{"name":"...","version":"...","role":"..."}],"source_dispositions":{"项目相对源码":{"kind":"measured|unsupported|non_executable","reason":"..."}},"probe_plan":{"schema":"project-coverage-probe-plan-v1","routes":[{"id":"route-id","source_paths":["项目相对源码"],"zero":{"collect":["执行器","脚本","{raw_dir}"],"adapter":["执行器","适配器脚本","{raw_dir}"],"direct":["执行器","直接工具脚本","{raw_dir}"]},"nonzero":{...}}]},"limitations":["..."],"knowledge_candidate":"跨验收可复用的步骤、失败排查与新电脑重建方法；不能包含本机路径/秘密/探针通过结论"}。三个 probe 命令均为 argv，首项必须是本次 runtime.json 验证的可执行文件绝对路径；可用 {raw_dir}、{probe_dir}、{workspace} 占位。adapter/direct 向 stdout 输出 coverage-probe-normalized-v1 JSON：{"schema":"coverage-probe-normalized-v1","components":[{"id":"...","source_paths":["..."],"metrics":{"line":{"status":"measured","covered":0,"total":1},"branch":{"status":"unavailable","reason":"..."}}}]}。不要把空原生数据在 source-map 转换后意外出现的 100% 当作零命中通过。`;
writeFileSync(join(output, 'prompt.txt'), prompt);
const agent=createAgentRuntime({directory:output});
const result = {schema: 'project-coverage-agent-run-v1', agent_runtime:agent.metadata, model:agent.metadata.model,
  effort:agent.metadata.effort, started_at: new Date().toISOString(), runtime_sha256: request.runtime_sha256};
const start = performance.now(); let done, error, tools = 0; const texts = [];
try {
  for await (const event of agent.run(prompt, {cwd: resolve(runtime.workspace),
    model: result.model, effort: result.effort,
    permissions: {fileWrite: 'allow', shellExecute: 'allow', networkAccess: 'allow'}})) {
    appendFileSync(join(output, 'agent.jsonl'), JSON.stringify(event) + '\n');
    if (event.type === 'text' && typeof event.payload?.content === 'string') texts.push(event.payload.content);
    if (event.type === 'tool_use') tools++;
    if (event.type === 'done') done = event.payload;
    if (event.type === 'error') error = event.payload?.message;
  }
  if (done?.status !== 'success') throw Error(error ?? 'Coverage Agent did not complete');
  verifyProduct();
  acceptanceGuard({acceptance: request.acceptance, source_checkout: runtime.workspace,
    test_roots: request.test_roots}, [output]);
  const raw = (texts.at(-1) ?? '').trim();
  writeFileSync(join(output, 'answer.txt'), raw + '\n');
  const answer = JSON.parse(raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
  if (typeof answer.knowledge_candidate !== 'string') throw Error('Coverage Agent omitted knowledge candidate');
  writeFileSync(join(output, 'knowledge-candidate.md'), answer.knowledge_candidate + '\n');
  if (!Array.isArray(answer.adapter_paths) || !answer.adapter_paths.length) throw Error('Agent omitted project adapters');
  const adapters = {};
  if (!Array.isArray(request.test_roots) || !request.test_roots.length) throw Error('Coverage test roots missing');
  const allowedRoots = request.test_roots.map(name => resolve(runtime.workspace, name));
  for (const name of answer.adapter_paths) {
    if (typeof name !== 'string' || isAbsolute(name) || name.split('/').includes('..')) throw Error('Adapter path escapes workspace');
    if (name in sourceHashes) throw Error('Coverage adapter cannot be frozen product source');
    const path = resolve(runtime.workspace, name);
    if (relative(runtime.workspace, path).startsWith('..')) throw Error('Adapter path escapes workspace');
    if (!allowedRoots.some(root => path === root || path.startsWith(root + '/'))) throw Error('Adapter path is outside declared test roots');
    if (!allowedRoots.some(root => realpathSync(path).startsWith(realpathSync(root) + '/')))
      throw Error('Adapter resolves outside declared test roots');
    adapters[name] = hash(readFileSync(path));
  }
  const dirty = spawnSync('git', ['diff', '--name-only', 'HEAD'],
    {cwd: runtime.workspace, encoding: 'utf8'});
  if (dirty.status !== 0) throw Error('Cannot inspect changed coverage test files');
  const omitted = dirty.stdout.split('\n').filter(Boolean).filter(name =>
    allowedRoots.some(root => {
      const file = resolve(runtime.workspace, name);
      return file === root || file.startsWith(root + '/');
    }) && !(name in adapters));
  if (omitted.length) throw Error('Coverage Agent omitted changed test files from adapter_paths: ' + omitted.join(', '));
  const plan = {...answer.probe_plan, runtime_manifest: runtimePath, runtime_sha256: request.runtime_sha256,
    workspace: runtime.workspace, revision: runtime.revision};
  const planPath = join(output, 'probe-plan.json');
  writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
  check('python3', [script, 'run', planPath, join(output, 'probes')],
    join(output, 'probe-gate.stdout'), join(output, 'probe-gate.stderr'));
  verifyProduct();
  const probePath = join(output, 'probes', 'coverage-probes.json');
  const probe = JSON.parse(readFileSync(probePath));
  const dispositions = answer.source_dispositions;
  if (Object.keys(dispositions ?? {}).sort().join('\0') !== Object.keys(sourceHashes).sort().join('\0'))
    throw Error('Agent omitted source disposition');
  const measured = Object.entries(dispositions).filter(([, value]) => value.kind === 'measured').map(([name]) => name);
  check('python3', [script, 'verify', probePath, runtimePath, request.runtime_sha256, ...measured],
    join(output, 'probe-verify.stdout'), join(output, 'probe-verify.stderr'));
  const status = probe.status === 'ready' && measured.length &&
    !Object.values(dispositions).some(value => value.kind === 'unsupported') ? 'ready' : 'partial';
  const unmetExpectedSources = expectedMeasuredSources.filter(name => dispositions[name]?.kind !== 'measured');
  const artifactAliases = {...(answer.artifact_aliases ?? {})};
  for (const [name, digest] of Object.entries({...sourceHashes, ...adapters})) {
    const original = resolve(runtime.workspace, name), frozen = resolve(output, 'frozen', name);
    mkdirSync(dirname(frozen), {recursive: true});
    copyFileSync(original, frozen);
    if (hash(readFileSync(frozen)) !== digest) throw Error('Frozen archive copy changed: ' + name);
    artifactAliases[original] = {path: frozen, sha256: digest};
  }
  const profile = {schema: 'project-coverage-preparation-v1', entry: answer.entry,
    adapter_files: adapters, tools: answer.tools, source_dispositions: dispositions,
    preparation_status: status,
    spec: {project_root: runtime.workspace, revision: runtime.revision,
      components: request.components ?? {}, source_hashes: sourceHashes,
      inventory_path: request.inventory_path, inventory_sha256: hash(readFileSync(request.inventory_path)),
      registry_path: request.registry_path, runtime_manifest: runtimePath,
      runtime_sha256: request.runtime_sha256, probe_report: probePath, probe_report_sha256: hash(readFileSync(probePath))},
    preparation_evidence: [{path: planPath, sha256: hash(readFileSync(planPath))},
      {path: probePath, sha256: hash(readFileSync(probePath))}],
    artifact_aliases: artifactAliases};
  const prepared = join(output, 'prepared'); mkdirSync(prepared);
  writeFileSync(join(prepared, 'prepared.json'), JSON.stringify(profile, null, 2) + '\n');
  const config = {policy: 'required', protocol: 'project-coverage-v1', prepared,
    prepared_sha256: hash(readFileSync(join(prepared, 'prepared.json'))), inventory_path: request.inventory_path};
  const configPath = join(output, 'coverage-config.json'); writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  check('python3', ['-c', `import sys;sys.path.insert(0,${JSON.stringify(resolve(new URL('.', import.meta.url).pathname))});from coverage_protocol import preparation;preparation(__import__('json').load(open(sys.argv[1])))`, configPath],
    join(output, 'preparation-gate.stdout'), join(output, 'preparation-gate.stderr'));
  verifyProduct();
  writeFileSync(join(output, 'handoff.json'), JSON.stringify({schema: 'project-coverage-agent-handoff-v1',
    status, runtime_manifest: runtimePath, runtime_sha256: request.runtime_sha256,
    prepared, prepared_sha256: config.prepared_sha256, probe_report: probePath,
    expected_measured_sources: expectedMeasuredSources, unmet_expected_sources: unmetExpectedSources,
    knowledge_candidate: join(output, 'knowledge-candidate.md'), limitations: answer.limitations ?? []}, null, 2) + '\n');
  result.status = status; result.prepared = prepared; result.usage = done?.usage; result.agent_status = done?.status;
} catch (failure) {result.status = 'blocked'; result.error = failure.message; if (error) result.agent_error = error;}
result.seconds = (performance.now() - start) / 1000; result.tool_calls = tools; result.finished_at = new Date().toISOString();
writeFileSync(join(output, 'metrics.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (result.status === 'blocked') process.exitCode = 2;

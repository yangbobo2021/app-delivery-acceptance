import {packageRoot} from '../../../root.mjs';
/** Independent coverage-preparation Agent; Node validates project-tool evidence. */
import {readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, realpathSync, copyFileSync} from 'node:fs';
import {resolve, join, relative, isAbsolute, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {createAgentRuntime} from '../../../runtime/players.mjs';
import {acceptanceGuard, knowledgeContext} from '../../shared/guard.mjs';
import {workspaceSnapshot,verifyAllowedChanges} from '../../shared/workspace.mjs';
import {materializeCoverageEntry} from '../protocol/materialize.mjs';

const [requestArg, outputArg] = process.argv.slice(2);
if (!requestArg || !outputArg) throw Error('usage: node preparer.mjs request.json new-output-dir');
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
const script = resolve(fileURLToPath(new URL('../../../tools/coverage-probes.mjs', import.meta.url)));
const runtimeCheck = resolve(fileURLToPath(new URL('../../../tools/runtime-verify.mjs', import.meta.url)));
const toolContract = resolve(fileURLToPath(new URL('../../../contracts/coverage-tool-contract.md', import.meta.url)));
const protocolGuide = resolve(fileURLToPath(new URL('../../../contracts/project-coverage-protocol.md', import.meta.url)));
const check = (program, args, stdout, stderr) => {
  const started_at=new Date().toISOString(),started=performance.now();
  const child = spawnSync(program, args, {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
  writeFileSync(stdout, child.stdout ?? ''); writeFileSync(stderr, child.stderr ?? '');
  appendFileSync(join(output,'host-checks.jsonl'),JSON.stringify({program,args,cwd:process.cwd(),started_at,finished_at:new Date().toISOString(),seconds:(performance.now()-started)/1000,
    exit_code:child.status,stdout:{path:stdout,sha256:hash(readFileSync(stdout))},stderr:{path:stderr,sha256:hash(readFileSync(stderr))}})+'\n');
  if (child.error || child.signal || child.status !== 0) throw Error(`Coverage stage gate failed: ${JSON.stringify({program,args,exit_code:child.status,signal:child.signal,error:child.error?.message,stdout,stderr,detail:(child.stderr||child.stdout||'No diagnostic text; inspect the saved command and exit status').slice(-4000)})}`);
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
const workspaceBaseline=workspaceSnapshot(runtime.workspace,runtime.components??[]);
writeFileSync(join(output,'workspace-baseline.json'),JSON.stringify(workspaceBaseline,null,2)+'\n');
check(process.execPath, [runtimeCheck, runtimePath], join(output, 'runtime-verify.stdout'), join(output, 'runtime-verify.stderr'));
if (request.workspace && resolve(request.workspace) !== resolve(runtime.workspace)) throw Error('Coverage request workspace differs from runtime');
if (request.revision && request.revision !== runtime.revision) throw Error('Coverage request revision differs from runtime');
verifyProduct();
const knowledge = knowledgeContext(binding);
const prompt = `你是独立的覆盖率准备 Agent。你的输入是**已经验证的本次验收运行环境**。只负责使后续测试用例可以复用可靠覆盖率采集；不要生成或执行任何业务验收场景，不要修改产品逻辑或制造覆盖率数字。先读取项目既有测试入口、现有测试文件、依赖清单、进程/构建路径和项目验收知识，再选择成熟的项目适用工具。覆盖率可选时此 Agent 才会运行。

项目工作区：${runtime.workspace}
本次阶段输出根：${output}。自行进行的最小启动及失败状态检查只可写入它的新建 agent-checks 子目录；不要覆盖任何既有尝试的检查资料。宿主生成的 probes、prepared、frozen 由宿主负责，不在角色内提前创建。
运行环境 manifest：${runtimePath}，SHA256：${request.runtime_sha256}
运行环境执行器：${JSON.stringify(runtime.executables)}
项目覆盖率输入：${JSON.stringify(request)}
本次项目明确预期能采集的源码：${JSON.stringify(expectedMeasuredSources)}。这是项目目标，不是所有项目的通用覆盖率配额。先检查已有适配器为什么没达到这些目标，再尝试项目适用的替代采集/映射方法；零命中、定向命中和独立读取都须证明这些文件的真实分母与命中。还须轻量验证采集未发生时的状态传播：没有实际原生快照的来源不得把零基线标为实测 0%，收尾失败不能冒充完整采集；记录失败路径证据。不能因为第一次方案失败便停止探索并把目标文件标成 unsupported。若充分尝试后仍无法证明，就如实标 unsupported、保留失败证据和具体限制，不能声称本项目目标已完成。不要改动 partial 的通用含义。
适用项目知识：${JSON.stringify(knowledge)}
覆盖率工具强制规约（同样适用于项目适配器与独立读取器）：${readFileSync(toolContract, 'utf8')}
本次候选 SKILL 的覆盖率协议（优先于机器上另一个已安装版本）：${readFileSync(protocolGuide, 'utf8')}
本次实际调用的独立 Playbook 包根目录：${packageRoot}。宿主探针脚本：${script}。只按这份工作流包 的协议与脚本准备；不要另找机器上同名的已安装副本。
已保留的前次失败尝试（只读检查其错误收据和项目适配器快照，不能覆盖）：${JSON.stringify(request.prior_attempts ?? [])}
真实宿主调用方：${resolve(fileURLToPath(new URL('../../shared/coverage-execution.mjs', import.meta.url)))} 与 ${resolve(fileURLToPath(new URL('../../shared/coverage.mjs', import.meta.url)))}；必要时只读核对各操作的实际 request/response 形状。
collect、adapter、direct 是独立进程，不继承对方设置的环境变量；必要上下文用各自 argv 的占位符或冻结项目配置传递，不能依赖交互式调试 shell 的临时 export。
你交付的是 project-coverage-backend-v1 项目后端：实现 tools、run、finish、verify-report、summarize；不要实现通用 verify-preparation 或重新编写工具身份比较。宿主会生成固定 Node 协议入口及唯一 binding.json，冻结其字节，先实测 tools 再运行探针，最后完成通用准备核验。tools 必须实际导入/调用已安装工具返回 {tools:[{name,version}]}，不能回显请求冒充实测版本。每次调用都收到 request.tools，这是唯一规范工具元数据；报告和汇总使用它，不另写 TOOLS 常量，不比较 role 描述文字。工具身份由固定代码按 name/version 核验，用途描述仅供阅读。
路径类型必须按真实接口区分：run 收到的冻结会话中 prepared 是目录；finish 先读取 request.request 指向的会话文件，再从该会话的 prepared 目录加载 prepared.json。报告的 prepared 必须原样保留冻结会话的目录值，prepared_sha256 才是该目录下 manifest 文件的摘要；不要把加载用的 manifest 文件路径回填为报告 prepared。不得用自造请求替代实际宿主形状来证明兼容。
交付给宿主的 entry 是项目后端 argv；不能假定旧适配器私有准备字段存在。可执行文件和项目适配器路径必须是本次 workspace 中已存在的绝对路径；不要在 entry 留下 {workspace}、{runtime_root} 等仅供探针命令使用的占位符。项目相关原生数据重算仍由你的 verify-report 完成，固定入口不替代成熟工具统计。后端异常保留完整堆栈和具体字段差异，不能仅输出空 AssertionError。

写入项目测试目录内的适配器/配置/探针助手（不可写产品源码），并只使用上面运行环境的已验证执行器调用轻量**非业务**探针。adapter_paths 必须列全这些项目脚本、配置和必要夹具，也必须包含本阶段修改过的全部受版本控制测试文件，即便其中某个文件只是自检助手；每个路径都必须位于请求声明的 test_roots 内；项目根目录的依赖清单或源码不能填入 adapter_paths，它们分别由运行环境和源码清单绑定。宿主会冻结适配器哈希及归档副本。**绝对不要修改 .acceptance/knowledge、任何 INDEX.md 或共享验收知识；只在回答中提出 knowledge_candidate，待探针与宿主核验通过后由宿主发布。**每条不同进程/测试入口路由分别准备零命中和非零命中探针。宿主在每个 collect 前已经创建 {raw_dir}，collect 只能向其中写入原生数据，不得再用 exist_ok=False 创建它。adapter/direct 必须只读 {raw_dir}，所有派生文件只能写到 {probe_dir} 的其他位置或 stdout；宿主会检查 raw 目录在两个 reader 后逐字节不变。零命中必须有非空原生数据及非零分母而 covered=0；非零命中须有 covered>0。每个探针先采集原生数据，再让项目适配器与专用工具直接从同一原生数据独立输出规范化 JSON，二者源码路径、指标、数值须一致。直接工具读取命令不得调用适配器。若某部分无法验证，标记 unsupported 并给出真实尝试依据，不能把它称为 measured。保留首次异常和重试原始资料；探针只证明采集链路，不得算业务覆盖率。

特别检查最终 argv 与实际 cwd 下的源码路径。项目适配器与独立读取器均须调用专用工具公开支持的报告/统计入口，并在 tools 与 knowledge_candidate 中注明实际入口；即使读取了工具内部 parser 或原生 arcs，自行计算分母、分支出口或命中也不符合规约。复用旧适配器前先核查这一点，不能只修到脚本可启动。跨文件计数和范围统计也由工具生成，适配器不得自行累计各文件的计数再称为工具汇总；选择范围后调用工具报告该范围的原生 totals。

先逐条读取适用项目知识，检查已有项目测试适配器是否仍适用于本次 runtime 和源码版本；可复用时沿用并做最小修正，不重复探索已经有依据的工具路线或安装方法。你只需用一条最小命令确认适配器可启动；完整的各路由零/非零探针由宿主在你回答后统一执行并独立复核，不要在 Agent 内提前重复跑整套探针。若现有资料失效，记录具体差异，再做必要探索。

若当前项目已有仍适用的完整探针计划，可以输出 probe_plan_path（本 ID workflows 下计划文件的完整绝对路径）替代重复输出 probe_plan 对象。不要用省略号缩写可执行路径。宿主只复用命令定义，不复用旧通过结果；新准备会重新执行全部探针，并要求计划的运行时、workspace 和 revision 绑定一致。

最后只输出 JSON 对象，形如：{"adapter_paths":["项目相对路径"],"entry":["执行器","项目适配器"],"tools":[{"name":"...","version":"...","role":"..."}],"source_dispositions":{"项目相对源码":{"kind":"measured|unsupported|non_executable","reason":"..."}},"probe_plan":{"schema":"project-coverage-probe-plan-v1","routes":[{"id":"route-id","source_paths":["项目相对源码"],"zero":{"collect":["执行器","脚本","{raw_dir}"],"adapter":["执行器","适配器脚本","{raw_dir}"],"direct":["执行器","直接工具脚本","{raw_dir}"]},"nonzero":{...}}]},"limitations":["..."],"knowledge_candidate":"跨验收可复用的步骤、失败排查与新电脑重建方法；不能包含本机路径/秘密/探针通过结论"}。三个 probe 命令均为 argv，首项必须是本次 runtime.json 验证的可执行文件绝对路径；可用 {raw_dir}、{probe_dir}、{workspace} 占位。adapter/direct 向 stdout 输出 coverage-probe-normalized-v1 JSON：{"schema":"coverage-probe-normalized-v1","components":[{"id":"...","source_paths":["..."],"metrics":{"line":{"status":"measured","covered":0,"total":1},"branch":{"status":"unavailable","reason":"..."}}}]}。不要把空原生数据在 source-map 转换后意外出现的 100% 当作零命中通过。`;
writeFileSync(join(output, 'prompt.txt'), prompt);
const agent=createAgentRuntime({directory:output,role:'coverage_preparer'});
const result = {schema: 'project-coverage-agent-run-v1', agent_runtime:agent.metadata, model:agent.metadata.model,
  effort:agent.metadata.effort, started_at: new Date().toISOString(), runtime_sha256: request.runtime_sha256};
const start = performance.now(); let done, error, tools = 0; const texts = [];
try {
  for await (const event of agent.run(prompt, {jsonOutput:true,cwd: resolve(runtime.workspace),
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
  const modifications=verifyAllowedChanges(runtime.workspace,workspaceBaseline,request.test_roots,runtime.components??[]);
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
  const omitted = modifications.changes.filter(name =>
    allowedRoots.some(root => {
      const file = resolve(runtime.workspace, name);
      return file === root || file.startsWith(root + '/');
    }) && !(name in adapters));
  if (omitted.length) throw Error('Coverage Agent omitted changed test files from adapter_paths: ' + omitted.join(', '));
  const protocolEntry = materializeCoverageEntry({workspace:runtime.workspace,testRoots:request.test_roots,
    attempt:output,entry:answer.entry,tools:answer.tools,adapterFiles:{...adapters}});
  for (const name of protocolEntry.paths) adapters[name] = hash(readFileSync(resolve(runtime.workspace,name)));
  writeFileSync(join(output,'backend-binding.json'),JSON.stringify({backend_entry:answer.entry,entry:protocolEntry.entry,
    tools:answer.tools,generated_files:protocolEntry.paths},null,2)+'\n');
  // Freeze before probing so a rejected preparation remains reproducible after a retry.
  const artifactAliases = {...(answer.artifact_aliases ?? {})};
  const snapshot = {};
  for (const [name, digest] of Object.entries({...sourceHashes, ...adapters})) {
    const original = resolve(runtime.workspace, name), frozen = resolve(output, 'frozen', name);
    mkdirSync(dirname(frozen), {recursive: true});
    copyFileSync(original, frozen);
    if (hash(readFileSync(frozen)) !== digest) throw Error('Frozen archive copy changed: ' + name);
    artifactAliases[original] = {path: frozen, sha256: digest};
    snapshot[name] = {path: frozen, sha256: digest};
  }
  writeFileSync(join(output, 'snapshot.json'), JSON.stringify({schema: 'coverage-preparation-snapshot-v1',
    files: snapshot}, null, 2) + '\n');
  const toolRequest=join(output,'tool-check.request.json');writeFileSync(toolRequest,JSON.stringify({artifact_map:{}})+'\n');
  check(protocolEntry.entry[0],[...protocolEntry.entry.slice(1),'tools',toolRequest,join(output,'tool-check.response.json')],
    join(output,'tool-check.stdout'),join(output,'tool-check.stderr'));
  const verifyAdapters = () => {
    for (const [name, digest] of Object.entries(adapters)) {
      if (hash(readFileSync(resolve(runtime.workspace, name))) !== digest)
        throw Error('Coverage probe changed its frozen adapter: ' + name);
    }
  };
  let planDraft=answer.probe_plan;
  if(answer.probe_plan_path){
    const reusable=resolve(answer.probe_plan_path);
    const workflowRoot=resolve(binding.project_root,'.acceptance-local',binding.id,'workflows');
    if(!isAbsolute(answer.probe_plan_path)||!realpathSync(reusable).startsWith(realpathSync(workflowRoot)+'/'))
      throw Error('Reused probe plan must belong to this acceptance workflows');
    if(planDraft)throw Error('Provide probe_plan or probe_plan_path, not both');
    planDraft=JSON.parse(readFileSync(reusable));
    if(planDraft.runtime_manifest!==runtimePath||planDraft.runtime_sha256!==request.runtime_sha256||
       planDraft.workspace!==runtime.workspace||planDraft.revision!==runtime.revision)
      throw Error('Reused probe plan runtime/workspace/revision binding differs');
    writeFileSync(join(output,'reused-probe-plan.json'),JSON.stringify({path:reusable,sha256:hash(readFileSync(reusable)),
      disposition:'Command definitions reused; all probes executed again for this preparation'},null,2)+'\n');
  }
  const plan = {...planDraft, runtime_manifest: runtimePath, runtime_sha256: request.runtime_sha256,
    workspace: runtime.workspace, revision: runtime.revision};
  const planPath = join(output, 'probe-plan.json');
  writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
  check(process.execPath, [script, 'run', planPath, join(output, 'probes')],
    join(output, 'probe-gate.stdout'), join(output, 'probe-gate.stderr'));
  verifyProduct();
  verifyAllowedChanges(runtime.workspace,workspaceBaseline,request.test_roots,runtime.components??[]);
  verifyAdapters();
  const probePath = join(output, 'probes', 'coverage-probes.json');
  const probe = JSON.parse(readFileSync(probePath));
  const dispositions = answer.source_dispositions;
  if (Object.keys(dispositions ?? {}).sort().join('\0') !== Object.keys(sourceHashes).sort().join('\0'))
    throw Error('Agent omitted source disposition');
  const measured = Object.entries(dispositions).filter(([, value]) => value.kind === 'measured').map(([name]) => name);
  check(process.execPath, [script, 'verify', probePath, runtimePath, request.runtime_sha256, ...measured],
    join(output, 'probe-verify.stdout'), join(output, 'probe-verify.stderr'));
  const status = probe.status === 'ready' && measured.length &&
    !Object.values(dispositions).some(value => value.kind === 'unsupported') ? 'ready' : 'partial';
  const unmetExpectedSources = expectedMeasuredSources.filter(name => dispositions[name]?.kind !== 'measured');
  const profile = {schema: 'project-coverage-preparation-v1', entry: protocolEntry.entry,
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
  check(process.execPath, [resolve(fileURLToPath(new URL('../../../tools/coverage.mjs',import.meta.url))), 'prepare-check',configPath],
    join(output, 'preparation-gate.stdout'), join(output, 'preparation-gate.stderr'));
  verifyProduct();
  verifyAllowedChanges(runtime.workspace,workspaceBaseline,request.test_roots,runtime.components??[]);
  verifyAdapters();
  writeFileSync(join(output, 'handoff.json'), JSON.stringify({schema: 'project-coverage-agent-handoff-v1',
    status, runtime_manifest: runtimePath, runtime_sha256: request.runtime_sha256,
    prepared, prepared_sha256: config.prepared_sha256, probe_report: probePath,
    expected_measured_sources: expectedMeasuredSources, unmet_expected_sources: unmetExpectedSources,
    knowledge_candidate: join(output, 'knowledge-candidate.md'), limitations: answer.limitations ?? []}, null, 2) + '\n');
  result.status = status; result.prepared = prepared; result.usage = done?.usage; result.agent_status = done?.status;
} catch (failure) {result.status = 'blocked'; result.error = failure.message; if (error) result.agent_error = error;}
result.seconds = (performance.now() - start) / 1000; result.tool_calls = tools; result.finished_at = new Date().toISOString();
result.usage = done?.usage; result.agent_status = done?.status;
writeFileSync(join(output, 'metrics.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (result.status === 'blocked') process.exitCode = 2;

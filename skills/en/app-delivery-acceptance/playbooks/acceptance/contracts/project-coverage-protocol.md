# 项目覆盖率准备与通用协议

覆盖率工具选择是**独立覆盖率准备 Agent** 的职责，且只在本次验收要求覆盖率时运行。它消费先前独立运行环境 Agent 冻结的 `runtime.json`，根据实际语言、框架、编译链、运行进程和现有测试入口选择成熟工具，在项目测试树中实现配置与调用适配，并实测其采集、零命中单位、导航/子进程和可靠收尾能力。它不运行任何业务验收场景。不能因为 Skill 未附带某语言实现就结束准备；确实无法采集时保存实际尝试与具体缺口。换验收 ID 时先读项目知识，重建并验证本次环境，再验证或重建覆盖率适配，不复用旧 ID 的安装物或探针通过结论。

通用 Skill 不注册语言、工具品牌或项目类型白名单，也不推断产品入口。它验证冻结输入、目录、工具来源、执行收据、场景/版本关联与证据字节，再调用项目入口。项目适配只可调用成熟工具、管理生命周期、转换格式/路径和绑定证据；覆盖率单位识别、命中、分母、合并和统计仍由专用工具完成。具体工具和依赖、夹具导入、命令、源码分类及支持范围属于项目准备和项目知识，不写进通用 Skill。

## 准备产物

项目准备命令自行选择，输出新的 `prepared/prepared.json`，schema 为 `project-coverage-preparation-v1`：

- `entry`：宿主将包内固定 Node 协议入口复制到项目测试树并冻结后的 argv；由宿主追加操作名、request JSON 路径、response JSON 路径。不使用 shell 插值。项目后端 argv 同样冻结在 `binding.json` 内，必须可直接执行，不能保留探针命令占位符；探针通过后仍须用最终 `entry` 实测 `verify-preparation`。
- `adapter_files`：项目相对路径到 SHA256 的映射，包含适配器、必要夹具、配置及锁文件。入口至少包含其中一个文件。路径和实际解析目录都不得逃出项目。
- `tools`：实际验证过的 `{name, version, role}`；准备资料记录实际命令/API及官方文档依据。工具身份仅为名称和版本，`role` 是可读用途描述；描述的语言、措辞或列表顺序不改变身份。Agent 返回的工具元数据冻结为唯一 `binding.json`，固定入口传给后端的每个 request.tools、准备清单和最终报告均使用此来源，不能另写一份 TOOLS 常量。安装包名称或版本标签不能代替验证。
- `spec.project_root / revision / components / source_hashes`：实际执行工作区、完整冻结版本与全部源码范围。静态资源仍在清单内。
- 新准备的 `spec.runtime_manifest / runtime_sha256 / probe_report / probe_report_sha256`：绑定本次验收的运行时环境和独立覆盖率探针报告。后续用例每次执行前复核环境、依赖、执行器、源码、适配器及探针字节；任一变化须重新准备。旧归档中不存在这些字段的历史准备保持可读，不将旧结果伪装成本轮运行环境验证。
- `spec.inventory_path / inventory_sha256 / registry_path`：不可变范围清单及其摘要、持续证据索引。两个路径必须是绝对路径，保证准备与用例从不同工作目录调用时仍指向同一文件。`registry_path` 的父目录必须是当前 ID 的 `workflows` 下的专用尝试目录，供后续用例调试精确授权；首次采集之前索引文件可以不存在，但声明的父目录必须存在；不能直接把索引放在 `workflows` 根目录。
- `source_dispositions`：逐一覆盖源码清单，说明 `measured / non_executable / unsupported` 及具体依据，不能删掉不支持的范围。
- `preparation_evidence`：真实工具链探针、原生零命中单位及配置等 `{path, sha256}`。合成探针仅证明工具能力，不能作为业务验收或业务覆盖率。
- `preparation_status`：新准备为 `ready` 或 `partial`。某条执行路由探针失败，或者源码被标为 `unsupported` 时不能写 `ready`；失败的首次探针原始资料保留。`blocked` 留在 Agent 阶段结果中，不激活准备。
- `artifact_aliases`：为归档预先保存的源码、适配器及离线复算必需的构建产物副本。原绝对路径必须位于项目根目录内，映射到 workflows 内的冻结副本；值可为路径字符串，或 `{ "path": 绝对路径, "sha256": 哈希 }`。源码/适配器副本必须与冻结清单同哈希；其他构建产物必须采用带哈希描述并在归档时复核。不得复制运行依赖、密钥或业务数据库。
- 若项目工具只有其他原生口径（例如语句、块等），可在 component 中用自定指标名保存 `{ "status": "measured", "label": "口径名称", "tool_output": "原生工具输出" }`；通用视图按名称原样显示，不把这种统计换算为行或分支覆盖率。行、分支及三个范围仍按各自证据报告 `unavailable` 或 `incomplete`，不从原生百分比推导。

`spec.components` 是 Git 组件路径到修订的映射，可为空对象；它不是覆盖率报告的指标组件数组。报告的 `components` 应按冻结 `source_hashes` 声明指标范围，不能因为没有 Git 子模块而输出空的覆盖率范围。

每次改变源码、工具、适配器、配置或统计范围都新建准备目录与 catalog，保留旧资料。prep spec 的 `coverage_test_files` 声明所有适配器及必要测试夹具；宿主冻结哈希并自动绑定到每次调试和正式执行。
覆盖率准备 Agent 修改过的受版本控制测试文件，即使只是自检助手，也必须列入 `adapter_paths` 并冻结。宿主在运行探针之前核对工作区的测试树变更清单；遗漏文件时准备失败，避免正式用例才因未绑定文件被拦下。

激活准备前，按现有测试入口/进程的不同采集路由，用最少的隔离非业务探针检查零命中和非零命中。运行 `node <package>/tools/coverage-probes.mjs run <probe-plan.json> <new-output-dir>`；计划是 `project-coverage-probe-plan-v1`，列出每路由的源码、零/非零探针的 `collect / adapter / direct` 三条 argv。首个程序必须是运行环境 manifest 中验证过的执行器；项目命令可以使用 `{raw_dir}`、`{probe_dir}`、`{workspace}` 占位。采集器写入非空原生数据，适配器与专用工具直接读取**同一份只读原生数据**，分别向 stdout 输出 `coverage-probe-normalized-v1` JSON；通用门禁只比较它们的源码路径、指标和数值，不自行计算覆盖率单位。零命中要求至少一个真实非零分母且所有实测命中为零；非零命中要求至少一个命中大于零。空原生数据经 source map 转换显示 100% 必须被挡下。探针计划、命令/退出码、两份输出、原生哈希及首次失败都留在本 ID 的 local 工作流目录。发现矛盾时新建准备尝试后复测，不发布该范围为 `measured`。还要用轻量的失败路径证明“采集路由未启动、原生快照缺失或收尾未完成”与“路由已运行但计数为零”可区分；前者的受影响文件/指标应为 `incomplete` 或 `unavailable` 并说明缺口，不能借零命中基线显示为实测 0%。失败路径不执行业务场景，原始输出与重验结果留在本 ID 的 local 目录。

公开调用入口为官方 Playbook CLI 的 `/acceptance-coverage-prepare`，输入与停止点见[独立覆盖率工作流](../docs/coverage-workflow.md)；内部 preparer 脚本由工作流调用，不由 Skill 宿主直接调度。工作流冻结的内部请求 `project-coverage-agent-request-v1` 至少包含本 ID 最新的 `acceptance` 知识读取绑定、`runtime_manifest / runtime_sha256`、完整 `source_hashes`、`inventory_path / inventory_sha256 / registry_path`、`test_roots`；Agent 输出项目适配器和探针计划，工作流的 Node 宿主实际执行上述探针、冻结准备文件并调用 `coveragePreparation()`。本次新知识读取凭证可以比运行环境创建时的新，但 ID 和 scope 必须一致。Agent **不得直接修改共享知识**；它只提出 `knowledge_candidate`，宿主在探针和准备文件通过核验后审查，再写入项目 `.acceptance/knowledge` 并通过分层索引校验。结果 `handoff.json` 明确 `ready / partial`、准备路径/摘要、运行环境路径/摘要、探针路径和限制；失败时保留 `agent.jsonl`、首次回答、探针与 gate 输出及 `metrics.json`，状态为 `blocked`。实际安装物和探针留在本次验收 local。零/非零探针只证明采集能力，后续业务用例仍须按下述 `run → finish → verify-report → summarize` 逐次采集和验证，探针数字不得算入业务结果。

若本项目有明确预期可测的源码，请求可给 `expected_measured_sources`（冻结 `source_hashes` 中的路径）。Agent 须针对这些文件验证已有方法、尝试修正或替代，并给出零命中、定向命中及独立读取依据；不能把首次工具失败直接当作项目不支持。`handoff.json` 同时列出目标与 `unmet_expected_sources`，供宿主核对本项目准备目标。它不改变 `partial` 的通用含义，其他项目可以按自己的范围接受部分采集。准备探针通过后，宿主还须使用实际用例入口检查 `run → finish → verify-report → summarize`，确认目标源码在真实用例的同次原生数据中有可信指标，然后才宣称该项目目标已实现。

复测请求可附 `prior_attempts` 路径，由 Agent 只读失败收据与适配器快照，不覆盖前次资料。宿主在探针后立即调用项目入口 `verify-preparation`；既有适配器若还依赖旧版私有准备字段，必须在项目测试目录内更新后重试，不能因探针通过而跳过完整准备验证。

准备 Agent 的实际输入同时包含完整的 [覆盖率工具规约](coverage-tool-contract.md)。项目适配器与独立读取器均应使用专用工具的原生报告或受支持统计入口；读取工具内部 parser、原始行或 arcs 后自行计算分母与命中仍不符合规约。宿主检查最终 argv、运行 cwd 和源码路径绑定，并以真实零/非零探针及完整准备验证决定是否就绪。

首次准备失败不等于项目无法采集。调用方先查看失败收据和已冻结的适配器，再用新尝试目录及 `prior_attempts` 交给同一职责的 Agent 做有依据的最小修正，复用已验证环境，不重新安装或推翻已有路线。连续两次修正后先衡量进展、用户影响和替代入口；有明确小缺口且正在收敛时才继续，避免无界重试。仍失败的路由与范围保留为具体限制；不得改成 `ready`、擅自关闭用户要求的覆盖率，或用人工修好的适配器冒充 Agent 自主准备成功。宿主在运行探针之前冻结源码、适配器和哈希清单，失败尝试也可复现；后续探针及完整准备核验仍须确认活跃文件没有改变。

catalog 的 `coverage` 使用：

```json
{"policy":"required","protocol":"project-coverage-v1","prepared":"/absolute/new-prepared","prepared_sha256":"<manifest SHA256>","inventory_path":"/absolute/frozen-inventory.json"}
```

`/acceptance-project` 调用 Node 工具核验准备并绑定覆盖率策略。场景继承配置，旧模板不得降级或替换绑定。先结束仍使用旧准备的活动执行，再激活新准备；不修改旧 catalog 或报告。

## 项目入口操作

所有操作读取 request JSON、写 response JSON，失败返回非零退出码。请求包含 `artifact_map` 时，只读处理使用指定同哈希归档副本，不改原报告内的路径或字节。

宿主在每次新准备中，将 `workflows/coverage/protocol/{entry,tools,report}.mjs` 原样复制到声明测试根下的独立 `.acceptance-coverage/<attempt>/`，与唯一 `binding.json` 一并冻结；这些文件不依赖原 Skill 或包的安装位置，归档时保持相邻结构。
项目准备角色返回的 `entry` 指向项目后端；新准备的后端合同为 `project-coverage-backend-v2`，只实现 `tools / run / read`。
公共 `finish / verify-preparation / verify-report / summarize` 的封装与判断全部属于固定 Node 协议。
后端只调用成熟工具，不自行实现工具身份、会话/收据/版本绑定、报告完整性判断或框架响应。

| 后端操作 | 唯一项目职责 |
| --- | --- |
| `tools` | 实际导入/执行已安装工具，返回 `{tools:[{name,version}]}`；不能回显请求。 |
| `run` | 以原会话的 cwd、command、env 真实采集，输出及退出码透传；响应 `{exit_code,collection_status:"complete或incomplete",raw_evidence:[{path,sha256,role}]}`。所有原生资料、配置及真实收尾状态位于会话 output；无快照时保留实际失败状态文件，不称为零命中。 |
| `read` | 从一组或多组原生资料，通过同一成熟工具读取/合并实现返回状态、组件指标及全部声明范围；不能为收尾、重算、汇总分别建立不同的统计路径。 |

read 请求为：

```json
{"groups":[{"status":"measured","raw_evidence":[{"path":"已解析的同哈希文件","original_path":"原路径","sha256":"摘要","role":"项目定义类型"}]}],"sources":{"冻结相对源码":"实际同哈希源码文件"},"project_root":"冻结工作区","inventory":{},"output":"已创建的本次派生目录","tools":[{"name":"实际工具","version":"实际版本","role":"说明"}]}
```

read 响应为 `{tools,status,components,scopes,derived_evidence}`。
调用者可提供非空 `preparation_instructions`，明确真实入口或进程要求；该文本随请求冻结并传给角色，`basis` 仍只表示策略依据。
status 为 `measured / incomplete`；任一组收尾或原生数据不完整时不能升级为 measured。
components 的 `id / source_paths / line / branch` 来自工具的公开报告；源码路径相对冻结 project_root，不依赖当前 cwd。
其他原生指标也可使用 `{status,covered,total}` 或 `{status,tool_output}`；不支持的行或分支必须说明原因，不能伪造数值。数值型原生指标可证明零/非零采集。
scopes 包含 `project / changed_files / changed_lines` 的状态、工具指标或明确不可用原因。
project.components 与顶层 components 表示同一完整项目统计，不能再次另算。
原始路径映射由固定入口解析；后端只处理明确提供的实际文件，必要时仍使用工具的正式路径映射功能处理原生数据内部路径。
全零、多组全零以及零/非零混合都须保留工具真实分母和分支模式，缺字段时不能用0、自造单位或伪造命中补齐。
derived_evidence 为工具原始报告等 `{path,sha256,role}` 数组，派生文件只能写入 request.output。

| 公共操作 | 固定协议负责的行为 |
| --- | --- |
| `verify-preparation` | 读取 request.prepared 指向的 manifest 文件，核对冻结后端、源码和实际工具身份。 |
| `run` | 调用后端 run，透传真实 stdout、stderr、退出码及采集响应。 |
| `finish` | 读取 request.request 冻结会话、request.receipt 真实收据和 output/run-response.json；调用 read 后绑定 prepared、场景、源码、工具、执行及原生/派生资料，生成不可变框架报告。prepared 是会话中的目录，prepared_sha256 是该目录下 prepared.json 的摘要。 |
| `verify-report` | 核对原报告、原生数据和采集响应哈希，调用同一 read 重算并比较状态、源码范围及工具指标；生成时间和展示说明不参与比较，所有原始资料只读。 |
| `summarize` | 逐份核验报告和兼容性后，调用同一 read 处理多组原生数据；由工具输出 scopes，不由 Node 相加计数或重建分母。 |

固定入口每次传递唯一工具元数据，身份只按实际名称和版本核验。
后端失败保留操作、完整命令、退出/信号、原始 stdout/stderr 和堆栈；`<response>.backend.json` 保留实际工具调用与返回，`<response>.failure.json` 保留失败诊断。

## 就绪前完整入口验证

新准备记录 `protocol_revision:2`，各 probe_plan.routes 同时提供：

```json
{"lifecycle":{"zero":{"command":["/verified/executor","/frozen/probe","zero"],"env":{}},"nonzero":{"command":["/verified/executor","/frozen/probe","nonzero"],"env":{},"expected_exit_code":0},"direct":["/verified/executor","/frozen/independent-reader","{request}"]}}
```

zero/nonzero 为原始非业务启动命令，最终 entry 包装采集，从 workspace 根目录执行；执行器须已验证，仅支持 `{workspace} / {probe_dir}`。
探针走真实 CLI、子进程或页面路由，不通过在父进程额外调用产品内部函数补充覆盖。
direct 接收 `{request}` 指向的只读查询，形状与 read 相同，另含 `component_sources:[{id,source_paths,metric_names}]`；仅给出需要读取的指标名称，不提供预期数值。
它不得调用或导入主后端，须独立调用成熟工具，从同份原生资料向 stdout 返回 `{schema:"coverage-native-oracle-v1",status,components}`。
每命令最多30秒；宿主执行两次独立零命中及一次非零命中，逐次完成 run、finish、重复核验、独立读取和汇总，并比较全零及混合合并的工具结果。
指标篡改必须被拒绝；独立读取也须发现主后端错误转换指标，不能把未运行或解析失败视为有效核验。
这些资料不计入业务场景，不激活准备或登记业务覆盖率。
完整验证失败不发布就绪交接；成功报告及所有依赖摘要绑定到 `spec.lifecycle_report / lifecycle_report_sha256`，准备复用与归档继续核验闭包。
历史准备及其冻结入口不改写；新准备不能用旧适配器跳过这些检查。
若没有任何可测源码及执行路由，保存明确原因、绑定和 `partial` 证明，不运行空门禁并宣称 `ready`。

正式执行通过 `/acceptance-execute`，由 Node 工具调用冻结的项目采集器；本地调试通过宿主提供的 `case-tool.mjs debug-run` 契约。低层 `coverage-tool.mjs run REQUEST` 不是绕过工作流门禁的公共验收入口。执行仍须绑定 acceptance、同一工作区、实际场景、测试文件与新输出目录。业务失败的可靠计数仍可登记；缺失执行收据、版本不符或来源错误时不能登记。仅重算已有覆盖率使用 `/acceptance-coverage-recompute`，不重新运行用例。

## 报告与统计

`coverage-report.json` schema 为 `project-tool-coverage-report-v1`，protocol 为 `project-coverage-v1`。必需 `prepared, prepared_sha256, scene_id, revision, source_hashes, tools, collection_relation: same_run, status, receipt_path, execution_sha256, raw_evidence, components`。报告的 `prepared` 必须与冻结执行会话的 `prepared` 目录字符串一致，`prepared_sha256` 是该目录下 `prepared.json` 的字节摘要；加载 manifest 时使用的文件路径不能替换报告的目录身份。

收据必须绑定实际覆盖率会话及其 SHA256，场景、版本、准备和执行 argv 必须一致。原生数据逐一记录 `{path, sha256}`；适配器可增加原生数据角色等元数据。

每个 component 包含 `id, label, source_paths, line, branch`，源路径必须属于冻结清单。行和分支分别保存工具给出的 `status, covered, total, pct`；不能计算的指标保存 `status: unavailable` 和具体 `reason`。禁止通用脚本或 UI 自行构造覆盖率单位与统计数字。混合语言保留各自 component 和分支口径，无法可靠合并时不制造总百分比。数据缺失、强制终止或收尾丢失必须明确 `incomplete`，保留真实已采部分及缺口。

`summarize` 返回每个 scope 的 `status` 及工具汇总的 `components` 或 `line/branch`。不支持某范围时返回具体原因，不用全项目数字充当修改行统计。范围来源必须与准备的 inventory 一致。首个提交的全部源码确实均为新增时，可记录该依据并使用原生全文件统计；这是项目适配决定，通用 Skill 不作此假设。

持续索引对同一准备按场景选最新有效采集，保留旧条目。采集不新增业务结论，不改变场景分母，不把旧 `unavailable` 记录改成实测。视图每次验证来源，统计缓存不能绕过收据、探针或范围变更校验。

## 归档与展示验证

`/acceptance-archive` 的 `coverage_reports: [绝对报告路径]` 是显式覆盖率归档输入，也可通过 `results` 选择已完成正式执行的结果。程序验证报告、同次执行、准备、原生资料、源码/适配器离线副本及哈希，保存原路径映射；没有旧命令参数兼容入口。

若项目报告还有执行请求、采集生命周期等辅助文件，可在报告顶层用 `{ "path": 绝对路径, "sha256": 哈希 }` 声明。通用协议在展示与发布前验证这些绑定，归档只纳入声明且位于本次 workflows 内的同哈希文件；未声明的项目私有边车文件不会靠目录扫描被补入。

归档使用 `/acceptance-archive`，显式选择当前最终执行、独立复审及同次原生覆盖率所需文件。归档前核对实际 report 与 execution 收据、哈希和路径映射，不按目录名猜轮次，也不递归打包所有调试或业务状态。原验收字节、哈希、时间和业务结论保持。完整输入见[生命周期](../docs/lifecycle-workflows.md)。

发布覆盖率时，仍能调用项目工具的本次运行环境会生成项目工具负责的 `coverage-summary.json`，绑定精确的报告路径、SHA256 和准备摘要，并纳入归档哈希清单。历史视图先核验冻结报告、原生资料、探针、源码和适配器；若本次运行环境已退役，仅对完全相同的报告集合读取这份项目工具摘要。摘要缺失、集合不符或字节变化时显示不可用，不从通用脚本重算或猜测统计。需要跨多份归档合并时，归档时须提供对应的完整报告集合；单份快照不能冒充跨场景汇总。

覆盖率补采不需要伪造 trace。现有 `project-context.json` 的 `acceptance` 与 `coverage_registries` 可登记补采索引，视图只把通过来源校验的真实采集附到同场景、同版本业务行。完整场景清单仍是统计分母。验证包括实际浏览器页面、三个范围、行/分支、工具版本、旧业务结论保留，以及暂移原采集目录后从归档同哈希依赖读取；验证后恢复目录，不删除旧证据。

Istanbul 示例属于 `tests/fixtures/coverage/istanbul/` 的项目工具测试夹具，不是业务运行时的一条兼容执行路径。新项目按实际环境选择成熟工具，不以夹具决定技术栈。

准备 Agent 可用 `probe_plan_path` 明确引用本 ID workflows 内已有完整计划，以避免重复录入长路径。宿主检查相同 runtime、workspace 和 revision，保存引用哈希并在新准备重新执行全部探针；它不复用旧的通过结果。也可继续输出完整 `probe_plan` 对象，两者互斥，任何实际 argv 都不能使用省略号。

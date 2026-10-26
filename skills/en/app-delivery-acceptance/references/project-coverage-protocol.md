# 项目覆盖率准备与通用协议

覆盖率工具选择是**独立覆盖率准备 Agent** 的职责，且只在本次验收要求覆盖率时运行。它消费先前独立运行环境 Agent 冻结的 `runtime.json`，根据实际语言、框架、编译链、运行进程和现有测试入口选择成熟工具，在项目测试树中实现配置与调用适配，并实测其采集、零命中单位、导航/子进程和可靠收尾能力。它不运行任何业务验收场景。不能因为 Skill 未附带某语言实现就结束准备；确实无法采集时保存实际尝试与具体缺口。换验收 ID 时先读项目知识，重建并验证本次环境，再验证或重建覆盖率适配，不复用旧 ID 的安装物或探针通过结论。

通用 Skill 不注册语言、工具品牌或项目类型白名单，也不推断产品入口。它验证冻结输入、目录、工具来源、执行收据、场景/版本关联与证据字节，再调用项目入口。项目适配只可调用成熟工具、管理生命周期、转换格式/路径和绑定证据；覆盖率单位识别、命中、分母、合并和统计仍由专用工具完成。具体工具和依赖、夹具导入、命令、源码分类及支持范围属于项目准备和项目知识，不写进通用 Skill。

## 准备产物

项目准备命令自行选择，输出新的 `prepared/prepared.json`，schema 为 `project-coverage-preparation-v1`：

- `entry`：项目测试树内冻结适配器的 argv；由宿主追加操作名、request JSON 路径、response JSON 路径。不使用 shell 插值。这里须写本次 workspace 中可直接执行的绝对路径，不能保留探针命令使用的 `{workspace}`、`{runtime_root}` 占位符；探针通过后仍须用这份最终 `entry` 实测 `verify-preparation`。
- `adapter_files`：项目相对路径到 SHA256 的映射，包含适配器、必要夹具、配置及锁文件。入口至少包含其中一个文件。路径和实际解析目录都不得逃出项目。
- `tools`：实际验证过的 `{name, version, role}`；准备资料记录实际命令/API及官方文档依据。安装包名称或版本标签不能代替验证。
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

激活准备前，按现有测试入口/进程的不同采集路由，用最少的隔离非业务探针检查零命中和非零命中。运行 `python3 <skill>/playbook/v4/coverage_preparation.py run <probe-plan.json> <new-output-dir>`；计划是 `project-coverage-probe-plan-v1`，列出每路由的源码、零/非零探针的 `collect / adapter / direct` 三条 argv。首个程序必须是运行环境 manifest 中验证过的执行器；项目命令可以使用 `{raw_dir}`、`{probe_dir}`、`{workspace}` 占位。采集器写入非空原生数据，适配器与专用工具直接读取**同一份只读原生数据**，分别向 stdout 输出 `coverage-probe-normalized-v1` JSON；通用门禁只比较它们的源码路径、指标和数值，不自行计算覆盖率单位。零命中要求至少一个真实非零分母且所有实测命中为零；非零命中要求至少一个命中大于零。空原生数据经 source map 转换显示 100% 必须被挡下。探针计划、命令/退出码、两份输出、原生哈希及首次失败都留在本 ID 的 local 工作流目录。发现矛盾时新建准备尝试后复测，不发布该范围为 `measured`。还要用轻量的失败路径证明“采集路由未启动、原生快照缺失或收尾未完成”与“路由已运行但计数为零”可区分；前者的受影响文件/指标应为 `incomplete` 或 `unavailable` 并说明缺口，不能借零命中基线显示为实测 0%。失败路径不执行业务场景，原始输出与重验结果留在本 ID 的 local 目录。

独立 Agent 入口为 `node <skill>/playbook/v4/run_coverage_preparation.mjs <request.json> <new-workflow-output-dir>`。请求 `project-coverage-agent-request-v1` 至少包含本 ID 最新的 `acceptance` 知识读取绑定、`runtime_manifest / runtime_sha256`、完整 `source_hashes`、`inventory_path / inventory_sha256 / registry_path`、`test_roots`；Agent 输出项目适配器和探针计划，宿主亲自执行上述探针、冻结准备文件并调用 `coverage_protocol.preparation()`。本次新知识读取凭证可以比运行环境创建时的新，但 ID 和 scope 必须一致。Agent **不得直接修改共享知识**；它只提出 `knowledge_candidate`，宿主在探针和准备文件通过核验后审查，再写入项目 `.acceptance/knowledge` 并通过分层索引校验。结果 `handoff.json` 明确 `ready / partial`、准备路径/摘要、运行环境路径/摘要、探针路径和限制；失败时保留 `agent.jsonl`、首次回答、探针与 gate 输出及 `metrics.json`，状态为 `blocked`。实际安装物和探针留在本次验收 local。零/非零探针只证明采集能力，后续业务用例仍须按下述 `run → finish → verify-report → summarize` 逐次采集和验证，探针数字不得算入业务结果。

若本项目有明确预期可测的源码，请求可给 `expected_measured_sources`（冻结 `source_hashes` 中的路径）。Agent 须针对这些文件验证已有方法、尝试修正或替代，并给出零命中、定向命中及独立读取依据；不能把首次工具失败直接当作项目不支持。`handoff.json` 同时列出目标与 `unmet_expected_sources`，供宿主核对本项目准备目标。它不改变 `partial` 的通用含义，其他项目可以按自己的范围接受部分采集。准备探针通过后，宿主还须使用实际用例入口检查 `run → finish → verify-report → summarize`，确认目标源码在真实用例的同次原生数据中有可信指标，然后才宣称该项目目标已实现。

复测请求可附 `prior_attempts` 路径，由 Agent 只读失败收据与适配器快照，不覆盖前次资料。宿主在探针后立即调用项目入口 `verify-preparation`；既有适配器若还依赖旧版私有准备字段，必须在项目测试目录内更新后重试，不能因探针通过而跳过完整准备验证。

准备 Agent 的实际输入同时包含完整的 [覆盖率工具规约](coverage-tool-contract.md)。项目适配器与独立读取器均应使用专用工具的原生报告或受支持统计入口；读取工具内部 parser、原始行或 arcs 后自行计算分母与命中仍不符合规约。宿主检查最终 argv、运行 cwd 和源码路径绑定，并以真实零/非零探针及完整准备验证决定是否就绪。

首次准备失败不等于项目无法采集。调用方先查看失败收据和已冻结的适配器，再用新尝试目录及 `prior_attempts` 交给同一职责的 Agent 做有依据的最小修正，复用已验证环境，不重新安装或推翻已有路线。连续两次修正后先衡量进展、用户影响和替代入口；有明确小缺口且正在收敛时才继续，避免无界重试。仍失败的路由与范围保留为具体限制；不得改成 `ready`、擅自关闭用户要求的覆盖率，或用人工修好的适配器冒充 Agent 自主准备成功。宿主在运行探针之前冻结源码、适配器和哈希清单，失败尝试也可复现；后续探针及完整准备核验仍须确认活跃文件没有改变。

catalog 的 `coverage` 使用：

```json
{"policy":"required","protocol":"project-coverage-v1","prepared":"/absolute/new-prepared","prepared_sha256":"<manifest SHA256>","inventory_path":"/absolute/frozen-inventory.json"}
```

`prepare_project.py` 调用项目验证入口并激活策略。场景继承配置，旧模板不得降级或替换绑定。先结束仍使用旧准备的活动执行，再激活新准备；不修改旧 catalog 或报告。

## 项目入口操作

所有操作读取 request JSON、写 response JSON，失败返回非零退出码。请求包含 `artifact_map` 时，只读处理使用指定同哈希归档副本，不改原报告内的路径或字节。

| 操作 | 请求与响应 |
| --- | --- |
| `verify-preparation` | 请求 `prepared` 指向 manifest 文件；实测准备能力、版本与冻结资料，响应 `status: valid`。 |
| `run` | 请求为宿主冻结的执行会话，含 `cwd, output, scene_id, command, env, files, coverage, prepared, prepared_sha256`。以成熟工具运行原业务命令，保持业务断言和退出码：适配器进程实际返回业务命令的退出码，并把业务 stdout/stderr 透传给宿主冻结日志；只在 response JSON 记录 exit_code 而返回 0 不符合约定。在本轮输出内保存原生数据并可靠收尾。 |
| `finish` | 请求 `request, receipt, output`，分别指冻结会话 JSON **文件**、真实收据与输出目录。读取该会话后，其 `prepared` 是准备**目录**，manifest 位于 `<prepared>/prepared.json`；不要把目录直接当 JSON 文件打开。生成下面的规范化报告，不能把测试失败变成成功。 |
| `verify-report` | 请求 `report`；从绑定原生资料用相同专用工具重算并核对报告，响应 `status: valid`。不能只检查汇总 JSON 自身。 |
| `summarize` | 请求 `reports, inventory`。检查兼容性后由专用工具合并和筛选，响应 `tools, scopes`；三个 scope 为 `project, changed_files, changed_lines`。 |

宿主入口始终为 `run_evidence_v2.py --coverage-config <配置> ... -- <业务命令>`，本地调试也走同一链路。直接补采可使用 `run_coverage.py <request.json>`；仍须 acceptance、同一工作区、实际场景、测试文件与输出绑定。每次使用新输出目录。业务失败的可靠计数仍可登记；没有执行收据、版本不符或来源错误不能登记。

## 报告与统计

`coverage-report.json` schema 为 `project-tool-coverage-report-v1`，protocol 为 `project-coverage-v1`。必需 `prepared, prepared_sha256, scene_id, revision, source_hashes, tools, collection_relation: same_run, status, receipt_path, execution_sha256, raw_evidence, components`。报告的 `prepared` 必须与冻结执行会话的 `prepared` 目录字符串一致，`prepared_sha256` 是该目录下 `prepared.json` 的字节摘要；加载 manifest 时使用的文件路径不能替换报告的目录身份。

收据必须绑定实际覆盖率会话及其 SHA256，场景、版本、准备和执行 argv 必须一致。原生数据逐一记录 `{path, sha256}`；适配器可增加原生数据角色等元数据。

每个 component 包含 `id, label, source_paths, line, branch`，源路径必须属于冻结清单。行和分支分别保存工具给出的 `status, covered, total, pct`；不能计算的指标保存 `status: unavailable` 和具体 `reason`。禁止通用脚本或 UI 自行构造覆盖率单位与统计数字。混合语言保留各自 component 和分支口径，无法可靠合并时不制造总百分比。数据缺失、强制终止或收尾丢失必须明确 `incomplete`，保留真实已采部分及缺口。

`summarize` 返回每个 scope 的 `status` 及工具汇总的 `components` 或 `line/branch`。不支持某范围时返回具体原因，不用全项目数字充当修改行统计。范围来源必须与准备的 inventory 一致。首个提交的全部源码确实均为新增时，可记录该依据并使用原生全文件统计；这是项目适配决定，通用 Skill 不作此假设。

持续索引对同一准备按场景选最新有效采集，保留旧条目。采集不新增业务结论，不改变场景分母，不把旧 `unavailable` 记录改成实测。视图每次验证来源，统计缓存不能绕过收据、探针或范围变更校验。

## 归档与展示验证

`acceptance_store.py archive <项目> <ID> --source <本ID/workflows下共同父目录> --coverage-report <报告相对路径> --basis <已筛选脱敏依据>` 是显式覆盖率发布配置，可重复指定报告。程序验证后只选取报告、manifest、原生数据、准备证据、真实收据/日志、会话、inventory 和同哈希冻结源码/适配器；不扫描运行目录。索引快照和其他已审阅资料使用 `--files` 明确列出。依赖越出 source 或缺少冻结适配器副本时先拒绝，再修正准备/发布目录，不能扩大成递归打包。

若项目报告还有执行请求、采集生命周期等辅助文件，可在报告顶层用 `{ "path": 绝对路径, "sha256": 哈希 }` 声明。通用协议在展示与发布前验证这些绑定，归档只纳入声明且位于本次 workflows 内的同哈希文件；未声明的项目私有边车文件不会靠目录扫描被补入。

正常 v4 验收可用 `archive <项目> <ID> --source <共同workflows父目录> --v4-scene <场景相对目录> --basis <已筛选脱敏依据>` 一次发布最终复审元数据及其同次原生覆盖率。程序从 summary → 最终 review/input → 对应 coverage wrapper 自动确定返工后的真实报告，并核对报告和收据哈希，不按目录名猜轮次，也不误选首次执行。旧 `--v4-result` 仍只发布固定元数据；独立补采使用 `--coverage-report`。两种新选项均不递归打包所有调试或业务状态。旧验收/原生资料字节、哈希、时间和业务结论均保留。

发布覆盖率时，仍能调用项目工具的本次运行环境会生成项目工具负责的 `coverage-summary.json`，绑定精确的报告路径、SHA256 和准备摘要，并纳入归档哈希清单。历史视图先核验冻结报告、原生资料、探针、源码和适配器；若本次运行环境已退役，仅对完全相同的报告集合读取这份项目工具摘要。摘要缺失、集合不符或字节变化时显示不可用，不从通用脚本重算或猜测统计。需要跨多份归档合并时，归档时须提供对应的完整报告集合；单份快照不能冒充跨场景汇总。

覆盖率补采不需要伪造 trace。现有 `project-context.json` 的 `acceptance` 与 `coverage_registries` 可登记补采索引，视图只把通过来源校验的真实采集附到同场景、同版本业务行。完整场景清单仍是统计分母。验证包括实际浏览器页面、三个范围、行/分支、工具版本、旧业务结论保留，以及暂移原采集目录后从归档同哈希依赖读取；验证后恢复目录，不删除旧证据。

旧 `istanbul-source-v1` 的实现与报告保留在明确的 legacy 路径，仅用于已存在的准备/历史读取。新项目使用本协议，不把旧示例当作工具选择白名单或必备运行时。

准备 Agent 可用 `probe_plan_path` 明确引用本 ID workflows 内已有完整计划，以避免重复录入长路径。宿主检查相同 runtime、workspace 和 revision，保存引用哈希并在新准备重新执行全部探针；它不复用旧的通过结果。也可继续输出完整 `probe_plan` 对象，两者互斥，任何实际 argv 都不能使用省略号。

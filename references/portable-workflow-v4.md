# v4 场景与用例执行入口

此路径适用于有冻结 Git 版本、可建立隔离工作树并能在本地自动执行测试的项目。语言、应用类型、测试框架、业务预期和覆盖率工具由项目输入决定。无源码的黑盒目标、必须人工操作的场景和无法建立隔离工作树的项目继续走 [v3 可移植执行路径](portable-workflow-v3.md)，不能伪造自动测试结果。全量需求分析和提交/PR 白盒逆向继续使用 v3 已验证入口；v4 更换其后的单目标场景生成和单场景用例执行过程。

## 项目验收存储前置门禁

先遵守[目录、稳定验收 ID 与 knowledge 规约](project-acceptance-store.md)。启动/恢复先读取 `.acceptance-local/current.json`；配置中的 `acceptance.id` 必须与之相同。没有指针不能从旧配置自动激活；整项验收结束由宿主 `finish` 清除指针，单场景/批次终态不清除。视图切换只读，不绑定对话。准备 spec、场景 request、case template 和计划均携带 `read-knowledge` 输出的 `acceptance` 对象；所有新阶段输出在 `.acceptance-local/<同一ID>/workflows/` 内。`prepare_project.py`、`bind_case.py`、`run_plan.py`、`run_scenarios.mjs`、用例及修复入口强制校验，单场景编排在阶段交接再次校验。目录/知识问题不执行项目命令、不改场景结论；范围变化追加记录并创建受影响的新尝试，不换验收 ID。若旧 catalog 的知识收据失效，或调试授权目录在 Case Agent 启动前被宿主门禁拒绝，且核对场景输出只有准备记录与未启动的调试契约、没有模型会话或测试副作用，可用 `retire_pre_agent_case.py <config.json> --knowledge-receipt <本次新收据> --basis <检查依据>` 终止无副作用的旧尝试，再用新 catalog 绑定；不能覆盖旧目录或把该停机当作产品结论。正式用例融合项目测试/回归体系，未融合的工作树用例须如实标成候选。

## 项目只准备一次

准备时必须执行[覆盖率专用工具规约](coverage-tool-contract.md)：按项目语言/运行时确定专用采集、转换、源码映射及合并统计模块，记录真实版本、调用和指标能力。禁止让用例 Agent 自行实现分支识别、AST 分母或转译还原算法。

先冻结目标 Git revision、项目拥有的非测试源文件、测试目录及组件版本，并为本 ID 建立唯一 workspace。项目环境与覆盖率是两个**顺序执行、会话独立**的 Agent 职责：先运行[项目运行环境准备](project-runtime-preparation.md)，宿主检查实际环境、测试入口与冻结记录；只有覆盖率策略为 required 时才运行[项目覆盖率准备](project-coverage-protocol.md)，它只能消费前一步已核验的环境记录，不能另建一套未绑定的测试运行时。后一个 Agent 结束后，宿主检查源码/进程范围、适配器、零命中和轻量非零命中探针，再建立最终 catalog。两个 Agent 都不执行业务场景，彼此不靠会话记忆交接。新准备的 `prepare_project.py` 只验证 Agent 交接与项目能力检查，不再次执行安装；同一 revision 的场景复用最终 catalog。可用 `prepare_project_semantics.mjs` 补充只读操作路标；其 `guide.json` 不是业务预期依据。每次场景执行另建业务状态和输出，不能沿用上一场景的账户、数据库或页面状态。

```sh
node <skill>/playbook/v4/run_runtime_preparation.mjs runtime-agent-request.json <project>/.acceptance-local/<ID>/workflows/<runtime-attempt>
# 需要覆盖率时，先检查 runtime/runtime.json，再执行独立覆盖率 Agent：
node <skill>/playbook/v4/run_coverage_preparation.mjs coverage-agent-request.json <project>/.acceptance-local/<ID>/workflows/<coverage-attempt>
python3 <skill>/playbook/v4/prepare_project.py prep-spec.json prep-output
node <skill>/playbook/v4/prepare_project_semantics.mjs prep-output/catalog.json prep-guide-output
```

`prep-spec.json` 至少包含 `schema: portable-project-prep-v1`、`preparation_protocol: two-agent-v1`、`runtime: {manifest, sha256}`、`project_root`、`revision`、`test_roots`、`source_paths`（完整非测试用户代码清单，可为空但覆盖率项目分母会不可用）；按需提供 `components`、`binding_files`、`ready_markers`、`capability_checks`、`runner_hints` 和覆盖率 Agent 冻结配置 `coverage`。运行时安装命令属于独立运行环境 Agent，不能再填入此 spec 的 `setup_commands`。命令和环境变量是数组/对象输入；不得在 SKILL 中编码项目路径。`source_checkout` 可指定作为初始来源的检出目录，缺省取 `project_root`；准备入口在验收唯一 workspace 中运行，catalog.project_root 返回该目录。场景 request 与后续 case template 使用返回目录；acceptance.project_root 保持用户项目根目录。产品修复后的新提交使用同一 workspace、新 revision 和新准备输出，禁止自动 reset 或新建场景工作树。

项目若有覆盖率采集必需的框架适配/资源所有权夹具，在 spec 的 `coverage_test_files` 数组声明项目内路径。它们必须存在于 `test_roots`，不能同时列入产品 `source_paths`。准备保存其哈希，项目策略、场景执行与本地调试继承并自动加入这些文件的绑定和导入适配，不能靠 Agent 每次猜全依赖。夹具字节变化需新准备，不改旧 catalog。具体文件名、运行时版本查找与源码/测试资产分类属于项目知识，通用流程不猜测。

覆盖率激活策略属于实际执行工作树的 Git 目录；同一 Git 仓库内多个验收项目各有专用工作树时，不得把策略写入共享 common-dir 以免互相替换绑定。准备目录与索引仍由各项目 spec 指定；修正策略位置后须重新激活每个项目的冻结准备，并保留此前绑定失败的原始记录。

把归档提交或搬到别的检出目录后，必须在**不含旧 `.acceptance-local`** 的新检出中读结果视图；覆盖率注册路径应映射到归档中的冻结字节并复核哈希，不能借旧机器上的绝对路径读到旧运行目录。归档清单列出的文件即使命中项目 `.gitignore`，也须完整纳入交付归档；提交前用 `python3 <skill>/scripts/check_archive_checkout.py <项目>/.acceptance/<ID>` 检查归档文件均已进入 Git 索引且与工作区一致。此检查只用于准备共享 Git 检出，不要求仅本机使用的归档提交；缺文件时视图应报证据缺失，不能静默显示成功。

**准备完成时的检查：**宿主在现有准备交接中核对以下内容，不另建阶段或检查报告格式：

- 沿用现有检查，区分其职责：`guard` 核对验收身份、当前指针、范围和知识凭据；准备入口核对源码/组件版本与工作树。再对照 spec、`catalog.json` 和 `terminal.json`，确认 terminal 的 `state` 为 `prepared`、`fingerprint` 与 catalog 一致、`catalog_sha256` 匹配实际 catalog。`acceptance_store.py check` 只做存储结构等校验，不能单独证明准备完成。
- 对照声明的 `ready_markers`、setup 和 `capability_checks`，确认所需标记存在，每项实际执行的检查都有命令及结果，失败未被忽略。标记已就绪时 setup 可以按既有逻辑跳过；合法复用准备时引用原有凭据，不冒称本次重新执行。缺记录或输入不符时不能标为已检查，也不为补记录而重跑已合法完成的准备。
- 结合本次范围和项目测试约定，确认这些检查足以支持即将使用的测试入口、隔离和清理方式。这项由宿主阅读判断，程序不能证明声明完整；不适用或尚未验证的能力说明理由，不把空检查列表当作所有能力已就绪。不因此强求其他项目安装浏览器、数据库或新增基础设施门禁。
- 要求覆盖率时，确认项目选用的专用工具和项目内适配器的准备验证通过，尤其检查[非零命中适配器全链路探针](project-coverage-protocol.md#准备产物)与同一原生数据的工具直接结果一致；工具、源码和统计范围与 catalog 绑定。工具能力缺口按覆盖率规约说明。准备检查不代替业务用例执行或独立复审。

在现有准备记录或交接说明中引用上述检查依据；发现缺口先修正配置/准备或明确限制，不能靠勾选、重跑业务用例或扩大测试范围补齐。

## 单目标场景

需求列表、整体目标和范围来自 v3 前置分析；PR 的白盒目标先完成 v3 `reverse/run.mjs`，其 `result.json` 必须通过自身门禁。场景请求使用 [v3 场景请求字段](playbook-inputs-v3.md#one-requirements-scenario-list)，一次指定一个 `target_requirement_id`，传完整原始需求与关联分组。白盒提供 `reviewed_reverse_path` 和 SHA-256；含需求的 PR 黑盒目标提供 `pr_reviewed_reverse_path` 和 SHA-256。v4 Agent 在同一次过程内生成并自审场景，额外留下 `selfcheck.current.json`：目标原文义务到场景 ID、每条场景的具体判据与失败影响，以及无法形成可执行判据的明确缺口；原文明确允许多种相反结果且没有共同必达行为的片段单列 `not_required_reason`，不误计为缺口。结构门禁检查片段确属目标、场景 ID 映射完整；它**不证明语义正确，也不是独立场景 Reviewer**。场景目录仍只含简洁场景五字段，目标缺口不能当作已覆盖。结构通过仅表示列表可供后续用例实现，不证明业务覆盖绝无遗漏。待确认规则不生成场景。

```sh
node <skill>/playbook/v4/run_scenarios.mjs scenario-request.json NEW-scenario-dir
```

中断后，确认原进程已退出、需求/范围/逆向依据未变化，再对原请求及目录加 `--resume`。完成的 `terminal.json` 绑定请求、`scenarios.current.json` 和 `selfcheck.current.json` 哈希，并记录未覆盖义务数；非零时不可声称该需求场景充分，即使已有其他可执行场景。重复调用直接复用。发布项目场景清单时，把每个 `gap_reason` 连同目标 ID、原文连续片段及原因写入 catalog 的 `design_gaps`；明确许可片段的 `not_required_reason` 不列入缺口。结果视图须展示该缺口，不能只显示场景数量。场景描述、等级或用户范围发生实质变化时，创建新目录，保留旧版本。

## 单场景用例、真实执行与独立复审

为一个场景准备 `case-template.json`，使用 `bind_case.py` 从已完成的场景列表冻结场景、主需求/规则、相关需求、范围和证据版本。模板必需 `scenario_run_path`、`scene_id`、`source_checkout`、`template_catalog`、`guide`、`case_run_dir`；可选 `component_sources`、`allowed_test_roots`、`local_loopback_required`、证据路径配置和 `coverage`。`bind_case.py` 输出 `case-input.json` 与 `config.json`。纯需求黑盒场景可先在验收项目根目录生成，再绑定到同一验收 ID 的已准备 workspace；PR/白盒场景仍须保持冻结源码版本和工作树一致。一验收一个共用 workspace，一场景一个运行目录；绑定要求新 catalog 的 `workspace_policy: single-acceptance-v1`，source_checkout 必须指向该 workspace。准备、执行、复审持有验收级互斥锁，中断场景保留恢复归属，下一场景不能越过。各阶段复核产品版本/源码哈希，允许前面场景的测试修改保留。项目原始需求和产品源码不得由用例 Agent 改动；授权产品修复在验收阶段之间完成，随后新冻结版本并复验。

```sh
python3 <skill>/playbook/v4/bind_case.py case-template.json NEW-handoff-dir
python3 <skill>/playbook/v4/scene_pipeline.py NEW-handoff-dir/config.json
```

用例 Agent 在一个连续过程内自行读取所需源码/测试、选择现有或新用例、实现测试并本地调试，提交测试文件、命令和真实观察。调度器验证只修改声明的测试目录，然后在新目录冻结执行原命令，保存意图、日志、退出码和文件哈希；独立 Reviewer 只读检查场景判据、用例可靠性、真实路径、证据和结果。`repair_required` 中属于测试代码/证据的明确缺口可有限次差量修复，再生成新的执行和审查凭证；场景边界或业务合同问题停在待确认，不靠修测试代码“通过”。用例 Agent 的 `passed_local` 不是最终结论；只有独立复审的 `passed` 或有可靠失败证据的 `product_bug` 才是已判定结果。

原生应用在 Agent 调试环境启动受限、而项目准备已实测宿主能运行时，用例 Agent 可交付 `host_ready`：测试文件、原始业务命令、隔离方式和静态检查已就绪，同时明确哪些业务断言尚未在本地执行及环境错误。调度器仍须正式冻结执行，独立 Reviewer 只依据该次真实执行判断；`host_ready` 本身没有产品结论。若宿主也无法运行或命令未就绪，仍为 `blocked`。

用例及差量修复入口自动生成各自的 `debug-contract.json`，向 Agent 直接提供 `debug_case.py run <contract> <request>` 的绝对入口和 `request_root`。请求写在该根下，仅传原始业务 `command`、`files`、`env` 及可选的全新 `output`；不再查找 Skill 或自行组装底层采集请求。入口校验当前指针、知识/输入/目录绑定及场景互斥所有权，每次新建本 ID 下的调试尝试并沿用已准备的专用 collector。模板中的 `fresh_env_root_key`、`fresh_env_paths`、`evidence_env_dir_keys` 同时供调试与宿主执行使用，目录语义由项目声明；调试的这些输出变量不能指向其他位置。当用例判据依赖正式执行目录内的界面或其他观察文件时，模板必须用 `evidence_execution_relative_paths` 精确声明相对路径；宿主只冻结该执行内部存在、未越界的输出，Reviewer 不得把未冻结的观察文件当作场景通过依据。先核对项目适配器的最终环境变量覆盖关系：同一证据变量若由适配器重定向到执行目录，就不能再用 `fresh_env_paths` / `evidence_env_dir_keys` 声明另一个目录，否则冻结器会追踪不存在的路径。低层覆盖率执行也从激活策略继承 acceptance，省略 request.acceptance 不能绕过目录门禁。调试结果不自动成为独立判定，最终 `test_command` 仍须是原始业务命令。

用例和差量修复运行时通过 SDK 的 `additionalDirectories` 授予宿主验证过的精确调试根、覆盖率准备及索引目录，目录列表保存在运行指标中；cwd 仍为唯一 workspace，网络策略保持项目声明。租约检查只读打开宿主已持有的锁文件。不能靠把 cwd 改成项目存储根、开放网络或在项目里替换运行时依赖解决调试目录不可写；这类宿主问题须修复通用入口后用新冻结尝试复测，保留原失败。

多个目标可用 `run_plan.py` 顺序调度。计划输入为 `schema: acceptance-v4-plan-v1`、`run_dir`、`scenario_requests` 数组、共享 `case_template` 对象，按需用 `selected_scene_ids` 限定低成本试跑。它只编排已冻结的目标请求，不自行扩张 PR 范围，也不把部分场景结果宣称为整份 PR 通过。重复启动核对输入、场景终态、交接哈希与每个单场景状态，只继续未完成阶段。

```sh
python3 <skill>/playbook/v4/run_plan.py plan.json
```

整份 PR 另需先由 v3 `pr-targets.mjs` 从冻结逆向结果生成完整目标清单，再运行 `complete_pr.py pr-targets.json plan.json pr-result.json`。该门禁要求计划覆盖每个黑盒/白盒目标一次、没有 `selected_scene_ids` 子集、每个目标的全部生成场景都有同一 PR head 上的冻结执行与独立判定，并检查交接及审查哈希；待确认行为或缺失场景使 PR 状态为 `blocked`。全部已判定且有产品 BUG 时输出 `bugs_found`，全部通过才输出 `passed`。计划执行完成本身不是 PR 验收通过。

## 覆盖率与实时视图

此阶段及离线补采/重算必须遵守[覆盖率专用工具执行规约](coverage-tool-contract.md)。行与分支统计只接受对应专用工具的正式支持流程；适配器只做调用、格式/路径转换、证据绑定、基于工具位置的范围筛选及展示。禁止自制 AST 基线、命中推断、语义还原或计数合并来绕过工具缺口。缺失、不可兼容或不可可靠映射的数据单独标注，不能凑数。覆盖率区域同时注明采集、转换/映射、合并/统计工具的名称与版本；范围切换同步重算行与分支。用户限制不重跑、不做独立复审或不扩大范围时继续遵守，不能由覆盖率处理暗中启动这些动作。

`case-template.coverage` 可以记录实际验证后仍无法采集的 `unavailable`（具体原因），或用户明确关闭的 `off`。持续采集时，由项目准备阶段根据实际语言、框架和进程选择成熟工具，生成项目内配置/夹具并实测；通用 Skill 不注册语言或工具白名单。新 catalog 保存 `{ "policy":"required", "protocol":"project-coverage-v1", "prepared":"/absolute/prepared", "prepared_sha256":"manifest摘要", "inventory_path":"/absolute/change-inventory.json" }`；格式及项目操作见[项目覆盖率准备协议](project-coverage-protocol.md)。`bind_case.py` 自动继承配置，场景不能降级；调试、正式执行和差量执行通过同一 `run_evidence_v2.py --coverage-config` 链路。项目准备、证据冻结和展示强制验证原生报告、工具版本、源码、范围及实际场景/执行绑定，统计全部由项目选用的专用工具负责。保留失败用例的可靠计数和旧验收结论；缺口明确 `incomplete/unavailable`，不把覆盖率当业务判定。旧 provider 仅保留既有准备/历史读取兼容。

`python3 <skill>/scripts/v3/serve.py <项目目录> [--acceptance-id AT-<ID>]` 可读 v4 的 `request.frozen.json`、阶段 `state.json`、冻结收据、覆盖率和审查结果；对场景显示“内部自审”，不会误标为独立场景审查。视图只读所选验收 ID 的完整项目场景清单及已有执行、复审和用户决策，可切换历史/当前 ID；不能把批次总数当项目分母或混入其他 ID 的结论。缺完整清单则不显示项目比例。旧产物目录用显式 `--legacy-assets` 只读入口，不自动迁移。

统一使用[项目统计口径](project-state-statistics.md)：所有场景指标以项目全部场景数为分母；一个场景执行过任何一次用例就算已执行，版本、成败、业务链路是否完成和风险处置均不改变执行事实；按场景 ID 去重。结果取最近一次已确认结论，新版本或准备重跑不自动变成“待复验”。接受风险单列，未曾形成有效结论的已执行场景列为“待确认结论”；各互斥结果分类之和必须等于已执行数。视图/API均核对该等式。保留原始收据、复审和实际版本；同版本 PR 交付仍使用原有完成门禁，不能由项目保留结果推断新版本全部重测通过。实时视图只读，不代替原始 JSON、日志与证据。

正常 v4 视图直接读取最终复审指向的执行、用例与覆盖率；需求验收也冻结 collector inventory，不要求手写 `trace.json`。`project-context.json` 仅在仅补采索引、跨版本 cohort 或迁移需要时使用。启用 `project-coverage-v1` 时，默认归档入口是 `acceptance_store.py archive <项目> <ID> --source <含准备与场景的共同workflows父目录> --v4-scene <场景相对目录> --basis <已筛选脱敏依据>`，自动跟随 summary 的最终 review/input 选择当前实际执行、独立复审及同次原生覆盖率，返工后无需猜轮次。独立补采使用 `--coverage-report`；详见[公开归档配置](project-coverage-protocol.md#归档与展示验证)。无覆盖率或只需固定元数据时仍可使用 `--source <本场景目录> --v4-result`，它只选择 request、state、summary、实际 case answer、review answer/input/metrics/decision-gate、对应 execution 收据/日志与 coverage wrapper。额外实际观察用 `--files <相对路径...>` 选择；所有模式都在复制前检查完整性与目录，不递归打包 debug、业务状态、环境或会话。缺原生依赖时明确不可复算，不补造。归档保留请求来源、原时间及版本，同一来源的部分归档不覆盖完整本机工作流，不成为新的执行时间；原目录不在时，完整归档仍保留已确认结论及经过哈希核验的项目工具统计快照。

复审结论须与冻结执行一致：成功命令仍有断言缺口时返回 `repair_required`，保留产品观察，补齐测试后再冻结执行；`product_bug` 需要失败执行及产品证据，或经独立审查的冻结截图直接证明 UI 缺陷。结构门禁拒绝已完成复审时，宿主最多创建一次新的只读补正审查，保留原回答、门禁和绑定输入，不替 Reviewer 改判、不重跑产品命令。补正仍无效则停下；补正中断仅恢复同一尝试，已完成的补正可验证后采用。历史上因此 parked 的 review 也仅在输入、会话原答、执行日志与测试字节仍匹配且未用过补正预算时恢复；其他 parked 不自动重试。

UI 目标的场景生成在同一目标自审中记录 `ui_requirement` 与每条场景的 `ui_visual_expectation`；场景本身仍保持简洁五字段。视觉判据涵盖关键状态的无遮挡/裁切、可读性、合理布局和项目风格，同时保留原功能判据。项目内 case template 必须声明正式执行生成截图的 `evidence_execution_relative_paths` 或 `evidence_env_dir_keys`，项目自行选择截图工具、窗口/视口和设计参照。用例必须在同次正式执行保存关键状态截图及窗口上下文；宿主冻结图片，并将图片像素作为多模态输入交给独立 Reviewer。路径、DOM 描述或图片文件存在本身不能证明看过画面；门禁核对 `ui_review` 引用的图片与该次 Reviewer 实际输入的路径和哈希。没有图片或无法查看时只能标记 `unverified`，不得宣布场景通过。`passed`/`failed` 的视觉结论必须列出冻结 manifest 中的图片路径；即使业务命令退出 0，截图明确证明的视觉缺陷也可判产品 BUG。v4 归档跟随最终复审自动选取所引用的图片与 manifest，结果视图单列 UI 结论及截图链接；旧的功能判断不被追溯改写。

## 恢复边界

场景与执行复审都须回到原始需求或独立确认的合同。生成场景中的预期不是新增合同；用户确认原文也不默许生成后的交互策略、字段完整性、同步时机或格式要求。能证明原文违约的测试条件可保留，无依据的预期应报告 scenario/contract 缺口，不能靠补一条失败断言升级为产品 BUG。旧判断及实际观察保留；后续合同纠正需新的场景/尝试版本，不能覆盖历史回答。报告同时说明冻结场景的原始判定及原文能支持的交付结论。

缺口分类按实际需要处理：若原场景仍可按原文执行，只是测试代码对无关字段、顺序、响应结构或内部机制加了约束，使用 case_code/case_design finding 进入有限修补，移除超额约束并保留业务检查。只有修补需要改变冻结场景的业务预期或选择未定行为时，才使用 scenario/contract 停下；不要为可直接修正的测试代码要求用户补业务合同。

返工 Agent 返回 `needs_contract` 时，当前冻结绑定不再可用于执行；即使回答里仍有旧 `test_command`，也直接结束本场景为 `needs_scope_or_contract`，不再启动正式执行。若原因是项目覆盖率适配器或夹具变化，先为项目新建准备与 catalog，再用同一场景原文创建新尝试；旧复审、原生数据和错误报告保持原样。历史上已因这种返工进入 `parked`、且后续执行没有创建输出或收据的场景，可在核对原配置、修复回答、工作区归属和存活进程后调用 `python3 <skill>/playbook/v4/retire_contract_rebind.py <旧场景config.json> --basis <具体核查依据>`。入口仅记录无业务结论的旧尝试退役并释放工作区，不改旧状态或补造通过；已有执行输出、仍运行的阶段或不匹配的归属会拒绝退役。

若首次 `prepare` 的项目能力检查失败并停驻，先检查失败命令及其工作区副作用，修正项目内准备，再调用 `python3 <skill>/playbook/v4/retire_parked_prepare.py <旧场景config.json> --basis <具体核查依据>` 退役旧尝试。此入口只接受唯一的 `prepare: parked` 阶段、未生成场景 catalog/执行/总结且原配置、输入、工作区归属和产品源码均匹配的情形；留下无业务结论的退役收据后释放归属。若已有其他阶段、输出或无法解释的副作用，保持停驻，人工核查后按新冻结尝试处理，不复用旧输出。

用例与差量修复都已返回 `blocked`、且正式执行尚未开始时，核对两份回答、工作区归属、版本和运行进程后，可调用 `retire_blocked_case.py <旧场景config.json> --basis <具体核查依据>`。已有正式执行但证据阶段 `parked` 时，先核对冻结执行收据和失败原因，再调用 `retire_parked_evidence.py <旧场景config.json> --basis <具体核查依据>`。两者只记录无业务结论的退役收据并释放工作区，原状态、日志、原生数据与错误报告保留；随后以修正后的项目准备或测试绑定创建新冻结尝试，不能把退役当作测试通过。

对模型服务等原因留下的明确 Agent 错误终态，重新调用原公共计划/场景入口可有限恢复：仅当会话 trace 有错误且无成功终态、原 runner 与调试子进程已退出、输入/版本/测试目录绑定仍匹配时，沿用原会话一次；本地服务还必须声明安全恢复。恢复记录保存原错误、指标和 trace 哈希，次数跨阶段重启保留。再次中断或无法核实的错误继续 parked；已完成的测试失败、合同缺口和确认结论不按中断重试。结构补正 Agent 的错误仍按其保守边界停下，不藉此增加补正预算。

每个阶段只在前一阶段留下可验证的绑定和凭证后交接。修复 Agent 中断时，先核对输入哈希、Git revision、测试目录内的已修改文件和会话事件，再继续同一 session；不重新启动一个可能再次修改同一文件的新 Agent。若用例 Agent 接触本地服务且无法证明其效果可安全继续，默认停下；只有项目明确提供隔离/幂等保证，才设置 `resume_safe_after_local_loopback`。若会话无法恢复且已有无法确定的文件或外部效果，保持 `parked`，由人检查后创建新冻结尝试。执行阶段已有完整收据则接续；只有在项目明确声明“本地隔离重跑安全”且能建新鲜状态目录时，才允许对无收据执行另开一次尝试。仍存活的执行进程或外部效果不确定时停下。只读 Reviewer 会话无法恢复时，可保留失败记录并有限次新开审查，不重新执行测试。变更需求、范围、规则、场景或产品版本需新下游版本；验收期间保留旧证据；验收通过并保存代码、需求—场景—用例关系、确认结论与工具摘要后，原始数据可按[清理规约](project-acceptance-store.md#验收结束与本机清理)删除，不要求长期占盘。

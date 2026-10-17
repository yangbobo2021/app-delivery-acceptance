# v4 场景与用例执行入口

此路径适用于有冻结 Git 版本、可建立隔离工作树并能在本地自动执行测试的项目。语言、应用类型、测试框架、业务预期和覆盖率工具由项目输入决定。无源码的黑盒目标、必须人工操作的场景和无法建立隔离工作树的项目继续走 [v3 可移植执行路径](portable-workflow-v3.md)，不能伪造自动测试结果。全量需求分析和提交/PR 白盒逆向继续使用 v3 已验证入口；v4 更换其后的单目标场景生成和单场景用例执行过程。

## 项目只准备一次

准备时必须执行[覆盖率专用工具规约](coverage-tool-contract.md)：按项目语言/运行时确定专用采集、转换、源码映射及合并统计模块，记录真实版本、调用和指标能力。禁止让用例 Agent 自行实现分支识别、AST 分母或转译还原算法。

先冻结目标 Git revision、项目拥有的非测试源文件、测试目录、组件版本及已有依赖的就绪标记。`prepare_project.py` 只执行项目输入中声明的 setup/能力检查命令，不猜语言或框架；同一 revision 的场景复用产出的 catalog。可用 `prepare_project_semantics.mjs` 在一个只读 Agent 过程中补充测试命令、夹具隔离和环境变量路标；其 `guide.json` 不是业务预期依据。每个场景的隔离工作树可能仍需安装或链接该工作树自己的依赖，catalog 不等于依赖已在所有工作树可用。

```sh
python3 <skill>/playbook/v4/prepare_project.py prep-spec.json prep-output
node <skill>/playbook/v4/prepare_project_semantics.mjs prep-output/catalog.json prep-guide-output
```

`prep-spec.json` 至少包含 `schema: portable-project-prep-v1`、`project_root`、`revision`、`test_roots`、`source_paths`（完整非测试用户代码清单，可为空但覆盖率项目分母会不可用）；按需提供 `components`、`binding_files`、`ready_markers`、`setup_commands`、`capability_checks`、`runner_hints`。命令和环境变量是数组/对象输入；不得在 SKILL 中编码项目路径。准备可能修改项目工作树时，先在隔离副本或专用测试工作树中运行。

## 单目标场景

需求列表、整体目标和范围来自 v3 前置分析；PR 的白盒目标先完成 v3 `reverse/run.mjs`，其 `result.json` 必须通过自身门禁。场景请求使用 [v3 场景请求字段](playbook-inputs-v3.md#one-requirements-scenario-list)，一次指定一个 `target_requirement_id`，传完整原始需求与关联分组。白盒提供 `reviewed_reverse_path` 和 SHA-256；含需求的 PR 黑盒目标提供 `pr_reviewed_reverse_path` 和 SHA-256。v4 Agent 在同一次过程内生成并自审场景，只有确定性结构门禁；**没有独立场景 Reviewer**。结构通过仅表示列表可供后续用例实现，不证明业务覆盖绝无遗漏。待确认规则不生成场景。

```sh
node <skill>/playbook/v4/run_scenarios.mjs scenario-request.json NEW-scenario-dir
```

中断后，确认原进程已退出、需求/范围/逆向依据未变化，再对原请求及目录加 `--resume`。完成的 `terminal.json` 绑定请求和 `scenarios.current.json` 哈希；重复调用直接复用。场景描述、等级或用户范围发生实质变化时，创建新目录，保留旧版本。

## 单场景用例、真实执行与独立复审

为一个场景准备 `case-template.json`，使用 `bind_case.py` 从已完成的场景列表冻结场景、主需求/规则、相关需求、范围和证据版本。模板必需 `scenario_run_path`、`scene_id`、`source_checkout`、`template_catalog`、`guide`、`case_run_dir`；可选 `component_sources`、`allowed_test_roots`、`local_loopback_required`、证据路径配置和 `coverage`。`bind_case.py` 输出 `case-input.json` 与 `config.json`。一场景一个独立工作树与运行目录；项目原始需求和产品源码不得由用例 Agent 改动。

```sh
python3 <skill>/playbook/v4/bind_case.py case-template.json NEW-handoff-dir
python3 <skill>/playbook/v4/scene_pipeline.py NEW-handoff-dir/config.json
```

用例 Agent 在一个连续过程内自行读取所需源码/测试、选择现有或新用例、实现测试并本地调试，提交测试文件、命令和真实观察。调度器验证只修改声明的测试目录，然后在新目录冻结执行原命令，保存意图、日志、退出码和文件哈希；独立 Reviewer 只读检查场景判据、用例可靠性、真实路径、证据和结果。`repair_required` 中属于测试代码/证据的明确缺口可有限次差量修复，再生成新的执行和审查凭证；场景边界或业务合同问题停在待确认，不靠修测试代码“通过”。用例 Agent 的 `passed_local` 不是最终结论；只有独立复审的 `passed` 或有可靠失败证据的 `product_bug` 才是已判定结果。

多个目标可用 `run_plan.py` 顺序调度。计划输入为 `schema: acceptance-v4-plan-v1`、`run_dir`、`scenario_requests` 数组、共享 `case_template` 对象，按需用 `selected_scene_ids` 限定低成本试跑。它只编排已冻结的目标请求，不自行扩张 PR 范围，也不把部分场景结果宣称为整份 PR 通过。重复启动核对输入、场景终态、交接哈希与每个单场景状态，只继续未完成阶段。

```sh
python3 <skill>/playbook/v4/run_plan.py plan.json
```

整份 PR 另需先由 v3 `pr-targets.mjs` 从冻结逆向结果生成完整目标清单，再运行 `complete_pr.py pr-targets.json plan.json pr-result.json`。该门禁要求计划覆盖每个黑盒/白盒目标一次、没有 `selected_scene_ids` 子集、每个目标的全部生成场景都有同一 PR head 上的冻结执行与独立判定，并检查交接及审查哈希；待确认行为或缺失场景使 PR 状态为 `blocked`。全部已判定且有产品 BUG 时输出 `bugs_found`，全部通过才输出 `passed`。计划执行完成本身不是 PR 验收通过。

## 覆盖率与实时视图

此阶段及离线补采/重算必须遵守[覆盖率专用工具执行规约](coverage-tool-contract.md)。行与分支统计只接受对应专用工具的正式支持流程；适配器只做调用、格式/路径转换、证据绑定、基于工具位置的范围筛选及展示。禁止自制 AST 基线、命中推断、语义还原或计数合并来绕过工具缺口。缺失、不可兼容或不可可靠映射的数据单独标注，不能凑数。覆盖率区域同时注明采集、转换/映射、合并/统计工具的名称与版本；范围切换同步重算行与分支。用户限制不重跑、不做独立复审或不扩大范围时继续遵守，不能由覆盖率处理暗中启动这些动作。

`case-template.coverage` 可以明确记录 `unavailable`（具体原因）或用户明确关闭的 `off`。持续采集时先按 [专用工具执行规约](coverage-tool-contract.md) 验证工具链并冻结工具生成的完整分母，项目 catalog 保存 `{ "policy":"required", "provider":"istanbul-source-v1", "prepared":"/absolute/prepared", "inventory_path":"/absolute/change-inventory.json" }`。当前注册实现服务于 JS/TS；其他语言须接入对应专用 provider，不以格式解析器冒充工具链。`bind_case.py` 自动继承项目配置，场景不能降级；执行和差量执行都通过 `run_evidence_v2.py --coverage-config` 调用同一个 `run_coverage.py` 入口。项目准备、执行前、证据冻结及展示汇总均强制验证。仅给 LCOV、`coveragepy-json` 或工具标签不能成为 `measured`。行/分支及嵌套分支、零命中分母、合并与汇总全部由专用工具负责，切换项目/修改文件/修改行范围同步筛选工具单位并重算。保留失败用例的实际计数，采集缺口明确 `incomplete/unavailable`；覆盖率不替代业务判定。

`python3 <skill>/scripts/v3/serve.py <project-assets-dir> [...]` 可读 v4 的 `request.frozen.json`、阶段 `state.json`、冻结收据、覆盖率和审查结果；对场景显示“内部自审”，不会误标为独立场景审查。查看目录须包含项目完整场景清单及已有执行、复审和用户决策；不能只传本批次目录而把批次总数当项目分母。

统一使用[项目统计口径](project-state-statistics.md)：所有场景指标以项目全部场景数为分母；一个场景执行过任何一次用例就算已执行，版本、成败、业务链路是否完成和风险处置均不改变执行事实；按场景 ID 去重。结果取最近一次已确认结论，新版本或准备重跑不自动变成“待复验”。接受风险单列，未曾形成有效结论的已执行场景列为“待确认结论”；各互斥结果分类之和必须等于已执行数。视图/API均核对该等式。保留原始收据、复审和实际版本；同版本 PR 交付仍使用原有完成门禁，不能由项目保留结果推断新版本全部重测通过。实时视图只读，不代替原始 JSON、日志与证据。

## 恢复边界

每个阶段只在前一阶段留下可验证的绑定和凭证后交接。修复 Agent 中断时，先核对输入哈希、Git revision、测试目录内的已修改文件和会话事件，再继续同一 session；不重新启动一个可能再次修改同一文件的新 Agent。若用例 Agent 接触本地服务且无法证明其效果可安全继续，默认停下；只有项目明确提供隔离/幂等保证，才设置 `resume_safe_after_local_loopback`。若会话无法恢复且已有无法确定的文件或外部效果，保持 `parked`，由人检查后创建新冻结尝试。执行阶段已有完整收据则接续；只有在项目明确声明“本地隔离重跑安全”且能建新鲜状态目录时，才允许对无收据执行另开一次尝试。仍存活的执行进程或外部效果不确定时停下。只读 Reviewer 会话无法恢复时，可保留失败记录并有限次新开审查，不重新执行测试。变更需求、范围、规则、场景或产品版本需新下游版本；旧证据留档。

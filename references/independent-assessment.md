# 独立评估的两项职责与判定说明

新评估保留 status / summary / reason / evidence / reviewer_kind / review_reference / result_sha256，以及 assessment 的 scope / checks / basis / limitations / output_quality。新增以下两部分。通过与 BUG 使用同一论证结构；评估是作者基于实际核查的记录，查看器不从长文或结果标签猜测补写。

## 测试执行可信性核查：assessment.execution_audit

对象包含 status（passed / repair_required / execution_error）、checks 与 issues（具体问题列表；核查 passed 时为空）。checks 必须逐项覆盖四个 aspect，每项写 subject（实际检查对象及代码/操作定位）、status（passed / failed / unproven）、finding（实际核查事实、发现及理由）、evidence（本次评估引用的证据路径）。

- scenario_alignment：检查需求、场景意图、方法及实际输入/操作是否一致；漏测或错误前提不能宣告场景通过。
- test_implementation：实际阅读使用的测试代码、夹具、输入生成和断言，或模拟人工操作的具体实施，确认未测错对象、未用错误断言、未把 Mock 当真实验收。核对用例业务名称、本轮已有/新建来源（依据实际准备和代码历史）、项目文件及精确用例；逐个核对procedure的目的、数据、操作、预期和scenario_checks是否与实际实现一致，检查多用例承担范围的并集是否覆盖场景，不以单个用例通过代替整个场景通过；说明缺失或不合理属于test_design修正。组合方式逐用例核对，模拟人工须核对实际 AI 工具与操作入口，不虚构人类或界面点击。写清文件和精确用例/操作；没有代码时写明实际操作及为何能够检验该判据，不能只写“不适用”。
- execution_authenticity：核对真实命令/工具、操作者、前置与状态变化、版本和本次尝试；排除旧证据、伪造动作和执行设置错误。
- evidence_sufficiency：实际打开证据，确认足以支持每项判断；写清原始采集与派生文件的来源关系，两份同源文件不是两次独立证明。

passed / failed 产品结论要求此核查 passed 且四项均已核实。测试自身有问题则 repair_required，同场景修正后再评估。格式校验只能检查结构、引用和状态一致性；事实是否真实、测试是否合理仍需独立 Reviewer 实际核查。

## 场景验收结论及依据：assessment.explanation

最终 passed / failed 必须完整写出以下内容：

| 字段 | 要求 |
| --- | --- |
| conclusion | 一句直接的业务结论，≤180字符。BUG 写错误行为；通过写得到验证的验收意图。不能用“对照证据确认…”作为问题标题 |
| requirements | 非空数组：每项 {id, text, source}，引用原始需求及来源/版本；白盒不变量说明与需求的对应关系，不发明业务要求 |
| preconditions | 实际前置状态、参与主体和输入条件列表。不同子路径独立初始化须说清，不能让读者误认为连续执行 |
| actions | 已实际实施、可复现的操作列表；指出操作者与目标。不是未执行的计划 |
| reasoning | 非空推理列表：解释事实如何支持结论，怎样排除测试自身的问题，必要时区分已证明的违规行为与尚待验证的根因假设 |
| decisive_evidence | 非空数组：每项 {path, locator, observation, supports}；path 属于本次独立引用，locator 为准确的日志段落/JSON Pointer/截图区域等，observation 写关键事实，supports 为 assessment.checks 中 criterion 的精确名称 |

沿用 assessment.checks 的 criterion / expected / actual / status / evidence 作为“预期与实际对照”；每项实际事实直接回答预期，符合与不符合均有依据。失败判据优先显示，符合项也保留。BUG 至少有一个 failed 判据；决定性证据覆盖所有 failed 判据。通过必须所有判据满足，决定性证据覆盖所有判据。

沿用非空 assessment.limitations 作为“判断边界”，说明本次实际环境、范围及未验证条件。通过只意味着在上述范围内满足判据、未发现 BUG，不证明产品不存在 BUG。scope / basis 保留完整核查范围与依据；output_quality 检查表达质量，不替代 execution_audit 的真实性和合理性核查。

弹窗展示：**结论 → 需求依据 → 验证操作 → 预期与实际对照 → 决定性证据与推理 → 判断边界**，然后展示测试执行可信性核查。读者无需切换多个页签即可理解完整论证；原始证据可就地打开，定位信息和业务事实同时可见。审查身份、哈希、完整原文和表达质量详细检查收纳在详情中。

普通修正和 AI 特殊异常仍记录具体诊断及执行核查；它们没有通过/BUG的最终论证，不能强行补造未发生的操作或行为结论。历史缺失结构只提示不完整，不自动推断。新数据不得以历史兼容为理由省略此格式。

白盒场景使用逆向规则作为判据时，explanation.requirements 中引用该规则的实际 id/text/source，另标 source_type=white_box_reverse，说明独立契约或不变量依据及适用范围。不可将其冒充用户已确认需求；needs_confirmation 不得给出 passed/failed 产品结论。规则及来源版本的完整绑定见 [white-box-rules.md](white-box-rules.md)。

场景与用例的信息分工、逐检查点联合覆盖、独立审查case_coverage、逐用例case_results及四列报告遵循 [case-design.md](case-design.md)。场景级operation_plan不是新记录的必需内容；用例过程与证据在具体用例中维护，整体最终结论仍归场景。

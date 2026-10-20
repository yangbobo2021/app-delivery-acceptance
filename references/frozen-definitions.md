# 完整冻结定义、来源与变更

## Agent 与 Skill 的边界

项目通过各种形式表达约定；Agent 负责理解、选取和对照这些约定，测试 Skill 保存本次交付测试的完整冻结定义，补充测试设计并产生执行事实。SPEX、在线需求系统、文档、表格、脑图及用户对话都是可能的来源，不要求转换原项目的组织方式。

Agent 用当前可用工具读来源、识别权威和稳定身份、解释语义差异及影响。脚本只接收完整定义、冻结出处和 Agent 判断，校验身份、版本、关系并执行声明的流程；不实现项目格式适配器、来源抓取器、在线同步或自动回填。

本次资料保存纳入范围的完整集合。例如项目有十条需求，本次选两条并口头新增一条，冻结三条完整定义：前两条有外部引用，新增条目外部引用为空，仍保留原话与决定依据。不要导入范围外需求来凑项目全集；必要上下文写入 context 或明确 related_refs。正式测试继续留在项目既有测试目录。

## 定义集合

使用 `acceptance-catalog-v2`，仍由 `acceptance_store.py` 保存到 `.acceptance/<AT-ID>/scenarios.json`，每次发布完整快照到不可覆盖的 `records/catalog-*.json`。requirements、reverse_rules、scenarios 三个数组均须存在，可以为空；尚缺的场景和待确认规则明确列出，不代表覆盖已完成。

最小示例（内容由 Agent 根据实际来源提供；不是新的项目 SPEC 格式）：

```json
{
  "schema": "acceptance-catalog-v2",
  "project": {"id": "project"},
  "context": {
    "business_goal": "本次确认的测试目的",
    "confirmed_scope": {},
    "shared_constraints": "本次必须共同遵守的原始约束",
    "requirement_groups": []
  },
  "requirements": [{
    "id": "R1", "text": "完整原始需求",
    "origin": {"kind": "user_statement", "reference": "实际用户指令及上下文引用"},
    "external_refs": []
  }],
  "reverse_rules": [],
  "scenarios": [{
    "id": "S1", "title": "业务测试点",
    "description": "明确条件、操作和预期。",
    "priority": "P1", "priority_reason": "具体失败影响",
    "requirement_id": "R1", "related_refs": [],
    "origin": {"kind": "existing_scene", "reference": "实际场景出处"},
    "external_refs": [{"locator": "外部条目定位", "revision": "实际读取版本或快照标识", "text": "冻结的外部原文"}],
    "check": {"method": "agent_adopted", "basis": "实际检查条件、操作、预期和范围的依据"}
  }]
}
```

- origin.kind 是描述性文本，不是来源类型白名单。origin.reference 保存真实出处或用户指令；必要时增加原话、时间和推导说明，不能以模型生成的概括替代原文。
- external_refs 可以为空。每条有 locator、revision、text；外部系统没有原生版本时，Agent 保存实际内容快照并给出可核验的快照标识，不伪造远端版本。引用变动不替代完整正文。
- stable ID 在本集合内唯一；保留已有 ID，有冲突时明确命名和映射。不得凭相似标题合并、拆分或重分配历史身份。
- requirement_id 是可选的主需求/规则 ID；related_refs 是相关需求/规则 ID。只有已有场景时省略主目标，其冻结的有效约定直接作为依据，不编造上层需求。
- check 记录实际检查方式。生成场景可用 internal_self_check；直接采用的场景可用 agent_adopted。采用门禁不等于独立审查，不能把源文档“已测试”当作本次执行。
- 原始需求 text 不由用例 Agent 改写。逆向规则额外保存 status、basis_kind、basis、发现所用 code_sources（每项 path、revision、sha256）及独立预期依据。执行时核对实际产品文件和版本，不能用旧观察绑定新代码。supported 需要合同、不变量或用户决定；needs_confirmation 必须保存具体 question，不能作为场景主目标或执行上下文。不为现状观察新增可判产品通过的路线。
- 版本、content_sha256、definition_record、definition_version、previous_catalog_sha256 和 change 由宿主生成，不能手工伪造。规则/需求/场景实质修订保留身份并增版；关注点替换、拆分合并由 Agent 明确记录替代关系。

## 冻结与阶段输入

先按现有规约确认项目根目录、当前 AT、范围和知识读取。Agent 完成来源阅读及纳入决定后：

```sh
python3 <skill>/scripts/acceptance_definitions.py freeze <project> <AT-ID> --input candidate.json --basis '<真实采用决定依据>'
python3 <skill>/scripts/acceptance_definitions.py binding <project> <AT-ID>
```

freeze 返回 definitions `{path, sha256}`，指向本次不可覆盖的完整记录。把它作为准备以外的定义依赖阶段的顶层 `definitions` 字段，acceptance 仍沿用 read-knowledge 的原值。公共项目准备只绑定产品/工具版本，不因定义更新重装；场景用例 catalog 继承本次 definitions。

缺场景时仍使用单目标生成入口，并在 request 中携带 definitions；宿主从冻结集合解析完整需求与 context。白盒生成继续核对独立的冻结逆向产物和代码版本；生成输出不能悄悄改写已冻结规则。Agent 检查新场景、保留原有采用/人工修改的内容，补齐完整集合后再次 freeze。无需生成的场景直接采用。

`bind_case.py` 在模板含 definitions 时只需 scene_id，无需 scenario_run_path 或虚构生成终态。它从完整集合产生正文、可选主目标及相关依据。用例、调试、证据交接和独立复审校验绑定；集合改变后用新目录和新输入，不改旧请求、收据或结论。

## 变更检测与采用

启动、恢复、用户要求刷新或阶段交接时，Agent 根据实际任务检查外部来源及内部定义。没有授权不启动后台监控，也不要求在每个阶段重新访问所有在线来源。检查结果须区分未变、变化、不可访问、确已删除和身份待确认。

Agent 将检查到的变化整理为候选完整集合，保留未变定义、原话、来源和用户修改。不可访问不能当删除；来源删除不自动移出本次范围。外部引用中的条件/预期发生变化时，Agent 必须同步提出正文或 context 的变化，不能只换引用就宣称语义未变。

```sh
python3 <skill>/scripts/acceptance_definitions.py compare <project> <AT-ID> --input candidate.json
```

compare 只返回 proposed_only 报告，不采纳、不运行项目、不改结论。哈希只识别内容变化，Agent 判断措辞等价、权威变化、依赖和范围。可传 `--assessment assessment.json`：

```json
{
  "changes": {"requirements:R1": {"classification": "equivalent", "reason": "实际对照原文后判断条件和预期均未变"}},
  "affected_scene_ids": ["S2"],
  "reason": "额外受影响场景与此次变动的因果关系"
}
```

等价判断是有出处的 Agent 判断，不是脚本语义证明；不确定时保守重查。机械依赖是下限，Agent 应补充隐含影响。改变逆向规则的纳入资格不能标成等价。AI 或人的改动遵循同一判定；采纳依据可来自既有用户授权/项目策略，不新增逐项审批。

采用变化时按 freeze 发布新集合，在同一 AT 下保存新记录和变更报告。范围增减仍追加 scope；仅定义修订不必伪装成新 AT。正在执行的阶段保持原冻结输入，保存实际证据；到安全边界再交接新计划。固定旧版测试时明确其版本，不能宣称满足后来外部最新版。

## 受影响流程

- 需求/规则/共享约束变化：先重查整体目标、范围及完整场景覆盖，再更新受影响场景，检查用例并重跑执行与独立复审。场景生成读完整需求，不能把局部引用当作全部实际依赖。
- 场景条件/操作/预期变化：从场景检查及用例适配开始；无产品变化可复用原项目准备。
- 优先级、标题或单纯外部引用补充：更新记录与调度，正文和依据实际未变时不因此重跑业务。origin 或独立依据变化仍需重查。
- 产品/组件或测试工具变化：保留已有版本门禁，准备新 catalog；测试代码/夹具变化重跑受影响执行。覆盖率始终对应实际采集版本。

v2 执行计划直接引用已采用场景：

```json
{
  "schema": "acceptance-v4-plan-v2",
  "acceptance": {"project_root": "<project>", "id": "<AT-ID>", "scope_sha256": "...", "knowledge_receipt": "..."},
  "definitions": {"path": "<freeze返回的绝对记录路径>", "sha256": "..."},
  "run_dir": "<本AT下全新workflows目录>",
  "changed_only": true,
  "change_review": {"basis": "实际整体影响和覆盖检查记录", "checked_scene_ids": [], "checked_target_ids": []},
  "case_template": {"acceptance": {}, "source_checkout": "<共用workspace>", "template_catalog": "<准备catalog>", "guide": "<操作指南>"}
}
```

case_template.acceptance 填同一绑定。`python3 <skill>/playbook/v4/run_plan.py plan.json` 在 changed_only 时执行该冻结变更报告的 rerun_scene_ids；也可显式 scene_ids 选择子集，省略两者执行全部冻结场景。若报告 analysis_required，Agent 先完成整体影响/覆盖检查，change_review 列出报告全部 coverage_check_scene_ids 和 scenario_target_ids 的检查记录；缺场景先补定义，不靠执行门禁代替覆盖判断。

报告针对相邻两次冻结。跨多次修订时 Agent 必须合并尚未完成的影响，显式填完整 scene_ids；不能只执行最新差异而漏掉前次未验内容。新目录保证每次新尝试，旧目录只恢复完全相同输入。

计划完成仅证明声明任务的编排结束，不是全量通过。pending_rule_ids、missing_scenario_target_ids、未选场景和版本限制随结果披露。PR 仍走同版本、完整目标门禁；v2 子集结果不能替代现有 PR completion，不能借复用历史通过转移版本。

## 历史、展示与可选回填

保存完整原定义、采用依据、对象版本、实际被测代码、执行收据和复审。新定义不清空已执行事实或最近确认结果。视图另外显示 definition_applicability：当前定义匹配、需复验或缺少旧版本关联；定义匹配也不证明产品新版本已通过。

v2 统计以所选 AT 的完整当前冻结集合为分母，包括未执行项；范围外/退役条目保留在原始历史，不混入当前分母。缺场景和候选规则仍显示。旧 v1 数据继续只读并按旧口径展示，不自动迁移、不补造来源或版本。

回填由用户决定，可按条目选择。Agent 用项目现有方式执行被授权的回填；Skill 不写外部位置。内容等价时补充 external_refs，仍保留完整冻结定义和旧引用；回填时改了行为则按新定义处理。即使不回填，测试资料也完整、可维护、可交接。

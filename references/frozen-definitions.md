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

context 中 business_goal、confirmed_scope、requirement_groups 和 user_constraints 记录整体分析、组织及执行意图，完整保存但不作为每个场景共同的行为义务。可观察的约定应冻结在需求、规则或 shared_constraints 中，不能只藏在目标概述或用户指令摘要里；相关目标用 requirement_id/related_refs 明确关联。新增独立需求可以更新整体目标、范围及分组，已有场景仍只依赖自己的定义、关联依据和共同约束。其他 context 扩展字段默认仍参与绑定，避免遗漏未知业务约束。

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

- 需求/规则/共享约束变化：先重查整体目标、范围及完整场景覆盖，再由**现有场景生成工作流的 edit 模式**修订受影响目标。输入旧/新需求、完整当前上下文和当前采用的场景；输出新增、修改、退役及原因。未改内容原样保留，同一测试点保留 ID 并增版，新测试点才新增 ID；明确退役而不删除历史。生成 Agent 只负责设计，宿主合并/冻结并决定后续执行，不新增一套需求变更场景工作流。
- 新增独立需求：整体分析包含新目标，新目标首次生成使用 create；仅更新目标、范围、分组或执行指令不使无关联旧场景失效。compare 的 context_changed 记录完整上下文变化，execution_context_changed 单独标识共同业务约束变化；后者才扩大到全部场景及有效目标。需求正文或 related_refs 中的依据变化仍按实际依赖传播，Agent 可补充有因果依据的隐含影响。
- 场景条件/操作/预期变化：从场景检查及用例适配开始，不因只改场景而重做整体需求分析。无产品/工具变化可复用原准备。若场景修改改变或违反需求义务，先返回需求确认/分析，不能直接将其当作用例预期。
- 优先级、标题或单纯外部引用补充：更新记录与调度，正文和依据实际未变时不因此重跑业务。origin 或独立依据变化仍需重查。
- 产品/组件或测试工具变化：保留已有版本门禁，准备新 catalog；测试代码/夹具变化重跑受影响执行。覆盖率始终对应实际采集版本。

### 既有场景的增量修订

同一 `run_scenarios.mjs` 支持 `mode: create|edit`。已有主目标场景时使用 edit；create 拒绝悄悄另起一份覆盖原场景。edit 请求的 `definitions` 是当前完整定义（包括需求更新后任何人工修改）；`previous_definitions` 指向本次需求变化前的不可覆盖快照，不以旧场景覆盖当前人工编辑。

```json
{
  "mode": "edit",
  "acceptance": {"project_root": "<project>", "id": "<AT-ID>", "scope_sha256": "...", "knowledge_receipt": "..."},
  "definitions": {"path": "<current-record>", "sha256": "..."},
  "previous_definitions": {"path": "<record-before-change>", "sha256": "..."},
  "project_root": "<shared-workspace>",
  "target_requirement_id": "R1",
  "scenario_kind": "BLACK_BOX"
}
```

宿主自动物化完整需求、当前全部场景、目标的旧/新需求、旧场景、当前目标场景和基线哈希。生成 Agent 使用同一套设计/内部自审标准，edit 只提交 `base_sha256, upsert, remove_ids, change_reasons, change_summary`；upsert 是五个设计字段的完整对象，未改场景不重写。门禁拒绝基线变化、其他目标 ID 冲突、改写出处或引用、无原因退役和整批替换。当前目标之外的关联影响写入说明，交宿主继续修订对应目标。

```sh
node <skill>/playbook/v4/run_scenarios.mjs edit-request.json NEW-scenario-dir
python3 <skill>/scripts/acceptance_definitions.py merge-scenarios edit-request.json NEW-scenario-dir > complete-candidate.json
python3 <skill>/scripts/acceptance_definitions.py freeze <project> <AT-ID> --input complete-candidate.json --basis '<实际检查后采用本次设计变更的依据>'
```

`merge-scenarios` 校验当前定义、生成终态/差量/结果哈希，将目标变更合并回完整集合，保留未改对象及已有出处/引用；新增场景保存真实生成来源，引用初始为空。它只输出候选，不隐式冻结、不修改项目 SPEC、不执行用例。采用前 Agent 仍对照需求检查语义，按授权决定回填。所有新尝试使用新目录；`--resume` 只恢复完全相同的冻结输入。

### 用户意图决定执行范围

变更不等于执行授权。宿主先读用户要求，再读本 AT 的真实执行历史；“曾执行”包含通过、失败及未形成确认结论的实际执行，不以已有用例、设计终态或通过标签代替执行事实。

- `complete_change_acceptance`：用户要求完成需求变更验收。执行覆盖受影响需求的全部有效场景，包含新增、原未执行和设计未改但关联需求换版的场景；不能因为以前没执行而跳过，拒绝省略这些场景的子集计划。缺场景时先补设计，不能称完成。
- `follow_history`：未要求完成整项变更验收。变化影响的场景中，曾执行的按场景变更处理用例并重新执行、采证和独立复核；新增及原未执行场景只更新冻结定义，保持未执行。无行为变化的元信息修改不因此重跑。
- `design_only`：用户明确只更新、不执行。即使旧场景已执行，也不启动用例、模型执行阶段或项目准备；保留待复验事项。

按用户明确选择执行个别场景时仍可提供 `scene_ids`，但不能用它缩小已经要求“完成变更验收”的范围。仅完成调度不是业务通过，旧确认结论与当前适用性仍分开。

v2 执行计划直接引用已采用场景：

```json
{
  "schema": "acceptance-v4-plan-v2",
  "acceptance": {"project_root": "<project>", "id": "<AT-ID>", "scope_sha256": "...", "knowledge_receipt": "..."},
  "definitions": {"path": "<freeze返回的绝对记录路径>", "sha256": "..."},
  "previous_definitions": {"path": "<本次变化开始前的记录>", "sha256": "..."},
  "run_dir": "<本AT下全新workflows目录>",
  "execution_intent": {"mode": "complete_change_acceptance", "basis": "<用户要求完成本次需求变更验收的实际依据>"},
  "change_review": {"basis": "实际整体影响和覆盖检查记录", "checked_scene_ids": [], "checked_target_ids": []},
  "case_template": {"acceptance": {}, "source_checkout": "<共用workspace>", "template_catalog": "<准备catalog>", "guide": "<操作指南>"}
}
```

case_template.acceptance 填同一绑定。`python3 <skill>/playbook/v4/run_plan.py plan.json` 按 execution_intent 调度；design_only 不需要 case_template。新 changed_only 计划默认 follow_history，显式 scene_ids 仍可按用户授权选择。新计划没有 intent、changed_only 或明确 scene_ids 时拒绝执行，不把定义更新视为全量执行授权；原已冻结计划沿用其原选择与绑定，不改历史。宿主写入带计划/定义绑定的 execution-selection.json，恢复不会因这次已经执行了部分场景而改变原选择。

compare 报告针对相邻冻结。新变更执行计划的 previous_definitions 保持指向本次变化开始前的记录；宿主跨过需求采用、整体分析、逐目标场景修订等多次冻结重新比较完整影响，不能只读最后一次场景差异。若报告 analysis_required，Agent 先完成整体影响/覆盖检查，change_review 列出跨版本报告的全部 coverage_check_scene_ids 和 scenario_target_ids（可先用 compare 对基线与候选检查）；缺场景先补定义，不靠执行门禁代替覆盖判断。Agent 在 change_review.affected_target_ids/assessment 补充有依据的隐含影响，不降低机械依赖的检查下限。新目录保证每次新尝试，旧目录只恢复完全相同输入。

计划完成仅证明声明任务的编排结束，不是全量通过。pending_rule_ids、missing_scenario_target_ids、未选场景和版本限制随结果披露。PR 仍走同版本、完整目标门禁；v2 子集结果不能替代现有 PR completion，不能借复用历史通过转移版本。

## 历史、展示与可选回填

保存完整原定义、采用依据、对象版本、实际被测代码、执行收据和复审。新定义不清空已执行事实或最近确认结果。视图另外显示 definition_applicability：当前定义匹配、需复验或缺少旧版本关联；定义匹配也不证明产品新版本已通过。

旧版收据的绑定曾包含全部分析上下文。读取时只根据哈希链可核验的原冻结记录兼容：业务依赖相同则仍匹配当前定义，真正共同约束变化仍需复验，语义改写仍要求原有等价判断。不得改写旧输入、执行哈希或确认结论来消除误报；历史记录缺失时不推定兼容。

v2 统计以所选 AT 的完整当前冻结集合为分母，包括未执行项；范围外/退役条目保留在原始历史，不混入当前分母。缺场景和候选规则仍显示。旧 v1 数据继续只读并按旧口径展示，不自动迁移、不补造来源或版本。

回填由用户决定，可按条目选择。Agent 用项目现有方式执行被授权的回填；Skill 不写外部位置。内容等价时补充 external_refs，仍保留完整冻结定义和旧引用；回填时改了行为则按新定义处理。即使不回填，测试资料也完整、可维护、可交接。

### 无现有组织规范时的默认回填

在已获授权的回填开始时，Agent 先检查项目指令、现有约定及用户指定的外部载体。组织规范可能位于文档或在线系统，不能只因没有 `specs/` 就判定不存在；已有规范继续沿用。确实没有适用规范、用户也未另选方式时，默认采用 SPEX，由 Agent 在项目资料根目录调用真实初始化工具，例如 `npx @sublang/spex scaffold --lang zh --agents codex`；语言、Agent 和目标路径按项目实际选择。先确认可用 CLI 的版本/来源及参数，已有可验证的安装或构建产物也可使用。保存实际命令、版本/来源、退出码、输出和生成文件清单，不手工仿造初始化结果；工具不可用或失败时保留已完成的验收结论及具体回填缺口，不宣称已初始化。

纯代码项目仍可先从用户口头需求完成冻结、场景设计和执行，引用初始为空；初始化只发生在需要回填且缺规范时。`.acceptance` 是本次验收资料，不当作已存在的项目需求组织规范。初始化前后核对产品文件，避免把回填写成产品修改。

初始化后读取实际生成的 `specs/map.md`、`specs/meta.md` 和结构决策，并按其规则回填：行为放入合适规约包的行为章节，场景放入该包的验证章节，验证断言行内引用所验证的行为，并更新地图。SPEX 条目使用其原生 ID；本 AT 的需求/场景 ID 保持不变，在 external_refs 中记录准确条目、真实修订及完整实读文本和对应关系。原口头来源及完整冻结正文保留。生成的模板规则属于项目约定，不因此自动纳入本次业务验收或新增测试场景。

回填表达须与已验收义务一致；原文可按生成规范的条目格式组织并原样保留。需要等价措辞转换时，保存逐项对应与理由，不靠引用补充隐藏行为变化。纯引用补充由 compare 核对影响，并用真实调度选择验证无需重跑；保留原执行/复审时间、绑定和结论，另核对当前适用性。此规则仅定义默认回填选择，不为通用 Skill 增加来源解析器、SPEX 数据镜像或自动同步流程。

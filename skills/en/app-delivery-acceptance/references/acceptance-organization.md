# 原始需求、验收组织与确认范围

本约定为 acceptance-plan-v2，配套 design-quality-v4。生成、独立审查、执行与恢复共享同一版本。只接受当前设计流程，不设置旧格式兼容入口。先读 [design-pipeline.md](design-pipeline.md)，先完成所有原始需求与白盒规则分析，再生成整个组织，最后逐单元生成场景。完整原始需求是唯一业务基线；验收组织不批准新业务规则。

## 全局理解与组织

requirements.json 保存完整已确认原文及稳定 ID，即使本轮只验收一项，也不截断其余需求。business_context 从原文与真实用户决定解释整体目标、核心业务链路、辅助功能及体验改进；不创造功能价值排序或事故频率。单条验收的选择放入验收计划，不改需求快照。

Analyst 先将行为、适用条件、异常恢复及保持不变约束逐项整理为 checks；每项保存具体原文引句。共享约束通过 source_field=shared_constraints 引用，并说明对所关联需求的适用性。每条原始需求都要有清单，包括本轮仅作为背景或已排除的内容。Reviewer 从原文独立检查清单是否完整，不能只核对 ID 数量或 Analyst 已列项目。

按业务链路与判断边界组织 units。一单元可关联多条需求，一需求可跨多个单元；每项 included check 至少有一个责任单元，交叉责任解释在 boundary/dependencies。exclusions 说明不承担什么。合并/拆分粒度不影响充分性；必要共同规则不在每条需求中重复完整验收。简单需求可只有一个单元。

## 计划结构与发布

生成 acceptance-plan.candidate.json，不直接覆盖正式 acceptance-plan.json。结构：

```json
{
  "standard": "acceptance-plan-v2", "version": 1,
  "requirements_sha256": "原始 requirements.json 文件哈希",
  "source_analysis_sha256": "完成的 source-analysis.json 文件哈希",
  "rules_sha256": "全部规则 version/items 的语义哈希",
  "decisions_sha256": "scope-decisions.json 的规范 JSON 哈希",
  "selection": {"mode":"full","requirement_ids":["REQ-09","REQ-10","REQ-11"]},
  "business_context": {
    "objective": "本轮整体业务目标", "basis": ["原需求文档位置或用户决定引用"],
    "journeys": [{"id":"J1","title":"管理员完成第二阶段赠额","role":"core","requirement_ids":["REQ-09","REQ-10","REQ-11"],"basis":"原文如何建立这一完整链路"}]
  },
  "checks": [{"id":"C09-1","requirement_id":"REQ-09","source_field":"text","source_quote":"必须逐字出现在该需求中的具体引句","behavior":"自包含的行为与约束","disposition":"included","reason":"为什么纳入本轮"}],
  "units": [{"id":"U1","title":"管理员办理第二阶段赠额","role":"core","boundary":"REQ-09检查操作和反馈；REQ-10检查对象；REQ-11检查实际写入","requirement_ids":["REQ-09","REQ-10","REQ-11"],"check_ids":["C09-1"],"rule_ids":[],"journey_ids":["J1"],"dependencies":[],"exclusions":[]}]
}
```

所有原始需求的 checks 清单都须填写。scenarios.json.design_basis 与 coverage_review.json.items 仅对本轮包含 included checks 的需求生成；context/excluded 原需求的完整追溯留在验收计划中，不伪造非空覆盖或 sufficient 结论。disposition 为 included / excluded / context；context 仅作为全局背景，不计入本轮证明。excluded 必须有 decision_id 关联真实用户决定。保持原始范围时 selection.mode=full、requirement_ids 为全部原始 ID，默认 included。只验收子集时 selection.mode=selected，记录选中的 requirement_ids 与 decision_id；真实用户决定中 selected_requirement_ids 必须与此一致。选中的要求不能悄悄标为 context；排除检查的 decision_id 也必须明确包含该 excluded_check_id。不能用 context 或缩短原文引句掩盖本轮要求。候选新增业务策略另存建议或待确认记录，不加入正式场景集合。

Reviewer 独立写 acceptance-plan-review.candidate.json：status=passed、reviewer_kind=playbook/independent_ai、review_reference、plan_sha256（候选计划的规范 JSON 哈希）、完整 requirement_ids 和所有发现规则的 rule_ids。original_inventory、bidirectional_traceability、scope_applicability、global_business_context、rule_provenance 五个字段各为 {status:passed, reason:具体核验}。检查所有原文约束到组织的正向映射，以及每个组织判据到原文的反向依据。

发布命令：

```sh
python3 <skill>/scripts/playbook.py check-plan <project> --test-dir <dir> --draft --input <candidate>
python3 <skill>/scripts/playbook.py publish-plan <project> --test-dir <dir> --input <candidate> --review <independent-review> --expected-version 0
```

版本从 1 开始；后续 expected-version 使用当前版本，候选版本必须恰好加一。发布归档计划和原审查到 plan-history/vN，校验完整原文及当前用户决定。运行中不能发布：先停止工作、abort-run 保存断点后再更新范围、开始新运行。角色不得直接写正式计划/政策或删除历史。publish-plan 是脚本执行已审查变更，不意味着 Reviewer 自行改写 Analyst 设计。

## 用户范围决定

scope-decisions.json 为 version:1、items 数组，使用 scope-decision 命令追加真实用户决定。每项包含 id、description、source_reference、source_quote，以及 excluded_check_ids、excluded_scenario_ids、excluded_rule_ids、excluded_topics 四个列表；没有排除也写空列表。用户指定单条或子集验收时，决定还须包含 selected_requirement_ids 列表，selection.decision_id 指向该实际请求。supersedes 可列出明确被新决定替代的旧决定 ID。decision-history 保存追加后的完整快照；当前决定文件不得恢复为较早内容。plan-history 的最新版本也必须与正式计划一致，防止旧角色绕过发布命令还原范围。不可改写旧决定；撤销排除要引用真实新用户决定，不由角色自行决定。

决定写入后，旧计划立即变为过期，旧运行不能开始下一场景。先更新候选计划、局部独立复核并发布。普通组织与测试方法不请求用户批准；仅对真正缺失的业务决定、无法从已有授权确定的范围冲突提问。

## 场景范围与全局风险

正式 scenarios.json 只保存本轮准入场景。每个场景增加 generation_unit_id、scope 和 risk；generation_unit_id 为本场景实际生成的责任组织。所有单元先发布，逐个 start-unit/complete-unit，之后 check-generation：

- scope.kind：direct / necessary_related / affected_regression。
- scope.unit_ids、topics、basis：验收单元、明确业务话题和本轮必要性。
- necessary_related 另写 omission_counterexample：不检查会让哪个已选要求被错误判为通过。
- affected_regression 另写 change_refs：具体变更、调用关系或数据影响依据；仅存在代码或合同不够。
- scope.criteria：按 acceptance.criteria 原顺序逐项写 {criterion, check_ids, rule_ids, basis}；每个判据都必须有 included 原始检查或本轮适用的补充规则，不能只给整场景挂一个需求 ID。
- risk：failure、causal_chain、business_impact、affected_users、recoverability、likelihood_basis、grade_basis、journey_ids。说明失败如何到达整体业务后果、受影响主体、真实保护措施、可恢复性和替代路径。未知概率如实说明，不编造频率。
- 分级共用 [scenario-priority.md](scenario-priority.md)。基于全部原始需求、整体业务目标及正式组织的核心链路统一评定；P0 场景集合共同证明本轮核心闭环和重大风险不变量，不要求每需求/组织一个 P0，也不按比例凑等级。
- P0 另写 critical_consequence：core_blocked / serious_financial_loss / serious_data_damage / access_control_failure / secret_exposure，以及 materiality_basis。core_blocked 说明关键步骤/结果为什么是整体交付目标的必要条件；不额外要求重大资金损失、不可逆性或影响全体用户。其他重大风险说明真实严重后果及保护措施，不能仅因额度/权限词语或单个辅助页面失败升级。
- recoverability 区分既有、可核验且业务可接受的替代路径与失败后的修代码、回滚、改动有效配置、人工修数据等补救。后者不能自动将核心闭环失败或重大风险降为 P1；保存记录、可重试也不能代替关键结果和不变量证明。

白盒规则独立来源成立之外，还需 applicability={status:in_scope, basis}，在源分析阶段先确定；组织通过 units[].rule_ids 保存责任关系。未确认、范围外或已排除规则可在候选记录讨论，但不放入当前执行集合。每条规则的判据只检查本轮需要的程度，不自动展开完整旧功能验收。真实第三方资源也按当前单元准入；无关旧集成不得成为门禁。

## 独立审查与增量复核

先审范围，再审覆盖、因果链、全局分级与记录质量。范围外建议使用 suggestion，不能成为 coverage_gap。业务歧义单独澄清；审查者不能为更全面而新增权限矩阵、团队功能或其他未确认策略。删除场景不能删除原始要求或把剩余不足标成充分。

coverage_review.json 增加 acceptance_scope_review：status、plan_sha256、reviewer_kind、review_reference、global_priority_calibration 和 items。逐场景 item 包含 scenario_id、scenario_sha256、dependencies_sha256、verdict=in_scope、scope_reason、priority_reason、causal_chain_review。用 scope-review-hashes 获取实际哈希。全局校准按同一分级标准核实跨组织同类后果是否同级、P0 是否共同覆盖核心闭环及重大风险、辅助任务是否被当成整体核心，以及降级所用替代路径是否已经可用且可核验。逐场景独立检查因果链，不能复制统一理由或因事后可修复自动降级，不按等级配额判断。

局部修改前调用 archive-scope-review，保存仍有效原审查并获得 retained_from={path,sha256}。未改场景的 scope judgment 原内容保持不变并附 retained_from；脚本验证原独立身份、原记录、当前依赖哈希，防止只换全局哈希冒充复审。只删除、显示分组变化不要求逐场景重审；检查剩余覆盖及结论边界。行为/判据/等级变化只复核对应场景；整体目标、共同规则变化复核所有受影响判断。原有覆盖和分级审查也保留原始出处，不用相似标题代替依赖核对。

## 资源范围

resources.json.decisions 每项增加 scope={status:in_scope|out_of_scope,basis,unit_ids}。范围内资源才参加运行门禁及 run-dependency。真实集成证明仍与 Mock 区分；只有真实用户决定允许时，scope.integration_scope=excluded、decision_id 可将真实投递等证明单列未验证，Mock 业务资源仍须实际预检。范围外资源记录保留，不能声称已验证。

acceptance_scope_review.resources 对所有发现的资源逐项写 {dependency_id,resource_sha256,verdict:in_scope|out_of_scope,reason}。审查实际依赖关系和排除依据，不允许靠 out_of_scope 字段跳过所选需求真正依赖的资源。

## 恢复与结论

run_workflow 保存需求输入内容哈希及 requirements/规则/源分析/逐单元进度/计划/计划审查/范围决定/政策的会话绑定。恢复先核对这些内容和当前用户决定；相同文件路径不足以证明内容相同。旧绑定无范围契约不能继续执行，需要在同一资产目录创建新组织会话，保留旧历史。新用户决定必须先持久化，不让旧角色按旧指令操作。

所有新运行冻结计划、决定、原始需求及审查快照；每次进入场景和记录转换校验绑定。范围改变后旧轮证据不合并到新轮，不重置原期限。遗失或删除范围文件不能降级为旧流程。中断时完成必要安全收尾后停止；无效范围不会被当成产品 BUG。

看板主追踪表按验收组织分组，显示组织承担的原始检查、多条需求／规则来源、纳入类型、排除依据、范围版本和真实本轮结果。每个场景仅在 generation_unit_id 责任组织下完整展示；其他 scope.unit_ids 下展示关联引用及实际 acceptance.criteria 与 scope.criteria 对应的检查项，不重复统计执行结果。需求 ID 支持逐检查项反查组织与场景；来源挂接不等于覆盖充分，仍由独立审查核实覆盖点并集。历史关系使用可核验的冻结快照，不混入当前组织或场景。缺少当前分析/组织/逐单元进度时显示阻塞，不自动认证。整体结论区分选定范围验收和所有原始需求完整验收；被排除或仅作为背景的原始检查保持可见。

业务测试范围和代码覆盖率分母分别冻结。按完整 PR 统计时，排除某类测试不自动删除源码分母；未覆盖如实显示。覆盖率不足不能自动扩展业务测试范围，增强模式也受同一范围约束。

用户请求先验证代表场景时，new-run 可重复传 --first-scenario ID，并用 --order-reference 引用实际请求。该顺序冻结到执行计划，剩余场景仍按原分级；不改变等级或最大重要度范围。未请求时继续 P0→P3。

正式文件意外缺失或被旧角色还原时，调用 playbook.py restore-scope 从最新 plan-history 和 decision-history 恢复；它不会撤销更晚用户决定。若恢复的计划尚未纳入最新决定，仍保持过期，须发布独立审查后的下一版本。禁止手工覆盖正式文件作为恢复手段。仅变更单元显示标题不改变逐场景依赖哈希；边界、角色或规则变化仍需复核。

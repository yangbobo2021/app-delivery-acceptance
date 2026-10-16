# 先分析、完整组织、逐单元生成、最后执行

所有设计使用当前 design-pipeline-v1、acceptance-plan-v2 和 design-quality-v4。没有旧台账兼容入口。原始需求保持原文与 ID；全局分级、明确排除、真实用户决定及独立审查继续适用。

## 1. 完成全部来源分析

初始化后先分析完整原始需求。黑盒设计不要求实现，白盒及完整验收先检查实际代码，识别重要分支、状态与不变量。已有原始需求足以表达时复用需求 ID；仅有独立合同、不变量或已确认决定依据的补充行为写入 white_box_rules.json.items。代码不能自证正确。

本阶段不生成组织、场景、测试代码或执行资源。每条补充规则先记录 applicability={status:in_scope|out_of_scope|pending,basis:具体理由}。活动规则还必须有 kind=direct|necessary_related|affected_regression 和明确 topics；必要关联须有 omission_counterexample，回归须有 change_refs，脚本提前检查真实用户排除。已确认排除及必要关联/受影响回归标准同样约束规则；未知业务策略不能进入 in_scope。保留范围外和未确认规则的发现记录及理由，不把它们作为活动验收对象。

写 source-analysis.candidate.json：

```json
{
  "standard":"design-pipeline-v1", "stage":"acceptance", "status":"complete",
  "source_hashes":{"requirements.json":"完整原文文件哈希","white_box_rules.json":"规则语义哈希","scope-decisions.json":"当前决定的规范 JSON 哈希"},
  "requirement_ids":["REQ-1"], "rule_ids":["RULE-1"],
  "original_analysis_basis":"完整原文的目标、条件、异常恢复和保持不变约束",
  "white_box_analysis_basis":"实际检查了哪些代码及重要路径，为何新增或复用规则",
  "code_inventory":[{"path":"src/service.ts","sha256":"真实文件哈希","basis":"检查的主体、分支及状态"}]
}
```

source_hashes 用 `design_pipeline.sources(ledger)` 获取。规则语义哈希用 `design_pipeline.rules_digest(ledger)`，只包含规则文档 version/items；场景生成期间可以完善根 design_basis，但不得改动规则本身。black-box 模式显式使用空规则列表和空 code_inventory，并说明未请求实现分析；white-box/acceptance 必须有实际代码清单，即使没有新增规则也不能省略检查依据。

运行 `playbook.py complete-analysis <project> --test-dir <dir> --input <candidate>`，再运行 check-analysis。完成记录绑定完整需求、全部规则及当前用户决定。代码文件变化会使分析失效。

## 2. 生成并独立审查全部组织

读取完成的分析，生成整个 acceptance-plan.candidate.json，不能边生成组织边生成场景。除原始 checks、全部业务目标/链路/边界外，计划须包含 source_analysis_sha256（完成分析文件哈希）、rules_sha256（规则语义哈希）；每个 unit 有 rule_ids 列表，没有补充规则也显式写空列表。一个单元至少承担原始 check 或活动 rule；所有且仅有 in_scope 规则必须有责任单元。

Reviewer 从完整原文与实际代码/合同独立验证五项判断：original_inventory、bidirectional_traceability、scope_applicability、global_business_context、rule_provenance；review.requirement_ids 和 rule_ids 须枚举全部来源，包括发现后排除的规则。范围外建议不阻塞当前验收。规则适用性与正确性分别核实，不能用原代码行为代替预期。

所有组织一次性通过 publish-plan 后，脚本创建 design-progress.json，完整列出所有单元，初始状态均为 pending。候选组织尚未发布时，实时视图显示“全部验收组织生成与审查进行中”，不伪装成已确认范围。

## 3. 严格逐单元生成场景

按发布的 units 顺序处理，每次仅有一个活动单元：

1. `playbook.py design-next <project> --test-dir <dir>` 取得下一个单元。
2. 工作流收到 more 后先运行 advance-unit，证明刚完成一个单元且存在下一待生成单元；不能重复旧完成记录推进。随后 `playbook.py start-unit <project> --test-dir <dir> --unit U1`，冻结其他场景。已活动单元的恢复不会覆盖原冻结基线。
3. 为该单元生成完整场景；每场景有 generation_unit_id=U1，scope.unit_ids 包含 U1。仍按每个判据记录原始 checks 或已准入 rules，按全局目标评定重要度。共享场景可关联多个单元，但只有一个生成责任单元，不重复制造场景。
4. 每产生一个完整场景，就原子更新 scenarios.json，让看板逐步出现真实数据。保留其他单元场景，不能提前为后面的单元生成场景。不能在此阶段新增白盒规则。
5. `playbook.py complete-unit ... --unit U1` 校验当前单元的全部 check/rule 覆盖和其他场景未变，保存生成场景清单与哈希，状态成为 generated。再取下一单元。

所有单元生成完成后才运行 check-generation，随后进行全局场景独立审查。generated 表示设计产物已生成，不能当作充分审查或执行通过。场景审查和原有资源、证据门禁全部保留；执行必须等待全部单元生成与审查完成。

## 修改、恢复与实时视图

单元场景修改先 archive-scope-review，再 reopen-units --unit U1（可重复指定受影响单元）；重新逐个 start/complete，保留未变场景的原始独立审查出处。运行中先停止并 abort-run，不能边执行边改设计。

发现新的必要规则或改变需求/用户决定时，重新完成来源分析、更新全部组织候选、独立审查并发布下一版本；生成队列随新版本重建，旧进度与证据留档。新规则不能绕过组织进入场景。会话恢复校验需求、规则、代码、分析、组织、决定和进度内容；相同路径或旧会话措辞不能恢复旧范围。恢复已确认范围时不能撤销更晚用户决定，也不能恢复旧生成进度作为新版本证明。

实时视图按落盘事实展示四个阶段：需求与白盒规则分析 → 全部组织生成与审查 → 逐组织生成场景 → 执行与独立判定。所有正式单元在场景生成前可见，显示待生成/生成中/已生成、已有场景数量及链接；结构变更显示需重新生成，错误或缺失记录不会显示已完成。应用执行过程继续来自所选实际运行，各轮证据不合并。

生成进度遗失或被旧文件覆盖时，使用 restore-design-progress 从当前计划版本的最新命令记录恢复；它保留活动单元和原冻结基线，拒绝需求、规则、代码或用户决定已改变的恢复。

白盒仅设计有正式入口：run_workflow.py ... --stage white-box。它复用设计工作流角色但根据固定 design-stage-policy.json 进行代码分析与纯白盒场景审查，不请求执行资源或执行应用；check --stage design 自动选择固定分析模式。所有模式的阶段选择也绑定到会话，恢复不能从黑盒悄悄变为白盒。

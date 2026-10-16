# 白盒逆向规则

先读取 [验收组织与范围](acceptance-organization.md)。规则有独立正确性依据，不等于本轮必须完整验收该规则。正式场景关联的规则增加 applicability={status:in_scope,unit_ids,basis}，证明当前变更的必要影响。未确认或范围外规则另存候选，不进入当前场景和完整验收门禁；已确认范围内仍需解决的歧义才阻断相应验收。不得换名重加用户排除的权限或团队测试。

白盒检查从代码识别重要分支、状态变化和数据风险，再决定用什么依据判断正确。不能将“代码现在这样做”写成“产品必须这样做”。生成和独立审查使用同一规则、来源和检查项。

## 三种情况

| 情况 | 关联与处理 |
| --- | --- |
| 已确认需求已包含目标行为 | 场景用 requirement_ids 关联原需求；说明代码提示的遗漏风险，不重复创建逆向规则。 |
| 当前冻结列表缺少，但有独立约束 | 单独保存逆向规则，status=supported；basis 引用具体项目契约、数据一致性约束或已确认决定。独立审查核实约束适用范围后，才能据此验收。 |
| 仅看实现无法决定应当怎样做 | status=needs_confirmation，记录现有行为、候选检查和明确确认问题。设计可以审查，不能冒充业务已确认，也不能执行或判定产品通过/BUG。确认后更新来源、规则和审查，开启新执行轮次。 |

对规则的业务确认在本工作流外完成。supported 表示已有独立约束，并不等于新增用户业务批准。只有本轮已选需求所必需且未解决的规则歧义阻断相应验收；范围外候选不进入门禁。已确认子集按用户给定范围验收，原始未验证内容仍可见。

## 单独存储

`white_box_rules.json` 使用 version:1、items 数组。每项包含：

- id、title、text：稳定编号、业务标题和完整规则。
- status：supported / confirmed / needs_confirmation。
- rationale：代码提示的具体风险。
- basis、basis_kind：独立判据及其类型 contract / invariant / confirmed_decision；待确认条目可用 candidate。契约依据应给出具体条款、文件位置和适用范围。
- question：待确认规则的明确问题；confirmed 必须包含真实 confirmation_reference。
- code_sources：至少一个实际文件，每项 path（仓库内相对路径）、symbol、revision、sha256。跨仓库明确绝对 root；默认目标项目。可附 line_start、line_end、excerpt，片段必须与原文件逐行一致。契约文件可以作为额外来源。
生成和审查都读取 [共同设计标准](design-quality.md)，使用同一 `design-quality-v4`、五项标准和检查点并集规则。规则来源不同，不另创简化的覆盖标准。

`white_box_rules.json` 根保存 `design_standard`、`design_basis`。每个白盒关联目标（已有需求ID或逆向规则ID）一项，以 `requirement_id` 定位，结构与黑盒完全相同：scope、exclusions、techniques、limitations、coverage_items。每个 coverage_item 包含 id、condition（检查操作）、expected（预期结果）、identification_basis、scenario_ids、check_points（id/text）。不再写另一套 check_items。仅引用确实关联该目标的白盒场景，已有需求的补充分析也存于此文件，不改黑盒已审查设计。

多组输入若有独立判据，要单独列项或检查点，不能把只检查一组误认为全部覆盖。候选预期必须明确标记待确认，具体记录已列候选情况的操作和观察要求；业务策略、阈值或错误处理未定时，列出限制及确认后需补充的边界。候选设计覆盖充分仅指声明的讨论范围，不表示已具备产品验收判据。

白盒场景包含完整 acceptance、priority/priority_reason、target_condition 和 code_sources。已确认 requirement_ids 与 reverse_rule_ids 分开；至少关联一种。跨项目示例必须在场景描述中说明被测代码所属项目，不能借用另一个项目的结果证明它。

## 独立审查与执行绑定

coverage_review.json.white_box_priority_review 保留原有审查身份、分级 items、output_quality 和 white-box-priority-hashes 的全部哈希，增加：

- design_standard：与生成和黑盒审查相同的版本。
- design_reviews：每个关联目标一项，与黑盒需求审查同结构：requirement_id、verdict（sufficient/gap/needs_clarification）、reason、scope、limitations、coverage_results、criteria_checks、findings。逐场景 scenario_coverage 精确记录 covered_point_ids 和具体动作/判据定位。完整度来自所有贡献的检查点并集，重复不增加完整度；五项核验和遗漏反例的责任完全一致。
- rule_reviews：仅核验逆向规则来源、独立约束及确认状态。每项 rule_id、verdict（accepted/needs_confirmation/gap）、reason。不再使用 coverage_checks 表达另一套覆盖判断。

规则确认与设计覆盖相互独立。待确认规则可在声明的候选范围内有 sufficient 设计结论，但必须保留明确确认问题、条件化预期和判断限制；不能要求或假造新的业务批准，也不能用“计划齐备”替代具体检查点核验。确认后按实际规则更新设计、补齐新的边界并重新审查。结构校验复用同一个 design_quality 校验器，UI复用同一个检查项及核验记录组件；缺字段或错误并集显示不可核验，不能根据关联标题猜测覆盖。

新轮次冻结 white_box_rules.snapshot.json，并绑定规则文件哈希。场景开始和最终检查会阻止未确认规则得到产品判定，检查所关联代码是否变动。改变规则、判据或来源需重新审查；不得给旧证据换哈希以冒充重新执行。

覆盖关系将逆向规则与需求一起列出，但显示“白盒逆向”来源，并分别显示规则确认状态与场景覆盖状态，两者独立、可以并存。例如候选规则设计已覆盖所有检查项时，同时显示“规则待确认”和“规则覆盖充分”；覆盖充分不解除等待业务确认的执行限制。每条规则下按场景行显示标题、重要度及本轮/最后一轮执行信息。规则标记打开检查项、预期、识别依据、聚合覆盖和来源；优先级标记保留统一悬浮理由。

覆盖标签统一打开“场景设计审查”：先呈现需求/规则正文，再呈现“检查操作与预期结果及覆盖情况｜为什么需要检查｜对应场景”的同一表格。具体遗漏、重复范围在第一列，场景标题可点击。逐场景核验及五项标准折叠展示；白盒额外的规则来源、代码和哈希放在独立折叠区，待确认问题保持可见。已有需求下的白盒补充检查使用同一组件另列，不继承黑盒结论。

## 分析必须先于验收组织与场景

遵守 [design-pipeline.md](design-pipeline.md)。先分析全部原始需求与重要代码路径，记录所有补充规则及 applicability，然后 complete-analysis。所有活动规则由完整验收组织 units[].rule_ids 接纳，Reviewer 在发布组织时独立核查 rule_provenance。之后逐单元生成白盒场景，场景阶段不得新增规则。根 design_basis 可以在场景设计时完善，items 语义内容不可改变；发生必要规则变化时先重做源分析和组织审查。

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# 规约地图

本项目为 App Delivery Acceptance 测试 SKILL。
先从本索引定位需求，再阅读 [`meta.md`](meta.md) 的格式规则。
当前包含 11 个包、191 条带唯一 ID 的行为及验证条目；本轮登记独立工作流、Node 工具及完整迁移的集成验证，实际执行结论和未实测边界另行保存。
随附 SPEX 框架的许可文本保存在 [`LICENSE.spex`](../LICENSE.spex)，不声明整个项目的许可证。

## 目录结构

```text
decisions/    规格组织与需求基线决策
intents/      当前文档工作的计划及状态
packages/     按用户价值和封闭职责组织的需求
map.md        本入口
meta.md       SPEX 原生规约规则
```

## 决策

| ID | 文件 | 摘要 |
| --- | --- | --- |
| [DR-000](decisions/000-spec-structure-format.md) | 000-spec-structure-format.md | SPEX 原生结构与条目格式 |
| [DR-001](decisions/001-acceptance-requirement-baseline.md) | 001-acceptance-requirement-baseline.md | 来源、范围、实际初始化及本轮不开展验收的边界 |
| [DR-002](decisions/002-requirement-quality-and-identity.md) | 002-requirement-quality-and-identity.md | 质量准则、稳定身份、审查结果与职责边界 |
| [DR-003](decisions/003-self-acceptance-p0-scope.md) | 003-self-acceptance-p0-scope.md | 自身项目验收的顺序、P0 执行范围及结论边界 |
| [DR-004](decisions/004-opencode-structured-results.md) | 004-opencode-structured-results.md | OpenCode 原生结构化结果、请求关联和失败边界 |
| [DR-005](decisions/005-create-only-acceptance.md) | 005-create-only-acceptance.md | 仅创建交付测试、官方 CLI 入口及后续范围衔接 |
| [DR-006](decisions/006-independent-workflow-migration.md) | 006-independent-workflow-migration.md | 独立入口逐个迁移、兼容期依赖及逐项验证 |
| [DR-007](decisions/007-complete-native-workflow-migration.md) | 007-complete-native-workflow-migration.md | 完整迁移目标、官方角色调度、启动适配与 Node 收敛 |
| [DR-008](decisions/008-workflow-owned-source-layout.md) | 008-workflow-owned-source-layout.md | 按工作流职责组织源码、移除旧执行器和路径包装器 |
| [DR-009](decisions/009-skill-playbook-responsibility-boundary.md) | 009-skill-playbook-responsibility-boundary.md | Skill 对话接入与完整独立 Playbook 包的职责、依赖和命令验收边界 |
| [DR-010](decisions/010-deterministic-coverage-protocol.md) | 010-deterministic-coverage-protocol.md | 固定覆盖率协议、唯一工具元数据及项目工具后端边界 |

## 规约包

| 文件 | 唯一 ID 范围 | 条数 | 用户需要获得的保证 |
| --- | --- | --- | --- |
| [delivery-acceptance.md](packages/delivery-acceptance.md) | `delivery-acceptance-1` 至 `delivery-acceptance-14` | 14 | 交付验收目标与范围：让用户依据已确认的需求、真实测试和独立证据判断交付状态，并明确未完成范围。 |
| [definition-lifecycle.md](packages/definition-lifecycle.md) | `definition-lifecycle-1` 至 `definition-lifecycle-25` | 25 | 需求来源、冻结与变更：完整保存本次验收的约定及出处，使执行有固定依据，并能在约定变化后确定必要的后续工作。 |
| [scenario-design.md](packages/scenario-design.md) | `scenario-design-1` 至 `scenario-design-12` | 12 | 场景采用与增量设计：将已确认的约定转成足以区分正确和错误行为的简明测试点，保留设计缺口和人工修改。 |
| [project-preparation.md](packages/project-preparation.md) | `project-preparation-1` 至 `project-preparation-19` | 19 | 可移植环境与运行准备：让同一测试流程能使用不同项目的真实工具环境，并明确每次执行已验证的平台与能力边界。 |
| [case-design.md](packages/case-design.md) | `case-design-1` 至 `case-design-20` | 20 | 已有用例查找、复用与补充：为当前场景采用足以验证其判据的实际用例组，优先利用已有测试并避免制造冗余。 |
| [case-identity.md](packages/case-identity.md) | `case-identity-1` 至 `case-identity-13` | 13 | 永久用例身份：通过普通源码注释让实际关联的测试声明在场景、评估、执行和维护中保持可核对的身份。 |
| [case-assessment.md](packages/case-assessment.md) | `case-assessment-1` 至 `case-assessment-12` | 12 | 场景用例组的设计评估：帮助用户判断当前场景关联用例是否设计合理、充分且避免冗余，并以可理解的证据说明取舍。 |
| [execution-evidence.md](packages/execution-evidence.md) | `execution-evidence-1` 至 `execution-evidence-18` | 18 | 真实执行、独立复审与有界修复：使场景结论对应实际运行的测试、产品版本和可信证据，并保留失败及修复过程。 |
| [coverage-reporting.md](packages/coverage-reporting.md) | `coverage-reporting-1` 至 `coverage-reporting-16` | 16 | 工具覆盖率与范围说明：提供与真实执行绑定、由成熟专用工具计算的源码覆盖率，并清楚展示不可计算的范围。 |
| [acceptance-storage.md](packages/acceptance-storage.md) | `acceptance-storage-1` 至 `acceptance-storage-23` | 23 | 验收身份、资料与恢复：让同一项目的验收工作可持续接续、可校验和可共享，同时隔离本机状态及历史证据。 |
| [traceability-view.md](packages/traceability-view.md) | `traceability-view-1` 至 `traceability-view-19` | 19 | 统一追踪与可信阅读：使用户从需求起点直观看到关系和完整当前状态，并按需查看有限而有用的细节。 |
| [workflow-package.md](packages/workflow-package.md) | `workflow-package-1` 至 `workflow-package-4` | 4 | Skill 接入与完整独立包、标准 CLI 和官方角色会话边界。 |

## 阅读与后续边界

- 按当前任务选择需求包；条目 ID 是长期引用，不依赖文件的展示顺序，也不与用例 ID 混用。
- 需求审查的标准、逐条处理及来源见[审查记录](../reviews/requirements-2026-10-24.md)。
- 本次逐需求排序见[验收优先级清单](../.acceptance/AT-20261024-skill-self-p0/PRIORITIES.md)，执行状态与结论保留在同一验收目录。
- 运行适配已有单独的集成验证条目；其余未开展的验证不代表场景完整、测试已实现或功能已通过。
- 本索引不列出或引用临时意图记录，行为和长期组织依据分别保留在包与决策中。

# 黑盒交付场景设计

使用 black-box-scenarios.ts；可执行规范位于 black-box-scenarios.gears.md。读取 references/design-pipeline.md 和 references/acceptance-organization.md。顺序：完整原始需求分析（显式空白盒规则清单，不要求实现）→ 全部组织生成/独立审查/发布 → 逐验收组织生成场景 → 生成门禁 → 独立场景审查及黑盒门禁。此工作流完成设计，不执行应用或声称交付已通过。

全局风险分级、已确认排除、真实范围决定与恢复内容绑定始终适用。每个组织仅有一个生成责任，保持其他组织场景不变；新规则不能绕过来源分析/组织审查。看板展示全部正式单元及逐单元进度。

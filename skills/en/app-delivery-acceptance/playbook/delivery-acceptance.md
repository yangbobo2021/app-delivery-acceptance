# 完整交付验收流程

使用 delivery-acceptance.ts；可执行规范位于 delivery-acceptance.playbook/delivery-acceptance.gears.md。工作流顺序：原始需求导入 → 全部需求与白盒规则分析/脚本门禁 → 完整验收组织生成/独立审查/发布门禁 → 范围内资源预检 → 逐单元生成场景/生成门禁 → 全局独立场景审查 → 原有逐场景执行、证据审查与结论门禁。

读取 references/design-pipeline.md 和 references/acceptance-organization.md。范围约束、全局重要度、真实用户决定、局部审查出处、有限修复和内容绑定恢复均保留。生成中发现新规则须先回到来源分析与组织审查，不能直接加入场景。实时视图按实际落盘数据展示四阶段和每单元进度。

# 独立需求分析入口

`/acceptance-analyze` 只分析当前冻结的完整原始需求，输出整体目标、纳入范围及上下文分组后停止。
它不生成场景、不准备环境、不执行测试，也不把本阶段“暂不执行”误写成整个验收的业务排除。

## 绑定与输入

官方 Playbook 配置注册 `<package>/workflows/analyze/registry.mjs`，将角色 `analyst` 明确绑定到独立 player ID，例如 `acceptance.analyst`。
Agent、实际模型和服务由宿主按用户选择配置；本入口不自行调用模型 SDK 或替换服务。
使用只读权限，输入全文已提供，不需要项目扫描或工具执行。

```text
/acceptance-analyze {"project_root":"/absolute/user-project","acceptance_id":"AT-example","request_id":"analyze-once","definitions_sha256":"当前scenarios.json的SHA-256","mode":"create"}
```

`mode: edit` 还需 `previous_analysis: {path,sha256}` 和明确的 `allowed_changes`（`business_goal`、`confirmed_scope`、`requirement_groups` 中允许编辑的部分）。
可用 `allowed_scope_changes` 进一步限定纳入 ID、排除项或限制说明；`feedback` 保留真实用户/Agent/夹具来源，不把 Agent 建议当用户授权。
`knowledge_paths` 选择已索引知识，作为操作参考，不变成业务合同。
原始需求保持逐字及稳定 ID，不因分组而丢弃；每条输入需求至少处于一个有业务依据的组中。

## 产物与停止点

产物位于 `.acceptance-local/<ID>/workflows/analysis/<request_id>/`：

- `input.json`、`request.frozen.json`、`prompt.txt`：真实输入、完整冻结集合和实际提示。
- `answer.txt`、`answer-receipt.json`、`candidate.json`：角色原答、不可变原答摘要与解析候选。
- `validation.json`、`analysis.json`：原校验器的结构核对和分析版本。
- `candidate-definitions.json`、`freeze-command.txt`：保留原文和其他定义的完整候选，以及宿主可另行发送给冻结入口的消息。
- `result.json`：停止位置、范围、哈希及未自动采用状态。

默认只输出候选，不自动改当前定义；用户要求采用或完整继续验收时，由宿主另行调用冻结入口，再选择设计或其他过程。
没有原始需求时返回 `not_required`，不调用 Analyst，不编造业务目标或需求分组；代码逆向及独立场景使用其真实冻结依据和既有路径。
重复请求只返回已核验产物；原回答被修改或基线过期时不重跑旧过程冒充恢复。

需求物化、版本与候选合并均为 Node；原 Node 分析校验器继续核对完整原文与编辑范围。
结构检查不等于独立语义复审；对目标、排除或分组的语义仍保留其真实分析依据。

## 验证

```sh
node <repository>/tests/acceptance_analysis.integration.mjs --live-cli --output /absolute/evidence-directory
```

验证完整纳入、漏项/虚构 ID 拒绝、局部 edit 边界、原答完整性、无原始需求的显式跳过、真实 CLI Analyst 调用及完成后不重复调用角色。
测试证据记录实际模型及配置；当前真实前向检查使用 Codex/gpt-6.1-sol，不扩大为其他 Agent 已通过。

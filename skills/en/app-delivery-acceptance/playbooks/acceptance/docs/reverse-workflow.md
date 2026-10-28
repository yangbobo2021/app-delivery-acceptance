# 独立提交／PR 逆向分析

`/acceptance-reverse` 使用官方 Playbook 的单个 `analyst` 角色进行只读分析及内部自查，不自动启动 Reviewer、场景设计或产品测试。
入口模块为 `workflows/reverse/registry.mjs`，注册与启动方式见 [独立入口](independent-workflows.md)。

## 输入

除 `project_root`、`acceptance_id`、`request_id`、当前 `definitions_sha256` 外，显式提供：

- `base_revision`、`head_revision`：实际可解析修订，head 须等于源码 HEAD；冻结 merge-base 及目标分支实际修订。
- `source_paths`：完整项目非测试源码文件清单，不是目录；`test_paths`、`noncode_paths` 分类全部变更路径，不能漏归属。
- `pr_requirement_ids`：当前需求中本次明确选择的 ID；`test_modes` 须包含 `WHITE_BOX`。
- `contract_files`：独立合同列表，可空；`context_files`：必要调用方或辅助文件，可空。
- 组件使用原协议 `submodule_paths`；跨仓库合同使用 `path/source_repo/source_ref/source_path` 不可变来源对象。
- 同次提交修改的合同不能自证正确；只有实际用户已确认时提供 `confirmed_contract_paths` 及真实 `confirmation_basis`。

宿主从当前完整定义和真实知识索引物化需求、既有规则及业务上下文，不让模型重造原需求。
角色读取冻结差异、完整源码及独立合同；新规则必须保留独立判据或具体待确认问题。
已有待确认规则仍归 `unresolved`，不能因已有 ID 归入可执行的 `existing_rule`。

## 输出与边界

`.acceptance-local/<AT>/workflows/reverse/<request>/` 保存完整输入、inventory、change、差异分块、提示词、原答及摘要、门禁结果和 `reverse-result.json`。
沿用原 `commit-reverse-selfcheck-v1` 及完整变更门禁；`agent-selfcheck.jsonl` 明确是绑定真实原答的官方角色收据，不伪造 SDK 事件流。官方会话另由 CLI 保存。
输出 `candidate-definitions.json` 与独立 `/acceptance-freeze` 采用命令；候选不会自动采用，待确认规则不能进入可执行场景。
同请求重入不再调用角色，检查定义、HEAD、目标引用、源码和合同；变化时保留历史原结果并返回 `stale`。
冻结定义、Git 变更清单、候选合并及原有完整性门禁均由 Node 执行。

目前源材料显式交接上限为 700000 字符，超出时明确停止；删除的产品文件也沿用旧入口的明确限制，不能静默忽略。
本入口的验证范围以实际测试记录为准，不将单个测试的通过扩大为所有大项目、跨仓库、子模块组合均已实测。
实际前向测试为 macOS 上 Codex/gpt-6.1-sol：三类行为、完整路径归属、候选采用、陈旧输入、失败原答及真实角色重入；源支持范围不等于所有环境通过。

```sh
node <repository>/tests/acceptance_reverse.integration.mjs --live-cli --output /absolute/evidence
```

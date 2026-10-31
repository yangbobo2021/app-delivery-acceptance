# 总调度工作流

本入口同时支持 Codex Skill 的标准 CLI 接入和 [SPEX 原生 UI 接入](spex-installation.md)。角色由宿主管理；标准端口不要求 CLI 的额外 Agent 元数据或原生事件扩展。

`/acceptance-orchestrate` 是 Skill／宿主的唯一业务入口。
总调度角色读取明确委托和实际状态，通过官方 `callPlaybook` 调用原独立入口，判断结果并推动所请求目标完成。
人工或 CI 仍可直接使用原独立工作流。

```json
{
  "project_root": "/absolute/user-project",
  "task_id": "TASK-delivery-01",
  "request_id": "message-01",
  "message": "针对 INV-03 完成交付测试，执行一个 P0 场景，不收集覆盖率，保存报告并结束。",
  "source_checkout": "/absolute/repository-root",
  "source_files": ["README.md", "docs/requirements.md"],
  "context": {"requirement_ids":["INV-03"],"coverage":"off","authorization":"允许准备和修补测试环境及用例，保持产品源码不变。"},
  "budget_seconds": 3600
}
```

`message` 保留用户原话和明确停止点；`context` 是开放 JSON，不要求把自然用户请求翻译成固定模式。
项目文件可经 `source_files` 显式交接，原文及哈希由总调度读取；`source_checkout` 是实际完整仓库根，项目可以是其子目录。
口头需求可直接在消息／context 中保留原话和出处，不强制项目 SPEC。
凭据由原官方运行环境提供，不放入消息、配置说明或报告。
默认调用资源预算为 3600 秒，可显式调整；它不是业务修复次数限制。

同一 task_id 配不同 request_id 交接用户后续消息，例如“只重跑 TC-X”“修复覆盖率后继续原场景”“改为只冻结需求”。
已完成消息的完全相同输入重入直接返回其结果，不重放子工作流。
每个子调用保留实际输入、原始结果及官方父子会话身份；子调用完成不自动等于业务通过。
总调度读取具体失败，调用负责前提的工作流修复、重新绑定和继续，不把普通 blocked 当成整项任务的必然终点。
需要真实用户信息、授权或资源时返回 needs_input／blocked，说明已完成范围和可继续条件。

资料保存在 `.acceptance-local/orchestration/<task_id>/`：任务状态、不可覆盖的消息输入、每轮 planner 提示和原答、子调用输入及结果。
总调度只检查委托项目、声明 checkout、显式来源文件和本包文档；文件检查可按真实行范围请求，不执行任意宿主命令。
调度角色声明禁止写入、shell 执行及网络权限，并约定只使用结构化检查／调用协议；原生 Agent 的权限映射可能仍提供只读命令，不能把这一声明描述成完全无工具的沙箱保证。创建、准备、执行及归档等业务效果通过已配置的公开子工作流完成。
运行中或不确定的任务归属保留，不删除锁重跑。
只读检查仍通过总入口，例如同 task_id、新 request_id、`inspect:true`；需要恢复官方暂停会话时使用其原会话，不用新调度请求重放未知子效果。

正常接入命令：先用包的 `bin/configure.mjs` 生成包含总调度与子角色的 overlay，再用标准 `playbook run --with ... --no-provision --json`，stdin 仅传 `/acceptance-orchestrate JSON`。
宿主不准备子工作流调用链、不运行其确定性工具、不改写生成结果，也不自行补做子工作流内部步骤。

## 子调用准备与设计结果

子注册模块可公开命名导出 `inputContract` 和只读 `preflightInput(input)`；总调度从真实注册清单发现，当前冻结入口提供这项能力。
总调度在官方子会话启动前调用预检，将结果保存为本次 planner 的 `NNNN-preflight.json`。
预检失败通过 `child_input_invalid` 返回结构化 `issues`，不创建子调用记录或业务尝试；调度角色依据真实资料修正全部可确认问题，缺少业务意图时询问用户。
预检与正式冻结复用校验，正式入口仍在锁内重查版本、来源和身份；预检不持锁、不发布，也不构成后续发布授权。
没有预检导出的子入口继续沿用自己的正式输入校验，不由总调度复制一份业务规则。

场景结果的 `design_coverage.status` 区分 `complete`、`partial` 和 `blocked`，`execution_prerequisites` 单列后续执行条件。
总调度应结合实际候选、未覆盖义务和用户目标判断设计是否完成，不能只检查 `status: designed`，也不能把许可条款的合法零场景机械判为失败。
需要纠正设计判断时，使用场景入口的 `design_feedback` 交回同一负责角色，以真实回执路径和字节哈希绑定旧结果，并为新尝试使用新 ID。
总调度不改写角色原答或自行替写场景冒充 Designer 产物；真实业务判据缺失时明确提问。

# 跟随当前 Agent 的模型运行

当前 v3/v4 使用同一套验收流程，通过 cligent 选择 Codex、Claude Code 或 OpenCode。内部任务建立独立会话，复用当前 Agent 的模型服务与认证配置；Reviewer 不复用实现者会话。

## 首次启动

由加载 Skill 的 Agent 在工具命令环境中明确提供：

- `ACCEPTANCE_AGENT`：`codex`、`claude-code` 或 `opencode`。
- `ACCEPTANCE_MODEL`：当前会话实际使用的模型标识。不可根据 Agent 名称猜模型。Claude Code 的 `ANTHROPIC_MODEL` 或 Codex 当前配置中的 model 可以作为已知配置来源；会话有临时覆盖时，调用者必须传实际值。
- 保留当前模型服务的环境变量。密钥只通过运行环境/Agent 原有认证设施提供，不写请求、SPEC、配置快照或报告。

例如 Claude Code 已配置 DeepSeek 时，设置 `ACCEPTANCE_AGENT=claude-code`、`ACCEPTANCE_MODEL=deepseek-flash`，保留现有 `ANTHROPIC_BASE_URL` 和认证环境。无需提供 Codex/OpenAI 凭据。

OpenCode 必须传实际的完整 `provider/model`，例如 `ACCEPTANCE_AGENT=opencode ACCEPTANCE_MODEL=bigmodel/glm-5.3-flash`。`opencode` CLI 须在当前 `PATH`，保留当前 `OPENCODE_CONFIG`、`OPENCODE_CONFIG_CONTENT`、XDG 目录和提供商的认证环境。内部通过仅监听本机的短生命周期原生服务读取当前有效配置，再将选中提供商配置通过子进程环境交给独立会话；工作目录切换不改变模型服务。配置读取不调用模型，不记录配置原文或认证值；不能用会将密钥替换为 `***` 的 `debug config` 输出来复制认证。当前支持 OpenCode 1.x CLI >=1.18.12；SDK 由 Skill 锁定，未将 OpenCode 2 视为已验证。

Codex 使用现有 CODEX_HOME/认证。服务配置从当前 config.toml 及其所选 profile 中读取；若当前会话通过命令行选择了 profile，由调用者传 `ACCEPTANCE_CODEX_PROFILE`。只向内部 CLI 传递模型服务配置，验收角色权限继续由工作流控制。Claude Code 补充读取用户及项目 settings 的提供商环境配置，已有进程环境优先；不复制 hooks、插件或权限到工作流。

`ACCEPTANCE_EFFORT` 可显式覆盖推理强度，否则继承当前 Codex 配置的 model_reasoning_effort 或 Claude Code 的 CLAUDE_CODE_EFFORT_LEVEL；未知时采用该 Agent 自身默认值。保留 PREANALYSIS_MODEL、REVERSE_MODEL、SCENARIO_PROTOTYPE_MODEL 和 REVERSE_EFFORT 作为调用者明确选择的阶段覆盖。

OpenCode 的 `ACCEPTANCE_EFFORT` 使用选中模型配置内实际存在的 variant 名称；自定义提供商也传入同名 variant。未配置该名称时明确停止，避免静默忽略推理档位；未指定则保留模型默认行为。

## 预检与依赖

先运行 `python3 <skill>/scripts/ensure_runtime.py`，再运行：

```sh
node <skill>/playbook/agent-preflight.mjs
```

预检使用相同适配器和模型做一次无工具的真实连通性调用，失败立即停止，不建立虚假的分析/测试结论。它不证明后续业务测试通过。只保存不含凭据的 Agent、模型、服务地址、SDK 版本和状态；认证值不写出。

依赖沿用一份 package-lock.json，包含三套 SDK，首次下载量相应增加；都安装在 Skill 内并按原机制复用。认证和选中 Agent 的可执行探测按本次选择执行，Claude/OpenCode 路径不要求 Codex 登录。OpenCode 复用调用者已有 CLI，不额外在 Skill 内安装另一份 CLI。基础工具缺失仍明确报告，不自动安装系统 Node/Python/Git。

OpenCode 通过原生 SDK/server 会话执行，并复用 cligent 的事件归一化、取消和恢复。无工具的模型阶段禁用原生工具；复审保留只读文件工具和流程明确许可的 shell，编辑仍被禁用。用例调试的 `bypass` 契约映射为明确允许写文件、shell 和网络并以 `auto` 处理询问，不向不支持该参数的 adapter 传 `bypass`。内部角色禁止递归调用 `task` 或 `skill`，独立角色由验收宿主调度。UI 复审将冻结图片编码为原生 file 内容块，传入实际像素，不用路径文本代替。该权限映射不是 shell 的操作系统沙箱，宿主继续核对文件变更和执行证据。

## 尝试与恢复

每个模型流程目录保留 `agent-runtime.json`，指标中同时保存实际运行信息。恢复必须匹配 Agent、模型、推理强度、服务和 SDK；实际 sessionId 来自该 Agent 的事件，不能跨 Agent 使用。变更配置时保留旧目录并建立新尝试；缺运行绑定的旧尝试仍可查看和引用结论，需要继续模型调用时建立新尝试。已完成产物的只读复用不要求重建旧会话。

OpenCode 的恢复绑定另含 CLI 版本和去除认证值后的有效提供商/模型配置指纹；服务、模型参数或适配实现变化须新建尝试。密钥轮换不写入绑定文件。

统一运行入口为 `playbook/agent-runtime.mjs`；阶段不得自行实例化某一固定适配器。旧版 acceptance-organization 启动器不是当前验收路径，不因本次改动恢复使用。

### OpenCode JSON result delivery

JSON workflow stages opt into `jsonOutput: true`; `jsonResultSchema` may additionally bind stage-required object fields (for example the complete case-reuse plan). The runtime requests native OpenCode JSON-schema output with a `result` object envelope, then reads the completed assistant result bound to the exact submitted message. Raw text and tool events remain in the trace; only the native structured object supplies the final JSON snapshot. Missing/failed structured submission blocks the stage; prose is never scraped into a replacement answer. Existing stage validators still check the task schema and evidence. Plain-text runtime probes do not enable this mode.

The [OpenCode validation record](opencode-validation.md) lists the actual platform/model, reproducible checks, official benchmark scope and retained limitations.

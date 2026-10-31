# Agent 与模型配置

Skill 首次准备在 macOS/Linux 使用 `sh <skill>/scripts/setup.sh`，原生 Windows 使用 `powershell -NoProfile -ExecutionPolicy Bypass -File <skill>\scripts\setup.ps1`。
入口优先复用兼容运行时，缺少时下载固定且校验摘要的 Node，Windows 缺少 Git 时优先复用已安装 SPEX 的 Git，再准备固定 MinGit，不修改系统 PATH。
使用返回的 `node`、`package_root`、`playbook`，仅在正式配置和 CLI 进程及其子进程中应用 `path_prefix`。
SPEX 托管导出目录不安装 node_modules；依赖和源码副本位于校验后的独立缓存。

全部角色由 [标准 Playbook 配置](native-cli-boundaries.md) 管理，不设置第二份环境角色映射。配置生成入口：

```sh
node <package>/bin/configure.mjs --agent codex --model ACTUAL_MODEL --roles /absolute/roles.json --output /absolute/new-overlay.json
<returned-node> <returned-playbook> run --with /absolute/new-overlay.json --no-provision --json
```

`roles.json` 只描述显式差异：

```json
{"implementer":{"agent":"opencode","model":"provider/actual-model"},"reviewer":{"agent":"codex","model":"actual-model"},"evaluator":{"agent":"claude-code","model":"actual-model"}}
```

角色来自实际 registry 声明，不能猜测 Agent 或静默补模型；OpenCode 使用完整 provider/model。服务地址、认证和本机原生 CLI 仍由真实 Agent 环境提供。凭据不进入角色配置或执行报告。官方 CLI 配置为每个工作流角色建立不同 player ID；SPEX 中也应为不同职责绑定独立 Player。标准宿主管理会话续接，每次 Prompt 交接完整当前任务，不声称每次都是新的提供商会话。显式恢复仍须核对原始冻结绑定。

`runtime/players.mjs` 始终通过官方 Player 端口交接；业务角色不自行构造 SDK。CLI 本地修订版暴露 Agent 元数据时，沿用现有实际配置、图片及原生事件记录。SPEX 产物使用标准端口：Agent/model/effort 由 UI 和宿主绑定，未暴露的值记录为 null/host-managed，原始 promptIdentity 保留而不解析成模型设置；不读取包内 SDK 或根据本机默认模型猜测宿主配置。

标准端口的目录、权限、图片绝对路径和结构化输出是每次完整 Prompt 的约定，不是宿主执行覆盖或操作系统沙箱。角色必须先 cd 或使用绝对路径、遵守能力限制并实际查看图片；只读任务另核对项目文件字节，发现变更保留证据并停止。角色输出只采用官方返回的完整 finalText，经原有业务门禁验证。`official-player/` 保存调用、Prompt 和原始结果；`agent.jsonl` 的 text/done 标明 official-player-result 来源，不伪造 native init/tool 事件，未暴露的工具次数记为 null。

CLI 的详细事件模式继续保留真实 native 事件与原有失败恢复边界。标准模式可以验证并采纳已完成的官方回执，但不以工作流会话 UUID 假装提供商会话，也不自动恢复未知失败。

只读核对包含 Git 忽略的项目普通文件；排除 `.git`、`node_modules`、`.acceptance-local`、`.venv`、`venv`、`__pycache__` 与本次角色证据目录，符号链接仅核对链接文本，不跟随到外部目录。这是文件结果检查，不提供进程、网络或外部目录的沙箱保证。

依赖检查使用 `node <package>/runtime/dependencies.mjs`，它不会发起模型工作或创建验收。真实连通和角色能力须通过标准 CLI 的具体公开工作流验证；无工具回复不能证明后续工具或视觉能力。

受限工具无法通过 signal 0 核验工作区拥有者时，工作流以本 AT 租约目录中的一次性挑战取得拥有者签名，核对权限交接固定的公钥、完整租约及本次随机数。私钥仅保留在拥有者进程内，挑战和响应保留为证据；签名不匹配、重放、超时或拥有者退出均停止，不调整 Agent 沙箱权限，也不接管未知锁。

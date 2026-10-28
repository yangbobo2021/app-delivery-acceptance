# Agent 与模型配置

全部角色由 [标准 Playbook 配置](native-cli-boundaries.md) 管理，不设置第二份环境角色映射。配置生成入口：

```sh
node <package>/bin/configure.mjs --agent codex --model ACTUAL_MODEL --roles /absolute/roles.json --output /absolute/new-overlay.json
<package>/node_modules/.bin/playbook run --with /absolute/new-overlay.json --no-provision --json
```

`roles.json` 只描述显式差异：

```json
{"implementer":{"agent":"opencode","model":"provider/actual-model"},"reviewer":{"agent":"codex","model":"actual-model"},"evaluator":{"agent":"claude-code","model":"actual-model"}}
```

角色来自实际 registry 声明，不能猜测 Agent 或静默补模型；OpenCode 使用完整 provider/model。服务地址、认证和本机原生 CLI 仍由真实 Agent 环境提供。凭据不进入角色配置或执行报告。官方配置为每个工作流角色建立不同 player ID；每个新尝试重置其角色会话，显式恢复仍须核对原始冻结绑定。

`runtime/configuration.mjs` 只读取服务身份，`runtime/players.mjs` 只通过官方 Player 端口交接；业务角色不可自行构造 SDK。工作目录、图片和不超过配置上限的权限是调用参数。OpenCode 原生 JSON 只采用当前 message 对应的 completed assistant structured.result；其他 Agent 保留原始 JSON 文本并经业务门禁核对。

依赖检查使用 `node <package>/runtime/dependencies.mjs`，它不会发起模型工作或创建验收。真实连通和角色能力须通过标准 CLI 的具体公开工作流验证；无工具回复不能证明后续工具或视觉能力。

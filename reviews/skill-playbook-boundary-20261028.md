# Skill / Playbook 职责切分验证（2026-10-28）

本轮按 DR-009 完成边界搬迁；此前停止的六项目验收没有恢复。

- Skill 保留 `SKILL.md`、展示资源及仅调用依赖准备的 `scripts/setup.mjs`。
- 完整可独立安装包位于 `skills/en/app-delivery-acceptance/playbooks/acceptance`；业务、角色、工具、合同、配置及依赖都归包所有。
- 30 个公开入口、17 个工作流角色由实际 registry 生成官方配置；不再依赖 `ACCEPTANCE_ROLE_CONFIG` 或私有 CLI 包装器。
- 模型执行通过官方 Player 端口；包内进程隔离仅用于确定性角色工具和收据，模型会话由官方运行时管理。
- 本地官方构建为 Playbook `18.1.1-acceptance.20261028.2` 和 Cligent `0.36.2-acceptance.20261028.2`，源码补丁、来源与 tarball 随包提供，尚未公开发布。
- 分发采用 `npm-shrinkwrap.json` 和随包运行时，解决嵌套本地依赖在普通 npm 安装时的解包次序问题。

## 验证结果

| 验证 | 结果与范围 |
| --- | --- |
| npm pack → 空目录 npm install | 独立包 `0.2.1` 安装成功；166 个自有文件与当前源码逐个 SHA-256 一致 |
| 全部公开命令 | 30 个入口通过标准官方 CLI 的缺参及前提拒绝检查；这是入口保护验证，不是全部正向业务路径覆盖 |
| 协议回归 | 24 组回归全部通过；另有配置、资源闭合和 Skill 格式验证 |
| 官方运行时 | Playbook 660 项、Cligent 366 项定向测试通过；不是两仓库全部测试套件 |
| 实际完整流程 | 标准 CLI 完成 13 步：创建、冻结、只设计 A、准备环境/项目、复用调试用例、独立评估、正式执行/复审、判断 A、只设计 B、报告；6 项链路断言通过 |
| 三种 Agent | Codex 使用 gpt-6.1-sol；Claude Code 和 OpenCode 通过相同 GLM 服务完成真实文本工作流，OpenCode 采用原生结构化结果 |
| 图片 | 实际 1440×1000 浏览器前后截图，经正式执行和无源码手工证据入口传给独立 Codex Reviewer；正常通过，裁切反例在命令退出 0 时仍判视觉 BUG |
| 自定义 Codex 服务 | 原生默认 provider 指向本地拒绝服务，实际请求路径/模型相符；不把故意拒绝当作成功模型服务 |

## 保留的问题与边界

迁移过程中保留了会话字段校验、模型默认配置绑定、会话存储误用、工作区租约交接、完整消息选择、独立评估合同路径及 npm 打包失败的原始证据，修复后用新尝试重验。
Claude 既有全局服务设置曾覆盖临时环境，验证改用独立原生配置目录，没有修改用户全局配置。
Codex 的自定义 provider 验证使用原生默认配置；仅写 profile 名而未在 SDK 入口选中的夹具不能证明 profile 路由成功。
本机实测为 macOS / arm64、Node 25.5；不扩大为 Linux、Windows、所有 Agent/模型/视觉组合或六项目全量交付通过。
主链路单独验证了明确关闭覆盖率的场景；本轮不重开此前停止的完整覆盖率验收。
本轮未提交、推送或公开发布。

完整逐步输入、输出、命令、执行收据、截图、失败记录和安装物保存在本次本机报告 `outputs/skill-playbook-boundary-20261028/report.html`。

## 复现入口

```sh
cd skills/en/app-delivery-acceptance/playbooks/acceptance
npm ci --no-audit --no-fund
node bin/configure.mjs --agent codex --model ACTUAL_MODEL --output /absolute/new-overlay.json
./node_modules/.bin/playbook run --with /absolute/new-overlay.json --no-provision --json
```

最后一条通过 stdin 接收精确的 `/acceptance-<入口> JSON`；项目资料、真实模型及原生认证配置须由调用者显式提供。

# App Delivery Acceptance — SPEX + Skill

同一次安装提供真实 `app-delivery-acceptance` Skill 和 31 个原生 SPEX Playbook。当前联合包版本 **0.4.9**。

## Windows / Mac SPEX APP：从 GitHub 安装

用户不需要下载本地包、不需要访问发布者的电脑目录，也不需要为公开仓库提供 GitHub Token。

1. 在 SPEX 中选择要使用的项目，打开 **规程 → 从 Git 添加**。
2. 按下面的信息填写：

| 字段 | 值 |
| --- | --- |
| 包名 / Spec package name | `yangbobo2021/app-delivery-acceptance` |
| Git 仓库地址 | `https://github.com/yangbobo2021/app-delivery-acceptance.git` |
| 分支、标签或提交 | `main` |
| 仓库内文件夹 | 留空，包就在仓库根目录 |

3. 添加后执行界面提示的解析与安装。`spex.lock` 固定实际 Git commit 和文件摘要；再次安装按锁定内容执行。
4. 确认项目的 `.agents/skills/app-delivery-acceptance/SKILL.md` 已导出，并在规程列表看到 `acceptance-orchestrate`。
5. 安装文件不等于配置 Agent。启用 `acceptance-orchestrate` 及任务所需子规程，为各职责绑定独立 Player，并配置自己的 Agent、模型、登录与网络。

当前 SPEX 的 Git 表单还要求填写包名和分支；仅粘贴一个 URL 自动识别全部信息不是现有 UI 的行为。以上信息全部在本公开仓库中，仓库链接即可带用户到本说明。

Windows 上已完成的业务主流程验证使用 Codex。Claude Code 的 PowerShell 权限映射仍待修正，OpenCode 在 SPEX APP 中另需外部 CLI，不能把本包安装成功当作所有 Agent 均已通过。

## 先验证工作流调用

在 SPEX 会话中调用 `/acceptance-orchestrate`，提供实际项目路径、稳定 task_id、新 request_id、用户目标、必要背景与停止点。最小安装检查可以要求“只创建空交付测试即停止，不生成需求、场景、用例，不执行产品测试”；这只证明调用链，不等于产品验收通过。

完整主流程可以要求从真实需求生成场景，只执行一个选定场景并独立复审，coverage off。目录隔离、角色权限、签名租约、不可覆盖输入、冻结证据和独立复审要求不变；测试业务规则仍在 Skill/Playbook 内。

## 在 Codex 中使用同一 Skill

在上述项目中新开 Codex 回合，使用 `$app-delivery-acceptance`。Skill 首先运行自己的 `scripts/setup.mjs`，使用返回的外部 `package_root` 执行官方 CLI；不要在 SPEX 受管导出目录安装 node_modules。此 CLI 形态另需 Node.js >=22、npm、Git 和自己的 Agent 认证。SPEX 原生 Playbook 使用 APP 提供的引擎，不需要用户为它安装 npm 依赖。

同名已存在且不归 SPEX 管理的 Skill 目录应保留，界面会报告未导出，不要删除用户目录来伪造安装成功。

## 发布和验证范围

本分支保存可安装的 format-2 联合发布内容。默认分支就是可安装的发布目录，历史开发分支不作为此安装版本的来源。此 0.4.9 联合包的业务代码与此前 Windows APP、Mac APP、macOS Codex Skill 主流程验证的版本相同；GitHub 来源在 Windows 的安装验收结果单独记录，不能由本地包结果替代。

本包不包含登录凭据、发布者的 node_modules 或本地测试运行证据。后续使用需要用户自己的登录、模型权限和网络。

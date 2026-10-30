# SPEX 联合安装包

发布者在本 Skill 的工作流包依赖已准备好后运行：

```sh
node bin/build-spex.mjs --output /absolute/new-release --org your-org
```

产物是一个 format-2 包，包含真实 `app-delivery-acceptance` Skill 与 31 个原生 Playbook。两类入口来自同一份业务源码，`requires` 保持联合选择闭包；原生入口使用 SPEX 引擎，Skill 保留自己完整的锁定 CLI 与 vendor 资源。安装者不手工复制 Skill 或设置工作流 overlay。

把产物目录放在用户项目中，例如 `spex-packages/delivery-acceptance`；从 SPEX UI 的“规程 → 从文件夹添加”填写包名及项目内相对目录。安装后，SPEX 会把真实 Skill 导出到该项目的 `.agents/skills/app-delivery-acceptance`，在该项目中新开 Codex 回合可使用 `$app-delivery-acceptance`。这是项目级安装；用户组安装及同名已有目录的保留规则继续由 SPEX 决定。注册表正式发布、鉴权和跨机器下载须另行验证。

SPEX 内启用 `acceptance-orchestrate` 与任务所需子入口，并为不同职责绑定独立 Player，选择实际 Agent/model/effort。文件安装不会自动启用全部工作流。原生执行无需 npm。

Codex 读取的是实际 Skill，不是由 Playbook 生成的启动提示。Skill 首先运行自身 `scripts/setup.mjs`；带 `SPEX-INSTALL.json` 的安装使用独立内容缓存准备 CLI 依赖，返回实际 `package_root`。后续配置和官方 CLI 命令使用该返回路径，不在 SPEX 受管 Skill 目录写 node_modules。首次准备仍需要声明的 Node/npm/Git 与实际 Agent 环境；凭据不会复制到缓存。普通单独 Skill 安装仍可使用原有已准备包。

同名全局 Skill 不与项目 Skill 合并；验证或选择时应核对实际读取路径。SPEX 重导出代码目录后，内容相同的 CLI 缓存继续复用；源代码或缓存字节与安装清单不符时停止而不静默覆盖。

会话只向总入口交接业务目标：

```text
/acceptance-orchestrate {"project_root":"/absolute/user-project","task_id":"TASK-delivery-01","request_id":"create-01","message":"只创建空交付测试即停止，不生成需求、场景、用例，不运行产品测试。"}
```

`project_root` 是实际用户项目。总调度管理后续子调用，外层 Codex 不组织子工作流步骤。目录、权限和证据继续由工作流 Prompt 与校验管理，SPEX 沿用通用角色执行机制；宿主未暴露的元数据仍记录为未知。详见 [总调度合同](orchestration-workflow.md) 与 [Agent 配置](agent-runtime.md)。

独立 Electron 桌面宿主中，包只对自己的 Node 子脚本和确定性工具指定 Node 模式；普通 Node CLI、项目执行器及父宿主环境不变。通过真实桌面运行核对主流程，不用服务器 UI 成功替代桌面验证。

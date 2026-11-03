# SPEX 联合安装包

源码仓库保留完整开发内容，安装产物写入独立安装仓库；不把生成目录直接作为源码主干。
发布者在完整源码已提交、依赖已准备好后，从源码仓库根运行：

```sh
node scripts/build-distribution.mjs --output /absolute/new-release
```

产物是一个 format-2 包，包含独立公开的真实 `app-delivery-acceptance` Skill 与 31 个原生 Playbook。两类入口来自同一份业务源码；Playbook 之间的同类 `requires` 保留原生选择闭包，不以跨类型相互依赖隐藏主入口或 Skill，默认安装完整包同时提供两种入口。原生入口使用 SPEX 引擎，Skill 保留自己完整的锁定 CLI 与 vendor 资源。安装者不手工复制 Skill 或设置工作流 overlay。

已发布版本：在 SPEX APP 的项目 → Packages → Add… → Registry 搜索 `yangbobo2021/app-delivery-acceptance`，选择版本后添加。公开包无需包平台登录、GitHub 地址或手工拷贝。

开发者也可把构建产物放在用户项目中，例如 `spex-packages/delivery-acceptance`，通过 Packages → Add… → Folder 添加；Git 安装可使用独立安装仓库。安装后，SPEX 将真实 Skill 导出到该项目的 `.agents/skills/app-delivery-acceptance`，在该项目中新开 Codex 回合使用 `$app-delivery-acceptance`。这是项目级安装；用户组安装及同名已有目录的保留规则继续由 SPEX 决定。

发布包带有 Apache-2.0 声明及许可证。构建保留 `package.json` 和 `npm-shrinkwrap.json` 实际引用的本地依赖归档，历史快照只保留在开发源码；复制和筛选完成后，自动生成 `SPEX-INSTALL.json`。其中 `package_files` 是 `playbooks/acceptance` 实际发布文件的 SHA-256 清单，同时作为独立缓存的内容标识。构建不自动上传或更改平台限制；Registry 当前压缩包上限为 5 MiB，应使用实际 SPEX 发布打包入口检查。发布、鉴权、下载与实际业务执行仍须分别保留本轮证据，构建成功不代表已发布或跨机器验收通过。

SPEX 内启用 `acceptance-orchestrate` 与任务所需子入口，并为不同职责绑定独立 Player，选择实际 Agent/model/effort。文件安装不会自动启用全部工作流。原生执行无需 npm。

Codex 读取的是实际 Skill，不是由 Playbook 生成的启动提示。
Skill 首先运行平台入口 `scripts/setup.sh` 或 `scripts/setup.ps1`，优先复用兼容运行时，缺少时下载固定且校验摘要的 Node，Windows 缺少 Git 时准备固定 MinGit。
带 `SPEX-INSTALL.json` 的安装使用独立内容缓存准备 CLI 依赖，返回实际 `package_root`、`node`、`playbook` 和仅供当前 CLI 进程继承的 `path_prefix`。
后续配置和官方 CLI 命令使用该返回路径，不在 SPEX 受管 Skill 目录写 node_modules；实际 Agent 环境仍由用户提供，凭据不会复制到缓存。

同名全局 Skill 不与项目 Skill 合并；验证或选择时应核对实际读取路径。SPEX 重导出代码目录后，内容相同的 CLI 缓存继续复用；源代码或缓存字节与安装清单不符时停止而不静默覆盖。

SPEX 用户在选定项目中直接向总入口输入自然语言，不需要生成 JSON 或内部身份：

```text
/acceptance-orchestrate 请依据项目书面需求生成场景，选择一个场景真实执行、独立复审，并保存报告与查看结果。
```

主入口从 SPEX 公开的 `cwd` 和会话身份获取真实项目与稳定任务／消息身份；缺少上下文时明确报错，不猜测项目。连续消息保留完整原话；程序化 JSON 委托继续使用同一套校验。

Codex Skill 按原合同通过 CLI 交接结构化业务目标，以下 JSON 由宿主准备，不要求用户手工输入：

```text
/acceptance-orchestrate {"project_root":"/absolute/user-project","task_id":"TASK-delivery-01","request_id":"create-01","message":"只创建空交付测试即停止，不生成需求、场景、用例，不运行产品测试。"}
```

`project_root` 是实际用户项目。总调度管理后续子调用，外层 Codex 不组织子工作流步骤。目录、权限和证据继续由工作流 Prompt 与校验管理，SPEX 沿用通用角色执行机制；宿主未暴露的元数据仍记录为未知。详见 [总调度合同](orchestration-workflow.md) 与 [Agent 配置](agent-runtime.md)。

独立 Electron 桌面宿主中，包只对自己的 Node 子脚本和确定性工具指定 Node 模式；普通 Node CLI、项目执行器及父宿主环境不变。通过真实桌面运行核对主流程，不用服务器 UI 成功替代桌面验证。

## Native Windows command prerequisites

The installed package retains each role's filesystem, shell and network policy. Its locked Codex adapter prefers a compatible native MXC sandbox and provides command-shell guidance; it neither installs WSL nor disables sandboxing. A host lacking a usable native sandbox must complete the supported Codex preparation or report that prerequisite. The current physical Windows acceptance host is Windows 11 build 26100.9711; runtime smoke, model replies and package presence do not substitute for selected-scene execution and independent review.

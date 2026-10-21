# App Delivery Acceptance

应用交付验收与自动化测试 Skill。以冻结需求、代码版本、场景、真实执行证据和独立复审形成可回溯的验收结果，并提供只读结果与覆盖率视图。

首次接触本仓库，请先看[仓库首页的安装与首次任务](https://github.com/yangbobo2021/app-delivery-acceptance#第一次使用)。配套公开六项目测试集、固定基线及验证记录见[测试集说明](references/benchmark.md)。本页面面向需要了解依赖准备或维护源码的读者。

## 当前版本

推荐固定 Git 标签 `v0.1`，对应提交 `013c08ddd1b99f4eb4a89a26323da675e07f2aa4`。SPEX 包内版本为 `0.1.0-github.3`；Git 标签与包内版本分别记录，不据名称推断测试范围。具体已验证版本、抽样范围和限制见[验证记录](references/benchmark.md#已有哪些验证记录)。

保留 Skill、脚本、测试、视图、参考文档及仍被调用的 Playbook 文件；`.slc-verify` 是现有测试依赖，继续保留。`.slc` 编译缓存、中间生成稿、依赖目录、Python 缓存和本地环境配置不入库；有复用价值的缓存保留在本地，取消 Git 跟踪不等于删除本地文件。每个旧 Playbook 的正式 GEARS 文件只保留在其 `.playbook/` 目录内；首次快照中的缓存和重复文件仍可通过 Git 历史回溯。

## 文件入口

- [SKILL.md](SKILL.md)：Skill 总入口与使用约束。
- [references/portable-workflow-v4.md](references/portable-workflow-v4.md)：当前自动化执行路径。
- [references/portable-workflow-v3.md](references/portable-workflow-v3.md)：v3 可移植路径与黑盒、人工操作场景。
- `playbook/`：流程、确定性门禁与执行编排。
- `scripts/`：存储、证据、覆盖率与查看服务。
- `assets/ledger-viewer/`：只读结果视图。
- `tests/`：现有测试与探针。

## 使用环境

支持 macOS/Linux；需要 Python 3、Git、Node.js >=22 和 npm，以及当前 Agent（Codex 或 Claude Code）可用的认证和模型访问。启动前由调用者明确提供当前 ACCEPTANCE_AGENT、实际模型与服务环境；内部任务和独立复审使用所选 Agent 的不同会话，详见 [Agent 运行配置](references/agent-runtime.md)。首次下载需要能访问 npm 包源，Skill 目录须可写。基础运行时缺失或版本不足时明确报错，不自动安装或切换系统 Node；原生 Windows 暂不支持。

Agent 在模型流程或 SPEX 回填前运行：

```sh
python3 <skill>/scripts/ensure_runtime.py
```

`playbook/package.json` 和提交的 `package-lock.json` 固定运行依赖。准备入口首次执行 `npm ci`，仅安装到本 Skill 的 `playbook/node_modules/`；后续在声明、锁文件、Node/npm/平台一致且实际模块和 CLI 检查通过时返回 `status: reused`，不重新安装。成功收据及 `install_id` 保存在 `node_modules/.acceptance-runtime.json`，只有安装完成并验证后才写入。缺包、环境变化或安装中断后会重新准备；同目录安装互斥，失败不继续业务流程。

模型工作流的公共运行时入口自动执行相同检查，使用自身 Node 路径，从 Skill 本地解析正式模块入口，不使用全局 Playbook、`PLAYBOOK_PACKAGE_ROOT` 或被测项目的依赖兜底。Python 的资料存储和定义冻结不需要先下载 npm 包。模型认证及模型选择仍使用执行电脑自己的配置，不随 Skill 分发，也不由依赖准备脚本验证账号可用性。

默认回填使用本地固定 SPEX CLI：`<skill>/playbook/node_modules/.bin/spex scaffold --lang zh --agents codex`。只有获授权回填且项目缺少组织规范时才初始化；准备依赖不会提前生成项目 SPEC。

按 `SKILL.md` 和对应工作流文档准备项目输入后执行，不要将真实凭据、项目运行数据或验收证据放入此 Skill 仓库。

## 维护源码与历史回溯

本节供维护者使用。Skills CLI 或 SPEX 安装的目录可能是复制或导出文件，不保证处于 Git 仓库中。开发时使用单独的源码检出目录，在仓库根目录执行以下命令；提交、推送按维护者的授权和仓库权限执行：

```sh
git status
git diff
git add <本次修改的文件>
git commit -m "说明本次修改"
git push
```

历史标签 `baseline-2026-10-16` 是首次版本快照，保留用于回溯，不作为当前首次安装入口，也不表示已重新验收全部功能。查看当前标签或比较后续源码修改：

```sh
git show v0.1
git diff v0.1 HEAD
git log --oneline --decorate
```

需要阅读旧版本而不影响当前目录时，可创建独立工作树：

```sh
git worktree add --detach ../app-delivery-acceptance-v0.1 v0.1
```

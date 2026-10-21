# App Delivery Acceptance

应用交付验收与自动化测试 Skill。以冻结需求、代码版本、场景、真实执行证据和独立复审形成可回溯的验收结果，并提供只读结果与覆盖率视图。

## 当前基线

2026-10-16 首次纳入 Git 版本管理，保存当前使用版本。初始标签为 `baseline-2026-10-16`；该标签是版本快照，不表示本次重新完成了全部功能验收。

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

支持 macOS/Linux；需要 Python 3、Git、Node.js >=22 和 npm，以及可用的 Codex 认证、模型访问。首次下载需要能访问 npm 包源，Skill 目录须可写。基础运行时缺失或版本不足时明确报错，不自动安装或切换系统 Node；原生 Windows 暂不支持。

Agent 在模型流程或 SPEX 回填前运行：

```sh
python3 <skill>/scripts/ensure_runtime.py
```

`playbook/package.json` 和提交的 `package-lock.json` 固定运行依赖。准备入口首次执行 `npm ci`，仅安装到本 Skill 的 `playbook/node_modules/`；后续在声明、锁文件、Node/npm/平台一致且实际模块和 CLI 检查通过时返回 `status: reused`，不重新安装。成功收据及 `install_id` 保存在 `node_modules/.acceptance-runtime.json`，只有安装完成并验证后才写入。缺包、环境变化或安装中断后会重新准备；同目录安装互斥，失败不继续业务流程。

模型工作流的公共运行时入口自动执行相同检查，使用自身 Node 路径，从 Skill 本地解析正式模块入口，不使用全局 Playbook、`PLAYBOOK_PACKAGE_ROOT` 或被测项目的依赖兜底。Python 的资料存储和定义冻结不需要先下载 npm 包。模型认证及模型选择仍使用执行电脑自己的配置，不随 Skill 分发，也不由依赖准备脚本验证账号可用性。

默认回填使用本地固定 SPEX CLI：`<skill>/playbook/node_modules/.bin/spex scaffold --lang zh --agents codex`。只有获授权回填且项目缺少组织规范时才初始化；准备依赖不会提前生成项目 SPEC。

按 `SKILL.md` 和对应工作流文档准备项目输入后执行，不要将真实凭据、项目运行数据或验收证据放入此 Skill 仓库。

## 后续修改与回溯

当前 Skill 的原目录就是 Git 工作目录，Codex 安装链接继续指向该目录。修改后先检查差异并完成适当验证，再提交和推送：

```sh
git status
git diff
git add <本次修改的文件>
git commit -m "说明本次修改"
git push
```

查看基线或比较后续修改：

```sh
git show baseline-2026-10-16
git diff baseline-2026-10-16 HEAD
git log --oneline --decorate
```

需要阅读旧版本而不影响当前目录时，可创建独立工作树：

```sh
git worktree add --detach ../app-delivery-acceptance-baseline baseline-2026-10-16
```

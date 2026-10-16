# App Delivery Acceptance

应用交付验收与自动化测试 Skill。以冻结需求、代码版本、场景、真实执行证据和独立复审形成可回溯的验收结果，并提供只读结果与覆盖率视图。

## 当前基线

2026-10-16 首次纳入 Git 版本管理，保存当前使用版本。初始标签为 `baseline-2026-10-16`；该标签是版本快照，不表示本次重新完成了全部功能验收。

本次保留已有 Skill、脚本、测试、视图、参考文档及 Playbook 文件，包括现有 `.slc` 构建快照和 `.slc-verify` 校验文件。依赖目录、Python 缓存和本地环境配置不入库。

## 文件入口

- [SKILL.md](SKILL.md)：Skill 总入口与使用约束。
- [references/portable-workflow-v4.md](references/portable-workflow-v4.md)：当前自动化执行路径。
- [references/portable-workflow-v3.md](references/portable-workflow-v3.md)：v3 可移植路径与黑盒、人工操作场景。
- `playbook/`：流程、确定性门禁与执行编排。
- `scripts/`：存储、证据、覆盖率与查看服务。
- `assets/ledger-viewer/`：只读结果视图。
- `tests/`：现有测试与探针。

## 使用环境

使用 Python 3、Node.js，以及现有 `@sublang/playbook` 16 运行时和对应 Codex 适配环境。`playbook/v3/runtime-path.mjs` 支持通过 `PLAYBOOK_PACKAGE_ROOT` 指定运行时，也会查找本地或全局安装。外部运行时不包含在此仓库中；当前 `playbook/package.json` 未声明这些外部依赖，不能仅凭安装该目录的依赖还原完整运行环境。

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

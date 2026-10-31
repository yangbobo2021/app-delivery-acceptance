# App Delivery Acceptance

从真实需求生成场景、选择测试、实际执行并取得独立复审，保留失败、未执行范围和可追溯证据。

本仓库的 `main` 保存完整开发源码、规格和测试。
业务源码的唯一位置是 `skills/en/app-delivery-acceptance/playbooks/acceptance/`；Skill 负责交接意图，`acceptance-orchestrate` 负责业务调度。

## SPEX 安装

SPEX 安装内容由本仓库的明确源码提交构建到独立的 [安装仓库](https://github.com/yangbobo2021/app-delivery-acceptance-spex)。
不要将本开发仓库的根目录当作 SPEX 的发布包目录。
安装仓库的 README 提供包名、分支和目录信息；其来源记录应标明本仓库的提交与文件摘要。
通过同一次 SPEX 安装可获得真实 `app-delivery-acceptance` Skill 和 31 个原生 Playbook。

安装后，在 SPEX 中启用 `acceptance-orchestrate` 及任务所需子规程，为各角色绑定实际 Agent/模型和独立 Player。
在同一个项目中新开 Codex 回合，使用 `$app-delivery-acceptance`；无需手工拷贝 Skill 文件。
Codex 需要自己的可用登录和网络；Skill 首次使用自动准备独立运行缓存，之后核对并复用，不在 SPEX 管理的导出目录写入依赖。
同名用户自有 Skill 目录保持原样，安装发生冲突时应查看 SPEX 的未导出提示。

## 开发与回归

开发需要 Node.js >=22、npm 和 Git；实际 Agent 测试另需自己的登录与模型配置。

```sh
git clone https://github.com/yangbobo2021/app-delivery-acceptance.git
cd app-delivery-acceptance
node skills/en/app-delivery-acceptance/playbooks/acceptance/runtime/dependencies.mjs
node tests/run-checks.mjs --output /absolute/new-check-directory
```

确定性回归与真实模型验收分别记录。
四种实际运行形态是 Mac SPEX、原生 Windows SPEX、Mac Codex Skill、原生 Windows Codex Skill；任何一项仅导出文件或重放旧回执，都不算本轮业务执行通过。
单场景验收从需求生成场景，只选择一个场景执行并取得独立复审；不代表全产品或所有 Agent 均通过。

源码目录：

```text
skills/en/app-delivery-acceptance/    Skill、独立 Playbook 源码和锁定依赖
specs/                              规格及设计决策
tests/                              回归、协议和集成测试
docs/                               用户资料和历史基准
reviews/                            有明确范围的历史审阅记录
scripts/                            从指定源码提交构建分发内容
```

构建分发内容：

```sh
node scripts/build-distribution.mjs --output /absolute/new-release-directory
```

该命令生成一个新目录及源码来源记录，不推送 Git、不发布注册表、不修改源码仓库。
分发内容不包含发布者的登录、node_modules 或本机执行证据。

## 业务入口与证据

宿主只向 `/acceptance-orchestrate` 传递用户目标、原始上下文、实际项目位置及停止点，由总调度选择和调用子工作流。
目录隔离、角色权限、签名租约、排他归属、不可覆盖输入、冻结哈希和独立复审要求保持不变。
Prompt 约束和文件检查不等于操作系统沙箱。

详见 [Skill](skills/en/app-delivery-acceptance/SKILL.md)、[委托合同](skills/en/app-delivery-acceptance/playbooks/acceptance/docs/orchestration-workflow.md)、[运行说明](skills/en/app-delivery-acceptance/playbooks/acceptance/docs/agent-runtime.md)、[规格地图](specs/map.md)。

历史示例及其固定版本、抽样范围见 [benchmark](docs/benchmark.md)；它们不替代当前版本的实际验收。

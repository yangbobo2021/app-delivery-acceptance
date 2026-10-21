# App Delivery Acceptance

让 Codex 或 Claude Code 按明确需求完成交付验收：采用或生成测试场景、运行真实测试、独立复审结果，并在 Web 看板中查看需求、场景、证据与覆盖率。

适合已有项目的功能验收、提交或 PR 的行为验证，以及需求变更后的受影响场景复验。没有 SPEC 也可以从你明确描述的需求开始。最终结论可以是通过、产品 BUG、测试需要修补或证据不足；不会把“测试命令成功”直接当成验收通过。

## 先准备什么

| 你需要准备 | Skill 和 Agent 会完成 |
| --- | --- |
| macOS 或 Linux；Python 3、Git、Node.js >=22 与 npm | 首次把锁定的 npm 依赖安装到 Skill 自己的目录，之后校验并复用 |
| Codex 或 Claude Code 已配置可用的模型与认证 | 使用所选 Agent 的模型服务，实现和独立复审分开会话 |
| 项目位置、一条明确需求，或需要验收的提交/PR | 理解项目约定、冻结定义、准备项目测试环境、执行测试并展示结果 |

首次需要访问 npm 包源，安装的 Skill 目录需要可写。项目自己的浏览器、数据库、语言工具链等依赖由 Agent 检查；基础 Node/Python/Git 不会自动安装。原生 Windows 暂不支持。完整验收会多次调用模型并执行项目测试，耗时和模型用量随场景、环境准备和修补轮次变化。

## 安装

推荐安装固定 Git 标签 **[v0.1](https://github.com/yangbobo2021/app-delivery-acceptance/tree/v0.1)**。以下二选一；不需要先安装 SPEX，也不需要把 Skill 装进被测项目。

**Codex**

```sh
npx skills@1.7.4 add 'https://github.com/yangbobo2021/app-delivery-acceptance.git#v0.1' --skill app-delivery-acceptance -g -a codex --copy -y
```

**Claude Code**

```sh
npx skills@1.7.4 add 'https://github.com/yangbobo2021/app-delivery-acceptance.git#v0.1' --skill app-delivery-acceptance -g -a claude-code --copy -y
```

`-g` 表示当前用户全局安装；`--copy` 复制 Skill 文件。实际安装目录以 CLI 输出为准。模型认证使用你电脑现有的 Agent 配置，不随 Skill 分发。已有 SPEX 的用户也可以使用下方的 [SPEX 安装信息](#通过-spex-安装)。

## 第一次使用

安装后，在被测项目中打开 Codex 或 Claude Code 的新对话，输入：

```text
使用 app-delivery-acceptance Skill，对当前项目做一次小范围交付验收。
从项目现有、已确认的需求中选一条，先说明选择的需求和验收范围。
采用已有场景，并为覆盖缺口补充场景，执行这条需求的全部验收场景。
打开结果 Web 看板，检查执行结果、独立复审、需求与场景引用，以及覆盖率状态。
保留执行证据和历史结论。发现产品 BUG 时先报告；本次不修产品代码、不回填 SPEC。
```

如果没有需求记录，把第二行替换为你的完整需求，例如“本次验收需求是：……”；预期行为由你提供，不能只让 Agent 从代码现状猜测。当前项目不明确时，一并给出项目路径。

普通使用者不需要手工编写工作流 JSON 或逐个运行内部脚本。Agent 会读取 [SKILL.md](skills/en/app-delivery-acceptance/SKILL.md) 并完成准备；遇到业务歧义或只能由你提供的资源时，会提出具体问题。

## 你会看到什么

Web 看板将同一项验收的 **需求/规则 → 场景 → 用例/操作 → 实际执行 → 独立结论** 串起来，并提供：

- 当前进度、完整场景分母、已执行数与各类确认结论。
- 执行日志、冻结截图与 UI 审查结果。
- 覆盖率工具、实际版本，以及可计算范围内的行/分支覆盖率；缺证据时明确显示不可计算或不完整。
- 定义变更后的需复验提示，同时保留旧定义、旧执行和旧结论。

例如，一次 v0.1 受控回归得到 3 条需求、7 个当前场景全部执行并通过；行覆盖率 39/43、分支 9/12。这是该样例的结果，不能代替你项目的验收结论，详见 [验证范围与已知限制](skills/en/app-delivery-acceptance/references/benchmark.md#已有哪些验证记录)。

数据保存在被测项目的 `.acceptance/` 和 `.acceptance-local/` 中，正式测试放在项目测试目录。`.acceptance-local/` 应忽略提交；详情见 [资料目录说明](skills/en/app-delivery-acceptance/references/project-acceptance-store.md#三类产物与目录)。需求或场景发生变化时，在同一验收中告诉 Agent 变更来源和本次执行意图；仅做设计、修改已执行场景、完成需求变更验收的执行范围不同。

## 用公开测试集试一遍

配套测试集是 **[app-delivery-acceptance-benchmark-six](https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six)**：六个独立小项目，覆盖 Python CLI、Go API、TypeScript Web、Electron、Java 批处理和 Rust TUI。

测试集有固定基线、书面需求、公开评测规则和单独的结果分支，包含用于检验缺陷发现能力的预置缺陷。正确报告产品 BUG 也是有效验收结果。推荐从 Python CLI 的一条需求开始。

查看 **[测试集说明、固定版本、开始方法和历史结果](skills/en/app-delivery-acceptance/references/benchmark.md)**。这是小型合成基准，公开历史结果为抽样验证；不是所有项目或所有生成场景的全量通过声明。

## 遇到问题

| 情况 | 可以先怎么做 |
| --- | --- |
| 安装后 Agent 没找到 Skill | 核对安装器选择的 Agent 和输出目录，再开启新对话并明确指定 `app-delivery-acceptance` |
| Node/Python/Git 缺失、npm 下载失败 | 让 Agent 报告缺失工具或安装错误；配置好基础环境/网络后重试，保留失败记录 |
| 模型认证或服务不可用 | 检查当前 Agent 自己能否调用所选模型；让 Agent 执行 [模型预检](skills/en/app-delivery-acceptance/references/agent-runtime.md#预检与依赖) |
| 中断后想继续 | 明确要求继续当前项目的同一项验收；由 Agent 核对当前 ID、进程和冻结记录后恢复 |
| 想重新打开结果 | 让 Agent 打开该项目的历史验收看板；不必重新执行测试 |
| 有通过结论但仍提示需复验 | 旧结论保留原含义；当前需求、场景或产品版本可能已经变化 |

## 通过 SPEX 安装

在 SPEX 的 **Add from Git** 中填写：

- Git source：`https://github.com/yangbobo2021/app-delivery-acceptance.git`
- Revision：`v0.1`，或你明确选择的完整提交；package subdirectory 留空。
- Skill：`app-delivery-acceptance`，由 SPEX 导出到选中的 Agent。

SPEX 包内版本为 `0.1.0-github.3`（prerelease），Git 标签为 `v0.1`，两者是不同的版本标识。测试结果应记录实际安装提交。SPEX 再次导出可能替换生成依赖，下次调用会重新准备。

## 进一步阅读

- [环境准备与维护说明](skills/en/app-delivery-acceptance/README.md)
- [Agent 执行入口](skills/en/app-delivery-acceptance/SKILL.md)
- [当前自动化流程 v4](skills/en/app-delivery-acceptance/references/portable-workflow-v4.md)
- [冻结定义、变更和可选回填](skills/en/app-delivery-acceptance/references/frozen-definitions.md)
- [公开测试集与验证记录](skills/en/app-delivery-acceptance/references/benchmark.md)

规范 Skill 源码仅维护在 `skills/en/app-delivery-acceptance/`；项目验收数据、认证和已安装依赖不随包分发。当前仓库尚未附许可证文件。

# 测试集与验证记录

## 公开六项目测试集

正式测试集为 [yangbobo2021/app-delivery-acceptance-benchmark-six](https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six)。早期四项目仓库已由这套六项目基线扩展；复现当前基准请使用下述固定版本。

- 基线标签：[`baseline/2026-10-20-v1`](https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six/tree/baseline/2026-10-20-v1)。
- 基线提交：[`be952659c7d93018e26793daf2e58fa8321601f4`](https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six/commit/be952659c7d93018e26793daf2e58fa8321601f4)。
- [基线 README](https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six/blob/be952659c7d93018e26793daf2e58fa8321601f4/README.md) 与 [公开评测规则](https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six/blob/be952659c7d93018e26793daf2e58fa8321601f4/docs/benchmark-protocol.md)。

每个项目有 6 条书面需求，共 36 条；图形和终端项目还适用评测规则中的共享可读性、可操作性要求。产品源码不构成新增的行为要求。

| 项目 | 主要操作与观察入口 | 基础运行时 | 原始需求 |
| --- | --- | --- | --- |
| Python CLI | CSV 金额汇总；观察退出码、stdout/stderr、输入文件 | Python 3.10+ | [INV](https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six/blob/be952659c7d93018e26793daf2e58fa8321601f4/projects/python-cli/docs/requirements.md) |
| Go API | 库存预留；真实 HTTP 请求与持久状态 | Go 1.23+ | [STOCK](https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six/blob/be952659c7d93018e26793daf2e58fa8321601f4/projects/go-api/docs/requirements.md) |
| TypeScript Web | 待办事项；真实浏览器与 localStorage | Node/npm、浏览器 | [TODO](https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six/blob/be952659c7d93018e26793daf2e58fa8321601f4/projects/ts-web/docs/requirements.md) |
| Electron Desktop | 本地笔记；桌面窗口、IPC、用户数据文件 | Node/npm、Electron 运行环境 | [NOTE](https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six/blob/be952659c7d93018e26793daf2e58fa8321601f4/projects/electron-desktop/docs/requirements.md) |
| Java Batch | 事件 CSV 转账号汇总；真实批处理进程与文件 | JDK 17+ | [BATCH](https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six/blob/be952659c7d93018e26793daf2e58fa8321601f4/projects/java-batch/docs/requirements.md) |
| Rust TUI | 清单导航与切换；真实终端、输入及状态文件 | Rust 1.85+、终端 | [TUI](https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six/blob/be952659c7d93018e26793daf2e58fa8321601f4/projects/rust-tui/docs/requirements.md) |

它们是刻意保持小型、含预置缺陷的合成应用。正确发现并独立确认产品 BUG 是有效结果；不应为了得到“全通过”修改基线源码。它们不能代表任意生产项目的复杂度或证明不存在其他缺陷。

## 第一次复现

安装 Skill 后，另建测试集检出目录，以固定标签建立本次结果分支：

```sh
git clone --branch baseline/2026-10-20-v1 --single-branch https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six.git acceptance-benchmark
cd acceptance-benchmark
git switch -c acceptance-run
git rev-parse HEAD
```

此时 HEAD 应为上面的完整基线提交。在 `projects/python-cli` 打开所选 Agent 的对话，输入：

```text
使用 app-delivery-acceptance Skill 验收当前 Python CLI 项目。
按项目 docs/requirements.md 中 INV-02 的完整正文冻结需求，记录测试集基线提交和实际 Skill 版本。
采用适用的已有场景，为缺口生成场景，并完成 INV-02 对应全部场景的真实 CLI 执行和独立复审。
打开 Web 看板，检查定义、引用、执行结论和覆盖率状态，保留首次失败与历史记录。
本轮不修产品代码，不回填需求或场景；不要读取其他评测分支的答案或历史结果来构造本轮测试。
```

选单条需求的结果只能说明该范围，不能宣称完成整个 Python 项目或整个六项目测试集。后续扩展到其他需求/项目时沿用其 README 中的真实运行入口；UI 场景保留实际显示尺寸与可直接观察的视觉证据。

## 基线、结果和评测答案的关系

- **基线标签**保存被测应用、书面需求和公共评测规则。
- **结果分支**保存某次验收生成的场景、执行/复审、覆盖率和归档；必须记录基线提交、Skill 提交与实际执行范围。
- **人工评测答案**用于执行完成后的评估，不是提供给生成/执行 Agent 的业务输入。评测分支及答案公开可见，不能因此宣称严格盲测。

进行新的缺陷发现评测时，先完成执行再读历史结果或人工答案。只想查看已有展示和证据时，可以直接打开下面的历史报告。

## 已有哪些验证记录

### 公开六项目抽样结果

[v1 run 1 报告与证据入口](https://github.com/yangbobo2021/app-delivery-acceptance-benchmark-six/blob/d84f3147ba9a45ddfbb16cbd3adca356a72ae30c/runs/2026-10-20-r1/README.md)固定在结果提交 `d84f3147ba9a45ddfbb16cbd3adca356a72ae30c`。

- 被测基线：`be952659c7d93018e26793daf2e58fa8321601f4`。
- 当次 Skill：`c6ef9511347d07b4ff2aaf254754157b09b3f2a4`，早于合并后的 `v0.1`。
- 生成 159 个场景，抽样执行 14 个，145 个未执行；6 个所选正常对照通过，8 个所选已知缺陷触发被识别并独立判为产品 BUG。
- Electron 的累积覆盖率保留 `incomplete`，部分语言/工具不提供同样的行或分支指标，不能合成跨语言总百分比。
- 报告保留场景修订、环境/适配修正和首次失败记录；它不是六项目全量验收通过，也不是 v0.1 的全量复测成绩。

### v0.1 合并后受控回归摘要

维护者另在本机 Codex / gpt-6.1-sol 上验证了固定 Skill 提交 `013c08ddd1b99f4eb4a89a26323da675e07f2aa4`：

- 12 组定向测试共 109 项通过；受控网页/API 项目完成 9 组场景流程、10 次正式执行，7 个当前场景独立判为通过。
- 实际检查需求变更后的增量场景、单场景变更、独立需求新增的影响隔离、可选回填、纯引用绑定不重跑、UI 冻结图片及旧记录保留。
- 在不含本机执行目录的独立克隆中检查了结论、适用性、截图和覆盖率；行 39/43、分支 9/12 来自该受控项目的 Coverage.py，不能当作 Skill 自身的源码覆盖率。
- 首个过度约束用例被独立审查发现并修补；首次归档 smoke 曾超时，同命令和完整归档重试通过。首次失败仍保留。

这是维护者验证摘要，原始本机证据未随 Skill 包公开发布；不是可直接下载的另一套公共测试集。本轮未重新执行 Claude Code/Docker 矩阵，也未重跑无 SPEC 项目的 SPEX 初始化分支。

### Skill 自身的测试

Skill 的当前实现回归统一位于 `tests/`，验证定义生命周期、门禁、恢复、运行环境、覆盖率与证据处理。它们与上面的六个被测应用承担不同职责，不能用它们的通过数替代真实应用验收。

# Playbook 总调度：实现与真实验证

宿主 Skill 的唯一业务入口改为 `/acceptance-orchestrate`。宿主转交用户原话、来源、项目、授权、选择与停止点；独立总调度角色通过官方 `callPlaybook` 选择子入口、准备输入、检查实际结果并继续任务。原子入口继续供人工和 CI 使用。

实现位于 `skills/en/app-delivery-acceptance/playbooks/acceptance/workflows/orchestrate/`：`registry.mjs` 是公开原生会话运行时，`task.mjs` 保存委托和实际子调用，`orchestrator.md` 定义角色职责。没有新增宿主业务脚本、私有子流程启动器或第二套 Agent 调用机制。动态入口和角色继续由现有 configure 发现。

任务状态位于被测项目的 `.acceptance-local/orchestration/<task_id>/`，独立于 AT 的创建。每条消息保留原始输入和结果；后续消息可沿用同任务改变执行范围；相同已完成消息返回已有结果。活跃、未知或中断子效果保留，不删锁盲目重跑。生成的采用命令保留原 JSON 字节及来源，不将其重新组织成丢失出处的输入。

## 真实验收

在 macOS 使用 Codex、`gpt-6-sol`、`high`，对配套测试仓库修订 `be952659c7d93018e26793daf2e58fa8321601f4` 的 Python CLI 项目发起两条消息。外层两次 stdin 都只有 `/acceptance-orchestrate JSON`；没有宿主直接子调用。

| 用户目标 | 实际过程和结果 | CLI 墙钟时间 |
| --- | --- | --- |
| 从新验收开始，INV-03 生成并执行一个 P0 场景，不收集覆盖率，归档、报告、结束并开视图 | 15 次官方子调用，包含冻结 blocked 后由总调度修正并继续；最终一个场景独立复核 passed | 1170.740 秒（19 分 30.7 秒） |
| 同任务只重跑刚通过的永久用例，不重新分析／设计／生成 | start → execute → archive → report → finish → view；新执行独立复核 passed | 243.832 秒（4 分 3.8 秒） |

两个消息沿用 `AT-a76b9522b738584f`、`INV-03-S01` 和 `TC-1c174095-39fc-4fb8-ab1a-48cd2def2e78`。真实产品输入 CSV 为 `account,amount_cents\nA,2\nB,3\n`，输出 `{"totals":{"A":2,"B":3},"row_count":2}`，退出码 0，stderr 为空。输入、argv、stdout/stderr、执行日志均实际落盘并冻结哈希。用例实现、设计评估、执行结果复核的原生会话独立。

重跑生成新的正式执行目录，原有 56 个回执及首轮执行文件哈希不变。两次报告都显示候选 4、执行 1、通过 1、未执行 3；未判定整个需求／产品通过。结束移除匹配当前指针，真实视图和 API 返回 200。

19 项实证核对覆盖原生父子会话、实际模型、冻结来源、运行版本、覆盖率关闭、调试、独立评估、真实执行、原始附件、选择性归档、后续重跑、旧证据保留和停止边界：

```sh
node tests/orchestrated_goal.audit.mjs --evidence /absolute/orchestrator-20261030-01 --rerun
```

## 安装与接入验证

- 最终包 npm pack 后，独立解包目录不包含 `SKILL.md`；182 个包内实现／合同／资料文件与源文件逐字节一致。沿用已冷安装、锁文件未变的依赖，最终原生 CLI 验证全部通过：仅创建、相同消息不重放、同任务口述冻结后停止、缺少新需求时提问。9 项持久化／文件／调用合同验证也通过，共 13 项。
- 受控官方端口夹具验证暂停调用 snapshot → restore → callback，子调用计数为 1；这是协议验证，不是模型或产品通过证据。
- 原有迁移回归 5 项、命令泛化集成验证 7 项通过。Skill quick_validate、SPEX lint、Node 语法检查和 git diff --check 通过。
- 最终独立包 SHA-256：`a359def9cde0a4b0be3b0e5b8e0ad9e93805b0aff4f199ba74b99d2006cbfd55`。这是本地打包验收产物，不声明已对外发布。

## 实际问题与边界

首次开发启动缺少官方角色上下文，失败后修复；原始失败保留。首次完整流程中冻结输入失配由总调度内部修正，失败回执没有删除。首次完整流程还发生 2 次调度答复格式错误、24 次原生只读资料检查；随后在每轮提示重申结构化决策协议。最终源码的后续重跑中格式错误和原生工具调用均为 0，独立包的四条真实接入路径也已复验。没有再把完整首轮执行冒充为修改提示后的第二次全新完整流程。

首次总墙钟中原生子调用合计 465.688 秒，其余 705.052 秒包括调度规划、资料检查、格式纠正、衔接和最终 CLI 回复。不能把总调度迁移描述成加速；产品测试进程自身仅约 0.085 秒。

调度角色声明禁止写入、shell、网络权限，但 Codex 的原生权限映射仍可能提供只读命令；不能声称完全无工具沙箱。总调度协议要求只通过 inspect/call 完成资料检查和业务调用。

本次只实测 Codex 和一个 CLI 项目的一个 P0 场景及重跑，覆盖率明确关闭。没有进行三个 Agent 的全量复验、操作系统杀进程恢复或真实多模态委托测试；图片仅验证本地附件元信息与字节哈希交接。保留独立子入口不等于证明所有可能调度路径。

本机完整原始资料：`/Users/boboyang/Documents/Codex/2026-10-26/opencode-opencode-glm-5-3-flash/outputs/orchestrator-20261030-01/`。四步可读报告位于相邻 `relaxed-flow-20261029-01/public/orchestrator/report.html`，按目的、输入、输出、通过依据展开关联原始证据。可移植验证摘要保存在 [orchestrator-20261030.json](retained-validation-records/orchestrator-20261030.json)。仅提交迁移分支，不合并主干。

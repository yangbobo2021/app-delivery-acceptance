# 原生 Agent 质量与可移植性验证

这是显式运行的质量评测，不属于普通单元测试发现。它真实调用当前 Agent/模型，创建独立项目和验收资料，会花费时间及模型额度。语义质量必须阅读实际输入、源码和输出判断；`structurally_completed`、退出码、引用校验与 `checks_passed` 不能代替该判断。

先读 [PLAN.md](PLAN.md)、本轮 [REPORT.md](REPORT.md) 和 [FINDINGS.md](FINDINGS.md)。评判答案和受控产品变异留在调用方测试代码中，不进入模型项目。每轮使用全新的输出目录，保留首次失败。

运行前显式设置当前真实的 `ACCEPTANCE_AGENT`、`ACCEPTANCE_MODEL` 和适用的 `ACCEPTANCE_EFFORT`，按 SKILL 运行依赖准备及同模型 preflight。不要为测试改变当前模型、账户或服务。

| 入口 | 用途 |
| --- | --- |
| `run.py --output <新绝对目录> --only Q01 Q02 ...` | 原生需求分析、场景、运行准备和项目指南；具体输入见 JOBS |
| `continue.py --root <Q06或Q07根> --step coverage --attempt <新名称> [--prior-attempt <旧输出>]` | 宿主真实探针与覆盖率准备，保留失败适配器 |
| `continue.py --root <根> --step pipeline --attempt <新名称> [--coverage-config <配置>]` | 实际绑定、用例、评估、执行、冻结、独立复审及有限修补 |
| `probes.py --output <新绝对目录> --only E01 E02 E03 E04 B01` | 逐场景静态设计评估对照与跨文件逆向 |
| `review_probes.py --root <已完成off-original的Q06根> --repair` | 过度约束、浅层通过和入口故障；真实执行、门禁、原生复审和局部修补 |
| `ui_review.py --output <新绝对目录> --playwright-module <已安装的ESM模块>` | 真实 Chromium 正常、遮挡和缺图对照；不代表浏览器冷安装验证 |
| `conditional.py --output <新绝对目录> [--only edit independent-scenes manual]` | 人工内容保留、v3 独立场景审查及人工路径暂停 |
| `linux_environment.py` | 先查看 `--help`；隔离 Linux 冷安装及实际 preflight，后续以普通用户执行 |

已有 `tests/run_case_discovery_forward.py` 和 `tests/run_case_reuse_forward.py` 可用于查找模式边界、缺少测试的新增、已有测试补充及业务变异验证。发现“未执行”或“需人工资料”可以是正确结果，不能要求所有反例都返回通过。

普通 Python 回归分别执行 `tests/test_*.py` 和 `playbook/v4/test_*.py`，每个文件使用独立进程，避免同名测试/实现模块影响 discovery。Agent 配置适配单测为 `node --test tests/test_agent_runtime.mjs`。其他 `.mjs` 中有需要参数、专用准备环境或旧工作流的探针，不能统统当作无参 Node 单测执行。会重建依赖的安装回归应与原生工作流隔离运行。

容器只读使用调用方认证，不将其复制进项目、镜像或报告。结束后先保存经选择的输入、输出、代码、原生证据及哈希，排除运行安装物、缓存、凭据和业务数据库，再移除本轮自建容器。只有全部验收结束才清理对应 current 指针；阶段完成不等于验收结束。

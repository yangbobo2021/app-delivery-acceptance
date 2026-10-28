# execution-evidence: 真实执行、独立复审与有界修复

## 意图

使场景结论对应实际运行的测试、产品版本和可信证据，并保留失败及修复过程。

本包规定需求目标，不声明当前实现已经符合或通过验收。

## 外部行为

### execution-evidence-1

当用例 AGENT 进行本地调试时，调试入口应核对当前 AT [[acceptance-storage-2](acceptance-storage.md#acceptance-storage-2)]、冻结场景 [[definition-lifecycle-8](definition-lifecycle.md#definition-lifecycle-8)] 及已验证项目环境 [[project-preparation-5](project-preparation.md#project-preparation-5)]，保存实际命令与运行观察，不将实现者自报通过当作正式结论。

### execution-evidence-2

当宿主正式执行一个就绪场景时，执行应在冻结产品版本上运行已声明的真实测试命令，并保存开始与结束时间、命令及环境绑定、退出码、日志和执行前后测试文件哈希。

### execution-evidence-3

当执行只有启动意图而没有完整收据时，流程应保留执行结果未知的状态，并在确认进程及副作用前停止自动重跑，不仅凭意图文件判断已经执行或成功。

### execution-evidence-4

当交接独立复审时，宿主应冻结本次执行允许引用的证据清单、文件哈希及来源绑定，证据失配时阻止交接，不用其他尝试或变化后的文件替代。

### execution-evidence-5

当判定一个场景的执行结果时，与用例实现分离的只读 Reviewer 会话应依据冻结约定、实际测试和本次执行证据给出结论及理由：

| 结论 | 最低依据 |
| --- | --- |
| 通过 | 测试确实验证场景判据，真实运行与证据支持预期，适用的 UI 判据也已确认。 |
| 产品缺陷 | 失败执行及产品证据支持违约，或冻结截图直接证明 UI 缺陷。 |
| 测试需修复 | 能指出测试实现或证据的具体可修复缺口，不能只因命令成功就放行。 |
| 受阻或证据不足 | 运行条件不具备，或现有证据不足以判断产品是否符合约定。 |

### execution-evidence-6

当场景包含视觉可用性判据 [[scenario-design-7](scenario-design.md#scenario-design-7)] 时，正式执行应保存相应关键状态的真实截图及窗口或视口上下文，并将经哈希绑定的图像像素提供给独立 Reviewer，不只提供路径或 DOM 描述。

### execution-evidence-7

当视觉证据缺失、不可查看或未覆盖判据时，独立复审应标记 UI 未验证并阻止场景通过；业务命令退出成功不能覆盖该限制。

### execution-evidence-8

当复审发现属于测试代码或证据的明确缺口时，默认实现流程应在已声明的修复预算内追加差量修复、正式执行和独立复审尝试，保留原失败、输入与证据，不循环覆盖旧记录。

- 同时存在产品缺陷不取消测试缺口的有界修补；保留产品观察，修补授权仍仅限测试与证据。

### execution-evidence-9

当复审发现问题属于场景或业务合同而非测试实现时，流程应停在待明确的定义边界，不通过修改测试来绕过问题。

### execution-evidence-10

当采用仅使用已有用例的策略且 Reviewer 要求修复时，流程应保留实际结论并停在待处理状态，不暗中切换到修改测试的策略。

### execution-evidence-11

当测试清理、覆盖率采集收尾或必需的真实操作失败时，执行记录应保留失败及对判据和证据的影响，并由独立复审据此判断，不只记录主要断言的成功。

### execution-evidence-12

当测试或产品版本变化后继续验证时，流程应使用新的冻结尝试及实际版本，不改写旧收据、执行时间或独立结论来表示新版本已通过。

### execution-evidence-13

当开始允许自动测试修复的执行流程时，宿主应在配置中确定有限修复次数，并在预算耗尽时保存最新结论和剩余问题后停止自动修复。

### execution-evidence-14

当准备或执行发现冻结产品版本、组件版本或非授权文件发生变化时，宿主应阻止受影响交接并记录差异，不能继续把该次证据绑定到原冻结版本。

### execution-evidence-15

当用户明确只重跑指定永久用例时，执行应冻结所选 ID、精确命令及其选择依据，独立复审结论仅适用于这次所选范围，未选择的用例和完整场景不得因此被标为已重新验收。

## 验证

以下集成验证分别登记真实执行、修复和视觉判断；历史报告或验证条目存在均不代表整个需求包已经通过。

### execution-evidence-16

当验证 Node 正式执行入口时，集成测试应通过真实官方 CLI 和独立 Reviewer 核对指定永久用例的实际执行及结论范围 [[execution-evidence-15](#execution-evidence-15)]、命令和文件收据 [[execution-evidence-2](#execution-evidence-2)]、冻结证据交接 [[execution-evidence-4](#execution-evidence-4)]，以及从明确检查点继续而不重复已完成命令 [[execution-evidence-3](#execution-evidence-3)]。

### execution-evidence-17

当验证中断恢复时，集成测试应核对真实完成回执的采用、未知副作用不重跑 [[execution-evidence-3](#execution-evidence-3)] 和活进程组拒绝接管，并区分官方根会话身份与尚未证明的模型会话连续性 [acceptance_recovery.integration.mjs](../../tests/acceptance_recovery.integration.mjs) [migration_safety.integration.mjs](../../tests/migration_safety.integration.mjs)。

### execution-evidence-18

当验证视觉判断时，集成测试应实际操作桌面宽度浏览器、冻结前后截图并将像素交给独立 Reviewer [[execution-evidence-6](#execution-evidence-6)]，核对命令成功但真实界面违约仍不能通过 [[execution-evidence-7](#execution-evidence-7)]，并验证产品缺陷与测试缺口并存时仍有界修补 [[execution-evidence-8](#execution-evidence-8)] [acceptance_ui_execution.integration.mjs](../../tests/acceptance_ui_execution.integration.mjs)。

# workflow-package: 独立工作流包边界

## 意图

使 Skill 作为对话接入层，让用户无需 Skill 也可通过标准 Playbook CLI 完整调用独立交付工作流，依据 [DR-009](../decisions/009-skill-playbook-responsibility-boundary.md)。

## 外部行为

### workflow-package-1

当用户单独安装交付工作流包并提供显式项目资料及声明的运行前提时，每个公开入口应通过标准 Playbook CLI 完成其内部业务及停止边界，不读取 Skill 安装路径、脚本、文档或隐含对话，并随附自身脚本、合同、角色、提示、配置描述和锁定依赖；覆盖率准备可在自身目标内建立必要运行资料，其他缺少前序业务产物的入口不擅自执行前序业务 [DR-013](../decisions/013-outcome-owned-coverage-preparation.md)。

### workflow-package-2

当宿主通过 Skill 发起交付工作时，Skill 应只解释对话意图和授权、保留来源原文、向总调度工作流交接目标与上下文和解释结果，不直接调用子工作流，不将跨工作流调度及修改实现的安排混入领域约束，便利脚本仅可定位包或调用其依赖准备，而业务门禁、执行、证据及结论由工作流包完成。

### workflow-package-3

当配置或执行工作流角色时，包应使用同一份官方 player/role 配置和公开会话端口确定实际 Agent、模型、权限与会话，不依赖第二份环境角色映射或自定义 CLI 启动包装器，并将本地修订的官方运行时以可独立安装的固定构建分发并保留源码与版本依据，不声称已公开发布。

### workflow-package-5

当处理项目命令及阶段交接数据时，工作流包应根据实际执行与可解释的结果事实判断可用性，不因空字符串参数、普通花括号、项目文件名、启动包装形式或非语义的展示长度和条数拒绝合法工作，并记录实际解析的执行器及必要来源，不用参数形状猜测调用图 [DR-012](../decisions/012-project-command-generality.md)。

### workflow-package-6

给定用户授权的交付目标尚未完成，当子工作流暴露可修复的前提遗漏时，总调度工作流应依据真实诊断调用负责该前提的公开子工作流并接续原选定工作，保留失败历史与已有身份，不将子工作流的 blocked 自动当作整个任务终点，也不越过用户明确的停止点或实际未解决的输入、权限、资源与副作用边界 [DR-014](../decisions/014-host-owned-goal-continuation.md)，调度责任按 [DR-015](../decisions/015-playbook-owned-task-orchestration.md) 迁至总调度工作流。

### workflow-package-8

当接收用户任务委托或后续调整时，总调度工作流应通过独立官方角色依据完整原话、来源、当前状态和停止点动态选择检查、公开子调用或返回结果，不强制固定阶段序列 [DR-015](../decisions/015-playbook-owned-task-orchestration.md)。

### workflow-package-9

当调用或继续子工作流时，总调度工作流应通过官方嵌套会话保存任务／消息／子调用身份及原始结果，已完成消息重入不重放子效果，遇到活跃或未知效果时保留资料并要求核对原会话，所述跨阶段接续遵守 [[workflow-package-6](#workflow-package-6)]。

## 验证

### workflow-package-4

当系统测试在无 Skill 的新目录安装 npm 包并调用标准命令时，应验证全部公开入口的注册与必要输入边界、真实业务链路及停止点、包内路径闭合 [[workflow-package-1](#workflow-package-1)]，并检查 Skill 层无业务实现 [[workflow-package-2](#workflow-package-2)] 和角色配置、真实事件及本地运行时版本来源 [[workflow-package-3](#workflow-package-3)]。

- 通用输入集成验证通过实际命令及公开执行入口核对空参数、内联脚本、PATH、普通同名数据参数、模块入口及非语义描述差异不会误拒绝 [[workflow-package-5](#workflow-package-5)] [command_portability.integration.mjs](../../tests/command_portability.integration.mjs)。
- 正常路径验证须包括新请求的实际处理，不仅重放已完成回执；生命周期命令使用独立新夹具核对文件、指针及不执行产品测试的边界 [acceptance_lifecycle_cli.integration.mjs](../../tests/acceptance_lifecycle_cli.integration.mjs)。

### workflow-package-7

当验证跨工作流接续时，系统测试应只向总调度交接目标，通过其官方子调用观察真实阻塞后的诊断修正和任务继续，核对失败保留、同一验收身份、所选场景的实际执行及独立结果 [[workflow-package-6](#workflow-package-6)] [orchestrated_goal.audit.mjs](../../tests/orchestrated_goal.audit.mjs)。

### workflow-package-10

当系统测试验证总调度接入时，应仅向总调度入口交接真实用户任务，核对动态子调用、只创建／冻结等停止点、同任务后续调整、不重复执行及完整所选场景的真实结果和独立证据 [[workflow-package-8](#workflow-package-8)] [[workflow-package-9](#workflow-package-9)] [acceptance_orchestrate.integration.mjs](../../tests/acceptance_orchestrate.integration.mjs)。

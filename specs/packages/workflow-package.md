# workflow-package: 独立工作流包边界

## 意图

使 Skill 作为对话接入层，让用户无需 Skill 也可通过标准 Playbook CLI 完整调用独立交付工作流，依据 [DR-009](../decisions/009-skill-playbook-responsibility-boundary.md)。

## 外部行为

### workflow-package-1

当用户单独安装交付工作流包并提供显式项目资料及声明的运行前提时，每个公开入口应通过标准 Playbook CLI 完成其内部业务及停止边界，不读取 Skill 安装路径、脚本、文档或隐含对话，并随附自身脚本、合同、角色、提示、配置描述和锁定依赖；覆盖率准备可在自身目标内建立必要运行资料，其他缺少前序业务产物的入口不擅自执行前序业务 [DR-013](../decisions/013-outcome-owned-coverage-preparation.md)。

### workflow-package-2

当宿主通过 Skill 发起交付工作时，Skill 应只解释对话意图和授权、保留来源原文、选择或组合入口、按目标工作流筛选领域输入和解释结果，不将跨工作流调度及修改实现的安排混入领域约束，便利脚本仅可定位包或调用其依赖准备，而业务门禁、执行、证据及结论由工作流包完成。

### workflow-package-3

当配置或执行工作流角色时，包应使用同一份官方 player/role 配置和公开会话端口确定实际 Agent、模型、权限与会话，不依赖第二份环境角色映射或自定义 CLI 启动包装器，并将本地修订的官方运行时以可独立安装的固定构建分发并保留源码与版本依据，不声称已公开发布。

### workflow-package-5

当处理项目命令及阶段交接数据时，工作流包应根据实际执行与可解释的结果事实判断可用性，不因空字符串参数、普通花括号、项目文件名、启动包装形式或非语义的展示长度和条数拒绝合法工作，并记录实际解析的执行器及必要来源，不用参数形状猜测调用图 [DR-012](../decisions/012-project-command-generality.md)。

## 验证

### workflow-package-4

当系统测试在无 Skill 的新目录安装 npm 包并调用标准命令时，应验证全部公开入口的注册与必要输入边界、真实业务链路及停止点、包内路径闭合 [[workflow-package-1](#workflow-package-1)]，并检查 Skill 层无业务实现 [[workflow-package-2](#workflow-package-2)] 和角色配置、真实事件及本地运行时版本来源 [[workflow-package-3](#workflow-package-3)]。

- 通用输入集成验证通过实际命令及公开执行入口核对空参数、内联脚本、PATH、普通同名数据参数、模块入口及非语义描述差异不会误拒绝 [[workflow-package-5](#workflow-package-5)] [command_portability.integration.mjs](../../tests/command_portability.integration.mjs)。
- 正常路径验证须包括新请求的实际处理，不仅重放已完成回执；生命周期命令使用独立新夹具核对文件、指针及不执行产品测试的边界 [acceptance_lifecycle_cli.integration.mjs](../../tests/acceptance_lifecycle_cli.integration.mjs)。

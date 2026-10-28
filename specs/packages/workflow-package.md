# workflow-package: 独立工作流包边界

## 意图

使 Skill 作为对话接入层，让用户无需 Skill 也可通过标准 Playbook CLI 完整调用独立交付工作流，依据 [DR-009](../decisions/009-skill-playbook-responsibility-boundary.md)。

## 外部行为

### workflow-package-1

当用户单独安装交付工作流包并提供显式项目资料及声明的运行前提时，每个公开入口应通过标准 Playbook CLI 完成其内部业务及停止边界，不读取 Skill 安装路径、脚本、文档或隐含对话，并随附自身脚本、合同、角色、提示、配置描述和锁定依赖；缺少前序业务产物应明确阻塞，不擅自执行前序流程。

### workflow-package-2

当宿主通过 Skill 发起交付工作时，Skill 应只解释对话意图和授权、保留来源原文、选择或组合入口、交接显式输入和解释结果，便利脚本仅可定位包或调用其依赖准备，而业务门禁、执行、证据及结论由工作流包完成。

### workflow-package-3

当配置或执行工作流角色时，包应使用同一份官方 player/role 配置和公开会话端口确定实际 Agent、模型、权限与会话，不依赖第二份环境角色映射或自定义 CLI 启动包装器，并将本地修订的官方运行时以可独立安装的固定构建分发并保留源码与版本依据，不声称已公开发布。

## 验证

### workflow-package-4

当系统测试在无 Skill 的新目录安装 npm 包并调用标准命令时，应验证全部公开入口的注册与必要输入边界、真实业务链路及停止点、包内路径闭合 [[workflow-package-1](#workflow-package-1)]，并检查 Skill 层无业务实现 [[workflow-package-2](#workflow-package-2)] 和角色配置、真实事件及本地运行时版本来源 [[workflow-package-3](#workflow-package-3)]。

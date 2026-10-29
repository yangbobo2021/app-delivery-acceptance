# project-preparation: 可移植环境与运行准备

## 意图

让同一测试流程能使用不同项目的真实工具环境，并明确每次执行已验证的平台与能力边界。

本包规定需求目标，不声明当前实现已经符合或通过验收。

## 外部行为

### project-preparation-1

当启动模型工作流时，运行入口应支持 Codex、Claude Code 和 OpenCode，并使用调用者显式提供的 AGENT、实际模型及当前服务与认证配置，不依据安装目录猜测调用者，也不静默替换模型或服务。

- OpenCode 的实际模型使用 `provider/model` 标识；工作流继承其已解析的提供商配置与认证环境，不因工作目录改变而改用另一项目的模型服务。
- OpenCode 的实现任务与独立复审使用不同的原生会话；恢复绑定包含实际服务、模型配置、CLI 和 SDK 版本，图片复审直接传入冻结像素。
- OpenCode 的 JSON 阶段通过原生结构化输出按阶段声明的对象约束提交结果；宿主只采用当前请求关联的结构化对象，缺失或失败时保留原始事件并阻塞，不从说明文字中猜测结果 [DR-004](../decisions/004-opencode-structured-results.md)。

### project-preparation-2

当必需的模型或认证配置信息缺失、无法核对或与冻结配置不符时，运行入口应报告具体缺口并停止受影响的模型任务，不用默认值补造运行身份。

### project-preparation-3

当首次准备 SKILL 自身依赖时，准备入口应安装并核对仓库锁定的依赖，后续复用已验证安装，不要求被测项目或系统全局承担这些工具依赖。

- 并发复核可有界等待已确认活动的安装归属正常释放，不抢占未知、遗留或仍活动的声明。

### project-preparation-4

当为某次验收准备项目运行环境时，单独会话的运行准备 AGENT 应基于实际依赖清单、已有测试入口和可用项目知识提出准备方案，不以固定语言或框架模板代替项目检查。

- 输入包含冻结工作区、组件及源码范围和测试目录，避免在多项目仓库中为其他子项目准备环境。
- 项目尚无既有测试时，依据真实产品入口和依赖准备环境并执行非业务 smoke，不要求先生成用例或猜测测试框架。
- 主执行器使用绝对路径不代表其子工具可被找到，准备方案应按实际执行器和继承 PATH 配置必要的子工具寻址。
- 准备输入的源码 checkout 必须是实际 Git 工作树根；传入子目录时应在创建验收工作树前返回实际根和资料、测试目录的相对路径修正方式。已读取知识用明确的逻辑键交接，方案中的知识引用失配时列出实际允许的键，不将文件系统路径猜测为已读知识 [acceptance_runtime.integration.mjs](../../tests/acceptance_runtime.integration.mjs)。

### project-preparation-5

当运行环境被声明为可用时，准备记录应包含本次 AT、项目及组件版本、依赖与工具配置、操作系统和架构、实际执行器路径与版本，以及可重复的轻量验证命令及结果。

### project-preparation-6

当后续场景复用已准备环境时，宿主应核对冻结环境与当前执行器及工具配置相符，并为本场景隔离可变业务状态 [[acceptance-storage-14](acceptance-storage.md#acceptance-storage-14)]，不重复发现和安装仍有效的公共依赖。

- 项目准备声明并验证的 `execution_env` 随清单冻结，用于后续调试和正式项目命令；不注入模型服务。缓存及工具写入策略由项目环境声明，不能靠放宽产品源码写入门禁处理自动生成文件。

### project-preparation-7

当在另一台电脑或新的验收 ID 中使用项目知识时，准备流程应重新建立并核对本次环境，不把旧安装路径或通过收据当成新环境已验证的证据。

### project-preparation-8

当面对不同类型或语言的项目时，准备与用例入口应从项目数据选择命令、框架、依赖及工具，不在通用 SKILL 中耦合特定业务项目或语言白名单。

### project-preparation-9

当报告跨平台可用性时，测试 SKILL 应分别列明设计支持范围、实际运行的操作系统与环境及未实测平台，不把容器执行或换行格式检查称为对应系统的原生实测。

### project-preparation-10

当提炼可复用的准备方法时，宿主应仅将已执行核对的方法、适用条件和限制写入分层索引知识，不把本机安装物、私有路径或业务通过收据作为可移植的准备方法。

### project-preparation-11

当运行准备 AGENT 提交方案后，宿主应在实际目标环境执行其声明的轻量验证并检查记录与真实执行器一致，验证失败时不发布可供后续阶段使用的就绪环境。

### project-preparation-12

当冻结供场景复用的项目准备资料时，宿主应保存源码清单、组件修订、运行环境和启用的覆盖率配置，使后续场景能核对实际使用的同一版本与工具链。

### project-preparation-13

当开始准备 SKILL 运行依赖时，准备入口应检查 macOS/Linux、Git、Node.js 22及以上和 npm 等运行前提，对缺失项报告名称及受影响功能；新业务入口不要求 Python，项目工具自身所需的运行时仍须按实际项目另行准备。

### project-preparation-20

当声明支持测试父进程启动产品子进程的覆盖率采集时，准备阶段应验证同一嵌套拓扑及当前工具安装位置，不能以直接采集产品入口或父进程调用内部函数补命中代替子进程验证，并为未验证拓扑保留限制、在后续发现差异时另建准备和用例尝试。

## 验证

以下分别登记模型适配、运行准备、依赖及配置的验证；不代表所有项目、平台及角色组合已完成交付验收。

### project-preparation-14

当验证 OpenCode 运行适配时，集成测试应使用真实 OpenCode CLI 与调用者配置的模型完成预检、工具执行、原会话恢复、独立复审和冻结图片传入，并核对使用了调用者的模型服务与配置 [[project-preparation-1](#project-preparation-1)]，同时通过实际拒绝写入和取消会话核对角色能力边界与结束状态。


- JSON 阶段核对原生结构化提交与宿主采用的对象一致，原始说明文字不替代结构化结果，缺失提交必须失败；原会话的固定协议标记补正须保持其余 JSON 值及原会话身份不变，且不调用非提交工具 [[project-preparation-1](#project-preparation-1)]。

### project-preparation-15

当验证独立运行准备入口时，集成测试应通过真实官方 CLI 的独立准备角色核对项目数据选型 [[project-preparation-4](#project-preparation-4)]、宿主实际安装和非业务 smoke [[project-preparation-11](#project-preparation-11)]、执行器及原始收据 [[project-preparation-5](#project-preparation-5)]、相同环境不重复安装 [[project-preparation-6](#project-preparation-6)] 和新 AT 独立核验 [[project-preparation-7](#project-preparation-7)]。

- 所选 Agent 的原生运行方案提交应核对完整字段、真实知识逻辑键及命令参数合同，格式符合后仍须通过实际安装和轻量验证 [acceptance_runtime.integration.mjs](../../tests/acceptance_runtime.integration.mjs)。

### project-preparation-16

当验证官方命令和角色端口时，集成测试应通过真实角色调用核对显式 Agent、模型与服务 [[project-preparation-1](#project-preparation-1)]、同会话继续及绑定变化拒绝 [[project-preparation-2](#project-preparation-2)]，并分别保存实际工具操作、原生 JSON 回执和冻结图像交接的适用配置及未验证组合 [[project-preparation-9](#project-preparation-9)]。

### project-preparation-17

当验证 Node 依赖准备入口时，集成测试应核对锁定的本地安装、重复复核、损坏后修复及失败不发布就绪 [[project-preparation-3](#project-preparation-3)]，并核对外部符号链接和活跃安装声明被拒绝，控制进程夹具与真实包安装证据应分别标明。

### project-preparation-18

当验证完整工作流配置时，集成测试应通过实际注册模块生成不含凭据的临时配置并用官方 CLI 加载，核对显式模型及差异角色绑定 [[project-preparation-1](#project-preparation-1)]、缺失身份被拒绝 [[project-preparation-2](#project-preparation-2)] 和旧配置不被覆盖 [workflow_config.integration.mjs](../../tests/workflow_config.integration.mjs)。

- 真实模型测试采用调用者明确选择的模型及 effort；模型无关的夹具隔离其模拟身份，不继承另一 Agent 的专属配置。

### project-preparation-19

当验证已验证方法的知识提炼时，集成测试应核对真实轻量验证依据、可移植适用条件及限制，并拒绝将本机路径或业务收据当作共享方法 [[project-preparation-10](#project-preparation-10)] [acceptance_knowledge.integration.mjs](../../tests/acceptance_knowledge.integration.mjs)。


### project-preparation-21

当验证子进程覆盖率准备时，集成测试应通过真实官方 CLI 核对父进程不调用产品、子进程产生原生命中及工具实际安装方式 [[project-preparation-20](#project-preparation-20)] [coverage_cli_readiness.integration.mjs](../../tests/coverage_cli_readiness.integration.mjs)。

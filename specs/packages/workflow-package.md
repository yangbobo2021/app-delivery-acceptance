# workflow-package: 独立工作流包边界

## 意图

使 Skill 作为对话接入层，让用户无需 Skill 也可通过标准 Playbook CLI 完整调用独立交付工作流，依据 [DR-009](../decisions/009-skill-playbook-responsibility-boundary.md)。

## 外部行为

### workflow-package-1

当用户单独安装交付工作流包并提供显式项目资料及声明的运行前提时，每个公开入口应通过标准 Playbook CLI 完成其内部业务及停止边界，不读取 Skill 安装路径、脚本、文档或隐含对话，并随附自身脚本、合同、角色、提示、配置描述和锁定依赖；覆盖率准备可在自身目标内建立必要运行资料，其他缺少前序业务产物的入口不擅自执行前序业务 [DR-013](../decisions/013-outcome-owned-coverage-preparation.md)。

### workflow-package-2

当宿主通过 Skill 发起交付工作时，Skill 应只解释对话意图和授权、保留来源原文、向总调度工作流交接目标与上下文和解释结果，不直接调用子工作流，不将跨工作流调度及修改实现的安排混入领域约束，便利脚本仅可定位包或调用其依赖准备，而业务门禁、执行、证据及结论由工作流包完成。

### workflow-package-3

当配置或执行工作流角色时，包应使用宿主的官方 player/role 配置和公开会话端口执行，不依赖第二份环境角色映射或必需的自定义启动包装器；标准宿主不暴露的 Agent、模型、SDK 或原生事件应明确记为未知，不成为执行前提，CLI 本地修订版的额外能力仍保留固定版本和源码依据且不声称已公开发布 [DR-017](../decisions/017-standard-host-player-port.md)。

### workflow-package-14

当通过标准角色端口执行任务时，工作流应以完整当前 Prompt 明确工作目录、权限约定、图片读取和结果合同，对只读任务核对执行前后项目文件，并保留越界或未知失败的原始效果而不自动撤销或重放；角色使用独立 Player，宿主会话续接不得冒充提供商新会话 [DR-017](../decisions/017-standard-host-player-port.md)。

### workflow-package-15

当构建 SPEX 产物时，包应生成可被现有 SPEX 接受的 format-2 原生 Playbook 入口、完整子入口选择闭包和所需非引擎资源，使用户可通过 UI 安装、启用并绑定 Agent，不需要 npm 安装、源码绝对路径或手工 overlay；业务调度仍由原总入口持有 [DR-017](../decisions/017-standard-host-player-port.md)。

### workflow-package-17

当用户通过 SPEX 安装联合分发包时，包应同时提供保留完整 CLI 资源的真实 Skill 和原生 Playbook 选择闭包，使对应项目中的 Codex 能使用 SPEX 导出的 Skill、SPEX 能调用原生入口，Skill 的准备命令核对安装清单并返回独立内容缓存中的实际 CLI 包路径，避免在受管导出目录安装依赖或混淆已有全局 Skill 的来源 [DR-019](../decisions/019-unified-spex-installation.md)。

### workflow-package-5

当处理项目命令及阶段交接数据时，工作流包应根据实际执行与可解释的结果事实判断可用性，不因空字符串参数、普通花括号、项目文件名、启动包装形式或非语义的展示长度和条数拒绝合法工作，并记录实际解析的执行器及必要来源，不用参数形状猜测调用图 [DR-012](../decisions/012-project-command-generality.md)。

### workflow-package-6

给定用户授权的交付目标尚未完成，当子工作流暴露可修复的前提遗漏时，总调度工作流应依据真实诊断调用负责该前提的公开子工作流并接续原选定工作，保留失败历史与已有身份，不将子工作流的 blocked 自动当作整个任务终点，也不越过用户明确的停止点或实际未解决的输入、权限、资源与副作用边界 [DR-014](../decisions/014-host-owned-goal-continuation.md)，调度责任按 [DR-015](../decisions/015-playbook-owned-task-orchestration.md) 迁至总调度工作流。

### workflow-package-8

当接收用户任务委托或后续调整时，总调度工作流应通过独立官方角色依据完整原话、来源、当前状态和停止点动态选择检查、公开子调用或返回结果，不强制固定阶段序列 [DR-015](../decisions/015-playbook-owned-task-orchestration.md)。

### workflow-package-9

当调用或继续子工作流时，总调度工作流应以简短结论作为宿主状态说明，并通过完整结构化输出及不可覆盖回执保存任务／消息／子调用身份及原始结果，已完成消息重入不重放子效果，遇到活跃或未知效果时保留资料并要求核对原会话，所述跨阶段接续遵守 [[workflow-package-6](#workflow-package-6)]。

### workflow-package-11

当目标子工作流公开只读输入预检时，总调度应在官方子调用前使用其与正式入口共用的校验，保留并交回结构化问题而不产生子业务效果，正式入口仍重新校验当前身份、版本与来源，且不得为通过校验而补造业务事实 [DR-016](../decisions/016-input-preflight-and-design-readiness.md)。

### workflow-package-12

当场景设计产物尚未满足本次委托时，总调度应依据实际义务覆盖及缺口判断后续工作，将可纠正的设计判断附带原始产物绑定交回设计角色，不以成功状态或自行替写场景冒充设计角色完成，并保留用户停止点 [DR-016](../decisions/016-input-preflight-and-design-readiness.md)。

### workflow-package-19

当工作流运行在 Electron 宿主中时，工作流应仅对自身的 Node 子脚本、角色子进程及确定性工具命令指定 Node 模式，保留工具授权与真实执行回执，不改变父宿主或其他项目命令的环境，普通 Node 入口保持原行为 [DR-020](../decisions/020-electron-node-subprocesses.md)。

### workflow-package-21

当工作流或配置生成入口动态载入本地注册模块时，入口应将原生绝对路径转换为标准文件 URL 后导入，使 Windows 盘符不被解释成模块协议，并保留既有模块选择与导入失败证据 [DR-021](../decisions/021-native-windows-workflow-portability.md)。

### workflow-package-22

当只读角色需要比较项目文件投影时，工作流应在不阻塞宿主事件循环的后台线程执行同一完整投影并等到线程退出后采用结果，取消或线程失败时拒绝部分投影且不启动后续角色 [DR-021](../decisions/021-native-windows-workflow-portability.md)。

### workflow-package-24

当校验子进程未能启动时，执行回执应保存实际启动错误和未观测的空值，不以冻结身份序列化异常掩盖启动原因，也不把缺失输出解释为成功 [DR-021](../decisions/021-native-windows-workflow-portability.md)。

### workflow-package-26

当项目指南角色在返回结构化答案前失败时，工作流应先保留并传播原始角色错误，再停止该尝试，不把空回复改写为 JSON 解析错误，也不重放不确定操作 [DR-022](../decisions/022-native-role-error-preservation.md)。

### workflow-package-28

当已暂停子流程回调后继续总调度发生预算耗尽或原生角色失败时，总入口应保存原始错误与已完成子回执并以 blocked 收尾，只释放匹配的自身任务归属，保留仍未确认的子效果且不自动重放 [DR-023](../decisions/023-continuation-failure-settlement.md)。

### workflow-package-30

当从源码仓库构建联合安装内容时，构建入口应仅接受完整的已提交源码版本并写入一个新目录及可核对的仓库、提交和源码摘要，不包含本机凭据或执行证据，不隐含推送或发布 [DR-025](../decisions/025-source-and-distribution-repositories.md)。

### workflow-package-32

当 Mac 或原生 Windows 的 Codex 首次准备 Skill 时，准备入口应核对并复用兼容的运行时及独立缓存，缺少时仅在用户缓存准备固定且经摘要验证的运行时及锁定依赖，返回正式配置和官方 CLI 所需的实际路径，保持受管 Skill、全局环境、角色权限和业务证据边界不变 [DR-026](../decisions/026-portable-skill-runtime-preparation.md)。

## 验证

### workflow-package-31

当验证源码分发时，集成测试应从干净的实际 Git 提交构建并核对来源和产物摘要，拒绝未提交输入及重复输出，并证明开发文件保留于源码且不进入安装内容 [[workflow-package-30](#workflow-package-30)] [distribution_source.integration.mjs](../../tests/distribution_source.integration.mjs)。

### workflow-package-33

当验证 Skill 准备时，集成测试应通过本机实际准备入口核对缓存复用、摘要不符拒绝及托管源码保持不变，并为 Mac 和原生 Windows 分别保留完整业务调用的直接证据 [[workflow-package-32](#workflow-package-32)] [portable_setup.integration.mjs](../../tests/portable_setup.integration.mjs)。

### workflow-package-16

当集成测试使用无 Agent 扩展元数据的标准会话、真实本地文件和受控官方端口结果时，应核对角色执行与原始回执、只读越界检查和未知失败不重放 [[workflow-package-3](#workflow-package-3)] [[workflow-package-14](#workflow-package-14)]，并在脱离源码依赖树的目录构建产物、仅提供宿主引擎连接后加载全部原生入口与动态子入口，核对闭包和无需 npm 的边界 [[workflow-package-15](#workflow-package-15)]；真实 SPEX UI 与 Codex CLI 角色执行须另保存实际模型和业务结果 [standard_player_port.integration.mjs](../../tests/standard_player_port.integration.mjs) [spex_package.integration.mjs](../../tests/spex_package.integration.mjs)。

### workflow-package-18

当验证联合安装时，集成测试应核对真实 Skill、原生入口及选择闭包，并核对代码缓存匹配、篡改拒绝和导出目录保持不变 [[workflow-package-17](#workflow-package-17)]，另以一次真实 SPEX UI 安装和新 Codex 调用核对 Skill 发现路径、实际运行及重导出后的可用性 [spex_package.integration.mjs](../../tests/spex_package.integration.mjs) [spex_skill_cache.integration.mjs](../../tests/spex_skill_cache.integration.mjs)。

### workflow-package-4

当系统测试在无 Skill 的新目录安装 npm 包并调用标准命令时，应验证全部公开入口的注册与必要输入边界、真实业务链路及停止点、包内路径闭合 [[workflow-package-1](#workflow-package-1)]，并检查 Skill 层无业务实现 [[workflow-package-2](#workflow-package-2)] 和角色配置、真实事件及本地运行时版本来源 [[workflow-package-3](#workflow-package-3)]。

- 通用输入集成验证通过实际命令及公开执行入口核对空参数、内联脚本、PATH、普通同名数据参数、模块入口及非语义描述差异不会误拒绝 [[workflow-package-5](#workflow-package-5)] [command_portability.integration.mjs](../../tests/command_portability.integration.mjs)。
- 正常路径验证须包括新请求的实际处理，不仅重放已完成回执；生命周期命令使用独立新夹具核对文件、指针及不执行产品测试的边界 [acceptance_lifecycle_cli.integration.mjs](../../tests/acceptance_lifecycle_cli.integration.mjs)。

### workflow-package-7

当验证跨工作流接续时，系统测试应只向总调度交接目标，通过其官方子调用观察真实阻塞后的诊断修正和任务继续，核对失败保留、同一验收身份、所选场景的实际执行及独立结果 [[workflow-package-6](#workflow-package-6)] [orchestrated_goal.audit.mjs](../../tests/orchestrated_goal.audit.mjs)。

### workflow-package-10

当系统测试验证总调度接入时，应仅向总调度入口交接真实用户任务，核对动态子调用、只创建／冻结等停止点、同任务后续调整、不重复执行及完整所选场景的真实结果和独立证据 [[workflow-package-8](#workflow-package-8)] [[workflow-package-9](#workflow-package-9)] [acceptance_orchestrate.integration.mjs](../../tests/acceptance_orchestrate.integration.mjs)。

### workflow-package-13

当验证输入准备与设计接续时，集成测试应通过实际存储及官方总入口核对只读预检集中报错、无子业务效果和发布时重新校验 [[workflow-package-11](#workflow-package-11)]，以及无产品实现的不同领域黑盒设计和带绑定的设计纠正均由 Designer 产出、未执行产品测试 [[workflow-package-12](#workflow-package-12)] [acceptance_orchestrate.integration.mjs](../../tests/acceptance_orchestrate.integration.mjs) [acceptance_design_readiness_cli.integration.mjs](../../tests/acceptance_design_readiness_cli.integration.mjs)。

### workflow-package-20

当验证 Electron 子脚本适配时，集成测试应在真实 Electron 主进程与普通 Node 中核对实际场景门禁、子命令退出、授权文件参数及环境隔离，并保留真实桌面单场景主流程的直接证据 [[workflow-package-19](#workflow-package-19)] [electron_node.integration.mjs](../../tests/electron_node.integration.mjs)。

### workflow-package-23

当验证后台只读快照时，集成测试应在真实 Node 和 Electron 主进程核对完整投影与既有算法相同、根内文件变更仍被发现、事件循环保持响应、取消和线程失败均不采用部分结果 [[workflow-package-22](#workflow-package-22)] [readonly_worker.integration.mjs](../../tests/readonly_worker.integration.mjs)。

### workflow-package-25

当验证校验器启动失败时，真实 Electron 集成应在隔离的缺失命令环境中核对原始 ENOENT、未观测输出的空值和保留的失败回执，恢复环境后既有成功校验仍有独立真实回执 [[workflow-package-24](#workflow-package-24)] [electron_node.integration.mjs](../../tests/electron_node.integration.mjs)。

### workflow-package-27

当验证项目指南失败边界时，集成测试应通过真实工作区、子进程及受控官方 Player 端口确认错误原文、失败收据和源码保留，且不调用真实模型或重放业务 [[workflow-package-26](#workflow-package-26)] [acceptance_project_rebind.integration.mjs](../../tests/acceptance_project_rebind.integration.mjs)。

### workflow-package-29

当验证子调用后的错误收尾时，集成测试应通过真实持久化总入口和受控官方端口核对预算及原生错误、原子回执、归属释放和新消息保留旧调用，不调用真实模型或执行产品测试 [[workflow-package-28](#workflow-package-28)] [acceptance_orchestrate.integration.mjs](../../tests/acceptance_orchestrate.integration.mjs)。

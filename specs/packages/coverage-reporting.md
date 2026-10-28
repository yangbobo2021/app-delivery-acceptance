# coverage-reporting: 工具覆盖率与范围说明

## 意图

提供与真实执行绑定、由成熟专用工具计算的源码覆盖率，并清楚展示不可计算的范围。

本包规定需求目标，不声明当前实现已经符合或通过验收。

## 外部行为

### coverage-reporting-1

当本次验收要求覆盖率时，单独会话的覆盖率准备 AGENT 应基于已验证环境 [[project-preparation-5](project-preparation.md#project-preparation-5)] 选择项目适用的专用工具并验证采集链，不重新替代运行准备职责。

### coverage-reporting-2

当声明覆盖率准备可用时，准备证据应证明采集链能区分真实零命中、非零命中及采集未启动或收尾丢失，并保存绑定冻结源码和执行路由的探针结果，不将探针数字计为业务覆盖；已有计划可在同一运行时及源码绑定下显式复用命令定义，但新准备仍须重新执行全部探针。

- 新建或修改原生读取/合并路径时，准备角色应先以有界非业务数据验证实际工具版本的单份读取、全零及混合合并能力，保留命令、原始快照与原生报告；全零与非零采集模式应一致，不得自行填造分母。角色自检不替代宿主独立执行完整收尾链路。

- 失败记录保留实际进程退出及返回诊断；原生数据被读取器改变时保留读取前后的文件摘要，便于定位变更，不削弱只读门禁。
- 准备所用的通用入口、工具身份比较和交接封装由工作流包的确定性代码提供；项目后端只适配实际工具，工具身份按真实名称及版本核验，用途描述的语言或措辞不改变身份。
- 交接使用同一份冻结工具元数据，先验证后端实测工具身份，再执行完整探针；失败诊断保留操作、命令、退出状态、原始输出及明确的预期/实际差异。
- 新准备就绪前通过最终冻结入口验证各声明路由的两次独立零命中、非零命中、实际收尾、重复核验及全零/混合汇总，并用独立工具读取同份原生数据对照指标；失败不发布就绪交接，命令、回执及文件摘要随准备冻结。
- 调用者明确补充的实际执行入口或进程要求随准备请求冻结并传入角色；真实父进程启动 CLI 子进程的准备验证保留原生证据及源码不变证明 [coverage_cli_readiness.integration.mjs](../../tests/coverage_cli_readiness.integration.mjs)。

### coverage-reporting-3

当为实际场景采集覆盖率时，采集应绑定同次真实测试执行 [[execution-evidence-2](execution-evidence.md#execution-evidence-2)]、源码及组件版本、工具、配置和原生数据，不将历史计数或其他场景结果替代本次证据。

- 报告一致性由固定协议核对原始证据哈希及专用工具重算的状态、源码范围和指标；生成时间及展示描述不参与一致性判断，重算不得修改原始报告或原生文件。
- 框架收尾和汇总封装由固定协议完成，单次读取和多组合并使用同一个项目工具读取入口，不能分别重建统计环境或自行累计计数。

### coverage-reporting-4

当识别覆盖单位、计算分母、转换映射、合并或统计时，覆盖率处理应使用所选专用工具及其支持的转换和统计模块，不由通用 SKILL 或视图自行识别可执行行、推断命中或重建编译映射。

- 覆盖率准备 AGENT 的实际输入包含完整工具规约；项目适配器和独立读取器均使用专用工具的报告或统计接口，不自行重写行或分支计数算法。

### coverage-reporting-5

当工具不支持某种语言、指标、路径或映射时，报告应保留原声明范围并区分不支持、不可用与不完整及具体原因，不删去缺口或把无数据表示为实测零命中。

### coverage-reporting-6

当用户切换全项目、修改文件或修改行范围时，视图应使用兼容报告中由专用工具生成的该范围行与分支统计；无法生成时显示该范围不可用，不借用其他范围或平均百分比。

### coverage-reporting-7

当输出覆盖率结果时，报告应分别给出行覆盖率和工具支持的分支覆盖率或其不可用原因，以及采集版本、采集/转换/统计工具名称与版本、范围和缺口，不用覆盖率替代设计充分性或产品正确性结论。

### coverage-reporting-8

当汇总多个场景的覆盖率时，汇总应核对源码、工具和准备资料兼容性并保留零命中单位，拒绝将不兼容版本的计数合并成一个总百分比。

### coverage-reporting-9

当原始覆盖率数据或工具环境已退役时，历史视图应仅展示可核对的工具摘要并说明无法复算的范围，不从摘要反推缺失计数。

### coverage-reporting-10

当已启用覆盖率的场景执行或恢复时，流程应继承冻结采集策略，适配器失效或采集失败时记录不可用或不完整，不因模板缺省而静默降为关闭。

### coverage-reporting-11

当调用者显式关闭本次覆盖率时，流程应记录关闭依据及 off 状态并跳过覆盖率准备；未支持或采集失败不能使用 off 代替。

## 验证

历史测试报告不作为本包当前需求已经通过的证明。

### coverage-reporting-12

当验证项目覆盖率准备时，集成测试应通过实际采集命令核对零命中、非零命中及失败路由的状态传播 [[coverage-reporting-2](#coverage-reporting-2)]，并核对项目适配器与独立读取器使用专用工具原生报告的计数 [[coverage-reporting-4](#coverage-reporting-4)]，不将准备探针计入业务结果。

### coverage-reporting-13

当验证独立覆盖率准备及修复入口时，集成测试应通过真实官方 CLI 角色选择项目适用工具 [[coverage-reporting-1](#coverage-reporting-1)]、在同一 AT 的新尝试重新运行工具探针并保留首次失败 [[coverage-reporting-2](#coverage-reporting-2)]、核对 Node 探针后端与专用工具原生输出一致 [[coverage-reporting-4](#coverage-reporting-4)]，以及区分用户关闭和工具不可用 [[coverage-reporting-11](#coverage-reporting-11)] [acceptance_coverage.integration.mjs](../../tests/acceptance_coverage.integration.mjs)。

### coverage-reporting-14

当将正式采集及注册迁移到 Node 时，集成测试应执行真实测试及专用工具并核对同次收据和原生数据 [[coverage-reporting-2](#coverage-reporting-2)]、统计仍来自专用工具 [[coverage-reporting-4](#coverage-reporting-4)]、旧报告不可覆盖及不兼容场景拒绝 [[coverage-reporting-8](#coverage-reporting-8)]，并阻止绕过已启用采集策略 [[coverage-reporting-10](#coverage-reporting-10)]。

- 确定性协议入口的实际子进程验证涵盖工具描述变化仍可交接、版本漂移拒绝、空诊断失败定位、业务非零退出码与 stdout/stderr 透传，以及冻结后端漂移拒绝 [[coverage-reporting-2](#coverage-reporting-2)]。
- 完整准备链路的集成验证使用真实专用工具及子进程，核对零/非零调用、报告重复重算和汇总均可用才交接就绪 [[coverage-reporting-2](#coverage-reporting-2)]，并核对生成时间变化不误拒绝、原始证据或重算指标变化仍拒绝及只读完整性 [[coverage-reporting-3](#coverage-reporting-3)] [coverage_lifecycle.integration.mjs](../../tests/coverage_lifecycle.integration.mjs)。

### coverage-reporting-15

当验证已启用采集后的显式关闭时，集成测试应通过真实 CLI 核对实际用户依据及 off 策略 [[coverage-reporting-11](#coverage-reporting-11)]、原必需策略的保留和旧 catalog 失效 [[coverage-reporting-10](#coverage-reporting-10)]，并核对再次启用后的旧关闭决定保持历史事实而不能表示当前策略。

### coverage-reporting-16

当验证修复采集后的指定用例重跑及历史复算时，集成测试应使用成熟工具与真实官方 CLI 核对同次执行的数据绑定 [[coverage-reporting-3](#coverage-reporting-3)]、原生统计及兼容性 [[coverage-reporting-4](#coverage-reporting-4)] [[coverage-reporting-8](#coverage-reporting-8)] 和归档附件退役后的可复算或不可用边界 [[coverage-reporting-9](#coverage-reporting-9)] [coverage_repaired_journey.integration.mjs](../../tests/coverage_repaired_journey.integration.mjs)。

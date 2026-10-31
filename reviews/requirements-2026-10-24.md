# 测试 SKILL 需求质量审查

日期：2026-10-24。
审查对象为初始的 11 个需求包、119 条外部行为要求；操作合同对照版本为主干 `fa4a373`。
本次由当前会话逐条阅读、修订并再次核对，不声称经过独立 Reviewer 审查。

## 结论

初始需求覆盖了主要职责，但存在混合事项、模糊判据、来源支持与执行通过混淆，以及空结果和失败分支漏写等问题，需要修订后再开展场景设计。
已保留全部原 ID，修订 101 条、原文保留 18 条，拆出或补齐 33 条已有约定，当前共 152 条需求。
这 33 条没有新增平台、全项目测试普查或 TDD 等产品能力。
本次只修改需求文档及审查记录，没有开展交付验收。

## 什么是本项目的好需求

以下为项目审查准则，不是对外部标准认证的声明。

| 标准 | 阅读时的判断问题 |
| --- | --- |
| 有价值且必要 | 能说明服务的用户目标，并能找到用户指令或产品约定依据。 |
| 一条一个事项 | 不把不同触发、不同主体和可独立交付的结果揉成一条。 |
| 清晰完整 | 能直接读出谁在什么条件下做什么，正常和必要异常分支没有歧义。 |
| 可验证 | 能指出满足的证据和违反的反例；需要语义判断的质量不能只用关键词判分。 |
| 一致且不重复 | 角色、状态和版本含义一致，同一义务有明确归属，依赖有准确引用。 |
| 可追溯 | 每条有唯一稳定 ID，能知道为何保留、修订或新增。 |
| 实现约束适度 | 写清对用户必要的结果与已约定接口，不绑定某个业务项目或测试语言。 |

质量要求保留人工可审查的判据，例如标题是否说明业务对象与实际结果、缺口是否有具体错误反例。
不以统一短句、机械字数、中文比例或自行设定的通过率替代内容质量。

## 主要问题与处理

| 问题 | 初始例子 | 修订方向 |
| --- | --- | --- |
| 静态证据暗示运行通过 | case-assessment-2 的“已验证的贡献”。 | 改成逐义务设计支持程度，并禁止把源码断言当成执行通过。 |
| 混合不同触发 | traceability-view-9 同时规定筛选、切换 AT 和刷新。 | 原 ID 保留切换事项，筛选与刷新分别使用新 ID。 |
| 形容词不能判定 | delivery-acceptance-5 的“充分、可信”和 project-preparation-4 的“最小”。 | 写出义务到判据映射、独立结论及真实环境验证；不要求寻找绝对最小方案。 |
| 等级或状态缺少边界 | scenario-design-6 只列 P0 至 P3，execution-evidence-5 未给结论门槛。 | 补充失败影响及结论依据表。 |
| 只读含义不清 | case-design-9 的“只读选择和实际调试”。 | 区分禁止修改项目文件与允许已有入口执行，并引用唯一宿主 ID 注释例外。 |
| 已有约定漏写 | 跳过用例、评估阈值反例、无场景需求、刷新失败等未单独规定。 | 依据现行合同补齐，给出触发及可观察处置。 |
| 追踪身份不够具体 | case-identity-1 未直接规定源码注释标记。 | 独立规定准确注释形式、安全位置和共享索引，维持需求ID与用例ID区别。 |
| 语言不通顺 | case-design-12 的“当交付验收中的测试代码时”。 | 明确新建或扩展的测试代码及候选/已集成状态。 |

## ID 与审查覆盖

- 需求 ID 使用 `<pack>-<N>`，例如 `case-assessment-8`，直接记录在需求正文标题及链接锚点中。
- 全部原有 119 个 ID 保留；33 个新 ID 接续对应包的编号，不重新编号或将旧 ID 分配给新事项。
- 唯一性范围是本项目需求树，不是跨所有项目的全局编号。
- 需求 ID 不代替 `TC-<UUIDv4>` 用例 ID、场景 ID 或 AT ID。
- 下表逐条列出全部原需求的审查处理和全部新增需求的依据；“保留”表示经过审查后正文未变。

## delivery-acceptance

依据：[SKILL.md](../skills/en/app-delivery-acceptance/SKILL.md)；同时对照本对话中对应的用户目标。

| 需求 ID | 处理 | 审查理由或新增依据 |
| --- | --- | --- |
| [delivery-acceptance-1](../specs/packages/delivery-acceptance.md#delivery-acceptance-1) | 修订 | 明确独立场景的入口及需要建立关系的对象，展示细节由视图包负责。 |
| [delivery-acceptance-2](../specs/packages/delivery-acceptance.md#delivery-acceptance-2) | 保留 | 保留：授权边界和禁止产生的副作用均明确。 |
| [delivery-acceptance-3](../specs/packages/delivery-acceptance.md#delivery-acceptance-3) | 修订 | 将隐含的范围选择变成可核对的纳入依据。 |
| [delivery-acceptance-4](../specs/packages/delivery-acceptance.md#delivery-acceptance-4) | 修订 | 明确报告时点和范围排除，避免将范围外项写成已纳入义务。 |
| [delivery-acceptance-5](../specs/packages/delivery-acceptance.md#delivery-acceptance-5) | 修订 | 把“充分、可信”绑定到义务映射、版本和独立结论，给出不通过边界。 |
| [delivery-acceptance-6](../specs/packages/delivery-acceptance.md#delivery-acceptance-6) | 保留 | 保留：全量与版本条件可核对。 |
| [delivery-acceptance-7](../specs/packages/delivery-acceptance.md#delivery-acceptance-7) | 保留 | 保留：产品修复授权与测试职责边界明确。 |
| [delivery-acceptance-8](../specs/packages/delivery-acceptance.md#delivery-acceptance-8) | 修订 | 补足风险接受的身份、决定来源和时间，防止代替用户接受。 |
| [delivery-acceptance-9](../specs/packages/delivery-acceptance.md#delivery-acceptance-9) | 修订 | 删除无法衡量的“重要、低价值”，改为可观察的重复停止条件。 |
| [delivery-acceptance-10](../specs/packages/delivery-acceptance.md#delivery-acceptance-10) | 新增 | 补齐现有整体需求分析职责及完整性要求；来源 SKILL 工作顺序第2步。 |
| [delivery-acceptance-11](../specs/packages/delivery-acceptance.md#delivery-acceptance-11) | 新增 | 补齐无需求入口的预期来源；来源 SKILL 第2、4步。 |
| [delivery-acceptance-12](../specs/packages/delivery-acceptance.md#delivery-acceptance-12) | 新增 | 补齐既有手工/无源码路线的可观察边界；不扩展支持范围。 |

## definition-lifecycle

依据：[references/frozen-definitions.md](../skills/en/app-delivery-acceptance/references/frozen-definitions.md)、[SKILL.md](../skills/en/app-delivery-acceptance/SKILL.md)；同时对照本对话中对应的用户目标。

| 需求 ID | 处理 | 审查理由或新增依据 |
| --- | --- | --- |
| [definition-lifecycle-1](../specs/packages/definition-lifecycle.md#definition-lifecycle-1) | 保留 | 保留：跨来源输入与原文保存明确。 |
| [definition-lifecycle-2](../specs/packages/definition-lifecycle.md#definition-lifecycle-2) | 修订 | 将“缺失的设计”明确为可列举的缺口。 |
| [definition-lifecycle-3](../specs/packages/definition-lifecycle.md#definition-lifecycle-3) | 保留 | 保留：独立场景的来源边界明确。 |
| [definition-lifecycle-4](../specs/packages/definition-lifecycle.md#definition-lifecycle-4) | 保留 | 保留：可用离线读取核对结果。 |
| [definition-lifecycle-5](../specs/packages/definition-lifecycle.md#definition-lifecycle-5) | 修订 | 明确责任主体和独立依据的反例。 |
| [definition-lifecycle-6](../specs/packages/definition-lifecycle.md#definition-lifecycle-6) | 保留 | 保留：未知预期不可变成判定依据。 |
| [definition-lifecycle-7](../specs/packages/definition-lifecycle.md#definition-lifecycle-7) | 修订 | 用追加及不覆盖明确不可变语义。 |
| [definition-lifecycle-8](../specs/packages/definition-lifecycle.md#definition-lifecycle-8) | 修订 | 明确校验失败行为，覆盖分析与设计入口。 |
| [definition-lifecycle-9](../specs/packages/definition-lifecycle.md#definition-lifecycle-9) | 修订 | 把“隐含影响”落实为场景名单及因果依据。 |
| [definition-lifecycle-10](../specs/packages/definition-lifecycle.md#definition-lifecycle-10) | 保留 | 保留：无业务依赖变化时的兼容性明确。 |
| [definition-lifecycle-11](../specs/packages/definition-lifecycle.md#definition-lifecycle-11) | 保留 | 保留：全量变更验收的集合边界明确。 |
| [definition-lifecycle-12](../specs/packages/definition-lifecycle.md#definition-lifecycle-12) | 修订 | 补充与全局授权边界的绑定，保留该包的变更语义。 |
| [definition-lifecycle-13](../specs/packages/definition-lifecycle.md#definition-lifecycle-13) | 修订 | 明确无法读取不等于已删除。 |
| [definition-lifecycle-14](../specs/packages/definition-lifecycle.md#definition-lifecycle-14) | 修订 | 聚焦无规范时的初始化结果；已有规范与未经授权副作用分别由新增项和全局边界负责。 |
| [definition-lifecycle-15](../specs/packages/definition-lifecycle.md#definition-lifecycle-15) | 修订 | 将“处理或限制”改为逐路径可核对处置。 |
| [definition-lifecycle-16](../specs/packages/definition-lifecycle.md#definition-lifecycle-16) | 修订 | 明确跟随历史是执行意图，防止从历史推导全量授权。 |
| [definition-lifecycle-17](../specs/packages/definition-lifecycle.md#definition-lifecycle-17) | 新增 | 补齐原14仅覆盖无规范分支造成的遗漏；来源 frozen-definitions 回填段。 |
| [definition-lifecycle-18](../specs/packages/definition-lifecycle.md#definition-lifecycle-18) | 新增 | 补齐外部独立依据的真实性边界；来源 SKILL 第4步。 |

## scenario-design

依据：[references/portable-workflow-v4.md](../skills/en/app-delivery-acceptance/references/portable-workflow-v4.md)、[references/scenario-priority-v3.md](../skills/en/app-delivery-acceptance/references/scenario-priority-v3.md)、[SKILL.md](../skills/en/app-delivery-acceptance/SKILL.md)；同时对照本对话中对应的用户目标。

| 需求 ID | 处理 | 审查理由或新增依据 |
| --- | --- | --- |
| [scenario-design-1](../specs/packages/scenario-design.md#scenario-design-1) | 修订 | 明确完整上下文和唯一主目标，便于检查错归属。 |
| [scenario-design-2](../specs/packages/scenario-design.md#scenario-design-2) | 修订 | 将“适用”落到三要素，保留防抽样伪装完整的要求。 |
| [scenario-design-3](../specs/packages/scenario-design.md#scenario-design-3) | 修订 | 用可读内容和判定结果替换泛化的简洁要求，长度来自现有合同。 |
| [scenario-design-4](../specs/packages/scenario-design.md#scenario-design-4) | 修订 | 把“充分”变为义务到场景及判据的可审查映射。 |
| [scenario-design-5](../specs/packages/scenario-design.md#scenario-design-5) | 修订 | 避免把合法不确定性判成必补缺口。 |
| [scenario-design-6](../specs/packages/scenario-design.md#scenario-design-6) | 修订 | 补足P0至P3判据，并保留不能因日后补救而降级的既有约定。 |
| [scenario-design-7](../specs/packages/scenario-design.md#scenario-design-7) | 修订 | 明确需要写入场景的视觉判据。 |
| [scenario-design-8](../specs/packages/scenario-design.md#scenario-design-8) | 修订 | 明确增量基线及完整集合复核依赖。 |
| [scenario-design-9](../specs/packages/scenario-design.md#scenario-design-9) | 修订 | 独立审查定义明确，避免职责名称误导。 |
| [scenario-design-10](../specs/packages/scenario-design.md#scenario-design-10) | 新增 | 补齐跨目标的一致性职责；来源 SKILL 第3步。 |

## project-preparation

依据：[references/project-runtime-preparation.md](../skills/en/app-delivery-acceptance/references/project-runtime-preparation.md)、[references/agent-runtime.md](../skills/en/app-delivery-acceptance/references/agent-runtime.md)、[SKILL.md](../skills/en/app-delivery-acceptance/SKILL.md)；同时对照本对话中对应的用户目标。

| 需求 ID | 处理 | 审查理由或新增依据 |
| --- | --- | --- |
| [project-preparation-1](../specs/packages/project-preparation.md#project-preparation-1) | 修订 | 明确运行身份由调用者提供而非工具自动选择。 |
| [project-preparation-2](../specs/packages/project-preparation.md#project-preparation-2) | 修订 | 给出可观察的拒绝条件和结果。 |
| [project-preparation-3](../specs/packages/project-preparation.md#project-preparation-3) | 保留 | 保留：依赖隔离和固定来源明确。 |
| [project-preparation-4](../specs/packages/project-preparation.md#project-preparation-4) | 修订 | 将“独立”和“最小”改为会话边界与项目证据；宿主验证拆到新增11。 |
| [project-preparation-5](../specs/packages/project-preparation.md#project-preparation-5) | 修订 | 明确记录至少包含的证据字段。 |
| [project-preparation-6](../specs/packages/project-preparation.md#project-preparation-6) | 修订 | 将环境复用与业务状态隔离分开绑定，修复原storage5引用不准确。 |
| [project-preparation-7](../specs/packages/project-preparation.md#project-preparation-7) | 保留 | 保留：知识复用不等于环境验证。 |
| [project-preparation-8](../specs/packages/project-preparation.md#project-preparation-8) | 保留 | 保留：通用性是选择机制，不承诺所有工具都可执行。 |
| [project-preparation-9](../specs/packages/project-preparation.md#project-preparation-9) | 修订 | 明确容器、原生系统和格式检查的证据边界。 |
| [project-preparation-10](../specs/packages/project-preparation.md#project-preparation-10) | 修订 | 将“已核对”具体化，秘密由storage9统一约束。 |
| [project-preparation-11](../specs/packages/project-preparation.md#project-preparation-11) | 新增 | 拆出原4的宿主独立验证职责；来源运行准备合同。 |
| [project-preparation-12](../specs/packages/project-preparation.md#project-preparation-12) | 新增 | 补齐准备交付物的绑定边界；来源 SKILL 第5步。 |
| [project-preparation-13](../specs/packages/project-preparation.md#project-preparation-13) | 新增 | 补齐既有运行前提；不新增Windows支持。 |

## case-design

依据：[references/case-search-guidance.md](../skills/en/app-delivery-acceptance/references/case-search-guidance.md)、[references/case-discovery-contract.md](../skills/en/app-delivery-acceptance/references/case-discovery-contract.md)、[references/case-reuse-contract.md](../skills/en/app-delivery-acceptance/references/case-reuse-contract.md)、[references/case-display-contract.md](../skills/en/app-delivery-acceptance/references/case-display-contract.md)；同时对照本对话中对应的用户目标。

| 需求 ID | 处理 | 审查理由或新增依据 |
| --- | --- | --- |
| [case-design-1](../specs/packages/case-design.md#case-design-1) | 修订 | 明确复用先行与耗时边界，避免将可选单独查找误解为禁止。 |
| [case-design-2](../specs/packages/case-design.md#case-design-2) | 修订 | 把关联正确性落实到实际贡献证据。 |
| [case-design-3](../specs/packages/case-design.md#case-design-3) | 修订 | 明确检查点失败对交接的影响。 |
| [case-design-4](../specs/packages/case-design.md#case-design-4) | 修订 | 把充分支持的条件具体化并界定零修改。 |
| [case-design-5](../specs/packages/case-design.md#case-design-5) | 修订 | 一个触发和一个补缺口决策，未采用解释拆到新增15。 |
| [case-design-6](../specs/packages/case-design.md#case-design-6) | 修订 | 用可区分错误行为代替笼统“有效”，保留预期来源约束。 |
| [case-design-7](../specs/packages/case-design.md#case-design-7) | 修订 | 将无意义与冗余转为相同目的及增量辨错能力。 |
| [case-design-8](../specs/packages/case-design.md#case-design-8) | 修订 | 明确观察交付物与判定职责。 |
| [case-design-9](../specs/packages/case-design.md#case-design-9) | 修订 | 消除只读与真实执行的歧义，明确唯一宿主注释例外。 |
| [case-design-10](../specs/packages/case-design.md#case-design-10) | 修订 | 明确静态结果的可观测副作用和空字段。 |
| [case-design-11](../specs/packages/case-design.md#case-design-11) | 修订 | 统一内容协议与事实来源，标题质量独立到新增13。 |
| [case-design-12](../specs/packages/case-design.md#case-design-12) | 修订 | 修正病句并明确集成与候选状态。 |
| [case-design-13](../specs/packages/case-design.md#case-design-13) | 新增 | 拆出用户反复要求的标题质量；依据用例展示合同和用户原话。 |
| [case-design-14](../specs/packages/case-design.md#case-design-14) | 新增 | 补齐既有关联可运行性边界。 |
| [case-design-15](../specs/packages/case-design.md#case-design-15) | 新增 | 拆出原5的逐项选择解释，防止静默丢失已有支持。 |
| [case-design-16](../specs/packages/case-design.md#case-design-16) | 新增 | 补齐查找关联的宿主真实性校验；不宣称语义已证明。 |
| [case-design-17](../specs/packages/case-design.md#case-design-17) | 新增 | 补齐已有用例保护，避免复用时破坏相邻需求；来源复用合同。 |

## case-identity

依据：[references/case-display-contract.md](../skills/en/app-delivery-acceptance/references/case-display-contract.md)、[SKILL.md](../skills/en/app-delivery-acceptance/SKILL.md)；同时对照本对话中对应的用户目标。

| 需求 ID | 处理 | 审查理由或新增依据 |
| --- | --- | --- |
| [case-identity-1](../specs/packages/case-identity.md#case-identity-1) | 修订 | 标明ID格式和声明绑定，精确注释语法由新增10规定。 |
| [case-identity-2](../specs/packages/case-identity.md#case-identity-2) | 修订 | 明确移动或编辑时注释随声明保留，避免暗示丢失注释也能任意追认。 |
| [case-identity-3](../specs/packages/case-identity.md#case-identity-3) | 修订 | 突出独立新声明与扩展的身份边界。 |
| [case-identity-4](../specs/packages/case-identity.md#case-identity-4) | 修订 | 明确保护的基线和拒绝行为。 |
| [case-identity-5](../specs/packages/case-identity.md#case-identity-5) | 保留 | 保留：原始回答和正式执行间的变更可追溯。 |
| [case-identity-6](../specs/packages/case-identity.md#case-identity-6) | 修订 | 明确无注释恢复的条件；不承诺模糊匹配或自动跟踪任意移动。 |
| [case-identity-7](../specs/packages/case-identity.md#case-identity-7) | 修订 | 明确无效ID和错误对象的拒绝结果。 |
| [case-identity-8](../specs/packages/case-identity.md#case-identity-8) | 修订 | 保留身份可解析要求，避免与执行事实混淆。 |
| [case-identity-9](../specs/packages/case-identity.md#case-identity-9) | 修订 | 明确按声明编号而非测试数据数量。 |
| [case-identity-10](../specs/packages/case-identity.md#case-identity-10) | 新增 | 补齐普通注释的准确格式和安全位置；来源永久ID合同。 |
| [case-identity-11](../specs/packages/case-identity.md#case-identity-11) | 新增 | 拆出注释的行为兼容要求，编码和权限可核对。 |
| [case-identity-12](../specs/packages/case-identity.md#case-identity-12) | 新增 | 补齐跨场景追踪依赖的共享索引和范围；来源永久ID合同。 |

## case-assessment

依据：[references/case-evaluation-contract.md](../skills/en/app-delivery-acceptance/references/case-evaluation-contract.md)、[references/case-agents.md](../skills/en/app-delivery-acceptance/references/case-agents.md)；同时对照本对话中对应的用户目标。

| 需求 ID | 处理 | 审查理由或新增依据 |
| --- | --- | --- |
| [case-assessment-1](../specs/packages/case-assessment.md#case-assessment-1) | 修订 | 明确独立会话及场景中心，避免将完整需求都变成本场景义务。 |
| [case-assessment-2](../specs/packages/case-assessment.md#case-assessment-2) | 修订 | 消除“已验证贡献”在静态评估中暗示运行通过的问题。 |
| [case-assessment-3](../specs/packages/case-assessment.md#case-assessment-3) | 修订 | 将合理性绑定到具体影响，明确不应误报的情形。 |
| [case-assessment-4](../specs/packages/case-assessment.md#case-assessment-4) | 修订 | 给出冗余判断的对照依据和反例。 |
| [case-assessment-5](../specs/packages/case-assessment.md#case-assessment-5) | 修订 | 将简洁清晰准确转成信息顺序、类型和一致性要求。 |
| [case-assessment-6](../specs/packages/case-assessment.md#case-assessment-6) | 修订 | 明确引用失败处置，与不阻断正式执行一致。 |
| [case-assessment-7](../specs/packages/case-assessment.md#case-assessment-7) | 修订 | 明确设计评估是建议职责，正式判定保持独立。 |
| [case-assessment-8](../specs/packages/case-assessment.md#case-assessment-8) | 新增 | 补齐必要缺口的证据门槛；来源评估合同。 |
| [case-assessment-9](../specs/packages/case-assessment.md#case-assessment-9) | 新增 | 补齐已确认的阈值辨错要求，保持场景范围。 |
| [case-assessment-10](../specs/packages/case-assessment.md#case-assessment-10) | 新增 | 补齐现行评估合同的空成功、归属与动作事实边界。 |

## execution-evidence

依据：[references/portable-workflow-v4.md](../skills/en/app-delivery-acceptance/references/portable-workflow-v4.md)、[SKILL.md](../skills/en/app-delivery-acceptance/SKILL.md)；同时对照本对话中对应的用户目标。

| 需求 ID | 处理 | 审查理由或新增依据 |
| --- | --- | --- |
| [execution-evidence-1](../specs/packages/execution-evidence.md#execution-evidence-1) | 修订 | 理清多重“并”及绑定对象，可核对的本地观察仍与正式结论分离。 |
| [execution-evidence-2](../specs/packages/execution-evidence.md#execution-evidence-2) | 修订 | 将业务命令改为测试命令避免误解，补齐收据必需绑定。 |
| [execution-evidence-3](../specs/packages/execution-evidence.md#execution-evidence-3) | 修订 | 明确结果未知与执行事实的区别，补足禁止推断执行。 |
| [execution-evidence-4](../specs/packages/execution-evidence.md#execution-evidence-4) | 修订 | 具体化证据交接内容及失配处置。 |
| [execution-evidence-5](../specs/packages/execution-evidence.md#execution-evidence-5) | 修订 | 补足独立会话与各结论的证据门槛，避免运行成功即通过。 |
| [execution-evidence-6](../specs/packages/execution-evidence.md#execution-evidence-6) | 修订 | 明确图片实际输入与上下文要求。 |
| [execution-evidence-7](../specs/packages/execution-evidence.md#execution-evidence-7) | 修订 | 补上缺图不能通过的决定性条件，缺陷判定依据集中在5。 |
| [execution-evidence-8](../specs/packages/execution-evidence.md#execution-evidence-8) | 修订 | 将有界次数绑定到明确预算，配置要求拆到13。 |
| [execution-evidence-9](../specs/packages/execution-evidence.md#execution-evidence-9) | 保留 | 保留：合同问题不能由改测试消除。 |
| [execution-evidence-10](../specs/packages/execution-evidence.md#execution-evidence-10) | 保留 | 保留：策略选择与修复授权边界明确。 |
| [execution-evidence-11](../specs/packages/execution-evidence.md#execution-evidence-11) | 修订 | 明确由谁判定影响，不将任何收尾失败自动等同产品缺陷。 |
| [execution-evidence-12](../specs/packages/execution-evidence.md#execution-evidence-12) | 保留 | 保留：版本与历史不可变明确。 |
| [execution-evidence-13](../specs/packages/execution-evidence.md#execution-evidence-13) | 新增 | 将原8隐含的次数边界拆成可验证的配置与停止要求。 |
| [execution-evidence-14](../specs/packages/execution-evidence.md#execution-evidence-14) | 新增 | 补齐源码版本门禁；来源v4及共享工作区合同。 |

## coverage-reporting

依据：[references/coverage-tool-contract.md](../skills/en/app-delivery-acceptance/references/coverage-tool-contract.md)、[references/project-coverage-protocol.md](../skills/en/app-delivery-acceptance/references/project-coverage-protocol.md)、[SKILL.md](../skills/en/app-delivery-acceptance/SKILL.md)；同时对照本对话中对应的用户目标。

| 需求 ID | 处理 | 审查理由或新增依据 |
| --- | --- | --- |
| [coverage-reporting-1](../specs/packages/coverage-reporting.md#coverage-reporting-1) | 修订 | 明确准备职责分离，关闭策略拆到11。 |
| [coverage-reporting-2](../specs/packages/coverage-reporting.md#coverage-reporting-2) | 修订 | 明确可核对的探针反例而非“可靠”形容词。 |
| [coverage-reporting-3](../specs/packages/coverage-reporting.md#coverage-reporting-3) | 修订 | 术语与正式执行保持一致。 |
| [coverage-reporting-4](../specs/packages/coverage-reporting.md#coverage-reporting-4) | 修订 | 明确工具边界和禁止自造的行为，去掉“可靠流程”的模糊判断。 |
| [coverage-reporting-5](../specs/packages/coverage-reporting.md#coverage-reporting-5) | 修订 | 明确缺失数据与真实零命中的区别。 |
| [coverage-reporting-6](../specs/packages/coverage-reporting.md#coverage-reporting-6) | 修订 | 补齐所选范围无数据时的显示行为。 |
| [coverage-reporting-7](../specs/packages/coverage-reporting.md#coverage-reporting-7) | 修订 | 明确指标和工具链信息，保持与验收正确性分离。 |
| [coverage-reporting-8](../specs/packages/coverage-reporting.md#coverage-reporting-8) | 修订 | 明确不兼容时拒绝合并。 |
| [coverage-reporting-9](../specs/packages/coverage-reporting.md#coverage-reporting-9) | 保留 | 保留：历史摘要和复算能力边界明确。 |
| [coverage-reporting-10](../specs/packages/coverage-reporting.md#coverage-reporting-10) | 修订 | 将持续采集失败对应到明确状态。 |
| [coverage-reporting-11](../specs/packages/coverage-reporting.md#coverage-reporting-11) | 新增 | 拆出关闭策略的触发与状态语义；来源SKILL第7步。 |

## acceptance-storage

依据：[references/project-acceptance-store.md](../skills/en/app-delivery-acceptance/references/project-acceptance-store.md)、[references/portable-workflow-v4.md](../skills/en/app-delivery-acceptance/references/portable-workflow-v4.md)、[references/case-display-contract.md](../skills/en/app-delivery-acceptance/references/case-display-contract.md)；同时对照本对话中对应的用户目标。

| 需求 ID | 处理 | 审查理由或新增依据 |
| --- | --- | --- |
| [acceptance-storage-1](../specs/packages/acceptance-storage.md#acceptance-storage-1) | 修订 | 将“不误当”明确为拒绝条件，项目根由上下文提供。 |
| [acceptance-storage-2](../specs/packages/acceptance-storage.md#acceptance-storage-2) | 修订 | 聚焦执行入口校验，指针切换和浏览分别由新增项与视图负责。 |
| [acceptance-storage-3](../specs/packages/acceptance-storage.md#acceptance-storage-3) | 修订 | 将路径与内容约定做成可核对表格，补上Git忽略要求。 |
| [acceptance-storage-4](../specs/packages/acceptance-storage.md#acceptance-storage-4) | 修订 | 明确读取时的哈希校验及禁止推断来源。 |
| [acceptance-storage-5](../specs/packages/acceptance-storage.md#acceptance-storage-5) | 修订 | 聚焦并发与归属；业务状态隔离拆到14。 |
| [acceptance-storage-6](../specs/packages/acceptance-storage.md#acceptance-storage-6) | 修订 | 明确知识失效的判据和失败处置。 |
| [acceptance-storage-7](../specs/packages/acceptance-storage.md#acceptance-storage-7) | 修订 | 明确恢复身份与副作用检查，避免把保留状态当执行授权。 |
| [acceptance-storage-8](../specs/packages/acceptance-storage.md#acceptance-storage-8) | 修订 | 明确允许选取范围，私有数据由9统一约束。 |
| [acceptance-storage-9](../specs/packages/acceptance-storage.md#acceptance-storage-9) | 修订 | 区别本机合法业务运行与共享权限，避免绝对禁止所有数据。 |
| [acceptance-storage-10](../specs/packages/acceptance-storage.md#acceptance-storage-10) | 修订 | 把完成顺序和只清匹配指针明确化。 |
| [acceptance-storage-11](../specs/packages/acceptance-storage.md#acceptance-storage-11) | 修订 | 将“可恢复保存”明确为删除前提，保持授权范围。 |
| [acceptance-storage-12](../specs/packages/acceptance-storage.md#acceptance-storage-12) | 修订 | 减少对未定义迁移能力的隐含承诺，保持真实历史兼容。 |
| [acceptance-storage-13](../specs/packages/acceptance-storage.md#acceptance-storage-13) | 保留 | 保留：身份与版本变化关系明确。 |
| [acceptance-storage-14](../specs/packages/acceptance-storage.md#acceptance-storage-14) | 新增 | 拆出原5的业务状态隔离要求。 |
| [acceptance-storage-15](../specs/packages/acceptance-storage.md#acceptance-storage-15) | 新增 | 补齐单场景结束与整项结束的明确边界。 |
| [acceptance-storage-16](../specs/packages/acceptance-storage.md#acceptance-storage-16) | 新增 | 拆出原2的启动与切换要求。 |
| [acceptance-storage-17](../specs/packages/acceptance-storage.md#acceptance-storage-17) | 新增 | 补齐候选工作区与原源码的交付边界；来源SKILL与永久ID合同。 |

## traceability-view

依据：[references/traceability-view.md](../skills/en/app-delivery-acceptance/references/traceability-view.md)、[references/project-state-statistics.md](../skills/en/app-delivery-acceptance/references/project-state-statistics.md)、[references/case-display-contract.md](../skills/en/app-delivery-acceptance/references/case-display-contract.md)；同时对照本对话中对应的用户目标。

| 需求 ID | 处理 | 审查理由或新增依据 |
| --- | --- | --- |
| [traceability-view-1](../specs/packages/traceability-view.md#traceability-view-1) | 修订 | 补齐空场景需求和独立场景的展示分支。 |
| [traceability-view-2](../specs/packages/traceability-view.md#traceability-view-2) | 修订 | 明确两个状态列，不再笼统“未完成”。 |
| [traceability-view-3](../specs/packages/traceability-view.md#traceability-view-3) | 修订 | 将扫读要求落实到默认展示范围，引用现行视图合同。 |
| [traceability-view-4](../specs/packages/traceability-view.md#traceability-view-4) | 修订 | 明确统一交互及返回状态。 |
| [traceability-view-5](../specs/packages/traceability-view.md#traceability-view-5) | 修订 | 补足ID注释入口和缺失字段表现。 |
| [traceability-view-6](../specs/packages/traceability-view.md#traceability-view-6) | 修订 | 明确四类信息不混同及未知适用性状态。 |
| [traceability-view-7](../specs/packages/traceability-view.md#traceability-view-7) | 修订 | 补足缺失清单的处理，避免子集冒充整体。 |
| [traceability-view-8](../specs/packages/traceability-view.md#traceability-view-8) | 修订 | 用明确等式和未执行受阻边界替代模糊结果合计。 |
| [traceability-view-9](../specs/packages/traceability-view.md#traceability-view-9) | 修订 | 将原9的三个不同触发拆开，保留ID切换事项。 |
| [traceability-view-10](../specs/packages/traceability-view.md#traceability-view-10) | 修订 | 聚焦只读副作用，缺失资料状态归相应条目。 |
| [traceability-view-11](../specs/packages/traceability-view.md#traceability-view-11) | 修订 | 将“可以追问”具体化为已存在的复制操作，避免暗示自动对话服务。 |
| [traceability-view-12](../specs/packages/traceability-view.md#traceability-view-12) | 修订 | 补足摘要过期校验，保证可读不改变判定依据。 |
| [traceability-view-13](../specs/packages/traceability-view.md#traceability-view-13) | 新增 | 拆出原9的筛选要求，明确关系与分母。 |
| [traceability-view-14](../specs/packages/traceability-view.md#traceability-view-14) | 新增 | 拆出原9刷新要求，防止阅读中正文跳变。 |
| [traceability-view-15](../specs/packages/traceability-view.md#traceability-view-15) | 新增 | 补齐刷新错误状态；来源视图浏览与刷新合同。 |
| [traceability-view-16](../specs/packages/traceability-view.md#traceability-view-16) | 新增 | 补齐现有统一视图的键盘与窄屏交互要求。 |
| [traceability-view-17](../specs/packages/traceability-view.md#traceability-view-17) | 新增 | 补齐组级凭证与逐用例事实的边界。 |
| [traceability-view-18](../specs/packages/traceability-view.md#traceability-view-18) | 新增 | 补齐异常及空状态的可信阅读要求。 |

## 检查结果与剩余边界

| 检查 | 实际结果 |
| --- | --- |
| 原需求审查覆盖 | 119/119，全部有逐条处理记录。 |
| 当前需求 ID | 152 个，全部唯一，全部原 119 个 ID 保留。 |
| 结构与引用 | 锁定的 SPEX 4.0.0 lint 报告 no problems found；另核对 240 处本地链接及条目锚点，未发现缺失目标。 |
| 文本检查 | 所有需求与审查文档无行尾空白，包章节及 ID 与审查记录一致。 |
| 原文件保留 | 开始时记录的 393 个非 SPEC 文件哈希全部未变，包括产品代码、测试及历史报告。 |
| 框架保留 | specs/meta.md 及初始结构决策字节未变。 |
| 执行边界 | 未创建 .acceptance 或 .acceptance-local，未运行产品测试、模型工作流或提交 PUSH。 |

当前未生成测试场景或验证用例，也未运行任何产品验收。
每个需求包的验证章节仍明确未开展，SPEX lint 只能检查结构而不能证明需求充分或实现符合。
后续需要为这些条目建立集成/系统验证设计，才能检查真实 AGENT 的输出质量及运行行为。

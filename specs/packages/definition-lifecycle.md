# definition-lifecycle: 需求来源、冻结与变更

## 意图

完整保存本次验收的约定及出处，使执行有固定依据，并能在约定变化后确定必要的后续工作。

本包规定需求目标，不声明当前实现已经符合或通过验收。

## 外部行为

### definition-lifecycle-1

当用户从对话、项目文档、在线系统或其他载体提供约定时，定义整理应保留纳入项的完整原文、稳定身份和实际出处，不要求项目先转换成特定 SPEC 格式。

### definition-lifecycle-2

当发布本次采用的完整定义时，定义存储应保存需求、逆向规则和场景三个集合，以及整体目标、范围、共同约束和相关上下文，并明确列出缺少场景的目标及待确认规则。

### definition-lifecycle-3

当一个独立场景本身提供完整有效约定而没有上层需求时，定义整理应直接保存该约定和来源，不编造父需求。

### definition-lifecycle-4

当引用外部约定时，定义整理应保存实际定位、已读版本或可核验快照标识与原文，使外部来源不可访问后仍可读取本次执行依据。

### definition-lifecycle-5

当从提交或 PR 的代码变化发现候选行为时，逆向分析 AGENT 应按预期依据将其区分为原需求已覆盖、有独立依据的可纳入规则或待确认观察，不将同次修改的实现与说明视为彼此独立的证明。

### definition-lifecycle-6

当候选规则缺少独立预期依据时，逆向分析应保留具体问题和发现所用代码版本，并将其排除在可直接判定产品通过或失败的执行义务之外。

### definition-lifecycle-7

当采用新增或修订的定义时，定义存储应追加带内容哈希的完整版本，保留同一事项的 ID 和旧版本，并将当前索引指向新版本，不覆盖既有冻结文件。

### definition-lifecycle-8

当启动依赖定义的分析、场景设计、用例准备、调试或复审阶段时，宿主应核对该阶段输入与所引用冻结快照的内容哈希及场景依赖相符，失配时停止受影响交接。

### definition-lifecycle-9

当需求、规则或共同业务约束发生实质变化时，变更处理应记录受影响的场景及依赖依据，保留旧执行事实与结论，并单独标注它们对新定义的适用性。

- 显式将旧版场景清单采用为完整定义时，旧版缺少的业务上下文绑定按未知处理，重查本次采用的场景，不据此推定等价。

### definition-lifecycle-10

当只是新增独立需求或修改整体分组、执行说明而未改变已有场景的业务依赖时，变更处理应保留无关联场景的有效绑定，不将整份上下文变化机械等同于全量重测。

### definition-lifecycle-11

当用户要求完成需求变更验收时，调度应纳入受影响需求的全部有效场景，包括新增和以前未执行的场景，不因缺少历史执行而省略。

### definition-lifecycle-12

当用户明确仅要求更新定义或设计时，变更处理应保留待复验说明，不启动用例实现、业务执行或运行环境准备 [[delivery-acceptance-2](delivery-acceptance.md#delivery-acceptance-2)]。

### definition-lifecycle-13

当外部来源不能读取或被确认已删除时，变更处理应分别记录读取失败或已确认删除的依据，不自动删除本次已纳入的义务或改写旧快照。

### definition-lifecycle-14

给定用户授权回填需求且项目没有适用组织规范，当建立需求组织时，回填流程应调用真实 SPEX 工具并保存命令、工具版本或来源、退出码及生成文件清单，不以手写模板冒充初始化成功。

### definition-lifecycle-15

当为提交或 PR 进行白盒逆向分析时，宿主应冻结基线与目标提交、全部变更路径及声明组件版本，并要求最终分析逐路径记录已检查的行为、复用依据、无可纳入规则的原因或读取限制。

### definition-lifecycle-16

给定用户没有要求完整变更验收而采用跟随历史的执行意图，当生成复验计划时，调度应仅选择受影响且曾实际执行的场景，新增及原未执行项保持未执行。

### definition-lifecycle-17

给定用户已授权回填，当项目存在适用的需求组织规范时，回填流程应沿用该规范和用户所选载体，并保留原冻结 ID、来源及准确的回填条目对应关系。

### definition-lifecycle-18

当采用跨仓库合同作为逆向规则的独立预期依据时，宿主应核对其原文与所声明的不可变修订一致，来源或内容失配时阻止该规则进入可执行义务。

### definition-lifecycle-20

当用户仅要求冻结指定约定时，冻结流程应通过独立入口保存有实际来源的完整定义及范围版本后停止，不启动场景生成、项目运行准备或用例执行。

### definition-lifecycle-21

当一个冻结请求首次提交或重复提交时，冻结流程应核对请求身份及明确的当前基线，仅首次匹配提交可追加版本，相同请求重入只返回可核验的原记录及其当前适用性，身份冲突、基线过期或记录损坏时拒绝覆盖已有事实。

### definition-lifecycle-26

当冻结请求采用项目内文件约定及声明的必要背景时，冻结流程应在发布前核对清单所需文件的完整原文、实际文件哈希和约定行定位，将核验后的完整背景保存在冻结上下文中交接给后续阶段，缺失、截断、内容或定位失配时拒绝本次发布且保留已有事实。

- 宿主依据对话声明必需资料，工作流不推断被宿主从清单和请求中同时遗漏的上下文，不将背景新增为验收目标，也不要求口述约定使用项目文档。

## 验证

以下分别登记旧版采用、独立冻结、逆向及回填的集成验证，不以条目存在代替实际执行结果。
历史测试报告不作为本包当前需求已经通过的证明。

### definition-lifecycle-19

当验证旧版清单的显式采用时，集成测试应通过实际发布入口核对新完整定义可冻结且旧记录字节及历史引用保持不变 [[definition-lifecycle-7](#definition-lifecycle-7)]，并将缺少旧业务上下文绑定的场景列为需重查 [[definition-lifecycle-9](#definition-lifecycle-9)]。

### definition-lifecycle-22

当验证独立冻结入口时，集成测试应通过真实官方 CLI 和原存储工具核对原文及来源保留 [[definition-lifecycle-1](#definition-lifecycle-1)]、完整定义版本 [[definition-lifecycle-2](#definition-lifecycle-2)]、增量变更对无关场景的保留 [[definition-lifecycle-10](#definition-lifecycle-10)]、冻结后停止 [[definition-lifecycle-20](#definition-lifecycle-20)] 及同请求重入和过期基线拒绝 [[definition-lifecycle-21](#definition-lifecycle-21)]。

### definition-lifecycle-23

当验证独立逆向入口时，集成测试应通过真实官方 CLI 的单次只读 Analyst 调用核对完整产品变更归属 [[definition-lifecycle-15](#definition-lifecycle-15)]、原需求与独立合同及待确认观察的区分 [[definition-lifecycle-5](#definition-lifecycle-5)]、待确认规则不成为可执行义务 [[definition-lifecycle-6](#definition-lifecycle-6)]，以及候选停止和版本变化后的历史适用性 [[definition-lifecycle-12](#definition-lifecycle-12)]。

### definition-lifecycle-24

当将冻结存储迁移到 Node 时，集成测试应通过真实官方 CLI 核对版本追加及旧字节保留 [[definition-lifecycle-7](#definition-lifecycle-7)]、业务绑定及原协议哈希 [[definition-lifecycle-8](#definition-lifecycle-8)]、无关场景保留 [[definition-lifecycle-10](#definition-lifecycle-10)] 和冻结请求重入 [[definition-lifecycle-21](#definition-lifecycle-21)]，覆盖 Unicode 及数值上下文。

### definition-lifecycle-25

当验证用户授权的文档回填时，集成测试应沿用实际项目组织、限制写入授权文档并通过真实 SPEX 检查，保留原约定映射及单独冻结候选 [[definition-lifecycle-17](#definition-lifecycle-17)] [acceptance_backfill.integration.mjs](../../tests/acceptance_backfill.integration.mjs)。

- 原文包含完整标点和空白；新增引用应放在完整原文之后，不能通过插入引用改写原句。拒绝时指出具体事项及失配类别，不将排版相近当作原文相同。

### definition-lifecycle-27

当验证输入质量时，集成测试应通过实际冻结工具及真实官方 CLI 核对完整文件背景向后续场景输入的交接、错误行号与遗漏背景及哈希失配的发布前阻塞，并核对范围未扩大和历史未被改写 [[definition-lifecycle-26](#definition-lifecycle-26)] [acceptance_source_inputs.integration.mjs](../../tests/acceptance_source_inputs.integration.mjs)。

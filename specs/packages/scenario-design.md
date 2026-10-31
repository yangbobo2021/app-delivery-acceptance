# scenario-design: 场景采用与增量设计

## 意图

将已确认的约定转成足以区分正确和错误行为的简明测试点，保留设计缺口和人工修改。

本包规定需求目标，不声明当前实现已经符合或通过验收。

## 外部行为

### scenario-design-1

当为一个需求或有独立依据的规则 [[definition-lifecycle-5](definition-lifecycle.md#definition-lifecycle-5)] 设计场景时，场景 AGENT 应读取完整冻结需求、共同目标、范围及相关分组，使每条新场景只有一个主目标，其他需求仅作相关上下文。

### scenario-design-2

当已有场景的条件、操作和预期适用于当前冻结约定时，场景设计应保留其身份及实际来源，仅为未覆盖义务补充场景，不为演示缩减已纳入的场景集合。

### scenario-design-3

当形成一条场景时，场景 AGENT 应用一至两句说明必要条件、操作和可观察预期，使读者无需阅读实现代码即可知道测试对象及判定结果。

### scenario-design-4

当完成一个目标的场景设计时，场景 AGENT 应逐项映射原文必达义务到场景 ID、可判定结果和失败影响，并为每项未覆盖义务记录设计缺口。

### scenario-design-5

当原约定允许多个相反结果且没有共同必达行为时，场景设计应记录允许这些结果的原文，说明该片段不能据此形成唯一通过判据，不自行补造限制。

### scenario-design-6

当确定场景优先级时，场景 AGENT 应按该场景失败的实际后果给出等级和理由，不因日后可修复、回滚或人工补救而降低核心路径失效的等级，也不规定各等级数量或比例：

| 等级 | 失败后果 |
| --- | --- |
| P0 | 已纳入的核心业务闭环失效，或造成严重数据损坏、资金损失、访问控制暴露等重大风险。 |
| P1 | 重要常用操作、分支或恢复行为失效，核心闭环和重大风险保障仍可用。 |
| P2 | 次要或较低频行为失效，影响较小，必要时有已确认可接受的替代办法。 |
| P3 | 轻微体验问题或低影响边缘组合失效。 |

### scenario-design-7

当目标涉及可见界面或交互时，场景设计应在相应业务场景中记录关键状态的内容与控件可见、可读、可操作及无遮挡判据，并仅按本次确认的范围补充布局和风格要求，不仅为截图新增重复场景。

### scenario-design-8

当需求变化或人工修改要求调整已有目标场景时，场景修订应以当前采用集合为基线，记录增删改及原因，保留未受影响和人工修改的内容，并重新检查合并后的目标场景集合 [[scenario-design-4](#scenario-design-4)]。

### scenario-design-9

当报告场景检查结果时，宿主应标明实际采用的是生成 AGENT 内部自检、确定性结构校验或独立会话审查，不将内部自检或结构校验称为独立复审。

### scenario-design-10

当采用本次完整场景集合时，场景设计应检查跨目标的预期冲突与重复测试目的，并记录冲突处理或保留重叠的具体断言依据。

### scenario-design-13

当冻结黑盒需求已有可观察的验收判据时，场景设计应据此定义可区分正确与错误行为的场景，将尚未具备的实现、命令、账号、设备或运行环境记录为后续执行前提，不将其单独作为业务判据缺口；白盒场景仍保留冻结源码依据要求 [DR-016](../decisions/016-input-preflight-and-design-readiness.md)。

### scenario-design-14

当返回设计结果时，场景流程应依据逐项义务映射分别报告完整、部分或受阻的设计覆盖状态及执行前提，不将未执行解释为设计不完整，也不将没有未覆盖义务的合法零场景结果解释为失败。

### scenario-design-15

当接收设计纠正意见时，场景流程应核对所引用原始设计回执、原答及当前目标和冻结版本，在新尝试中把纠正作为设计参考交给角色，保留旧资料且不改变原始业务判据。

## 验证

本轮补充独立场景入口的集成验证，不代表本包其余行为或被测产品已完成交付验收。
历史测试报告不作为本包当前需求已经通过的证明。

### scenario-design-11

当验证独立场景入口时，集成测试应通过真实官方 CLI 的角色调用核对完整上下文中的单目标设计 [[scenario-design-1](#scenario-design-1)]、义务与场景对应 [[scenario-design-4](#scenario-design-4)]、视觉判据绑定 [[scenario-design-7](#scenario-design-7)]、差量修订对人工场景及无关目标的保留 [[scenario-design-8](#scenario-design-8)] 及内部自检与独立复审的明确区分 [[scenario-design-9](#scenario-design-9)]。

### scenario-design-12

当验证用户显式要求的独立场景复审时，集成测试应通过独立官方角色识别原文义务缺口 [[scenario-design-4](#scenario-design-4)]、保留只评估后停止的边界 [[scenario-design-9](#scenario-design-9)]，并核对引用失配和定义更新后的陈旧结果不能冒充当前通过 [acceptance_scenario_assessment.integration.mjs](../../tests/acceptance_scenario_assessment.integration.mjs) [migration_safety.integration.mjs](../../tests/migration_safety.integration.mjs)。

### scenario-design-16

当验证设计就绪边界时，集成测试应核对不同领域中明确判据与执行前提的分离 [[scenario-design-13](#scenario-design-13)]、部分覆盖及合法零场景的结果区分 [[scenario-design-14](#scenario-design-14)]，以及纠正绑定、旧证据保留与错目标或陈旧产物拒绝 [[scenario-design-15](#scenario-design-15)] [acceptance_scenarios.integration.mjs](../../tests/acceptance_scenarios.integration.mjs) [acceptance_design_readiness_cli.integration.mjs](../../tests/acceptance_design_readiness_cli.integration.mjs)。

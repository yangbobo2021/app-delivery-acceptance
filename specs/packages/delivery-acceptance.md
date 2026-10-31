# delivery-acceptance: 交付验收目标与范围

## 意图

让用户依据已确认的需求、真实测试和独立证据判断交付状态，并明确未完成范围。

本包规定需求目标，不声明当前实现已经符合或通过验收。

## 外部行为

### delivery-acceptance-1

当用户要求交付验收时，测试 SKILL 应为纳入范围的每个需求、规则或独立场景建立可追踪记录，关联其场景、用例、实际执行和独立结论 [[traceability-view-1](traceability-view.md#traceability-view-1)]。

### delivery-acceptance-2

当用户明确只要求整理需求、设计场景或查看历史时，测试 SKILL 应停在所授权的工作边界，不因已有测试、定义变化或浏览操作启动业务测试。

### delivery-acceptance-3

当决定某项工作是否纳入验收范围时，测试 SKILL 应记录它与用户所选目标的关系，仅纳入直接验证目标、具有明确因果关系的受影响回归或完成目标必需的依赖。

### delivery-acceptance-4

当输出交付结论时，测试 SKILL 应同时列出本次验收的范围排除、未执行项、待确认问题及能力缺口，并说明各项对结论的限制。

### delivery-acceptance-5

当声明一个完整需求验收通过时，测试 SKILL 应确认该需求的必达义务均有场景及可判定结果 [[scenario-design-4](scenario-design.md#scenario-design-4)]、这些场景在当前冻结产品版本上均有有效独立通过结论 [[execution-evidence-5](execution-evidence.md#execution-evidence-5)]，且没有未处理的必要设计缺口或阻塞。

### delivery-acceptance-6

当用户要求提交或 PR 的整体结论时，测试 SKILL 应核对冻结目标与全部纳入场景的同版本结果后给出通过、发现缺陷或受阻结论，不以批次调度完成代替整体通过。

### delivery-acceptance-7

当测试发现产品缺陷而用户尚未授权产品修复时，测试 SKILL 应保留失败依据及影响并报告缺陷，不在测试过程中改写产品行为以制造通过。

### delivery-acceptance-8

当用户明确接受已知风险时，测试 SKILL 应记录所针对的场景、技术发现、用户原始决定、确认时间及剩余影响，并将接受风险与通过及待处理产品缺陷分开保存。

- 相同风险决定重复提交时，应返回同一记录、摘要和原技术状态，保留原决定及独立发现字节，不因复用丢失技术结论。

### delivery-acceptance-9

当任务因缺少已验证的运行条件而不能继续时，测试 SKILL 应报告已完成范围、阻塞原因、影响和可行下一步，不在缺少新证据或条件变化时无限重复同一失败操作。

### delivery-acceptance-10

给定用户提供了原始需求，当进行整体验收分析时，需求分析 AGENT 应输出共同目标、已确认范围及上下文分组，并保留每个输入需求的身份与正文，不因合并分组省略需求。

### delivery-acceptance-11

给定提交或 PR 没有原始需求，当确定验收目标时，测试 SKILL 应以用户指令或独立合同为依据记录目标及范围，不从被测实现自行制造业务目标。

### delivery-acceptance-12

当场景必须依赖实际手工操作或缺少源码的黑盒入口时，测试 SKILL 应采用适用的手工或黑盒流程并保存真实操作证据，不把自动化脚本或源码审计结果当作已经完成该操作。

## 验证

本轮补充独立分析入口的验证，不代表其余交付验收行为或被测产品已全部通过。
历史测试报告不作为本包当前需求已经通过的证明。

### delivery-acceptance-13

当验证独立需求分析入口时，集成测试应通过真实官方 CLI 的 Analyst 调用核对全部原始需求保留 [[delivery-acceptance-10](#delivery-acceptance-10)]、仅分析后停止 [[delivery-acceptance-2](#delivery-acceptance-2)] 及无原始需求时不编造业务目标 [[delivery-acceptance-11](#delivery-acceptance-11)]。

### delivery-acceptance-14

当验证逐需求完整交付路径时，集成测试应通过官方 CLI 串联创建、冻结、所选 P0 设计、真实执行及独立整体验收 [[delivery-acceptance-1](#delivery-acceptance-1)]，随后只设计下一目标并保留未执行边界 [[delivery-acceptance-2](#delivery-acceptance-2)] [full_native_journey.integration.mjs](../../tests/full_native_journey.integration.mjs)。

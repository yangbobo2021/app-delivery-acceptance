# 场景到用例的共同设计与审查标准

版本：`case-design-v1`。执行准备者与独立 Reviewer 共用冻结场景、相同检查项和本标准。已有用例、新建用例、AI模拟人工任务适用同一标准。设计阶段不选择用例；场景进入执行准备时才根据需求、代码、场景意图及已有测试选择并实现。

## 职责与完备性

场景说明业务背景、验证范围、必须成立的结果；用例负责具体初始状态、数据、动作、逐步预期与负责的范围；实际事实与证据属于用例执行记录。不要另外复制一份场景操作方案。共享环境与来源可在准备记录中写一次，以引用复用。

准备者从每条 acceptance.criteria 分解必要检查点，保存 binding.case_design。检查点必须保留该判据全部重要输入组、结果与状态保留，不得将A/B/C压缩成只检查A的笼统条目。每个procedure.scenario_checks通过 covered_point_ids、step_numbers定位自身范围；不能只因为标题相关就认定覆盖。生成者提交全部用例贡献的并集，结构缺项不能进入执行。

Reviewer实际阅读绑定版本的用例代码或人工步骤与执行记录。检查需求/场景一致性、输入及前置可复现、动作与断言判别力、并集完整性、范围边界。原始清单不能限制独立分析；发现未列情况或不实映射，按冻结场景依据说明缺口及会漏过的错误，记录repair_required / test_design，修正同一场景并重新执行。重复覆盖不抵消遗漏；多个用例可以共同覆盖一项。不新增未确认业务要求，也不要求每项固定数量的用例。

独立核查在既有逐场景评估步骤完成，写assessment.case_coverage，绑定该次observation/result_sha256（包含用例版本与设计）。未审查的准备记录显示“用例覆盖待审查”，不能提前宣称充分。通过与确认BUG都要求用例设计覆盖充分；产品失败仍可有完整合理的用例设计。覆盖充分与执行通过是两个维度。

## 数据合同

binding.case_design:
```json
{"standard":"case-design-v1","items":[{"criterion":"精确冻结判据","check_points":[{"id":"retain","text":"请求被拒绝后目标记录字段保持"}]}]}
```
每条冻结判据恰好一项；检查点ID在该项内唯一。每个procedure.scenario_checks保留scenario_id、criterion、scope，增加covered_point_ids（此判据中的检查点）、step_numbers（从1开始的自身步骤号）。全部当前场景用例贡献必须覆盖全部点。

assessment.case_coverage:
```json
{"standard":"case-design-v1","status":"sufficient","items":[{"criterion":"精确冻结判据","status":"covered","reason":"说明实际检查与覆盖边界","contributions":[{"association_key":"case:tests/test_sample.py:Sample.test_reject","covered_point_ids":["retain"],"step_numbers":[2],"reason":"实际代码第2步在拒绝后重新读取并逐字段比对目标"}]}]}
```
人工任务association_key为manual:任务ID。逐项covered/partial/gap来自独立核实贡献的并集；总状态sufficient/partial/gap。独立评估说明尚缺哪些点与不实贡献。不得复制作者的声称代替阅读代码与证据。

observation.case_results每项为association_key、status、summary、evidence，以及step_results [{step_number,actual,evidence}]。每个绑定任务恰好一条；通过/失败用例每个计划步骤恰好一条实测观察，无法完成的异常只记录实际发生的步骤；证据只能引用该结果已登记文件。步骤的计划预期不能冒充实测事实。原始命令/控制台日志保存，执行状态不继承场景或兄弟用例。场景观察保留整体事实，但不能用它替代个别用例结果。准备失败/AI异常按既有恢复流程记录，未完成步骤不得伪造观察。

## 四列表达

覆盖关系是报告：需求｜测试场景｜关联用例／手动测试｜最终结论。需求的覆盖标记打开需求检查项到场景的对应；场景显示标题、重要度与用例覆盖标记；第三列每个任务独立列出已有/新建/AI模拟人工、当前阶段或执行结果，点击打开该项的测试目的、前置/数据、操作/预期、承担范围、实际步骤与证据；第四列是整个场景的独立结论与完整论证。

用例覆盖弹窗首先显示“场景检查项及覆盖情况｜具体测试项｜对应用例及检查依据”。覆盖状态、尚缺点、重复范围在第一列；用例标题可点击；实际动作/预期与实现核验理由可展开。缺数据如实显示尚未设计或待审查。取消场景行重复操作方案/准备/证据列，不提供独立执行历史或额外报告。

逐用例完成后可立即通过scenario-step --action case-result记录该项实测及证据，供执行中实时查看；不覆盖先前事实。最后observe的case_results须与已登记事实一致。修正必须走同场景恢复流程，旧事实与证据随尝试归档。

The assessment output_quality artifact key `operation_plan` refers to the readability and correctness of all bound case/manual-task procedures. It does not require a separate scene operation_plan.
For blocked/unproven/execution_error cases, record only steps actually performed, with distinct valid step numbers and their own evidence. An empty step_results list is permitted when failure occurred before any planned operation; explain the inability and cite its real evidence. Never invent results for later steps. Passed/failed cases require every planned step.

覆盖关系中的每个关联用例或人工任务用一行展示：来源标签（已／新／人工）、该任务自身的执行状态、可点击标题。来源标签通过悬浮及无障碍名称说明完整含义；未记录来源不可猜测。标题打开完整测试过程，状态打开同一精确任务的实际执行与证据区域。执行摘要只在详情中展示，不在表格重复；用例通过与独立评估的整个场景最终通过分别表达。尚无单项执行记录时不得从场景或兄弟用例推断其已执行或通过。

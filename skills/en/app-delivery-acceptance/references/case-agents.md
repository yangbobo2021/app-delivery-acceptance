# 用例 Agent 与描述性评估

适用于 v4 自动化场景。共享运行与覆盖率环境仍按项目准备并复用；本地调试、正式冻结执行和执行后独立复审继续分开。

## 两种可替换的用例 Agent

在 `bind_case.py` 的模板（或 `run_plan.py` 的 `case_template`）声明：

```json
{
  "case_strategy": "existing_only",
  "case_evaluation": true
}
```

- `implement`（默认）：原用例 Agent，保留设计、复用/新建、实现及本地调试职责。
- `existing_only`：已有用例查找 Agent。阅读实际输入、操作、断言、Fixture/Mock 和辅助代码，选择适用现有测试，用既有命令/过滤参数进行真实本地调试。不得新建、修改、删除用例、断言、Fixture、辅助、产品、SPEC、配置或锁文件；不制作新断言或业务请求冒充已有测试。调试请求和运行产物写在既有隔离目录。

两者输出同一协议：`status`、`test_files`、`test_command`、`test_env`、`observations`、`evidence_paths`、`limitations`、`reason`。本地 `passed_local` 不是正式场景通过。仅实际调试后才能记录执行观察；特殊宿主就绪情况仍按原 `host_ready` 语义披露未执行部分。

查找模式找不到测试或无法执行时，保留具体范围和原因；不自动切换到实现 Agent。`existing-files.json` 记录启动时的 Git 版本和可跟踪文件字节，宿主在调试与后续阶段核对，包括组件仓库和既有未提交测试。新增、修改或删除会触发原有文件保护；声称本地执行还必须存在实际调试收据。忽略的运行缓存不是业务测试来源；返回的测试文件须在启动记录中存在。

查找模式禁止本地 blocker 修补及执行后自动测试修补。正式 Reviewer 仍按原规则返回实际结论，`repair_required` 保留为待处理，不暗中修改测试。默认实现模式的修补逻辑保持不变。

## 只给人看的用例评估

用例 Agent 产物之后、正式执行之前，独立只读 Agent 阅读实际关联用例，对以下内容作描述：

- 条件、操作、预期和多个用例的共同覆盖，列出实际依据与缺口；
- 质量风险，包括无效断言、过度约束、Mock 边界；
- 可能重复的范围及原因；
- 各用例的贡献和限制。

已有本地观察只是背景，不能当作正式执行或独立验收结论。Agent 不运行测试，不改代码，不重新生成/查找一组用例，不移除关联，不筛选命令，不要求先修补再执行。`coverage: sufficient|partial|gap|uncertain` 是描述性标签，与源码行覆盖率、正式通过/BUG状态分开。

产物位于场景运行目录：

- `case-evaluation.json`：输入/用例/项目 catalog 哈希、可用性及完整描述。
- `case-evaluation.md`：人可直接阅读的报告，明确标注不参与执行控制。
- `case-evaluation-<用例结果哈希>/`：原始输入、Agent 回答与模型运行记录。
- 最终 `summary.json.case_evaluation`：描述或失败原因；正式结论仍读取原 `review_status`。

相同绑定恢复时复用已有描述。失败、超时、格式异常均记录为不可用，不阻止执行、不自动重试评估，也不计入执行状态机门禁或修补计数。原正式 Reviewer 不消费该描述作为判定依据。

暂不新增 Web 状态或结果分类；查看报告文件即可。正式归档会带上存在的描述报告和其回答，不将模型会话、调试产物或凭据一并公开。

`--stop-after case` 仍在原用例阶段后停下；`--stop-after case-evaluation` 是调用者主动选择在描述后暂停，不代表评估 Agent 否决后续执行。`case_evaluation: false` 可显式跳过描述，已冻结的配置不得原地修改。

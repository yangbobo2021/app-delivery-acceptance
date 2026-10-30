# 独立正式执行与指定 TC 重跑

`/acceptance-execute` 运行已就绪用例，冻结本次证据，调用独立 Reviewer；在有限预算内修复测试缺口，再保存新执行和复审尝试。
不创建需求、场景或另一套验收身份。模块为 `workflows/execute/registry.mjs`。

## 输入

```json
{
  "project_root": "/absolute/user-project",
  "acceptance_id": "AT-example",
  "request_id": "execute-1",
  "definitions_sha256": "<current scenarios.json SHA-256>",
  "basis": "用户要求正式执行该场景。",
  "case_input": "/absolute/this-AT/workflows/cases/attempt/case-input.json",
  "case_answer": "/absolute/this-AT/workflows/cases/attempt/case/answer.json",
  "catalog": "/absolute/this-AT/workflows/cases/attempt/catalog.json",
  "guide": "/absolute/this-AT/workflows/cases/attempt/guide.json",
  "max_review_repairs": 2,
  "execution_settings": {}
}
```

必须提供同 AT、当前冻结定义、实际工作区及可复验 runtime manifest。用例已由宿主落地永久 ID，不能用模型自己编写的身份报告替代。
`max_review_repairs` 为 0..5 的明确有限预算；非零预算要求冻结项目指南。0 表示保留独立结论而不自动修复。
`execution_settings` 可沿用项目准备中的 fresh 环境变量、证据目录、截图相对输出和字节限制。额外证据限本尝试明确输出根，日志内的任意外部路径不自动取得复制授权。
`evidence_exclude_globs` 可排除约定的重复图或采集中间帧；它只作用于额外输出，不得排除主执行收据、日志和必需原生覆盖率。范围说明与包含/排除模式保存在冻结清单中；使用宽范围包含正式状态，使有界修补新增的截图也能进入复审。
UI 评审按像素哈希合并完全相同的图片并保留路径别名；单次最多接收 64 张不同的冻结图片，仍受显式证据字节预算约束。超限时停止并报告，不静默丢弃状态或只审查前几张。

## 只重跑指定用例

额外填写 `selected_case_ids`、`execution_command` 和 `selection_basis`。
ID 必须来自原实际关联；命令是运行这些声明的原始业务 argv，依据说明如何选择它们。
只选一部分时必须明确命令，不静默运行全量测试，也不接受采集器包装命令作为业务入口。
独立复审核对 ID、实际命令、源码和本次日志。
结果使用 `review_applies_to: selected_cases_only`，完整场景仍为 `scene_review_status: not_revalidated`；所选用例通过不替代整场景的旧结论或未执行范围。

## 过程和通过依据

1. 核对当前 AT、完整定义、项目版本、runtime、永久 ID 和知识，取得本次场景的工作区归属。
2. 用 Node 正式运行真实命令；已启用覆盖率时只包裹一次已验证的项目采集器。保存命令、环境变化、开始结束、退出码、日志及测试前后哈希。
3. 冻结选定原始证据，校验交接，再由官方 CLI 的独立只读 Reviewer 判断本次范围。UI 场景把冻结图像像素随消息交给 Reviewer，缺少像素不能通过。
4. 仅测试或证据缺口进入有限差量修复；合同/场景争议停止。每次修复保留新的执行、证据和复审目录，不覆盖原失败。

产品缺陷与测试/证据缺口并存时，仍在剩余预算内修补测试或证据并重新取证；产品观察保留，不授权修复产品或削弱断言。预算耗尽时保留剩余问题。

目前真实验收已覆盖指定 TC、明确检查点继续、一次真实有界修复及修复检查点后的接续；完整 UI 链和未知效果恢复仍在验证，不把入口文件存在当成已通过。

## 停止、继续和证据

`stop_after` 可为 `execution / evidence / gate / review / repair`。
同 request_id 和其他完全相同字段，修改或省略 stop_after 后继续；已完成命令仅核对收据，不再执行。
有 running/parked 状态、未知进程或未知副作用时停止，先走显式恢复核对，不能删锁后自动重试。

`.acceptance-local/<AT>/workflows/execute/<request_id>/` 保存输入、来源哈希、逐阶段状态、实际进程收据、正式执行、冻结证据、角色原答与会话及结果。
流程完成只释放单场景归属，保留整项验收的 current 指针；`completed` 不是整项交付通过。

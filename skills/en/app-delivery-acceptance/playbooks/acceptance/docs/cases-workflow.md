# 独立用例准备与实际调试

`/acceptance-cases` 为一个已冻结场景查找、复用、扩展或生成必要用例，进行真实本地调试及默认独立设计评估，然后停止。
正式执行使用另一入口 `/acceptance-execute`。静态关联使用 `/acceptance-find-cases`，不运行调试。

```json
{
  "project_root": "/absolute/user-project",
  "acceptance_id": "AT-example",
  "request_id": "case-1",
  "definitions_sha256": "<current scenarios.json SHA-256>",
  "scene_id": "SC1",
  "basis": "用户要求为当前场景准备实际可运行用例。",
  "catalog": "/absolute/this-AT/workflows/preparation/catalog.json",
  "guide": "/absolute/this-AT/workflows/preparation/guide.json",
  "case_strategy": "implement",
  "case_evaluation": true,
  "debug_environment": {},
  "knowledge_paths": []
}
```

catalog 必须指向同 AT 的单一工作区、当前完整定义及实际复验的 runtime manifest。Node 从冻结定义直接解析场景，支持有需求的场景和来源完整的独立场景，不补造父需求。
`basis` 作为 `preparation_basis` 原样交给用例角色，说明本次准备或修补的具体操作要求；它不能替代冻结定义或增加业务判据。角色只获得显式输入，不自动获得宿主对话上下文。
`implement` 先冻结已有用例查找检查点，再复用、扩展或补齐；`existing_only` 只查找并真实调试已有用例，宿主可追加精确 ID 注释，不能修改正文或配置。
默认独立 Evaluator 只给出设计充分性和取舍意见；评估失败不替代产品判断，也不自动过滤执行用例。

Node 工具验证查找原文、取舍、正式测试树及永久 ID；原 Agent 回答和测试 preimage 保留。
实现模式的当前关联以最终 `case_descriptions` 和复用取舍为准。原答若精确回声已冻结、已验证的查找检查点，身份报告将其标为历史检索引用，保留原答，不把未采用的检查点别名登记为当前用例；其他未知关联仍拒绝。
本地通过必须有实际调试收据。`host_ready` 仅表示已有可复验公共运行环境、还需宿主正式执行，不是本地或产品通过。
递归核对本地辅助产物时不跟随符号链接，编译器生成的非证据链接不会被当作测试或原始证据读取；显式选定的测试源码及证据路径仍须通过原有归属与链接校验。
场景定义、产品或组件失配、越权修改及中断均停止，保留原角色会话和工作区，不自动重演未知副作用。

产物在 `.acceptance-local/<AT>/workflows/cases/<request_id>/`：冻结输入、catalog/guide 副本、查找检查点、调试原生资料、原答与正式 ID、独立评估、实际命令输出及结果。
就绪回执给出下一入口的 case_input、case_answer、catalog、guide 和永久 TC IDs；候选代码留在本 AT 工作区，不冒称已集成开发主干。

`blocked` 是本次准备的真实结果，不自动结束调用者的完整验收目标。
例如真实用例已跑通但既有覆盖率 profile 漏采产品子进程时，宿主按[跨工作流接续](intent-inputs.md#跨工作流接续)将实际路径和失败证据交回覆盖率准备，再绑定新 profile 并为原场景调用新的 cases 请求，优先复用已有测试和永久 TC。
不要重入原已完成请求期待它改变结果，也不要直接改写旧 profile 或通过用例改成内部函数调用来补覆盖率。

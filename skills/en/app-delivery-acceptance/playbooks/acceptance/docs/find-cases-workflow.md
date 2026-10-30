# 静态查找并关联已有用例

`/acceptance-find-cases` 通过官方 Playbook CLI 的独立 `finder` 角色只读查找当前场景的实际已有测试。
入口为 `workflows/find-cases/registry.mjs`；注册方式见 [独立入口](independent-workflows.md)。
宿主使用原引用和身份协议，仅在本 AT 的隔离工作树补充永久 ID 注释并发布静态关联；不运行测试、构建或应用，不新增断言，不修改用户原源码树。

## 输入

提供 `project_root`、`acceptance_id`、`request_id`、当前 `definitions_sha256`、`scene_id`、真实 `source_checkout/revision`、项目 `test_roots` 和 `inspection_files`。
后者是实际测试文件、入口及必要辅助实现的完整内容清单，宿主先读取再显式交接；可提供原协议的组件和知识路径。
这是有明确阅读范围的静态语义查找，不因有限阅读声称整个仓库没有测试；当前交接上限 600000 字符，超限或材料不足须明确限制，不能悄悄遗漏。
原动态 `existing_only`（含真实调试）仍走旧入口；本入口始终是 `discover_only`。

## 工作与输出

1. 物化当前冻结场景并建立／复用 `.acceptance-local/<AT>/workspace`，记录文件基线与知识。独立场景没有原始需求时不编造父需求。
2. Finder 读取实际输入、断言、辅助语义和跳过状态，给出 `case_descriptions/case_discovery`；无关联须明确空组及检索限制，不自行切换为生成或执行。
3. 宿主核验场景摘录、双向关联、真实声明、连续原文及启动字节，只按原精确 ID 注释协议落地身份。已标记声明复用 ID，保留原答与 ID 前后补丁，不改业务正文或权限。
4. 只发布 `static-existing-tests-v1` 至 `.acceptance/<AT>/tests.json`，保留其他场景，正式测试清单使用其他协议时拒绝覆盖。结果为 `not_executed`，观察与执行证据为空。

`.acceptance-local/<AT>/workflows/find-cases/<request>/` 保存输入、源码基线、提示词、原答、门禁后的答案、身份报告、发布前后清单和来源摘要。
输出 `assessment-command.txt` 供宿主在用户需要时独立调用 `/acceptance-assess-cases`，不会自动启动评估或正式执行。
旧只读视图可显示静态关联；不增加已执行、通过、BUG 或代码覆盖率。当前场景绑定改变时明确提示关联需重新确认。
同请求重入不再调用角色或编号；源码、定义或当前映射变化时保留历史结果并返回 `stale`。
失败保留原答和具体原因；身份落地中断保留原协议日志，不盲目删除后重试。
隔离工作树、查找引用、身份注释和关联发布均由 Node 校验及执行。

```sh
node <repository>/tests/acceptance_find_cases.integration.mjs --live-cli --output /absolute/evidence
```

真实测试使用 macOS 的 Codex/gpt-6.1-sol：区分实际断言与相似标题诱饵、保留跳过状态、宿主仅写 ID、共享静态展示、跨场景复用 ID，以及随后独立 Evaluator 的完整交接。
协议夹具、真实模型结果和产品执行结论始终分开；其他 Agent、语言和平台未因本次通过而自动获得实测声明。
